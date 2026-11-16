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
import { crsName, pointsToMeters, toLatLng } from '../lib/crs';
import { formatAreaShort, formatLengthShort, pathLength, ringArea, summarize } from '../lib/measure';
import type { MeasureMode } from '../lib/measure';
import MeasurePanel from './MeasurePanel';
import { IconArea, IconRuler } from './icons';

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
const MEASURE_SRC = 'feltkart-measure';
/** Det nederste målelaget. Bakgrunn og ortofoto legges under det, så målingen alltid ligger oppå. */
const MEASURE_FIRST = 'feltkart-m-fill';
const MEASURE_ORANGE = '#ef6c1a';
/** Lagene våre legges rett under målingen (og three.js-laget) slik at terreng og bakgrunn tegnes først */
const beforeCustom = (map: maplibregl.Map) => (map.getLayer(MEASURE_FIRST) ? MEASURE_FIRST : map.getLayer(CUSTOM_ID) ? CUSTOM_ID : undefined);

/** Et punkt i en måling. Høyden (m o.h.) leses av terrengmodellen, og er null når terreng er av eller ikke lastet. */
interface MPoint { lng: number; lat: number; z: number | null }

/** Målemotoren bor inne i kart-effekten (den trenger kartet), og brukes av knappene i panelet */
interface MeasureApi {
  add: (lng: number, lat: number) => void;
  undo: () => void;
  finish: (dedupe?: boolean) => void;
  clear: () => void;
  /** Bytte mellom avstand og areal: punktene beholdes */
  modeChanged: () => void;
  state: () => { pts: MPoint[]; finished: boolean };
  /** Strek og etikett fra siste punkt til musepekeren */
  live: (x: number, y: number, lng: number, lat: number) => void;
  hideLive: () => void;
  redraw: () => void;
  /** Leser manglende høyder (og fjerner dem når terreng er av) */
  fillHeights: () => void;
  dispose: () => void;
}

/**
 * Et bilde i 3D. Vanlige bilder er et bilderamme (rektangel med «FOTO»-merke), 360-bilder er en kule (med «360°»-merke).
 * Fargene følger 2D-kartet: vanlig foto = lysegrønn, 360 = mørkegrønn. Da er det aldri tvil om hva som er hva.
 */
interface Bubble {
  id: string; lng: number; lat: number; alt: number | null; kind: 'photo' | 'pano';
  /** Kule med ring (360) eller bilderamme (foto). Rammen vender alltid mot kameraet. */
  body: THREE.Group;
  /** Merkelapp («360°» eller «FOTO») som alltid vender mot kameraet */
  tag: THREE.Mesh;
  /** Delen som kan klikkes */
  hit: THREE.Mesh;
  stem: THREE.Line;
  x: number; y: number; z: number; ground: number;
  /** Merkelappens avstand over sentrum, i enheter av boblens radius */
  tagUp: number;
  /** Delene av bilderammen (bare vanlige bilder), slik at størrelsen kan justeres når bildet er lastet */
  card?: { white: THREE.Mesh; lime: THREE.Mesh; photo: THREE.Mesh };
}

const PHOTO_GREEN = '#5fa83a';
const PANO_GREEN = '#0f5a3c';
const CARD_H = 1.8; // høyde på bilderammen (kulens radius = 1)
const TAG_W = 1.9; // merkelappens størrelse (samme forhold som teksturen, 256 × 96)
const TAG_H = 0.71;

