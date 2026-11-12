// Leser georeferert ortofoto (GeoTIFF fra drone, f.eks. fra DJI Terra, Pix4D, Metashape)
// og reprojiserer det til Web Mercator slik at det ligger nøyaktig i kartet.
import { fromBlob } from 'geotiff';
import { ensureCrs, transform } from './crs';

export interface OrthoResult {
  image: Blob;
  bounds: [[number, number], [number, number]];
  crs: string;
  resolution: number | null;
  sourceSize: [number, number];
  crsDetected: boolean;
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

/**
 * @param maxSize største side i pikselbildet som lagres i nettleseren.
 *  Store ortofoto (flere GB) bør i en produksjonsløsning tiles på serveren – se README.
 */
export async function processOrtho(
  file: File,
  fallbackCrs: string,
  onProgress?: (msg: string) => void,
  maxSize = 4096,
): Promise<OrthoResult> {
  onProgress?.('Leser GeoTIFF …');
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] i kildesystemet
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

  onProgress?.(`Laster piksler (${sw}×${sh}) …`);
  const raw: any = await src.readRGB({ width: sw, height: sh, interleave: true, enableAlpha: true } as any);
  const channels = Math.round(raw.length / (sw * sh));
  const noData = image.getGDALNoData();

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
      const si = (syp * sw + sxp) * channels;
      const r = raw[si], g = raw[si + 1] ?? r, bl = raw[si + 2] ?? r;
      let alpha = channels >= 4 ? raw[si + 3] : 255;
      if (noData !== null && noData !== undefined && r === noData && g === noData && bl === noData) alpha = 0;
      o[oi] = r; o[oi + 1] = g; o[oi + 2] = bl; o[oi + 3] = alpha;
    }
  }
  ctx.putImageData(out, 0, 0);

  onProgress?.('Lagrer bilde …');
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kunne ikke lage bilde'))), 'image/webp', 0.9),
  );

  const [west, south] = transform('EPSG:3857', 'EPSG:4326', mx0, my0);
  const [east, north] = transform('EPSG:3857', 'EPSG:4326', mx1, my1);
  const projected = crs !== 'EPSG:4326';

  return {
    image: blob,
    bounds: [[south, west], [north, east]],
    crs,
    resolution: projected ? (x1 - x0) / w : null,
    sourceSize: [w, h],
    crsDetected: !!detected,
  };
}

export function isTiff(f: File) {
  return /\.(tif|tiff)$/i.test(f.name) || /tiff/i.test(f.type);
}
