// Prosjekttilstand: mapper, elementer, innstillinger og opplasting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, uid } from './lib/db';
import { readPhoto, isImageFile, makePreview } from './lib/photos';
import { processOrtho, isOrthoFile } from './lib/ortho';
import { isWorldFile } from './lib/jp2';
import type { ParsedDxf } from './lib/dxf';
import { parseVector, vectorFormatOf, FORMAT_LABEL, type Placement } from './lib/vector';
import { fetchGoogleUser } from './lib/google';
import { activeProjectId, projectNameFor, setProjectName } from './lib/projects';
import type { DxfItem, Folder, Item, ItemKind, OrthoItem, PhotoItem, Settings } from './types';

/** Ekstra info per fil ved import fra Google Disk */
export interface UploadOptions {
  meta?: Map<File, { driveId?: string; folderId?: string; modifiedAt?: number; modifiedBy?: string; description?: string }>;
  /** Strøm bilder: lagre bare forhåndsvisning her, originalen hentes fra Google Disk ved behov */
  stream?: boolean;
  /** IFC uten georeferanse: modellens origo */
  placement?: Placement;
}

export type DxfState = { key: string; data?: ParsedDxf; error?: string; loading?: boolean };

export interface UploadResult {
  added: Item[];
  failed: { name: string; reason: string }[];
  messages: string[];
  bounds: [[number, number], [number, number]] | null; // utstrekning av alt som ble lagt til
}

/** Nytt, tomt prosjekt: navnet kommer fra prosjektlisten (første prosjekt heter «Oppdal Ålma») */
const defaultSettings = (): Omit<Settings, 'defaultFolders'> => ({
  projectName: projectNameFor(activeProjectId()),
  projectCrs: 'EPSG:25832',
  basemapId: 'kv-topo',
});

