import { useEffect, useMemo } from 'react';
import type { PhotoItem } from '../types';
import PanoViewer from './PanoViewer';
import { IconChevron, IconClose } from './icons';

interface Props {
  photos: PhotoItem[]; // rekkefølgen for bla-funksjonen
  id: string;
  onChange: (id: string) => void;
  onClose: () => void;
}

const dateFmt = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'long', timeStyle: 'short' });

export default function MediaViewer({ photos, id, onChange, onClose }: Props) {
  const idx = photos.findIndex((p) => p.id === id);
  const p = photos[idx];
  const url = useMemo(() => (p && p.kind === 'photo' ? URL.createObjectURL(p.blob) : null), [p?.id, p?.kind]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < photos.length - 1) onChange(photos[idx + 1].id);
      if (e.key === 'ArrowLeft' && idx > 0) onChange(photos[idx - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, photos, onChange, onClose]);

  if (!p) return null;

  return (
    <div className="viewer">
      <div className="viewer-top">
        <div>
          <strong>{p.name}</strong>
          <span className="muted"> · {dateFmt.format(new Date(p.takenAt))}{p.kind === 'pano' ? ' · 360°' : ''}</span>
        </div>
        <span className="muted small">{idx + 1} / {photos.length}</span>
        <button className="icon-btn light" onClick={onClose} aria-label="Lukk"><IconClose size={20} /></button>
      </div>
      <div className="viewer-stage">
        {p.kind === 'pano' ? <PanoViewer blob={p.blob} key={p.id} /> : url && <img src={url} alt={p.name} />}
        {idx > 0 && <button className="nav prev" onClick={() => onChange(photos[idx - 1].id)} aria-label="Forrige"><IconChevron size={26} style={{ transform: 'rotate(180deg)' }} /></button>}
        {idx < photos.length - 1 && <button className="nav next" onClick={() => onChange(photos[idx + 1].id)} aria-label="Neste"><IconChevron size={26} /></button>}
      </div>
      {p.note && <div className="viewer-note">{p.note}</div>}
    </div>
  );
}
