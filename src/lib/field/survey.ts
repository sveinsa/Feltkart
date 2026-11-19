// Innmåling i felt: punkter med RTK-posisjon, stanghøyde og kode, lagret midlertidig i telefonen og skrevet som KOF/CSV.
import { fromLatLng } from '../crs';
import type { Averaged, GnssState } from './gnss';
import { QUALITY_LABEL, type FixQuality } from './nmea';

export interface FieldSettings {
  /** Stanghøyde: fra bakken/merket opp til antennen (m). Trekkes fra høyden mottakeren oppgir, så punktet får høyden på bakken. */
  poleHeight: number;
  /** Sekunder med gjennomsnitt per punkt (0 = ett enkelt øyeblikk) */
  avgSeconds: number;
  /** Krev RTK Fix for å lagre punkt */
  requireFix: boolean;
  /** Største tillatte horisontale usikkerhet (m) når den er kjent */
  maxAccH: number;
  /** 'device' = høyde slik enheten oppgir den (normalt over geoiden), 'ellipsoid' = ellipsoidehøyde (høyde + geoidehøyde, kun direkte Bluetooth) */
  heightMode: 'device' | 'ellipsoid';
  prefix: string;
  next: number;
  /** Hurtigkoder, én per linje */
  codes: string;
  code: string;
  source: 'android' | 'intern' | 'bt';
  btAddress: string;
  btName: string;
  /** Koordinatsystem for visning og eksport av punkter. Tom = prosjektets system. */
  exportCrs: string;
  exportFormat: 'kof' | 'sosi' | 'landxml' | 'csv';
  /** Høydesystem / geoidemodell som mottakeren leverer høyde i. Vises bare som informasjon i statusfeltet. */
  vdatum: 'NN2000' | 'NN54' | 'Annen';
  /** Spill en liten lyd (pling) når et punkt er registrert */
  sound: boolean;
  /** Utsetting: fremme når du er nærmere enn dette (m) */
  stakeTol: number;
  /** Hvem som måler. Lagres på hvert punkt (navn eller e-post). */
  user: string;
}

export const DEFAULT_FIELD: FieldSettings = {
  poleHeight: 2, avgSeconds: 3, requireFix: true, maxAccH: 0.05, heightMode: 'device', prefix: 'P', next: 1,
  codes: 'TERRENG\nKANT\nKUM\nSLUK\nROR\nMAST', code: '', source: 'android', btAddress: '', btName: '',
  exportCrs: '', exportFormat: 'kof', vdatum: 'NN2000', sound: true, stakeTol: 0.05, user: '',
};

const SKEY = 'feltkart.field.settings';
const PKEY = 'feltkart.field.points';

export function loadFieldSettings(): FieldSettings {
  try { return { ...DEFAULT_FIELD, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...DEFAULT_FIELD }; }
}
export function saveFieldSettings(s: FieldSettings) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignorer */ } }

export interface FieldPoint {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  /** Koordinater i prosjektets system */
  e: number;
  n: number;
  /** Høyde (m) etter at stanghøyde er trukket fra. null hvis enheten ikke oppgir høyde. */
  h: number | null;
  poleHeight: number;
  heightMode: 'device' | 'ellipsoid';
  quality: FixQuality;
  estimated: boolean;
  accH: number | null;
  accV: number | null;
  stdH: number;
  n_epochs: number;
  sats: number | null;
  /** DOP-verdier (gjennomsnitt) når mottakeren oppgir dem (direkte Bluetooth) */
  pdop?: number | null;
  hdop?: number | null;
  vdop?: number | null;
  /** Hvem som målte punktet */
  user?: string;
  time: string; // ISO
  crs: string;
  /** Lagt inn i prosjektet som KOF-element (Innmålinger) */
  saved?: boolean;
}

/** Det eksportfunksjonene trenger. Målte punkter (FieldPoint) og punkter lest fra filer i prosjektet passer begge. */
export type ExportPoint = Pick<FieldPoint, 'name' | 'code' | 'lat' | 'lng' | 'e' | 'n' | 'h' | 'time' | 'crs'>
  & Partial<Pick<FieldPoint, 'poleHeight' | 'quality' | 'estimated' | 'accH' | 'n_epochs' | 'pdop' | 'hdop' | 'vdop' | 'user'>>;

