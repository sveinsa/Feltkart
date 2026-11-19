// GNSS-tilstand for feltarbeid: kobler mot Android-posisjon (f.eks. Leica Zeno Connect) eller direkte Bluetooth-NMEA, og gir én felles status.
import { parseNmea, qualityOf, LineSplitter, type FixQuality, type Gga, type Gst } from './nmea';
import { native, isNative } from './native';
import { nb } from './fmt';

export type GnssSource = 'none' | 'android' | 'intern' | 'bt';

export interface GnssState {
  source: GnssSource;
  /** Tilkoblingsstatus i klartekst */
  message: string;
  connected: boolean;
  /** Siste posisjon (WGS84) */
  lat: number | null;
  lng: number | null;
  /** Høyde slik enheten oppgir den (over geoiden når mottakeren bruker geoidemodell) */
  alt: number | null;
  /** Geoidehøyde fra GGA hvis kjent (h = alt + sep) */
  sep: number | null;
  quality: FixQuality;
  /** Kvaliteten er bare anslått ut fra oppgitt nøyaktighet (Android-posisjon gir ikke RTK-status) */
  estimated: boolean;
  sats: number | null;
  hdop: number | null;
  age: number | null;
  /** Horisontal / vertikal nøyaktighet (1 sigma) i meter */
  accH: number | null;
  accV: number | null;
  /** Tidspunkt (ms) for siste oppdatering */
  updated: number;
  epochs: number;
  /** Rådata fra kilden i klartekst, til feilsøking (f.eks. «nøyaktighet 3,0 m · leverandør gps · mock ja») */
  raw: string;
}

const blank = (): GnssState => ({
  source: 'none', message: 'Ikke tilkoblet', connected: false, lat: null, lng: null, alt: null, sep: null, quality: 'none', estimated: false,
  sats: null, hdop: null, age: null, accH: null, accV: null, updated: 0, epochs: 0, raw: '',
});

let state: GnssState = blank();
const subs = new Set<(s: GnssState) => void>();
const epochSubs = new Set<(s: GnssState) => void>();
function set(patch: Partial<GnssState>, epoch = false) {
  state = { ...state, ...patch };
  subs.forEach((f) => f(state));
  if (epoch) epochSubs.forEach((f) => f(state));
}
export const gnssState = () => state;
export function onGnss(cb: (s: GnssState) => void) { subs.add(cb); return () => { subs.delete(cb); }; }
/** Kalles for hver ny posisjon (epoke) – brukes til gjennomsnitt. */
export function onEpoch(cb: (s: GnssState) => void) { epochSubs.add(cb); return () => { epochSubs.delete(cb); }; }

/** Anslår kvalitet ut fra nøyaktighet når mottakeren ikke oppgir RTK-status */
export function qualityFromAccuracy(acc: number | null): FixQuality {
  if (acc === null) return 'gps';
  if (acc <= 0.05) return 'fix';
  if (acc <= 0.5) return 'float';
  if (acc <= 3) return 'dgps';
  return 'gps';
}

