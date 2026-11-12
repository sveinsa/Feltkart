import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { DxfItem, Folder, Item, Selection } from '../types';
import type { Project } from '../state';
import { descendantFolderIds } from '../state';
import { IconChevron, IconFolder, IconFolderOpen, IconMore, IconSearch, KIND_ICON, IconExpand, IconCollapse } from './icons';

interface Props {
  project: Project;
  selection: Selection;
  onOpenItem: (id: string) => void;
}

function Check({ checked, indeterminate, onChange, title }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="chk" checked={checked} title={title} onChange={(e) => onChange(e.target.checked)} onClick={(e) => e.stopPropagation()} />;
}

export default function LayerTree({ project, selection, onOpenItem }: Props) {
  const { folders, items, dxf } = project;
  const root = folders.find((f) => f.parentId === null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(root ? [root.id] : []));
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { if (root && !expanded.has(root.id)) setExpanded((s) => new Set(s).add(root.id)); }, [root?.id]);
  useEffect(() => {
    const close = () => { setMenu(null); setConfirmDelete(null); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const query = q.trim().toLowerCase();
  const matches = (it: Item) => !query || it.name.toLowerCase().includes(query);

  const children = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const arr = m.get(f.parentId) ?? [];
      arr.push(f);
      m.set(f.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.createdAt - b.createdAt);
    return m;
  }, [folders]);

  const itemsIn = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      const arr = m.get(it.folderId) ?? [];
      arr.push(it);
      m.set(it.folderId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }));
    return m;
  }, [items]);

  const subtreeItems = (folderId: string) => {
    const ids = new Set(descendantFolderIds(folders, folderId));
    return items.filter((i) => ids.has(i.folderId));
  };

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisible = items.length > 0 && items.every((i) => !i.hidden);

  const selectedItemId = selection?.type === 'item' ? selection.id : selection?.type === 'dxf-feature' ? selection.itemId : null;

  function renderItem(it: Item, depth: number) {
    const Icon = KIND_ICON[it.kind];
    const isOpen = expanded.has(it.id);
    const st = it.kind === 'dxf' ? dxf[it.id] : undefined;
    const noPos = (it.kind === 'photo' || it.kind === 'pano') && it.lat === null;
    return (
      <div key={it.id}>
        <div className={`tree-row item${selectedItemId === it.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => onOpenItem(it.id)}>
          {it.kind === 'dxf' ? (
            <button className="twisty" onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="Vis lag">
              <IconChevron size={14} style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
            </button>
          ) : <span className="twisty" />}
          <Check checked={!it.hidden} onChange={(v) => project.setVisible([it.id], v)} />
          <Icon size={16} className={`kind kind-${it.kind}`} />
          <span className="label" title={it.name}>{it.name}</span>
          {noPos && <span className="badge" title="Mangler posisjon">uten pos.</span>}
          {st?.loading && <span className="badge">leser …</span>}
          {st?.error && <span className="badge err" title={st.error}>feil</span>}
        </div>
        {it.kind === 'dxf' && isOpen && st?.data && (
          <div>
            {st.data.layers.map((l) => (
              <div key={l.name} className="tree-row layer" style={{ paddingLeft: 8 + (depth + 1) * 18 + 22 }}>
                <Check checked={!(it as DxfItem).hiddenLayers.includes(l.name)} onChange={(v) => project.toggleDxfLayer(it.id, l.name, v)} />
                <span className="swatch" style={{ background: l.color }} />
                <span className="label" title={l.name}>{l.name}</span>
                <span className="count">{l.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderFolder(f: Folder, depth: number): ReactElement | null {
    const sub = subtreeItems(f.id);
    const visibleSub = query ? sub.filter(matches) : sub;
    if (query && visibleSub.length === 0) return null;
    const open = query ? true : expanded.has(f.id);
    const nVisible = sub.filter((i) => !i.hidden).length;
    const own = (itemsIn.get(f.id) ?? []).filter(matches);
    const kids = children.get(f.id) ?? [];
    const FolderIcon = open ? IconFolderOpen : IconFolder;

    return (
      <div key={f.id}>
        <div className="tree-row folder" style={{ paddingLeft: 8 + depth * 18 }} onClick={() => toggle(f.id)}>
          <span className="twisty"><IconChevron size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} /></span>
          <Check checked={sub.length > 0 && nVisible === sub.length} indeterminate={nVisible > 0 && nVisible < sub.length}
            onChange={(v) => project.setFolderVisible(f.id, v)} />
          <FolderIcon size={16} className="kind kind-folder" />
          {renaming === f.id ? (
            <input className="rename" autoFocus defaultValue={f.name} onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = e.target.value.trim(); if (v) project.renameFolder(f.id, v); setRenaming(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          ) : (
            <span className="label">{f.name} <span className="count">({sub.length})</span></span>
          )}
          <button className="row-btn" title="Mappevalg" onClick={(e) => { e.stopPropagation(); setMenu(menu === f.id ? null : f.id); setConfirmDelete(null); }}>
            <IconMore size={15} />
          </button>
          {menu === f.id && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { const n = project.addFolder('Ny mappe', f.id); setExpanded((s) => new Set(s).add(f.id)); setMenu(null); setRenaming(n.id); }}>Ny undermappe</button>
              <button onClick={() => { setRenaming(f.id); setMenu(null); }}>Gi nytt navn</button>
              {f.parentId !== null && (
                confirmDelete === f.id
                  ? <button className="danger" onClick={() => { project.deleteFolder(f.id); setMenu(null); setConfirmDelete(null); }}>Bekreft: slett mappe og {sub.length} element(er)</button>
                  : <button className="danger" onClick={() => setConfirmDelete(f.id)}>Slett mappe …</button>
              )}
            </div>
          )}
        </div>
        {open && (
          <div>
            {kids.map((k) => renderFolder(k, depth + 1))}
            {own.map((it) => renderItem(it, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const roots = children.get(null) ?? [];

  return (
    <div className="tree-panel">
      <div className="panel-head">
        <h2>Innhold</h2>
        <div className="panel-actions">
          <button className="icon-btn" title="Utvid alle" onClick={() => setExpanded(new Set([...folders.map((f) => f.id)]))}><IconExpand size={16} /></button>
          <button className="icon-btn" title="Lukk alle" onClick={() => setExpanded(new Set(root ? [root.id] : []))}><IconCollapse size={16} /></button>
        </div>
      </div>
      <div className="search-box">
        <IconSearch size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk i mappestruktur" />
      </div>
      <div className="hint-bar">
        <span>Velg elementer som skal vises i kartet.</span>
        <button onClick={() => project.setVisible(items.map((i) => i.id), !allVisible)}>{allVisible ? 'Skjul alle' : 'Velg alle'}</button>
      </div>
      <div className="tree">
        {roots.map((f) => renderFolder(f, 0))}
        {query && !items.some(matches) && <div className="tree-empty">Ingen treff på «{q}»</div>}
      </div>
    </div>
  );
}
