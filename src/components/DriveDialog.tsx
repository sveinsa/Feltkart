import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../state';
import type { Folder } from '../types';
import {
  DEFAULT_TEMPLATES, countNodes, parseTemplate, resolveTree, treeToText,
  type FolderTemplate, type TemplateNode,
} from '../lib/templates';
import {
  createDriveTree, envGoogleConfig, getAccessToken, isSignedIn, pickFolder, preloadGoogle, signOut,
  type GoogleConfig, type PickedFolder,
} from '../lib/google';
import { uid } from '../lib/db';
import { IconClose, IconFolder, IconFolderOpen, IconPlus, IconTrash } from './icons';

interface Props {
  project: Project;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function googleConfig(project: Project): GoogleConfig {
  const env = envGoogleConfig();
  const s = project.settings?.google;
  return {
    clientId: s?.clientId?.trim() || env.clientId,
    apiKey: s?.apiKey?.trim() || env.apiKey,
    appId: s?.appId?.trim() || env.appId,
  };
}

function PreviewTree({ nodes, depth = 0 }: { nodes: TemplateNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={i}>
          <div className="pv-row" style={{ paddingLeft: depth * 16 }}>
            {n.children.length ? <IconFolderOpen size={14} className="kind-folder" /> : <IconFolder size={14} className="kind-folder" />}
            <span>{n.name}</span>
          </div>
          {n.children.length > 0 && <PreviewTree nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

export default function DriveDialog({ project, onClose, onOpenSettings }: Props) {
  const settings = project.settings!;
  const cfg = googleConfig(project);
  const templates: FolderTemplate[] = settings.templates?.length ? settings.templates : DEFAULT_TEMPLATES;

  const [tplId, setTplId] = useState(templates[0].id);
  const current = templates.find((t) => t.id === tplId) ?? templates[0];
  const [draftName, setDraftName] = useState(current.name);
  const [draft, setDraft] = useState(current.text);
  const [nr, setNr] = useState(settings.projectNumber ?? '');
  const [name, setName] = useState(settings.projectName);
  const [target, setTarget] = useState<'root' | 'picked'>('root');
  const [picked, setPicked] = useState<PickedFolder | null>(null);
  const [reuse, setReuse] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; current: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; created: number; reused: number } | null>(null);
  const [signedIn, setSignedIn] = useState(isSignedIn());

  useEffect(() => { if (cfg.clientId) preloadGoogle(); }, [cfg.clientId]);
  useEffect(() => { setDraftName(current.name); setDraft(current.text); }, [tplId]);

  const parsed = useMemo(() => parseTemplate(draft), [draft]);
  const resolved = useMemo(() => resolveTree(parsed.roots, { prosjektnr: nr, prosjektnavn: name }), [parsed, nr, name]);
  const total = countNodes(resolved);
  const dirty = draft !== current.text || draftName !== current.name;

  // ---------- Maler ----------
  const saveTemplates = (list: FolderTemplate[]) => project.updateSettings({ templates: list });
  const saveCurrent = () => saveTemplates(templates.map((t) => (t.id === current.id ? { ...t, name: draftName.trim() || t.name, text: draft } : t)));
  const newTemplate = (text = '{prosjektnr} {prosjektnavn}\n  Ny mappe', tname = 'Ny mal') => {
    const t: FolderTemplate = { id: uid(), name: tname, text };
    saveTemplates([...templates, t]);
    setTplId(t.id);
  };
  const deleteTemplate = () => {
    if (templates.length <= 1) return;
    const rest = templates.filter((t) => t.id !== current.id);
    saveTemplates(rest);
    setTplId(rest[0].id);
  };
  const fromMapFolders = () => {
    const fs = project.folders;
    const build = (parentId: string): TemplateNode[] =>
      fs.filter((f) => f.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt).map((f) => ({ name: f.name, children: build(f.id) }));
    const root = fs.find((f) => f.parentId === null);
    if (!root) return;
    newTemplate(treeToText([{ name: '{prosjektnr} {prosjektnavn}', children: build(root.id) }]), 'Fra kartets mapper');
  };

  // ---------- Google ----------
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (e: any) { setError(String(e?.message ?? e)); }
    setSignedIn(isSignedIn());
  };

  const choose = () => run(async () => {
    const f = await pickFolder(cfg);
    if (f) { setPicked(f); setTarget('picked'); }
  });

  const create = () => run(async () => {
    if (!total) throw new Error('Malen inneholder ingen mapper.');
    if (target === 'picked' && !picked) throw new Error('Velg en mappe først, eller bruk Min disk.');
    if (dirty) saveCurrent();
    setBusy(true);
    setResult(null);
    try {
      const r = await createDriveTree(cfg, resolved, target === 'picked' ? picked!.id : 'root', reuse, (done, cur) => setProgress({ done, current: cur }));
      setResult({ url: r.rootUrl, created: r.created, reused: r.reused });
      project.updateSettings({
        projectNumber: nr,
        drive: { id: r.rootId, url: r.rootUrl, name: resolved[0]?.name ?? '', createdAt: new Date().toISOString() },
      });
      if (mirror) mirrorToMap();
    } finally {
      setBusy(false);
    }
  });

  // Opprett samme struktur i kartets innhold (hopper over toppnivået hvis malen har én rotmappe = prosjektet)
  const mirrorToMap = () => {
    const appRoot = project.folders.find((f) => f.parentId === null);
    if (!appRoot) return;
    const nodes = resolved.length === 1 ? resolved[0].children : resolved;
    const existing: Folder[] = [...project.folders];
    const walk = (list: TemplateNode[], parentId: string) => {
      for (const n of list) {
        let f = existing.find((x) => x.parentId === parentId && x.name.toLowerCase() === n.name.toLowerCase());
        if (!f) { f = project.addFolder(n.name, parentId); existing.push(f); }
        walk(n.children, f.id);
      }
    };
    walk(nodes, appRoot.id);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal drive">
        <div className="modal-head">
          <h2>Opprett prosjektmapper på Google Disk</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Lukk"><IconClose /></button>
        </div>

        <div className="modal-body drive-grid">
          {/* Venstre: mal */}
          <section>
            <div className="field">
              <label>Mappemal</label>
              <div className="row-inline">
                <select value={current.id} onChange={(e) => setTplId(e.target.value)} disabled={busy}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="icon-btn" title="Ny mal" onClick={() => newTemplate()} disabled={busy}><IconPlus size={16} /></button>
                <button className="icon-btn" title="Slett mal" onClick={deleteTemplate} disabled={busy || templates.length <= 1}><IconTrash size={16} /></button>
              </div>
            </div>
            <div className="field">
              <label>Navn på mal</label>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label>Mappestruktur (ett innrykk = to mellomrom eller tab)</label>
              <textarea className="tpl-editor" spellCheck={false} value={draft} disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Tab') return;
                  e.preventDefault();
                  const ta = e.currentTarget, s = ta.selectionStart, en = ta.selectionEnd;
                  const next = draft.slice(0, s) + '  ' + draft.slice(en);
                  setDraft(next);
                  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
                }} />
              <p className="muted small">Variabler: <code>{'{prosjektnr}'}</code> <code>{'{prosjektnavn}'}</code> <code>{'{år}'}</code> <code>{'{dato}'}</code>. Linjer som starter med # ignoreres.</p>
              {parsed.errors.map((er, i) => <p key={i} className="small error">{er}</p>)}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={saveCurrent} disabled={!dirty || busy}>{dirty ? 'Lagre mal' : 'Lagret'}</button>
              <button className="btn" onClick={fromMapFolders} disabled={busy}>Hent fra kartets mapper</button>
            </div>
          </section>

          {/* Høyre: prosjekt og plassering */}
          <section>
            <div className="form-grid tight">
              <div className="field"><label>Prosjektnummer</label><input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="f.eks. 24017" disabled={busy} /></div>
              <div className="field"><label>Prosjektnavn</label><input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></div>
            </div>

            <div className="field">
              <label>Plassering på Google Disk</label>
              <label className="radio"><input type="radio" checked={target === 'root'} onChange={() => setTarget('root')} disabled={busy} /> Min disk</label>
              <label className="radio">
                <input type="radio" checked={target === 'picked'} onChange={() => (picked ? setTarget('picked') : choose())} disabled={busy || !cfg.clientId} />
                {picked ? <>I mappen <strong>{picked.name}</strong></> : 'I en mappe jeg velger (også delte disker)'}
                <button className="link-btn" onClick={choose} disabled={busy || !cfg.clientId}>{picked ? 'Bytt' : 'Velg …'}</button>
              </label>
            </div>

            <label className="check"><input type="checkbox" className="chk" checked={reuse} onChange={(e) => setReuse(e.target.checked)} disabled={busy} /> Gjenbruk mapper som allerede finnes (unngår duplikater)</label>
            <label className="check"><input type="checkbox" className="chk" checked={mirror} onChange={(e) => setMirror(e.target.checked)} disabled={busy} /> Opprett også samme mapper i kartets innhold</label>

            <div className="preview">
              <div className="preview-head"><strong>Forhåndsvisning</strong><span className="muted small">{total} mapper</span></div>
              <div className="preview-body">{resolved.length ? <PreviewTree nodes={resolved} /> : <span className="muted">Ingen mapper</span>}</div>
            </div>

            {!cfg.clientId && (
              <div className="notice">
                Google-innlogging er ikke satt opp. Legg inn Client ID under{' '}
                <button className="link-btn" onClick={onOpenSettings}>Innstillinger</button> (se README).
              </div>
            )}
            {error && <p className="error small">{error}</p>}
            {busy && progress && (
              <div className="progress-wrap">
                <div className="progress-bar"><div style={{ width: `${Math.round((progress.done / Math.max(1, total)) * 100)}%` }} /></div>
                <span className="muted small">{progress.done} av {total} · {progress.current}</span>
              </div>
            )}
            {result && (
              <div className="success">
                Ferdig: {result.created} mapper opprettet{result.reused ? `, ${result.reused} fantes fra før` : ''}.{' '}
                <a href={result.url} target="_blank" rel="noreferrer">Åpne i Google Disk ↗</a>
              </div>
            )}
          </section>
        </div>

        <div className="modal-foot pad">
          <span className="muted small progress">
            {cfg.clientId && (signedIn
              ? <>Logget inn hos Google · <button className="link-btn" onClick={() => { signOut(); setSignedIn(false); }}>Logg ut</button></>
              : <button className="link-btn" onClick={() => run(async () => { await getAccessToken(cfg); })}>Logg inn med Google</button>)}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Lukk</button>
          <button className="btn primary" onClick={create} disabled={busy || !cfg.clientId || !total}>
            {busy ? 'Oppretter …' : `Opprett ${total} mapper på Google Disk`}
          </button>
        </div>
      </div>
    </div>
  );
}
