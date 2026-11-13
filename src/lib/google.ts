// Google Disk: innlogging (Google Identity Services), mappevelger (Google Picker) og oppretting av mapper (Drive API v3).
// Oppsett av Client ID / API-nøkkel er beskrevet i README.
import type { TemplateNode } from './templates';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

// 'file' (drive.file): bare mapper/filer appen selv oppretter eller som brukeren velger i velgeren.
// 'full' (drive): kan liste, lese og skrive i alle mapper brukeren har tilgang til (brukes for å skanne en mappe).
export type DriveAccess = 'file' | 'full';
const SCOPES: Record<DriveAccess, string> = {
  file: 'https://www.googleapis.com/auth/drive.file',
  full: 'https://www.googleapis.com/auth/drive',
};
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';

export interface GoogleConfig {
  clientId: string;
  apiKey?: string; // trengs bare for mappevelgeren
  appId?: string; // prosjektnummeret i Google Cloud – trengs for at valgt mappe skal kunne skrives til
  access?: DriveAccess;
  /** Les offentlig delt mappe («alle med lenken») med bare API-nøkkel – ingen innlogging. Brukes av demodata. */
  publicRead?: boolean;
}

const KEY_PREFIX = 'key:';

export function envGoogleConfig(): GoogleConfig {
  const env = (import.meta as any).env ?? {};
  return {
    clientId: env.VITE_GOOGLE_CLIENT_ID ?? '',
    apiKey: env.VITE_GOOGLE_API_KEY ?? '',
    appId: env.VITE_GOOGLE_APP_ID ?? '',
  };
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); reject(new Error(`Kunne ikke laste ${src}`)); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

/** Last inn Googles innloggingsskript på forhånd, slik at innloggingsvinduet ikke blokkeres av nettleseren. */
export function preloadGoogle() {
  loadScript('https://accounts.google.com/gsi/client').catch(() => {});
}

let token: { value: string; expires: number; clientId: string; scope: string } | null = null;

// Lar dialoger skjule seg selv mens Googles velger er åpen (ellers havner velgeren bak dialogen)
const pickerListeners = new Set<(open: boolean) => void>();
export function onPickerChange(cb: (open: boolean) => void) {
  pickerListeners.add(cb);
  return () => { pickerListeners.delete(cb); };
}
function notifyPicker(open: boolean) {
  document.body.classList.toggle('picking', open);
  pickerListeners.forEach((cb) => cb(open));
}

/** Henter tilgangstoken. Må kalles fra et klikk (åpner Googles innloggingsvindu første gang). */
export async function getAccessToken(cfg: GoogleConfig, forcePrompt = false): Promise<string> {
  if (cfg.publicRead) {
    if (!cfg.apiKey) throw new Error('Demodata krever en Google API-nøkkel (legges inn under Innstillinger).');
    return KEY_PREFIX + cfg.apiKey;
  }
  if (!cfg.clientId) throw new Error('Google Client ID mangler. Legg den inn under Innstillinger.');
  const scope = SCOPES[cfg.access ?? 'file'];
  if (!forcePrompt && token && token.clientId === cfg.clientId && token.scope === scope && token.expires > Date.now() + 60_000) return token.value;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope,
      callback: (resp: any) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        token = { value: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3600) * 1000, clientId: cfg.clientId, scope };
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.type === 'popup_closed' ? 'Innloggingen ble avbrutt' : err?.message || 'Innlogging feilet')),
    });
    client.requestAccessToken({ prompt: forcePrompt || !token || token.scope !== scope ? 'consent' : '' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
}

export function isSignedIn() {
  return !!token && token.expires > Date.now();
}

export interface PickedFolder {
  id: string;
  name: string;
  url?: string;
}

/** Åpner Google sin mappevelger. Krever API-nøkkel og prosjektnummer. */
export async function pickFolder(cfg: GoogleConfig, title = 'Velg mappen prosjektet skal opprettes i'): Promise<PickedFolder | null> {
  if (!cfg.apiKey) throw new Error('Mappevelgeren krever en Google API-nøkkel (se README).');
  const access = await getAccessToken(cfg);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((res, rej) => window.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Kunne ikke laste mappevelgeren')) }));
  const g = window.google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME);
    const shared = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)
      .setMimeTypes(FOLDER_MIME);
    let builder = new g.picker.PickerBuilder()
      .setTitle(title)
      .addView(view)
      .addView(shared)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(access)
      .setDeveloperKey(cfg.apiKey)
      .setLocale('no')
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          notifyPicker(false);
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name, url: d.url });
        } else if (data.action === g.picker.Action.CANCEL) {
          notifyPicker(false);
          resolve(null);
        }
      });
    if (cfg.appId) builder = builder.setAppId(cfg.appId);
    notifyPicker(true); // skjuler dialogen mens velgeren er åpen
    try { builder.build().setVisible(true); } catch (e) { notifyPicker(false); throw e; }
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

