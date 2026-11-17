// Rene målefunksjoner uten avhengigheter. Brukes av både kartet (2D) og Terreng 3D.
// Koordinatene er meter i et projisert koordinatsystem (x = øst, y = nord, z = høyde over havet).

export interface MPt {
  x: number;
  y: number;
  /** Høyde over havet i meter, hvis den er kjent (bare i 3D). */
  z?: number | null;
}

export type MeasureMode = 'distance' | 'area';

export interface Summary {
  mode: MeasureMode;
  /** Antall punkter satt ut */
  count: number;
  /** Horisontal lengde per delstrekning. For areal ligger lukkelinjen (siste → første) sist når det er ≥ 3 punkter. */
  segments: number[];
  /** Skrå lengde (3D) per delstrekning – bare når alle punkter har høyde */
  segments3d: number[] | null;
  /** Sum av delstrekningene: lengde (avstand) eller omkrets (areal) */
  horizontal: number;
  /** Sum av skrå lengder */
  slope: number | null;
  /** Høydeforskjell fra første til siste punkt (avstand) */
  dz: number | null;
  /** Stigning i prosent – bare for avstand med to punkter */
  gradient: number | null;
  /** Areal i horisontalplanet (kartareal), bare for areal med ≥ 3 punkter */
  area: number | null;
  /** Polygonet krysser seg selv – arealet er da ikke til å stole på */
  selfIntersects: boolean;
  /** Tyngdepunkt for polygon (til plassering av etikett) */
  centroid: { x: number; y: number } | null;
}

export interface Row {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  /** Fremhevet høydeforskjell (Δh) */
  dh?: boolean;
}

const hasZ = (p: MPt): p is MPt & { z: number } => typeof p.z === 'number' && Number.isFinite(p.z);

/** Vandrelengde langs en åpen linje (horisontalt). */
export function pathLength(pts: MPt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

/** Areal av en lukket ring (skoleføtter / «shoelace»). Alltid positivt. Regner relativt til første punkt for å unngå avrundingsfeil med store UTM-koordinater. */
export function ringArea(pts: MPt[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  const ox = pts[0].x, oy = pts[0].y;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x - ox, yi = pts[i].y - oy;
    const xj = pts[j].x - ox, yj = pts[j].y - oy;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a / 2);
}

export function ringCentroid(pts: MPt[]): { x: number; y: number } | null {
  const n = pts.length;
  if (n === 0) return null;
  const ox = pts[0].x, oy = pts[0].y;
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x - ox, yi = pts[i].y - oy;
    const xj = pts[j].x - ox, yj = pts[j].y - oy;
    const f = xj * yi - xi * yj;
    a2 += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (Math.abs(a2) < 1e-9) {
    // Degenerert (alle punkter på en linje) – bruk gjennomsnittet
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / n, y: sy / n };
  }
  return { x: ox + cx / (3 * a2), y: oy + cy / (3 * a2) };
}

