// Utsetting: «gå til» valgte punkter fra prosjektet (objekter, punkter i KOF/SOSI/LandXML, bilder, innmålte punkter og punkt i kartet).
// Her ligger valgene (delt mellom Kart-visningen og Felt), utregning av avstand og retning, og innsamling av punkter fra prosjektet.
import { useSyncExternalStore } from 'react';
import type { DxfItem, PhotoItem } from '../../types';
import type { Project } from '../../state';
import { fromLatLng } from '../crs';
import { loadPoints } from './survey';
import { primeSound } from './sound';

export type StakeSource = 'objekt' | 'punkt' | 'bilde' | 'kart' | 'innmalt';
export const SOURCE_LABEL: Record<StakeSource, string> = { objekt: 'Objekt', punkt: 'Prosjektpunkt', bilde: 'Bilde', kart: 'Valgt i kart', innmalt: 'Innmålt' };

export interface StakeTarget {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Høyde (prosjektert), hvis kjent */
  z: number | null;
  source: StakeSource;
  /** Kort tilleggsinfo (kode, lag, fil) */
  note?: string;
}

export interface StakeState {
  targets: StakeTarget[];
  /** Hvilket av punktene vi går til nå */
  index: number;
  /** Økes når Felt skal åpne Utsett-fanen (f.eks. etter «Gå til» i kartet) */
  focus: number;
}

const KEY = 'feltkart.field.stake';
const MAX_TARGETS = 500;

function load(): StakeState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.targets)) {
      const targets = (s.targets as StakeTarget[]).filter((t) => t && Number.isFinite(t.lat) && Number.isFinite(t.lng)).slice(0, MAX_TARGETS);
      return { targets, index: Math.min(Math.max(0, Number(s.index) || 0), Math.max(0, targets.length - 1)), focus: 0 };
    }
  } catch { /* ignorer */ }
  return { targets: [], index: 0, focus: 0 };
}

let state: StakeState = load();
const subs = new Set<() => void>();
function commit(next: StakeState) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify({ targets: state.targets, index: state.index })); } catch { /* ignorer */ }
  subs.forEach((f) => f());
}

export const getStake = () => state;
export function subscribeStake(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const useStake = (): StakeState => useSyncExternalStore(subscribeStake, getStake, getStake);
export const currentTarget = (s: StakeState = state): StakeTarget | null => s.targets[s.index] ?? null;

/** Velger punkter å gå til. `focus` åpner Utsett-fanen i Felt. Kalles fra et trykk, så lyden kan klargjøres. */
export function setStake(targets: StakeTarget[], index = 0, focus = true) {
  primeSound();
  const t = targets.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).slice(0, MAX_TARGETS);
  commit({ targets: t, index: Math.min(Math.max(0, index), Math.max(0, t.length - 1)), focus: focus ? state.focus + 1 : state.focus });
}
export function stepStake(delta: number) {
  if (!state.targets.length) return;
  const i = Math.min(state.targets.length - 1, Math.max(0, state.index + delta));
  if (i !== state.index) commit({ ...state, index: i });
}
export const gotoStake = (i: number) => { if (i >= 0 && i < state.targets.length && i !== state.index) commit({ ...state, index: i }); };
export const clearStake = () => commit({ targets: [], index: 0, focus: state.focus });

// ---------- Avstand og retning ----------
export interface Guide {
  /** Hvor mye du må gå mot øst og nord (m), i kartets rutenett */
  dE: number;
  dN: number;
  dist: number;
  /** Retning til punktet, grader fra rutenettets nord (0–360) */
  bearing: number;
}

const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;

export function guide(from: { lat: number; lng: number }, to: { lat: number; lng: number }, crs: string): Guide {
  const [e0, n0] = fromLatLng(crs, from.lat, from.lng);
  const [e1, n1] = fromLatLng(crs, to.lat, to.lng);
  const dE = e1 - e0, dN = n1 - n0;
  return { dE, dN, dist: Math.hypot(dE, dN), bearing: deg(Math.atan2(dE, dN)) };
}

/** Pilens vinkel (grader med klokka fra «opp»). Med kjent gangretning peker pilen relativt til den, ellers er nord opp. */
export const arrowAngle = (bearing: number, course: number | null) => (((bearing - (course ?? 0)) % 360) + 360) % 360;

/** Gangretning ut fra bevegelse: oppdateres når posisjonen har flyttet seg minst `minMove` meter siden forrige referansepunkt */
export class CourseTracker {
  private ref: { e: number; n: number } | null = null;
  private course: number | null = null;
  private at = 0;
  constructor(private minMove = 0.6, private maxAgeMs = 12000) {}
  update(e: number, n: number, now = Date.now()): number | null {
    if (!this.ref) { this.ref = { e, n }; return this.value(now); }
    const d = Math.hypot(e - this.ref.e, n - this.ref.n);
    if (d >= this.minMove) {
      this.course = deg(Math.atan2(e - this.ref.e, n - this.ref.n));
      this.at = now;
      this.ref = { e, n };
    }
    return this.value(now);
  }
  value(now = Date.now()): number | null { return this.course !== null && now - this.at <= this.maxAgeMs ? this.course : null; }
  reset() { this.ref = null; this.course = null; }
}

