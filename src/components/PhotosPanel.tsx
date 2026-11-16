import { useMemo, useState } from 'react';
import type { Folder, PhotoItem } from '../types';
import { IconCalendar, IconChevron, IconFolder, IconGrid } from './icons';

export type PhotoTypeFilter = 'all' | 'photo' | 'pano';
export type PhotoSort = 'new' | 'old';

interface Props {
  photos: PhotoItem[];
  folders: Folder[];
  selectedId: string | null;
  type: PhotoTypeFilter;
  onType: (t: PhotoTypeFilter) => void;
  sort: PhotoSort;
  onSort: (s: PhotoSort) => void;
  dateFrom: string;
  dateTo: string;
  onRange: (from: string, to: string) => void;
  /** Mapper som er skrudd AV for bildevisning */
  offFolders: Set<string>;
  onToggleFolder: (id: string, on: boolean) => void;
  onSetFolders: (offIds: string[]) => void;
  onPick: (p: PhotoItem) => void;
  onOpenViewer: (id: string) => void;
  onGrid: () => void;
}

const dayFmt = new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const dayOf = (p: PhotoItem) => p.takenAt.slice(0, 10);
const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Bildepanel i kartvisning: filtrer på type, dato og mapper, og bla i miniatyrer. */
export default function PhotosPanel(p: Props) {
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [dateOpen, setDateOpen] = useState(true);

  const folderPath = useMemo(() => {
    const byId = new Map(p.folders.map((f) => [f.id, f]));
    const path = (id: string): string => {
      const f = byId.get(id);
      if (!f) return '';
      const parent = f.parentId ? byId.get(f.parentId) : undefined;
      // Rotmappen (prosjektet) tas ikke med i navnet
      return parent && parent.parentId !== null ? `${path(parent.id)} / ${f.name}` : f.name;
    };
    return path;
  }, [p.folders]);

  // Mapper som har bilder (direkte)
  const photoFolders = useMemo(() => {
    const m = new Map<string, number>();
    for (const ph of p.photos) m.set(ph.folderId, (m.get(ph.folderId) ?? 0) + 1);
    return [...m.entries()]
      .map(([id, n]) => ({ id, n, name: folderPath(id) || 'Uten mappe' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }));
  }, [p.photos, folderPath]);

  const days = useMemo(() => {
    const d = p.photos.map(dayOf).sort();
    return { min: d[0] ?? '', max: d[d.length - 1] ?? '' };
  }, [p.photos]);

  const counts = useMemo(() => ({
    all: p.photos.length,
    photo: p.photos.filter((x) => x.kind === 'photo').length,
    pano: p.photos.filter((x) => x.kind === 'pano').length,
  }), [p.photos]);

  const shown = useMemo(() => {
    const list = p.photos
      .filter((x) => p.type === 'all' || x.kind === p.type)
      .filter((x) => !p.offFolders.has(x.folderId))
      .filter((x) => (!p.dateFrom || dayOf(x) >= p.dateFrom) && (!p.dateTo || dayOf(x) <= p.dateTo));
    list.sort((a, b) => (p.sort === 'new' ? b.takenAt.localeCompare(a.takenAt) : a.takenAt.localeCompare(b.takenAt)));
    return list;
  }, [p.photos, p.type, p.offFolders, p.dateFrom, p.dateTo, p.sort]);

  const groups = useMemo(() => {
    const m = new Map<string, PhotoItem[]>();
    for (const x of shown) {
      const k = dayOf(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return [...m.entries()];
  }, [shown]);

  const dateActive = !!(p.dateFrom || p.dateTo);
  const filtered = p.type !== 'all' || p.offFolders.size > 0 || dateActive;
  const reset = () => { p.onType('all'); p.onSetFolders([]); p.onRange('', ''); };

  return (
    <div className="tree-panel photos-panel">
      <div className="panel-head">
        <h2>Bilder <span className="muted small">· {shown.length}{shown.length !== p.photos.length ? ` av ${p.photos.length}` : ''}</span></h2>
        <button className="btn small-btn" onClick={p.onGrid} title="Vis alle bilder som stort rutenett"><IconGrid size={14} /> Rutenett</button>
      </div>

      <div className="pp-filters">
        <div className="pp-label">Type</div>
        <div className="seg pp-seg">
          <button className={p.type === 'all' ? 'on' : ''} onClick={() => p.onType('all')}>Alle · {counts.all}</button>
          <button className={p.type === 'photo' ? 'on' : ''} onClick={() => p.onType('photo')}>Foto · {counts.photo}</button>
          <button className={p.type === 'pano' ? 'on' : ''} onClick={() => p.onType('pano')}>360° · {counts.pano}</button>
        </div>

        <button className="pp-head" onClick={() => setDateOpen(!dateOpen)}>
          <IconChevron size={13} style={{ transform: dateOpen ? 'rotate(90deg)' : undefined }} />
          <IconCalendar size={14} /> <span>Dato</span>
          {dateActive && <span className="pp-dot" />}
        </button>
        {dateOpen && (
          <div className="pp-body">
            <div className="pp-dates">
              <label>Fra<input type="date" value={p.dateFrom} min={days.min} max={p.dateTo || days.max} onChange={(e) => p.onRange(e.target.value, p.dateTo)} /></label>
              <label>Til<input type="date" value={p.dateTo} min={p.dateFrom || days.min} max={days.max} onChange={(e) => p.onRange(p.dateFrom, e.target.value)} /></label>
            </div>
            <div className="df-chips">
              <button className="chip" onClick={() => p.onRange('', '')}>Alle</button>
              <button className="chip" onClick={() => p.onRange(isoDay(0), isoDay(0))}>I dag</button>
              <button className="chip" onClick={() => p.onRange(isoDay(6), '')}>7 dager</button>
              <button className="chip" onClick={() => p.onRange(isoDay(29), '')}>30 dager</button>
              {days.max && <button className="chip" onClick={() => p.onRange(days.max, days.max)}>Siste bildedag</button>}
            </div>
            <div className="pp-sort">
              <span className="pp-label">Sortering</span>
              <select value={p.sort} onChange={(e) => p.onSort(e.target.value as PhotoSort)}>
                <option value="new">Nyeste først</option>
                <option value="old">Eldste først</option>
              </select>
            </div>
          </div>
        )}

        <button className="pp-head" onClick={() => setFoldersOpen(!foldersOpen)}>
          <IconChevron size={13} style={{ transform: foldersOpen ? 'rotate(90deg)' : undefined }} />
          <IconFolder size={14} /> <span>Mapper med bilder</span>
          {p.offFolders.size > 0 && <span className="pp-dot" />}
        </button>
        {foldersOpen && (
          <div className="pp-body">
            {photoFolders.length === 0 && <div className="muted small">Ingen mapper med bilder.</div>}
            {photoFolders.map((f) => (
              <label key={f.id} className="pp-folder">
                <input type="checkbox" className="chk" checked={!p.offFolders.has(f.id)} onChange={(e) => p.onToggleFolder(f.id, e.target.checked)} />
                <span className="pp-folder-name" title={f.name}>{f.name}</span>
                <span className="muted small">{f.n}</span>
              </label>
            ))}
            {photoFolders.length > 1 && (
              <div className="pp-links">
                <button className="link-btn" onClick={() => p.onSetFolders([])}>Alle</button>
                <button className="link-btn" onClick={() => p.onSetFolders(photoFolders.map((f) => f.id))}>Ingen</button>
              </div>
            )}
          </div>
        )}
        {filtered && <button className="link-btn pp-reset" onClick={reset}>Nullstill filter</button>}
      </div>

      <div className="pp-list">
        {groups.length === 0 && <div className="empty-state small">Ingen bilder med disse filtrene.</div>}
        {groups.map(([day, list]) => {
          const label = dayFmt.format(new Date(day + 'T12:00:00'));
          return (
            <section key={day}>
              <h4>{label} <span className="muted">· {list.length}</span></h4>
              <div className="pp-grid">
                {list.map((x) => (
                  <div key={x.id} className={`pp-tile${p.selectedId === x.id ? ' sel' : ''}${x.lat === null ? ' nopos' : ''}`}
                    onClick={() => p.onPick(x)} onDoubleClick={() => p.onOpenViewer(x.id)}
                    title={`${x.name}${x.lat === null ? ' (uten posisjon – åpnes i visning)' : ''}`}>
                    <img src={x.thumb} alt={x.name} loading="lazy" />
                    {x.kind === 'pano' && <span className="tag-360">360°</span>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
