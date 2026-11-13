import { useMemo, useRef, useState } from 'react';
import type { Project } from '../state';
import type { DxfItem, Item, PhotoItem } from '../types';
import {
  driveFileExists, ensureDrivePath, fetchDriveBlob, getAccessToken, isSignedIn, listFolderFiles, pickFiles, pickFolder, signOut,
  uploadDriveFile, type DriveAccess, type DriveFileInfo,
} from '../lib/google';
import { isWorldFile } from '../lib/jp2';
import { usePickerOpen } from '../lib/usePickerOpen';
import { googleConfig } from './DriveDialog';
import { DEMO_FOLDER_URL } from '../lib/demo';
import { hasDemoKey, loadDemoData, supportedDriveFile } from '../lib/demoLoad';
import { IconClose, IconFolder } from './icons';

interface Props {
  project: Project;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenTemplates: () => void;
  onImported: (added: number, bounds: [[number, number], [number, number]] | null) => void;
}

const sizeFmt = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} kB` : '');
const supported = supportedDriveFile;

type Tab = 'hent' | 'last';

export default function SyncDialog({ project, onClose, onOpenSettings, onOpenTemplates, onImported }: Props) {
  const settings = project.settings!;
  const access: DriveAccess = settings.driveAccess ?? 'file';
  const cfg = googleConfig(project);
  const folder = settings.driveFolder ?? (settings.drive ? { id: settings.drive.id, name: settings.drive.name, url: settings.drive.url } : null);
  const pickerOpen = usePickerOpen();

  const [tab, setTab] = useState<Tab>('hent');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(isSignedIn());

  // Hent
  const [found, setFound] = useState<DriveFileInfo[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [stream, setStream] = useState(true);
  const [mirror, setMirror] = useState(true);

  // Last opp
  const [local, setLocal] = useState<File[]>([]);
  const [alsoMap, setAlsoMap] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const imported = useMemo(() => new Set(project.items.map((i) => i.driveId).filter(Boolean) as string[]), [project.items]);
  const notOnDrive = useMemo(() => project.items.filter((i) => !i.driveId && i.kind !== 'ortho'), [project.items]);
  const orthoNotOnDrive = project.items.filter((i) => i.kind === 'ortho' && !i.driveId).length;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setOkMsg(null);
    setBusy(true);
    try { await fn(); } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(false);
    setMsg('');
    setSignedIn(isSignedIn());
  };

  const setAccess = (a: DriveAccess) => {
    if (a === access) return;
    signOut(); // nytt tilgangsnivå krever nytt samtykke hos Google
    setSignedIn(false);
    setFound(null);
    project.updateSettings({ driveAccess: a });
  };

  const choose = () => run(async () => {
    const f = await pickFolder(cfg, 'Velg mappen som skal kobles til prosjektet');
    if (f) {
      project.updateSettings({ driveFolder: { id: f.id, name: f.name, url: f.url ?? `https://drive.google.com/drive/folders/${f.id}` } });
      setFound(null);
    }
  });

  // ---------- Hent fra mappen ----------
  const scan = () => run(async () => {
    if (!folder) throw new Error('Koble til en mappe først.');
    const list = await listFolderFiles(cfg, folder.id, (n, d) => setMsg(`Skanner … ${n} filer i ${d} mapper`));
    const usable = list.filter((f) => supported(f.name, f.mimeType));
    setFound(usable);
    setSel(new Set(usable.filter((f) => !imported.has(f.id) && !isWorldFile({ name: f.name } as File)).map((f) => f.id)));
    if (!usable.length) setOkMsg(`Fant ${list.length} filer, men ingen bilder, DXF eller ortofoto.`);
  });

  const pickManually = () => run(async () => {
    const picked = await pickFiles(cfg, folder?.id);
    const list: DriveFileInfo[] = picked.filter((p) => supported(p.name, p.mimeType)).map((p) => ({ id: p.id, name: p.name, mimeType: p.mimeType, size: Number(p.sizeBytes) || 0, path: [] }));
    setFound((old) => [...(old ?? []).filter((o) => !list.some((l) => l.id === o.id)), ...list]);
    setSel((s) => new Set([...s, ...list.map((l) => l.id)]));
  });

  /** Henter valgte Disk-filer og legger dem i kartet. */
  const importList = async (chosen: DriveFileInfo[], pool: DriveFileInfo[], c: typeof cfg, doStream: boolean) => {
    // world files følger med JP2-filer i samme mappe
    const extras = pool.filter((f) => isWorldFile({ name: f.name } as File) && !chosen.includes(f) &&
      chosen.some((x) => x.path.join('/') === f.path.join('/') && x.name.replace(/\.[^.]+$/, '').toLowerCase() === f.name.replace(/\.[^.]+$/, '').toLowerCase()));
    const all = [...chosen, ...extras];
    const files: File[] = [];
    const meta = new Map<File, { driveId?: string; folderId?: string }>();
    const errs: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      setMsg(`Henter ${i + 1} av ${all.length}: ${d.name} (${sizeFmt(d.size)}) …`);
      try {
        const blob = await fetchDriveBlob(c, d.id, d.name);
        const f = new File([blob], d.name, { type: d.mimeType });
        files.push(f);
        meta.set(f, { driveId: d.id, folderId: mirror && d.path.length ? project.ensureFolderPath(d.path) : undefined });
      } catch (e: any) { errs.push(String(e?.message ?? e)); }
    }
    if (files.length) {
      const r = await project.upload(files, 'auto', settings.projectCrs, setMsg, { meta, stream: doStream });
      errs.push(...r.failed.map((x) => `${x.name}: ${x.reason}`));
      setOkMsg(`${r.added.length} element(er) hentet fra Google Disk${doStream ? ' (bilder strømmes fra Disk)' : ''}.`);
      setSel(new Set());
      onImported(r.added.length, r.bounds);
    }
    if (errs.length) setError(errs.join(' '));
  };

  const importSelected = () => run(async () => {
    if (!found) return;
    await importList(found.filter((f) => sel.has(f.id)), found, cfg, stream);
  });

  // ---------- Demodata (offentlig delt mappe) ----------
  const loadDemo = () => run(async () => {
    const r = await loadDemoData(project, cfg, setMsg, { replace: true });
    if (r.message) setError(r.message);
    if (r.added) { setOkMsg(`${r.added} element(er) hentet fra demomappen.`); onImported(r.added, r.bounds); }
    else if (!r.message) setOkMsg('Demodataene ligger allerede i kartet.');
  });

  // ---------- Last opp til mappen ----------
  const pathOf = (folderId: string): string[] => {
    const out: string[] = [];
    let cur = project.folders.find((f) => f.id === folderId);
    while (cur && cur.parentId !== null) { out.unshift(cur.name); cur = project.folders.find((f) => f.id === cur!.parentId); }
    return out;
  };

  const uploadNow = () => run(async () => {
    if (!folder) throw new Error('Koble til en mappe først.');
    const cache = new Map<string, string>();
    const jobs: { blob: Blob; name: string; path: string[]; item?: Item; file?: File }[] = [];
    for (const f of local) jobs.push({ blob: f, name: f.name, path: [], file: f });
    for (const it of notOnDrive) {
      const blob = (it as PhotoItem | DxfItem).blob;
      if (blob) jobs.push({ blob: blob, name: it.name, path: pathOf(it.folderId), item: it });
    }
    if (!jobs.length) throw new Error('Ingenting å laste opp.');
    let done = 0, skipped = 0;
    const errs: string[] = [];
    const uploadedLocal = new Map<File, string>();
    const itemUpdates: Item[] = [];
    for (const j of jobs) {
      setMsg(`Laster opp ${++done} av ${jobs.length}: ${j.name} …`);
      try {
        const parent = await ensureDrivePath(cfg, folder.id, j.path, cache);
        if (skipExisting) {
          const ex = await driveFileExists(cfg, j.name, parent).catch(() => null);
          if (ex) {
            skipped++;
            if (j.item) itemUpdates.push({ ...j.item, driveId: ex });
            if (j.file) uploadedLocal.set(j.file, ex);
            continue;
          }
        }
        const id = await uploadDriveFile(cfg, j.blob, j.name, parent, (p) => setMsg(`Laster opp ${done} av ${jobs.length}: ${j.name} (${Math.round(p * 100)} %)`));
        if (j.item) itemUpdates.push({ ...j.item, driveId: id });
        if (j.file) uploadedLocal.set(j.file, id);
      } catch (e: any) { errs.push(String(e?.message ?? e)); }
    }
    project.saveItems(itemUpdates);
    if (alsoMap && uploadedLocal.size) {
      const files = [...uploadedLocal.keys()].filter((f) => supported(f.name, f.type));
      const meta = new Map(files.map((f) => [f, { driveId: uploadedLocal.get(f)! }] as const));
      // world files uten id følger med
      const r = await project.upload(files, 'auto', settings.projectCrs, setMsg, { meta });
      r.failed.forEach((x) => errs.push(`${x.name}: ${x.reason}`));
      onImported(r.added.length, r.bounds);
    }
    setLocal([]);
    setOkMsg(`${jobs.length - errs.length - skipped} fil(er) lastet opp${skipped ? `, ${skipped} fantes fra før` : ''}.`);
    if (errs.length) setError(errs.join(' '));
  });

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visibleFound = (found ?? []).filter((f) => !isWorldFile({ name: f.name } as File));
  const uploadCount = local.length + notOnDrive.length;

  return (
    <div className="modal-back" style={pickerOpen ? { display: 'none' } : undefined} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal sync">
        <div className="modal-head">
          <h2>Google Disk-mappe</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Lukk"><IconClose /></button>
        </div>

        <div className="modal-body">
          {!cfg.clientId && (
            <div className="notice">Google-innlogging er ikke satt opp. Legg inn Client ID under <button className="link-btn" onClick={onOpenSettings}>Innstillinger</button>.</div>
          )}

          <div className="folder-card">
            <IconFolder size={22} className="kind-folder" />
            <div className="grow">
              <strong>Demodata</strong>
              <span className="muted small" style={{ display: 'block' }}>Laster eksempeldata fra en delt mappe – uten innlogging. <a href={DEMO_FOLDER_URL} target="_blank" rel="noreferrer">Åpne mappen ↗</a></span>
              {!hasDemoKey(cfg) && <span className="small error">Mangler Google API-nøkkel (se README: Demodata).</span>}
            </div>
            <button className="btn primary" onClick={loadDemo} disabled={busy}>Last demodata</button>
          </div>
          {busy && msg && <p className="muted small" style={{ margin: '-4px 0 10px' }}>{msg}</p>}
          {error && <p className="error small" style={{ margin: '-4px 0 10px' }}>{error}</p>}
          {okMsg && <div className="success" style={{ margin: '-4px 0 10px' }}>{okMsg}</div>}

          <div className="folder-card">
            <IconFolder size={22} className="kind-folder" />
            <div className="grow">
              {folder ? <><strong>{folder.name}</strong><a className="small" href={folder.url} target="_blank" rel="noreferrer">Åpne i Google Disk ↗</a></>
                : <><strong>Ingen mappe koblet til</strong><span className="muted small">Velg mappen der prosjektdataene ligger (eller skal ligge).</span></>}
            </div>
            <button className="btn" onClick={choose} disabled={busy || !cfg.clientId}>{folder ? 'Bytt mappe' : 'Velg mappe …'}</button>
          </div>
          <p className="small" style={{ margin: '-6px 0 14px' }}>
            Ny mappe? <button className="link-btn" onClick={onOpenTemplates} disabled={busy}>Opprett prosjektmapper fra mal</button>
          </p>

          <div className="field">
            <label>Tilgangsnivå mot Google Disk</label>
            <div className="seg" role="group">
              <button className={access === 'file' ? 'on' : ''} onClick={() => setAccess('file')} disabled={busy}>Begrenset</button>
              <button className={access === 'full' ? 'on' : ''} onClick={() => setAccess('full')} disabled={busy}>Full (skann hele mappen)</button>
            </div>
            <p className="muted small">
              {access === 'file'
                ? 'Feltkart ser bare filer du velger i filvelgeren og filer Feltkart selv har lagt inn.'
                : 'Feltkart kan skanne mappen og undermapper og lese/skrive filer der. Du må legge til tilgangen «…/auth/drive» under Datatilgang i Google Cloud og logge inn på nytt.'}
            </p>
          </div>

          <div className="tabs">
            <button className={tab === 'hent' ? 'on' : ''} onClick={() => setTab('hent')}>Hent fra mappen</button>
            <button className={tab === 'last' ? 'on' : ''} onClick={() => setTab('last')}>Last opp til mappen</button>
          </div>

          {tab === 'hent' && (
            <>
              <div className="sync-toolbar">
                {access === 'full'
                  ? <button className="btn primary" onClick={scan} disabled={busy || !folder || !cfg.clientId}>{found ? 'Skann på nytt' : 'Skann mappen'}</button>
                  : null}
                <button className="btn" onClick={pickManually} disabled={busy || !cfg.clientId}>Velg filer …</button>
                {msg && <span className="muted small">{msg}</span>}
              </div>

              {found && (
                <>
                  <div className="sync-list">
                    {visibleFound.length === 0 && <div className="sync-row muted">Ingen støttede filer.</div>}
                    {visibleFound.map((f) => {
                      const inMap = imported.has(f.id);
                      return (
                        <label key={f.id} className={`sync-row${inMap ? ' done' : ''}`}>
                          <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} disabled={busy} />
                          <span className="label" title={f.name}>{f.name}</span>
                          <span className="path">{f.path.join(' / ')}</span>
                          <span className="muted small">{inMap ? 'i kartet' : sizeFmt(f.size)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="sync-options">
                    <label className="check"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} disabled={busy} /> Strøm bilder fra Disk (lagrer bare forhåndsvisning her, originalen hentes fra Disk når du åpner bildet)</label>
                    <label className="check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} disabled={busy} /> Lag samme undermapper i kartets innhold</label>
                  </div>
                  <button className="btn primary" onClick={importSelected} disabled={busy || sel.size === 0}>
                    {busy ? 'Henter …' : `Hent ${sel.size} valgte til kartet`}
                  </button>
                </>
              )}
              {!found && access === 'file' && <p className="muted small">Begrenset tilgang: bruk «Velg filer …» og merk filene du vil ha. Bytt til «Full» hvis Feltkart skal finne alt i mappen selv.</p>}
              {!found && access === 'full' && <p className="muted small">«Skann mappen» lister bilder, DXF og ortofoto i mappen og alle undermapper.</p>}
            </>
          )}

          {tab === 'last' && (
            <>
              <p className="small">Filene havner i den koblede mappen, med samme undermapper som i kartets innhold.</p>
              <div className="sync-toolbar">
                <button className="btn" onClick={() => input.current?.click()} disabled={busy}>Velg filer fra datamaskinen …</button>
                <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) setLocal((l) => [...l, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                {msg && <span className="muted small">{msg}</span>}
              </div>
              {local.length > 0 && (
                <div className="sync-list">
                  {local.map((f, i) => (
                    <div key={i} className="sync-row">
                      <span className="label">{f.name}</span><span className="muted small">{sizeFmt(f.size)}</span>
                      {!busy && <button className="icon-btn" onClick={() => setLocal(local.filter((_, j) => j !== i))} aria-label="Fjern"><IconClose size={14} /></button>}
                    </div>
                  ))}
                </div>
              )}
              <div className="sync-options">
                <label className="check"><input type="checkbox" checked={alsoMap} onChange={(e) => setAlsoMap(e.target.checked)} disabled={busy} /> Legg også filene fra datamaskinen til i kartet</label>
                <label className="check"><input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} disabled={busy} /> Hopp over filer som allerede finnes i mappen (samme navn)</label>
              </div>
              <p className="small">
                {notOnDrive.length > 0
                  ? <>{notOnDrive.length} element(er) i kartet ligger ikke på Disk ennå og lastes også opp.</>
                  : 'Alle bilder og DXF-filer i kartet ligger allerede på Disk.'}
                {orthoNotOnDrive > 0 && <> Ortofoto ({orthoNotOnDrive}) lagres i nettleseren som ferdig bearbeidet bilde. Last opp originalfilen via «Velg filer fra datamaskinen».</>}
              </p>
              <button className="btn primary" onClick={uploadNow} disabled={busy || !folder || uploadCount === 0 || !cfg.clientId}>
                {busy ? 'Laster opp …' : `Last opp ${uploadCount} fil(er) til Google Disk`}
              </button>
            </>
          )}

        </div>

        <div className="modal-foot pad">
          <span className="muted small progress">
            {cfg.clientId && (signedIn
              ? <>Logget inn hos Google · <button className="link-btn" onClick={() => { signOut(); setSignedIn(false); }}>Logg ut</button></>
              : <button className="link-btn" onClick={() => run(async () => { await getAccessToken(cfg); })}>Logg inn med Google</button>)}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Lukk</button>
        </div>
      </div>
    </div>
  );
}
