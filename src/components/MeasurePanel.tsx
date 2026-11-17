import { useEffect, useRef, useState } from 'react';
import { formatDz, formatLength, formatPct, historyTotals, summaryRows, summaryText } from '../lib/measure';
import type { HistoryRow, MeasureMode, Summary } from '../lib/measure';
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
  /** Snapping til objekter (IFC og tegninger). Utelates hvis visningen ikke støtter det. */
  snap?: boolean;
  onSnap?: (on: boolean) => void;
  /** Hva markøren snapper til akkurat nå («Hjørne», «Kant», «Flate») */
  snapState?: string | null;
  /** Målingene er lagret og blir stående til du trykker «Nullstill alle» */
  stored?: boolean;
  /** Alle målingene i visningen (ferdige og den som pågår), hver med egen farge */
  history?: HistoryRow[];
  onDeleteItem?: (id: string) => void;
  /** Zoom til målingen */
  onFocusItem?: (id: string) => void;
  /** Tverrsnitt langs en avstandsmåling (bare i Terreng 3D). id = målingen som skal snittes. */
  onSection?: (id: string) => void;
  /** Id til målingen som pågår (den som ikke er arkivert ennå) */
  activeId?: string;
  onMode: (m: MeasureMode) => void;
  onUndo: () => void;
  onFinish: () => void;
  /** Nullstill alle: fjerner alle målingene, også de lagrede kopiene */
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
  const hist = p.history ?? [];
  const totals = historyTotals(hist);

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
          <div key={r.label} className={`mp-row${r.strong ? ' strong' : ''}${r.dh ? ' dh' : ''}`}>
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
        {p.onSnap && (
          <label className="mp-snap" title="Snapper til hjørner og kanter på IFC-modeller og tegninger. Hold inne Alt for å snappe midlertidig av.">
            <input type="checkbox" checked={!!p.snap} onChange={(e) => p.onSnap!(e.target.checked)} />
            <span>Snap til objekter</span>
            {p.snap && p.snapState && <b className="mp-snap-now">{p.snapState}</b>}
          </label>
        )}
      </div>

      {hist.length > 0 && (
        <div className="mp-hist" aria-label="Målinger">
          <div className="mp-hist-head">
            <b>Målinger ({hist.length})</b>
            <button className="btn danger" onClick={p.onClear} title="Fjern alle målingene, også de lagrede kopiene">Nullstill alle</button>
          </div>
          <ul>
            {hist.map((h, i) => (
              <li key={h.id} className={h.active ? 'active' : ''} data-mid={h.id}>
                <span className="mp-sw" style={{ background: h.color }} />
                <button className="mp-hist-item" onClick={() => p.onFocusItem?.(h.id)} title="Vis målingen i kartet">
                  <span className="mp-hist-n">{i + 1}</span>
                  {h.mode === 'area' ? <IconArea size={14} /> : <IconRuler size={14} />}
                  <span className="mp-hist-v">{h.value}</span>
                  {h.dz !== null && <span className={`mp-hist-dh ${h.dz > 0.005 ? 'up' : h.dz < -0.005 ? 'down' : ''}`} title="Høydeforskjell (siste mot første punkt) og stigning/fall i prosent">Δh {formatDz(h.dz)}{h.pct !== null && ` (${formatPct(h.pct)})`}</span>}
                  {!h.finished && <small>pågår</small>}
                </button>
                {p.onSection && h.mode === 'distance' && h.length !== null && (
                  <button className="mp-sec" title="Lag tverrsnitt langs denne linjen (terreng og IFC-objekter)" onClick={() => p.onSection!(h.id)}>Snitt</button>
                )}
                <button className="icon-btn mp-del" title="Slett denne målingen" aria-label={`Slett måling ${i + 1}`} onClick={() => p.onDeleteItem?.(h.id)}><IconClose size={14} /></button>
              </li>
            ))}
          </ul>
          {(totals.area || totals.length || totals.dz) && (
            <div className="mp-hist-sum">
              {totals.area && <span>Sum areal: <b>{totals.area}</b></span>}
              {totals.length && <span>Sum lengde: <b>{totals.length}</b></span>}
              {totals.dz && <span>Sum Δh: <b>{totals.dz}</b></span>}
            </div>
          )}
        </div>
      )}

      <div className="mp-actions">
        <button className="btn" disabled={s.count === 0} onClick={p.onUndo} title="Angre siste punkt (Backspace)">Angre</button>
        <button className="btn primary" disabled={finished || s.count < need} onClick={p.onFinish} title="Fullfør målingen (Enter eller dobbeltklikk)">Fullfør</button>
        <button className="btn" disabled={rows.length === 0} onClick={copy} title="Kopier resultatet som tekst">{copied ? 'Kopiert' : 'Kopier'}</button>
      </div>
      {p.onSection && (
        <div className="mp-section">
          <button className="btn sec-go" disabled={mode !== 'distance' || s.count < 2 || !p.activeId} onClick={() => p.activeId && p.onSection!(p.activeId)}
            title="Lager et tverrsnitt langs linjen du måler: terrengprofil og IFC-objekter i et eget vindu (med DXF-eksport og kopiering av bilde)">
            Lag tverrsnitt langs linjen
          </button>
        </div>
      )}
      <div className="mp-foot">{p.stored !== false && s.count > 0 ? 'Målingene lagres underveis og blir stående til du trykker Nullstill alle.' : ''}{p.stored !== false && s.count > 0 && <br />}Enter fullfører · {p.rightClickUndo === false ? 'Backspace' : 'Backspace/høyreklikk'} angrer · Esc avslutter<br />Regnet i {p.crsLabel}</div>
    </div>
  );
}
