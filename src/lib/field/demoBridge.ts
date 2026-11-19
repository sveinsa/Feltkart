// Demo av Android-appen i nettleseren (siden «Android-app» på nettstedet, android-demo.html).
// Siden åpner Feltkart med ?demo=android. Da etterlikner denne filen Android-broen (FeltkartNative) og lager en simulert RTK-posisjon,
// slik at Felt-visningen kan prøves uten telefon og mottaker. Ingenting her brukes i den ekte appen, der broen finnes fra før.
import { nb } from './fmt';

const CENTER = { lat: 62.5945, lng: 9.6985 }; // ved Oppdal
const GEOID = 38.9; // geoidehøyde i meter (for NMEA-linjene)

let t0 = Date.now();

/** Simulert posisjon: går sakte rundt i en liten sløyfe. De første sekundene Single og Float, så Fix. */
export function samplePosition(now = Date.now()) {
  const e = (now - t0) / 1000;
  const a = now / 25000;
  const north = 5 * Math.sin(a * 1.3);
  const east = 7 * Math.cos(a);
  const q = e > 6 ? 4 : e > 3 ? 5 : 2; // GGA-kvalitet: 4 Fix, 5 Float, 2 DGPS
  const acc = q === 4 ? 0.012 + 0.005 * (0.5 + 0.5 * Math.sin(now / 2500)) : q === 5 ? 0.32 : 1.4;
  const lat = CENTER.lat + north / 111320;
  const lng = CENTER.lng + east / (111320 * Math.cos((CENTER.lat * Math.PI) / 180));
  const alt = 581.5 + 0.02 * Math.sin(now / 4000); // over geoiden (som mottakeren oppgir den)
  return { lat, lng, alt, ellipsoid: alt + GEOID, acc, accV: Math.round(acc * 1.6 * 1000) / 1000, q };
}

const checksum = (body: string) => {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, '0');
};
const sentence = (body: string) => `$${body}*${checksum(body)}\r\n`;
const ang = (v: number, degDigits: number) => {
  const a = Math.abs(v);
  const d = Math.floor(a);
  return String(d).padStart(degDigits, '0') + ((a - d) * 60).toFixed(6).padStart(9, '0');
};

/** NMEA-linjer (GGA og GST) for én epoke, som en ekte mottaker ville sendt dem */
export function nmeaEpoch(now = Date.now()): string {
  const p = samplePosition(now);
  const d = new Date(now);
  const hms = String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0') + '.00';
  const sats = p.q === 4 ? 22 : 17;
  const gga = sentence(`GPGGA,${hms},${ang(p.lat, 2)},N,${ang(p.lng, 3)},E,${p.q},${sats},0.6,${p.alt.toFixed(3)},M,${GEOID.toFixed(3)},M,${p.q >= 4 ? '1.0' : ''},0000`);
  const gst = sentence(`GPGST,${hms},${(p.acc / 2).toFixed(3)},0.0,0.0,0.0,${(p.acc / 1.4).toFixed(3)},${(p.acc / 1.4).toFixed(3)},${p.accV.toFixed(3)}`);
  return gga + gst;
}

/** Er siden åpnet som Android-demo (?demo=android)? Gjelder også etter at broen er satt opp. */
export const isDemoMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'android';

export const demoRequested = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'android' && !window.FeltkartNative;

function demoPhoto(): string {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  if (!g) return '';
  const grad = g.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, '#9ed0ff'); grad.addColorStop(0.55, '#dff1ff'); grad.addColorStop(0.55, '#8dc63f'); grad.addColorStop(1, '#3d7a2a');
  g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#0f5a3c'; g.font = 'bold 34px sans-serif'; g.fillText('Demobilde', 24, 60);
  g.font = '20px sans-serif'; g.fillText(new Date().toLocaleString('nb-NO'), 24, 92);
  return c.toDataURL('image/jpeg', 0.8);
}

