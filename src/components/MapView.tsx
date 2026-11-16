import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DxfItem, Item, OrthoItem, PhotoItem, Selection, Tool } from '../types';
import type { DxfState } from '../state';
import { basemapById } from '../lib/basemaps';
import { crsName, pointsToMeters, toLatLng } from '../lib/crs';
import { formatAreaShort, formatLengthShort, isDoubleClick, isTouchEvent, pathLength, ringArea, summarize } from '../lib/measure';
import type { ClickMemo, MeasureMode, MPt } from '../lib/measure';
import { markerHtml } from './icons';
import MeasurePanel from './MeasurePanel';
import MeasureChip from './MeasureChip';
import { buildPlanarIndex, snapPlanar, SNAP_LABEL } from '../lib/snap';
import type { PlanarIndex, SnapResult2d } from '../lib/snap';
import { clearStoredMeasure, loadMeasure, loadSnap, onMeasureChanged, saveMeasure, saveSnap } from '../lib/measureStore';

export interface FitRequest {
  seq: number;
  bounds: L.LatLngBoundsExpression;
  maxZoom?: number;
}

interface Props {
  items: Item[];
  dxf: Record<string, DxfState>;
  basemapId: string;
  customBasemap?: { name: string; url: string; maxNativeZoom?: number };
  projectCrs: string;
  selection: Selection;
  tool: Tool;
  fit: FitRequest | null;
  onSelect: (s: Selection) => void;
  onPlace: (lat: number, lng: number) => void;
  onTool: (t: Tool) => void;
  onMouseCoord: (ll: { lat: number; lng: number } | null) => void;
}

type DxfLayers = { key: string; groups: Map<string, L.LayerGroup>; added: Set<string> };

const ORANGE = '#ef6c1a';

interface MeasureState {
  pts: L.LatLng[];
  finished: boolean;
  /** Avstand eller areal. Beholdes også når måleverktøyet ikke er valgt (målingen er lagret og vises fortsatt). */
  mode: MeasureMode;
  /** Hva markøren snapper til nå */
  snap: SnapResult2d | null;
  /** Musepekerens posisjon (til strek under arbeid) */
  cursor: L.LatLng | null;
  /** Faste punkter, linjer og etiketter */
  group: L.LayerGroup;
  /** Strek fra siste punkt til musepekeren */
  live: L.LayerGroup;
}

/** Punktene i kartet → meter i et projisert koordinatsystem */
function toMeters(pts: L.LatLng[], projectCrs: string): { crs: string; mpts: MPt[] } {
  const r = pointsToMeters(projectCrs, pts);
  return { crs: r.crs, mpts: r.pts };
}

function labelIcon(text: string, cls = ''): L.DivIcon {
  return L.divIcon({ className: `measure-label ${cls}`.trim(), html: `<span>${text}</span>`, iconSize: [0, 0] });
}

