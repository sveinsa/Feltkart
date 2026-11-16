// Fanen «Terreng 3D»: terreng (høydedata) med ortofoto draperet på terrenget, IFC-modeller i 3D og bilder som 3D-bobler.
// MapLibre GL tegner terreng og bakgrunn. three.js tegner IFC og bildebobler i samme 3D-scene (custom layer).
//
// Viktige detaljer (MapLibre 4.x):
// - Kartvinduet MÅ ha fast størrelse. MapLibres stilark setter «position: relative» på vinduet, så størrelsen settes både i CSS
//   (styles.css, .t3d-canvas) og som inline-stil nedenfor. Ellers kollapser kartet til 0 px og siden ser hvit ut.
// - Matrisen som gis til egne lag er ikke «senket» med terrenghøyden i kartsenteret (maplibre-gl-js #3797), og queryTerrainElevation
//   gir høyde relativt til kartsenteret. Derfor trekkes `transform.elevation` fra i render(), og legges til igjen når vi leser høyder.
// - Alle kall mot kartet og three.js er pakket i try/catch, slik at en feil gir en melding i stedet for en hvit side.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import type { DxfItem, Item, OrthoItem, PhotoItem, Settings } from '../types';
import type { Mesh3D, ParsedDxf } from '../lib/dxf';
import { BASEMAPS, basemapById, customToBasemap } from '../lib/basemaps';
import { toLatLng } from '../lib/crs';

interface Props {
  items: Item[];
  /** Bildene som skal vises (datofilteret er allerede brukt) */
  photos: PhotoItem[];
  dxf: Record<string, { data?: ParsedDxf; error?: string } | undefined>;
  settings: Settings;
  onOpenPhoto: (id: string) => void;
}

interface TerrainDef {
  label: string;
  attribution: string;
  /** «url» peker på en TileJSON som oppgir fliseadresser, flisstørrelse og maks zoom (slik MapLibres eget eksempel gjør) */
  spec: { url?: string; tiles?: string[]; tileSize?: number; maxzoom?: number };
}
const TERRAINS: Record<'mapterhorn' | 'aws', TerrainDef> = {
  mapterhorn: {
    label: 'Mapterhorn (Norge i 1 m)',
    attribution: 'Høydedata © <a href="https://mapterhorn.com/attribution" target="_blank" rel="noreferrer">Mapterhorn</a>',
    spec: { url: 'https://tiles.mapterhorn.com/tilejson.json' },
  },
  aws: {
    label: 'AWS Terrain Tiles (globalt, grovere)',
    attribution: 'Høydedata © Mapzen / AWS Open Data',
    spec: { tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15 },
  },
};
type TerrainKey = keyof typeof TERRAINS;

const LAYER_COLORS: Record<string, string> = {
  Vegger: '#d9d4c7', 'Dekker og plater': '#b9bcc0', Tak: '#b5524a', Bjelker: '#8a8f98', Søyler: '#8a8f98', Vinduer: '#8cc7e8', Glassfasader: '#8cc7e8',
  Dører: '#9b6b43', Trapper: '#a7a39a', Rekkverk: '#6e7378', Fundamenter: '#9d9a94', Peler: '#9d9a94', Rør: '#3d7ea6', Ledninger: '#3d7ea6',
  Kummer: '#4f6b8a', 'Terreng og geografi': '#8fa77a', Veg: '#555a60', Overbygning: '#555a60', Anleggsobjekter: '#c08a3e', Masseforflytning: '#b89a6b',
};
const colorFor = (layer: string) => LAYER_COLORS[layer] ?? '#c9ccd1';

const CUSTOM_ID = 'feltkart-three';
/** Lagene våre legges rett under three.js-laget slik at terreng og bakgrunn tegnes først */
const beforeCustom = (map: maplibregl.Map) => (map.getLayer(CUSTOM_ID) ? CUSTOM_ID : undefined);

interface Bubble {
  id: string; lng: number; lat: number; alt: number | null; kind: 'photo' | 'pano';
  group: THREE.Group; sphere: THREE.Mesh; stem: THREE.Line; x: number; y: number; z: number; ground: number;
}

