// Innmåling-registeret: punkter fra KOF-, SOSI- og LandXML-filer i prosjektet som én tabell med filter, sortering og kolonner.
// Ren logikk uten React, slik at den kan testes alene.
import { fromLatLng } from '../crs';
import type { ParsedDxf } from '../dxf';
import { fmtTime, naturalCompare, type ExportPoint } from './survey';

/** Ett punkt slik det står i en innmålingsfil. Koordinatene (e, n) er i filens eget system (`crs`). */
export interface SurveyRow extends ExportPoint {
  /** Unik nøkkel: filens id + punktets plass i filen */
  key: string;
  itemId: string;
  fileName: string;
  folderId: string;
}

/** Rad slik den vises: x = nord og y = øst i valgt koordinatsystem (samme rekkefølge som i KOF) */
export interface ViewRow extends SurveyRow { x: number; y: number }

export type ColKey = 'punkt' | 'kode' | 'dato' | 'x' | 'y' | 'z' | 'fil';
export type ColKind = 'text' | 'set' | 'date' | 'num';

export const COLUMNS: { key: ColKey; label: string; kind: ColKind; wide?: boolean }[] = [
  { key: 'punkt', label: 'Punkt', kind: 'text' },
  { key: 'kode', label: 'Kode', kind: 'set' },
  { key: 'dato', label: 'Dato', kind: 'date' },
  { key: 'x', label: 'X (nord)', kind: 'num' },
  { key: 'y', label: 'Y (øst)', kind: 'num' },
  { key: 'z', label: 'Z (høyde)', kind: 'num' },
  { key: 'fil', label: 'Fil', kind: 'set', wide: true },
];
export const DEFAULT_COLS: ColKey[] = ['punkt', 'kode', 'dato', 'x', 'y', 'z', 'fil'];
export const colDef = (k: ColKey) => COLUMNS.find((c) => c.key === k)!;