/** Mapperekkefølge: nummererte mapper (01 …, 02 …) først i nummerrekkefølge, deretter øvrige i opprettelsesrekkefølge. */
export function compareFolders(a: Folder, b: Folder): number {
  const na = /^\s*\d/.test(a.name), nb = /^\s*\d/.test(b.name);
  if (na && nb) return a.name.localeCompare(b.name, 'nb', { numeric: true });
  if (na !== nb) return na ? -1 : 1;
  return a.createdAt - b.createdAt;
}

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
  const foldersRef = useRef<Folder[]>([]);
  foldersRef.current = folders;

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
          const root: Folder = { id: uid(), name: defaultSettings().projectName, parentId: null, createdAt: now };
          const mk = (name: string, i: number): Folder => ({ id: uid(), name, parentId: root.id, createdAt: now + i });
          const photos = mk('Bilder', 1), panos = mk('360-bilder', 2), dxfF = mk('Prosjektert (DXF/IFC)', 3), survey = mk('Innmålinger', 4), ortho = mk('Ortofoto (drone)', 5);
          fs = [root, photos, panos, dxfF, survey, ortho];
          for (const f of fs) await db.putFolder(f);
          st = { ...defaultSettings(), defaultFolders: { photo: photos.id, pano: panos.id, dxf: dxfF.id, ortho: ortho.id, survey: survey.id } };
          await db.putSettings(st);
        }
        // Opprydding: elementer hentet fra Google Disk ble tidligere lagt i speilede mapper (Foto, Innmåling, Ortofoto, Prosjektert …)
        // ved siden av standardmappene. Flytt dem til standardmappene og fjern de tomme duplikatene (én gang).
        if (!st.foldersCleaned) {
          const rootF = fs.find((f) => f.parentId === null);
          const def = { ...st.defaultFolders };
          const isDefault = new Set(Object.values(def));
          const legacy = fs.filter((f) => f.parentId === rootF?.id && !isDefault.has(f.id) && /^(foto|innmåling|ortofoto|prosjektert|360)$/i.test(f.name.trim()));
          let changed = false;
          for (const lf of legacy) {
            const ids = descendantFolderIds(fs, lf.id);
            const inside = its.filter((i) => ids.includes(i.folderId));
            if (!inside.every((i) => !!i.driveId)) continue; // inneholder egne filer – la stå
            for (const it of inside) {
              let target: string | undefined;
              if (it.kind === 'photo') target = def.photo;
              else if (it.kind === 'pano') target = def.pano;
              else if (it.kind === 'ortho') target = def.ortho;
              else if (it.kind === 'dxf') {
                if (it.format === 'kof' || it.format === 'sosi' || it.format === 'landxml') {
                  if (!def.survey || !fs.some((f) => f.id === def.survey)) {
                    const nf: Folder = { id: uid(), name: 'Innmålinger', parentId: rootF?.id ?? null, createdAt: Date.now() };
                    fs = [...fs, nf]; await db.putFolder(nf); def.survey = nf.id;
                  }
                  target = def.survey;
                } else target = def.dxf;
              }
              if (target && fs.some((f) => f.id === target)) { it.folderId = target; await db.putItem(it); }
            }
            const left = its.some((i) => ids.includes(i.folderId));
            if (!left) { for (const id of ids) await db.deleteFolder(id); fs = fs.filter((f) => !ids.includes(f.id)); }
            changed = true;
          }
          st = { ...st, defaultFolders: def, foldersCleaned: true };
          await db.putSettings(st);
          if (changed) its = [...its];
        }
        // Det første prosjektet het «Mitt prosjekt» før prosjektlisten kom; gi det det nye standardnavnet (bare om navnet aldri er endret)
        if (activeProjectId() === 'default' && st.projectName === 'Mitt prosjekt') {
          const rootF = fs.find((f) => f.parentId === null);
          const nm = projectNameFor('default');
          st = { ...st, projectName: nm };
          await db.putSettings(st);
          if (rootF && rootF.name === 'Mitt prosjekt') { const nr = { ...rootF, name: nm }; await db.putFolder(nr); fs = fs.map((f) => (f.id === nr.id ? nr : f)); }
        }
        setProjectName(activeProjectId(), st.projectName); // listen over prosjekter viser samme navn som Innstillinger
        setFolders(fs);
        setItems(its);
        setSettings(st);
      } catch (e: any) {
        console.error(e);
        setStorageError('Lagring i nettleseren er ikke tilgjengelig. Endringer forsvinner når siden lastes på nytt.');
        const root: Folder = { id: 'root', name: defaultSettings().projectName, parentId: null, createdAt: Date.now() };
        setFolders([root]);
        setSettings({ ...defaultSettings(), defaultFolders: { photo: 'root', pano: 'root', dxf: 'root', ortho: 'root' } });
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
      // Gi nettleseren et øyeblikk til å tegne "laster" før tung parsing
      new Promise<void>((res) => setTimeout(res, 30))
        .then(() => parseVector(it.blob, it.format ?? 'dxf', it.crs, { detect: false, placement: it.placement }))
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
      if (patch.projectName) setProjectName(activeProjectId(), patch.projectName);
      safe(() => db.putSettings(next));
      return next;
    });
  }, []);

  // ---------- Mapper ----------
  const addFolder = useCallback((name: string, parentId: string | null) => {
    const f: Folder = { id: uid(), name, parentId, createdAt: Date.now() };
    foldersRef.current = [...foldersRef.current, f]; // slik at flere kall på rad ser hverandre
    setFolders((fs) => [...fs, f]);
    safe(() => db.putFolder(f));
    return f;
  }, []);

  /** Finner eller oppretter mappestien under kartets rotmappe og returnerer ID-en til innerste mappe. */
  const ensureFolderPath = useCallback((names: string[]): string => {
    let cur = foldersRef.current.find((f) => f.parentId === null);
    if (!cur) return '';
    for (const n of names) {
      const parent: Folder = cur;
      cur = foldersRef.current.find((f) => f.parentId === parent.id && f.name.toLowerCase() === n.toLowerCase()) ?? addFolder(n, parent.id);
    }
    return cur.id;
  }, [addFolder]);

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

  /** Sletter alt innhold i nettleseren (elementer og ekstra mapper). Rotmappe og standardmapper beholdes. Google Disk berøres ikke. */
  const resetContent = useCallback(() => {
    const st = settings;
    const keep = new Set<string>();
    const root = foldersRef.current.find((f) => f.parentId === null);
    if (root) keep.add(root.id);
    for (const v of Object.values(st?.defaultFolders ?? {})) if (v) keep.add(v as string);
    const doomedItems = itemsRef.current.slice();
    const doomedFolders = foldersRef.current.filter((f) => !keep.has(f.id));
    setItems([]);
    setDxf({});
    setFolders((fs) => fs.filter((f) => keep.has(f.id)));
    safe(async () => {
      for (const it of doomedItems) await db.deleteItem(it.id);
      for (const f of doomedFolders) await db.deleteFolder(f.id);
    });
  }, [settings]);

  /** Endrer beskrivelse og/eller versjon. Sist endret og Endret av oppdateres. */
  const updateMeta = useCallback(async (id: string, patch: { description?: string; version?: string }) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (!it) return;
    const who = settings?.userName?.trim() || (await fetchGoogleUser()) || it.modifiedBy;
    const next: Item = { ...it, ...patch, modifiedAt: Date.now(), modifiedBy: who };
    if (patch.description !== undefined && !patch.description.trim()) delete (next as { description?: string }).description;
    saveItem(next);
  }, [settings, saveItem]);

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
    async (files: File[], target: string, crs: string, onProgress: (msg: string, pct?: number) => void, opts: UploadOptions = {}): Promise<UploadResult> => {
      const res: UploadResult = { added: [], failed: [], messages: [], bounds: null };
      const grow = (b: [[number, number], [number, number]] | null) => {
        if (!b) return;
        if (!res.bounds) { res.bounds = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]]; return; }
        const r = res.bounds;
        r[0][0] = Math.min(r[0][0], b[0][0]); r[0][1] = Math.min(r[0][1], b[0][1]);
        r[1][0] = Math.max(r[1][0], b[1][0]); r[1][1] = Math.max(r[1][1], b[1][1]);
      };
      const st = settings!;
      const folderFor = (kind: ItemKind, f?: File) => (f && opts.meta?.get(f)?.folderId) || (target === 'auto' ? st.defaultFolders[kind] ?? foldersRef.current[0]?.id : target);
      // Innmålinger (KOF/SOSI/LandXML) har egen standardmappe. Mappen opprettes under rotmappen hvis den mangler (eldre prosjekter).
      let surveyFolderId = st.defaultFolders.survey && foldersRef.current.some((x) => x.id === st.defaultFolders.survey) ? st.defaultFolders.survey : undefined;
      const surveyFolderFor = (f: File) => {
        const chosen = opts.meta?.get(f)?.folderId;
        if (chosen || target !== 'auto') return folderFor('dxf', f);
        if (!surveyFolderId) {
          const root = foldersRef.current.find((x) => x.parentId === null) ?? foldersRef.current[0];
          const existing = foldersRef.current.find((x) => x.parentId === (root?.id ?? null) && x.name === 'Innmålinger');
          const nf = existing ?? addFolder('Innmålinger', root?.id ?? null);
          surveyFolderId = nf.id;
          updateSettings({ defaultFolders: { ...st.defaultFolders, survey: nf.id } });
        }
        return surveyFolderId;
      };
      const driveIdOf = (f: File) => opts.meta?.get(f)?.driveId;
      // Egenskaper som vises i Prosjektfiler: sist endret (filens egen dato), endret av (innstilt navn eller Google-brukeren), versjon og beskrivelse
      const who = st.userName?.trim() || (await fetchGoogleUser()) || undefined;
      const metaOf = (f: File) => {
        const m = opts.meta?.get(f);
        return { modifiedAt: m?.modifiedAt ?? (f.lastModified || Date.now()), modifiedBy: m?.modifiedBy ?? who, description: m?.description, version: '1' };
      };
      let noGps = 0;

      // Bilder og ortofoto leses først, slik at DXF/KOF kan plasseres ut fra dem. Vektorfiler leses sist.
      files = [...files.filter((f) => !vectorFormatOf(f.name)), ...files.filter((f) => !!vectorFormatOf(f.name))];
      const refAcc: { s: number; w: number; n: number; e: number } = { s: 90, w: 180, n: -90, e: -180 };
      const addRef = (b: [[number, number], [number, number]] | null) => {
        if (!b) return;
        refAcc.s = Math.min(refAcc.s, b[0][0]); refAcc.w = Math.min(refAcc.w, b[0][1]);
        refAcc.n = Math.max(refAcc.n, b[1][0]); refAcc.e = Math.max(refAcc.e, b[1][1]);
      };
      for (const it of itemsRef.current) {
        if (it.kind === 'photo' || it.kind === 'pano') { if (it.lat !== null) addRef([[it.lat, it.lng!], [it.lat, it.lng!]]); }
        else if (it.kind === 'ortho') addRef(it.bounds);
      }
      const reference = (): [number, number] | null => (refAcc.n >= refAcc.s ? [(refAcc.s + refAcc.n) / 2, (refAcc.w + refAcc.e) / 2] : null);

      const baseName = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
      const sidecars = new Map(files.filter(isWorldFile).map((f) => [baseName(f.name), f] as const));

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (isWorldFile(f)) continue; // brukes sammen med JP2-filen med samme navn
        const prefix = `(${i + 1}/${files.length}) ${f.name}: `;
        const subOf = (m: string) => { const r = /(\d+) %/.exec(m); return r ? Math.min(1, Number(r[1]) / 100) : 0; };
        const rep = (m: string) => onProgress(prefix + m, Math.min(99, ((i + subOf(m)) / files.length) * 100));
        try {
          const vf = vectorFormatOf(f.name);
          if (vf) {
            rep(`leser ${FORMAT_LABEL[vf]} …`);
            const parsed = await parseVector(f, vf, crs, { detect: true, placement: opts.placement, reference: reference(), onProgress: rep }); // valider før lagring
            const useCrs = parsed.crs ?? crs;
            const item: DxfItem = {
              id: uid(), kind: 'dxf', name: f.name, folderId: vf === 'kof' || vf === 'sosi' || vf === 'landxml' ? surveyFolderFor(f) : folderFor('dxf', f), createdAt: Date.now(), driveId: driveIdOf(f), ...metaOf(f),
              crs: useCrs, blob: f, hiddenLayers: [], format: vf,
              placement: vf === 'ifc' && opts.placement ? opts.placement : undefined,
            };
            setDxf((d) => ({ ...d, [item.id]: { key: `${item.id}|${useCrs}`, data: parsed } }));
            saveItem(item);
            res.added.push(item);
            grow(parsed.bounds);
            res.messages.push(`${f.name}: ${parsed.features.length} objekter på ${parsed.layers.length} lag.`);
            if (useCrs !== crs) res.messages.push(`${f.name}: leste koordinatsystemet fra filen (${useCrs}).`);
            parsed.warnings.forEach((w) => res.messages.push(`${f.name}: ${w}`));
          } else if (isOrthoFile(f)) {
            const o = await processOrtho(f, crs, rep, sidecars.get(baseName(f.name)));
            const item: OrthoItem = {
              id: uid(), kind: 'ortho', name: f.name, folderId: folderFor('ortho', f), createdAt: Date.now(), driveId: driveIdOf(f), ...metaOf(f),
              crs: o.crs, image: o.image, preview: o.preview, bounds: o.bounds, opacity: 1, resolution: o.resolution, sourceSize: o.sourceSize,
            };
            saveItem(item);
            res.added.push(item);
            grow(o.bounds);
            addRef(o.bounds);
            if (!o.crsDetected) res.messages.push(`${f.name}: fant ikke koordinatsystem i filen, brukte ${crs}.`);
          } else if (isImageFile(f)) {
            rep('leser bilde …');
            const p = await readPhoto(f);
            const driveId = driveIdOf(f);
            const streamed = !!(opts.stream && driveId);
            if (streamed) { rep('lager forhåndsvisning …'); p.blob = await makePreview(f, p.kind === 'pano' ? 4096 : 1600); }
            const item: PhotoItem = { ...p, id: uid(), name: f.name, folderId: folderFor(p.kind, f), createdAt: Date.now(), driveId, previewOnly: streamed || undefined, ...metaOf(f) };
            saveItem(item);
            res.added.push(item);
            if (item.lat === null) noGps++;
            else { grow([[item.lat, item.lng!], [item.lat, item.lng!]]); addRef([[item.lat, item.lng!], [item.lat, item.lng!]]); }
          } else {
            res.failed.push({ name: f.name, reason: 'Filtypen støttes ikke' });
          }
        } catch (e: any) {
          console.error(e);
          const reason = /^JP2/.test(String(e?.message ?? e)) ? String(e.message) : /createImageBitmap|decode|source image/i.test(String(e?.message ?? e))
            ? 'Bildeformatet kan ikke vises i nettleseren (f.eks. HEIC). Konverter til JPG.'
            : String(e?.message ?? e);
          res.failed.push({ name: f.name, reason });
        }
      }
      if (noGps) res.messages.push(`${noGps} bilde(r) mangler GPS-posisjon. Velg bildet og bruk «Plasser på kart».`);
      return res;
    },
    [settings, saveItem, addFolder, updateSettings],
  );

  return {
    ready, folders, items, settings, dxf, storageError,
    saveItem, saveItems, deleteItem, updateSettings,
    addFolder, ensureFolderPath, renameFolder, deleteFolder, resetContent,
    setVisible, setFolderVisible, toggleDxfLayer, updateMeta, upload,
  };
}

export type Project = ReturnType<typeof useProject>;
