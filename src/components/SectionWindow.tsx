import { useCallback, useEffect, useRef, useState } from 'react';
import { drawSection, fmtNum, layoutSection, sectionToDxf, terrainAtS } from '../lib/section';
import type { Section } from '../lib/section';
import { IconClose } from './icons';

interface Props {
  section: Section;
  /** F.eks. «Snitt 2» (nummeret i målelisten) */
  title: string;
  onClose: () => void;
}

const EXAG: { v: 'auto' | number; label: string }[] = [
  { v: 'auto', label: 'Tilpass vinduet' }, { v: 1, label: '×1 (ekte målestokk)' }, { v: 2, label: '×2' }, { v: 5, label: '×5' }, { v: 10, label: '×10' },
];

/**
 * Tverrsnitt i et eget flyttbart vindu: terrengprofil og IFC-objekter langs målelinjen.
 * Vinduet kan flyttes (dra i tittelen) og gjøres større (dra i hjørnet nede til høyre).
 * Knapper: kopier bilde til utklippstavlen og eksporter til DXF.
 */
export default function SectionWindow({ section, title, onClose }: Props) {
  const win = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [vExag, setVExag] = useState<'auto' | number>('auto');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [size, setSize] = useState({ w: 640, h: 340 });
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({ x: Math.max(8, Math.round(window.innerWidth / 2 - 380)), y: 84 }));
  const [hover, setHover] = useState<{ s: number; z: number | null } | null>(null);
  const [msg, setMsg] = useState('');
  const msgTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);
  const say = (t: string) => { setMsg(t); window.clearTimeout(msgTimer.current); msgTimer.current = window.setTimeout(() => setMsg(''), 3500); };

  const empty = !section.terrain.some(Boolean) && section.objects.length === 0;

  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSection(ctx, size.w, size.h, section, { vExag, hidden, title, hoverS: hover?.s ?? null });
  }, [section, size, vExag, hidden, title, hover]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const L = layoutSection(section, size.w, size.h, vExag);
    const s = (e.clientX - r.left - L.x0) / L.sx;
    setHover(s >= 0 && s <= section.length ? { s, z: terrainAtS(section, s) } : null);
  };

  // Flytte vinduet
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ x: Math.max(-300, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy)) });
  };
  const onUp = () => { drag.current = null; };

  // Gjøre vinduet større/mindre (grepet nede til høyre)
  const grip = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const gDown = (e: React.PointerEvent) => { grip.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const gMove = (e: React.PointerEvent) => {
    const g = grip.current;
    if (!g) return;
    setSize({ w: Math.max(360, Math.min(window.innerWidth - 24, Math.round(g.w + e.clientX - g.x))), h: Math.max(200, Math.min(window.innerHeight - 190, Math.round(g.h + e.clientY - g.y))) });
  };
  const gUp = () => { grip.current = null; };

  const toggle = (name: string) => setHidden((h) => { const n = new Set(h); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  // Bilde i full oppløsning (minst 1600 piksler bredt), uten markør
  const renderBlob = useCallback((): Promise<Blob | null> => {
    const k = Math.max(1, 1600 / size.w);
    const c = document.createElement('canvas');
    c.width = Math.round(size.w * k); c.height = Math.round(size.h * k);
    const ctx = c.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawSection(ctx, size.w, size.h, section, { vExag, hidden, title });
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }, [section, size, vExag, hidden, title]);

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const baseName = `tverrsnitt-${title.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, '') || 'snitt'}`;

  const copyImage = async () => {
    const blob = await renderBlob();
    if (!blob) { say('Kunne ikke lage bildet.'); return; }
    try {
      const CI = (window as unknown as { ClipboardItem?: new (d: Record<string, Blob>) => unknown }).ClipboardItem;
      if (!CI || !navigator.clipboard?.write) throw new Error('ingen utklippstavle');
      await navigator.clipboard.write([new CI({ 'image/png': blob }) as ClipboardItem]);
      say('Bildet er kopiert til utklippstavlen. Lim inn med Ctrl + V.');
    } catch {
      download(blob, baseName + '.png'); // nettleseren tillater ikke bilde på utklippstavlen: lagre som fil i stedet
      say('Nettleseren ga ikke tilgang til utklippstavlen. Bildet er lastet ned i stedet.');
    }
  };
  const exportDxf = () => {
    const text = sectionToDxf(section, { hidden, title });
    download(new Blob([text], { type: 'application/dxf' }), baseName + '.dxf');
    say('DXF er lastet ned. Tegnet i meter, 1:1: x = avstand langs snittet, y = høyde.');
  };

  const names = [...(section.terrain.some(Boolean) ? ['Terreng'] : []), ...section.objects.map((o) => o.layer)];

  return (
    <div className="sec-win" ref={win} role="dialog" aria-label={title} style={{ left: pos.x, top: pos.y, width: size.w + 2, }}>
      <div className="sec-head" onPointerDown={onDown} onPointerMove={onDrag} onPointerUp={onUp} onPointerCancel={onUp}>
        <b>{title}</b>
        <span className="muted small">A → B · {fmtNum(section.length, 1)} m</span>
        <button className="icon-btn" title="Lukk snittet" aria-label="Lukk snittet" onClick={onClose}><IconClose size={16} /></button>
      </div>
      <div className="sec-tools">
        <label className="sec-exag">Overhøyde
          <select value={String(vExag)} onChange={(e) => setVExag(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
            {EXAG.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
          </select>
        </label>
        <span className="sec-sp" />
        <button className="btn" onClick={copyImage} disabled={empty} title="Kopierer snittet som bilde til utklippstavlen (lim inn i Word, e-post, Teams …)">Kopier bilde</button>
        <button className="btn primary" onClick={exportDxf} disabled={empty} title="Laster ned snittet som DXF-tegning (kan åpnes i AutoCAD, Civil 3D, QGIS m.fl.)">Eksporter DXF</button>
      </div>
      <div className="sec-body" ref={body} style={{ width: size.w, height: size.h }}>
        <canvas ref={cvs} style={{ width: size.w, height: size.h }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-label="Tverrsnitt" />
        {empty && <div className="sec-empty">Fant verken terreng eller IFC-objekter langs linjen. Slå på terreng (og en IFC-modell) i 3D-visningen, og lag snittet på nytt.</div>}
      </div>
      <div className="sec-foot">
        {names.length > 1 && (
          <div className="sec-layers" aria-label="Lag i snittet">
            {names.map((n) => (
              <label key={n}><input type="checkbox" className="chk" checked={!hidden.has(n)} onChange={() => toggle(n)} /> {n}</label>
            ))}
          </div>
        )}
        <div className="sec-status small muted" aria-live="polite">
          {msg || (hover ? `Avstand ${fmtNum(hover.s, 1)} m${hover.z !== null ? ` · terreng ${fmtNum(hover.z, 2)} m o.h.` : ''}` : 'Flytt musepekeren over snittet for å lese av avstand og terrenghøyde.')}
        </div>
      </div>
      <div className="sec-grip" title="Dra for å endre størrelsen" onPointerDown={gDown} onPointerMove={gMove} onPointerUp={gUp} onPointerCancel={gUp} />
    </div>
  );
}