export function loadPoints(): FieldPoint[] {
  try { const p = JSON.parse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}
export const POINTS_EVENT = 'feltkart:points';
export function savePoints(p: FieldPoint[]) {
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* ignorer */ }
  // Gir beskjed til resten av appen (f.eks. det lille kartet i Felt) om at punktlisten er endret
  try { window.dispatchEvent(new Event(POINTS_EVENT)); } catch { /* ignorer */ }
}

export const POLE_MAX = 10;
/** Runder til mm og holder verdien mellom 0 og 10 m */
export const cleanPole = (v: number) => Math.min(POLE_MAX, Math.max(0, Math.round(v * 1000) / 1000));

/**
 * Høyde ved antennen slik mottakeren oppgir den (evt. omregnet til ellipsoidehøyde), og høyden på bakken/merket under stangen.
 * Stanghøyden er avstanden fra bakken opp til antennen, og trekkes fra antennehøyden.
 */
export function groundHeight(alt: number | null, sep: number | null, s: Pick<FieldSettings, 'poleHeight' | 'heightMode'>): { antenna: number | null; ground: number | null } {
  if (alt === null) return { antenna: null, ground: null };
  const antenna = s.heightMode === 'ellipsoid' && sep !== null ? alt + sep : alt;
  return { antenna, ground: antenna - s.poleHeight };
}

export type Verdict = { ok: boolean; reason: string };

/** Kan vi lagre et punkt nå? Gir en forklaring på norsk når svaret er nei. */
export function canMeasure(g: Pick<GnssState, 'lat' | 'lng' | 'quality' | 'accH' | 'connected' | 'updated'>, s: Pick<FieldSettings, 'requireFix' | 'maxAccH'>, now = Date.now()): Verdict {
  if (!g.connected || g.lat === null || g.lng === null) return { ok: false, reason: 'Ingen posisjon. Koble til GNSS-mottakeren først.' };
  if (now - g.updated > 5000) return { ok: false, reason: 'Posisjonen er gammel (over 5 sekunder). Sjekk forbindelsen.' };
  if (s.requireFix && g.quality !== 'fix') return { ok: false, reason: `${QUALITY_LABEL[g.quality]} – du har valgt å kreve RTK Fix.` };
  if (g.accH !== null && g.accH > s.maxAccH) return { ok: false, reason: `Usikkerheten er ±${(g.accH * 100).toFixed(1).replace('.', ',')} cm, grensen er ${(s.maxAccH * 100).toFixed(0)} cm.` };
  return { ok: true, reason: '' };
}

const dop = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);

export function makePoint(avg: Averaged, s: FieldSettings, crs: string, name: string, code: string, id: string): FieldPoint {
  const [e, n] = fromLatLng(crs, avg.lat, avg.lng);
  const h = groundHeight(avg.alt, avg.sep, s).ground;
  return {
    id, name, code, lat: avg.lat, lng: avg.lng, e, n, h, poleHeight: s.poleHeight, heightMode: s.heightMode, quality: avg.quality, estimated: avg.estimated,
    accH: avg.accH, accV: avg.accV, stdH: avg.stdH, n_epochs: avg.n, sats: avg.sats,
    pdop: dop(avg.pdop), hdop: dop(avg.hdop), vdop: dop(avg.vdop), user: s.user.trim() || undefined, time: new Date(avg.time).toISOString(), crs,
  };
}

export const safe = (t: string) => t.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.\-+]/gu, '') || 'X';

/** Punktets koordinater (øst, nord) i ønsket system. Regnes om fra bredde/lengde, så punktene kan eksporteres i hvilket som helst system. */
export function pointEN(p: Pick<FieldPoint, 'lat' | 'lng' | 'e' | 'n' | 'crs'>, crs?: string): [number, number] {
  if (!crs || crs === p.crs) return [p.e, p.n];
  return fromLatLng(crs, p.lat, p.lng);
}

/** KOF: «-05 punkt kode nord øst høyde». Filen kan leses av Feltkart og av vanlig anleggs-/oppmålingsprogramvare. */
export function toKof(points: ExportPoint[], crs?: string): string {
  return points.map((p) => {
    const [e, n] = pointEN(p, crs);
    const parts = ['-05', safe(p.name)];
    const code = safe(p.code);
    if (p.code.trim()) parts.push(code);
    parts.push(n.toFixed(3), e.toFixed(3));
    if (p.h !== null) parts.push(p.h.toFixed(3));
    return parts.join(' ');
  }).join('\n') + '\n';
}

