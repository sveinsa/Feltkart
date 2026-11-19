// Felles innstillinger for Felt. Både statuslinjen øverst (stanghøyde) og Felt-panelet bruker de samme verdiene.
import { useEffect, useState } from 'react';
import { loadFieldSettings, saveFieldSettings, type FieldSettings } from './survey';

let shared: FieldSettings | null = null;
const subs = new Set<(s: FieldSettings) => void>();
const current = () => (shared ??= loadFieldSettings());

export function setFieldSettings(patch: Partial<FieldSettings>) {
  shared = { ...current(), ...patch };
  saveFieldSettings(shared);
  subs.forEach((cb) => cb(shared!));
}

export function useFieldSettings(): [FieldSettings, (patch: Partial<FieldSettings>) => void] {
  const [fs, setFs] = useState<FieldSettings>(current);
  useEffect(() => { subs.add(setFs); setFs(current()); return () => { subs.delete(setFs); }; }, []);
  return [fs, setFieldSettings];
}
