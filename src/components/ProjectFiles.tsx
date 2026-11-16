import { useMemo, useState } from 'react';
import { FORMAT_LABEL } from '../lib/vector';
import type { Folder, Item } from '../types';
import type { Project } from '../state';
import { compareFolders, descendantFolderIds } from '../state';
import ResetDemoButton from './ResetDemoButton';
import { IconGoogle, IconFolder, IconFolderOpen, IconPin, IconTrash, IconUpload, KIND_ICON } from './icons';

interface Props {
  project: Project;
  onZoomTo: (id: string) => void;
  onOpenViewer: (id: string) => void;
  onUpload: () => void;
  onDrive: () => void;
}

const KIND_LABEL: Record<string, string> = { photo: 'Bilde', pano: '360-bilde', dxf: 'Prosjektert / innmåling', ortho: 'Ortofoto' };
const dateFmt = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' });

type SortKey = 'name' | 'type' | 'modified' | 'version' | 'desc' | 'by' | 'folder' | 'size';

/** Filtype slik den vises i tabellen: filformatet for prosjekterte data og innmåling (IFC, DXF, KOF …) */
const typeLabel = (it: Item) => (it.kind === 'dxf' ? `${FORMAT_LABEL[it.format ?? 'dxf']}${it.format === 'kof' || it.format === 'sosi' || it.format === 'landxml' ? ' (innmåling)' : ''}` : KIND_LABEL[it.kind]);
/** Egenskapene Prosjektfiler viser. Eldre elementer mangler noen av dem, og får da fornuftige standardverdier. */
const modifiedOf = (it: Item) => it.modifiedAt ?? it.createdAt;
const versionOf = (it: Item) => it.version ?? '1';
const descOf = (it: Item) => it.description ?? ((it.kind === 'photo' || it.kind === 'pano') ? it.note ?? '' : '');
const byOf = (it: Item) => it.modifiedBy ?? '';

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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [edit, setEdit] = useState<{ id: string; field: 'desc' | 'version' } | null>(null);
  const [draft, setDraft] = useState('');

  // Flat mappeliste med innrykk
  const rows = useMemo(() => {
    const out: { f: Folder; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      folders
        .filter((f) => f.parentId === parent)
        .sort(compareFolders)
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
      .sort((a, b) => {
        const txt = (x: string, y: string) => x.localeCompare(y, 'nb', { numeric: true });
        let c = 0;
        switch (sort.key) {
          case 'type': c = txt(typeLabel(a), typeLabel(b)); break;
          case 'modified': c = modifiedOf(a) - modifiedOf(b); break;
          case 'version': c = txt(versionOf(a), versionOf(b)); break;
          case 'desc': c = txt(descOf(a), descOf(b)); break;
          case 'by': c = txt(byOf(a), byOf(b)); break;
          case 'folder': c = txt(folderName(a.folderId), folderName(b.folderId)); break;
          case 'size': c = sizeOf(a) - sizeOf(b); break;
          default: c = txt(a.name, b.name);
        }
        return (c || txt(a.name, b.name)) * sort.dir;
      });
  }, [items, folders, sel, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => setSort((s0) => (s0.key === key ? { key, dir: s0.dir === 1 ? -1 : 1 } : { key, dir: key === 'modified' ? -1 : 1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title="Klikk for å sortere">
      {label}{sort.key === key && <span className="arr">{sort.dir === 1 ? '▲' : '▼'}</span>}
    </th>
  );

  // Beskrivelse og versjon kan redigeres direkte i tabellen (klikk, skriv, Enter for å lagre, Esc for å avbryte)
  const commit = () => {
    if (!edit) return;
    const it = items.find((i) => i.id === edit.id);
    const next = draft.trim();
    if (it && next !== (edit.field === 'desc' ? descOf(it) : versionOf(it)) && (edit.field === 'desc' || next)) {
      void project.updateMeta(edit.id, edit.field === 'desc' ? { description: next } : { version: next });
    }
    setEdit(null);
  };
  const editCell = (it: Item, field: 'desc' | 'version', value: string, placeholder: string) => {
    if (edit?.id === it.id && edit.field === field) {
      return (
        <input autoFocus value={draft} maxLength={field === 'desc' ? 500 : 12} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEdit(null); }} />
      );
    }
    return (
      <span className={`ed${value ? '' : ' empty'}`} title={value || 'Klikk for å redigere'} onClick={() => { setDraft(value); setEdit({ id: it.id, field }); }}>
        {value || placeholder}
      </span>
    );
  };

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
          <button className="btn" onClick={onDrive}><IconGoogle size={16} /> Google Disk <span className="beta-tag dark">beta</span></button>
          <button className="btn primary" onClick={onUpload}><IconUpload size={16} /> Last opp</button>
        </div>

        {list.length > 0 && !project.settings?.userName?.trim() && items.some((i) => !i.modifiedBy) && (
          <p className="muted small pf-hint">«Endret av» står tomt for filer som ikke kommer fra Google Disk. Skriv inn navnet ditt under Innstillinger, så blir det brukt på nye opplastinger og endringer.</p>
        )}

        {list.length === 0 ? (
          <div className="empty-state">Ingen filer her ennå. Last opp filer eller hent fra Google Disk.</div>
        ) : (
          <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th></th>
                {head('name', 'Navn')}{head('type', 'Type')}{head('modified', 'Sist endret')}{head('version', 'Versjon')}{head('desc', 'Beskrivelse')}{head('by', 'Endret av')}
                {head('folder', 'Mappe')}{head('size', 'Størrelse')}<th>I kartet</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => {
                const Icon = KIND_ICON[it.kind];
                const isPhoto = it.kind === 'photo' || it.kind === 'pano';
                return (
                  <tr key={it.id} className={it.hidden ? 'dim' : ''}>
                    <td className="pf-ico">{isPhoto ? <img src={it.thumb} alt="" /> : <Icon size={18} />}</td>
                    <td className="pf-name" title={it.name} onClick={() => (isPhoto ? onOpenViewer(it.id) : onZoomTo(it.id))}>{it.name}</td>
                    <td>{typeLabel(it)}</td>
                    <td className="muted pf-date" title={`Lastet inn i Feltkart ${dateFmt.format(new Date(it.createdAt))}${isPhoto ? ` · Tatt ${dateFmt.format(new Date(it.takenAt))}` : ''}`}>{dateFmt.format(new Date(modifiedOf(it)))}</td>
                    <td className="pf-ver">{editCell(it, 'version', versionOf(it), '1')}</td>
                    <td className="pf-desc">{editCell(it, 'desc', descOf(it), 'Legg til beskrivelse')}</td>
                    <td className="muted pf-by">{byOf(it) || '–'}</td>
                    <td className="muted">{folderName(it.folderId)}</td>
                    <td className="muted">{fmtSize(sizeOf(it))}</td>
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
          </div>
        )}
      </section>
    </div>
  );
}
