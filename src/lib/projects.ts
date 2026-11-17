// Prosjektliste: hvert prosjekt har sin egen lagring i nettleseren (egen database, egne målinger).
// Det første prosjektet («default») bruker databasen som alltid har vært brukt, så eksisterende innhold beholdes.
export interface ProjectRef { id: string; name: string }

const KEY = 'feltkart.projects.v1';
export const DEFAULT_PROJECT_ID = 'default';
export const DEFAULT_PROJECT_NAME = 'Oppdal Ålma';

const initial = (): ProjectRef[] => [
  { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME },
  { id: 'p1', name: 'Prosjekt 1' },
  { id: 'p2', name: 'Prosjekt 2' },
  { id: 'p3', name: 'Prosjekt 3' },
];

interface Registry { active: string; list: ProjectRef[] }
let cache: Registry | null = null;

function read(): Registry {
  if (cache) return cache;
  let reg: Registry | null = null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.active === 'string' && Array.isArray(raw.list)) {
      const list = (raw.list as unknown[]).filter((p): p is ProjectRef => !!p && typeof (p as ProjectRef).id === 'string' && /^[a-z0-9_-]{1,24}$/i.test((p as ProjectRef).id) && typeof (p as ProjectRef).name === 'string' && (p as ProjectRef).name.length > 0).map((p) => ({ id: p.id, name: p.name.slice(0, 80) }));
      if (list.some((p) => p.id === DEFAULT_PROJECT_ID)) reg = { active: list.some((p) => p.id === raw.active) ? raw.active : DEFAULT_PROJECT_ID, list };
    }
  } catch { /* ødelagt eller sperret: bruk standardlisten */ }
  cache = reg ?? { active: DEFAULT_PROJECT_ID, list: initial() };
  return cache;
}

function write(reg: Registry): void {
  cache = reg;
  try { window.localStorage.setItem(KEY, JSON.stringify(reg)); } catch { /* ignorer */ }
}

export const listProjects = (): ProjectRef[] => read().list;
export const activeProjectId = (): string => read().active;
export const isDefaultProject = (): boolean => activeProjectId() === DEFAULT_PROJECT_ID;

/** Navnet på et nytt, tomt prosjekt */
export function projectNameFor(id: string): string {
  return read().list.find((p) => p.id === id)?.name ?? DEFAULT_PROJECT_NAME;
}

/** Husk navnet når det endres under Innstillinger, så listen viser det samme */
export function setProjectName(id: string, name: string): void {
  const reg = read();
  if (!name || reg.list.find((p) => p.id === id)?.name === name) return;
  write({ ...reg, list: reg.list.map((p) => (p.id === id ? { ...p, name } : p)) });
}

/** Bytt aktivt prosjekt. Siden må lastes på nytt etterpå. */
export function setActiveProject(id: string): boolean {
  const reg = read();
  if (!reg.list.some((p) => p.id === id)) return false;
  write({ ...reg, active: id });
  return true;
}

/** Brukes av lagringen: samme nøkkel som før for det første prosjektet, ellers med prosjekt-id på slutten */
export const scopedKey = (base: string): string => (isDefaultProject() ? base : `${base}.${activeProjectId()}`);
export const dbNameForActive = (): string => (isDefaultProject() ? 'feltkart' : `feltkart-${activeProjectId()}`);