/** Tidspunkt fra SOSI ..DATAFANGSTDATO (ååååmmdd eller ååååmmddttmmss). Gir null hvis det ikke kan tolkes. */
export function sosiDate(v: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec((v ?? '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Gjør kartobjektene i en innmålingsfil om til rader. Bare punkter tas med (tekstetiketter og linjer hoppes over).
 * Tidspunktet er punktets eget når filen oppgir det (SOSI, LandXML), ellers filens dato.
 */
export function rowsFromParsed(item: { id: string; name: string; folderId: string; crs: string; fileIso: string }, data: ParsedDxf): SurveyRow[] {
  const out: SurveyRow[] = [];
  data.features.forEach((f, i) => {
    if (f.geom !== 'point' || !f.latlngs.length) return;
    const [lat, lng] = f.latlngs[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const a = f.attrs ?? {};
    const [e, n] = fromLatLng(item.crs, lat, lng);
    const hAttr = a['Høyde'] !== undefined && a['Høyde'] !== '' ? parseFloat(a['Høyde']) : NaN;
    const z = f.z[0];
    const h = Number.isFinite(hAttr) ? hAttr : z ? z : null; // 0 betyr «ingen høyde» i lest data
    const time = sosiDate(a['DATAFANGSTDATO']) ?? (a['Tid'] && !Number.isNaN(Date.parse(a['Tid'])) ? new Date(a['Tid']).toISOString() : item.fileIso);
    out.push({
      key: `${item.id}:${i}`, itemId: item.id, fileName: item.name, folderId: item.folderId,
      name: a['Punkt'] ?? a['PUNKTNAVN'] ?? a['PUNKTID'] ?? '', code: a['Kode'] ?? a['KODE'] ?? '',
      lat, lng, e, n, h, time, crs: item.crs,
    });
  });
  return out;
}

/** Legger til koordinater i valgt system. Er systemet filens eget, brukes de lagrede verdiene uten omregning. */
export function toViewRows(rows: SurveyRow[], crs: string): ViewRow[] {
  return rows.map((r) => {
    const [e, n] = r.crs === crs ? [r.e, r.n] : fromLatLng(crs, r.lat, r.lng);
    return { ...r, x: n, y: e };
  });
}

// ---------- Filter ----------
export interface ColFilter {
  text?: string;
  /** Verdier som skal være med (kode: '' = uten kode) */
  set?: string[];
  /** Fra og til: tall, eller dato som ÅÅÅÅ-MM-DD */
  min?: string;
  max?: string;
}
export type Filters = Partial<Record<ColKey, ColFilter>>;

export const isActive = (f: ColFilter | undefined): boolean =>
  !!f && (!!f.text?.trim() || !!f.set?.length || !!f.min?.trim() || !!f.max?.trim());

export const activeFilters = (f: Filters): ColKey[] => (Object.keys(f) as ColKey[]).filter((k) => isActive(f[k]));

const num = (v: string) => { const n = parseFloat(v.trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** Lokal dato (ÅÅÅÅ-MM-DD) for et ISO-tidspunkt */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «16.11.2026» fra «2026-11-16» */
export const fmtDay = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : ymd);

/** Verdien i en kolonne som tekst (til sett-filter) */
export function cellText(r: ViewRow, k: ColKey): string {
  switch (k) {
    case 'punkt': return r.name;
    case 'kode': return r.code;
    case 'fil': return r.fileName;
    case 'dato': return fmtTime(r.time);
    case 'x': return r.x.toFixed(3);
    case 'y': return r.y.toFixed(3);
    case 'z': return r.h === null ? '' : r.h.toFixed(3);
  }
}

export function passes(r: ViewRow, k: ColKey, f: ColFilter): boolean {
  if (!isActive(f)) return true;
  if (f.text?.trim() && !cellText(r, k).toLowerCase().includes(f.text.trim().toLowerCase())) return false;
  if (f.set?.length && !f.set.includes(k === 'kode' ? r.code : k === 'fil' ? r.fileName : cellText(r, k))) return false;
  if (k === 'dato') {
    const d = dayOf(r.time);
    if (f.min && d < f.min) return false;
    if (f.max && d > f.max) return false;
  } else if (k === 'x' || k === 'y' || k === 'z') {
    const v = k === 'x' ? r.x : k === 'y' ? r.y : r.h;
    const lo = f.min?.trim() ? num(f.min) : null, hi = f.max?.trim() ? num(f.max) : null;
    if ((lo !== null || hi !== null) && v === null) return false;
    if (lo !== null && v! < lo) return false;
    if (hi !== null && v! > hi) return false;
  }
  return true;
}

export function applyFilters(rows: ViewRow[], filters: Filters): ViewRow[] {
  const keys = activeFilters(filters);
  if (!keys.length) return rows;
  return rows.filter((r) => keys.every((k) => passes(r, k, filters[k]!)));
}

/** Kort beskrivelse av et filter, til merkelappene over tabellen */
export function describeFilter(k: ColKey, f: ColFilter): string {
  const label = colDef(k).label.replace(/ \(.*\)$/, '');
  const parts: string[] = [];
  if (f.text?.trim()) parts.push(`inneholder «${f.text.trim()}»`);
  if (f.set?.length) parts.push(f.set.map((v) => v || '(uten kode)').join(', '));
  if (f.min?.trim() || f.max?.trim()) {
    const a = k === 'dato' ? fmtDay(f.min ?? '') : (f.min ?? '').trim();
    const b = k === 'dato' ? fmtDay(f.max ?? '') : (f.max ?? '').trim();
    parts.push(a && b ? `${a} – ${b}` : a ? `fra ${a}` : `til ${b}`);
  }
  return `${label}: ${parts.join(' og ')}`;
}

/** Ulike verdier i en kolonne med antall (til sett-filter): alfabetisk, tom verdi («uten kode») sist */
export function distinctValues(rows: ViewRow[], k: 'kode' | 'fil'): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const v = k === 'kode' ? r.code : r.fileName; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => (!a.value ? 1 : !b.value ? -1 : naturalCompare(a.value, b.value)));
}

// ---------- Sortering ----------
export type SortDir = 'asc' | 'desc';
export interface SortState { key: ColKey; dir: SortDir }

/** Sorterer etter kolonne. Tomme verdier (uten kode, uten høyde) havner alltid sist. Likt resultat avgjøres av dato og punktnavn. */
export function sortRows(rows: ViewRow[], s: SortState): ViewRow[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  const tie = (a: ViewRow, b: ViewRow) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) || naturalCompare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return [...rows].sort((a, b) => {
    let c = 0;
    switch (s.key) {
      case 'punkt': c = naturalCompare(a.name, b.name); break;
      case 'fil': c = naturalCompare(a.fileName, b.fileName); break;
      case 'dato': c = a.time < b.time ? -1 : a.time > b.time ? 1 : 0; break;
      case 'x': c = a.x - b.x; break;
      case 'y': c = a.y - b.y; break;
      case 'kode': {
        if (!a.code && b.code) return 1;
        if (a.code && !b.code) return -1;
        c = naturalCompare(a.code, b.code);
        break;
      }
      case 'z': {
        if (a.h === null && b.h !== null) return 1;
        if (a.h !== null && b.h === null) return -1;
        c = (a.h ?? 0) - (b.h ?? 0);
        break;
      }
    }
    return c ? c * sign : tie(a, b);
  });
}
