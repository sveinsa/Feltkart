import type { Project } from '../state';
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
export async function loadDemoData(project: Project, cfg: GoogleConfig, onProgress: (msg: string) => void): Promise<DemoResult> {
  const key = cfg.apiKey || DEMO_API_KEY;
  if (!key) throw new Error('Demodata krever en Google API-nøkkel. Lim den inn i src/lib/demo.ts (DEMO_API_KEY) eller under Innstillinger → Google.');
  const dcfg: GoogleConfig = { ...cfg, apiKey: key, publicRead: true };
  onProgress('Skanner demomappen …');
  const list = await listFolderFiles(dcfg, DEMO_FOLDER_ID, (n, d) => onProgress(`Skanner demomappen … ${n} filer i ${d} mapper`));
  const usable = list.filter((f) => supportedDriveFile(f.name, f.mimeType));
  if (!usable.length) throw new Error(`Fant ${list.length} filer i demomappen, men ingen bilder, DXF/KOF/SOSI/LandXML/IFC eller ortofoto.`);
  const have = new Set(project.items.map((i) => i.driveId).filter(Boolean) as string[]);
  const todo = usable.filter((f) => !isWorldFile({ name: f.name } as File) && !have.has(f.id));
  if (!todo.length) return { added: 0, bounds: null, message: 'Demodataene ligger allerede i kartet.' };
  // world files følger med JP2-filer i samme mappe
  const stem = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
  const extras = usable.filter((f) => isWorldFile({ name: f.name } as File) && todo.some((x) => x.path.join('/') === f.path.join('/') && stem(x.name) === stem(f.name)));
  const all = [...todo, ...extras];
  const files: File[] = [];
  const meta = new Map<File, { driveId?: string; folderId?: string }>();
  const errs: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const d = all[i];
    onProgress(`Henter demodata ${i + 1} av ${all.length}: ${d.name} …`);
    try {
      const blob = await fetchDriveBlob(dcfg, d.id, d.name);
      const f = new File([blob], d.name, { type: d.mimeType });
      files.push(f);
      meta.set(f, { driveId: d.id, folderId: d.path.length ? project.ensureFolderPath(d.path) : undefined });
    } catch (e: any) { errs.push(String(e?.message ?? e)); }
  }
  if (!files.length) throw new Error(errs.join(' ') || 'Ingen filer kunne hentes.');
  const r = await project.upload(files, 'auto', project.settings!.projectCrs, onProgress, { meta, stream: false });
  errs.push(...r.failed.map((x) => `${x.name}: ${x.reason}`));
  return { added: r.added.length, bounds: r.bounds, message: errs.length ? errs.join(' ') : '' };
}