/** Åpner Google sin filvelger med flervalg (bla i mapper og merk flere filer). */
export async function pickFiles(cfg: GoogleConfig, parentId?: string): Promise<PickedFile[]> {
  if (!cfg.apiKey) throw new Error('Filvelgeren krever en Google API-nøkkel og prosjektnummer (se Innstillinger).');
  const access = await getAccessToken(cfg);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((res, rej) => window.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Kunne ikke laste filvelgeren')) }));
  const g = window.google;
  return new Promise((resolve) => {
    const mine = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    if (parentId) mine.setParent(parentId); // start i den koblede mappen
    const shared = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setEnableDrives(true);
    let builder = new g.picker.PickerBuilder()
      .setTitle('Velg filer som skal hentes inn i kartet')
      .addView(mine)
      .addView(shared)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(access)
      .setDeveloperKey(cfg.apiKey)
      .setLocale('no')
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          notifyPicker(false);
          resolve(data.docs.map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes })));
        } else if (data.action === g.picker.Action.CANCEL) {
          notifyPicker(false);
          resolve([]);
        }
      });
    if (cfg.appId) builder = builder.setAppId(cfg.appId);
    notifyPicker(true);
    try { builder.build().setVisible(true); } catch (e) { notifyPicker(false); throw e; }
  });
}

/** Laster ned en fil fra Google Disk som en vanlig File. */
export async function downloadDriveFile(cfg: GoogleConfig, f: PickedFile): Promise<File> {
  if (f.mimeType.startsWith('application/vnd.google-apps')) {
    throw new Error(`${f.name}: Google-dokumenter (Docs, Sheets …) kan ikke hentes inn i kartet.`);
  }
  const access = await getAccessToken(cfg);
  const res = await fetch(`${API}/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) {
    if (res.status === 401) token = null;
    throw new Error(`Kunne ikke hente ${f.name} (${res.status}).`);
  }
  return new File([await res.blob()], f.name, { type: f.mimeType });
}

async function drive(path: string, access: string, init: RequestInit = {}, attempt = 0): Promise<any> {
  const isKey = access.startsWith(KEY_PREFIX);
  const url = API + path + (isKey ? `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(access.slice(KEY_PREFIX.length))}` : '');
  const res = await fetch(url, {
    ...init,
    headers: { ...(isKey ? {} : { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }), ...(init.headers ?? {}) },
  });
  // Ved for mange forespørsler: vent og prøv igjen
  if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < 4) {
    const body = res.status === 403 ? await res.clone().json().catch(() => null) : null;
    const rateLimited = res.status !== 403 || /rate|limit/i.test(JSON.stringify(body ?? ''));
    if (rateLimited) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
      return drive(path, access, init, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message ?? res.statusText;
    if (res.status === 404) throw new Error(`Fant ikke målmappen, eller appen har ikke tilgang til den (${msg}). Velg mappen på nytt i mappevelgeren.`);
    if (res.status === 401) { token = null; throw new Error('Innloggingen er utløpt. Prøv igjen.'); }
    throw new Error(`Google Disk svarte ${res.status}: ${msg}`);
  }
  return res.json();
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFolder(access: string, name: string, parentId: string): Promise<string | null> {
  const query = `name = '${q(name)}' and '${q(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const r = await drive(`?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, access);
  return r.files?.[0]?.id ?? null;
}

async function createFolder(access: string, name: string, parentId: string): Promise<{ id: string; webViewLink?: string }> {
  return drive(`?supportsAllDrives=true&fields=id,webViewLink`, access, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
}

export interface CreateResult {
  rootId: string;
  rootUrl: string;
  created: number;
  reused: number;
}

/**
 * Oppretter mappetreet i Google Disk.
 * @param parentId 'root' for Min disk, ellers ID til mappen som er valgt i mappevelgeren
 * @param reuseExisting gjenbruk mapper med samme navn i stedet for å lage duplikater
 */
export async function createDriveTree(
  cfg: GoogleConfig,
  roots: TemplateNode[],
  parentId: string,
  reuseExisting: boolean,
  onProgress: (done: number, current: string) => void,
): Promise<CreateResult> {
  const access = await getAccessToken(cfg);
  let done = 0, created = 0, reused = 0;
  let first: { id: string; url: string } | null = null;

  const walk = async (nodes: TemplateNode[], parent: string, depth: number) => {
    for (const n of nodes) {
      onProgress(done, n.name);
      let id = reuseExisting ? await findFolder(access, n.name, parent) : null;
      let url = id ? `https://drive.google.com/drive/folders/${id}` : '';
      if (id) reused++;
      else {
        const f = await createFolder(access, n.name, parent);
        id = f.id;
        url = f.webViewLink ?? `https://drive.google.com/drive/folders/${id}`;
        created++;
      }
      done++;
      if (depth === 0 && !first) first = { id, url };
      await walk(n.children, id, depth + 1);
    }
  };

  await walk(roots, parentId, 0);
  onProgress(done, '');
  const top = first as { id: string; url: string } | null;
  return {
    rootId: top?.id ?? parentId,
    rootUrl: top?.url ?? (parentId === 'root' ? 'https://drive.google.com/drive/my-drive' : `https://drive.google.com/drive/folders/${parentId}`),
    created,
    reused,
  };
}

// ---------- Hente fra og laste opp til en mappe ----------

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string[]; // undermapper under den koblede mappen
}

