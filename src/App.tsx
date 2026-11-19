import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, PhotoItem, Selection, Tool } from './types';
import { useProject } from './state';
import MapView, { type FitRequest } from './components/MapView';
import LayerTree from './components/LayerTree';
import BasemapPicker from './components/BasemapPicker';
import InfoPanel from './components/InfoPanel';
import UploadDialog from './components/UploadDialog';
import MediaViewer from './components/MediaViewer';
import PhotosPanel, { type PhotoSort, type PhotoTypeFilter } from './components/PhotosPanel';
import ProjectFiles from './components/ProjectFiles';
import WelcomeDemo from './components/WelcomeDemo';
import { isDemoMode } from './lib/field/demoBridge';
import ProjectMenu from './components/ProjectMenu';
import { hardRefresh } from './lib/refresh';
import { isDefaultProject } from './lib/projects';
import TransferStatus from './components/TransferStatus';
import { startJob } from './lib/transfer';
import ErrorBoundary from './components/ErrorBoundary';

// Terreng 3D (MapLibre + three.js) lastes først når fanen åpnes
const Terrain3D = lazy(() => import('./components/Terrain3D'));
import Gallery from './components/Gallery';
import SettingsView from './components/SettingsView';
import FieldStatusBar from './components/FieldStatusBar';
import FieldPanel from './components/FieldPanel';
import SurveyRegister from './components/SurveyRegister';
import ReadmeDialog from './components/ReadmeDialog';
import { openReadmeWindow } from './lib/readme';
import { useGnss } from './lib/field/useGnss';
import { loadPoints, POINTS_EVENT } from './lib/field/survey';
import { currentTarget, setStake, useStake } from './lib/field/stake';
import { installDownloadShim, isNative } from './lib/field/native';
import DriveDialog, { googleConfig } from './components/DriveDialog';
import SyncDialog from './components/SyncDialog';
import { VERSION, VERSION_LABEL } from './version';
import { fetchDriveBlob } from './lib/google';
import { hasDemoSource, loadDemoData } from './lib/demoLoad';
import { basemapById } from './lib/basemaps';
import { crsName, formatProjected } from './lib/crs';
import {
  IconArea, IconBook, IconCalendar, IconEdit, IconFolder, IconGoogle, IconExtent, IconGrid, IconLayers, IconMap, IconPointer, IconRefresh, IconRuler, IconSettings, IconTrash, IconUpload,
} from './components/icons';

type View = 'map' | 'photos' | 'gallery' | 'files' | 'terrain3d' | 'settings' | 'field' | 'survey';
/** «Innmåling» (register over innmålte punkter) finnes overalt. «Felt» (selve målingen med RTK, bilde og Bluetooth) finnes bare i Android-appen. */
type Panel = 'tree' | 'basemap' | null;

