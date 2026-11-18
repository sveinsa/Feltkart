// Bro til Android-appen (Kotlin). I vanlig nettleser finnes ikke broen, og alle funksjonene her er da «av».
// Kotlin-siden: @JavascriptInterface «FeltkartNative.call(metode, json, id)» og svar/hendelser via window.__fkResult / window.__fkEvent.
type EvtFn = (name: string, data: any) => void;

interface Bridge { call(method: string, args: string, id: number): void }
declare global {
  interface Window {
    FeltkartNative?: Bridge;
    __fkResult?: (id: number, ok: boolean, json: string) => void;
    __fkEvent?: (name: string, json: string) => void;
  }
}

export const isNative = () => typeof window !== 'undefined' && !!window.FeltkartNative;

let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
const listeners = new Set<EvtFn>();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  window.__fkResult = (id, ok, json) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    let v: any = null;
    try { v = json ? JSON.parse(json) : null; } catch { v = json; }
    if (ok) p.res(v); else p.rej(new Error(typeof v === 'string' ? v : v?.message ?? 'Feil i Android-appen'));
  };
  window.__fkEvent = (name, json) => {
    let d: any = {};
    try { d = json ? JSON.parse(json) : {}; } catch { d = { text: json }; }
    listeners.forEach((l) => l(name, d));
  };
}

export const native = {
  call<T = any>(method: string, args: Record<string, unknown> = {}, timeoutMs = 120000): Promise<T> {
    if (!window.FeltkartNative) return Promise.reject(new Error('Dette krever Android-appen Feltkart.'));
    wire();
    const id = ++seq;
    return new Promise<T>((res, rej) => {
      const t = setTimeout(() => { pending.delete(id); rej(new Error('Android-appen svarte ikke i tide')); }, timeoutMs);
      pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      try { window.FeltkartNative!.call(method, JSON.stringify(args), id); } catch (e: any) { clearTimeout(t); pending.delete(id); rej(e instanceof Error ? e : new Error(String(e))); }
    });
  },
  on(cb: EvtFn) { wire(); listeners.add(cb); return () => { listeners.delete(cb); }; },
};

export interface BtDevice { name: string; address: string }
export const listBtDevices = () => native.call<BtDevice[]>('btList');

/** Tar bilde med Androids kamera. Gir bildet som Blob (filen hentes fra appens egen cache). */
export async function takePhoto(): Promise<{ blob: Blob; name: string } | null> {
  const r = await native.call<{ url: string; name: string } | null>('takePhoto', {}, 600000);
  if (!r) return null;
  const resp = await fetch(r.url);
  if (!resp.ok) throw new Error('Kunne ikke lese bildet fra kameraet');
  return { blob: await resp.blob(), name: r.name };
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lagrer en fil i Nedlastinger på telefonen */
export async function saveToDownloads(name: string, blob: Blob): Promise<string> {
  const r = await native.call<{ where: string }>('saveFile', { name, mime: blob.type || 'application/octet-stream', base64: await toBase64(blob) });
  return r?.where ?? 'Nedlastinger';
}

/** I Android-appen virker ikke «last ned»-lenker for blob-filer. Denne sørger for at de havner i Nedlastinger. */
export function installDownloadShim(onSaved?: (name: string, where: string) => void, onError?: (e: Error) => void) {
  if (!isNative()) return;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download') && /^blob:|^data:/.test(this.href)) {
      const name = this.getAttribute('download') || 'fil';
      fetch(this.href).then((r) => r.blob()).then((b) => saveToDownloads(name, b)).then((w) => onSaved?.(name, w)).catch((e) => onError?.(e));
      return;
    }
    return orig.call(this);
  };
}

/** Laster ned en fil: i Android-appen til Nedlastinger/Feltkart, i nettleseren til nedlastingsmappen. Gir stedet filen havnet. */
export async function saveFile(name: string, blob: Blob): Promise<string> {
  if (isNative()) return saveToDownloads(name, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'nedlastingsmappen';
}

/** Tar bilde i nettleseren: på telefon åpner dette kameraet, på PC et filvalg. Gir null hvis du avbryter. */
export function pickPhotoWeb(): Promise<{ blob: Blob; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => { const f = input.files?.[0]; resolve(f ? { blob: f, name: f.name } : null); };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
