// Mellomlagring av målingen. Den lagres hver gang et punkt settes, angres eller målingen avsluttes,
// og bor i nettleseren til brukeren trykker «Nullstill». Kartet og Terreng 3D deler den samme målingen.
import type { MeasureMode } from './measure';

const KEY = 'feltkart.measure.v1';
const SNAP_KEY = 'feltkart.measure.snap';

export interface StoredPoint {
  lat: number;
  lng: number;
  /** Høyde over havet i meter (fra terrengmodellen eller fra et snappet IFC-punkt) */
  z: number | null;
  /** Høyden kommer fra et snappet objekt og skal ikke byttes ut med terrenghøyde */
  fix?: boolean;
}

export interface StoredMeasure {
  v: 1;
  mode: MeasureMode;
  pts: StoredPoint[];
  finished: boolean;
  savedAt: number;
}

// Reserve hvis nettleserlagringen er sperret (privat modus e.l.): da holder målingen seg i alle fall mens siden er åpen
let memory: string | null = null;
let memorySnap: boolean | null = null;

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Godtar bare gyldig lagret innhold, ellers null (ødelagt eller fra en annen versjon) */
export function sanitizeMeasure(raw: unknown): StoredMeasure | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (r.mode !== 'distance' && r.mode !== 'area') return null;
  if (!Array.isArray(r.pts)) return null;
  const pts: StoredPoint[] = [];
  for (const p of r.pts) {
    const q = p as Record<string, unknown> | null;
    if (!q || !num(q.lat) || !num(q.lng) || Math.abs(q.lat) > 90 || Math.abs(q.lng) > 180) return null;
    const pt: StoredPoint = { lat: q.lat, lng: q.lng, z: num(q.z) ? q.z : null };
    if (q.fix === true && pt.z !== null) pt.fix = true;
    pts.push(pt);
  }
  if (pts.length > 5000) return null;
  return { v: 1, mode: r.mode, pts, finished: r.finished === true && pts.length >= (r.mode === 'area' ? 3 : 2), savedAt: num(r.savedAt) ? r.savedAt : 0 };
}

export function loadMeasure(): StoredMeasure | null {
  let text: string | null = null;
  try { text = window.localStorage.getItem(KEY); } catch { text = memory; }
  if (text === null) text = memory;
  if (!text) return null;
  try {
    const m = sanitizeMeasure(JSON.parse(text));
    return m && m.pts.length ? m : null;
  } catch {
    return null;
  }
}

/** Lagrer målingen. Uten punkter fjernes den lagrede målingen. */
export function saveMeasure(m: { mode: MeasureMode; pts: StoredPoint[]; finished: boolean } | null, source?: string): void {
  if (!m || !m.pts.length) { clearStoredMeasure(source); return; }
  const rec: StoredMeasure = {
    v: 1,
    mode: m.mode,
    finished: m.finished,
    savedAt: Date.now(),
    pts: m.pts.map((p) => {
      const o: StoredPoint = { lat: p.lat, lng: p.lng, z: num(p.z) ? p.z : null };
      if (p.fix && o.z !== null) o.fix = true;
      return o;
    }),
  };
  const text = JSON.stringify(rec);
  memory = text;
  try { window.localStorage.setItem(KEY, text); } catch { /* full eller sperret: reserven i minnet brukes */ }
  notify(source);
}

export function clearStoredMeasure(source?: string): void {
  memory = null;
  try { window.localStorage.removeItem(KEY); } catch { /* ignorer */ }
  notify(source);
}

// ---------- Kart og Terreng 3D lever side om side og deler målingen ----------

const EVENT = 'feltkart:measure';

function notify(source?: string): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { source } })); } catch { /* ignorer */ }
}

/** Kalles når en annen del av appen (annen `source`) har endret den lagrede målingen. Gir en funksjon som avregistrerer. */
export function onMeasureChanged(me: string, cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = (e: Event) => { if ((e as CustomEvent).detail?.source !== me) cb(); };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// ---------- Snapping av/på ----------

export function loadSnap(): boolean {
  try {
    const v = window.localStorage.getItem(SNAP_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { return memorySnap ?? true; }
  return memorySnap ?? true;
}

export function saveSnap(on: boolean): void {
  memorySnap = on;
  try { window.localStorage.setItem(SNAP_KEY, on ? '1' : '0'); } catch { /* ignorer */ }
}
