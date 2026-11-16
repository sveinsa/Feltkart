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

interface DemoFile { id: string; name: string; mimeType: string; path: string[]; url?: string }

/** Demodata som ligger i selve nettstedet (public/demo/manifest.json). Gir null hvis den ikke finnes. */
let manifestPromise: Promise<(DemoFile[] & { alsoFromDrive?: boolean }) | null> | null = null;
export function localDemoFiles(): Promise<(DemoFile[] & { alsoFromDrive?: boolean }) | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const res = await fetch(new URL('demo/manifest.json', document.baseURI).toString(), { cache: 'no-cache' });
        if (!res.ok) return null;
        const j = await res.json();
        const rel: string[] = (Array.isArray(j) ? j : j?.files ?? []).map((x: any) => (typeof x === 'string' ? x : x?.path)).filter(Boolean);
        if (!rel.length) return null;
        const out = rel.map((r) => {
          const segs = r.split('/').filter(Boolean);
          const name = segs[segs.length - 1];
          return {
            id: `demo:${r}`, name, mimeType: '', path: segs.slice(0, -1),
            url: new URL('demo/' + segs.map(encodeURIComponent).join('/'), document.baseURI).toString(),
          } as DemoFile;
        }) as DemoFile[] & { alsoFromDrive?: boolean };
        out.alsoFromDrive = !Array.isArray(j) && !!j?.alsoFromDrive;
        return out;
      } catch {
        return null; // ingen manifest (eller ikke JSON, f.eks. 404-side) – bruk Google Disk
      }
    })();
  }
  return manifestPromise;
}

/** Finnes det en demokilde (egen mappe i nettstedet eller Google Disk med nøkkel)? */
export async function hasDemoSource(cfg: GoogleConfig): Promise<boolean> {
  return hasDemoKey(cfg) || !!(await localDemoFiles());
}

/** Kjører oppgaver parallelt (maks `limit` om gangen). */
async function mapLimit<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Henter demodata (fra egen mappe i nettstedet hvis den finnes, ellers Google Disk) og legger alt i kartet. */
export async function loadDemoData(project: Project, cfg: GoogleConfig, onProgress: (msg: string, pct?: number) => void, opts: { replace?: boolean } = {}): Promise<DemoResult> {
  const local = await localDemoFiles();
  const key = cfg.apiKey || DEMO_API_KEY;
  if (!local && !key) throw new Error('Demodata krever en Google API-nøkkel. Lim den inn i src/lib/demo.ts (DEMO_API_KEY) eller under Innstillinger → Google.');
  const dcfg: GoogleConfig = { ...cfg, apiKey: key, publicRead: true };
  let list: DemoFile[];
  if (local) {
    list = [...local];
    // «alsoFromDrive»: filer som ikke ligger i public/demo (f.eks. et ortofoto over 100 MB) hentes fra Google Disk
    if (local.alsoFromDrive && key) {
      onProgress('Skanner demomappen på Google Disk for filer som mangler …');
      const have = new Set(local.map((f) => [...f.path, f.name].join('/').toLowerCase()));
      const remote = (await listFolderFiles(dcfg, DEMO_FOLDER_ID)) as DemoFile[];
      for (const f of remote) if (!have.has([...f.path, f.name].join('/').toLowerCase())) list.push(f);
    }
  } else {
    onProgress('Skanner demomappen …', 2);
    list = (await listFolderFiles(dcfg, DEMO_FOLDER_ID, (n, d) => onProgress(`Skanner demomappen … ${n} filer i ${d} mapper`, 3))) as DemoFile[];
  }
  const usable = list.filter((f) => supportedDriveFile(f.name, f.mimeType));
  if (!usable.length) throw new Error(`Fant ${list.length} filer i demomappen, men ingen bilder, DXF/KOF/SOSI/LandXML/IFC eller ortofoto.`);
  // Mappestrukturen i kartet speiler mappene i demomappen (f.eks. 01 Foto, 02 Innmåling, 03 Prosjektert, 04 Ortofoto).
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
  let failed = 0;
  let done = 0;
  // Parallell nedlasting (fire om gangen) – mye raskere enn én og én, særlig fra en treg Google Disk
  await mapLimit(all, 4, async (d) => {
    if (failed >= 3 && !files.length) return; // gir opp tidlig hvis ingenting lar seg hente
    try {
      let blob: Blob;
      if (d.url) {
        const res = await fetch(d.url);
        if (!res.ok) throw new Error(`Kunne ikke hente ${d.name} (HTTP ${res.status})`);
        blob = await res.blob();
      } else {
        blob = await fetchDriveBlob(dcfg, d.id, d.name);
      }
      const f = new File([blob], d.name, { type: d.mimeType });
      files.push(f);
      meta.set(f, { driveId: d.id });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      errCount.set(m, (errCount.get(m) ?? 0) + 1);
      failed++;
    } finally {
      ++done;
      onProgress(`Henter demodata ${done} av ${all.length} …`, 5 + (40 * done) / all.length);
    }
  });
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
  // Fremdrift under behandling: veid etter filstørrelse (store ortofoto tar lengst tid)
  const bytes = new Map(files.map((f) => [f.name, Math.max(f.size, 20_000)] as const));
  const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
  let curName = '';
  let doneBytes = 0;
  const processing = (msg: string) => {
    const m = /^\((\d+)\/(\d+)\) (.+?): /.exec(msg);
    if (m && m[2] !== undefined && m[3] !== curName) {
      if (curName) doneBytes += bytes.get(curName) ?? 0;
      curName = m[3];
    }
    const sub = /(\d+) %/.exec(msg); // «Reprojiserer … 40 %»
    const cur = (bytes.get(curName) ?? 0) * (sub ? Math.min(1, Number(sub[1]) / 100) * 0.6 : 0);
    onProgress(msg, 45 + (53 * Math.min(1, (doneBytes + cur) / totalBytes)));
  };
  const r = await project.upload(files, 'auto', project.settings!.projectCrs, processing, { meta, stream: false });
  onProgress('Ferdig', 100);
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
