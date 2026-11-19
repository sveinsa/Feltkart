// «Utsett»: gå til valgte punkter. Viser avstand, retning, nord/øst-forskjell og skjær/fyll mot neste punkt.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../state';
import { fromLatLng } from '../lib/crs';
import { useGnss } from '../lib/field/useGnss';
import { useFieldSettings } from '../lib/field/useFieldSettings';
import { nb } from '../lib/field/fmt';
import { pling } from '../lib/field/sound';
import { canMeasure, groundHeight, POINTS_EVENT } from '../lib/field/survey';
import {
  arrowAngle, clearStake, collectTargets, CourseTracker, currentTarget, cutFill, filterTargets, fmtDist, gotoStake, guide, setStake, SOURCE_LABEL,
  stepStake, useStake, type StakeTarget,
} from '../lib/field/stake';

interface Props {
  project: Pick<Project, 'items' | 'dxf'>;
  /** Koordinatsystemet nord/øst vises i (samme som i Felt) */
  crs: string;
  /** «Mål her»: åpner Innmåling med punktnavnet fra utsettingen */
  onMeasureHere: (name: string) => void;
  /** «Vis i kart» */
  onShowTarget: () => void;
}

const sign = (v: number, pos: string, neg: string) => `${v >= 0 ? pos : neg} ${nb(Math.abs(v), 2)} m`;

