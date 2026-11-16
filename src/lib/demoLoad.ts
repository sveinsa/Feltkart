import type { Project } from '../state';
import type { Item } from '../types';
import { fetchDriveBlob, listFolderFiles, type GoogleConfig } from './google';
import { isOrthoFile } from './ortho';
import { isWorldFile } from './jp2';
import { isImageFile } from './photos';
import { isVectorFile } from './vector';
import { DEMO_API_KEY, DEMO_FOLDER_ID } from './demo';

export const supportedDriveFile = (name: string, mime = '') =>
  isVectorFile({ name }) || isOrthoFile({ name, type: mime } as File) || isWorldFile({ name } as File) || isImageFile({ name, type: mime } as File);

export const hasDemoKey = (cfg: GoogleConfig) => !!(cfg.apiKey || DEMO_API_KEY);

export interface DemoResult {
  added: number;
  bounds: [[number, number], [number, number]] | null;
  message: string;
}

/** Leser demomappen på Google Disk (uten innlogging, med API-nøkkel) og legger alt i kartet. */
export async function loadDemoData(project: Project, cfg: GoogleConfig, onProgress: (msg: string) => void, opts: { replace?: boolean } = {}): Promise<DemoResult> {
  const key = cfg.apiKey || DEMO_API_KEY;
  if (!key) throw new Error('Demodata krever en Google API-nøkkel. Lim den inn i src/lib/demo.ts (DEMO_API_KEY) eller under Innstillinger → Google.');
  const dcfg: GoogleConfig = { ...cfg, apiKey: key, publicRead: true };
  onProgress('Skanner demomappen …');
  const list = await listFolderFiles(dcfg, DEMO_FOLDER_ID, (n, d) => onProgress(`Skanner demomappen … ${n} filer i ${d} mapper`));
  const usable = list.filter((f) => supportedDriveFile(f.name, f.mimeType));
  if (!usable.length) throw new Error(`Fant ${list.length} filer i demomappen, men ingen bilder, DXF/KOF/SOSI/LandXML/IFC eller ortofoto.`);
  // Mappestrukturen i kartet speiler mappene i demomappen på Google Disk (f.eks. 01 Foto, 02 Innmåling, 03 Prosjektert, 04 Ortofoto).
  // «replace»: tidligere innlastet demodata fjernes, men først når nye filer er hentet (slik at man aldri står uten data ved feil).
  const usableIds = new Set(usable.map((f) => f.id));
  const have = new Set(opts.replace ? [] : project.items.map((i) => i.driveId).filter(Boolean) as string[]);
  const todo = usable.filter((f) => !isWorldFile({ name: f.name } as File) && !have.has(f.id));
  if (!todo.length) return { added: 0, bounds: null, message: 'Demodataene ligger allerede i kartet.' };
  // world files følger med JP2-filer i samme mappe
  const stem = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
  const extras = usable.filter((f) => isWorldFile({ name: f.name } as File) && todo.some((x) => x.path.join('/') === f.path.join('/') && stem(x.name) === stem(f.name)));
  const all = [...todo, ...extras];
  const files: File[] = [];
  const meta = new Map<File, { driveId?: string; folderId?: string }>();
  const errCount = new Map<string, number>();
  let consecutiveFails = 0;
  for (let i = 0; i < all.length; i++) {
    const d = all[i];
    onProgress(`Henter demodata ${i + 1} av ${all.length}: ${d.name} …`);
    try {
      const blob = await fetchDriveBlob(dcfg, d.id, d.name);
      const f = new File([blob], d.name, { type: d.mimeType });
      files.push(f);
      meta.set(f, { driveId: d.id });
      consecutiveFails = 0;
    } catch (e: any) {
      const m = String(e?.message ?? e);
      errCount.set(m, (errCount.get(m) ?? 0) + 1);
      // Gir opp tidlig hvis ingenting lar seg hente (unngår 20 like feilmeldinger)
      if (++consecutiveFails >= 3 && !files.length) break;
    }
  }
  const errs = [...errCount.entries()].map(([m, n]) => (n > 1 ? `${m} (${n} filer)` : m));
  if (!files.length) throw new Error(errs.join(' ') || 'Ingen filer kunne hentes.');

  const removed = new Set<string>();
  if (opts.replace) {
    const old = project.items.filter((i) => i.driveId && usableIds.has(i.driveId));
    old.forEach((i) => { removed.add(i.id); project.deleteItem(i.id); });
  }
  // Opprett Disk-mappene i riktig rekkefølge (01, 02, 03 …) – eksisterende mapper med samme navn gjenbrukes
  const paths = new Map<string, string[]>();
  for (const d of all) if (d.path.length) paths.set(d.path.join('/'), d.path);
  [...paths.values()]
    .sort((a, b) => a.join('/').localeCompare(b.join('/'), 'nb', { numeric: true }))
    .forEach((p) => project.ensureFolderPath(p));
  for (const m of meta.values()) {
    const d = all.find((x) => x.id === m.driveId);
    if (d && d.path.length) m.folderId = project.ensureFolderPath(d.path);
  }
  const r = await project.upload(files, 'auto', project.settings!.projectCrs, onProgress, { meta, stream: false });
  r.failed.forEach((x) => errs.push(`${x.name}: ${x.reason}`));
  tidyDefaults(project, r.added, removed);
  return { added: r.added.length, bounds: r.bounds, message: errs.join(' ') };
}

/** Gjør Disk-mappene til standardmapper for hver filtype, og fjern de tomme startmappene (Bilder, 360-bilder …). */
function tidyDefaults(project: Project, added: Item[], removed: Set<string>) {
  const st = project.settings;
  if (!st || !added.length) return;
  const mode = (ids: string[]) => {
    const n = new Map<string, number>();
    ids.forEach((i) => n.set(i, (n.get(i) ?? 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const pick = (f: (i: Item) => boolean) => mode(added.filter(f).map((i) => i.folderId));
  const isSurvey = (i: Item) => i.kind === 'dxf' && (i.format === 'kof' || i.format === 'sosi' || i.format === 'landxml');
  const photo = pick((i) => i.kind === 'photo');
  const pano = pick((i) => i.kind === 'pano') ?? photo;
  const dxf = pick((i) => i.kind === 'dxf' && !isSurvey(i));
  const ortho = pick((i) => i.kind === 'ortho');
  const survey = pick(isSurvey);
  const old = Object.values(st.defaultFolders).filter(Boolean) as string[];
  const next = {
    ...st.defaultFolders,
    ...(photo ? { photo } : {}), ...(pano ? { pano } : {}), ...(dxf ? { dxf } : {}), ...(ortho ? { ortho } : {}), ...(survey ? { survey } : {}),
  };
  project.updateSettings({ defaultFolders: next });
  // Fjern gamle standardmapper som nå er tomme og ikke lenger er standard
  const keep = new Set(Object.values(next).filter(Boolean) as string[]);
  const remaining = project.items.filter((i) => !removed.has(i.id));
  const used = (id: string): boolean => remaining.some((i) => i.folderId === id) || added.some((i) => i.folderId === id) || project.folders.some((f) => f.parentId === id && used(f.id));
  for (const id of old) {
    if (!keep.has(id) && !used(id)) project.deleteFolder(id);
  }
}