export default function App() {
  const project = useProject();
  const { ready, items, settings, dxf } = project;

  // I Android-appen er skjermen forenklet: bare «Felt» og «Kart», og appen starter i Felt
  const appMode = isNative();
  const [view, setView] = useState<View>(appMode ? 'field' : 'map');
  const [panel, setPanel] = useState<Panel>(appMode ? null : 'tree');
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ files: File[] } | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [demo, setDemo] = useState<{ busy: boolean; msg: string; pct: number; startedAt: number; error: string | null }>({ busy: false, msg: '', pct: 0, startedAt: 0, error: null });
  const demoStarted = useRef(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [bmOpen, setBmOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [photoType, setPhotoType] = useState<PhotoTypeFilter>('all');
  const [photoSort, setPhotoSort] = useState<PhotoSort>('new');
  const [offFolders, setOffFolders] = useState<Set<string>>(() => new Set());
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [globalDrag, setGlobalDrag] = useState(false);
  const fitSeq = useRef(0);
  const didInitialFit = useRef(false);

  const gnss = useGnss();
  const stakeState = useStake();
  const stakeTarget = currentTarget(stakeState);
  const [followGnss, setFollowGnss] = useState(appMode);
  // Innmålte punkter som ikke er lagt inn i prosjektet ennå, vises i kartet (også det lille kartet i Felt)
  const [fieldMarks, setFieldMarks] = useState(() => loadPoints().filter((p) => !p.saved));
  useEffect(() => {
    const upd = () => setFieldMarks(loadPoints().filter((p) => !p.saved));
    window.addEventListener(POINTS_EVENT, upd);
    return () => window.removeEventListener(POINTS_EVENT, upd);
  }, []);
  // Android-appen: «Tilbake» (knappen i appen og Androids tilbake-knapp) går alltid mot Felt
  useEffect(() => { document.documentElement.dataset.fkView = view; }, [view]);
  useEffect(() => {
    if (!appMode) return;
    const onBack = () => { if (view === 'map' && panel) setPanel(null); else setView('field'); };
    window.addEventListener('fk-back', onBack);
    return () => window.removeEventListener('fk-back', onBack);
  }, [view, panel]);
  useEffect(() => { installDownloadShim((n, w) => showToast(`${n} lagret i ${w}`), (e) => showToast('Kunne ikke lagre filen: ' + e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------- Demodata fra Google Disk (lastes automatisk når kartet er tomt) ----------
  const startDemo = useCallback(async () => {
    setDemo({ busy: true, msg: 'Starter …', pct: 1, startedAt: Date.now(), error: null });
    const job = startJob('Laster demodata', 'Starter …', 'Antatt tid for nedlasting er ca. 60 sekunder.'); // fremdriften vises i statusfeltet i alle visninger
    try {
      const r = await loadDemoData(project, googleConfig(project), (msg, pct) => {
        setDemo((d) => ({ ...d, msg, pct: pct !== undefined ? Math.max(d.pct, pct) : d.pct }));
        job.update(msg, pct);
      }, { replace: true });
      setDemo((d) => ({ ...d, busy: false, msg: '', error: r.message || null }));
      if (r.added) { job.done(`${r.added} demoelement(er) lastet inn.${r.message ? ' ' + r.message : ''}`, { keep: !!r.message }); showToast(`${r.added} demoelement(er) lastet inn`); if (r.bounds) fitTo(r.bounds, 19); }
      else if (r.message) job.fail(r.message);
      else job.done();
    } catch (e: any) {
      setDemo((d) => ({ ...d, busy: false, msg: '', error: String(e?.message ?? e) }));
      job.fail(String(e?.message ?? e));
    }
  }, [project, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !settings || demoStarted.current) return;
    // Når prosjektet er tomt ved åpning (og det finnes en API-nøkkel): vis velkomstboks med spørsmål om å laste demodata
    if (items.length > 0) return;
    if (isDemoMode()) return; // Android-demoen spør ikke om å laste data fra Google Disk
    if (!isDefaultProject()) return; // demodata hører til første prosjekt (Oppdal Ålma); de andre er tomme
    demoStarted.current = true;
    void hasDemoSource(googleConfig(project)).then((ok) => { if (ok) setWelcomeOpen(true); else demoStarted.current = false; }); // spør først – lastingen starter når brukeren sier ja
  }, [ready, settings, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Når alt innhold er slettet (Nullstill demo): nullstill valg og filtre, og vis «Kom i gang»
  useEffect(() => {
    if (!ready || items.length > 0) return;
    setSelection(null);
    setDateFrom(''); setDateTo('');
    setPhotoType('all'); setOffFolders(new Set());
    setPlacingId(null); setViewerId(null);
    setView((v) => (v === 'photos' || v === 'gallery' ? 'map' : v));
    setDemo((d) => (d.busy ? d : { ...d, busy: false, msg: '', pct: 0, error: null }));
  }, [ready, items.length]);

  const photos = useMemo(
    () => items.filter((i): i is PhotoItem => i.kind === 'photo' || i.kind === 'pano').sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [items],
  );

  // ---------- Datofilter for bilder i kartet ----------
  const dayOf = (p: PhotoItem) => p.takenAt.slice(0, 10);
  const photoDays = useMemo(() => {
    const d = photos.map(dayOf).sort();
    return { min: d[0] ?? '', max: d[d.length - 1] ?? '', list: [...new Set(d)] };
  }, [photos]);
  const dateActive = !!(dateFrom || dateTo);
  const inDateRange = useCallback((p: PhotoItem) => (!dateFrom || dayOf(p) >= dateFrom) && (!dateTo || dayOf(p) <= dateTo), [dateFrom, dateTo]);
  // Type- og mappefilter gjelder i bildevisningen; datofilteret gjelder overalt
  const photoMode = view === 'photos';
  const mapItems = useMemo(() => {
    const isPhoto = (i: Item) => i.kind === 'photo' || i.kind === 'pano';
    const extra = photoMode && (photoType !== 'all' || offFolders.size > 0);
    if (!dateActive && !extra) return items;
    return items.filter((i) => {
      if (!isPhoto(i)) return true;
      if (!inDateRange(i as PhotoItem)) return false;
      if (extra && ((photoType !== 'all' && i.kind !== photoType) || offFolders.has(i.folderId))) return false;
      return true;
    });
  }, [items, dateActive, inDateRange, photoMode, photoType, offFolders]);
  const shownPhotos = useMemo(() => photos.filter(inDateRange).length, [photos, inDateRange]);
  const isoDay = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const setRange = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const dateFmtShort = (d: string) => (d ? d.split('-').reverse().join('.') : '…');

  // ---------- Zoom ----------
  const boundsOf = useCallback((it: Item): FitRequest['bounds'] | null => {
    if (it.kind === 'photo' || it.kind === 'pano') return it.lat !== null ? [[it.lat, it.lng!], [it.lat, it.lng!]] : null;
    if (it.kind === 'ortho') return it.bounds;
    if (it.kind === 'dxf') return dxf[it.id]?.data?.bounds ?? null;
    return null;
  }, [dxf]);

  const fitTo = useCallback((bounds: FitRequest['bounds'] | null, maxZoom?: number) => {
    if (!bounds) return;
    setFit({ seq: ++fitSeq.current, bounds, maxZoom });
  }, []);

  const zoomToItem = useCallback((id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    setView((v) => ((v === 'photos' || v === 'gallery') && (it.kind === 'photo' || it.kind === 'pano') ? 'photos' : 'map'));
    fitTo(boundsOf(it), it.kind === 'photo' || it.kind === 'pano' ? 19 : 20);
  }, [items, boundsOf, fitTo]);

  const zoomToAll = useCallback(() => {
    let s = 90, w = 180, n = -90, e = -180;
    for (const it of items) {
      if (it.hidden) continue;
      const b = boundsOf(it) as [[number, number], [number, number]] | null;
      if (!b) continue;
      s = Math.min(s, b[0][0]); w = Math.min(w, b[0][1]); n = Math.max(n, b[1][0]); e = Math.max(e, b[1][1]);
    }
    if (s <= n) fitTo([[s, w], [n, e]], 19);
    else showToast('Ingen synlige objekter med posisjon å zoome til');
  }, [items, boundsOf, fitTo, showToast]);

  // Zoom til innholdet første gang prosjektet lastes
  useEffect(() => {
    if (!ready || didInitialFit.current || !items.length) return;
    const dxfPending = items.some((i) => i.kind === 'dxf' && !dxf[i.id]?.data && !dxf[i.id]?.error);
    if (dxfPending) return;
    didInitialFit.current = true;
    zoomToAll();
  }, [ready, items, dxf, zoomToAll]);

  // ---------- Hendelser ----------
  const openItem = useCallback((id: string) => {
    setSelection({ type: 'item', id });
    const it = items.find((i) => i.id === id);
    if (it && boundsOf(it)) zoomToItem(id);
  }, [items, boundsOf, zoomToItem]);

  const onPlace = useCallback((lat: number, lng: number) => {
    const it = items.find((i) => i.id === placingId) as PhotoItem | undefined;
    if (it) {
      project.saveItem({ ...it, lat, lng, hidden: false });
      setSelection({ type: 'item', id: it.id });
      showToast('Posisjonen er lagret');
    }
    setPlacingId(null);
    setTool('select');
  }, [items, placingId, project, showToast]);

  // Måling og andre kartverktøy avsluttes når man forlater kartet (kartet ligger skjult under de andre fanene)
  useEffect(() => {
    if (view !== 'map' && view !== 'photos') { setTool('select'); setPlacingId(null); }
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || viewerId || upload) return;
      if (tool !== 'select') { setTool('select'); setPlacingId(null); }
      else setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, viewerId, upload]);

  // Dra filer inn hvor som helst i vinduet
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setGlobalDrag(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setGlobalDrag(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setGlobalDrag(false);
      if (document.querySelector('.modal.upload')) return; // dialogen håndterer selv
      const files = Array.from(e.dataTransfer!.files);
      if (files.length) setUpload({ files });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!ready || !settings) return <div className="loading">Laster prosjekt …</div>;

  const native = appMode;
  /** Felt med lite kart samtidig (bare i appen) */
  const split = native && view === 'field';
  /** Readme i eget vindu. I appen, eller hvis nettleseren blokkerer vinduet, vises den i en dialog. */
  const openReadme = () => { if (native || !openReadmeWindow(VERSION, VERSION_LABEL)) setReadmeOpen(true); };
  /** Fra Innmåling: vis ett punkt i kartet */
  const showPoint = (lat: number, lng: number) => {
    setView('map');
    setSelection({ type: 'point', lat, lng });
    fitTo([[lat - 0.00015, lng - 0.0003], [lat + 0.00015, lng + 0.0003]], 20);
  };

  const basemap = basemapById(settings.basemapId, settings.customBasemap);
  const visibleOrthos = items.filter((i) => i.kind === 'ortho' && !i.hidden).length;
  const layerCount = (basemap.url ? 1 : 0) + visibleOrthos;
  const coordText = coord ? formatProjected(settings.projectCrs, coord.lat, coord.lng) : null;

  const toolBtn = (t: Tool, Icon: typeof IconPointer, title: string, label?: string) => (
    <button className={`tb-btn${label ? ' wide' : ''}${tool === t ? ' on' : ''}`} title={title} onClick={() => { setTool(tool === t && label ? 'select' : t); setPlacingId(null); }}>
      <Icon size={18} />{label && <span>{label}</span>}
    </button>
  );

  return (
    <div className={`app${native ? ' native' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="7" fill="#8dc63f" /><path d="M8 23l5.5-13 4.5 8.5 2.2-4L24 23z" fill="#0f5a3c" /></svg>
          </span>
          <span className="brand-text">
            <span className="brand-name">Feltkart</span>
            <span className="brand-version">{VERSION_LABEL}</span>
          </span>
        </div>
        <nav className="topnav">
          {native && <button className={view === 'field' ? 'on' : ''} onClick={() => setView('field')}>Felt</button>}
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Kart</button>
          {!native && <button className={view === 'photos' || view === 'gallery' ? 'on' : ''} onClick={() => setView('photos')}>Bilder</button>}
          {!native && <button className={view === 'survey' ? 'on' : ''} onClick={() => setView('survey')}>Innmåling</button>}
          {!native && <button className={view === 'files' ? 'on' : ''} onClick={() => setView('files')}>Prosjektfiler</button>}
          {!native && <button className={view === 'terrain3d' ? 'on' : ''} onClick={() => setView('terrain3d')}>Terreng 3D <span className="beta-tag">beta</span></button>}
        </nav>
        {!native && <div className="topbar-right">
          <a className="appdemo" href="android-demo.html" target="_blank" rel="noopener noreferrer" title="Se en demo av Android-appen (åpnes i et nytt vindu)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="18.6" r="1" fill="currentColor" /></svg>
            <span>Android-app</span>
          </a>
          <a className="bugreport" href="https://forms.cloud.microsoft/e/waiwYtDeUX?origin=lprLink" target="_blank" rel="noopener noreferrer" title="Meld fra om feil i Feltkart (åpnes i et nytt vindu)">Bugreport <span aria-hidden="true">🪲</span></a>
          <ProjectMenu name={settings.projectName} onSettings={() => setView('settings')} />
          <button className="btn primary" onClick={() => setUpload({ files: [] })}><IconUpload size={16} /> Last opp</button>
        </div>}
      </header>
      {native && <FieldStatusBar />}
      {native && view !== 'field' && view !== 'map' && (
        <button className="native-back" data-testid="native-back" onClick={() => setView('field')}><span aria-hidden="true">←</span> Tilbake til Felt</button>
      )}

      <div className="body">
        {!native && <nav className="rail">
          <button className={view === 'map' && panel === 'tree' ? 'on' : ''} title="Innhold og lag"
            onClick={() => { setView('map'); setPanel(panel === 'tree' && view === 'map' ? null : 'tree'); }}><IconLayers size={20} /></button>
          <button className={view === 'map' && panel === 'basemap' ? 'on' : ''} title="Bakgrunnskart"
            onClick={() => { setView('map'); setPanel(panel === 'basemap' && view === 'map' ? null : 'basemap'); }}><IconMap size={20} /></button>
          <button className={view === 'photos' || view === 'gallery' ? 'on' : ''} title="Bilder i kart" onClick={() => setView('photos')}><IconGrid size={20} /></button>
          <button title="Last opp" onClick={() => setUpload({ files: [] })}><IconUpload size={20} /></button>
          <button title="Google Disk (beta)" className="rail-google" onClick={() => setSyncOpen(true)}><IconGoogle size={20} /><span className="rail-beta">beta</span></button>
          <div className="rail-spacer" />
          <button className="rail-text rail-readme" title="Readme – om Feltkart, hjelp og versjonshistorikk (åpnes i eget vindu)" onClick={openReadme}><IconBook size={18} /><span>Readme</span></button>
          <button className="rail-text rail-update" title="Sjekk ny versjon Feltkart – gjør det samme som Ctrl + Shift + R. Dine data beholdes." onClick={() => { showToast('Sjekker ny versjon av Feltkart …'); void hardRefresh(); }}><IconRefresh size={18} /><span>Sjekk ny versjon Feltkart</span></button>
          <button className="rail-text rail-reset" title="Nullstill demodata – slett alt innhold" onClick={() => setResetOpen(true)}><IconTrash size={18} /><span>Nullstill demodata</span></button>
          <button className={view === 'settings' ? 'on' : ''} title="Innstillinger" onClick={() => setView('settings')}><IconSettings size={20} /></button>
        </nav>}

        {view === 'photos' && (
          <aside className="side-panel wide">
            <PhotosPanel
              photos={photos}
              folders={project.folders}
              selectedId={selection?.type === 'item' ? selection.id : null}
              type={photoType} onType={setPhotoType}
              sort={photoSort} onSort={setPhotoSort}
              dateFrom={dateFrom} dateTo={dateTo} onRange={setRange}
              offFolders={offFolders}
              onToggleFolder={(id, on) => setOffFolders((s0) => { const n = new Set(s0); if (on) n.delete(id); else n.add(id); return n; })}
              onSetFolders={(ids) => setOffFolders(new Set(ids))}
              onPick={(ph) => { if (ph.lat !== null) openItem(ph.id); else setViewerId(ph.id); }}
              onOpenViewer={setViewerId}
              onGrid={() => setView('gallery')}
            />
          </aside>
        )}
        {view === 'map' && panel && (
          <aside className="side-panel">
            {panel === 'tree' && <LayerTree project={project} selection={selection} onOpenItem={openItem} />}
            {panel === 'basemap' && (
              <div className="tree-panel">
                <div className="panel-head"><h2>Bakgrunnskart</h2></div>
                <BasemapPicker project={project} onZoomTo={zoomToItem} />
              </div>
            )}
          </aside>
        )}

        <main className={`main${split ? ' split' : ''}`}>
          <div className="map-host" style={{ visibility: view === 'map' || view === 'photos' || split ? 'visible' : 'hidden' }}>
            <MapView
              items={mapItems}
              dxf={dxf}
              basemapId={settings.basemapId}
              customBasemap={settings.customBasemap}
              projectCrs={settings.projectCrs}
              selection={selection}
              tool={tool}
              fit={fit}
              onSelect={setSelection}
              onPlace={onPlace}
              onTool={(t) => { setTool(t); setPlacingId(null); }}
              onMouseCoord={setCoord}
              gnss={gnss.connected && gnss.lat !== null && gnss.lng !== null ? { lat: gnss.lat, lng: gnss.lng, acc: gnss.accH, fix: gnss.quality === 'fix' } : null}
              gnssFollow={followGnss}
              marks={fieldMarks}
              stake={native && stakeState.targets.length ? { targets: stakeState.targets.map((t) => ({ lat: t.lat, lng: t.lng, name: t.name })), index: stakeState.index } : null}
            />
            {gnss.connected && gnss.lat !== null && (
              <button className={`gnss-follow${followGnss ? ' on' : ''}`} title={followGnss ? 'Slutt å følge posisjonen' : 'Følg min posisjon'} aria-pressed={followGnss} onClick={() => setFollowGnss((f) => !f)}>◎</button>
            )}

            <div className="map-toolbar">
              <div className="tb-group">
                {native && (
                  <button className={`tb-btn wide${panel === 'tree' ? ' on' : ''}`} title="Vis eller skjul kartlag" aria-pressed={panel === 'tree'} onClick={() => setPanel(panel === 'tree' ? null : 'tree')}>
                    <IconLayers size={18} /><span>Lag</span>
                  </button>
                )}
                {toolBtn('select', IconPointer, 'Velg / objektinformasjon')}
                {toolBtn('distance', IconRuler, 'Mål avstand / lengde', 'Avstand')}
                {toolBtn('area', IconArea, 'Mål areal innenfor et polygon', 'Areal')}
                <button className="tb-btn" title="Zoom til alt innhold" onClick={zoomToAll}><IconExtent size={18} /></button>
              </div>
              {photos.length > 0 && (
                <div className="tb-group bm">
                  <button className={`tb-btn wide${dateOpen || dateActive ? ' on' : ''}`} onClick={() => { setDateOpen(!dateOpen); setBmOpen(false); }} title="Filtrer bilder på dato">
                    <IconCalendar size={16} /> <span>{dateActive ? `${dateFmtShort(dateFrom)} – ${dateFmtShort(dateTo)}` : 'Dato'}</span>
                    {dateActive && <span className="muted small">· {shownPhotos}/{photos.length}</span>}
                  </button>
                  {dateOpen && (
                    <div className="popover date-filter">
                      <div className="df-row">
                        <label>Fra<input type="date" value={dateFrom} min={photoDays.min} max={dateTo || photoDays.max} onChange={(e) => setDateFrom(e.target.value)} /></label>
                        <label>Til<input type="date" value={dateTo} min={dateFrom || photoDays.min} max={photoDays.max} onChange={(e) => setDateTo(e.target.value)} /></label>
                      </div>
                      <div className="df-chips">
                        <button className="chip" onClick={() => setRange('', '')}>Alle</button>
                        <button className="chip" onClick={() => setRange(isoDay(0), isoDay(0))}>I dag</button>
                        <button className="chip" onClick={() => setRange(isoDay(6), '')}>Siste 7 dager</button>
                        <button className="chip" onClick={() => setRange(isoDay(29), '')}>Siste 30 dager</button>
                        {photoDays.max && <button className="chip" onClick={() => setRange(photoDays.max, photoDays.max)}>Siste bildedag</button>}
                      </div>
                      {photoDays.list.length > 1 && (
                        <>
                          <input
                            type="range" className="df-slider" min={0} max={photoDays.list.length - 1}
                            value={Math.max(0, photoDays.list.indexOf(dateTo || photoDays.max))}
                            onChange={(e) => { const d = photoDays.list[Number(e.target.value)]; setRange(d, d); }}
                            title="Dra for å bla mellom dager med bilder"
                          />
                          <div className="df-sub small muted">Dra for å bla mellom dager med bilder ({photoDays.list.length} dager)</div>
                        </>
                      )}
                      <div className="df-foot small muted">{shownPhotos} av {photos.length} bilder vises i kartet{dateActive && <button className="link-btn" onClick={() => setRange('', '')}> · Nullstill</button>}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="tb-group bm">
                <button className={`tb-btn wide${bmOpen ? ' on' : ''}`} onClick={() => { setBmOpen(!bmOpen); setDateOpen(false); }} title="Velg bakgrunnskart">
                  <IconMap size={16} /> <span>{basemap.name}</span>
                  <span className="muted small">· {layerCount} lag</span>
                </button>
                {bmOpen && (
                  <div className="popover">
                    <BasemapPicker project={project} onZoomTo={(id) => { zoomToItem(id); setBmOpen(false); }} />
                  </div>
                )}
              </div>
            </div>

            <InfoPanel
              project={project}
              selection={selection}
              onClose={() => setSelection(null)}
              onOpenViewer={setViewerId}
              onStartPlace={(id) => { setPlacingId(id); setTool('place'); }}
              onZoomTo={zoomToItem}
              photos={photos}
              onSelectItem={(id) => setSelection({ type: 'item', id })}
              viewerOpen={!!viewerId}
              onStake={native ? (t) => { setStake(t); setView('field'); } : undefined}
            />

            <div className="coord-bar">
              {coordText ? (
                <>
                  <span>Ø {coordText.e}</span><span>N {coordText.n}</span>
                  <span className="muted">{crsName(settings.projectCrs)}</span>
                </>
              ) : <span className="muted">{crsName(settings.projectCrs)}</span>}
            </div>

            {items.length === 0 && !demo.busy && (
              <div className="map-empty">
                <strong>Kom i gang</strong>
                <span>Last opp bilder, 360-bilder, ortofoto fra drone eller prosjekterte data og innmåling (DXF, KOF, SOSI, LandXML, IFC).</span>
                <button className="btn primary" onClick={() => setUpload({ files: [] })}><IconUpload size={16} /> Last opp filer</button>
                <button className="btn" onClick={startDemo}><IconFolder size={16} /> Last demodata</button>
                {demo.error && <span className="error small">{demo.error}</span>}
              </div>
            )}
          </div>

          {view === 'gallery' && (
            <Gallery photos={photos} onBack={() => setView('photos')} onOpen={setViewerId} onShowOnMap={(id) => { setSelection({ type: 'item', id }); zoomToItem(id); }} />
          )}
          {view === 'terrain3d' && (
            <ErrorBoundary label="Terreng 3D" action={{ label: 'Tilbake til kartet', onClick: () => setView('map') }}>
              <Suspense fallback={<div className="empty-state">Laster 3D …</div>}>
                <Terrain3D items={mapItems} photos={mapItems.filter((i): i is PhotoItem => i.kind === 'photo' || i.kind === 'pano')} dxf={dxf} settings={settings}
                  onOpenPhoto={setViewerId} />
              </Suspense>
            </ErrorBoundary>
          )}
          {view === 'files' && (
            <ProjectFiles project={project} onZoomTo={zoomToItem} onOpenViewer={setViewerId}
              onUpload={() => setUpload({ files: [] })} onDrive={() => setSyncOpen(true)} />
          )}
          {view === 'settings' && <SettingsView project={project} />}
          {view === 'survey' && (
            <SurveyRegister project={project} onUpload={() => setUpload({ files: [] })} onToast={showToast} onShowOnMap={showPoint} />
          )}
          {native && (
            <div className="field-host" style={{ display: view === 'field' ? 'block' : 'none' }}>
              <FieldPanel project={project} onToast={showToast} onShowOnMap={() => { setView('map'); setFollowGnss(true); }}
                onShowStake={() => {
                  if (!stakeTarget) return;
                  setView('map'); setFollowGnss(false);
                  const la = [stakeTarget.lat, ...(gnss.connected && gnss.lat !== null ? [gnss.lat] : [])];
                  const lo = [stakeTarget.lng, ...(gnss.connected && gnss.lng !== null ? [gnss.lng] : [])];
                  const dy = 0.00004, dx = 0.00008;
                  fitTo([[Math.min(...la) - dy, Math.min(...lo) - dx], [Math.max(...la) + dy, Math.max(...lo) + dx]], 21);
                }}
                more={{
                  onUpload: () => setUpload({ files: [] }),
                  onSync: () => setSyncOpen(true),
                  onReadme: openReadme,
                  onRefresh: () => { showToast('Sjekker ny versjon av Feltkart …'); void hardRefresh(); },
                  onSettings: () => setView('settings'),
                }} />
            </div>
          )}
        </main>
      </div>

      {readmeOpen && <ReadmeDialog version={VERSION} versionLabel={VERSION_LABEL} onClose={() => setReadmeOpen(false)} />}
      {resetOpen && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setResetOpen(false)}>
          <div className="modal welcome">
            <div className="modal-body welcome-body">
              <h2>Nullstille demo?</h2>
              <p>Alt innhold i Feltkart slettes (bilder, 360-bilder, ortofoto, DXF og innmålinger). Filer på Google Disk berøres ikke. Etterpå kan du laste ned demodata på nytt.</p>
              <div className="welcome-actions">
                <button className="btn danger solid big" onClick={() => { project.resetContent(); setResetOpen(false); setWelcomeOpen(true); showToast('Demo nullstilt'); }}>Ja, nullstill</button>
                <button className="btn big" onClick={() => setResetOpen(false)} autoFocus>Avbryt</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {welcomeOpen && (
        <WelcomeDemo onYes={() => { setWelcomeOpen(false); void startDemo(); }} onNo={() => setWelcomeOpen(false)} />
      )}

      {upload && (
        <UploadDialog
          project={project}
          initialFiles={upload.files}
          onClose={() => setUpload(null)}
          onDone={(r, background) => {
            // Ble dialogen skjult underveis, blir brukeren værende i visningen hen har byttet til
            if (!background && !native) setView('map'); // i appen blir du i Felt
            // Zoom til det som ble lagt til
            if (r.bounds) fitTo(r.bounds, 19);
          }}
        />
      )}

      {syncOpen && (
        <SyncDialog
          project={project}
          onClose={() => setSyncOpen(false)}
          onOpenSettings={() => { setSyncOpen(false); setView('settings'); }}
          onOpenTemplates={() => { setSyncOpen(false); setDriveOpen(true); }}
          onImported={(n, b) => { if (n) { showToast(`${n} element(er) lagt til i kartet`); if (b) fitTo(b, 19); } }}
        />
      )}

      {driveOpen && (
        <DriveDialog project={project} onClose={() => setDriveOpen(false)} onOpenSettings={() => { setDriveOpen(false); setView('settings'); }} />
      )}

      {viewerId && (
        <MediaViewer photos={photos} id={viewerId} onChange={setViewerId} onClose={() => setViewerId(null)}
          loadOriginal={(p) => fetchDriveBlob(googleConfig(project), p.driveId!, p.name)} />
      )}

      <TransferStatus />
      {globalDrag && !upload && <div className="global-drop">Slipp filene for å laste opp</div>}
      {project.storageError && <div className="banner">{project.storageError}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