/** Skjær/fyll: positiv = terrenget er for høyt (skjær), negativ = for lavt (fyll) */
export const cutFill = (ground: number | null, target: number | null): number | null => (ground !== null && target !== null ? ground - target : null);

// ---------- Innsamling av punkter ----------
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const known = (z: number | undefined) => (z !== undefined && Number.isFinite(z) && z !== 0 ? z : null);

/** Punkter fra synlige og lastede prosjektdata (punktobjekter i DXF, KOF, SOSI, LandXML), bilder med posisjon og innmålte punkter */
export function collectTargets(project: Pick<Project, 'items' | 'dxf'>): StakeTarget[] {
  const out: StakeTarget[] = [];
  for (const it of project.items) {
    if (it.kind === 'dxf') {
      const d = it as DxfItem;
      if (d.hidden) continue;
      const data = project.dxf[d.id]?.data;
      if (!data) continue;
      const hiddenLayers = new Set(d.hiddenLayers);
      data.features.forEach((f, i) => {
        if (f.geom !== 'point' || hiddenLayers.has(f.layer) || !f.latlngs.length) return;
        const a = f.attrs ?? {};
        const name = clean(a.Punkt || a.Navn || a.name || f.text || '') || `${f.layer} ${i + 1}`;
        const code = a.Kode || '';
        out.push({
          id: `d:${d.id}:${i}`, name, lat: f.latlngs[0][0], lng: f.latlngs[0][1], z: known(f.z[0]),
          source: 'punkt', note: [code, d.name].filter(Boolean).join(' · '),
        });
      });
    } else if (it.kind === 'photo' || it.kind === 'pano') {
      const p = it as PhotoItem;
      if (p.hidden || p.lat === null || p.lng === null) continue;
      out.push({ id: `p:${p.id}`, name: p.name, lat: p.lat, lng: p.lng, z: null, source: 'bilde', note: p.kind === 'pano' ? '360-bilde' : 'Bilde' });
    }
  }
  for (const fp of loadPoints()) {
    out.push({ id: `f:${fp.id}`, name: fp.name, lat: fp.lat, lng: fp.lng, z: fp.h ?? null, source: 'innmalt', note: fp.code || undefined });
  }
  return out;
}

/** Hjørner/knekkpunkter på en linje eller flate, i rekkefølge */
export function vertexTargets(item: Pick<DxfItem, 'id' | 'name'>, f: { layer: string; type: string; latlngs: [number, number][]; z: number[]; attrs?: Record<string, string>; text?: string }, index: number): StakeTarget[] {
  const a = f.attrs ?? {};
  if (f.latlngs.length === 1) {
    // Ett punkt: samme navn og id som i punktlisten
    const name = clean(a.Punkt || a.Navn || a.name || f.text || '') || `${f.layer} ${index + 1}`;
    return [{ id: `d:${item.id}:${index}`, name, lat: f.latlngs[0][0], lng: f.latlngs[0][1], z: known(f.z[0]), source: 'punkt', note: [a.Kode || '', item.name].filter(Boolean).join(' · ') }];
  }
  const label = clean(a.Navn || a.name || f.layer);
  return f.latlngs.map((ll, k) => ({
    id: `v:${item.id}:${index}:${k}`, name: `${label} punkt ${k + 1}`, lat: ll[0], lng: ll[1], z: known(f.z[k]),
    source: 'objekt' as const, note: `${f.type} · ${item.name}`,
  }));
}

/** Filtrerer og sorterer punkter: søk i navn/kode/fil, nærmest først hvis posisjonen er kjent */
export function filterTargets(all: StakeTarget[], query: string, here: { lat: number; lng: number } | null, limit = 80): { t: StakeTarget; d: number | null }[] {
  const q = query.trim().toLowerCase();
  const hit = q ? all.filter((t) => `${t.name} ${t.note ?? ''} ${SOURCE_LABEL[t.source]}`.toLowerCase().includes(q)) : all;
  const cosLat = here ? Math.cos((here.lat * Math.PI) / 180) : 1;
  const rows = hit.map((t) => ({ t, d: here ? Math.hypot((t.lat - here.lat) * 111320, (t.lng - here.lng) * 111320 * cosLat) : null }));
  rows.sort((a, b) => (a.d !== null && b.d !== null ? a.d - b.d : a.t.name.localeCompare(b.t.name, 'nb', { numeric: true })));
  return rows.slice(0, limit);
}

export const fmtDist = (m: number): string => (m < 1 ? `${(m * 100).toFixed(0)} cm` : m < 100 ? `${m.toFixed(2).replace('.', ',')} m` : m < 1000 ? `${m.toFixed(1).replace('.', ',')} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