// ---------- Android-posisjon (navigator.geolocation; Zeno Connect leverer RTK som «mock location») ----------
let watchId: number | null = null;
function startAndroid() {
  if (!('geolocation' in navigator)) { set({ source: 'android', message: 'Enheten har ikke posisjonstjeneste' }); return; }
  set({ ...blank(), source: 'android', message: 'Venter på posisjon …' });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const acc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null;
      const accV = p.coords.altitudeAccuracy !== null && Number.isFinite(p.coords.altitudeAccuracy) ? p.coords.altitudeAccuracy : null;
      set({
        connected: true, message: 'Android-posisjon', lat: p.coords.latitude, lng: p.coords.longitude,
        alt: p.coords.altitude !== null && Number.isFinite(p.coords.altitude) ? p.coords.altitude : null, sep: null,
        accH: acc, accV, quality: qualityFromAccuracy(acc), estimated: true, sats: null, hdop: null, age: null,
        updated: Date.now(), epochs: state.epochs + 1,
        raw: `Nettvisningen oppgir nøyaktighet ${acc === null ? 'ukjent' : nb(acc, 3) + ' m'}${accV === null ? '' : ', høydenøyaktighet ' + nb(accV, 3) + ' m'}`,
      }, true);
    },
    (e) => set({ connected: false, message: e.code === 1 ? 'Ingen tilgang til posisjon. Tillat posisjon for Feltkart i Android.' : 'Får ikke posisjon: ' + e.message }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

// ---------- Intern GPS (Androids egen posisjonstjeneste, direkte fra Kotlin; tar også imot «mock»-posisjon fra Zeno Connect) ----------
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
async function startIntern() {
  set({ ...blank(), source: 'intern', message: 'Venter på posisjon …' });
  offEvt?.();
  offEvt = native.on((ev, d) => {
    if (ev === 'loc') {
      const lat = num(d.lat); const lng = num(d.lng);
      if (lat === null || lng === null) return;
      const acc = num(d.acc); const accV = num(d.vacc);
      set({
        connected: true, message: d.mock ? 'Intern GPS (mock, f.eks. Zeno Connect)' : 'Intern GPS (telefonens egen mottaker)',
        lat, lng, alt: num(d.alt), sep: null, accH: acc, accV, quality: qualityFromAccuracy(acc), estimated: true,
        sats: num(d.sats), hdop: null, age: null, updated: Date.now(), epochs: state.epochs + 1,
        raw: `Leverandør ${String(d.provider || '?')} · mock ${d.mock ? 'ja' : 'nei'} · nøyaktighet ${acc === null ? 'ukjent' : nb(acc, 3) + ' m'}${accV === null ? '' : ' · høydenøyaktighet ' + nb(accV, 3) + ' m'}`,
      }, true);
    } else if (ev === 'locState') set({ connected: false, message: String(d.message || 'Intern GPS stoppet') });
  });
  try { await native.call('locStart', {}); } catch (e: any) { set({ connected: false, message: String(e?.message ?? e) }); throw e; }
}

// ---------- Direkte Bluetooth (NMEA) ----------
let offEvt: (() => void) | null = null;
let pendingGst: Gst | null = null;
function applyGga(g: Gga) {
  const sigH = pendingGst && pendingGst.sigLat !== null && pendingGst.sigLng !== null ? Math.hypot(pendingGst.sigLat, pendingGst.sigLng) : null;
  const gst = pendingGst;
  if (g.q === 0 || !Number.isFinite(g.lat)) {
    set({ connected: true, message: 'Bluetooth: ingen posisjon ennå', quality: 'none', sats: g.sats, hdop: g.hdop, estimated: false, updated: Date.now() });
    return;
  }
  set({
    connected: true, message: 'Bluetooth (NMEA)', lat: g.lat, lng: g.lng, alt: g.alt, sep: g.sep, quality: qualityOf(g.q), estimated: false,
    sats: g.sats, hdop: g.hdop, age: g.age, accH: sigH, accV: gst?.sigAlt ?? null, updated: Date.now(), epochs: state.epochs + 1,
  }, true);
}
const splitter = new LineSplitter();
export function feedNmea(text: string) {
  for (const line of splitter.feed(text)) {
    const m = parseNmea(line);
    if (!m) continue;
    if (m.type === 'GST') pendingGst = m;
    else if (m.type === 'GGA') applyGga(m);
  }
}
async function startBt(address: string, name: string) {
  set({ ...blank(), source: 'bt', message: `Kobler til ${name} …` });
  pendingGst = null;
  offEvt?.();
  offEvt = native.on((ev, data) => {
    if (ev === 'nmea') feedNmea(String(data.text ?? ''));
    else if (ev === 'btState') {
      const st = String(data.state);
      if (st === 'connected') set({ connected: true, message: `Tilkoblet ${name}. Venter på data …` });
      else if (st === 'connecting') set({ connected: false, message: `Kobler til ${name} …` });
      else set({ connected: false, message: String(data.message || 'Bluetooth frakoblet') });
    }
  });
  try { await native.call('btConnect', { address }); } catch (e: any) { set({ connected: false, message: String(e?.message ?? e) }); throw e; }
}

export async function startGnss(source: GnssSource, opts: { address?: string; name?: string } = {}) {
  await stopGnss();
  if (source === 'android') startAndroid();
  else if (source === 'intern') await startIntern();
  else if (source === 'bt' && opts.address) await startBt(opts.address, opts.name || 'GNSS');
  if (isNative()) native.call('keepAwake', { on: true }).catch(() => {});
}

export async function stopGnss() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  offEvt?.(); offEvt = null;
  if (state.source === 'bt') await native.call('btDisconnect', {}).catch(() => {});
  if (state.source === 'intern') await native.call('locStop', {}).catch(() => {});
  if (isNative()) native.call('keepAwake', { on: false }).catch(() => {});
  set(blank());
}

