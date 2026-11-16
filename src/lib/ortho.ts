// Leser georeferert ortofoto (GeoTIFF eller JPEG 2000 fra drone, f.eks. fra DJI Terra, Pix4D, Metashape)
// og reprojiserer det til Web Mercator slik at det ligger nøyaktig i kartet.
import * as GeoTIFF from 'geotiff';

const fromBlob = GeoTIFF.fromBlob;
import { ensureCrs, transform } from './crs';
import { decodeJp2, inspectJp2, isJp2 } from './jp2';

export interface OrthoResult {
  image: Blob;
  bounds: [[number, number], [number, number]];
  crs: string;
  resolution: number | null;
  sourceSize: [number, number];
  crsDetected: boolean;
  /** Lite bilde (maks 2048 px) som vises når kartet er zoomet langt ut – mye raskere å panorere */
  preview?: Blob;
}

function detectCrs(keys: any): string | null {
  if (!keys) return null;
  const p = keys.ProjectedCSTypeGeoKey;
  if (p && p !== 32767) {
    const code = `EPSG:${p}`;
    if (ensureCrs(code)) return code;
  }
  const g = keys.GeographicTypeGeoKey;
  if (!p && (g === 4326 || g === 4258)) return 'EPSG:4326';
  return null;
}

interface Raster {
  raw: ArrayLike<number>;
  channels: number;
  sw: number;
  sh: number;
  bbox: [number, number, number, number];
  crs: string;
  crsDetected: boolean;
  noData: number | null | undefined;
  sourceSize: [number, number];
}

