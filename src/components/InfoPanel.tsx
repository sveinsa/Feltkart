import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DxfItem, OrthoItem, PhotoItem, Selection } from '../types';
import type { Project } from '../state';
import { crsName, CRS_LIST, formatProjected, fmt } from '../lib/crs';
import { IconChevron, IconClose, IconExpand, IconPano, IconPin, IconTrash } from './icons';
import { FORMAT_LABEL } from '../lib/vector';
import { useMemo } from 'react';
import PanoViewer from './PanoViewer';
import { vertexTargets, type StakeTarget } from '../lib/field/stake';

interface Props {
  project: Project;
  selection: Selection;
  onClose: () => void;
  onOpenViewer: (id: string) => void;
  onStartPlace: (id: string) => void;
  onZoomTo: (id: string) => void;
  /** Alle bilder i visningsrekkefølge, brukes til å bla i forhåndsvisningen */
  photos: PhotoItem[];
  onSelectItem: (id: string) => void;
  /** Fullskjermvisning er åpen: da hviler 360-visningen i dialogen (sparer grafikkminne) */
  viewerOpen?: boolean;
  /** Android-appen: send punkter til utsetting («Gå til»). Utelatt på nett. */
  onStake?: (targets: StakeTarget[], index?: number) => void;
}

/** «Gå til»-knapper for utsetting (Android-appen) */
function StakeButtons({ item, f, index, onStake }: { item: Pick<DxfItem, 'id' | 'name'>; f: Parameters<typeof vertexTargets>[1]; index: number; onStake: (t: StakeTarget[], i?: number) => void }) {
  const all = vertexTargets(item, f, index);
  const [k, setK] = useState(0);
  if (!all.length) return null;
  if (all.length === 1) return <div className="btn-row"><button className="btn primary" onClick={() => onStake(all)}>Gå til punktet</button></div>;
  const many = all.length > 300;
  const list = many ? all.slice(0, 300) : all;
  return (
    <>
      <div className="btn-row"><button className="btn primary" onClick={() => onStake(list)}>Gå til alle hjørner ({list.length})</button></div>
      {many && <p className="muted small">Objektet har {all.length} punkter. De første 300 tas med.</p>}
      <div className="field">
        <label>Eller bare ett punkt</label>
        <select aria-label="Velg hjørne" value={k} onChange={(e) => setK(Number(e.target.value))}>
          {list.map((t, i) => <option key={t.id} value={i}>Punkt {i + 1}{t.z !== null ? ` (høyde ${t.z.toFixed(2).replace('.', ',')} m)` : ''}</option>)}
        </select>
      </div>
      <div className="btn-row"><button className="btn" onClick={() => onStake([list[k]])}>Gå til valgt punkt</button></div>
    </>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="info-section">
      <button className="info-section-head" onClick={() => setOpen(!open)}>
        <IconChevron size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        <span>{title}</span>
      </button>
      {open && <div className="info-section-body">{children}</div>}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="kv"><span>{k}</span><span>{v}</span></div>
);

const dateFmt = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' });

/** Forsinker en verdi litt, slik at 360-visningen ikke startes for hvert bilde når man blar raskt */
function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Stor forhåndsvisning med bla-knapper. Bruker bildefilen (ikke miniatyren) slik at den blir skarp.
 *  360-bilder vises som levende 360-visning rett i dialogen (dra for å rotere, rull for å zoome). */
function PhotoPreview({ p, index, total, onPrev, onNext, onOpen, paused }: {
  p: PhotoItem; index: number; total: number; onPrev?: () => void; onNext?: () => void; onOpen: () => void; paused?: boolean;
}) {
  const url = useMemo(() => URL.createObjectURL(p.blob), [p.id, p.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const isPano = p.kind === 'pano';
  const settledId = useSettled(p.id, 180);
  const live = isPano && !paused && settledId === p.id;
  return (
    <div className="info-preview">
      {isPano ? (
        <div className="info-pano" data-live={live ? '1' : '0'} style={{ backgroundImage: `url(${p.thumb})` }}>
          {live && <PanoViewer blob={p.blob} key={p.id} />}
        </div>
      ) : (
        <button className="info-preview-img" onClick={onOpen} title="Åpne i fullskjerm">
          <img src={url} alt={p.name} style={{ backgroundImage: `url(${p.thumb})` }} />
          <span className="info-open">Åpne fullskjerm</span>
        </button>
      )}
      {onPrev && <button className="info-nav prev" onClick={onPrev} aria-label="Forrige bilde" title="Forrige (←)"><IconChevron size={22} style={{ transform: 'rotate(180deg)' }} /></button>}
      {onNext && <button className="info-nav next" onClick={onNext} aria-label="Neste bilde" title="Neste (→)"><IconChevron size={22} /></button>}
      <span className="info-count">{index + 1} / {total}</span>
      <div className="info-actions">
        <button className="btn primary" onClick={onOpen}>{isPano ? <IconPano size={18} /> : <IconExpand size={18} />} {isPano ? 'Åpne 360 i fullskjerm' : 'Åpne fullskjerm'}</button>
      </div>
    </div>
  );
}

export default function InfoPanel({ project, selection, onClose, onOpenViewer, onStartPlace, onZoomTo, photos, onSelectItem, viewerOpen, onStake }: Props) {
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => setConfirmDel(false), [selection]);
  // Endringer samles i et utkast til du trykker Lagre
  const [draft, setDraft] = useState<Record<string, any>>({});
  const selKey = selection?.type === 'item' ? selection.id : selection?.type ?? '';
  useEffect(() => setDraft({}), [selKey]);
  const val = (k: string, orig: any) => (k in draft ? draft[k] : orig);
  const setVal = (k: string, v: any, orig: any) =>
    setDraft((d) => { const n = { ...d }; if (v === orig) delete n[k]; else n[k] = v; return n; });
  const dirty = Object.keys(draft).length > 0;

  // Bla i bildene (piltaster og knapper). Ulagrede endringer må bekreftes forkastet.
  const selId = selection?.type === 'item' ? selection.id : null;
  const photoIdx = selId ? photos.findIndex((x) => x.id === selId) : -1;
  const go = (delta: number) => {
    const next = photos[photoIdx + delta];
    if (!next) return;
    if (dirty && !window.confirm('Forkast ulagrede endringer på dette bildet?')) return;
    onSelectItem(next.id);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (photoIdx < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goRef.current(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goRef.current(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoIdx < 0]);

  if (!selection || !project.settings) return null;
  const crs = project.settings.projectCrs;

  const coords = (lat: number, lng: number) => {
    const p = formatProjected(crs, lat, lng);
    return (
      <>
        <Row k={crs === 'EPSG:4326' ? 'Lengde' : 'Øst'} v={p.e} />
        <Row k={crs === 'EPSG:4326' ? 'Bredde' : 'Nord'} v={p.n} />
        <Row k="System" v={crsName(crs)} />
      </>
    );
  };

  const folderName = (id: string) => project.folders.find((f) => f.id === id)?.name ?? '–';

  const deleteBtn = (id: string) => (
    <button className={`btn danger${confirmDel ? ' solid' : ''}`} onClick={() => { if (!confirmDel) { setConfirmDel(true); return; } project.deleteItem(id); onClose(); }}>
      <IconTrash size={15} /> {confirmDel ? 'Bekreft sletting' : 'Slett'}
    </button>
  );

  let title = 'Objektinformasjon';
  let subtitle = '';
  let body: ReactNode = null;

  if (selection.type === 'point') {
    subtitle = 'Punkt på kartet';
    body = <Section title="Koordinater">{coords(selection.lat, selection.lng)}
      <Row k="WGS84" v={`${selection.lat.toFixed(6)}, ${selection.lng.toFixed(6)}`} /></Section>;
    if (onStake) {
      const at = { lat: selection.lat, lng: selection.lng };
      body = <>{body}<Section title="Utsetting"><div className="btn-row"><button className="btn primary" onClick={() => onStake([{ id: `k:${at.lat.toFixed(7)}:${at.lng.toFixed(7)}`, name: 'Valgt punkt i kart', lat: at.lat, lng: at.lng, z: null, source: 'kart' }])}>Gå til dette punktet</button></div></Section></>;
    }
  }

  if (selection.type === 'dxf-feature') {
    const item = project.items.find((i) => i.id === selection.itemId) as DxfItem | undefined;
    const f = project.dxf[selection.itemId]?.data?.features[selection.index];
    if (!item || !f) return null;
    subtitle = f.text ? `Tekst: ${f.text.slice(0, 40)}` : `${f.type} på lag ${f.layer}`;
    const zs = f.z.filter((z) => Number.isFinite(z) && z !== 0);
    body = (
      <>
        <Section title="Prosjektert objekt">
          <Row k="Lag" v={<><span className="swatch" style={{ background: f.color }} /> {f.layer}</>} />
          <Row k="Type" v={f.type} />
          {f.block && <Row k="Blokk" v={f.block} />}
          {f.attrs && Object.entries(f.attrs).map(([k, v]) => <Row key={k} k={k} v={v} />)}
          {f.text && <Row k="Tekst" v={<span style={{ whiteSpace: 'pre-wrap' }}>{f.text}</span>} />}
          {f.geom === 'line' && <Row k="Lengde (2D)" v={fmt.m(f.length)} />}
          {f.geom === 'polygon' && <><Row k="Omkrets" v={fmt.m(f.length)} /><Row k="Areal" v={fmt.m2(f.area ?? 0)} /></>}
          <Row k="Punkter" v={f.latlngs.length} />
        </Section>
        <Section title="Høyde">
          {zs.length ? (
            zs.length === 1 || Math.min(...zs) === Math.max(...zs)
              ? <Row k="Høyde" v={fmt.m(zs[0])} />
              : <><Row k="Laveste" v={fmt.m(Math.min(...zs))} /><Row k="Høyeste" v={fmt.m(Math.max(...zs))} />
                {f.geom === 'line' && f.length > 0 && <Row k="Snittfall" v={`${fmt.num(((zs[zs.length - 1] - zs[0]) / f.length) * 100, 2)} %`} />}</>
          ) : <span className="muted">Ingen høydeinformasjon (2D)</span>}
        </Section>
        {onStake && <Section title="Utsetting"><StakeButtons key={`${item.id}:${selection.index}`} item={item} f={f} index={selection.index} onStake={onStake} /></Section>}
        <Section title="Fil">
          <Row k="Fil" v={item.name} />
          <Row k="System" v={crsName(item.crs)} />
        </Section>
      </>
    );
  }

  if (selection.type === 'item') {
    const it = project.items.find((i) => i.id === selection.id);
    if (!it) return null;

    if (it.kind === 'photo' || it.kind === 'pano') {
      const p = it as PhotoItem;
      title = p.kind === 'pano' ? '360-bilde' : 'Bilde';
      subtitle = p.name;
      body = (
        <>
          <PhotoPreview p={p} index={photoIdx} total={photos.length}
            onPrev={photoIdx > 0 ? () => go(-1) : undefined}
            onNext={photoIdx >= 0 && photoIdx < photos.length - 1 ? () => go(1) : undefined}
            onOpen={() => onOpenViewer(p.id)} paused={viewerOpen} />
          <Section title="Bilde">
            <div className="field">
              <label>Notat</label>
              <textarea rows={2} value={val('note', p.note ?? '')} placeholder="Skriv et notat …"
                onChange={(e) => setVal('note', e.target.value, p.note ?? '')} />
            </div>
            <Row k="Tatt" v={dateFmt.format(new Date(p.takenAt))} />
            <Row k="Type" v={
              <select value={val('kind', p.kind)} onChange={(e) => setVal('kind', e.target.value, p.kind)}>
                <option value="photo">Foto</option>
                <option value="pano">360-bilde</option>
              </select>} />
            <Row k="Størrelse" v={`${p.width} × ${p.height} px`} />
            <Row k="Mappe" v={
              <select value={val('folderId', p.folderId)} onChange={(e) => setVal('folderId', e.target.value, p.folderId)}>
                {project.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>} />
          </Section>
          <Section title="Posisjon">
            {p.lat !== null && p.lng !== null ? (
              <>
                {coords(p.lat, p.lng)}
                {p.altitude !== null && <Row k="Høyde (GPS)" v={fmt.m(p.altitude)} />}
                {p.heading !== null && <Row k="Retning" v={`${fmt.num(p.heading, 0)}°`} />}
              </>
            ) : <p className="muted">Bildet har ingen GPS-posisjon.</p>}
            <div className="btn-row">
              <button className="btn" onClick={() => onStartPlace(p.id)}><IconPin size={15} /> {p.lat !== null ? 'Flytt' : 'Plasser på kart'}</button>
              {p.lat !== null && <button className="btn" onClick={() => onZoomTo(p.id)}>Zoom til</button>}
              {p.lat !== null && p.lng !== null && onStake && (
                <button className="btn primary" onClick={() => onStake([{ id: `p:${p.id}`, name: p.name, lat: p.lat as number, lng: p.lng as number, z: null, source: 'bilde', note: p.kind === 'pano' ? '360-bilde' : 'Bilde' }])}>Gå til bildet</button>
              )}
            </div>
          </Section>
        </>
      );
    }

    if (it.kind === 'dxf') {
      const d = it as DxfItem;
      const st = project.dxf[d.id];
      title = `${FORMAT_LABEL[d.format ?? 'dxf']} – prosjekterte data`;
      subtitle = d.name;
      body = (
        <>
          <Section title="Fil">
            <Row k="Objekter" v={st?.data ? st.data.features.length : st?.loading ? 'leser …' : '–'} />
            <Row k="Lag" v={st?.data ? `${st.data.layers.length - d.hiddenLayers.length} av ${st.data.layers.length} synlige` : '–'} />
            <Row k="Mappe" v={folderName(d.folderId)} />
            <div className="field">
              <label>Koordinatsystem i filen</label>
              <select value={val('crs', d.crs)} onChange={(e) => setVal('crs', e.target.value, d.crs)}>
                {CRS_LIST.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
              </select>
            </div>
            <div className="btn-row"><button className="btn" onClick={() => onZoomTo(d.id)}>Zoom til tegning</button></div>
          </Section>
          {st?.error && <Section title="Feil"><p className="error">{st.error}</p></Section>}
          {!!st?.data?.warnings.length && (
            <Section title="Merknader" defaultOpen={false}>
              {st.data.warnings.map((w, i) => <p key={i} className="muted small">{w}</p>)}
            </Section>
          )}
        </>
      );
    }

    if (it.kind === 'ortho') {
      const o = it as OrthoItem;
      title = 'Droneortofoto';
      subtitle = o.name;
      body = (
        <Section title="Ortofoto">
          <Row k="Opprinnelig størrelse" v={`${o.sourceSize[0]} × ${o.sourceSize[1]} px`} />
          {o.resolution && <Row k="Oppløsning" v={`${fmt.num(o.resolution * 100, 1)} cm/piksel`} />}
          <Row k="System" v={crsName(o.crs)} />
          <Row k="Mappe" v={folderName(o.folderId)} />
          <div className="field">
            <label>Gjennomsiktighet ({Math.round(o.opacity * 100)} %)</label>
            <input type="range" min={0} max={1} step={0.05} value={o.opacity} onChange={(e) => project.saveItem({ ...o, opacity: +e.target.value })} />
          </div>
          <div className="btn-row"><button className="btn" onClick={() => onZoomTo(o.id)}>Zoom til ortofoto</button></div>
        </Section>
      );
    }

    body = (
      <>
        {body}
        <div className="info-footer">
          {deleteBtn(it.id)}
          {it.kind !== 'ortho' && (
            <div className="info-save">
              <button className="btn" onClick={() => setDraft({})} disabled={!dirty}>Avbryt</button>
              <button className="btn primary" onClick={() => { project.saveItem({ ...(it as any), ...draft }); setDraft({}); }} disabled={!dirty}>Lagre</button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <aside className={`info-panel${photoIdx >= 0 ? ' wide' : ''}`}>
      <div className="info-head">
        <div>
          <div className="muted small">{title}</div>
          <div className="info-title" title={subtitle}>{subtitle}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Lukk"><IconClose size={16} /></button>
      </div>
      <div className="info-body">{body}</div>
    </aside>
  );
}
