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
import { colorFor, hexCss } from '../lib/ifcColors';
import { formatAreaShort, formatLengthShort, historyRow, isDoubleClick, isTouchEvent, pathLength, ringArea, summarize } from '../lib/measure';
import type { ClickMemo, MeasureMode } from '../lib/measure';
import MeasurePanel from './MeasurePanel';
import MeasureChip from './MeasureChip';
import { invert4, mercatorToLngLat, nearestOnScreen, projectWithMatrix, rayFromMatrix, snapAt3d, SNAP_LABEL } from '../lib/snap';
import type { SnapKind, SnapPart } from '../lib/snap';
import { clearAllMeasures, loadMeasures, loadSnap, newMeasureId, onMeasureChanged, pickColor, saveMeasures, saveSnap } from '../lib/measureStore';
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



const CUSTOM_ID = 'feltkart-three';
const MEASURE_SRC = 'feltkart-measure';
/** Det nederste målelaget. Bakgrunn og ortofoto legges under det, så målingen alltid ligger oppå. */
const MEASURE_FIRST = 'feltkart-m-fill';
const MEASURE_ORANGE = '#ef6c1a';
/** Hver måling har sin egen farge (egenskapen «c» på hvert objekt) */
const MEASURE_COLOR = ['coalesce', ['get', 'c'], MEASURE_ORANGE];
/** Lagene våre legges rett under målingen (og three.js-laget) slik at terreng og bakgrunn tegnes først */
const beforeCustom = (map: maplibregl.Map) => (map.getLayer(MEASURE_FIRST) ? MEASURE_FIRST : map.getLayer(CUSTOM_ID) ? CUSTOM_ID : undefined);

/** Et punkt i en måling. Høyden (m o.h.) leses av terrengmodellen, og er null når terreng er av eller ikke lastet. */
interface MPoint {
  lng: number; lat: number; z: number | null;
  /** Høyden kommer fra et snappet objekt (IFC) og skal ikke byttes ut med terrenghøyde */
  fix?: boolean;
}

/** En ferdig måling i historikken (tegnes i sin egen farge) */
interface HistM { id: string; color: string; mode: MeasureMode; pts: MPoint[] }

