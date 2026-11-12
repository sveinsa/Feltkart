import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DxfItem, Item, OrthoItem, PhotoItem, Selection, Tool } from '../types';
import type { DxfState } from '../state';
import { basemapById } from '../lib/basemaps';
import { fromLatLng, fmt } from '../lib/crs';
import { markerHtml } from './icons';

export interface FitRequest {
  seq: number;
  bounds: L.LatLngBoundsExpression;
  maxZoom?: number;
}

interface Props {
  items: Item[];
  dxf: Record<string, DxfState>;
  basemapId: string;
  projectCrs: string;
  selection: Selection;
  tool: Tool;
  fit: FitRequest | null;
  onSelect: (s: Selection) => void;
  onPlace: (lat: number, lng: number) => void;
  onMouseCoord: (ll: { lat: number; lng: number } | null) => void;
}

type DxfLayers = { key: string; groups: Map<string, L.LayerGroup>; added: Set<string> };

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const baseRef = useRef<L.TileLayer | null>(null);
  const photoGroup = useRef<L.LayerGroup | null>(null);
  const orthoLayers = useRef(new Map<string, { layer: L.ImageOverlay; url: string; blob: Blob }>());
  const dxfLayers = useRef(new Map<string, DxfLayers>());
  const dxfRenderer = useRef<L.Canvas | null>(null);
  const highlight = useRef<L.LayerGroup | null>(null);
  const measure = useRef<{ pts: L.LatLng[]; group: L.LayerGroup; finished: boolean } | null>(null);
  const [measureText, setMeasureText] = useState<string | null>(null);

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
    measure.current = { pts: [], group: L.layerGroup().addTo(map), finished: false };

    const updateTextVis = () => map.getContainer().classList.toggle('show-dxf-text', map.getZoom() >= 18);
    map.on('zoomend', updateTextVis);
    updateTextVis();

    map.on('mousemove', (e: L.LeafletMouseEvent) => propsRef.current.onMouseCoord(e.latlng));
    map.on('mouseout', () => propsRef.current.onMouseCoord(null));
    map.on('click', (e: L.LeafletMouseEvent) => {
      const p = propsRef.current;
      if (p.tool === 'place') { p.onPlace(e.latlng.lat, e.latlng.lng); return; }
      if (p.tool === 'distance' || p.tool === 'area') { addMeasurePoint(e.latlng); return; }
      p.onSelect({ type: 'point', lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.on('dblclick', () => {
      const p = propsRef.current;
      const m = measure.current!;
      if ((p.tool === 'distance' || p.tool === 'area') && m.pts.length) {
        // Dobbeltklikk gir to klikk først – fjern det dupliserte punktet og lås målingen
        m.pts.pop();
        const last = m.pts.pop();
        if (last) addMeasurePoint(last);
        m.finished = true;
      }
    });
    map.on('contextmenu', () => {
      const p = propsRef.current;
      if (p.tool === 'distance' || p.tool === 'area') clearMeasure();
    });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
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
    const b = basemapById(props.basemapId);
    if (b.url) {
      baseRef.current = L.tileLayer(b.url, {
        maxZoom: 22, maxNativeZoom: b.maxNativeZoom ?? 18, attribution: b.attribution,
      }).addTo(map);
    }
    map.getContainer().classList.toggle('dark-base', !!b.dark);
  }, [props.basemapId]);

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
        orthoLayers.current.delete(id);
      }
    }
    for (const [id, it] of wanted) {
      const existing = orthoLayers.current.get(id);
      if (existing) { existing.layer.setOpacity(it.opacity); continue; }
      const url = URL.createObjectURL(it.image);
      const layer = L.imageOverlay(url, it.bounds, { pane: 'orthoPane', opacity: it.opacity, interactive: false }).addTo(map);
      orthoLayers.current.set(id, { layer, url, blob: it.image });
    }
  }, [props.items]);

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
      m.on('click', () => {
        const pr = propsRef.current;
        if (pr.tool === 'distance' || pr.tool === 'area') { addMeasurePoint(L.latLng(p.lat!, p.lng!)); return; }
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
            if (pr.tool === 'distance' || pr.tool === 'area') { addMeasurePoint(e.latlng); return; }
            if (pr.tool === 'place') { pr.onPlace(e.latlng.lat, e.latlng.lng); return; }
            pr.onSelect({ type: 'dxf-feature', itemId: it.id, index });
          };
          let layer: L.Layer;
          if (f.geom === 'line') {
            layer = L.polyline(f.latlngs, { renderer, color: f.color, weight: 1.6, opacity: 0.95, bubblingMouseEvents: false });
          } else if (f.geom === 'polygon') {
            layer = L.polygon(f.latlngs, { renderer, color: f.color, weight: 1.6, opacity: 0.95, fill: true, fillOpacity: 0.06, bubblingMouseEvents: false });
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
    if (!measuring) clearMeasure();
    else { clearMeasure(); setMeasureText(props.tool === 'distance' ? 'Klikk i kartet for å måle avstand' : 'Klikk i kartet for å måle areal'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool]);

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
    m.group.clearLayers();
    setMeasureText(null);
  }

  function addMeasurePoint(ll: L.LatLng) {
    const m = measure.current!;
    const { tool, projectCrs } = propsRef.current;
    if (m.finished) { m.pts = []; m.finished = false; }
    m.pts.push(ll);
    m.group.clearLayers();
    const style = { color: '#ef6c1a', weight: 3, pane: 'measurePane', interactive: false, dashArray: '6 5' };
    const xy = m.pts.map((p) => fromLatLng(projectCrs === 'EPSG:4326' ? 'EPSG:25833' : projectCrs, p.lat, p.lng));
    let label = '';
    if (tool === 'area' && m.pts.length >= 3) {
      L.polygon(m.pts, { ...style, fillColor: '#ef6c1a', fillOpacity: 0.15 }).addTo(m.group);
      let a = 0, per = 0;
      for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
        a += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
        per += Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
      }
      label = `Areal: ${fmt.m2(Math.abs(a / 2))} · Omkrets: ${fmt.m(per)}`;
    } else {
      L.polyline(m.pts, style).addTo(m.group);
      let d = 0;
      for (let i = 1; i < xy.length; i++) d += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      label = tool === 'area' ? 'Legg til minst tre punkter' : `Avstand: ${fmt.m(d)}`;
    }
    for (const p of m.pts) L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: '#ef6c1a', fillOpacity: 1, pane: 'measurePane', interactive: false }).addTo(m.group);
    setMeasureText(label);
  }

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {measureText && (
        <div className="measure-box">
          <strong>{measureText}</strong>
          <span>Dobbeltklikk for å avslutte · høyreklikk for å starte på nytt</span>
        </div>
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
