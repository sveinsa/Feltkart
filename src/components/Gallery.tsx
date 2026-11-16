import { useMemo, useState } from 'react';
import type { PhotoItem } from '../types';
import { IconMap, IconSearch } from './icons';

interface Props {
  photos: PhotoItem[];
  onOpen: (id: string) => void;
  onShowOnMap: (id: string) => void;
  onBack?: () => void;
}

const monthFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric' });

export default function Gallery({ photos, onOpen, onShowOnMap, onBack }: Props) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'photo' | 'pano'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = photos
      .filter((p) => kind === 'all' || p.kind === kind)
      .filter((p) => !query || (p.name + ' ' + (p.note ?? '')).toLowerCase().includes(query))
      .filter((p) => (!from || p.takenAt.slice(0, 10) >= from) && (!to || p.takenAt.slice(0, 10) <= to))
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const m = new Map<string, PhotoItem[]>();
    for (const p of list) {
      const k = p.takenAt.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()];
  }, [photos, q, kind, from, to]);

  return (
    <div className="gallery">
      <div className="gallery-filters">
        {onBack && <button className="btn primary" onClick={onBack}><IconMap size={16} /> Kartvisning</button>}
        <div className="search-box"><IconSearch size={15} /><input placeholder="Søk i filnavn og notater" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">
          {(['all', 'photo', 'pano'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? 'Alle' : k === 'photo' ? 'Foto' : '360-bilder'}</button>
          ))}
        </div>
        <label className="small muted">Fra <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="small muted">Til <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {groups.length === 0 && <div className="empty-state">Ingen bilder å vise.</div>}
      {groups.map(([k, list]) => {
        const label = monthFmt.format(new Date(k + '-15T12:00:00'));
        return (
          <section key={k}>
            <h3>{label.charAt(0).toUpperCase() + label.slice(1)} <span className="muted">· {list.length}</span></h3>
            <div className="grid">
              {list.map((p) => (
                <div key={p.id} className="tile" onClick={() => onOpen(p.id)} title={p.name}>
                  <img src={p.thumb} alt={p.name} loading="lazy" />
                  {p.kind === 'pano' && <span className="tag-360">360°</span>}
                  {p.lat !== null && (
                    <button className="tile-map" onClick={(e) => { e.stopPropagation(); onShowOnMap(p.id); }} title="Vis i kart">Kart</button>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
