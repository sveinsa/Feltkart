// Mellomlagring av målingene. Den aktive målingen (den som tegnes akkurat nå) lagres hver gang et punkt settes, angres eller
// målingen avsluttes. Når en ny måling starter flyttes den forrige (ferdige) til historikken, slik at man kan måle flere
// arealer ved siden av hverandre. Alt bor i nettleseren til brukeren trykker «Nullstill alle».
// Kartet og Terreng 3D deler de samme målingene.
import type { MeasureMode } from './measure';

// Samme regel som scopedKey() i projects.ts (holdt her så denne filen ikke trenger andre moduler, og kan testes direkte i Node)
function scopedKey(base: string): string {
  try {
    const a = JSON.parse(window.localStorage.getItem('feltkart.projects.v1') ?? 'null')?.active;
    return typeof a === 'string' && a !== 'default' && /^[a-z0-9_-]{1,24}$/i.test(a) ? `${base}.${a}` : base;
  } catch { return base; }
}
// Målingene lagres per prosjekt (det første prosjektet bruker de samme nøklene som før)
const BASE_KEY = 'feltkart.measure.v1';
const BASE_HIST_KEY = 'feltkart.measure.history.v1';
const KEY_ = () => scopedKey(BASE_KEY);
const HIST_KEY_ = () => scopedKey(BASE_HIST_KEY);
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
  /** Hver måling har en egen id og farge (id mangler på målinger lagret av eldre versjoner) */
  id?: string;
  color?: string;
  mode: MeasureMode;
  pts: StoredPoint[];
  finished: boolean;
  savedAt: number;
}

/** En ferdig måling i historikken */
export interface HistoryItem {
  id: string;
  color: string;
  mode: MeasureMode;
  pts: StoredPoint[];
  savedAt: number;
}

/** Fargene målingene får etter tur. Den første er den oransje vi alltid har brukt. */
export const MEASURE_COLORS = ['#ef6c1a', '#1e88e5', '#d81b60', '#7cb342', '#8e24aa', '#00acc1', '#f9a825', '#6d4c41'];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Første farge som ikke er i bruk; når alle er i bruk går det rundt i paletten */
export function pickColor(used: string[]): string {
  const set = new Set(used.map((c) => c.toLowerCase()));
  for (const c of MEASURE_COLORS) if (!set.has(c)) return c;
  return MEASURE_COLORS[used.length % MEASURE_COLORS.length];
}

let idSeq = 0;
export function newMeasureId(): string {
  idSeq += 1;
  return `m${Date.now().toString(36)}${idSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// Reserve hvis nettleserlagringen er sperret (privat modus e.l.): da holder målingen seg i alle fall mens siden er åpen
let memory: string | null = null;
let memoryHist: string | null = null;
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
  const out: StoredMeasure = { v: 1, mode: r.mode, pts, finished: r.finished === true && pts.length >= (r.mode === 'area' ? 3 : 2), savedAt: num(r.savedAt) ? r.savedAt : 0 };
  if (typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64) out.id = r.id;
  if (typeof r.color === 'string' && COLOR_RE.test(r.color)) out.color = r.color;
  return out;
}

export function loadMeasure(): StoredMeasure | null {
  let text: string | null = null;
  try { text = window.localStorage.getItem(KEY_()); } catch { text = memory; }
  if (text === null) text = memory;
  if (!text) return null;
  try {
    const m = sanitizeMeasure(JSON.parse(text));
    return m && m.pts.length ? m : null;
  } catch {
    return null;
  }
}

const cleanPoints = (pts: StoredPoint[]): StoredPoint[] => pts.map((p) => {
  const o: StoredPoint = { lat: p.lat, lng: p.lng, z: num(p.z) ? p.z : null };
  if (p.fix && o.z !== null) o.fix = true;
  return o;
});

function writeActive(m: { mode: MeasureMode; pts: StoredPoint[]; finished: boolean; id?: string; color?: string } | null): void {
  if (!m || !m.pts.length) {
    memory = null;
    try { window.localStorage.removeItem(KEY_()); } catch { /* ignorer */ }
    return;
  }
  const rec: StoredMeasure = { v: 1, mode: m.mode, finished: m.finished, savedAt: Date.now(), pts: cleanPoints(m.pts) };
  if (m.id) rec.id = m.id;
  if (m.color && COLOR_RE.test(m.color)) rec.color = m.color;
  const text = JSON.stringify(rec);
  memory = text;
  try { window.localStorage.setItem(KEY_(), text); } catch { /* full eller sperret: reserven i minnet brukes */ }
}

/** Lagrer den aktive målingen (historikken røres ikke). Uten punkter fjernes den lagrede aktive målingen. */
export function saveMeasure(m: { mode: MeasureMode; pts: StoredPoint[]; finished: boolean; id?: string; color?: string } | null, source?: string): void {
  writeActive(m);
  notify(source);
}

/** Fjerner den aktive målingen (historikken røres ikke) */
export function clearStoredMeasure(source?: string): void {
  writeActive(null);
  notify(source);
}

function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.items)) return [];
  const out: HistoryItem[] = [];
  const seen = new Set<string>();
  for (const it of r.items.slice(0, 200)) {
    const m = sanitizeMeasure({ ...(it as object), v: 1, finished: true });
    const q = it as Record<string, unknown> | null;
    if (!m || !m.finished || !m.pts.length) continue; // ødelagt eller ikke ferdig: hopp over
    let id = m.id ?? '';
    if (!id || seen.has(id)) id = newMeasureId();
    seen.add(id);
    const color = m.color ?? (q && typeof q.color === 'string' && COLOR_RE.test(q.color) ? q.color : pickColor(out.map((o) => o.color)));
    out.push({ id, color, mode: m.mode, pts: m.pts, savedAt: m.savedAt });
  }
  return out;
}

export function loadHistory(): HistoryItem[] {
  let text: string | null = null;
  try { text = window.localStorage.getItem(HIST_KEY_()); } catch { text = memoryHist; }
  if (text === null) text = memoryHist;
  if (!text) return [];
  try { return sanitizeHistory(JSON.parse(text)); } catch { return []; }
}

function writeHistory(items: { id: string; color: string; mode: MeasureMode; pts: StoredPoint[] }[]): void {
  if (!items.length) {
    memoryHist = null;
    try { window.localStorage.removeItem(HIST_KEY_()); } catch { /* ignorer */ }
    return;
  }
  const rec = { v: 1, items: items.map((i) => ({ id: i.id, color: i.color, mode: i.mode, finished: true, savedAt: Date.now(), pts: cleanPoints(i.pts) })) };
  const text = JSON.stringify(rec);
  memoryHist = text;
  try { window.localStorage.setItem(HIST_KEY_(), text); } catch { /* ignorer */ }
}

/** Alle målingene: den aktive (kan være ferdig eller under arbeid) og de ferdige i historikken */
export function loadMeasures(): { active: StoredMeasure | null; history: HistoryItem[] } {
  return { active: loadMeasure(), history: loadHistory() };
}

/** Lagrer aktiv måling og historikk i ett grep (én melding til den andre visningen) */
export function saveMeasures(
  active: { mode: MeasureMode; pts: StoredPoint[]; finished: boolean; id?: string; color?: string } | null,
  history: { id: string; color: string; mode: MeasureMode; pts: StoredPoint[] }[],
  source?: string,
): void {
  writeActive(active);
  writeHistory(history);
  notify(source);
}

/** «Nullstill alle»: fjerner den aktive målingen og hele historikken, også de lagrede kopiene */
export function clearAllMeasures(source?: string): void {
  writeActive(null);
  writeHistory([]);
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
