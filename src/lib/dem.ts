// Terrenghøyder til tverrsnitt i 2D-kartet. Leser de samme høydeflisene (Terrarium-koding) som 3D-visningen bruker,
// men direkte, uten kart: flisene hentes, dekodes og leses av med bilineær interpolasjon.

export interface DemSource { tiles: string; tileSize: number; maxzoom: number; label: string }

const MAPTERHORN_JSON = 'https://tiles.mapterhorn.com/tilejson.json';
const AWS: DemSource = { tiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', tileSize: 256, maxzoom: 15, label: 'AWS Terrain Tiles' };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const t = window.setTimeout(() => rej(new Error('tidsavbrudd')), ms); p.then((v) => { window.clearTimeout(t); res(v); }, (e) => { window.clearTimeout(t); rej(e); }); });
}

/** Fliseadressene for Mapterhorn (Norge i 1 m) leses fra TileJSON, og AWS brukes hvis det ikke går */
async function resolveSources(): Promise<DemSource[]> {
  const list: DemSource[] = [];
  try {
    const r = await withTimeout(fetch(MAPTERHORN_JSON), 7000);
    if (r.ok) {
      const j = await r.json() as { tiles?: string[]; tileSize?: number; maxzoom?: number };
      if (j.tiles?.[0]) list.push({ tiles: j.tiles[0], tileSize: j.tileSize ?? 512, maxzoom: Math.min(17, j.maxzoom ?? 17), label: 'Mapterhorn' });
    }
  } catch { /* prøver AWS */ }
  list.push(AWS);
  return list;
}

interface Tile { w: number; h: number; data: Uint8ClampedArray }
const tileCache = new Map<string, Promise<Tile | null>>();

async function loadTile(src: DemSource, z: number, x: number, y: number): Promise<Tile | null> {
  const url = src.tiles.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  let p = tileCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const r = await withTimeout(fetch(url, { mode: 'cors' }), 12000);
        if (!r.ok) return null;
        const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      } catch { return null; }
    })();
    tileCache.set(url, p);
  }
  const t = await p;
  if (!t) tileCache.delete(url); // prøv på nytt neste gang
  return t;
}

const tileX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export type TerrainFn = (lng: number, lat: number) => number | null;

/**
 * Henter høydeflisene langs en linje og gir en funksjon som leser terrenghøyde (m o.h.) for et punkt, eller null.
 * `source` sier hvilken kilde som ble brukt (eller null hvis ingen fliser kunne hentes).
 */
export async function loadTerrain(points: { lng: number; lat: number }[]): Promise<{ at: TerrainFn; source: string | null }> {
  if (!points.length) return { at: () => null, source: null };
  const none = { at: (() => null) as TerrainFn, source: null };
  for (const src of await resolveSources()) {
    // Høyeste zoom som gir et rimelig antall fliser
    let z = src.maxzoom;
    const lo = (zz: number) => [Math.floor(Math.min(...points.map((p) => tileX(p.lng, zz)))), Math.floor(Math.min(...points.map((p) => tileY(p.lat, zz))))];
    const hi = (zz: number) => [Math.floor(Math.max(...points.map((p) => tileX(p.lng, zz)))), Math.floor(Math.max(...points.map((p) => tileY(p.lat, zz))))];
    const count = (zz: number) => { const a = lo(zz), b = hi(zz); return (b[0] - a[0] + 1) * (b[1] - a[1] + 1); };
    while (z > 6 && count(z) > 12) z--;
    const a = lo(z), b = hi(z);
    const jobs: Promise<[string, Tile | null]>[] = [];
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) jobs.push(loadTile(src, z, x, y).then((t): [string, Tile | null] => [`${x}/${y}`, t]));
    const tiles = new Map(await Promise.all(jobs));
    if (![...tiles.values()].some(Boolean)) continue;
    const at: TerrainFn = (lng, lat) => {
      const fx = tileX(lng, z), fy = tileY(lat, z);
      const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!t) return null;
      const px = (fx - Math.floor(fx)) * t.w - 0.5, py = (fy - Math.floor(fy)) * t.h - 0.5;
      const x0 = Math.max(0, Math.min(t.w - 1, Math.floor(px))), y0 = Math.max(0, Math.min(t.h - 1, Math.floor(py)));
      const x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1);
      const ax = Math.max(0, Math.min(1, px - x0)), ay = Math.max(0, Math.min(1, py - y0));
      const h = (x: number, y: number) => { const i = (y * t.w + x) * 4; return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768; };
      const v = h(x0, y0) * (1 - ax) * (1 - ay) + h(x1, y0) * ax * (1 - ay) + h(x0, y1) * (1 - ax) * ay + h(x1, y1) * ax * ay;
      return Number.isFinite(v) && v > -500 && v < 9000 ? v : null;
    };
    return { at, source: src.label };
  }
  return none;
}

/** Terrarium-koding av en høyde (brukes i testene) */
export function encodeTerrarium(h: number): [number, number, number] {
  const v = h + 32768;
  const r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.floor((v - Math.floor(v)) * 256);
  return [r, g, b];
}
