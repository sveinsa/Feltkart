import { useEffect, useRef, useState } from 'react';
import { formatLength, summaryRows, summaryText } from '../lib/measure';
import type { MeasureMode, Summary } from '../lib/measure';
import { IconArea, IconClose, IconRuler } from './icons';

interface Props {
  mode: MeasureMode;
  summary: Summary;
  /** Navn på koordinatsystemet målingen er regnet i */
  crsLabel: string;
  /** Målingen er avsluttet (neste klikk starter en ny) */
  finished: boolean;
  /** Ekstra merknad, f.eks. om hvor høydene kommer fra i 3D */
  note?: string;
  /** Høyreklikk angrer siste punkt (gjelder 2D-kartet; i 3D brukes høyre museknapp til å rotere) */
  rightClickUndo?: boolean;
  onMode: (m: MeasureMode) => void;
  onUndo: () => void;
  onFinish: () => void;
  onClear: () => void;
  onClose: () => void;
}

/** Resultatpanel for måling – felles for 2D-kartet og Terreng 3D. */
export default function MeasurePanel(p: Props) {
  const { mode, summary: s, finished } = p;
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const need = mode === 'area' ? 3 : 2;
  const rows = summaryRows(s);
  const has3d = s.segments3d !== null;

  let hint: string;
  if (s.count === 0) hint = 'Klikk for å sette første punkt.';
  else if (finished) hint = 'Målingen er ferdig. Neste klikk starter en ny måling.';
  else if (s.count < need) hint = mode === 'area' ? `Legg til minst tre punkter (${s.count} av 3).` : 'Klikk for å sette neste punkt.';
  else hint = 'Klikk for flere punkter, eller trykk Fullfør.';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(s, p.crsLabel));
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch { /* utklippstavlen er ikke tilgjengelig */ }
  };

  return (
    <div className="mp" role="region" aria-label="Måling">
      <div className="mp-head">
        <div className="mp-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'distance'} className={mode === 'distance' ? 'on' : ''} onClick={() => p.onMode('distance')}>
            <IconRuler size={16} /> Avstand
          </button>
          <button role="tab" aria-selected={mode === 'area'} className={mode === 'area' ? 'on' : ''} onClick={() => p.onMode('area')}>
            <IconArea size={16} /> Areal
          </button>
        </div>
        <button className="icon-btn" title="Avslutt måling (Esc)" onClick={p.onClose}><IconClose size={16} /></button>
      </div>

      <div className="mp-body">
        {rows.length === 0 && <div className="mp-hint">{hint}</div>}
        {rows.map((r) => (
          <div key={r.label} className={`mp-row${r.strong ? ' strong' : ''}`}>
            <span className="mp-label">{r.label}</span>
            <span className="mp-val">{r.value}{r.sub && <small>{r.sub}</small>}</span>
          </div>
        ))}
        {rows.length > 0 && <div className="mp-hint">{hint}</div>}

        {s.selfIntersects && (
          <div className="mp-warn">Polygonet krysser seg selv – arealet kan bli feil. Angre og sett punktene i rekkefølge langs kanten.</div>
        )}

        {s.segments.length > 1 && (
          <details className="mp-segs">
            <summary>Delstrekninger ({s.segments.length})</summary>
            <ol>
              {s.segments.map((v, i) => (
                <li key={i}>
                  {formatLength(v)}
                  {has3d && s.segments3d && <span className="muted"> · skrå {formatLength(s.segments3d[i])}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}

        {p.note && <div className="mp-note">{p.note}</div>}
      </div>

      <div className="mp-actions">
        <button className="btn" disabled={s.count === 0} onClick={p.onUndo} title="Angre siste punkt (Backspace)">Angre</button>
        <button className="btn primary" disabled={finished || s.count < need} onClick={p.onFinish} title="Fullfør målingen (Enter eller dobbeltklikk)">Fullfør</button>
        <button className="btn" disabled={s.count === 0} onClick={p.onClear} title="Fjern målingen og start på nytt">Nullstill</button>
        <button className="btn" disabled={rows.length === 0} onClick={copy} title="Kopier resultatet som tekst">{copied ? 'Kopiert' : 'Kopier'}</button>
      </div>
      <div className="mp-foot">Enter fullfører · {p.rightClickUndo === false ? 'Backspace' : 'Backspace/høyreklikk'} angrer · Esc avslutter<br />Regnet i {p.crsLabel}</div>
    </div>
  );
}
