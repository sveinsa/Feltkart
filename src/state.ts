// Prosjekttilstand: mapper, elementer, innstillinger og opplasting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, uid } from './lib/db';
import { readPhoto, isImageFile } from './lib/photos';
import { processOrtho, isTiff } from './lib/ortho';
import { parseDxf, type ParsedDxf } from './lib/dxf';
import type { DxfItem, Folder, Item, ItemKind, OrthoItem, PhotoItem, Settings } from './types';

export type DxfState = { key: string; data?: ParsedDxf; error?: string; loading?: boolean };

export interface UploadResult {
  added: Item[];
  failed: { name: string; reason: string }[];
  messages: string[];
  bounds: [[number, number], [number, number]] | null; // utstrekning av alt som ble lagt til
}

const DEFAULT_SETTINGS: Omit<Settings, 'defaultFolders'> = {
  projectName: 'Mitt prosjekt',
  projectCrs: 'EPSG:25832',
  basemapId: 'kv-topo',
};

export function descendantFolderIds(folders: Folder[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parentId === out[i]) out.push(f.id);
  return out;
}

export function useProject() {
  const [ready, setReady] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dxf, setDxf] = useState<Record<string, DxfState>>({});
  const [storageError, setStorageError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Last inn (og opprett startmapper første gang)
  const loadStarted = useRef(false);
  useEffect(() => {
    if (loadStarted.current) return; // React StrictMode kjører effekter to ganger i utvikling
    loadStarted.current = true;
    (async () => {
      try {
        let [fs, its, st] = await Promise.all([db.getFolders(), db.getItems(), db.getSettings()]);
        if (!fs.length || !st) {
          const now = Date.now();
          const root: Folder = { id: uid(), name: DEFAULT_SETTINGS.projectName, parentId: null, createdAt: now };
          const mk = (name: string, i: number): Folder => ({ id: uid(), name, parentId: root.id, createdAt: now + i });
          const photos = mk('Bilder', 1), panos = mk('360-bilder', 2), dxfF = mk('Prosjektert (DXF)', 3), ortho = mk('Ortofoto (drone)', 4);
          fs = [root, photos, panos, dxfF, ortho];
          for (const f of fs) await db.putFolder(f);
          st = { ...DEFAULT_SETTINGS, defaultFolders: { photo: photos.id, pano: panos.id, dxf: dxfF.id, ortho: ortho.id } };
          await db.putSettings(st);
        }
        setFolders(fs);
        setItems(its);
        setSettings(st);
      } catch (e: any) {
        console.error(e);
        setStorageError('Lagring i nettleseren er ikke tilgjengelig. Endringer forsvinner når siden lastes på nytt.');
        const root: Folder = { id: 'root', name: DEFAULT_SETTINGS.projectName, parentId: null, createdAt: Date.now() };
        setFolders([root]);
        setSettings({ ...DEFAULT_SETTINGS, defaultFolders: { photo: 'root', pano: 'root', dxf: 'root', ortho: 'root' } });
      }
      setReady(true);
    })();
  }, []);

  // Les og tolk DXF-filer (bufres per fil + koordinatsystem)
  useEffect(() => {
    for (const it of items) {
      if (it.kind !== 'dxf') continue;
      const key = `${it.id}|${it.crs}`;
      if (dxf[it.id]?.key === key) continue;
      setDxf((d) => ({ ...d, [it.id]: { key, loading: true } }));
      it.blob
        .text()
        .then((text) => {
          // Gi nettleseren et øyeblikk til å tegne "laster" før tung parsing
          return new Promise<ParsedDxf>((res, rej) => setTimeout(() => { try { res(parseDxf(text, it.crs)); } catch (e) { rej(e); } }, 30));
        })
        .then((data) => setDxf((d) => ({ ...d, [it.id]: { key, data } })))
        .catch((e) => setDxf((d) => ({ ...d, [it.id]: { key, error: String(e?.message ?? e) } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const safe = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { console.warn('Lagring feilet', e); }
  };

  const saveItem = useCallback((item: Item) => {
    setItems((list) => {
      const i = list.findIndex((x) => x.id === item.id);
      if (i === -1) return [...list, item];
      const copy = list.slice();
      copy[i] = item;
      return copy;
    });
    safe(() => db.putItem(item));
  }, []);

  const saveItems = useCallback((changed: Item[]) => {
    if (!changed.length) return;
    const map = new Map(changed.map((c) => [c.id, c]));
    setItems((list) => list.map((x) => map.get(x.id) ?? x));
    safe(async () => { for (const c of changed) await db.putItem(c); });
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems((list) => list.filter((x) => x.id !== id));
    setDxf((d) => { const c = { ...d }; delete c[id]; return c; });
    safe(() => db.deleteItem(id));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...(s as Settings), ...patch };
      safe(() => db.putSettings(next));
      return next;
    });
  }, []);

  // ---------- Mapper ----------
  const addFolder = useCallback((name: string, parentId: string | null) => {
    const f: Folder = { id: uid(), name, parentId, createdAt: Date.now() };
    setFolders((fs) => [...fs, f]);
    safe(() => db.putFolder(f));
    return f;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    setFolders((fs) => fs.map((f) => {
      if (f.id !== id) return f;
      const n = { ...f, name };
      safe(() => db.putFolder(n));
      return n;
    }));
    if (settings && folders.find((f) => f.id === id)?.parentId === null) updateSettings({ projectName: name });
  }, [folders, settings, updateSettings]);

  const deleteFolder = useCallback((id: string) => {
    const ids = descendantFolderIds(folders, id);
    const doomed = itemsRef.current.filter((i) => ids.includes(i.folderId));
    setFolders((fs) => fs.filter((f) => !ids.includes(f.id)));
    setItems((list) => list.filter((i) => !ids.includes(i.folderId)));
    safe(async () => {
      for (const fid of ids) await db.deleteFolder(fid);
      for (const it of doomed) await db.deleteItem(it.id);
    });
  }, [folders]);

  // ---------- Synlighet ----------
  const setVisible = useCallback((ids: string[], visible: boolean) => {
    const set = new Set(ids);
    saveItems(itemsRef.current.filter((i) => set.has(i.id) && !!i.hidden === visible).map((i) => ({ ...i, hidden: !visible })));
  }, [saveItems]);

  const setFolderVisible = useCallback((folderId: string, visible: boolean) => {
    const ids = new Set(descendantFolderIds(folders, folderId));
    setVisible(itemsRef.current.filter((i) => ids.has(i.folderId)).map((i) => i.id), visible);
  }, [folders, setVisible]);

  const toggleDxfLayer = useCallback((itemId: string, layer: string, visible?: boolean) => {
    const it = itemsRef.current.find((i) => i.id === itemId) as DxfItem | undefined;
    if (!it || it.kind !== 'dxf') return;
    const hidden = new Set(it.hiddenLayers);
    const show = visible ?? hidden.has(layer);
    if (show) hidden.delete(layer); else hidden.add(layer);
    saveItem({ ...it, hiddenLayers: [...hidden] });
  }, [saveItem]);

  // ---------- Opplasting ----------
  const upload = useCallback(
    async (files: File[], target: string, crs: string, onProgress: (msg: string) => void): Promise<UploadResult> => {
      const res: UploadResult = { added: [], failed: [], messages: [], bounds: null };
      const grow = (b: [[number, number], [number, number]] | null) => {
        if (!b) return;
        if (!res.bounds) { res.bounds = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]]; return; }
        const r = res.bounds;
        r[0][0] = Math.min(r[0][0], b[0][0]); r[0][1] = Math.min(r[0][1], b[0][1]);
        r[1][0] = Math.max(r[1][0], b[1][0]); r[1][1] = Math.max(r[1][1], b[1][1]);
      };
      const st = settings!;
      const folderFor = (kind: ItemKind) => (target === 'auto' ? st.defaultFolders[kind] ?? folders[0]?.id : target);
      let noGps = 0;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const prefix = `(${i + 1}/${files.length}) ${f.name}: `;
        try {
          if (/\.dxf$/i.test(f.name)) {
            onProgress(prefix + 'leser DXF …');
            const text = await f.text();
            const parsed = parseDxf(text, crs); // valider før lagring
            const item: DxfItem = {
              id: uid(), kind: 'dxf', name: f.name, folderId: folderFor('dxf'), createdAt: Date.now(),
              crs, blob: new Blob([text], { type: 'application/dxf' }), hiddenLayers: [],
            };
            setDxf((d) => ({ ...d, [item.id]: { key: `${item.id}|${crs}`, data: parsed } }));
            saveItem(item);
            res.added.push(item);
            grow(parsed.bounds);
            res.messages.push(`${f.name}: ${parsed.features.length} objekter på ${parsed.layers.length} lag.`);
            parsed.warnings.forEach((w) => res.messages.push(`${f.name}: ${w}`));
          } else if (isTiff(f)) {
            const o = await processOrtho(f, crs, (m) => onProgress(prefix + m));
            const item: OrthoItem = {
              id: uid(), kind: 'ortho', name: f.name, folderId: folderFor('ortho'), createdAt: Date.now(),
              crs: o.crs, image: o.image, bounds: o.bounds, opacity: 1, resolution: o.resolution, sourceSize: o.sourceSize,
            };
            saveItem(item);
            res.added.push(item);
            grow(o.bounds);
            if (!o.crsDetected) res.messages.push(`${f.name}: fant ikke koordinatsystem i filen, brukte ${crs}.`);
          } else if (isImageFile(f)) {
            onProgress(prefix + 'leser bilde …');
            const p = await readPhoto(f);
            const item: PhotoItem = { ...p, id: uid(), name: f.name, folderId: folderFor(p.kind), createdAt: Date.now() };
            saveItem(item);
            res.added.push(item);
            if (item.lat === null) noGps++;
            else grow([[item.lat, item.lng!], [item.lat, item.lng!]]);
          } else {
            res.failed.push({ name: f.name, reason: 'Filtypen støttes ikke' });
          }
        } catch (e: any) {
          console.error(e);
          const reason = /createImageBitmap|decode|source image/i.test(String(e?.message ?? e))
            ? 'Bildeformatet kan ikke vises i nettleseren (f.eks. HEIC). Konverter til JPG.'
            : String(e?.message ?? e);
          res.failed.push({ name: f.name, reason });
        }
      }
      if (noGps) res.messages.push(`${noGps} bilde(r) mangler GPS-posisjon. Velg bildet og bruk «Plasser på kart».`);
      return res;
    },
    [settings, folders, saveItem],
  );

  return {
    ready, folders, items, settings, dxf, storageError,
    saveItem, saveItems, deleteItem, updateSettings,
    addFolder, renameFolder, deleteFolder,
    setVisible, setFolderVisible, toggleDxfLayer, upload,
  };
}

export type Project = ReturnType<typeof useProject>;