/** Starter etterlikningen av Android-broen. Gir true hvis demoen ble slått på. */
export function installDemoBridge(): boolean {
  if (!demoRequested()) return false;
  const timers = new Map<string, number>();
  const stop = (k: string) => { const t = timers.get(k); if (t !== undefined) { window.clearInterval(t); timers.delete(k); } };
  const every = (k: string, ms: number, fn: () => void) => { stop(k); timers.set(k, window.setInterval(fn, ms)); };
  const event = (name: string, data: unknown) => window.__fkEvent?.(name, JSON.stringify(data));

  // «Android-posisjon» (navigator.geolocation) gir den simulerte posisjonen
  const geoCallbacks = new Map<number, number>();
  let geoSeq = 0;
  const toGeo = () => {
    const p = samplePosition();
    return { coords: { latitude: p.lat, longitude: p.lng, altitude: p.ellipsoid, accuracy: p.acc, altitudeAccuracy: p.accV, heading: null, speed: null }, timestamp: Date.now() };
  };
  const geo = {
    watchPosition(ok: (p: any) => void) {
      const id = ++geoSeq;
      t0 = Date.now();
      ok(toGeo());
      geoCallbacks.set(id, window.setInterval(() => ok(toGeo()), 1000));
      return id;
    },
    clearWatch(id: number) { const t = geoCallbacks.get(id); if (t !== undefined) { window.clearInterval(t); geoCallbacks.delete(id); } },
    getCurrentPosition(ok: (p: any) => void) { ok(toGeo()); },
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch { /* beholder den ekte */ }

  const reply = (id: number, ok: boolean, v: unknown) => window.setTimeout(() => window.__fkResult?.(id, ok, JSON.stringify(v)), 30);
  window.FeltkartNative = {
    call(method: string, args: string, id: number) {
      let a: any = {};
      try { a = JSON.parse(args || '{}'); } catch { /* tom */ }
      switch (method) {
        case 'btList': return reply(id, true, [{ name: 'FLX100 plus (demo)', address: 'DE:MO:00:00:00:01' }]);
        case 'btConnect':
          reply(id, true, {});
          window.setTimeout(() => event('btState', { state: 'connecting' }), 60);
          window.setTimeout(() => {
            t0 = Date.now();
            event('btState', { state: 'connected' });
            every('bt', 1000, () => event('nmea', { text: nmeaEpoch() }));
          }, 700);
          return;
        case 'btDisconnect': stop('bt'); return reply(id, true, {});
        case 'locStart':
          t0 = Date.now();
          reply(id, true, {});
          every('loc', 1000, () => { const p = samplePosition(); event('loc', { lat: p.lat, lng: p.lng, alt: p.ellipsoid, acc: p.acc, vacc: p.accV, provider: 'gps', mock: true }); });
          return;
        case 'locStop': stop('loc'); return reply(id, true, {});
        case 'takePhoto': return reply(id, true, { url: demoPhoto(), name: 'IMG_demo.jpg' });
        case 'saveFile': {
          try {
            const bin = atob(String(a.base64 || ''));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: String(a.mime || 'application/octet-stream') }));
            const el = document.createElement('a');
            el.href = url; el.download = String(a.name || 'fil');
            document.body.appendChild(el);
            el.dispatchEvent(new MouseEvent('click')); // ikke el.click(): den er fanget av nedlastingsfiksen for appen
            el.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 10000);
          } catch { /* ignorer */ }
          return reply(id, true, { where: 'nedlastingsmappen i nettleseren (demo)' });
        }
        case 'googleToken': return reply(id, false, 'Google-innlogging er ikke tilgjengelig i demoen. Installer appen for å bruke den.');
        case 'info': return reply(id, true, { sdk: 35, model: 'Demo' });
        default: return reply(id, true, {}); // keepAwake, openAppSettings, googleSignOut …
      }
    },
  };
  return true;
}

/** I demoen kobles «Android-posisjon» til av seg selv, så statuslinjen går fra rød til grønn uten at du trenger å gjøre noe */
export function autostartDemo() {
  void import('./gnss').then((m) => window.setTimeout(() => { void m.startGnss('android'); }, 1500));
}

// brukes bare for å vise formatet i feilsøking
export const demoInfo = () => `Simulert posisjon ved Oppdal (${nb(CENTER.lat, 4)}, ${nb(CENTER.lng, 4)})`;
