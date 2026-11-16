// Felles status for nedlasting og opplasting. Ligger utenfor visningene, slik at fremdriften følger med
// når man bytter mellom Kart, Bilder, Prosjektfiler og Terreng 3D mens noe pågår.
import { useSyncExternalStore } from 'react';

export interface Job {
  id: number;
  title: string;
  msg: string;
  /** 0–100, eller null når fremdriften ikke kan måles (f.eks. skanning av en mappe) */
  pct: number | null;
  startedAt: number;
  finishedAt?: number;
  state: 'running' | 'done' | 'error';
  /** Sluttmelding (ferdig) eller feilmelding */
  detail?: string;
  /** Blir stående til brukeren lukker den (feil og advarsler) */
  keep?: boolean;
}

export interface JobHandle {
  id: number;
  update(msg: string, pct?: number | null): void;
  done(detail?: string, opts?: { keep?: boolean }): void;
  fail(detail: string): void;
}

let jobs: Job[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => { jobs = jobs.slice(); subs.forEach((f) => f()); };
const patch = (id: number, p: Partial<Job>) => {
  const i = jobs.findIndex((j) => j.id === id);
  if (i === -1) return;
  jobs[i] = { ...jobs[i], ...p };
  emit();
};

export function dismissJob(id: number) {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

/** Starter en jobb som vises i statusfeltet øverst til høyre i alle visninger. */
export function startJob(title: string, msg = ''): JobHandle {
  const id = ++seq;
  jobs = [...jobs, { id, title, msg, pct: null, startedAt: Date.now(), state: 'running' }];
  emit();
  let last = 0;
  const end = (p: Partial<Job>, keep: boolean) => {
    patch(id, { ...p, finishedAt: Date.now(), keep });
    if (!keep) window.setTimeout(() => dismissJob(id), 7000);
  };
  return {
    id,
    update(m, pct) {
      const p: Partial<Job> = { msg: m };
      if (pct === null) p.pct = null;
      else if (typeof pct === 'number' && Number.isFinite(pct)) { last = Math.max(last, Math.min(99, pct)); p.pct = last; } // går aldri bakover
      patch(id, p);
    },
    done(detail, opts) { end({ state: 'done', pct: 100, msg: '', detail }, !!opts?.keep); },
    fail(detail) { end({ state: 'error', msg: '', detail }, true); },
  };
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const useJobs = (): Job[] => useSyncExternalStore(subscribe, () => jobs);