// ---------- Gjennomsnitt over flere epoker ----------
export interface Averaged {
  lat: number; lng: number; alt: number | null; sep: number | null;
  n: number; stdH: number; stdV: number | null;
  quality: FixQuality; estimated: boolean; accH: number | null; accV: number | null; sats: number | null; time: number;
}

/** Samler posisjoner i `ms` millisekunder (minst én) og gir gjennomsnittet. 0 ms gir siste posisjon. */
export function averageFix(ms: number, accept: (s: GnssState) => boolean = () => true, onProgress?: (n: number, pct: number) => void): Promise<Averaged> {
  return new Promise((resolve, reject) => {
    const eps: GnssState[] = [];
    const t0 = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      off(); if (timer) clearTimeout(timer);
      if (!eps.length) { reject(new Error('Fikk ingen gyldige posisjoner. Sjekk RTK-status og prøv igjen.')); return; }
      resolve(summarize(eps));
    };
    const take = (s: GnssState) => { if (s.lat !== null && s.lng !== null && accept(s)) eps.push(s); };
    const off = onEpoch((s) => {
      take(s);
      onProgress?.(eps.length, Math.min(100, ((Date.now() - t0) / Math.max(1, ms)) * 100));
      if (ms <= 0 && eps.length) finish();
    });
    if (ms <= 0) { take(state); if (eps.length) { finish(); return; } }
    timer = setTimeout(finish, ms <= 0 ? 8000 : ms);
  });
}

export function summarize(eps: GnssState[]): Averaged {
  const n = eps.length;
  const mean = (f: (s: GnssState) => number) => eps.reduce((a, s) => a + f(s), 0) / n;
  const lat = mean((s) => s.lat!), lng = mean((s) => s.lng!);
  const k = 111320; // meter per grad bredde
  const kx = k * Math.cos((lat * Math.PI) / 180);
  const stdH = n > 1 ? Math.sqrt(eps.reduce((a, s) => a + ((s.lat! - lat) * k) ** 2 + ((s.lng! - lng) * kx) ** 2, 0) / (n - 1)) : 0;
  const alts = eps.filter((s) => s.alt !== null);
  const alt = alts.length ? alts.reduce((a, s) => a + s.alt!, 0) / alts.length : null;
  const stdV = alts.length > 1 ? Math.sqrt(alts.reduce((a, s) => a + (s.alt! - alt!) ** 2, 0) / (alts.length - 1)) : alts.length ? 0 : null;
  const seps = eps.filter((s) => s.sep !== null);
  const sep = seps.length ? seps.reduce((a, s) => a + s.sep!, 0) / seps.length : null;
  const last = eps[n - 1];
  const worst: FixQuality[] = ['none', 'gps', 'dgps', 'float', 'fix'];
  const quality = eps.reduce<FixQuality>((a, s) => (worst.indexOf(s.quality) < worst.indexOf(a) ? s.quality : a), 'fix');
  const accs = eps.map((s) => s.accH).filter((a): a is number => a !== null);
  return {
    lat, lng, alt, sep, n, stdH, stdV, quality, estimated: last.estimated,
    accH: accs.length ? Math.max(...accs) : null, accV: last.accV, sats: last.sats, time: Date.now(),
  };
}
