// Google Disk: innlogging (Google Identity Services), mappevelger (Google Picker) og oppretting av mapper (Drive API v3).
// Oppsett av Client ID / API-nøkkel er beskrevet i README.
import type { TemplateNode } from './templates';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

// drive.file gir bare tilgang til mapper/filer appen selv oppretter eller som brukeren velger i mappevelgeren.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';

export interface GoogleConfig {
  clientId: string;
  apiKey?: string; // trengs bare for mappevelgeren
  appId?: string; // prosjektnummeret i Google Cloud – trengs for at valgt mappe skal kunne skrives til
}

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

let token: { value: string; expires: number; clientId: string } | null = null;

/** Henter tilgangstoken. Må kalles fra et klikk (åpner Googles innloggingsvindu første gang). */
export async function getAccessToken(cfg: GoogleConfig, forcePrompt = false): Promise<string> {
  if (!cfg.clientId) throw new Error('Google Client ID mangler. Legg den inn under Innstillinger.');
  if (!forcePrompt && token && token.clientId === cfg.clientId && token.expires > Date.now() + 60_000) return token.value;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        token = { value: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3600) * 1000, clientId: cfg.clientId };
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.type === 'popup_closed' ? 'Innloggingen ble avbrutt' : err?.message || 'Innlogging feilet')),
    });
    client.requestAccessToken({ prompt: forcePrompt || !token ? 'consent' : '' });
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
export async function pickFolder(cfg: GoogleConfig): Promise<PickedFolder | null> {
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
      .setTitle('Velg mappen prosjektet skal opprettes i')
      .addView(view)
      .addView(shared)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(access)
      .setDeveloperKey(cfg.apiKey)
      .setLocale('no')
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name, url: d.url });
        } else if (data.action === g.picker.Action.CANCEL) resolve(null);
      });
    if (cfg.appId) builder = builder.setAppId(cfg.appId);
    builder.build().setVisible(true);
  });
}

async function drive(path: string, access: string, init: RequestInit = {}, attempt = 0): Promise<any> {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
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