/** Avrundet merkelapp med hvit kant og tekst («360°» / «FOTO») som tekstur */
function labelTexture(text: string, fill: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d')!;
  const x = 6, y = 6, w = 244, h = 84, r = 42;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '700 54px Inter, system-ui, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  measure: MeasureApi | null;
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
  const [showPhotos, setShowPhotos] = useState(true); // vanlige bilder (rammer)
  const [showPanos, setShowPanos] = useState(true); // 360-bilder (kuler)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [bubbleScale, setBubbleScale] = useState(1);

  // Måling (avstand / areal). Selve punktene bor i målemotoren (Ctx.measure); measVer teller endringer så panelet tegnes på nytt.
  const [measureMode, setMeasureMode] = useState<MeasureMode | null>(null);
  const measureRef = useRef<MeasureMode | null>(null);
  measureRef.current = measureMode;
  const crsRef = useRef(settings.projectCrs);
  crsRef.current = settings.projectCrs;
  const [measVer, setMeasVer] = useState(0);
  const liveEl = useRef<HTMLDivElement>(null);

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
      proj: new THREE.Matrix4(), demSrc: null, baseKey: '', broken: false, demErrors: 0, refresh: () => {}, measure: null,
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
      const hits = raycaster.intersectObjects(c.bubbles.map((x) => x.hit), false);
      if (!hits.length) return null;
      return c.bubbles.find((x) => x.hit === hits[0].object) ?? null;
    };

    // ---------- Måling ----------
    // Linjer, flater og punkter tegnes av MapLibre (draperes automatisk på terrenget). Lengdene vises som HTML-etiketter
    // (Marker) som følger terrenget. Høyder leses av terrengmodellen i det punktet ble satt.
    const mst = {
      pts: [] as MPoint[],
      finished: false,
      cursor: null as { lng: number; lat: number; x: number; y: number } | null,
      labels: [] as maplibregl.Marker[],
      fixed: [] as any[],
    };
    const bump = () => setMeasVer((v) => v + 1);
    /** Terrenghøyde i meter over havet (uten overdrivelse), eller null når terreng er av / ikke lastet */
    const elevAt = (lng: number, lat: number): number | null => {
      if (!c.terrainOn) return null;
      const tr: any = (map as any).transform;
      const centerElev = Number.isFinite(tr?.elevation) ? (tr.elevation as number) : 0;
      const e = map.queryTerrainElevation([lng, lat]);
      return typeof e === 'number' && Number.isFinite(e) ? (e + centerElev) / Math.max(0.0001, c.exag) : null;
    };
    const metersOf = (pts: { lng: number; lat: number; z?: number | null }[]) => pointsToMeters(crsRef.current, pts);
    const clearLabels = () => { for (const m of mst.labels) m.remove(); mst.labels = []; };
    const addLabel = (lng: number, lat: number, text: string, cls: string, above = false) => {
      const el = document.createElement('div');
      el.className = `m3-label ${cls}`;
      el.textContent = text;
      const mk = new maplibregl.Marker({ element: el, anchor: above ? 'bottom' : 'center', offset: above ? [0, -10] : [0, 0] }).setLngLat([lng, lat]).addTo(map);
      mst.labels.push(mk);
    };
    const feature = (k: string, geometry: any) => ({ type: 'Feature', properties: { k }, geometry });
    const setSource = (extra: any[] = []) => {
      const src = map.getSource(MEASURE_SRC) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: [...mst.fixed, ...extra] } as any);
    };
    /** Strek fra siste punkt til musepekeren, med lengden på strekningen under arbeid */
    const drawLive = () => {
      try {
        const mode = measureRef.current;
        const cur = mst.cursor;
        const el = liveEl.current;
        if (!mode || mst.finished || !cur || !mst.pts.length) {
          if (el) el.style.display = 'none';
          setSource();
          return;
        }
        const last = mst.pts[mst.pts.length - 1];
        const live = [feature('live', { type: 'LineString', coordinates: [[last.lng, last.lat], [cur.lng, cur.lat]] })];
        if (mode === 'area' && mst.pts.length >= 2) {
          live.push(feature('live', { type: 'LineString', coordinates: [[cur.lng, cur.lat], [mst.pts[0].lng, mst.pts[0].lat]] }));
        }
        setSource(live);
        if (el) {
          const mp = metersOf([...mst.pts, cur]).pts;
          const k = mp.length;
          let text = formatLengthShort(Math.hypot(mp[k - 1].x - mp[k - 2].x, mp[k - 1].y - mp[k - 2].y));
          if (mode === 'distance' && k >= 3) text += ` · Σ ${formatLengthShort(pathLength(mp))}`;
          if (mode === 'area' && k >= 3) text += ` · ${formatAreaShort(ringArea(mp))}`;
          el.textContent = text;
          el.style.left = `${cur.x + 14}px`;
          el.style.top = `${cur.y - 30}px`;
          el.style.display = 'block';
        }
      } catch (e) { reportRef.current('Måling', e); }
    };
    /** Bygger punkter, linjer/flate og etiketter for det som er målt så langt. Kartlaget oppdateres av drawLive. */
    const drawFixed = () => {
      try {
        clearLabels();
        mst.fixed = [];
        const mode = measureRef.current;
        const n = mst.pts.length;
        if (!mode || !n) return; // drawLive tømmer kartlaget
        const coords = mst.pts.map((p) => [p.lng, p.lat]);
        if (mode === 'area' && n >= 3) mst.fixed.push(feature('poly', { type: 'Polygon', coordinates: [[...coords, coords[0]]] }));
        else if (n >= 2) mst.fixed.push(feature('line', { type: 'LineString', coordinates: coords }));
        for (const cd of coords) mst.fixed.push(feature('pt', { type: 'Point', coordinates: cd }));

        const { crs, pts: mp } = metersOf(mst.pts);
        const s = summarize(mode, mp);
        const px = mst.pts.map((p) => map.project([p.lng, p.lat]));
        s.segments.forEach((len, i) => {
          const j = (i + 1) % n;
          // Hopp over strekninger som er for korte på skjermen til å få plass til en etikett
          if (Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) < 56) return;
          addLabel((mst.pts[i].lng + mst.pts[j].lng) / 2, (mst.pts[i].lat + mst.pts[j].lat) / 2, formatLengthShort(len), 'm3-seg');
        });
        if (mode === 'distance' && s.segments.length >= 2) {
          addLabel(mst.pts[n - 1].lng, mst.pts[n - 1].lat, `Σ ${formatLengthShort(s.horizontal)}`, 'total', true);
        }
        if (s.area !== null && s.centroid) {
          const [lat, lng] = toLatLng(crs, s.centroid.x, s.centroid.y);
          addLabel(lng, lat, formatAreaShort(s.area), 'area');
        }
      } catch (e) { reportRef.current('Måling', e); }
    };
    const redrawAll = () => { drawFixed(); drawLive(); bump(); };
    c.measure = {
      add(lng, lat) {
        if (mst.finished) { mst.pts = []; mst.finished = false; }
        mst.pts.push({ lng, lat, z: elevAt(lng, lat) });
        mst.cursor = null; // strek til pekeren vises igjen ved neste musebevegelse
        redrawAll();
      },
      undo() {
        if (!mst.pts.length) return;
        mst.pts.pop();
        mst.finished = false;
        redrawAll();
      },
      finish(dedupe = false) {
        if (mst.finished || !mst.pts.length) return;
        const n = mst.pts.length;
        if (dedupe && n >= 2) {
          // Dobbeltklikk gir et ekstra punkt på samme sted – fjern det
          const a = map.project([mst.pts[n - 1].lng, mst.pts[n - 1].lat]);
          const b = map.project([mst.pts[n - 2].lng, mst.pts[n - 2].lat]);
          if (Math.hypot(a.x - b.x, a.y - b.y) < 5) mst.pts.pop();
        }
        const need = measureRef.current === 'area' ? 3 : 2;
        if (mst.pts.length >= need) { mst.finished = true; mst.cursor = null; }
        redrawAll();
      },
      clear() {
        mst.pts = [];
        mst.finished = false;
        mst.cursor = null;
        redrawAll();
      },
      modeChanged() {
        mst.finished = false;
        redrawAll();
      },
      state: () => ({ pts: mst.pts, finished: mst.finished }),
      live(x, y, lng, lat) { mst.cursor = { lng, lat, x, y }; drawLive(); },
      hideLive() { mst.cursor = null; drawLive(); },
      redraw() { drawFixed(); },
      fillHeights() {
        let changed = false;
        for (const p of mst.pts) {
          const z = elevAt(p.lng, p.lat);
          if (!c.terrainOn) { if (p.z !== null) { p.z = null; changed = true; } }
          else if (p.z === null && z !== null) { p.z = z; changed = true; }
        }
        if (changed) bump();
      },
      dispose() { clearLabels(); },
    };
    /** Kartlagene for målingen. Legges rett under three.js-laget; bakgrunn og ortofoto legges under disse. */
    const initMeasureLayers = () => {
      map.addSource(MEASURE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as any);
      const before = map.getLayer(CUSTOM_ID) ? CUSTOM_ID : undefined;
      const isK = (k: string) => ['==', ['get', 'k'], k];
      const round = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: MEASURE_FIRST, type: 'fill', source: MEASURE_SRC, filter: isK('poly'), paint: { 'fill-color': MEASURE_ORANGE, 'fill-opacity': 0.25 } } as any, before);
      map.addLayer({ id: 'feltkart-m-casing', type: 'line', source: MEASURE_SRC, filter: ['any', isK('line'), isK('poly')], layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } } as any, before);
      map.addLayer({ id: 'feltkart-m-line', type: 'line', source: MEASURE_SRC, filter: ['any', isK('line'), isK('poly')], layout: round, paint: { 'line-color': MEASURE_ORANGE, 'line-width': 3.5 } } as any, before);
      map.addLayer({ id: 'feltkart-m-live', type: 'line', source: MEASURE_SRC, filter: isK('live'), layout: round, paint: { 'line-color': MEASURE_ORANGE, 'line-width': 2.5, 'line-dasharray': [2, 2] } } as any, before);
      map.addLayer({ id: 'feltkart-m-pts', type: 'circle', source: MEASURE_SRC, filter: isK('pt'), paint: { 'circle-radius': 6, 'circle-color': MEASURE_ORANGE, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } } as any, before);
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
          // MapLibre 4.x: matrisen er ikke senket med terrenghøyden i kartsenteret. Trekk den fra, så høyder over havet stemmer med terrenget.
          const tr: any = (map as any).transform;
          const centerElev = c.terrainOn && Number.isFinite(tr?.elevation) ? (tr.elevation as number) : 0;
          const l = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z + (c.zOffset - centerElev) * s).scale(new THREE.Vector3(s, -s, s * c.exag));
          const m = new THREE.Matrix4().fromArray(arr as any);

          // Bilderammer («FOTO») og merkelapper skal alltid vende mot kameraet. Finn skjermens høyre, opp og fram-retning
          // som vektorer på 1 meter i scenens koordinater (scenen er speilet i y og strukket i z, derfor omregningen).
          const invM = new THREE.Matrix4().copy(m).invert();
          const q0 = new THREE.Vector3(0, 0, 0.5).applyMatrix4(invM);
          const vr = new THREE.Vector3(1, 0, 0.5).applyMatrix4(invM).sub(q0).normalize();
          const vu = new THREE.Vector3(0, 1, 0.5).applyMatrix4(invM).sub(q0).normalize();
          const vf = new THREE.Vector3(0, 0, 1).applyMatrix4(invM).sub(new THREE.Vector3(0, 0, -1).applyMatrix4(invM)).normalize();
          const ex = Math.max(0.2, c.exag);
          const Rs = new THREE.Vector3(vr.x, -vr.y, vr.z / ex);
          const Us = new THREE.Vector3(vu.x, -vu.y, vu.z / ex);
          const Ns = new THREE.Vector3(-vf.x, vf.y, -vf.z / ex);
          const place = (g: THREE.Object3D, px: number, py: number, pz: number, sx: number, sy: number) => {
            g.matrix.makeBasis(Rs.clone().multiplyScalar(sx), Us.clone().multiplyScalar(sy), Ns.clone().multiplyScalar(sx));
            g.matrix.setPosition(px, py, pz);
            g.matrixWorldNeedsUpdate = true;
          };
          for (const b of c.bubbles) {
            if (b.kind === 'pano') b.body.scale.set(r, r, r / ex); // kulene er runde selv med overdrevne høyder
            else place(b.body, b.x, b.y, b.z, r, r);
            const up = r * b.tagUp;
            place(b.tag, b.x + Us.x * up, b.y + Us.y * up, b.z + Us.z * up, r * TAG_W, r * TAG_H);
          }

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
      try {
        initMeasureLayers();
      } catch (e) {
        reportRef.current('Målelag', e);
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
      // Under måling skal et klikk alltid sette et punkt (også oppå en bildeboble)
      if (measureRef.current) { c.measure?.add(e.lngLat.lng, e.lngLat.lat); return; }
      const hit = pick(e.point.x, e.point.y);
      if (hit) openRef.current(hit.id);
    });
    // Dobbeltklikk gir to klikk først (det andre er et duplikat) og avslutter deretter målingen
    map.on('dblclick', () => { if (measureRef.current) c.measure?.finish(true); });
    let lastMove = 0;
    map.on('mousemove', (e) => {
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      if (measureRef.current) {
        map.getCanvas().style.cursor = 'crosshair';
        c.measure?.live(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat);
        return;
      }
      const hit = pick(e.point.x, e.point.y);
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
      setHover((cur) => {
        if (!hit) return cur ? null : cur;
        if (cur && cur.id === hit.id && Math.abs(cur.x - e.point.x) < 3 && Math.abs(cur.y - e.point.y) < 3) return cur;
        return { id: hit.id, x: e.point.x, y: e.point.y };
      });
    });
    map.on('mouseout', () => { setHover(null); c.measure?.hideLive(); });
    map.on('movestart', () => setHover(null));
    // Etikettene på målingen avhenger av hvor lange strekene er på skjermen
    map.on('moveend', () => { if (measureRef.current) c.measure?.redraw(); });

    // Terrenghøyder for bobler (og stolper ned til bakken) når høydedata er lastet
    const refresh = () => {
      try {
        c.measure?.fillHeights();
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
            if (b.kind === 'pano') b.body.position.set(b.x, b.y, alt);
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
          `Bilder ${c.bubbles.filter((b) => b.kind === 'photo').length} · 360-bilder ${c.bubbles.filter((b) => b.kind === 'pano').length} · IFC-deler ${Math.max(0, c.root.children.length - c.bubbles.length * 3)} · three.js ${c.renderer ? 'klar' : 'ikke startet'}${c.broken ? ' (feilet)' : ''}`,
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
      try { c.measure?.dispose(); } catch { /* ignorer */ }
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
  const photoKey = photos.filter((p) => p.lat !== null && (p.kind === 'pano' ? showPanos : showPhotos)).map((p) => p.id).join(',');
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    let disposed = false;
    try {
      disposeGroup(c.root);
      c.bubbles = [];

      const shownIfc = ifcs.filter(ifcVisible).map((d) => ({ d, m: meshOf(d) })).filter((x): x is { d: DxfItem; m: Mesh3D } => !!x.m);
      const shownPhotos = photos.filter((p) => p.lat !== null && (p.kind === 'pano' ? showPanos : showPhotos));

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

      // Bilder: vanlige bilder som bilderamme («FOTO»), 360-bilder som kule («360°»)
      const sphereGeo = new THREE.SphereGeometry(1, 36, 18);
      const ringGeo = new THREE.TorusGeometry(1.12, 0.06, 8, 48);
      const planeGeo = new THREE.PlaneGeometry(1, 1);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const tagMats: { photo?: THREE.MeshBasicMaterial; pano?: THREE.MeshBasicMaterial } = {};
      const tagMat = (pano: boolean) => {
        const k = pano ? 'pano' : 'photo';
        if (!tagMats[k]) {
          // premultipliedAlpha: kartets tegneflate forventer forhåndsmultiplisert alfa (MapLibre-krav for egne lag)
          tagMats[k] = new THREE.MeshBasicMaterial({ map: labelTexture(pano ? '360°' : 'FOTO', pano ? PANO_GREEN : PHOTO_GREEN), transparent: true, premultipliedAlpha: true, side: THREE.DoubleSide, depthWrite: false });
        }
        return tagMats[k]!;
      };
      const layer = (color: number, z: number, offset: number) => {
        const mesh = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }));
        mesh.position.z = z;
        mesh.frustumCulled = false;
        return mesh;
      };
      const layoutCard = (cd: NonNullable<Bubble['card']>, aspect: number) => {
        const w = CARD_H * Math.min(2.6, Math.max(0.5, aspect || 4 / 3)), h = CARD_H;
        cd.photo.scale.set(w, h, 1);
        cd.lime.scale.set(w + 0.16, h + 0.16, 1);
        cd.white.scale.set(w + 0.34, h + 0.34, 1);
      };
      for (const p of shownPhotos) {
        const [x, y] = sceneXY(p.lng!, p.lat!);
        const pano = p.kind === 'pano';
        const alt = typeof p.altitude === 'number' && Number.isFinite(p.altitude) ? p.altitude : null;
        const z = alt ?? c.baseElev + 30;

        const body = new THREE.Group();
        let hit: THREE.Mesh;
        let card: Bubble['card'];
        let imgMat: THREE.MeshBasicMaterial; // materialet som får selve bildet som tekstur
        if (pano) {
          imgMat = new THREE.MeshBasicMaterial({ color: 0x9aa5a0, side: THREE.DoubleSide });
          const sphere = new THREE.Mesh(sphereGeo, imgMat);
          sphere.rotation.x = Math.PI / 2; // polene langs z (opp)
          sphere.frustumCulled = false;
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.frustumCulled = false;
          body.add(sphere, ring);
          body.position.set(x, y, z);
          hit = sphere;
        } else {
          const white = layer(0xffffff, 0, 0);
          const lime = layer(0x5fa83a, 0.02, -1);
          const photo = layer(0xdddddd, 0.04, -2);
          imgMat = photo.material as THREE.MeshBasicMaterial;
          body.add(white, lime, photo);
          body.matrixAutoUpdate = false; // stilles inn hver bildeflate slik at rammen vender mot kameraet
          card = { white, lime, photo };
          layoutCard(card, p.width && p.height ? p.width / p.height : 4 / 3);
          hit = photo;
        }
        const tag = new THREE.Mesh(planeGeo, tagMat(pano));
        tag.matrixAutoUpdate = false;
        tag.frustumCulled = false;
        const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x, y, c.baseElev)]);
        const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
        stem.frustumCulled = false;
        c.root.add(body, tag, stem);
        c.bubbles.push({ id: p.id, lng: p.lng!, lat: p.lat!, alt, kind: p.kind, body, tag, hit, stem, x, y, z, ground: c.baseElev, tagUp: pano ? 1.65 : 1.55, card });

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
            imgMat.map = tex; imgMat.color.set(0xffffff); imgMat.needsUpdate = true;
            const img: any = tex.image;
            if (card && img?.width && img?.height) layoutCard(card, img.width / img.height); // riktig forhold selv om bildet er rotert
            map.triggerRepaint();
          } catch { /* behold grå flate */ }
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

  // ---------- Måling: tastatur og verktøyvalg ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!measureRef.current) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = !!el && (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
      if (e.key === 'Escape') { if (!typing) setMeasureMode(null); return; }
      if (typing || tag === 'BUTTON') return;
      const api = ctxRef.current?.measure;
      if (e.key === 'Enter') { e.preventDefault(); api?.finish(false); }
      else if (e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); api?.undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    try {
      const map = c.map;
      if (measureMode) {
        map.doubleClickZoom.disable(); // dobbeltklikk avslutter målingen i stedet for å zoome
        map.getCanvas().style.cursor = 'crosshair';
        setHover(null);
        c.measure?.modeChanged(); // bytte mellom avstand og areal beholder punktene
      } else {
        map.doubleClickZoom.enable();
        map.getCanvas().style.cursor = '';
        c.measure?.clear();
      }
    } catch (e) {
      report('Måling', e);
    }
  }, [ready, measureMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const measureView = useMemo(() => {
    const api = ctxRef.current?.measure;
    if (!measureMode || !api) return null;
    const st = api.state();
    const r = pointsToMeters(settings.projectCrs, st.pts);
    return { summary: summarize(measureMode, r.pts), crs: r.crs, finished: st.finished, missingZ: terrainOn && st.pts.some((p) => p.z === null) };
  }, [measureMode, measVer, settings.projectCrs, terrainOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const measureNote = !terrainOn
    ? 'Terreng er slått av, så bare horisontale mål vises.'
    : measureView?.missingZ
      ? 'Høyde mangler for noen punkter fordi terrengmodellen ikke er lastet ennå. Vent litt eller zoom inn.'
      : 'Høydene er lest av terrengmodellen og er omtrentlige. Skrå lengde er rette linjer mellom punktene.';

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
  const nPhoto = photos.filter((p) => p.lat !== null && p.kind !== 'pano').length;
  const nPano = photos.filter((p) => p.lat !== null && p.kind === 'pano').length;
  const hoverPhoto = hover ? photos.find((p) => p.id === hover.id) : undefined;

  return (
    <div className="t3d">
      <div className="t3d-map">
        {/* Fast størrelse som inline-stil: MapLibres stilark setter ellers «position: relative» og kartet kollapser til 0 px */}
        <div ref={mapEl} className="t3d-canvas" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <div className="t3d-topbar">
          <button className="t3d-toggle" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '‹ Skjul panel' : '› Lag og valg'}</button>
          <div className="tb-group" role="group" aria-label="Måling">
            <button className={`tb-btn wide${measureMode === 'distance' ? ' on' : ''}`} disabled={!ready} title="Mål avstand / lengde (med høydeforskjell)"
              onClick={() => setMeasureMode((m) => (m === 'distance' ? null : 'distance'))}><IconRuler size={18} /><span>Avstand</span></button>
            <button className={`tb-btn wide${measureMode === 'area' ? ' on' : ''}`} disabled={!ready} title="Mål areal innenfor et polygon"
              onClick={() => setMeasureMode((m) => (m === 'area' ? null : 'area'))}><IconArea size={18} /><span>Areal</span></button>
          </div>
        </div>
        {!ready && !error && <div className="t3d-loading">Laster 3D …</div>}
        {error && <div className="t3d-loading error">{error}</div>}
        {measureMode && measureView && (
          <MeasurePanel
            mode={measureMode}
            summary={measureView.summary}
            crsLabel={crsName(measureView.crs)}
            finished={measureView.finished}
            note={measureNote}
            rightClickUndo={false}
            onMode={(m) => setMeasureMode(m)}
            onUndo={() => ctxRef.current?.measure?.undo()}
            onFinish={() => ctxRef.current?.measure?.finish(false)}
            onClear={() => ctxRef.current?.measure?.clear()}
            onClose={() => setMeasureMode(null)}
          />
        )}
        <div ref={liveEl} className="t3d-live" style={{ display: 'none' }} />
        {hover && hoverPhoto && (
          <div className={`t3d-hover h-${hoverPhoto.kind}`} style={{ left: hover.x + 16, top: hover.y + 16 }}>
            <img src={hoverPhoto.thumb} alt="" />
            <div><b>{hoverPhoto.kind === 'pano' ? '360-bilde' : 'Vanlig foto'}</b><span>{hoverPhoto.name}</span></div>
          </div>
        )}
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
            <h4>Bilder i 3D</h4>
            <label className="t3d-check">
              <input type="checkbox" className="chk" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} />
              <span className="t3d-key k-photo" aria-hidden="true" />
              <span className="t3d-name">Vanlige bilder (rammer)</span>
              <span className="muted small">{nPhoto}</span>
            </label>
            <label className="t3d-check">
              <input type="checkbox" className="chk" checked={showPanos} onChange={(e) => setShowPanos(e.target.checked)} />
              <span className="t3d-key k-pano" aria-hidden="true">360</span>
              <span className="t3d-name">360-bilder (kuler)</span>
              <span className="muted small">{nPano}</span>
            </label>
            <label className="t3d-field">Størrelse: <b>{bubbleScale.toFixed(1)}×</b>
              <input type="range" min={0.5} max={4} step={0.1} value={bubbleScale} onChange={(e) => setBubbleScale(+e.target.value)} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>Et vanlig foto vises som en <b>ramme</b> med «FOTO»-merke. Et 360-bilde vises som en <b>kule</b> med «360°»-merke. Hold musen over for navn, klikk for å åpne bildet. Stolpen går ned til bakken.</p>
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