/** Trenger vi det store bildet? Ja når ortofotoet vises bredere enn forhåndsbildet (2048 px). */
function needsHiRes(map: L.Map, b: L.LatLngBounds): boolean {
  const sw = map.latLngToContainerPoint(b.getSouthWest());
  const ne = map.latLngToContainerPoint(b.getNorthEast());
  return Math.abs(ne.x - sw.x) > 1900;
}

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const baseRef = useRef<L.TileLayer | null>(null);
  const photoGroup = useRef<L.LayerGroup | null>(null);
  const orthoLayers = useRef(new Map<string, { layer: L.ImageOverlay; url: string; lo?: string; blob: Blob; bounds: L.LatLngBounds }>());
  const dxfLayers = useRef(new Map<string, DxfLayers>());
  const dxfRenderer = useRef<L.Canvas | null>(null);
  const highlight = useRef<L.LayerGroup | null>(null);
  const measure = useRef<MeasureState | null>(null);
  const liveFrame = useRef(0);
  /** Siste klikk under måling – brukes til å kjenne igjen dobbeltklikk / dobbelttrykk */
  const lastClick = useRef<ClickMemo | null>(null);
  const [measureVer, setMeasureVer] = useState(0);
  const [snapOn, setSnapOn] = useState(() => loadSnap());
  const snapOnRef = useRef(snapOn);
  snapOnRef.current = snapOn;
  const snapIndex = useRef<PlanarIndex | null>(null);
  const [snapState, setSnapState] = useState<string | null>(null);

  // ---------- Opprett kart ----------
  useEffect(() => {
    const map = L.map(el.current!, { zoomControl: false, maxZoom: 22, minZoom: 3 }).setView([63.43, 10.4], 6);
    mapRef.current = map;
    map.createPane('orthoPane').style.zIndex = '250';
    map.createPane('dxfPane').style.zIndex = '420';
    map.createPane('measurePane').style.zIndex = '650';
    L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoom inn', zoomOutTitle: 'Zoom ut' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

    dxfRenderer.current = L.canvas({ pane: 'dxfPane', padding: 0.5, tolerance: 5 });
    photoGroup.current = L.layerGroup().addTo(map);
    highlight.current = L.layerGroup().addTo(map);
    measure.current = { pts: [], finished: false, mode: 'distance', snap: null, cursor: null, group: L.layerGroup().addTo(map), live: L.layerGroup().addTo(map) };
    // Gjenopprett målingen som ble lagret sist (etter omlasting eller bytte av fane), og følg med når Terreng 3D endrer den
    const reload = (): void => {
      const m = measure.current;
      if (!m) return;
      try {
        const saved = loadMeasure();
        m.pts = saved ? saved.pts.map((q) => Object.assign(L.latLng(q.lat, q.lng), q.z !== null ? { alt: q.z } : {}, q.fix ? { fix: true } : {})) : [];
        m.mode = saved?.mode ?? m.mode;
        m.finished = saved?.finished ?? false;
      } catch { m.pts = []; m.finished = false; /* ødelagt lagring: start uten måling */ }
    };
    reload();
    const offStore = onMeasureChanged('2d', () => {
      reload();
      const m = measure.current;
      if (!m) return;
      m.cursor = null; m.snap = null;
      drawMeasure();
      drawLive();
      setMeasureVer((v) => v + 1);
    });

    const updateTextVis = () => map.getContainer().classList.toggle('show-dxf-text', map.getZoom() >= 18);
    map.on('zoomend', updateTextVis);
    updateTextVis();
    // Etikettene på målingen avhenger av hvor lange strekene er på skjermen
    map.on('zoomend', () => { if (measure.current?.pts.length) drawMeasure(); });

    map.on('mousemove', (e: L.LeafletMouseEvent) => { propsRef.current.onMouseCoord(e.latlng); liveMove(e.latlng, e.originalEvent); });
    map.on('mouseout', () => {
      propsRef.current.onMouseCoord(null);
      if (measure.current) { measure.current.cursor = null; measure.current.snap = null; setSnapState(null); drawLive(); }
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const p = propsRef.current;
      if (p.tool === 'place') { p.onPlace(e.latlng.lat, e.latlng.lng); return; }
      if (p.tool === 'distance' || p.tool === 'area') { addMeasurePoint(e.latlng, e.originalEvent); return; }
      p.onSelect({ type: 'point', lat: e.latlng.lat, lng: e.latlng.lng });
    });
    // Dobbeltklikk avslutter målingen. Det avgjøres egentlig i addMeasurePoint (to raske klikk på samme sted), siden «dblclick»
    // kommer i ulik rekkefølge og av og til ikke i det hele tatt. Her tas de tilfellene der klikkene kom for sent til å regnes som ett.
    map.on('dblclick', () => {
      const t = propsRef.current.tool;
      if (t === 'distance' || t === 'area') finishMeasure(true);
    });
    // Høyreklikk angrer siste punkt. Et langt trykk med finger gir samme hendelse på mobil og skal ikke angre noe.
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      const t = propsRef.current.tool;
      if ((t === 'distance' || t === 'area') && !isTouchEvent(e?.originalEvent)) undoMeasurePoint();
    });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    return () => {
      offStore();
      ro.disconnect();
      cancelAnimationFrame(liveFrame.current);
      liveFrame.current = 0;
      map.remove();
      mapRef.current = null;
      baseRef.current = null;
      orthoLayers.current.forEach((o) => URL.revokeObjectURL(o.url));
      orthoLayers.current.clear();
      dxfLayers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Bakgrunnskart ----------
  useEffect(() => {
    const map = mapRef.current!;
    baseRef.current?.remove();
    baseRef.current = null;
    const b = basemapById(props.basemapId, props.customBasemap);
    if (b.url) {
      baseRef.current = L.tileLayer(b.url, {
        maxZoom: 22, maxNativeZoom: b.maxNativeZoom ?? 18, attribution: b.attribution,
      }).addTo(map);
    }
    map.getContainer().classList.toggle('dark-base', !!b.dark);
  }, [props.basemapId, props.customBasemap?.url, props.customBasemap?.maxNativeZoom]);

  // ---------- Droneortofoto ----------
  useEffect(() => {
    const map = mapRef.current!;
    const wanted = new Map<string, OrthoItem>();
    for (const it of props.items) if (it.kind === 'ortho' && !it.hidden) wanted.set(it.id, it);
    for (const [id, entry] of orthoLayers.current) {
      const it = wanted.get(id);
      if (!it || it.image !== entry.blob) {
        entry.layer.remove();
        URL.revokeObjectURL(entry.url);
        if (entry.lo) URL.revokeObjectURL(entry.lo);
        orthoLayers.current.delete(id);
      }
    }
    for (const [id, it] of wanted) {
      const existing = orthoLayers.current.get(id);
      if (existing) { existing.layer.setOpacity(it.opacity); continue; }
      const url = URL.createObjectURL(it.image);
      const lo = it.preview ? URL.createObjectURL(it.preview) : undefined;
      const bounds = L.latLngBounds(it.bounds);
      const layer = L.imageOverlay(lo && !needsHiRes(map, bounds) ? lo : url, bounds, { pane: 'orthoPane', opacity: it.opacity, interactive: false }).addTo(map);
      orthoLayers.current.set(id, { layer, url, lo, blob: it.image, bounds });
    }
  }, [props.items]);

  // Lite forhåndsbilde når kartet er zoomet ut, fullt bilde når man zoomer inn (gir raskere panorering)
  useEffect(() => {
    const map = mapRef.current!;
    const swap = () => {
      for (const e of orthoLayers.current.values()) {
        if (!e.lo) continue;
        const want = needsHiRes(map, e.bounds) ? e.url : e.lo;
        const img = e.layer.getElement();
        if (img && img.src !== want) e.layer.setUrl(want);
      }
    };
    map.on('zoomend', swap);
    return () => { map.off('zoomend', swap); };
  }, []);

  // ---------- Bilder og 360-bilder ----------
  useEffect(() => {
    const g = photoGroup.current!;
    g.clearLayers();
    const sel = props.selection?.type === 'item' ? props.selection.id : null;
    const photos = props.items.filter((i): i is PhotoItem => (i.kind === 'photo' || i.kind === 'pano') && !i.hidden && i.lat !== null);
    for (const p of photos) {
      const selected = p.id === sel;
      const m = L.marker([p.lat!, p.lng!], {
        icon: L.divIcon({
          className: 'mk-wrap',
          html: p.kind === 'pano' ? markerHtml.pano(selected) : markerHtml.photo(selected),
          iconSize: p.kind === 'pano' ? [28, 28] : [24, 24],
          iconAnchor: p.kind === 'pano' ? [14, 14] : [12, 12],
        }),
        zIndexOffset: selected ? 1000 : p.kind === 'pano' ? 100 : 0,
        bubblingMouseEvents: false,
      });
      m.bindTooltip(`<img src="${p.thumb}" alt=""><div>${escapeHtml(p.name)}</div>`, { direction: 'top', offset: [0, -14], className: 'thumb-tip', opacity: 1 });
      m.on('click', (e: L.LeafletMouseEvent) => {
        const pr = propsRef.current;
        if (pr.tool === 'distance' || pr.tool === 'area') { addMeasurePoint(L.latLng(p.lat!, p.lng!), e?.originalEvent); return; }
        pr.onSelect({ type: 'item', id: p.id });
      });
      g.addLayer(m);
    }
    // Pin for valgt punkt (som "Punkt på kartet")
    if (props.selection?.type === 'point') {
      L.marker([props.selection.lat, props.selection.lng], {
        icon: L.divIcon({ className: 'mk-wrap', html: '<div class="mk-pin"></div>', iconSize: [26, 34], iconAnchor: [13, 32] }),
        interactive: false,
      }).addTo(g);
    }
  }, [props.items, props.selection]);

  // ---------- DXF ----------
  useEffect(() => {
    const map = mapRef.current!;
    const renderer = dxfRenderer.current!;
    const dxfItems = props.items.filter((i): i is DxfItem => i.kind === 'dxf');
    const ids = new Set(dxfItems.map((d) => d.id));

    // Fjern slettede / endrede
    for (const [id, entry] of dxfLayers.current) {
      const st = props.dxf[id];
      if (!ids.has(id) || !st || st.key !== entry.key) {
        entry.groups.forEach((g) => g.remove());
        dxfLayers.current.delete(id);
      }
    }

    for (const it of dxfItems) {
      const st = props.dxf[it.id];
      if (!st?.data) continue;
      let entry = dxfLayers.current.get(it.id);
      if (!entry) {
        entry = { key: st.key, groups: new Map(), added: new Set() };
        st.data.features.forEach((f, index) => {
          let g = entry!.groups.get(f.layer);
          if (!g) { g = L.layerGroup(); entry!.groups.set(f.layer, g); }
          const onClick = (e: L.LeafletMouseEvent) => {
            const pr = propsRef.current;
            if (pr.tool === 'distance' || pr.tool === 'area') { addMeasurePoint(e.latlng, e.originalEvent); return; }
            if (pr.tool === 'place') { pr.onPlace(e.latlng.lat, e.latlng.lng); return; }
            pr.onSelect({ type: 'dxf-feature', itemId: it.id, index });
          };
          let layer: L.Layer;
          if (f.geom === 'line') {
            layer = L.polyline(f.latlngs, { renderer, color: f.color, weight: 1.6, opacity: 0.95, bubblingMouseEvents: false });
          } else if (f.geom === 'polygon') {
            layer = L.polygon(f.latlngs, { renderer, color: f.color, weight: f.fill ? 1 : 1.6, opacity: 0.95, fill: true, fillColor: f.fill ?? f.color, fillOpacity: f.fill ? (f.fillOpacity ?? 0.85) : 0.06, bubblingMouseEvents: false });
          } else if (f.geom === 'point') {
            layer = L.circleMarker(f.latlngs[0], { renderer, radius: 3, color: f.color, weight: 1.5, fillOpacity: 0.8, bubblingMouseEvents: false });
          } else {
            const rot = -(f.rotation ?? 0);
            layer = L.marker(f.latlngs[0], {
              pane: 'dxfPane',
              icon: L.divIcon({
                className: 'dxf-text',
                html: `<span style="color:${f.color};transform:rotate(${rot}deg)">${escapeHtml(f.text ?? '').replace(/\n/g, '<br>')}</span>`,
                iconSize: [0, 0],
              }),
              bubblingMouseEvents: false,
            });
          }
          layer.on('click', onClick as any);
          g.addLayer(layer);
        });
        dxfLayers.current.set(it.id, entry);
      }
      // Synlighet per lag
      const hidden = new Set(it.hiddenLayers);
      for (const [name, g] of entry.groups) {
        const show = !it.hidden && !hidden.has(name);
        if (show && !entry.added.has(name)) { g.addTo(map); entry.added.add(name); }
        if (!show && entry.added.has(name)) { g.remove(); entry.added.delete(name); }
      }
    }
  }, [props.items, props.dxf]);

  // ---------- Snapping: hjørner og kanter fra synlige tegninger og IFC-modeller ----------
  useEffect(() => {
    try {
      const feats: { pts: [number, number][]; closed: boolean }[] = [];
      for (const it of props.items) {
        if (it.kind !== 'dxf' || it.hidden) continue;
        const data = props.dxf[it.id]?.data;
        if (!data) continue;
        const hidden = new Set(it.hiddenLayers);
        for (const f of data.features) {
          if (hidden.has(f.layer) || f.geom === 'text') continue;
          const pts = f.latlngs as unknown as [number, number][] | L.LatLng[];
          const flat = (pts as any[]).map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.lat, q.lng]) as [number, number]);
          if (flat.length) feats.push({ pts: flat, closed: f.geom === 'polygon' });
        }
      }
      snapIndex.current = buildPlanarIndex(feats);
    } catch { snapIndex.current = null; }
  }, [props.items, props.dxf]);

  // ---------- Markering av valgt DXF-objekt ----------
  useEffect(() => {
    const h = highlight.current!;
    h.clearLayers();
    const s = props.selection;
    if (s?.type !== 'dxf-feature') return;
    const f = props.dxf[s.itemId]?.data?.features[s.index];
    if (!f) return;
    const style = { color: '#ffd400', weight: 6, opacity: 0.9, interactive: false, pane: 'measurePane' };
    if (f.geom === 'line') L.polyline(f.latlngs, style).addTo(h);
    else if (f.geom === 'polygon') L.polygon(f.latlngs, { ...style, fill: false }).addTo(h);
    else L.circleMarker(f.latlngs[0], { ...style, radius: 9, fill: false }).addTo(h);
  }, [props.selection, props.dxf]);

  // ---------- Verktøy ----------
  useEffect(() => {
    const map = mapRef.current!;
    const measuring = props.tool === 'distance' || props.tool === 'area';
    if (measuring) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    map.getContainer().classList.toggle('tool-crosshair', props.tool !== 'select');
    const m = measure.current!;
    // Målingen er lagret og blir stående (også når verktøyet ikke er valgt) til brukeren trykker Nullstill.
    if (measuring) m.mode = props.tool === 'area' ? 'area' : 'distance';
    if (m.finished && m.pts.length < (m.mode === 'area' ? 3 : 2)) m.finished = false;
    m.cursor = null;
    m.snap = null;
    setSnapState(null);
    drawMeasure();
    drawLive();
    persistMeasure();
    setMeasureVer((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool]);

  // ---------- Tastatur under måling ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = propsRef.current.tool;
      if (t !== 'distance' && t !== 'area') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName))) return;
      if (e.key === 'Enter') { e.preventDefault(); finishMeasure(false); }
      else if (e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); undoMeasurePoint(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Zoom-forespørsler ----------
  useEffect(() => {
    if (!props.fit) return;
    try {
      mapRef.current!.fitBounds(props.fit.bounds, { padding: [50, 50], maxZoom: props.fit.maxZoom ?? 19 });
    } catch { /* ugyldig utstrekning */ }
  }, [props.fit?.seq]);

  // ---------- Måling ----------
  function clearMeasure() {
    const m = measure.current;
    if (!m) return;
    m.pts = [];
    m.finished = false;
    m.cursor = null;
    m.snap = null;
    setSnapState(null);
    lastClick.current = null;
    m.group.clearLayers();
    m.live.clearLayers();
    clearStoredMeasure('2d');
    setMeasureVer((v) => v + 1);
  }

  /** Lagrer målingen i nettleseren etter hver endring. Uten punkter fjernes den lagrede målingen. */
  function persistMeasure() {
    const m = measure.current;
    if (!m) return;
    try {
      saveMeasure({
        mode: m.mode,
        finished: m.finished,
        pts: m.pts.map((ll) => {
          const a = ll as L.LatLng & { alt?: number; fix?: boolean };
          return { lat: ll.lat, lng: ll.lng, z: typeof a.alt === 'number' ? a.alt : null, fix: a.fix === true };
        }),
      }, '2d');
    } catch { /* lagring er ikke kritisk */ }
  }

  /** Nærmeste hjørne eller kant på IFC og tegninger, hvis snapping er på og Alt ikke holdes inne */
  function snapTo(ll: L.LatLng, ev?: unknown): SnapResult2d | null {
    const map = mapRef.current;
    const idx = snapIndex.current;
    if (!map || !idx || !snapOnRef.current || (ev as { altKey?: boolean } | null | undefined)?.altKey) return null;
    try {
      const p0 = map.latLngToContainerPoint(ll);
      const dLat = 1e-4;
      const pLat = map.latLngToContainerPoint(L.latLng(ll.lat + dLat, ll.lng));
      const pLng = map.latLngToContainerPoint(L.latLng(ll.lat, ll.lng + dLat));
      const pxPerLat = Math.abs(pLat.y - p0.y) / dLat, pxPerLng = Math.abs(pLng.x - p0.x) / dLat;
      if (!(pxPerLat > 0) || !(pxPerLng > 0)) return null;
      return snapPlanar(idx, { lat: ll.lat, lng: ll.lng }, { pxPerLat, pxPerLng });
    } catch { return null; }
  }

  function addMeasurePoint(ll: L.LatLng, ev?: unknown) {
    const m = measure.current;
    const map = mapRef.current;
    if (!m || !map) return;
    // To raske klikk på samme sted er et dobbeltklikk (dobbelttrykk): det andre gir ikke noe nytt punkt, men avslutter målingen.
    // Det avgjøres her og ikke av «dblclick», som kommer i ulik rekkefølge og på mobil ofte ikke i det hele tatt. Uten dette kunne
    // det siste klikket etter en avsluttet måling starte en ny måling på det samme punktet.
    const pt = map.latLngToContainerPoint(ll);
    const snapped = snapTo(ll, ev);
    const here: ClickMemo = { t: performance.now(), x: pt.x, y: pt.y, touch: isTouchEvent(ev) };
    const second = isDoubleClick(lastClick.current, here);
    lastClick.current = here;
    if (second) { finishMeasure(false); return; }
    // Etter en avsluttet måling starter neste klikk en helt ny måling
    if (m.finished) { m.pts = []; m.finished = false; }
    m.pts.push(snapped ? L.latLng(snapped.lat, snapped.lng) : ll);
    m.cursor = null; // strek til pekeren vises igjen ved neste musebevegelse
    m.snap = null;
    setSnapState(null);
    drawMeasure();
    drawLive();
    persistMeasure();
    setMeasureVer((v) => v + 1);
  }

  function undoMeasurePoint() {
    const m = measure.current;
    if (!m || !m.pts.length) return;
    m.pts.pop();
    m.finished = false;
    lastClick.current = null;
    drawMeasure();
    drawLive();
    persistMeasure();
    setMeasureVer((v) => v + 1);
  }

  /** Avslutter målingen. `dedupe`: dobbeltklikk gir et ekstra punkt på samme sted som må fjernes. */
  function finishMeasure(dedupe: boolean) {
    const m = measure.current;
    const map = mapRef.current;
    if (!m || !map || m.finished || !m.pts.length) return;
    if (dedupe && m.pts.length >= 2) {
      const a = map.latLngToContainerPoint(m.pts[m.pts.length - 1]);
      const b = map.latLngToContainerPoint(m.pts[m.pts.length - 2]);
      if (a.distanceTo(b) < 5) m.pts.pop();
    }
    const need = m.mode === 'area' ? 3 : 2;
    if (m.pts.length >= need) { m.finished = true; m.live.clearLayers(); }
    drawMeasure();
    persistMeasure();
    setMeasureVer((v) => v + 1);
  }

  /** Tegner punkter, linjer og etiketter for det som er målt så langt */
  function drawMeasure() {
    const map = mapRef.current;
    const m = measure.current;
    if (!map || !m) return;
    m.group.clearLayers();
    const n = m.pts.length;
    if (!n) return;
    const p = propsRef.current;
    const mode: MeasureMode = m.mode;
    const { crs, mpts } = toMeters(m.pts, p.projectCrs);
    const s = summarize(mode, mpts);
    const base = { pane: 'measurePane', interactive: false } as const;
    // Hvit kontur under den oransje streken gjør målingen synlig på alle bakgrunner
    if (mode === 'area' && n >= 3) {
      L.polygon(m.pts, { ...base, color: '#fff', weight: 7, opacity: 0.9, fill: false }).addTo(m.group);
      L.polygon(m.pts, { ...base, color: ORANGE, weight: 3.5, fillColor: ORANGE, fillOpacity: 0.18 }).addTo(m.group);
    } else if (n >= 2) {
      L.polyline(m.pts, { ...base, color: '#fff', weight: 7, opacity: 0.9 }).addTo(m.group);
      L.polyline(m.pts, { ...base, color: ORANGE, weight: 3.5 }).addTo(m.group);
    }
    for (const pt of m.pts) {
      L.circleMarker(pt, { ...base, radius: 5, color: '#fff', weight: 2, fillColor: ORANGE, fillOpacity: 1 }).addTo(m.group);
    }
    // Lengde på hver delstrekning (hoppes over når strekningen er for kort til å få plass)
    s.segments.forEach((len, i) => {
      const a = m.pts[i], b = m.pts[(i + 1) % n];
      if (map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b)) < 56) return;
      L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { ...base, keyboard: false, icon: labelIcon(formatLengthShort(len)) }).addTo(m.group);
    });
    if (mode === 'distance' && s.segments.length >= 2) {
      L.marker(m.pts[n - 1], { ...base, keyboard: false, icon: labelIcon(`Σ ${formatLengthShort(s.horizontal)}`, 'total') }).addTo(m.group);
    }
    if (s.area !== null && s.centroid) {
      const [lat, lng] = toLatLng(crs, s.centroid.x, s.centroid.y);
      L.marker([lat, lng], { ...base, keyboard: false, icon: labelIcon(formatAreaShort(s.area), 'total area') }).addTo(m.group);
    }
  }

  /** Stiplet strek fra siste punkt til musepekeren, med lengden på strekningen under arbeid */
  function drawLive() {
    const m = measure.current;
    if (!m) return;
    m.live.clearLayers();
    const p = propsRef.current;
    if (p.tool !== 'distance' && p.tool !== 'area') return;
    if (m.snap) {
      const k = m.snap.kind;
      L.marker([m.snap.lat, m.snap.lng], { pane: 'measurePane', interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: 'snap-icon', html: `<div class="snap-mark ${k} on"><b>${SNAP_LABEL[k]}</b></div>`, iconSize: [0, 0] }) }).addTo(m.live);
    }
    if (m.finished || !m.cursor || !m.pts.length) return;
    const last = m.pts[m.pts.length - 1];
    const dash = { pane: 'measurePane', interactive: false, color: ORANGE, weight: 2.5, dashArray: '6 6' } as const;
    L.polyline([last, m.cursor], dash).addTo(m.live);
    if (p.tool === 'area' && m.pts.length >= 2) L.polyline([m.cursor, m.pts[0]], { ...dash, opacity: 0.45 }).addTo(m.live);
    const { mpts } = toMeters([...m.pts, m.cursor], p.projectCrs);
    const k = mpts.length;
    let text = formatLengthShort(Math.hypot(mpts[k - 1].x - mpts[k - 2].x, mpts[k - 1].y - mpts[k - 2].y));
    if (p.tool === 'distance' && k >= 3) text += ` · Σ ${formatLengthShort(pathLength(mpts))}`;
    if (p.tool === 'area' && k >= 3) text += ` · ${formatAreaShort(ringArea(mpts))}`;
    L.marker(m.cursor, { pane: 'measurePane', interactive: false, keyboard: false, icon: labelIcon(text, 'live') }).addTo(m.live);
  }

  function liveMove(ll: L.LatLng, ev?: unknown) {
    const m = measure.current;
    const t = propsRef.current.tool;
    if (!m || (t !== 'distance' && t !== 'area')) return;
    const sn = snapTo(ll, ev);
    m.snap = sn;
    m.cursor = sn ? L.latLng(sn.lat, sn.lng) : ll;
    const label = sn ? SNAP_LABEL[sn.kind] : null;
    setSnapState((cur) => (cur === label ? cur : label));
    if ((!m.pts.length || m.finished) && !sn) { m.live.clearLayers(); return; }
    if (liveFrame.current) return;
    liveFrame.current = requestAnimationFrame(() => { liveFrame.current = 0; drawLive(); });
  }

  const measuring = props.tool === 'distance' || props.tool === 'area';
  const measureMode: MeasureMode = props.tool === 'area' ? 'area' : 'distance';
  const measureView = useMemo(() => {
    const m = measure.current;
    if (!measuring || !m) return null;
    const { crs, mpts } = toMeters(m.pts, props.projectCrs);
    return { summary: summarize(measureMode, mpts), crs, finished: m.finished };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, measureMode, measureVer, props.projectCrs]);
  // Lagret måling når verktøyet ikke er i bruk
  const storedView = useMemo(() => {
    const m = measure.current;
    if (measuring || !m || !m.pts.length) return null;
    const { mpts } = toMeters(m.pts, props.projectCrs);
    return { mode: m.mode, summary: summarize(m.mode, mpts), finished: m.finished };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, measureVer, props.projectCrs]);
  const toggleSnap = (on: boolean) => {
    saveSnap(on);
    setSnapOn(on);
    const m = measure.current;
    if (m) { m.snap = null; drawLive(); }
    setSnapState(null);
  };

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {measureView && (
        <MeasurePanel
          mode={measureMode}
          summary={measureView.summary}
          crsLabel={crsName(measureView.crs)}
          finished={measureView.finished}
          snap={snapOn}
          onSnap={toggleSnap}
          snapState={snapState}
          onMode={(mm) => props.onTool(mm)}
          onUndo={undoMeasurePoint}
          onFinish={() => finishMeasure(false)}
          onClear={clearMeasure}
          onClose={() => props.onTool('select')}
        />
      )}
      {storedView && (
        <MeasureChip
          mode={storedView.mode}
          summary={storedView.summary}
          finished={storedView.finished}
          onOpen={() => props.onTool(storedView.mode)}
          onClear={clearMeasure}
        />
      )}
      {props.tool === 'place' && (
        <div className="measure-box"><strong>Klikk i kartet der bildet ble tatt</strong><span>Esc for å avbryte</span></div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
