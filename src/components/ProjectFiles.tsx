import { useMemo, useState } from 'react';
import type { Folder, Item } from '../types';
import type { Project } from '../state';
import { descendantFolderIds } from '../state';
import ResetDemoButton from './ResetDemoButton';
import { IconFolder, IconFolderOpen, IconPin, IconTrash, IconUpload, KIND_ICON } from './icons';

interface Props {
  project: Project;
  onZoomTo: (id: string) => void;
  onOpenViewer: (id: string) => void;
  onUpload: () => void;
  onDrive: () => void;
}

const KIND_LABEL: Record<string, string> = { photo: 'Bilde', pano: '360-bilde', dxf: 'Prosjektert / innmåling', ortho: 'Ortofoto' };
const dateFmt = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium' });

function sizeOf(it: Item): number {
  if (it.kind === 'ortho') return it.image.size;
  return it.blob.size;
}
function fmtSize(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

/** Oversikt over mapper og alle filer i prosjektet. */
export default function ProjectFiles({ project, onZoomTo, onOpenViewer, onUpload, onDrive }: Props) {
  const { folders, items } = project;
  const root = folders.find((f) => f.parentId === null);
  const [sel, setSel] = useState<string | null>(null); // null = alle
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  // Flat mappeliste med innrykk
  const rows = useMemo(() => {
    const out: { f: Folder; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      folders
        .filter((f) => f.parentId === parent)
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((f) => { out.push({ f, depth }); walk(f.id, depth + 1); });
    };
    walk(null, 0);
    return out;
  }, [folders]);

  const countIn = (id: string) => {
    const ids = new Set(descendantFolderIds(folders, id));
    return items.filter((i) => ids.has(i.folderId)).length;
  };

  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? '';
  const list = useMemo(() => {
    const ids = sel ? new Set(descendantFolderIds(folders, sel)) : null;
    const query = q.trim().toLowerCase();
    return items
      .filter((i) => !ids || ids.has(i.folderId))
      .filter((i) => !query || i.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }));
  }, [items, folders, sel, q]);

  return (
    <div className="pfiles">
      <aside className="pf-folders">
        <div className="pf-title">Mapper</div>
        <button className={`pf-folder${sel === null ? ' on' : ''}`} onClick={() => setSel(null)}>
          <IconFolderOpen size={16} /> <span>Alle filer</span> <span className="muted small">{items.length}</span>
        </button>
        {rows.filter((r) => r.f.id !== root?.id).map(({ f, depth }) => (
          <button key={f.id} className={`pf-folder${sel === f.id ? ' on' : ''}`} style={{ paddingLeft: 10 + Math.max(0, depth - 1) * 14 }} onClick={() => setSel(f.id)}>
            <IconFolder size={16} /> <span>{f.name}</span> <span className="muted small">{countIn(f.id)}</span>
          </button>
        ))}
      </aside>

      <section className="pf-main">
        <div className="pf-bar">
          <h2>{sel ? folderName(sel) : 'Prosjektfiler'} <span className="muted small">· {list.length} filer</span></h2>
          <input className="pf-search" placeholder="Søk i filnavn" value={q} onChange={(e) => setQ(e.target.value)} />
          <ResetDemoButton project={project} />
          <button className="btn" onClick={onDrive}><IconFolder size={16} /> Google Disk</button>
          <button className="btn primary" onClick={onUpload}><IconUpload size={16} /> Last opp</button>
        </div>

        {list.length === 0 ? (
          <div className="empty-state">Ingen filer her ennå. Last opp filer eller hent fra Google Disk.</div>
        ) : (
          <table className="pf-table">
            <thead>
              <tr><th></th><th>Navn</th><th>Type</th><th>Mappe</th><th>Størrelse</th><th>Dato</th><th>I kartet</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((it) => {
                const Icon = KIND_ICON[it.kind];
                const isPhoto = it.kind === 'photo' || it.kind === 'pano';
                const date = isPhoto ? it.takenAt : new Date(it.createdAt).toISOString();
                return (
                  <tr key={it.id} className={it.hidden ? 'dim' : ''}>
                    <td className="pf-ico">{isPhoto ? <img src={it.thumb} alt="" /> : <Icon size={18} />}</td>
                    <td className="pf-name" title={it.name} onClick={() => (isPhoto ? onOpenViewer(it.id) : onZoomTo(it.id))}>{it.name}</td>
                    <td>{KIND_LABEL[it.kind]}</td>
                    <td className="muted">{folderName(it.folderId)}</td>
                    <td className="muted">{fmtSize(sizeOf(it))}</td>
                    <td className="muted">{dateFmt.format(new Date(date))}</td>
                    <td><input type="checkbox" className="chk" checked={!it.hidden} onChange={(e) => project.setVisible([it.id], e.target.checked)} title="Vis i kartet" /></td>
                    <td className="pf-actions">
                      <button className="icon-btn" title="Vis i kart" onClick={() => onZoomTo(it.id)}><IconPin size={16} /></button>
                      {confirm === it.id ? (
                        <button className="btn danger solid small-btn" onClick={() => { project.deleteItem(it.id); setConfirm(null); }}>Slett?</button>
                      ) : (
                        <button className="icon-btn" title="Slett" onClick={() => setConfirm(it.id)}><IconTrash size={16} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