export default function StakePanel({ project, crs, onMeasureHere, onShowTarget }: Props) {
  const g = useGnss();
  const [fs] = useFieldSettings();
  const st = useStake();
  const t = currentTarget(st);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [ptsTick, setPtsTick] = useState(0);
  const [course, setCourse] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const tracker = useRef(new CourseTracker());

  useEffect(() => {
    const f = () => setPtsTick((n) => n + 1);
    window.addEventListener(POINTS_EVENT, f);
    return () => window.removeEventListener(POINTS_EVENT, f);
  }, []);
  useEffect(() => { const i = setInterval(() => { setNow(Date.now()); setCourse(tracker.current.value()); }, 1000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (g.lat === null || g.lng === null) return;
    const [e, n] = fromLatLng(crs, g.lat, g.lng);
    setCourse(tracker.current.update(e, n));
  }, [g.lat, g.lng, crs]);

  const all = useMemo(() => collectTargets(project), [project.items, project.dxf, ptsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = g.lat !== null && g.lng !== null ? { lat: g.lat, lng: g.lng } : null;
  const rows = useMemo(() => filterTargets(all, query, here, 60), [all, query, here?.lat, here?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const gd = here && t ? guide(here, t, crs) : null;
  const verdict = canMeasure(g, fs, now);
  const ready = verdict.ok;
  const tol = fs.stakeTol;
  const arrived = !!gd && ready && gd.dist <= tol;
  const ground = groundHeight(g.alt, g.sep, fs).ground;
  const cf = t ? cutFill(ground, t.z) : null;

  // Pling én gang når du er fremme. Settes opp igjen når du går bort eller bytter punkt.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!t) { announced.current = null; return; }
    if (arrived && announced.current !== t.id) { announced.current = t.id; if (fs.sound) pling(); }
    else if (gd && gd.dist > tol * 2 && announced.current === t.id) announced.current = null;
  }, [arrived, t?.id, gd?.dist, tol, fs.sound]); // eslint-disable-line react-hooks/exhaustive-deps

  const angle = gd ? arrowAngle(gd.bearing, course) : 0;
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const byId = new Map(all.map((x) => [x.id, x]));
  const startPicked = () => {
    const list = picked.map((id) => byId.get(id)).filter((x): x is StakeTarget => !!x);
    if (list.length) { setStake(list, 0, false); setPicked([]); }
  };

  return (
    <div className="fld-sec stake" data-testid="stake">
      {t ? (
        <div className={`stk-card${arrived ? ' arrived' : ready ? '' : ' wait'}`} data-testid="stake-card" data-arrived={arrived ? '1' : '0'}>
          <div className="stk-head">
            <strong data-testid="stake-name">{t.name}</strong>
            <span className="muted small" data-testid="stake-count">{SOURCE_LABEL[t.source]}{t.note ? ` · ${t.note}` : ''} · punkt {st.index + 1} av {st.targets.length}</span>
          </div>
          {gd ? (
            <>
              <div className="stk-main">
                <svg className="stk-arrow" viewBox="-50 -50 100 100" aria-hidden="true" data-testid="stake-arrow" data-angle={Math.round(angle)} style={{ transform: `rotate(${angle}deg)` }}>
                  <circle r="46" className="stk-ring" />
                  <path d="M0 -38 L22 18 L0 8 L-22 18 Z" className="stk-tip" />
                </svg>
                <div>
                  <div className="stk-dist" data-testid="stake-dist">{arrived ? 'Fremme' : fmtDist(gd.dist)}</div>
                  <div className="muted small" data-testid="stake-dirnote">{course !== null ? 'Pilen viser retning ut fra gangretningen din.' : 'Nord er opp. Begynn å gå, så dreier pilen etter deg.'}</div>
                </div>
              </div>
              <div className="stk-ne">
                <span data-testid="stake-n">{sign(gd.dN, 'Nord', 'Sør')}</span>
                <span data-testid="stake-e">{sign(gd.dE, 'Øst', 'Vest')}</span>
                {t.z !== null && (
                  <span data-testid="stake-z">
                    {cf === null ? `Mål ${nb(t.z, 3)} m` : Math.abs(cf) < 0.005 ? `Høyde ${nb(t.z, 3)} m, riktig` : cf > 0 ? `Skjær ${nb(cf, 3)} m` : `Fyll ${nb(-cf, 3)} m`}
                  </span>
                )}
              </div>
              {t.z !== null && cf !== null && <div className="muted small">Høyde nå (bakke) {nb(ground ?? 0, 3)} m, mål {nb(t.z, 3)} m. Forutsetter at mottakeren oppgir høyde i samme system som prosjektdata.</div>}
              {!ready && <div className="stk-warn" data-testid="stake-wait">Posisjonen er ikke klar for utsetting. {verdict.ok ? '' : verdict.reason}</div>}
            </>
          ) : <div className="stk-warn" data-testid="stake-nopos">Venter på posisjon. Koble til mottakeren under Innmåling.</div>}
          <div className="stk-btns">
            <button className="btn" disabled={st.index === 0} onClick={() => stepStake(-1)}>Forrige</button>
            <button className="btn" disabled={st.index >= st.targets.length - 1} onClick={() => stepStake(1)}>Neste</button>
            <button className="btn primary" onClick={() => onMeasureHere(t.name)}>Mål her</button>
            <button className="btn" onClick={onShowTarget}>Vis i kart</button>
            <button className="btn" onClick={clearStake}>Avslutt</button>
          </div>
          {st.targets.length > 1 && (
            <div className="stk-queue" data-testid="stake-queue">
              {st.targets.map((x, i) => <button key={x.id} className={`chip${i === st.index ? ' on' : ''}`} onClick={() => gotoStake(i)}>{x.name}</button>)}
            </div>
          )}
        </div>
      ) : (
        <p className="muted small" data-testid="stake-empty">Velg et punkt å gå til. Du kan også trykke på et objekt, et bilde eller et punkt i Kart og velge «Gå til».</p>
      )}

      <div className="stk-list">
        <strong>{t ? 'Velg andre punkter' : 'Velg punkter'}</strong>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Søk i navn, kode eller fil" aria-label="Søk punkt" />
        {all.length === 0 ? (
          <p className="muted small" data-testid="stake-none">Ingen punkter å velge ennå. Last opp KOF-, SOSI- eller LandXML-filer, ta bilder med posisjon, mål inn punkter, eller trykk på et objekt i Kart.</p>
        ) : (
          <>
            <div className="muted small">{rows.length < all.length && !query ? `Viser ${rows.length} av ${all.length}, ` : ''}{here ? 'nærmest først' : 'sortert på navn (posisjon mangler)'}</div>
            <div className="stk-rows" data-testid="stake-rows">
              {rows.map(({ t: x, d }) => (
                <div key={x.id} className="stk-row">
                  <input type="checkbox" checked={picked.includes(x.id)} onChange={() => togglePick(x.id)} aria-label={`Velg ${x.name}`} />
                  <span className="stk-rn"><b>{x.name}</b><i>{SOURCE_LABEL[x.source]}{x.note ? ` · ${x.note}` : ''}</i></span>
                  <span className="stk-rd">{d !== null ? fmtDist(d) : ''}</span>
                  <button className="btn" onClick={() => setStake([x], 0, false)} aria-label={`Gå til ${x.name}`}>Gå til</button>
                </div>
              ))}
              {rows.length === 0 && <div className="muted small">Ingen treff.</div>}
            </div>
            <div className="stk-btns">
              <button className="btn primary" disabled={!picked.length} onClick={startPicked}>Utsett valgte ({picked.length})</button>
              <button className="btn" disabled={!picked.length} onClick={() => setPicked([])}>Fjern valg</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