/** Henter en fil fra Disk som Blob (brukes både ved import og for å strømme originaler). */
export async function fetchDriveBlob(cfg: GoogleConfig, id: string, name = ''): Promise<Blob> {
  const access = await getAccessToken(cfg);
  const isKey = access.startsWith(KEY_PREFIX);
  const res = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true${isKey ? `&key=${encodeURIComponent(access.slice(KEY_PREFIX.length))}` : ''}`, isKey ? {} : { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) {
    if (res.status === 401) token = null;
    if (isKey && (res.status === 403 || res.status === 404)) throw new Error(`Kunne ikke hente ${name || 'filen'} uten innlogging (${res.status}). Sjekk at mappen er delt med «alle med lenken» og at API-nøkkelen tillater Google Drive API.`);
    throw new Error(`Kunne ikke hente ${name || 'filen'} fra Google Disk (${res.status}).`);
  }
  return res.blob();
}

/** Lister alle filer i en mappe og undermapper. Krever full tilgang for å se filer appen ikke har opprettet. */
export async function listFolderFiles(
  cfg: GoogleConfig,
  folderId: string,
  onProgress?: (found: number, folders: number) => void,
): Promise<DriveFileInfo[]> {
  const access = await getAccessToken(cfg);
  const out: DriveFileInfo[] = [];
  const queue: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
  let folders = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    folders++;
    let pageToken = '';
    do {
      const query = `'${q(cur.id)}' in parents and trashed = false`;
      const r = await drive(
        `?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,size)')}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        access,
      );
      for (const f of r.files ?? []) {
        if (f.mimeType === FOLDER_MIME) queue.push({ id: f.id, path: [...cur.path, f.name] });
        else out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size) || 0, path: cur.path });
      }
      pageToken = r.nextPageToken ?? '';
      onProgress?.(out.length, folders);
    } while (pageToken);
  }
  return out;
}

/** Finner eller oppretter en undermappe-sti under rootId og returnerer ID-en til den innerste mappen. */
export async function ensureDrivePath(cfg: GoogleConfig, rootId: string, names: string[], cache: Map<string, string>): Promise<string> {
  const access = await getAccessToken(cfg);
  let parent = rootId;
  let key = '';
  for (const n of names) {
    key += '/' + n;
    let id = cache.get(key) ?? null;
    if (!id) {
      id = await findFolder(access, n, parent);
      if (!id) id = (await createFolder(access, n, parent)).id;
      cache.set(key, id);
    }
    parent = id;
  }
  return parent;
}

export async function driveFileExists(cfg: GoogleConfig, name: string, parentId: string): Promise<string | null> {
  const access = await getAccessToken(cfg);
  const query = `name = '${q(name)}' and '${q(parentId)}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`;
  const r = await drive(`?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, access);
  return r.files?.[0]?.id ?? null;
}

/** Laster opp en fil (gjenopptakbar opplasting, med fremdrift). Returnerer fil-ID. */
export async function uploadDriveFile(
  cfg: GoogleConfig,
  blob: Blob,
  name: string,
  parentId: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const access = await getAccessToken(cfg);
  const mime = blob.type || 'application/octet-stream';
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
  if (!init.ok) {
    if (init.status === 401) token = null;
    const body = await init.json().catch(() => null);
    if (init.status === 404) throw new Error('Fant ikke målmappen, eller appen har ikke tilgang til den. Velg mappen på nytt.');
    throw new Error(`Opplasting av ${name} feilet (${init.status}${body?.error?.message ? `: ${body.error.message}` : ''}).`);
  }
  const location = init.headers.get('Location');
  if (!location) throw new Error('Google Disk ga ingen opplastingsadresse. Prøv igjen.');
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).id); } catch { reject(new Error(`Opplasting av ${name}: uventet svar fra Google Disk.`)); }
      } else reject(new Error(`Opplasting av ${name} feilet (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Opplasting av ${name} feilet (nettverksfeil).`));
    xhr.send(blob);
  });
}