/** Alt som tegnes i 3D-scenen, og tilstand som deles mellom React og tegnefunksjonen */
interface Ctx {
  map: maplibregl.Map;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  root: THREE.Group;
  bubbles: Bubble[];
  originMerc: maplibregl.MercatorCoordinate | null;
  origin: { lng: number; lat: number } | null;
  exag: number;
  zOffset: number; // meter (flater ut terrenget når terreng er av)
  baseElev: number; // terrenghøyde ved scenens origo (meter over havet)
  terrainOn: boolean;
  bubbleScale: number;
  proj: THREE.Matrix4;
  demSrc: TerrainKey | null;
  baseKey: string;
  /** Satt hvis three.js-tegningen feilet, så vi ikke gjentar samme feil i hver bildeflate */
  broken: boolean;
  demErrors: number;
  /** Leser terrenghøyder på nytt og oppdaterer bobler (kalles når kartet er rolig) */
  refresh: () => void;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o: any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
  while (g.children.length) g.remove(g.children[0]);
}

export default function Terrain3D({ items, photos, dxf, settings, onOpenPhoto }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  const fittedRef = useRef(false);
  const openRef = useRef(onOpenPhoto);
  openRef.current = onOpenPhoto;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [tech, setTech] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);

  const [terrainOn, setTerrainOn] = useState(true);
  const [exag, setExag] = useState(1);
  const [terrainSrc, setTerrainSrc] = useState<TerrainKey>('mapterhorn');
  const terrainSrcRef = useRef<TerrainKey>(terrainSrc);
  terrainSrcRef.current = terrainSrc;
  const startBase = settings.basemapId === 'osm' || settings.basemapId === 'kv-topo' || settings.basemapId === 'kv-gra' || settings.basemapId === 'custom' ? settings.basemapId : 'esri';
  const [baseId, setBaseId] = useState<string>(startBase);
  const [orthoOn, setOrthoOn] = useState<Record<string, boolean>>({});
  const [orthoOpacity, setOrthoOpacity] = useState<Record<string, number>>({});
  const [ifcOn, setIfcOn] = useState<Record<string, boolean>>({});
  const [showPhotos, setShowPhotos] = useState(true);
  const [bubbleScale, setBubbleScale] = useState(1);

  /** Feil som ikke skal ta ned hele fanen: vises nederst i kartet og i konsollen */
  const report = useCallback((where: string, e: unknown) => {
    const msg = `${where}: ${e instanceof Error ? e.message : String(e)}`;
    console.error('[Terreng 3D]', where, e);
    setProblems((p) => (p.includes(msg) ? p : [...p, msg].slice(-4)));
  }, []);
  const reportRef = useRef(report);
  reportRef.current = report;

  const orthos = useMemo(() => items.filter((i): i is OrthoItem => i.kind === 'ortho'), [items]);
  const ifcs = useMemo(() => items.filter((i): i is DxfItem => i.kind === 'dxf' && i.format === 'ifc'), [items]);
  const customBm = customToBasemap(settings.customBasemap);
  const baseOptions = useMemo(() => [...BASEMAPS.filter((b) => b.url), ...(customBm ? [customBm] : [])], [customBm?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const orthoVisible = (o: OrthoItem) => orthoOn[o.id] ?? !o.hidden;
  const ifcVisible = (d: DxfItem) => ifcOn[d.id] ?? !d.hidden;
  const meshOf = (d: DxfItem): Mesh3D | undefined => dxf[d.id]?.data?.mesh3d;

  // Områdets utstrekning (for første zoom)
  const dataBounds = useMemo(() => {
    try {
      let s = 90, w = 180, n = -90, e = -180, any = false;
      const add = (lat: number, lng: number) => { if (Number.isFinite(lat) && Number.isFinite(lng)) { any = true; s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng); } };
      for (const o of orthos) { add(o.bounds[0][0], o.bounds[0][1]); add(o.bounds[1][0], o.bounds[1][1]); }
      for (const p of photos) if (p.lat !== null) add(p.lat, p.lng!);
      for (const d of ifcs) {
        const m = meshOf(d);
        if (m) { const [lat, lng] = toLatLng(m.crs, m.origin[0], m.origin[1]); add(lat, lng); }
        else { const b = dxf[d.id]?.data?.bounds; if (b) { add(b[0][0], b[0][1]); add(b[1][0], b[1][1]); } }
      }
      return any ? ([[w, s], [e, n]] as [[number, number], [number, number]]) : null;
    } catch (e) {
      console.error('[Terreng 3D] kunne ikke finne datautstrekning', e);
      return null;
    }
  }, [orthos, photos, ifcs, dxf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Kart og three.js-scene ----------
  useEffect(() => {
    const el = mapEl.current;
    if (!el) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el,
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e6ece8' } }] },
        center: [10.7, 62.0], zoom: 5, pitch: 0, maxPitch: 85,
        attributionControl: { compact: true },
      });
    } catch (e: any) {
      console.error('[Terreng 3D] kunne ikke lage kart', e);
      setError(`Kunne ikke starte 3D-visningen. WebGL mangler eller er slått av i nettleseren. (${e?.message ?? e})`);
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const c: Ctx = {
      map, renderer: null, scene: new THREE.Scene(), camera: new THREE.Camera(), root: new THREE.Group(), bubbles: [],
      originMerc: null, origin: null, exag: 1, zOffset: 0, baseElev: 0, terrainOn: true, bubbleScale: 1,
      proj: new THREE.Matrix4(), demSrc: null, baseKey: '', broken: false, demErrors: 0, refresh: () => {},
    };
    c.scene.add(c.root);
    c.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-1, -1.5, 2.5);
    c.scene.add(sun);
    ctxRef.current = c;

    // Hvis kartet aldri blir ferdig lastet: si fra i stedet for å vise et tomt kart
    let loaded = false;
    const slow = window.setTimeout(() => {
      if (!loaded) setError('3D-visningen ble ikke ferdig lastet. Sjekk at nettleseren har WebGL (skriv chrome://gpu i adressefeltet) og last siden på nytt.');
    }, 20000);
    const canvas = map.getCanvas();
    const onLost = () => setNotice('Grafikkortet avbrøt 3D-visningen midlertidig. Hvis kartet er tomt: last siden på nytt.');
    canvas.addEventListener('webglcontextlost', onLost);

    const raycaster = new THREE.Raycaster();
    const pick = (px: number, py: number): Bubble | null => {
      const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
      if (!w || !h || !c.bubbles.length) return null;
      const ndcX = (px / w) * 2 - 1, ndcY = -(py / h) * 2 + 1;
      const inv = new THREE.Matrix4().copy(c.proj).invert();
      const a = new THREE.Vector3(ndcX, ndcY, -1).applyMatrix4(inv);
      const b = new THREE.Vector3(ndcX, ndcY, 1).applyMatrix4(inv);
      raycaster.ray.origin.copy(a);
      raycaster.ray.direction.copy(b.sub(a).normalize());
      const hits = raycaster.intersectObjects(c.bubbles.map((x) => x.sphere), false);
      if (!hits.length) return null;
      return c.bubbles.find((x) => x.sphere === hits[0].object) ?? null;
    };

    const layer: maplibregl.CustomLayerInterface = {
      id: CUSTOM_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd(_m, gl) {
        c.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGLRenderingContext, antialias: true });
        c.renderer.autoClear = false;
      },
      render(_gl, matrix: any) {
        if (!c.renderer || !c.originMerc || c.broken) return;
        try {
          const arr = Array.isArray(matrix) || ArrayBuffer.isView(matrix) ? matrix : matrix?.modelViewProjectionMatrix ?? matrix?.defaultProjectionData?.mainMatrix;
          if (!arr) return;
          const o = c.originMerc;
          const s = o.meterInMercatorCoordinateUnits();
          // Bobler har omtrent samme størrelse på skjermen uavhengig av zoom
          const zoom = map.getZoom();
          const r = 3 * c.bubbleScale * Math.min(120, Math.max(1, Math.pow(2, 16.5 - zoom)));
          for (const b of c.bubbles) b.group.scale.set(r, r, r / Math.max(0.2, c.exag));
          // MapLibre 4.x: matrisen er ikke senket med terrenghøyden i kartsenteret. Trekk den fra, så høyder over havet stemmer med terrenget.
          const tr: any = (map as any).transform;
          const centerElev = c.terrainOn && Number.isFinite(tr?.elevation) ? (tr.elevation as number) : 0;
          const l = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z + (c.zOffset - centerElev) * s).scale(new THREE.Vector3(s, -s, s * c.exag));
          const m = new THREE.Matrix4().fromArray(arr as any);
          c.proj.copy(m.multiply(l));
          c.camera.projectionMatrix.copy(c.proj);
          c.camera.projectionMatrixInverse.copy(c.proj).invert();
          c.renderer.resetState();
          c.renderer.render(c.scene, c.camera);
        } catch (e) {
          c.broken = true;
          reportRef.current('3D-tegning', e);
        }
      },
      onRemove() { c.renderer?.dispose(); c.renderer = null; },
    };

    map.on('load', () => {
      loaded = true;
      window.clearTimeout(slow);
      setError(null);
      try {
        map.addLayer(layer);
      } catch (e) {
        // Terreng, bakgrunn og ortofoto fungerer uten three.js; bare IFC og bobler mangler
        reportRef.current('three.js (IFC og bobler)', e);
      }
      setReady(true);
    });
    map.on('error', (e: any) => {
      const msg = String(e?.error?.message ?? e?.error ?? '');
      if (/WebGL/i.test(msg)) { setError('Kunne ikke starte 3D-visningen (WebGL).'); return; }
      if (e?.sourceId === 'dem') {
        if (e?.tile) { c.demErrors++; return; } // enkeltfliser kan mangle
        if (terrainSrcRef.current === 'mapterhorn') {
          // Hele høydekilden lot seg ikke lese: bytt til den globale kilden
          setNotice(`Fikk ikke tak i høydedata fra Mapterhorn${msg ? ` (${msg})` : ''}. Byttet til AWS Terrain Tiles (grovere).`);
          setTerrainSrc('aws');
        }
      }
    });

    map.on('click', (e) => {
      const hit = pick(e.point.x, e.point.y);
      if (hit) openRef.current(hit.id);
    });
    let lastMove = 0;
    map.on('mousemove', (e) => {
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      map.getCanvas().style.cursor = pick(e.point.x, e.point.y) ? 'pointer' : '';
    });

    // Terrenghøyder for bobler (og stolper ned til bakken) når høydedata er lastet
    const refresh = () => {
      try {
        let changed = false;
        // MapLibre 4.x: queryTerrainElevation gir høyde relativt til kartsenteret (og med overdrivelse). Legg til senterhøyden for å få høyde over havet.
        const tr: any = (map as any).transform;
        const centerElev = c.terrainOn && Number.isFinite(tr?.elevation) ? (tr.elevation as number) : 0;
        const elevRaw = (lng: number, lat: number): number | null => {
          if (!c.terrainOn) return null;
          const e = map.queryTerrainElevation([lng, lat]);
          return typeof e === 'number' && Number.isFinite(e) ? (e + centerElev) / Math.max(0.0001, c.exag) : null;
        };
        if (c.origin) {
          const e0 = elevRaw(c.origin.lng, c.origin.lat);
          if (e0 !== null && Math.abs(e0 - c.baseElev) > 0.5) { c.baseElev = e0; changed = true; }
        }
        for (const b of c.bubbles) {
          const g = elevRaw(b.lng, b.lat) ?? c.baseElev;
          // Bilder uten høyde, eller med høyde under terrenget, plasseres 30 m over bakken
          const alt = b.alt !== null && b.alt >= g - 5 ? b.alt : g + 30;
          if (Math.abs(g - b.ground) > 0.3 || Math.abs(alt - b.z) > 0.3) {
            b.ground = g; b.z = alt;
            b.group.position.set(b.x, b.y, alt);
            const pos = b.stem.geometry.getAttribute('position') as THREE.BufferAttribute;
            pos.setXYZ(0, b.x, b.y, alt); pos.setXYZ(1, b.x, b.y, g);
            pos.needsUpdate = true;
            changed = true;
          }
        }
        if (!c.terrainOn) { const z = -c.baseElev; if (z !== c.zOffset) { c.zOffset = z; changed = true; } }
        if (changed) map.triggerRepaint();

        // Teknisk info til feilsøking (vises nederst i panelet)
        const box = map.getContainer();
        setTech([
          `MapLibre ${(maplibregl as any).version ?? '?'} · three r${THREE.REVISION}`,
          `${map.getCanvas().getContext('webgl2') ? 'WebGL 2' : 'WebGL 1'} · kartvindu ${box.clientWidth}×${box.clientHeight} px`,
          `Zoom ${map.getZoom().toFixed(1)} · tilt ${Math.round(map.getPitch())}° · retning ${Math.round(map.getBearing())}°`,
          c.terrainOn ? `Terreng på (${TERRAINS[c.demSrc ?? 'mapterhorn'].label}), høyde i sentrum ${Math.round(centerElev)} m${c.demErrors ? `, ${c.demErrors} høydefliser feilet` : ''}` : 'Terreng av',
          `Bobler ${c.bubbles.length} · IFC-deler ${Math.max(0, c.root.children.length - c.bubbles.length * 2)} · three.js ${c.renderer ? 'klar' : 'ikke startet'}${c.broken ? ' (feilet)' : ''}`,
        ].join('\n'));
      } catch (e) {
        console.error('[Terreng 3D] refresh', e);
      }
    };
    c.refresh = refresh;
    map.on('idle', refresh);

    return () => {
      window.clearTimeout(slow);
      canvas.removeEventListener('webglcontextlost', onLost);
      map.off('idle', refresh);
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
      urlsRef.current.clear();
      disposeGroup(c.root);
      ctxRef.current = null;
      try { map.remove(); } catch { /* ignorer */ }
      setReady(false);
    };
  }, []);

  // ---------- Terreng ----------
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    try {
      const t = TERRAINS[terrainSrc];
      if (c.demSrc !== terrainSrc) {
        map.setTerrain(null);
        if (map.getSource('dem')) map.removeSource('dem');
        map.addSource('dem', { type: 'raster-dem', encoding: 'terrarium', attribution: t.attribution, ...t.spec } as any);
        c.demSrc = terrainSrc;
        c.demErrors = 0;
      }
      c.terrainOn = terrainOn;
      c.exag = terrainOn ? exag : 1;
      c.zOffset = terrainOn ? 0 : -c.baseElev;
      if (terrainOn) map.setTerrain({ source: 'dem', exaggeration: exag });
      else map.setTerrain(null);
      map.triggerRepaint();
    } catch (e) {
      report('Terreng', e);
    }
  }, [ready, terrainOn, exag, terrainSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Bakgrunnskart ----------
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    try {
      const b = baseId === 'custom' ? customBm : basemapById(baseId);
      const key = b ? `${b.id}|${b.url}` : '';
      if (c.baseKey === key) return;
      if (map.getLayer('base')) map.removeLayer('base');
      if (map.getSource('base')) map.removeSource('base');
      c.baseKey = key;
      if (!b || !b.url) return;
      map.addSource('base', { type: 'raster', tiles: [b.url], tileSize: 256, maxzoom: b.maxNativeZoom ?? 18, attribution: b.attribution });
      const firstOrtho = orthos.map((o) => `ortho-${o.id}`).find((id) => map.getLayer(id));
      map.addLayer({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 0 } }, firstOrtho ?? beforeCustom(map));
    } catch (e) {
      report('Bakgrunnskart', e);
    }
  }, [ready, baseId, customBm?.url, orthos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Ortofoto (draperes automatisk på terrenget) ----------
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    try {
      const wanted = new Map<string, OrthoItem>(orthos.filter(orthoVisible).map((o) => [o.id, o] as [string, OrthoItem]));
      // fjern det som ikke lenger skal vises
      for (const [id, url] of [...urlsRef.current]) {
        const o = wanted.get(id);
        if (!o) {
          if (map.getLayer(`ortho-${id}`)) map.removeLayer(`ortho-${id}`);
          if (map.getSource(`ortho-${id}`)) map.removeSource(`ortho-${id}`);
          URL.revokeObjectURL(url);
          urlsRef.current.delete(id);
        }
      }
      for (const [id, o] of wanted) {
        const op = orthoOpacity[id] ?? o.opacity;
        if (!urlsRef.current.has(id)) {
          const url = URL.createObjectURL(o.image);
          urlsRef.current.set(id, url);
          const [[south, west], [north, east]] = o.bounds;
          map.addSource(`ortho-${id}`, { type: 'image', url, coordinates: [[west, north], [east, north], [east, south], [west, south]] });
          map.addLayer({ id: `ortho-${id}`, type: 'raster', source: `ortho-${id}`, paint: { 'raster-opacity': op, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, beforeCustom(map));
        } else if (map.getLayer(`ortho-${id}`)) {
          map.setPaintProperty(`ortho-${id}`, 'raster-opacity', op);
        }
      }
    } catch (e) {
      report('Ortofoto', e);
    }
  }, [ready, orthos, orthoOn, orthoOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- IFC og bildebobler (three.js) ----------
  const ifcKey = ifcs.filter(ifcVisible).map((d) => `${d.id}:${meshOf(d) ? 1 : 0}`).join(',');
  const photoKey = showPhotos ? photos.filter((p) => p.lat !== null).map((p) => p.id).join(',') : '';
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    let disposed = false;
    try {
      disposeGroup(c.root);
      c.bubbles = [];

      const shownIfc = ifcs.filter(ifcVisible).map((d) => ({ d, m: meshOf(d) })).filter((x): x is { d: DxfItem; m: Mesh3D } => !!x.m);
      const shownPhotos = showPhotos ? photos.filter((p) => p.lat !== null) : [];

      // origo: gjennomsnitt av alt som skal tegnes
      const pts: [number, number][] = []; // [lng, lat]
      for (const { m } of shownIfc) { const [lat, lng] = toLatLng(m.crs, m.origin[0], m.origin[1]); pts.push([lng, lat]); }
      for (const p of shownPhotos) pts.push([p.lng!, p.lat!]);
      if (!pts.length) { c.originMerc = null; c.origin = null; map.triggerRepaint(); return; }
      const lng0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      c.origin = { lng: lng0, lat: lat0 };
      c.originMerc = maplibregl.MercatorCoordinate.fromLngLat([lng0, lat0], 0);
      const o = c.originMerc;
      const s = o.meterInMercatorCoordinateUnits();
      const sceneXY = (lng: number, lat: number): [number, number] => {
        const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        return [(mc.x - o.x) / s, -(mc.y - o.y) / s];
      };

      // IFC-deler
      for (const { m } of shownIfc) {
        const [e0, n0] = m.origin;
        const toXY = (e: number, n: number) => { const [la, ln] = toLatLng(m.crs, e, n); return sceneXY(ln, la); };
        const p0 = toXY(e0, n0), pe = toXY(e0 + 100, n0), pn = toXY(e0, n0 + 100);
        const ax = (pe[0] - p0[0]) / 100, ay = (pe[1] - p0[1]) / 100;
        const bx = (pn[0] - p0[0]) / 100, by = (pn[1] - p0[1]) / 100;
        for (const part of m.parts) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
          geo.computeVertexNormals();
          const glass = /Vinduer|Glass/.test(part.layer);
          const mat = new THREE.MeshLambertMaterial({ color: colorFor(part.layer), side: THREE.DoubleSide, transparent: glass, opacity: glass ? 0.55 : 1 });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.set(ax, bx, 0, p0[0], ay, by, 0, p0[1], 0, 0, 1, 0, 0, 0, 0, 1);
          mesh.frustumCulled = false;
          c.root.add(mesh);
        }
      }

      // Bildebobler
      const sphereGeo = new THREE.SphereGeometry(1, 36, 18);
      const ringGeo = new THREE.TorusGeometry(1.12, 0.045, 8, 48);
      for (const p of shownPhotos) {
        const [x, y] = sceneXY(p.lng!, p.lat!);
        const pano = p.kind === 'pano';
        const mat = new THREE.MeshBasicMaterial({ color: 0x9aa5a0, side: THREE.DoubleSide });
        const sphere = new THREE.Mesh(sphereGeo, mat);
        sphere.rotation.x = Math.PI / 2; // polene langs z (opp)
        sphere.frustumCulled = false;
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: pano ? 0x0f5a3c : 0x8dc63f, side: THREE.DoubleSide }));
        ring.frustumCulled = false;
        const group = new THREE.Group();
        group.add(sphere, ring);
        const alt = typeof p.altitude === 'number' && Number.isFinite(p.altitude) ? p.altitude : null;
        const z = alt ?? c.baseElev + 30;
        group.position.set(x, y, z);
        const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x, y, c.baseElev)]);
        const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
        stem.frustumCulled = false;
        c.root.add(group, stem);
        c.bubbles.push({ id: p.id, lng: p.lng!, lat: p.lat!, alt, kind: p.kind, group, sphere, stem, x, y, z, ground: c.baseElev });

        // Tekstur: 360-bilder i bedre oppløsning, vanlige bilder fra miniatyren
        (async () => {
          try {
            let tex: THREE.Texture;
            if (pano) {
              const bmp = await createImageBitmap(p.blob);
              const cv = document.createElement('canvas');
              cv.width = 1024; cv.height = 512;
              cv.getContext('2d')!.drawImage(bmp, 0, 0, 1024, 512);
              bmp.close?.();
              tex = new THREE.CanvasTexture(cv);
            } else {
              tex = await new Promise<THREE.Texture>((res, rej) => new THREE.TextureLoader().load(p.thumb, res, undefined, rej));
            }
            if (disposed) { tex.dispose(); return; }
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
            map.triggerRepaint();
          } catch { /* behold grå kule */ }
        })();
      }
      map.triggerRepaint();
      // oppdater høyder (terreng) så snart kartet er rolig
      window.setTimeout(() => { if (ctxRef.current === c) c.refresh(); }, 0);
    } catch (e) {
      report('IFC og bobler', e);
    }
    return () => { disposed = true; };
  }, [ready, ifcKey, photoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boblestørrelse
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.bubbleScale = bubbleScale;
    c.map.triggerRepaint();
  }, [bubbleScale, ready]);

  // ---------- Første zoom ----------
  const fitToData = useCallback(() => {
    const c = ctxRef.current;
    if (!c || !dataBounds) return;
    try {
      c.map.fitBounds(dataBounds, { padding: 80, pitch: 60, bearing: -20, maxZoom: 17, duration: 1200 });
    } catch (e) {
      report('Zoom til data', e);
    }
  }, [dataBounds, report]);
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c || !dataBounds || fittedRef.current) return;
    fittedRef.current = true;
    try {
      c.map.fitBounds(dataBounds, { padding: 80, pitch: 60, bearing: -20, maxZoom: 17, duration: 0 });
    } catch (e) {
      report('Zoom til data', e);
    }
  }, [ready, dataBounds]); // eslint-disable-line react-hooks/exhaustive-deps

  const ifcState = (d: DxfItem) => {
    const e = dxf[d.id];
    if (!e) return 'leser …';
    if (e.error) return 'kunne ikke leses';
    const m = e.data?.mesh3d;
    if (!e.data) return 'leser …';
    if (!m) return 'ingen 3D-geometri';
    return `${Math.round(m.triangles).toLocaleString('nb-NO')} trekanter`;
  };
  const photosWithPos = photos.filter((p) => p.lat !== null).length;

  return (
    <div className="t3d">
      <div className="t3d-map">
        {/* Fast størrelse som inline-stil: MapLibres stilark setter ellers «position: relative» og kartet kollapser til 0 px */}
        <div ref={mapEl} className="t3d-canvas" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <button className="t3d-toggle" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '‹ Skjul panel' : '› Lag og valg'}</button>
        {!ready && !error && <div className="t3d-loading">Laster 3D …</div>}
        {error && <div className="t3d-loading error">{error}</div>}
        {notice && <div className="t3d-notice" onClick={() => setNotice(null)} title="Klikk for å skjule">{notice}</div>}
        {problems.length > 0 && (
          <div className="t3d-problems" role="alert">
            <strong>Noe i 3D-visningen feilet:</strong>
            {problems.map((p, i) => <div key={i}>{p}</div>)}
            <button className="btn" onClick={() => setProblems([])}>Skjul</button>
          </div>
        )}
      </div>
      {panelOpen && (
        <aside className="t3d-panel">
          <h2>Terreng 3D <span className="beta-tag dark">beta</span></h2>
          <p className="muted small" style={{ margin: '0 0 8px' }}>Dra for å flytte, høyre museknapp (eller Ctrl + dra) for å tilte og rotere, rull for å zoome.</p>
          <button className="btn" onClick={fitToData} disabled={!dataBounds}>Zoom til data</button>

          <section>
            <h4>Terreng</h4>
            <label className="t3d-check"><input type="checkbox" className="chk" checked={terrainOn} onChange={(e) => setTerrainOn(e.target.checked)} /> Vis terreng i 3D (drapér ortofoto på terreng)</label>
            <label className="t3d-field">Overdrivelse av høyder: <b>{exag.toFixed(1)}×</b>
              <input type="range" min={1} max={5} step={0.1} value={exag} disabled={!terrainOn} onChange={(e) => setExag(+e.target.value)} />
            </label>
            <label className="t3d-field">Høydedata
              <select value={terrainSrc} onChange={(e) => setTerrainSrc(e.target.value as TerrainKey)}>
                {(Object.keys(TERRAINS) as TerrainKey[]).map((k) => <option key={k} value={k}>{TERRAINS[k].label}</option>)}
              </select>
            </label>
          </section>

          <section>
            <h4>Bakgrunn</h4>
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              {baseOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </section>

          <section>
            <h4>Ortofoto (drone)</h4>
            {orthos.length === 0 && <p className="muted small">Ingen ortofoto er lastet opp.</p>}
            {orthos.map((o) => (
              <div key={o.id} className="t3d-item">
                <label className="t3d-check" title={o.name}>
                  <input type="checkbox" className="chk" checked={orthoVisible(o)} onChange={(e) => setOrthoOn((s) => ({ ...s, [o.id]: e.target.checked }))} />
                  <span className="t3d-name">{o.name}</span>
                </label>
                <input type="range" min={0} max={1} step={0.05} value={orthoOpacity[o.id] ?? o.opacity} aria-label="Gjennomsiktighet"
                  onChange={(e) => setOrthoOpacity((s) => ({ ...s, [o.id]: +e.target.value }))} />
              </div>
            ))}
          </section>

          <section>
            <h4>IFC-modeller</h4>
            {ifcs.length === 0 && <p className="muted small">Ingen IFC-modeller er lastet opp. Last opp en .ifc-fil (med georeferanse) for å se den i 3D.</p>}
            {ifcs.map((d) => (
              <label key={d.id} className="t3d-check" title={d.name}>
                <input type="checkbox" className="chk" checked={ifcVisible(d)} onChange={(e) => setIfcOn((s) => ({ ...s, [d.id]: e.target.checked }))} />
                <span className="t3d-name">{d.name}</span>
                <span className="muted small">{ifcState(d)}</span>
              </label>
            ))}
          </section>

          <section>
            <h4>Dronefoto og 360-bilder</h4>
            <label className="t3d-check"><input type="checkbox" className="chk" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} /> Vis som 3D-bobler <span className="muted small">({photosWithPos})</span></label>
            <label className="t3d-field">Størrelse på bobler: <b>{bubbleScale.toFixed(1)}×</b>
              <input type="range" min={0.5} max={4} step={0.1} value={bubbleScale} onChange={(e) => setBubbleScale(+e.target.value)} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>Klikk en boble for å åpne bildet. Grønn ring = vanlig bilde, mørk ring = 360-bilde. Stolpen går ned til bakken.</p>
          </section>

          <details className="t3d-tech">
            <summary>Teknisk info (til feilsøking)</summary>
            <pre>{tech || 'Venter på at kartet blir ferdig …'}</pre>
          </details>
        </aside>
      )}
    </div>
  );
}
