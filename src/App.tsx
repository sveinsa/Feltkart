import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, PhotoItem, Selection, Tool } from './types';
import { useProject } from './state';
import MapView, { type FitRequest } from './components/MapView';
import LayerTree from './components/LayerTree';
import BasemapPicker from './components/BasemapPicker';
import InfoPanel from './components/InfoPanel';
import UploadDialog from './components/UploadDialog';
import MediaViewer from './components/MediaViewer';
import Gallery from './components/Gallery';
import SettingsView from './components/SettingsView';
import DriveDialog, { googleConfig } from './components/DriveDialog';
import SyncDialog from './components/SyncDialog';
import { VERSION_LABEL } from './version';
import { fetchDriveBlob } from './lib/google';
import { basemapById } from './lib/basemaps';
import { crsName, formatProjected } from './lib/crs';
import {
  IconArea, IconEdit, IconFolder, IconExtent, IconGrid, IconLayers, IconMap, IconPointer, IconRuler, IconSettings, IconUpload,
} from './components/icons';

type View = 'map' | 'gallery' | 'settings';
type Panel = 'tree' | 'basemap' | null;

export default function App() {
  const project = useProject();
  const { ready, items, settings, dxf } = project;

  const [view, setView] = useState<View>('map');
  const [panel, setPanel] = useState<Panel>('tree');
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ files: File[] } | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [bmOpen, setBmOpen] = useState(false);
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [globalDrag, setGlobalDrag] = useState(false);
  const fitSeq = useRef(0);
  const didInitialFit = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const photos = useMemo(
    () => items.filter((i): i is PhotoItem => i.kind === 'photo' || i.kind === 'pano').sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [items],
  );

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
    setView('map');
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

  const basemap = basemapById(settings.basemapId);
  const visibleOrthos = items.filter((i) => i.kind === 'ortho' && !i.hidden).length;
  const layerCount = (basemap.url ? 1 : 0) + visibleOrthos;
  const coordText = coord ? formatProjected(settings.projectCrs, coord.lat, coord.lng) : null;

  const toolBtn = (t: Tool, Icon: typeof IconPointer, title: string) => (
    <button className={`tb-btn${tool === t ? ' on' : ''}`} title={title} onClick={() => { setTool(t); setPlacingId(null); }}>
      <Icon size={18} />
    </button>
  );

  return (
    <div className="app">
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
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Kart</button>
          <button className={view === 'gallery' ? 'on' : ''} onClick={() => setView('gallery')}>Bilder</button>
          <button className={view === 'settings' ? 'on' : ''} onClick={() => setView('settings')}>Innstillinger</button>
        </nav>
        <div className="topbar-right">
          <button className="project-pill" onClick={() => setView('settings')} title="Prosjektinnstillinger">
            <IconEdit size={14} /> {settings.projectName}
          </button>
          <button className="btn" onClick={() => setSyncOpen(true)} title="Hent fra og last opp til Google Disk-mappen"><IconFolder size={16} /> Google Disk</button>
          <button className="btn primary" onClick={() => setUpload({ files: [] })}><IconUpload size={16} /> Last opp</button>
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <button className={view === 'map' && panel === 'tree' ? 'on' : ''} title="Innhold og lag"
            onClick={() => { setView('map'); setPanel(panel === 'tree' && view === 'map' ? null : 'tree'); }}><IconLayers size={20} /></button>
          <button className={view === 'map' && panel === 'basemap' ? 'on' : ''} title="Bakgrunnskart"
            onClick={() => { setView('map'); setPanel(panel === 'basemap' && view === 'map' ? null : 'basemap'); }}><IconMap size={20} /></button>
          <button className={view === 'gallery' ? 'on' : ''} title="Bilder" onClick={() => setView('gallery')}><IconGrid size={20} /></button>
          <button title="Last opp" onClick={() => setUpload({ files: [] })}><IconUpload size={20} /></button>
          <button title="Google Disk-mappe" onClick={() => setSyncOpen(true)}><IconFolder size={20} /></button>
          <div className="rail-spacer" />
          <button className={view === 'settings' ? 'on' : ''} title="Innstillinger" onClick={() => setView('settings')}><IconSettings size={20} /></button>
        </nav>

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

        <main className="main">
          <div className="map-host" style={{ visibility: view === 'map' ? 'visible' : 'hidden' }}>
            <MapView
              items={items}
              dxf={dxf}
              basemapId={settings.basemapId}
              projectCrs={settings.projectCrs}
              selection={selection}
              tool={tool}
              fit={fit}
              onSelect={setSelection}
              onPlace={onPlace}
              onMouseCoord={setCoord}
            />

            <div className="map-toolbar">
              <div className="tb-group">
                {toolBtn('select', IconPointer, 'Velg / objektinformasjon')}
                {toolBtn('distance', IconRuler, 'Mål avstand')}
                {toolBtn('area', IconArea, 'Mål areal')}
                <button className="tb-btn" title="Zoom til alt innhold" onClick={zoomToAll}><IconExtent size={18} /></button>
              </div>
              <div className="tb-group bm">
                <button className={`tb-btn wide${bmOpen ? ' on' : ''}`} onClick={() => setBmOpen(!bmOpen)} title="Velg bakgrunnskart">
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
            />

            <div className="coord-bar">
              {coordText ? (
                <>
                  <span>Ø {coordText.e}</span><span>N {coordText.n}</span>
                  <span className="muted">{crsName(settings.projectCrs)}</span>
                </>
              ) : <span className="muted">{crsName(settings.projectCrs)}</span>}
            </div>

            {items.length === 0 && (
              <div className="map-empty">
                <strong>Kom i gang</strong>
                <span>Last opp bilder, 360-bilder, ortofoto fra drone eller prosjekterte data og innmåling (DXF, KOF, SOSI, LandXML, IFC).</span>
                <button className="btn primary" onClick={() => setUpload({ files: [] })}><IconUpload size={16} /> Last opp filer</button>
              </div>
            )}
          </div>

          {view === 'gallery' && (
            <Gallery photos={photos} onOpen={setViewerId} onShowOnMap={(id) => { setSelection({ type: 'item', id }); zoomToItem(id); }} />
          )}
          {view === 'settings' && <SettingsView project={project} />}
        </main>
      </div>

      {upload && (
        <UploadDialog
          project={project}
          initialFiles={upload.files}
          onClose={() => setUpload(null)}
          onDone={(r) => {
            setView('map');
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

      {globalDrag && !upload && <div className="global-drop">Slipp filene for å laste opp</div>}
      {project.storageError && <div className="banner">{project.storageError}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
