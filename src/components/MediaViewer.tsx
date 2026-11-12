import { useEffect, useMemo, useState } from 'react';
import type { PhotoItem } from '../types';
import PanoViewer from './PanoViewer';
import { IconChevron, IconClose } from './icons';

interface Props {
  photos: PhotoItem[]; // rekkefølgen for bla-funksjonen
  id: string;
  onChange: (id: string) => void;
  onClose: () => void;
  /** Henter originalen fra Google Disk for bilder som bare har forhåndsvisning lagret lokalt */
  loadOriginal?: (p: PhotoItem) => Promise<Blob>;
}

// Små hurtigbuffer for nylig hentede originaler (maks 4)
const originals = new Map<string, Blob>();

const dateFmt = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'long', timeStyle: 'short' });

export default function MediaViewer({ photos, id, onChange, onClose, loadOriginal }: Props) {
  const idx = photos.findIndex((p) => p.id === id);
  const p = photos[idx];
  const [full, setFull] = useState<Blob | null>(null);
  const [fullState, setFullState] = useState<'idle' | 'loading' | 'error'>('idle');
  const shown = full ?? p?.blob;
  const url = useMemo(() => (p && p.kind === 'photo' && shown ? URL.createObjectURL(shown) : null), [p?.id, p?.kind, shown]);

  // Strøm originalen fra Google Disk når bare forhåndsvisning er lagret
  useEffect(() => {
    setFull(null);
    setFullState('idle');
    if (!p || !p.previewOnly || !p.driveId || !loadOriginal) return;
    const cached = originals.get(p.id);
    if (cached) { setFull(cached); return; }
    let cancelled = false;
    setFullState('loading');
    loadOriginal(p).then((b) => {
      if (cancelled) return;
      originals.set(p.id, b);
      if (originals.size > 4) originals.delete(originals.keys().next().value as string);
      setFull(b);
      setFullState('idle');
    }).catch(() => { if (!cancelled) setFullState('error'); });
    return () => { cancelled = true; };
  }, [p?.id]);
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
        {p.kind === 'pano' ? <PanoViewer blob={shown ?? p.blob} key={p.id} /> : url && <img src={url} alt={p.name} />}
        {idx > 0 && <button className="nav prev" onClick={() => onChange(photos[idx - 1].id)} aria-label="Forrige"><IconChevron size={26} style={{ transform: 'rotate(180deg)' }} /></button>}
        {idx < photos.length - 1 && <button className="nav next" onClick={() => onChange(photos[idx + 1].id)} aria-label="Neste"><IconChevron size={26} /></button>}
      </div>
      {fullState === 'loading' && <div className="viewer-chip">Henter original fra Google Disk …</div>}
      {fullState === 'error' && <div className="viewer-chip">Kunne ikke hente originalen fra Google Disk. Viser forhåndsvisning.</div>}
      {p.note && <div className="viewer-note">{p.note}</div>}
    </div>
  );
}