/** Målemotoren bor inne i kart-effekten (den trenger kartet), og brukes av knappene i panelet */
interface MeasureApi {
  /** Klikk under måling. To raske klikk på samme sted er et dobbeltklikk: det andre gir ikke noe nytt punkt, men avslutter målingen. */
  add: (lng: number, lat: number, px?: { x: number; y: number }, ev?: unknown) => void;
  /** Snapper en skjermposisjon til IFC-modellen. null hvis snapping er av, Alt holdes inne eller ingenting er i nærheten. */
  snapAt: (x: number, y: number, ev?: unknown) => { lng: number; lat: number; z: number; kind: SnapKind; layer: string; scene: [number, number, number] } | null;
  /** Tegner målingen på nytt uten å lagre (brukes etter at den er gjenopprettet) */
  show: () => void;
  undo: () => void;
  finish: (dedupe?: boolean) => void;
  /** Nullstill alle: fjerner alle målingene og de lagrede kopiene */
  clear: () => void;
  /** Bytte mellom avstand og areal: punktene beholdes midt i en måling; en ferdig måling blir stående som den er og en ny starter */
  modeChanged: () => void;
  state: () => { pts: MPoint[]; finished: boolean; mode: MeasureMode; id: string; color: string; hist: HistM[] };
  /** Sletter én måling (den aktive eller en i historikken) */
  deleteItem: (id: string) => void;
  /** Zoomer til en måling */
  focusItem: (id: string) => void;
  /** Strek og etikett fra siste punkt til musepekeren */
  live: (x: number, y: number, lng: number, lat: number, ev?: unknown) => void;
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
  /** IFC-delene som målingen kan snappe til (med scenekoordinater) */
  snapParts: SnapPart[];
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
  const exag = 1; // høydene vises alltid i riktig målestokk (overdrivelse er fjernet)
  const [terrainSrc, setTerrainSrc] = useState<TerrainKey>('mapterhorn');
  const terrainSrcRef = useRef<TerrainKey>(terrainSrc);
  terrainSrcRef.current = terrainSrc;
  const startBase = settings.basemapId === 'osm' || settings.basemapId === 'kv-topo' || settings.basemapId === 'kv-gra' || settings.basemapId === 'custom' ? settings.basemapId : 'esri';
  const [baseId, setBaseId] = useState<string>(startBase);
  const [orthoOn, setOrthoOn] = useState<Record<string, boolean>>({});
  const [orthoOpacity, setOrthoOpacity] = useState<Record<string, number>>({});
  const [ifcOn, setIfcOn] = useState<Record<string, boolean>>({});
  const [ifcOwnColors, setIfcOwnColors] = useState(true); // bruk fargene fra IFC-filen (ellers standardfarger per klasse)
  const [ifcEdges, setIfcEdges] = useState(true); // kantlinjer som viser detaljene i modellen
  const [ifcLayerOn, setIfcLayerOn] = useState<Record<string, boolean>>({}); // `${id}|${lag}`; mangler = følger lagvalget i kartet
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
  const snapEl = useRef<HTMLDivElement>(null);
  const [snapOn, setSnapOn] = useState(() => loadSnap());
  const snapOnRef = useRef(snapOn);
  snapOnRef.current = snapOn;
  const [snapState, setSnapState] = useState<string | null>(null);

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
      proj: new THREE.Matrix4(), demSrc: null, baseKey: '', broken: false, demErrors: 0, refresh: () => {}, measure: null, snapParts: [],
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
      // Selve bildet/kulen og merkelappen («FOTO» / «360°») kan klikkes
      const hits = raycaster.intersectObjects(c.bubbles.flatMap((x) => [x.hit, x.tag]), false);
      if (hits.length) {
        const o = hits[0].object;
        const found = c.bubbles.find((x) => x.hit === o || x.tag === o);
        if (found) return found;
      }
      // Bommer strålen (små bobler langt unna): ta boblen som ligger nærmest klikket, innen 26 piksler
      try {
        const m = c.proj.elements;
        if (!m || m.length !== 16) return null;
        const near = nearestOnScreen(c.bubbles.map((bb) => ({ bb, p: [bb.x, bb.y, bb.z] as [number, number, number] })), { x: px, y: py }, projectWithMatrix(m, w, h), 26);
        return near ? near.bb : null;
      } catch { return null; }
    };

    // ---------- Måling ----------
    // Linjer, flater og punkter tegnes av MapLibre (draperes automatisk på terrenget). Lengdene vises som HTML-etiketter
    // (Marker) som følger terrenget. Høyder leses av terrengmodellen i det punktet ble satt.
    const mst = {
      /** Den aktive målingen (under arbeid eller nettopp ferdig); ferdige målinger flyttes til `hist` når en ny starter */
      id: newMeasureId(),
      color: pickColor([]),
      hist: [] as HistM[],
      pts: [] as MPoint[],
      finished: false,
      /** Avstand eller areal. Beholdes når måleverktøyet er av (målingen er lagret og vises fortsatt). */
      mode: 'distance' as MeasureMode,
      snap: null as { kind: SnapKind; scene: [number, number, number] } | null,
      /** 3D-linje gjennom punktene (med ekte høyder), så en måling mellom f.eks. to takhjørner ikke bare ligger på bakken */
      guides: [] as THREE.Line[],
      cursor: null as { lng: number; lat: number; x: number; y: number } | null,
      labels: [] as maplibregl.Marker[],
      fixed: [] as any[],
      /** Siste klikk – brukes til å kjenne igjen dobbeltklikk / dobbelttrykk */
      lastClick: null as ClickMemo | null,
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
    const modeOf = (): MeasureMode => measureRef.current ?? mst.mode;
    const persist = () => {
      try {
        const q = (pts: MPoint[]) => pts.map((p) => ({ lat: p.lat, lng: p.lng, z: p.z, fix: p.fix === true }));
        saveMeasures(
          mst.pts.length ? { mode: modeOf(), finished: mst.finished, id: mst.id, color: mst.color, pts: q(mst.pts) } : null,
          mst.hist.map((h) => ({ id: h.id, color: h.color, mode: h.mode, pts: q(h.pts) })),
          '3d',
        );
      } catch { /* lagring er ikke kritisk */ }
    };
    const loadStored = () => {
      try {
        const { active, history } = loadMeasures();
        const mp = (pts: { lng: number; lat: number; z: number | null; fix?: boolean }[]) => pts.map((q) => ({ lng: q.lng, lat: q.lat, z: q.z, fix: q.fix === true }));
        mst.hist = history.map((h) => ({ id: h.id, color: h.color, mode: h.mode, pts: mp(h.pts) }));
        mst.pts = active ? mp(active.pts) : [];
        mst.finished = active?.finished ?? false;
        if (active) mst.mode = active.mode;
        const used = mst.hist.map((h) => h.color);
        // En måling fra en eldre versjon har ingen id eller farge; den får en som ikke er i bruk
        mst.id = active?.id && !mst.hist.some((h) => h.id === active.id) ? active.id : newMeasureId();
        mst.color = active?.color && !used.includes(active.color) ? active.color : pickColor(used);
      } catch { mst.hist = []; mst.pts = []; mst.finished = false; mst.id = newMeasureId(); mst.color = pickColor([]); }
      mst.cursor = null; mst.snap = null; mst.lastClick = null;
    };
    /** Flytter en ferdig måling til historikken og gjør klar en ny, tom måling med neste farge */
    const archiveActive = () => {
      if (!mst.finished || !mst.pts.length) return;
      mst.hist.push({ id: mst.id, color: mst.color, mode: mst.mode, pts: mst.pts });
      mst.pts = [];
      mst.finished = false;
      mst.id = newMeasureId();
      mst.color = pickColor(mst.hist.map((h) => h.color));
    };
    const sceneXYOf = (lng: number, lat: number): [number, number] | null => {
      const o = c.originMerc;
      if (!o) return null;
      const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
      const sc = o.meterInMercatorCoordinateUnits();
      return [(mc.x - o.x) / sc, -(mc.y - o.y) / sc];
    };
    /** Linje i 3D gjennom punktene (i målingens farge) når minst ett punkt er snappet til et objekt */
    const updateGuide = () => {
      try {
        for (const g of mst.guides) {
          c.scene.remove(g);
          (g.geometry as any)?.dispose?.();
          (g.material as any)?.dispose?.();
        }
        mst.guides = [];
        if (!c.originMerc) return;
        const items = [...mst.hist.map((h) => ({ pts: h.pts, mode: h.mode, color: h.color })), { pts: mst.pts, mode: modeOf(), color: mst.color }];
        for (const it of items) {
          const n = it.pts.length;
          if (n < 2 || !it.pts.some((p) => p.fix)) continue;
          const arr: number[] = [];
          const add = (p: MPoint) => {
            const xy = sceneXYOf(p.lng, p.lat);
            if (xy) arr.push(xy[0], xy[1], p.z ?? c.baseElev);
          };
          it.pts.forEach(add);
          if (it.mode === 'area' && n >= 3) add(it.pts[0]);
          if (arr.length < 6) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: parseInt(it.color.slice(1), 16), depthTest: false, transparent: true, opacity: 0.95 }));
          line.frustumCulled = false;
          line.renderOrder = 999;
          c.scene.add(line);
          mst.guides.push(line);
        }
        map.triggerRepaint();
      } catch (e) { reportRef.current('Måling (3D-linje)', e); }
    };
    /** Markør på det punktet markøren snapper til (rute = hjørne, sirkel = kant, liten sirkel = flate) */
    const drawSnapMark = () => {
      const el = snapEl.current;
      if (!el) return;
      const sn = mst.snap;
      if (!sn) { el.className = 'snap-mark'; return; }
      const el0 = map.getContainer();
      const pr = projectWithMatrix(c.proj.elements, el0.clientWidth, el0.clientHeight)(sn.scene);
      if (!pr) { el.className = 'snap-mark'; return; }
      el.className = `snap-mark ${sn.kind} on`;
      el.style.left = `${pr.x}px`;
      el.style.top = `${pr.y}px`;
      el.innerHTML = `<b>${SNAP_LABEL[sn.kind]}</b>`;
    };
    const clearLabels = () => { for (const m of mst.labels) m.remove(); mst.labels = []; };
    const addLabel = (lng: number, lat: number, text: string, cls: string, above = false, color = MEASURE_ORANGE) => {
      const el = document.createElement('div');
      el.className = `m3-label ${cls}`;
      el.style.setProperty('--mc', color);
      el.textContent = text;
      const mk = new maplibregl.Marker({ element: el, anchor: above ? 'bottom' : 'center', offset: above ? [0, -10] : [0, 0] }).setLngLat([lng, lat]).addTo(map);
      mst.labels.push(mk);
    };
    const feature = (k: string, geometry: any, c = mst.color) => ({ type: 'Feature', properties: { k, c }, geometry });
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
    /** Bygger punkter, linjer/flate og etiketter for én måling */
    const buildOne = (pts: MPoint[], mode: MeasureMode, color: string) => {
      const n = pts.length;
      if (!n) return;
      const coords = pts.map((p) => [p.lng, p.lat]);
      if (mode === 'area' && n >= 3) mst.fixed.push(feature('poly', { type: 'Polygon', coordinates: [[...coords, coords[0]]] }, color));
      else if (n >= 2) mst.fixed.push(feature('line', { type: 'LineString', coordinates: coords }, color));
      for (const cd of coords) mst.fixed.push(feature('pt', { type: 'Point', coordinates: cd }, color));

      const { crs, pts: mp } = metersOf(pts);
      const s = summarize(mode, mp);
      const px = pts.map((p) => map.project([p.lng, p.lat]));
      s.segments.forEach((len, i) => {
        const j = (i + 1) % n;
        // Hopp over strekninger som er for korte på skjermen til å få plass til en etikett
        if (Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) < 56) return;
        addLabel((pts[i].lng + pts[j].lng) / 2, (pts[i].lat + pts[j].lat) / 2, formatLengthShort(len), 'm3-seg', false, color);
      });
      if (mode === 'distance' && s.segments.length >= 2) {
        addLabel(pts[n - 1].lng, pts[n - 1].lat, `Σ ${formatLengthShort(s.horizontal)}`, 'total', true, color);
      }
      if (s.area !== null && s.centroid) {
        const [lat, lng] = toLatLng(crs, s.centroid.x, s.centroid.y);
        addLabel(lng, lat, formatAreaShort(s.area), 'area', false, color);
      }
    };
    /** Bygger alle målingene: de ferdige i historikken og den som pågår. Kartlaget oppdateres av drawLive. */
    const drawFixed = () => {
      try {
        clearLabels();
        mst.fixed = [];
        updateGuide();
        for (const h of mst.hist) buildOne(h.pts, h.mode, h.color);
        buildOne(mst.pts, modeOf(), mst.color);
      } catch (e) { reportRef.current('Måling', e); }
    };
    const redrawAll = (save = true) => { drawFixed(); drawLive(); if (save) persist(); bump(); };
    const finishNow = (dedupe = false) => {
      if (mst.finished || !mst.pts.length) return;
      const n = mst.pts.length;
      if (dedupe && n >= 2) {
        // Dobbeltklikk som kom for sent til å regnes som ett gir et ekstra punkt på samme sted – fjern det
        const a = map.project([mst.pts[n - 1].lng, mst.pts[n - 1].lat]);
        const b = map.project([mst.pts[n - 2].lng, mst.pts[n - 2].lat]);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 5) mst.pts.pop();
      }
      const need = modeOf() === 'area' ? 3 : 2;
      if (mst.pts.length >= need) { mst.finished = true; mst.cursor = null; }
      redrawAll();
    };
    const clearNow = () => {
      mst.hist = [];
      mst.pts = [];
      mst.finished = false;
      mst.id = newMeasureId();
      mst.color = pickColor([]);
      mst.cursor = null;
      mst.lastClick = null;
      mst.snap = null;
      setSnapState(null);
      drawSnapMark();
      clearAllMeasures('3d'); // fjerner også de lagrede kopiene
      redrawAll(false);
    };
    loadStored();
    const offStore = onMeasureChanged('3d', () => { loadStored(); redrawAll(false); });
    c.measure = {
      add(lng, lat, px, ev) {
        // Dobbeltklikk avgjøres her (to raske klikk på samme sted) og ikke av «dblclick», som kommer i ulik rekkefølge og på mobil
        // ofte ikke i det hele tatt. Uten dette kunne det siste klikket etter en avsluttet måling starte en ny måling på samme punkt.
        if (px) {
          const here: ClickMemo = { t: performance.now(), x: px.x, y: px.y, touch: isTouchEvent(ev) };
          const second = isDoubleClick(mst.lastClick, here);
          mst.lastClick = here;
          if (second) { finishNow(false); return; }
        }
        // Etter en avsluttet måling starter neste klikk en helt ny måling
        if (mst.finished) { archiveActive(); if (measureRef.current) mst.mode = measureRef.current; }
        const sn = px ? c.measure!.snapAt(px.x, px.y, ev) : null;
        if (sn) mst.pts.push({ lng: sn.lng, lat: sn.lat, z: sn.z, fix: true });
        else mst.pts.push({ lng, lat, z: elevAt(lng, lat) });
        mst.cursor = null; // strek til pekeren vises igjen ved neste musebevegelse
        mst.snap = null;
        setSnapState(null);
        drawSnapMark();
        redrawAll();
      },
      undo() {
        if (!mst.pts.length) return;
        mst.pts.pop();
        mst.finished = false;
        mst.lastClick = null;
        redrawAll();
      },
      finish: finishNow,
      clear: clearNow,
      modeChanged() {
        // Målingen er lagret og beholdes når man bytter mellom avstand og areal eller avslutter verktøyet. Bare Nullstill fjerner den.
        const t = measureRef.current;
        // En ferdig måling beholder sin type og blir stående i kartet; et nytt valg gir en ny, tom måling
        if (t && mst.finished && mst.pts.length && mst.mode !== t) archiveActive();
        if (t) mst.mode = t;
        if (mst.finished && mst.pts.length < (mst.mode === 'area' ? 3 : 2)) mst.finished = false;
        mst.cursor = null;
        redrawAll();
      },
      state: () => ({ pts: mst.pts, finished: mst.finished, mode: mst.mode, id: mst.id, color: mst.color, hist: mst.hist }),
      deleteItem(id) {
        if (mst.id === id) {
          mst.pts = [];
          mst.finished = false;
          mst.cursor = null;
          mst.lastClick = null;
        } else {
          mst.hist = mst.hist.filter((h) => h.id !== id);
        }
        redrawAll();
      },
      focusItem(id) {
        const pts = mst.id === id ? mst.pts : mst.hist.find((h) => h.id === id)?.pts;
        if (!pts || !pts.length) return;
        try {
          const lngs = pts.map((p) => p.lng), lats = pts.map((p) => p.lat);
          map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 90, maxZoom: 20 });
        } catch { /* ignorer */ }
      },
      snapAt(x, y, ev) {
        try {
          if (!snapOnRef.current || (ev as { altKey?: boolean } | null | undefined)?.altKey || !c.snapParts.length || !c.originMerc) return null;
          const el = map.getContainer();
          const W = el.clientWidth, H = el.clientHeight;
          if (!W || !H) return null;
          const m = c.proj.elements;
          const inv = invert4(m);
          if (!inv) return null;
          const hit = snapAt3d(c.snapParts, (px, py) => rayFromMatrix(inv, px, py, W, H), { x, y }, projectWithMatrix(m, W, H));
          if (!hit) return null;
          const o = c.originMerc;
          const sc = o.meterInMercatorCoordinateUnits();
          const [lng, lat] = mercatorToLngLat(o.x + hit.point[0] * sc, o.y - hit.point[1] * sc);
          return { lng, lat, z: hit.point[2], kind: hit.kind, layer: hit.layer, scene: hit.point };
        } catch (e) { reportRef.current('Snapping', e); return null; }
      },
      show() { redrawAll(false); },
      live(x, y, lng, lat, ev) {
        const sn = c.measure!.snapAt(x, y, ev);
        mst.snap = sn ? { kind: sn.kind, scene: sn.scene } : null;
        mst.cursor = sn ? { lng: sn.lng, lat: sn.lat, x, y } : { lng, lat, x, y };
        const label = sn ? SNAP_LABEL[sn.kind] : null;
        setSnapState((cur) => (cur === label ? cur : label));
        drawSnapMark();
        drawLive();
      },
      hideLive() { mst.cursor = null; mst.snap = null; setSnapState(null); drawSnapMark(); drawLive(); },
      redraw() { drawFixed(); },
      fillHeights() {
        let changed = false;
        for (const p of [...mst.pts, ...mst.hist.flatMap((h) => h.pts)]) {
          if (p.fix) continue; // høyden er fra et snappet objekt
          const z = elevAt(p.lng, p.lat);
          if (!c.terrainOn) { if (p.z !== null) { p.z = null; changed = true; } }
          else if (p.z === null && z !== null) { p.z = z; changed = true; }
        }
        if (changed) { persist(); bump(); }
      },
      dispose() {
        offStore();
        clearLabels();
        for (const g of mst.guides) { c.scene.remove(g); (g.geometry as any)?.dispose?.(); (g.material as any)?.dispose?.(); }
        mst.guides = [];
      },
    };
    /** Kartlagene for målingen. Legges rett under three.js-laget; bakgrunn og ortofoto legges under disse. */
    const initMeasureLayers = () => {
      map.addSource(MEASURE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as any);
      const before = map.getLayer(CUSTOM_ID) ? CUSTOM_ID : undefined;
      const isK = (k: string) => ['==', ['get', 'k'], k];
      const round = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: MEASURE_FIRST, type: 'fill', source: MEASURE_SRC, filter: isK('poly'), paint: { 'fill-color': MEASURE_COLOR, 'fill-opacity': 0.25 } } as any, before);
      map.addLayer({ id: 'feltkart-m-casing', type: 'line', source: MEASURE_SRC, filter: ['any', isK('line'), isK('poly')], layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } } as any, before);
      map.addLayer({ id: 'feltkart-m-line', type: 'line', source: MEASURE_SRC, filter: ['any', isK('line'), isK('poly')], layout: round, paint: { 'line-color': MEASURE_COLOR, 'line-width': 3.5 } } as any, before);
      map.addLayer({ id: 'feltkart-m-live', type: 'line', source: MEASURE_SRC, filter: isK('live'), layout: round, paint: { 'line-color': MEASURE_COLOR, 'line-width': 2.5, 'line-dasharray': [2, 2] } } as any, before);
      map.addLayer({ id: 'feltkart-m-pts', type: 'circle', source: MEASURE_SRC, filter: isK('pt'), paint: { 'circle-radius': 6, 'circle-color': MEASURE_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } } as any, before);
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
      if (measureRef.current) { c.measure?.add(e.lngLat.lng, e.lngLat.lat, { x: e.point.x, y: e.point.y }, e.originalEvent); return; }
      const hit = pick(e.point.x, e.point.y);
      if (hit) openRef.current(hit.id);
    });
    // Dobbeltklikk avslutter målingen. Det avgjøres egentlig i add() (to raske klikk på samme sted), siden «dblclick» kommer i ulik
    // rekkefølge og av og til ikke i det hele tatt. Her tas tilfellene der klikkene kom for sent til å regnes som ett.
    map.on('dblclick', () => { if (measureRef.current) c.measure?.finish(true); });
    let lastMove = 0;
    map.on('mousemove', (e) => {
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      if (measureRef.current) {
        map.getCanvas().style.cursor = 'crosshair';
        c.measure?.live(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat, e.originalEvent);
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
  const layerShown = (d: DxfItem, layer: string) => ifcLayerOn[`${d.id}|${layer}`] ?? !d.hiddenLayers.includes(layer);
  const ifcKey = ifcs.filter(ifcVisible).map((d) => `${d.id}:${meshOf(d) ? 1 : 0}:${d.hiddenLayers.join('+')}`).join(',')
    + `|${ifcOwnColors ? 1 : 0}${ifcEdges ? 1 : 0}|${Object.entries(ifcLayerOn).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(',')}`;
  const photoKey = photos.filter((p) => p.lat !== null && (p.kind === 'pano' ? showPanos : showPhotos)).map((p) => p.id).join(',');
  useEffect(() => {
    const c = ctxRef.current;
    if (!ready || !c) return;
    const map = c.map;
    let disposed = false;
    try {
      disposeGroup(c.root);
      c.bubbles = [];
      c.snapParts = [];

      const shownIfc = ifcs.filter(ifcVisible).map((d) => ({ d, m: meshOf(d) })).filter((x): x is { d: DxfItem; m: Mesh3D } => !!x.m);
      const shownPhotos = photos.filter((p) => p.lat !== null && (p.kind === 'pano' ? showPanos : showPhotos));

      // origo: gjennomsnitt av alt som skal tegnes
      const pts: [number, number][] = []; // [lng, lat]
      for (const { m } of shownIfc) { const [lat, lng] = toLatLng(m.crs, m.origin[0], m.origin[1]); pts.push([lng, lat]); }
      for (const p of shownPhotos) pts.push([p.lng!, p.lat!]);
      if (!pts.length) { c.originMerc = null; c.origin = null; c.measure?.redraw(); map.triggerRepaint(); return; }
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
      for (const { d, m } of shownIfc) {
        const [e0, n0] = m.origin;
        const toXY = (e: number, n: number) => { const [la, ln] = toLatLng(m.crs, e, n); return sceneXY(ln, la); };
        const p0 = toXY(e0, n0), pe = toXY(e0 + 100, n0), pn = toXY(e0, n0 + 100);
        const ax = (pe[0] - p0[0]) / 100, ay = (pe[1] - p0[1]) / 100;
        const bx = (pn[0] - p0[0]) / 100, by = (pn[1] - p0[1]) / 100;
        const totalTris = m.parts.reduce((n, p) => n + p.positions.length / 9, 0);
        for (const part of m.parts) {
          if (!layerShown(d, part.layer)) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
          geo.computeVertexNormals();
          const own = ifcOwnColors && part.color !== undefined;
          const glass = /Vinduer|Glass/.test(part.layer);
          const opacity = own ? (part.opacity ?? 1) : glass ? 0.55 : 1;
          const mat = new THREE.MeshLambertMaterial({
            color: own ? part.color! : colorFor(part.layer), side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // flatene legges litt bak, slik at kantlinjene ikke flimrer
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.set(ax, bx, 0, p0[0], ay, by, 0, p0[1], 0, 0, 1, 0, 0, 0, 0, 1);
          mesh.frustumCulled = false;
          c.root.add(mesh);
          // Samme avbildning som over, til snapping (stråle mot trekantene)
          if (opacity >= 0.3) c.snapParts.push({ layer: part.layer, positions: part.positions, xf: { ax, ay, bx, by, tx: p0[0], ty: p0[1] } });
          // Kantlinjer: viser detaljer (vinduer, dører, fuger) som ellers flyter sammen i like farger. Hoppes over i svært store modeller.
          if (ifcEdges && totalTris <= 400_000 && opacity >= 0.3) {
            const eg = new THREE.EdgesGeometry(geo, 28);
            const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x20252b, transparent: true, opacity: 0.5 }));
            lines.matrixAutoUpdate = false;
            lines.matrix.copy(mesh.matrix);
            lines.frustumCulled = false;
            c.root.add(lines);
          }
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
      c.measure?.redraw(); // 3D-linjen i målingen følger scenens origo
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
        // Målingen blir stående (og lagret) når verktøyet avsluttes. Bare Nullstill fjerner den.
        c.measure?.hideLive();
        c.measure?.modeChanged();
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
    return { summary: summarize(measureMode, r.pts), crs: r.crs, finished: st.finished, missingZ: st.pts.some((p) => p.z === null) && terrainOn, snapped: st.pts.some((p) => p.fix) };
  }, [measureMode, measVer, settings.projectCrs, terrainOn]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Listen over alle målingene (ferdige først, så den som pågår) med farge og verdi */
  const historyRows = useMemo(() => {
    const api = ctxRef.current?.measure;
    if (!api) return [];
    const st = api.state();
    const all = [
      ...st.hist.map((h) => ({ id: h.id, color: h.color, mode: h.mode, pts: h.pts, active: false, finished: true })),
      ...(st.pts.length ? [{ id: st.id, color: st.color, mode: st.mode, pts: st.pts, active: true, finished: st.finished }] : []),
    ];
    return all.map((it) => historyRow(it, summarize(it.mode, pointsToMeters(settings.projectCrs, it.pts).pts)));
  }, [measVer, settings.projectCrs]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lagrede målinger når verktøyet ikke er i bruk
  const storedView = useMemo(() => {
    const api = ctxRef.current?.measure;
    if (measureMode || !api) return null;
    const st = api.state();
    const last = st.pts.length ? { mode: st.mode, pts: st.pts, finished: st.finished } : st.hist.length ? { mode: st.hist[st.hist.length - 1].mode, pts: st.hist[st.hist.length - 1].pts, finished: true } : null;
    if (!last) return null;
    const r = pointsToMeters(settings.projectCrs, last.pts);
    return { mode: last.mode, summary: summarize(last.mode, r.pts), finished: last.finished, count: st.hist.length + (st.pts.length ? 1 : 0) };
  }, [measureMode, measVer, settings.projectCrs]); // eslint-disable-line react-hooks/exhaustive-deps
  const measureNote = (!terrainOn
    ? 'Terreng er slått av, så bare horisontale mål vises (unntatt mellom punkter snappet til IFC, som har høyde).'
    : measureView?.missingZ
      ? 'Høyde mangler for noen punkter fordi terrengmodellen ikke er lastet ennå. Vent litt eller zoom inn.'
      : 'Høydene er lest av terrengmodellen og er omtrentlige. Skrå lengde er rette linjer mellom punktene.')
    + (measureView?.snapped ? ' Punkter som er snappet til IFC bruker høyden i modellen.' : '');
  const toggleSnap = (on: boolean) => {
    saveSnap(on);
    setSnapOn(on);
    ctxRef.current?.measure?.hideLive();
  };

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
            history={historyRows}
            onDeleteItem={(id) => ctxRef.current?.measure?.deleteItem(id)}
            onFocusItem={(id) => ctxRef.current?.measure?.focusItem(id)}
            note={measureNote}
            snap={snapOn}
            onSnap={toggleSnap}
            snapState={snapState}
            rightClickUndo={false}
            onMode={(m) => setMeasureMode(m)}
            onUndo={() => ctxRef.current?.measure?.undo()}
            onFinish={() => ctxRef.current?.measure?.finish(false)}
            onClear={() => ctxRef.current?.measure?.clear()}
            onClose={() => setMeasureMode(null)}
          />
        )}
        <div ref={liveEl} className="t3d-live" style={{ display: 'none' }} />
        <div ref={snapEl} className="snap-mark" />
        {storedView && (
          <MeasureChip
            mode={storedView.mode}
            summary={storedView.summary}
            finished={storedView.finished}
            count={storedView.count}
            onOpen={() => setMeasureMode(storedView.mode)}
            onClear={() => ctxRef.current?.measure?.clear()}
          />
        )}
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
            {ifcs.map((d) => {
              const m = meshOf(d);
              const layers: { layer: string; color: number | undefined; tris: number }[] = [];
              if (m) {
                for (const p of m.parts) {
                  const e = layers.find((x) => x.layer === p.layer);
                  if (e) { e.tris += p.positions.length / 9; if (e.color === undefined) e.color = p.color; }
                  else layers.push({ layer: p.layer, color: p.color, tris: p.positions.length / 9 });
                }
                layers.sort((a, b) => a.layer.localeCompare(b.layer, 'nb'));
              }
              return (
                <div key={d.id}>
                  <label className="t3d-check" title={d.name}>
                    <input type="checkbox" className="chk" checked={ifcVisible(d)} onChange={(e) => setIfcOn((s) => ({ ...s, [d.id]: e.target.checked }))} />
                    <span className="t3d-name">{d.name}</span>
                    <span className="muted small">{ifcState(d)}</span>
                  </label>
                  {ifcVisible(d) && layers.length > 0 && (
                    <div className="t3d-sub">
                      {layers.map((l) => (
                        <label key={l.layer} className="t3d-layer">
                          <input type="checkbox" className="chk" checked={layerShown(d, l.layer)} onChange={(e) => setIfcLayerOn((s) => ({ ...s, [`${d.id}|${l.layer}`]: e.target.checked }))} />
                          <span className="t3d-chip" style={{ background: l.color !== undefined && ifcOwnColors ? hexCss(l.color) : colorFor(l.layer) }} aria-hidden="true" />
                          <span className="t3d-name">{l.layer}</span>
                          <span className="muted small">{Math.round(l.tris).toLocaleString('nb-NO')}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {ifcs.length > 0 && (
              <>
                <label className="t3d-check" title="Bruker fargene som ligger i IFC-filen (overflatestiler). Av = standardfarger per type objekt.">
                  <input type="checkbox" className="chk" checked={ifcOwnColors} onChange={(e) => setIfcOwnColors(e.target.checked)} />
                  <span className="t3d-name">Farger fra IFC-filen</span>
                </label>
                <label className="t3d-check" title="Tegner tynne kantlinjer langs knekk i modellen, slik at detaljer synes tydeligere. Hoppes over i svært store modeller.">
                  <input type="checkbox" className="chk" checked={ifcEdges} onChange={(e) => setIfcEdges(e.target.checked)} />
                  <span className="t3d-name">Kantlinjer (detaljer)</span>
                </label>
              </>
            )}
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