export function toCsv(points: ExportPoint[], crs?: string): string {
  const head = 'Punkt;Kode;Ost;Nord;Hoyde;Kvalitet;Usikkerhet_H_m;Epoker;Stanghoyde;PDOP;HDOP;VDOP;Bruker;Tid;System';
  const f = (v: number | null, d: number) => (v === null ? '' : v.toFixed(d).replace('.', ','));
  const rows = points.map((p) => {
    const [e, n] = pointEN(p, crs);
    return [p.name, p.code, f(e, 3), f(n, 3), f(p.h, 3), p.quality ? QUALITY_LABEL[p.quality] + (p.estimated ? ' (anslått)' : '') : '', f(p.accH ?? null, 3), p.n_epochs === undefined ? '' : String(p.n_epochs), f(p.poleHeight ?? null, 3), f(p.pdop ?? null, 2), f(p.hdop ?? null, 2), f(p.vdop ?? null, 2), (p.user ?? '').replace(/[;\r\n]+/g, ' '), p.time, crs || p.crs].join(';');
  });
  return '\ufeff' + [head, ...rows].join('\r\n') + '\r\n';
}

// ---------- Sortering og utvalg ----------
export type SortKey = 'time' | 'code' | 'name' | 'h';
export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

/** Sorterer etter valgt kolonne. Likt resultat avgjøres av dato og så punktnavn, slik at rekkefølgen er stabil. */
export function sortPoints(points: FieldPoint[], key: SortKey, dir: SortDir = 'asc'): FieldPoint[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byTime = (a: FieldPoint, b: FieldPoint) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  const primary = (a: FieldPoint, b: FieldPoint): number => {
    switch (key) {
      case 'time': return byTime(a, b);
      case 'code': {
        // Punkter uten kode samles sist uansett retning på resten
        if (!a.code && b.code) return 2;
        if (a.code && !b.code) return -2;
        return naturalCompare(a.code, b.code);
      }
      case 'name': return naturalCompare(a.name, b.name);
      case 'h': return (a.h ?? Infinity) === (b.h ?? Infinity) ? 0 : (a.h ?? Infinity) < (b.h ?? Infinity) ? -1 : 1;
    }
  };
  return [...points].sort((a, b) => {
    const c = primary(a, b);
    if (c === 2 || c === -2) return c / 2; // uten kode: alltid sist
    if (c) return c * sign;
    return byTime(a, b) || naturalCompare(a.name, b.name);
  });
}

export interface PointFilter {
  /** null = alle, '' = uten kode */
  code?: string | null;
  /** Dato (ÅÅÅÅ-MM-DD, lokal tid), begge grenser er med */
  from?: string;
  to?: string;
}

/** Lokal dato (ÅÅÅÅ-MM-DD) for et ISO-tidspunkt */
export const localDate = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function filterPoints(points: FieldPoint[], f: PointFilter): FieldPoint[] {
  return points.filter((p) => {
    if (f.code !== undefined && f.code !== null && p.code !== f.code) return false;
    const d = localDate(p.time);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  });
}

/** Koder som finnes, med antall punkter (alfabetisk, «uten kode» sist) */
export function codeStats(points: FieldPoint[]): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(p.code, (m.get(p.code) ?? 0) + 1);
  return [...m.entries()].map(([code, count]) => ({ code, count }))
    .sort((a, b) => (!a.code ? 1 : !b.code ? -1 : naturalCompare(a.code, b.code)));
}

/** «18.11.2026 14:32» i lokal tid */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Neste punktnavn: prefiks + løpenummer, hopper over navn som finnes */
export function nextName(s: Pick<FieldSettings, 'prefix' | 'next'>, existing: FieldPoint[]): { name: string; next: number } {
  const used = new Set(existing.map((p) => p.name));
  let n = Math.max(1, s.next);
  while (used.has(`${s.prefix}${n}`)) n++;
  return { name: `${s.prefix}${n}`, next: n + 1 };
}

export const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