async function readTiff(file: File, fallbackCrs: string, maxSize: number, onProgress?: (m: string) => void): Promise<Raster> {
  onProgress?.('Leser GeoTIFF …');
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const bbox = image.getBoundingBox() as [number, number, number, number]; // [minX, minY, maxX, maxY] i kildesystemet
  const detected = detectCrs(image.getGeoKeys());
  const crs = detected ?? fallbackCrs;
  ensureCrs(crs);

  const scale = Math.min(1, maxSize / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));

  // Bruk innebygde oversiktsbilder (overviews / COG) hvis de finnes – mye raskere for store filer
  let src = image;
  try {
    const count = await tiff.getImageCount();
    for (let k = 1; k < count; k++) {
      const ov = await tiff.getImage(k);
      if (ov.getSamplesPerPixel() === image.getSamplesPerPixel() && ov.getWidth() >= sw && ov.getWidth() < src.getWidth()) src = ov;
    }
  } catch {
    src = image;
  }

  // Avkoding (komprimerte TIFF-er) er tung. Bruk flere arbeidstråder (Pool) slik at siden ikke fryser og det går raskere.
  const t0 = Date.now();
  const base = `Laster piksler (${sw}×${sh})`;
  onProgress?.(`${base} …`);
  const tick = window.setInterval(() => onProgress?.(`${base} … ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
  let raw: any;
  try {
    let pool: any = null;
    try {
      const PoolCtor = (GeoTIFF as any).Pool;
      const threads = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
      pool = PoolCtor ? new PoolCtor(threads) : null;
    } catch {
      pool = null;
    }
    const opts: any = { width: sw, height: sh, interleave: true, enableAlpha: true, resampleMethod: 'nearest' };
    try {
      raw = await src.readRGB(pool ? { ...opts, pool } : opts);
    } catch (e) {
      if (!pool) throw e;
      raw = await src.readRGB(opts); // arbeidstråder feilet – prøv uten
    } finally {
      try { pool?.destroy?.(); } catch { /* ignorer */ }
    }
  } finally {
    window.clearInterval(tick);
  }
  const channels = Math.round(raw.length / (sw * sh));
  return { raw, channels, sw, sh, bbox, crs, crsDetected: !!detected, noData: image.getGDALNoData(), sourceSize: [w, h] };
}

async function readJp2(file: File, fallbackCrs: string, maxSize: number, sidecar: File | undefined, onProgress?: (m: string) => void): Promise<Raster> {
  onProgress?.('Leser JPEG 2000 …');
  const buf = await file.arrayBuffer();
  const info = await inspectJp2(buf, sidecar ? await sidecar.text() : undefined);
  if (!info.geo) {
    throw new Error('JP2: fant ingen georeferanse i filen. Legg ved world file (.j2w, .jgw eller .wld) med samme filnavn, eller konverter til GeoTIFF.');
  }
  const crs = info.geo.crs ?? fallbackCrs;
  ensureCrs(crs);
  onProgress?.('Avkoder JPEG 2000 (første gang lastes avkoderen) …');
  const px = await decodeJp2(buf, maxSize);
  return {
    raw: px.rgba, channels: px.channels, sw: px.width, sh: px.height,
    bbox: info.geo.bbox, crs, crsDetected: !!info.geo.crs, noData: null, sourceSize: [info.width, info.height],
  };
}

/** Største side (piksler) på ortofotoet som lagres. 6144 gir god skarphet uten at kartet blir tregt; små enheter med lite minne får 4096. */
function defaultMaxSize(): number {
  const mem = (navigator as any).deviceMemory as number | undefined; // GB, bare oppgitt i Chromium
  return mem !== undefined && mem < 4 ? 4096 : 6144;
}

/**
 * @param maxSize største side i pikselbildet som lagres i nettleseren.
 *  Store ortofoto (flere GB) bør i en produksjonsløsning tiles på serveren – se README.
 * @param sidecar world file (.j2w/.jgw/.wld) for JP2 uten innebygd georeferanse
 */
export async function processOrtho(
  file: File,
  fallbackCrs: string,
  onProgress?: (msg: string) => void,
  sidecar?: File,
  maxSize = defaultMaxSize(),
): Promise<OrthoResult> {
  const r = isJp2(file)
    ? await readJp2(file, fallbackCrs, maxSize, sidecar, onProgress)
    : await readTiff(file, fallbackCrs, maxSize, onProgress);
  const { raw, channels, sw, sh, bbox, crs, noData } = r;
  const w = r.sourceSize[0];
  const detected = r.crsDetected;

  // Utstrekning i Web Mercator: sample langs kantene
  onProgress?.('Reprojiserer …');
  const [x0, y0, x1, y1] = bbox;
  let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    for (const [x, y] of [[x0 + (x1 - x0) * t, y0], [x0 + (x1 - x0) * t, y1], [x0, y0 + (y1 - y0) * t], [x1, y0 + (y1 - y0) * t]]) {
      const [mx, my] = transform(crs, 'EPSG:3857', x, y);
      mx0 = Math.min(mx0, mx); my0 = Math.min(my0, my); mx1 = Math.max(mx1, mx); my1 = Math.max(my1, my);
    }
  }
  if (!Number.isFinite(mx0)) throw new Error('Fant ikke gyldig georeferering i filen');

  const outW = sw;
  const outH = Math.max(1, Math.min(maxSize * 2, Math.round(sw * ((my1 - my0) / (mx1 - mx0)))));

  // Kontrollpunkt-rutenett: transformér et 33×33 rutenett og interpoler mellom punktene (raskt og nøyaktig nok)
  const G = 32;
  const gx = new Float64Array((G + 1) * (G + 1));
  const gy = new Float64Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++) {
      const mx = mx0 + ((mx1 - mx0) * i) / G;
      const my = my1 - ((my1 - my0) * j) / G;
      const [sx, sy] = transform('EPSG:3857', crs, mx, my);
      gx[j * (G + 1) + i] = ((sx - x0) / (x1 - x0)) * sw;
      gy[j * (G + 1) + i] = ((y1 - sy) / (y1 - y0)) * sh;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(outW, outH);
  const o = out.data;

  for (let y = 0; y < outH; y++) {
    if (y % 256 === 0 && y > 0) { onProgress?.(`Reprojiserer … ${Math.round((y / outH) * 100)} %`); await new Promise((res) => setTimeout(res, 0)); }
    const fy = (y / (outH - 1 || 1)) * G;
    const j = Math.min(G - 1, Math.floor(fy));
    const ty = fy - j;
    for (let x = 0; x < outW; x++) {
      const fx = (x / (outW - 1 || 1)) * G;
      const i = Math.min(G - 1, Math.floor(fx));
      const tx = fx - i;
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      const px = (gx[a] * (1 - tx) + gx[b] * tx) * (1 - ty) + (gx[c] * (1 - tx) + gx[d] * tx) * ty;
      const py = (gy[a] * (1 - tx) + gy[b] * tx) * (1 - ty) + (gy[c] * (1 - tx) + gy[d] * tx) * ty;
      const sxp = px | 0, syp = py | 0;
      const oi = (y * outW + x) * 4;
      if (px < 0 || py < 0 || sxp >= sw || syp >= sh) { o[oi + 3] = 0; continue; }
      // Utbildet har omtrent samme piksler som originalen, så nærmeste nabo gir full skarphet og er raskest
      const si = (syp * sw + sxp) * channels;
      const r = raw[si], g = raw[si + 1] ?? r, bl = raw[si + 2] ?? r;
      let alpha = channels >= 4 ? raw[si + 3] : 255;
      if (noData !== null && noData !== undefined && r === noData && g === noData && bl === noData) alpha = 0;
      o[oi] = r; o[oi + 1] = g; o[oi + 2] = bl; o[oi + 3] = alpha;
    }
  }
  ctx.putImageData(out, 0, 0);

  onProgress?.('Lager forhåndsvisning …');
  let preview: Blob | undefined;
  try {
    const k = Math.min(1, 2048 / Math.max(outW, outH));
    if (k < 1) {
      const pc = document.createElement('canvas');
      pc.width = Math.max(1, Math.round(outW * k)); pc.height = Math.max(1, Math.round(outH * k));
      const pctx = pc.getContext('2d')!;
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(canvas, 0, 0, pc.width, pc.height);
      preview = await new Promise<Blob>((resolve, reject) => pc.toBlob((bb) => (bb ? resolve(bb) : reject(new Error('preview'))), 'image/webp', 0.88));
    }
  } catch { preview = undefined; }

  onProgress?.('Lagrer bilde …');
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kunne ikke lage bilde'))), 'image/webp', 0.95),
  );

  const [west, south] = transform('EPSG:3857', 'EPSG:4326', mx0, my0);
  const [east, north] = transform('EPSG:3857', 'EPSG:4326', mx1, my1);
  const projected = crs !== 'EPSG:4326';

  return {
    image: blob,
    bounds: [[south, west], [north, east]],
    crs,
    resolution: projected ? (x1 - x0) / w : null,
    sourceSize: r.sourceSize,
    crsDetected: detected,
    preview,
  };
}

export function isTiff(f: File) {
  return /\.(tif|tiff)$/i.test(f.name) || /tiff/i.test(f.type);
}

/** GeoTIFF eller JPEG 2000 */
export function isOrthoFile(f: File) {
  return isTiff(f) || isJp2(f);
}
