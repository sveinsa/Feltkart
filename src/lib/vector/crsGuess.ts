// Gjetter koordinatsystem for filer som ikke oppgir det selv (DXF og KOF).
// Prøver UTM 31–36 og NTM-soner og velger systemet som plasserer dataene i Norge, helst nærmest det som allerede ligger i kartet.
import { ensureCrs, fromLatLng, toLatLng } from '../crs';
import type { ParsedDxf } from '../dxf';

const CANDIDATES = ['EPSG:25832', 'EPSG:25833', 'EPSG:25835', 'EPSG:25831', 'EPSG:25834', 'EPSG:25836', ...Array.from({ length: 26 }, (_, i) => `EPSG:${5105 + i}`)];

const inNorway = (lat: number, lng: number) => lat >= 57.5 && lat <= 71.5 && lng >= 4 && lng <= 31.5;

function km(a: [number, number], b: [number, number]) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Rå (øst, nord) for et utvalg av objektene, regnet tilbake fra kartposisjonene i systemet filen ble lest i. */
function rawSample(r: ParsedDxf, crs: string): [number, number] | null {
  const pts: [number, number][] = [];
  const step = Math.max(1, Math.floor(r.features.length / 300));
  for (let i = 0; i < r.features.length; i += step) {
    const p = r.features[i].latlngs?.[0];
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(fromLatLng(crs, p[0], p[1]));
  }
  if (!pts.length) return null;
  return [median(pts.map((p) => p[0])), median(pts.map((p) => p[1]))];
}

/**
 * Returnerer koordinatsystemet som bør brukes, eller `current` hvis det allerede passer.
 * @param reference [lat, lng] for innhold som allerede er i kartet (bilder/ortofoto), hvis noe
 */
export function guessCrs(r: ParsedDxf, current: string, reference: [number, number] | null): string {
  if (current === 'EPSG:4326') return current;
  const raw = rawSample(r, current);
  if (!raw) return current;
  const place = (crs: string): [number, number] | null => {
    if (!ensureCrs(crs)) return null;
    try { const ll = toLatLng(crs, raw[0], raw[1]); return Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null; } catch { return null; }
  };
  const cur = place(current);
  const curOk = !!cur && inNorway(cur[0], cur[1]) && (!reference || km(cur, reference) < 50);
  if (curOk) return current;
  let best: { crs: string; d: number } | null = null;
  for (const c of CANDIDATES) {
    const ll = place(c);
    if (!ll || !inNorway(ll[0], ll[1])) continue;
    const d = reference ? km(ll, reference) : 0;
    if (!best || d < best.d) best = { crs: c, d };
  }
  if (!best) return current;
  if (reference && best.d > 50) return cur && inNorway(cur[0], cur[1]) ? current : best.crs; // ingenting passer med det som er i kartet
  return best.crs;
}