function properCross(p1: MPt, p2: MPt, p3: MPt, p4: MPt): boolean {
  const o = (a: MPt, b: MPt, c: MPt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Krysser noen av sidene i den lukkede ringen hverandre? */
export function ringSelfIntersects(pts: MPt[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Hopp over nabosider (de deler et hjørne)
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (properCross(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function summarize(mode: MeasureMode, pts: MPt[]): Summary {
  const n = pts.length;
  const closed = mode === 'area' && n >= 3;
  const allZ = n > 0 && pts.every(hasZ);
  const segs: number[] = [];
  const segs3: number[] = [];
  const m = closed ? n : Math.max(0, n - 1);
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const h = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push(h);
    if (allZ) segs3.push(Math.hypot(h, (b.z as number) - (a.z as number)));
  }
  const horizontal = segs.reduce((s, v) => s + v, 0);
  const slope = allZ && segs3.length ? segs3.reduce((s, v) => s + v, 0) : null;
  const dz = mode === 'distance' && allZ && n >= 2 ? (pts[n - 1].z as number) - (pts[0].z as number) : null;
  const gradient = dz !== null && n === 2 && horizontal > 0 ? (dz / horizontal) * 100 : null;
  const area = closed ? ringArea(pts) : null;
  return {
    mode,
    count: n,
    segments: segs,
    segments3d: allZ ? segs3 : null,
    horizontal,
    slope,
    dz,
    gradient,
    area,
    selfIntersects: closed ? ringSelfIntersects(pts) : false,
    centroid: closed ? ringCentroid(pts) : null,
  };
}

// ---------- Formatering (norsk) ----------

const nf0 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** «1 234,56 m» */
export function formatLength(m: number): string {
  return Number.isFinite(m) ? `${nf2.format(m)} m` : '–';
}

/** «1,235 km» – bare for lengder fra 1 km, ellers tom streng */
export function formatKm(m: number): string {
  return Number.isFinite(m) && m >= 1000 ? `${nf3.format(m / 1000)} km` : '';
}

/** Kort form til etiketter i kartet: «12,34 m», «123,4 m», «1,235 km» */
export function formatLengthShort(m: number): string {
  if (!Number.isFinite(m)) return '–';
  if (m >= 999.95) return `${nf3.format(m / 1000)} km`;
  if (m >= 100) return `${nf1.format(m)} m`;
  return `${nf2.format(m)} m`;
}

/** «1 234,56 m²» */
export function formatArea(m2: number): string {
  return Number.isFinite(m2) ? `${nf2.format(m2)} m²` : '–';
}

/** Dekar og hektar fra 1 000 m² (1 daa = 1 000 m², 1 ha = 10 000 m²), ellers tom streng */
export function formatAreaAlt(m2: number): string {
  if (!Number.isFinite(m2) || m2 < 1000) return '';
  return `${nf2.format(m2 / 1000)} daa · ${nf2.format(m2 / 10000)} ha`;
}

/** Kort form til etiketter i kartet: «123,4 m²», «1 234 m²» */
export function formatAreaShort(m2: number): string {
  if (!Number.isFinite(m2)) return '–';
  return m2 >= 999.95 ? `${nf0.format(m2)} m²` : `${nf1.format(m2)} m²`;
}

/** «+1,23 m» / «−1,23 m» */
export function formatDz(dz: number): string {
  if (!Number.isFinite(dz)) return '–';
  const s = nf2.format(Math.abs(dz));
  if (Math.abs(dz) < 0.005) return `${s} m`;
  return `${dz > 0 ? '+' : '−'}${s} m`;
}

/** «12,3 %» (med fortegn) */
export function formatPct(p: number): string {
  if (!Number.isFinite(p)) return '–';
  if (Math.abs(p) < 0.05) return `${nf1.format(0)} %`;
  return `${p > 0 ? '+' : '−'}${nf1.format(Math.abs(p))} %`;
}

/** Radene som vises i resultatpanelet */
export function summaryRows(s: Summary): Row[] {
  const rows: Row[] = [];
  if (s.mode === 'distance') {
    if (s.count < 2) return rows;
    const withHeight = s.slope !== null;
    rows.push({ label: withHeight ? 'Horisontal lengde' : 'Lengde', value: formatLength(s.horizontal), sub: formatKm(s.horizontal) || undefined, strong: true });
    if (s.slope !== null) rows.push({ label: 'Skrå lengde', value: formatLength(s.slope), sub: formatKm(s.slope) || undefined });
    if (s.dz !== null) rows.push({ label: 'Høydeforskjell (Δh)', value: formatDz(s.dz), sub: 'siste mot første punkt', dh: true });
    if (s.gradient !== null) rows.push({ label: 'Stigning / fall', value: formatPct(s.gradient), dh: true });
    else if (s.dz !== null && s.horizontal > 0) rows.push({ label: 'Snitt stigning / fall', value: formatPct((s.dz / s.horizontal) * 100), sub: 'Δh delt på horisontal lengde', dh: true });
    return rows;
  }
  if (s.count === 2) {
    rows.push({ label: 'Lengde så langt', value: formatLength(s.horizontal) });
    return rows;
  }
  if (s.count >= 3 && s.area !== null) {
    rows.push({ label: 'Areal', value: formatArea(s.area), sub: formatAreaAlt(s.area) || undefined, strong: true });
    rows.push({ label: 'Omkrets', value: formatLength(s.horizontal), sub: formatKm(s.horizontal) || undefined });
  }
  return rows;
}

/** Ren tekst som kan limes inn i et notat eller en e-post */
export function summaryText(s: Summary, crsLabel?: string): string {
  const head = s.mode === 'distance' ? 'Avstandsmåling' : 'Arealmåling';
  const lines = [head];
  for (const r of summaryRows(s)) lines.push(`${r.label}: ${r.value}${r.sub ? ` (${r.sub})` : ''}`);
  if (s.segments.length > 1) {
    lines.push('Delstrekninger: ' + s.segments.map((v, i) => `${i + 1}: ${formatLength(v)}`).join(' · '));
  }
  lines.push(`Antall punkter: ${s.count}`);
  if (s.selfIntersects) lines.push('Obs: polygonet krysser seg selv – arealet kan bli feil.');
  if (crsLabel) lines.push(`Koordinatsystem: ${crsLabel}`);
  return lines.join('\n');
}

// ---------- Dobbeltklikk ----------

/** Et klikk eller trykk i kartet: når og hvor (skjermpiksler). */
export interface ClickMemo {
  t: number;
  x: number;
  y: number;
  /** Trykk med finger: større toleranse for hvor nær det andre trykket må være */
  touch?: boolean;
}

/** Lengste tid mellom to klikk som regnes som ett dobbeltklikk (ms). Vanlige dobbeltklikk og dobbelttrykk ligger på 100–300 ms. */
export const DOUBLE_CLICK_MS = 400;

/**
 * Er dette klikket andre halvdel av et dobbeltklikk eller dobbelttrykk?
 * Nettlesere og kartbibliotek sender klikk og «dblclick» i ulik rekkefølge (og på mobil og nettbrett ofte ikke «dblclick» i det hele tatt),
 * så vi avgjør det selv ut fra tid og avstand mellom to klikk. Andre halvdel skal aldri bli et nytt punkt: den avslutter målingen.
 */
export function isDoubleClick(prev: ClickMemo | null | undefined, cur: ClickMemo): boolean {
  if (!prev) return false;
  const dt = cur.t - prev.t;
  if (!(dt >= 0 && dt <= DOUBLE_CLICK_MS)) return false;
  const tol = cur.touch || prev.touch ? 24 : 8;
  return Math.hypot(cur.x - prev.x, cur.y - prev.y) <= tol;
}

/** Kom klikket fra en finger? (PointerEvent.pointerType, ellers om hovedpekeren er «grov», som på mobil og nettbrett) */
export function isTouchEvent(ev: unknown): boolean {
  const e = ev as { pointerType?: string; sourceCapabilities?: { firesTouchEvents?: boolean } } | null | undefined;
  if (e?.pointerType) return e.pointerType === 'touch';
  if (typeof e?.sourceCapabilities?.firesTouchEvents === 'boolean') return e.sourceCapabilities.firesTouchEvents;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

// ---------- Historikk: flere målinger i samme visning ----------

/** En linje i målelisten (en måling med farge og verdi) */
export interface HistoryRow {
  id: string;
  color: string;
  mode: MeasureMode;
  /** Ferdig formatert, f.eks. «136 257,44 m²» eller «214,3 m» */
  value: string;
  /** Areal i m² (bare ferdige arealmålinger) */
  area: number | null;
  /** Høydeforskjell Δh i m, siste mot første punkt (bare avstandsmålinger i 3D der alle punkter har høyde) */
  dz: number | null;
  /** Stigning (+) eller fall (−) i prosent: Δh delt på horisontal lengde */
  pct: number | null;
  /** Horisontal lengde i m (bare avstandsmålinger med minst to punkter) */
  length: number | null;
  /** Målingen som tegnes nå (resten er ferdige målinger i historikken) */
  active: boolean;
  finished: boolean;
}

export function historyRow(it: { id: string; color: string; mode: MeasureMode; active: boolean; finished: boolean }, s: Summary): HistoryRow {
  const pts = `${s.count} punkt${s.count === 1 ? '' : 'er'}`;
  const area = it.mode === 'area' && s.area !== null ? s.area : null;
  const length = it.mode === 'distance' && s.count >= 2 ? s.horizontal : null;
  const value = it.mode === 'area' ? (area !== null ? formatArea(area) : pts) : (length !== null ? formatLength(length) : pts);
  const dz = it.mode === 'distance' && s.dz !== null ? s.dz : null;
  const pct = dz !== null && s.horizontal > 0 ? (dz / s.horizontal) * 100 : null;
  return { id: it.id, color: it.color, mode: it.mode, value, area, dz, pct, length, active: it.active, finished: it.finished };
}

/** Sum av arealene og av lengdene i listen. Bare ferdige målinger regnes med, og summen vises først fra to målinger. */
export function historyTotals(rows: HistoryRow[]): { area: string | null; length: string | null; dz: string | null } {
  const a = rows.filter((r) => r.area !== null && r.finished);
  const l = rows.filter((r) => r.length !== null && r.finished);
  const d = rows.filter((r) => r.dz !== null && r.finished);
  return {
    dz: d.length >= 2 ? formatDz(d.reduce((x, r) => x + (r.dz as number), 0)) : null,
    area: a.length >= 2 ? formatArea(a.reduce((x, r) => x + (r.area as number), 0)) : null,
    length: l.length >= 2 ? formatLength(l.reduce((x, r) => x + (r.length as number), 0)) : null,
  };
}
