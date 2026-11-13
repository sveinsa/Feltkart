// JPEG 2000 (.jp2): leser georeferanse og pikseldata.
// Georeferanse hentes fra (i denne rekkefølgen): GeoJP2 (GeoTIFF-tagger i en UUID-boks),
// GMLJP2 (XML-boks) eller en world file ved siden av (.j2w / .jgw / .wld).
// Selve avkodingen gjøres av OpenJPEG (WebAssembly), som lastes fra CDN første gang det trengs.
import { fromArrayBuffer } from 'geotiff';
import { ensureCrs } from './crs';

export interface Jp2Geo {
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY] i kildesystemet
  crs: string | null;
  source: 'GeoJP2' | 'GMLJP2' | 'world file';
}

interface Box {
  type: string;
  start: number; // første byte i innholdet
  end: number;
}

const fourcc = (dv: DataView, p: number) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));

function* boxes(dv: DataView, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let len = dv.getUint32(p);
    const type = fourcc(dv, p + 4);
    let hdr = 8;
    if (len === 1) {
      if (p + 16 > end) return;
      len = Number(dv.getBigUint64(p + 8));
      hdr = 16;
    } else if (len === 0) {
      len = end - p;
    }
    if (len < hdr || p + len > end) return;
    yield { type, start: p + hdr, end: p + len };
    p += len;
  }
}

// UUID for GeoJP2: b14bf8bd-083d-4b43-a5ae-8cd7d5a6ce03
const GEOJP2_UUID = [0xb1, 0x4b, 0xf8, 0xbd, 0x08, 0x3d, 0x4b, 0x43, 0xa5, 0xae, 0x8c, 0xd7, 0xd5, 0xa6, 0xce, 0x03];

function epsgFrom(code: unknown): string | null {
  const n = Number(code);
  if (!n || n === 32767) return null;
  const c = `EPSG:${n}`;
  return ensureCrs(c) ? c : null;
}

async function readGeoJp2(buf: ArrayBuffer, b: Box, width: number, height: number): Promise<Jp2Geo | null> {
  const dv = new DataView(buf);
  for (let i = 0; i < 16; i++) if (dv.getUint8(b.start + i) !== GEOJP2_UUID[i]) return null;
  const tiff = await fromArrayBuffer(buf.slice(b.start + 16, b.end));
  const image = await tiff.getImage();
  const fd: any = image.getFileDirectory();
  const keys: any = image.getGeoKeys();
  let x0: number, y1: number, sx: number, sy: number;
  if (fd.ModelTransformation && fd.ModelTransformation.length >= 8) {
    const m = fd.ModelTransformation;
    sx = m[0]; sy = -m[5]; x0 = m[3]; y1 = m[7];
  } else if (fd.ModelTiepoint && fd.ModelPixelScale) {
    const [i, j, , x, y] = fd.ModelTiepoint;
    sx = fd.ModelPixelScale[0]; sy = fd.ModelPixelScale[1];
    x0 = x - i * sx; y1 = y + j * sy;
  } else return null;
  // GeoTIFF "PixelIsPoint": referansepunktet er midten av piksel
  if (keys?.GTRasterTypeGeoKey === 2) { x0 -= sx / 2; y1 += sy / 2; }
  let crs = epsgFrom(keys?.ProjectedCSTypeGeoKey);
  if (!crs && (keys?.GeographicTypeGeoKey === 4326 || keys?.GeographicTypeGeoKey === 4258)) crs = 'EPSG:4326';
  return { bbox: [x0, y1 - height * sy, x0 + width * sx, y1], crs, source: 'GeoJP2' };
}

function readGmlJp2(xml: string, width: number, height: number): Jp2Geo | null {
  const pos = /<gml:pos>\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*<\/gml:pos>/.exec(xml) ?? /<gml:coordinates>\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)/.exec(xml);
  const vecs = [...xml.matchAll(/<gml:offsetVector[^>]*>\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*<\/gml:offsetVector>/g)];
  if (!pos || vecs.length < 2) return null;
  const srs = /srsName="([^"]+)"/.exec(xml)?.[1] ?? '';
  const code = /(?:EPSG[:/]+(?:\d+(?:\.\d+)*[:/]+)?|crs:EPSG:[^:]*:)(\d{4,6})\s*$/.exec(srs)?.[1] ?? /(\d{4,6})\s*$/.exec(srs)?.[1];
  const crs = epsgFrom(code);
  // Geografiske systemer har ofte bredde før lengde – ikke støttet her
  if (!crs && /4326|4258/.test(srs)) return null;
  const [px, py] = [+pos[1], +pos[2]];
  const v1 = [+vecs[0][1], +vecs[0][2]];
  const v2 = [+vecs[1][1], +vecs[1][2]];
  const dx = v1[0] !== 0 ? v1[0] : v2[0];
  const dy = v2[1] !== 0 ? v2[1] : v1[1];
  if (!dx || !dy) return null;
  const sx = Math.abs(dx), sy = Math.abs(dy);
  // GDAL skriver origo som midten av øverste venstre piksel
  const x0 = px - sx / 2, y1 = py + sy / 2;
  return { bbox: [x0, y1 - height * sy, x0 + width * sx, y1], crs, source: 'GMLJP2' };
}

export function parseWorldFile(text: string, width: number, height: number): Jp2Geo | null {
  const n = text.split(/\r?\n/).map((l) => parseFloat(l.trim())).filter((v) => Number.isFinite(v));
  if (n.length < 6) return null;
  const [a, , , e, c, f] = n; // a = pikselbredde, e = pikselhøyde (negativ), c/f = midten av øverste venstre piksel
  if (!a || !e) return null;
  const sx = Math.abs(a), sy = Math.abs(e);
  const x0 = c - sx / 2, y1 = f + sy / 2;
  return { bbox: [x0, y1 - height * sy, x0 + width * sx, y1], crs: null, source: 'world file' };
}

export interface Jp2Info {
  width: number;
  height: number;
  geo: Jp2Geo | null;
}

export async function inspectJp2(buf: ArrayBuffer, worldFileText?: string): Promise<Jp2Info> {
  const dv = new DataView(buf);
  let width = 0, height = 0;
  const xmls: string[] = [];
  const uuids: Box[] = [];

  const dec = new TextDecoder('utf-8');
  const walk = (start: number, end: number, depth: number) => {
    for (const b of boxes(dv, start, end)) {
      if (b.type === 'jp2h') {
        for (const h of boxes(dv, b.start, b.end)) {
          if (h.type === 'ihdr') { height = dv.getUint32(h.start); width = dv.getUint32(h.start + 4); }
        }
      } else if (b.type === 'uuid') uuids.push(b);
      else if (b.type === 'xml ' && b.end - b.start < 5_000_000) xmls.push(dec.decode(new Uint8Array(buf, b.start, b.end - b.start)));
      else if ((b.type === 'asoc' || b.type === 'gml ') && depth < 3) walk(b.start, b.end, depth + 1);
    }
  };
  walk(0, buf.byteLength, 0);
  if (!width || !height) throw new Error('JP2: ugyldig fil (fant ikke bildestørrelse)');

  let geo: Jp2Geo | null = null;
  for (const u of uuids) {
    try { geo = await readGeoJp2(buf, u, width, height); } catch { geo = null; }
    if (geo) break;
  }
  if (!geo) for (const x of xmls) { geo = readGmlJp2(x, width, height); if (geo) break; }
  if (!geo && worldFileText) geo = parseWorldFile(worldFileText, width, height);
  return { width, height, geo };
}

// ---------- Avkoding (OpenJPEG / WebAssembly) ----------

const OPENJPEG_BASES = [
  'https://cdn.jsdelivr.net/npm/@cornerstonejs/codec-openjpeg@1.3.0/dist/',
  'https://unpkg.com/@cornerstonejs/codec-openjpeg@1.3.0/dist/',
];
let codecPromise: Promise<any> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error(`Kunne ikke laste ${src}`)); };
    document.head.appendChild(s);
  });
}

async function loadCodec(): Promise<any> {
  if (!codecPromise) {
    codecPromise = (async () => {
      let lastErr: unknown;
      for (const base of OPENJPEG_BASES) {
        try {
          if (!(window as any).OpenJPEGWASM) await loadScript(base + 'openjpegwasm_decode.js');
          const factory = (window as any).OpenJPEGWASM;
          if (!factory) throw new Error('OpenJPEG ble lastet, men fant ikke avkoderen');
          return await factory({ locateFile: (f: string) => base + f });
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(`JP2: kunne ikke laste avkoderen (trenger internett første gang). ${String((lastErr as any)?.message ?? lastErr)}`);
    })();
    codecPromise.catch(() => { codecPromise = null; });
  }
  return codecPromise;
}

export interface Jp2Pixels {
  rgba: Uint8ClampedArray | Uint8Array;
  channels: number; // 4 = RGBA
  width: number;
  height: number;
}

/**
 * Avkoder JP2 til 8-bit RGBA. Hvis filen har oppløsningsnivåer brukes det laveste nivået som fortsatt
 * gir minst `target` piksler på lengste side, så store ortofoto ikke sprenger minnet.
 */
export async function decodeJp2(buf: ArrayBuffer, target: number): Promise<Jp2Pixels> {
  const codec = await loadCodec();
  const dec = new codec.J2KDecoder();
  try {
    const enc: Uint8Array = dec.getEncodedBuffer(buf.byteLength);
    enc.set(new Uint8Array(buf));

    // Maks antall piksler vi tør å avkode i nettleseren (RGBA ≈ 4 byte/piksel, pluss kopier i WASM-minnet)
    const MAX_PIXELS = 64e6;
    const canSub = typeof dec.readHeader === 'function' && typeof dec.decodeSubResolution === 'function' && typeof dec.calculateSizeAtDecompositionLevel === 'function';
    if (canSub) {
      dec.readHeader();
      const levels: number = Math.max(0, dec.getNumDecompositions?.() ?? 0);
      // Kandidater fra mest reduserte (minst) til minst reduserte. Start ved det grovest nivået
      // som fortsatt gir minst «target» piksler langs lengste side.
      const sizeAt = (l: number) => dec.calculateSizeAtDecompositionLevel(l) as { width: number; height: number };
      let start = levels;
      for (let l = levels; l >= 0; l--) {
        const sz = sizeAt(l);
        if (Math.max(sz.width, sz.height) >= target) { start = l; break; }
        start = l;
      }
      let ok = false;
      let lastErr: unknown = null;
      // Prøv først valgt nivå, deretter grovere nivåer hvis det feiler (aldri finere enn valgt)
      for (let l = start; l <= levels; l++) {
        const sz = sizeAt(l);
        if (sz.width * sz.height > MAX_PIXELS) continue;
        try { dec.decodeSubResolution(l, 0); ok = true; break; } catch (e) { lastErr = e; }
      }
      if (!ok) {
        throw new Error(`JP2: filen kunne ikke avkodes i redusert oppløsning${lastErr ? ` (${String((lastErr as any)?.message ?? lastErr)})` : ''}. Konverter til GeoTIFF/COG med QGIS eller GDAL.`);
      }
    } else {
      // Gammel kodek uten delvis avkoding: kun forsvarlig for små filer
      if (buf.byteLength > 40e6) throw new Error('JP2: filen er for stor for denne nettleserkodeken. Konverter til GeoTIFF/COG med QGIS eller GDAL.');
      dec.decode();
    }

    const info = dec.getFrameInfo();
    const out: Uint8Array = dec.getDecodedBuffer();
    const { width, height, bitsPerSample, componentCount, isSigned } = info;
    const n = width * height;
    const shift = Math.max(0, bitsPerSample - 8);
    const bytes = bitsPerSample > 8 ? 2 : 1;
    const view = bytes === 2
      ? (isSigned ? new Int16Array(out.buffer, out.byteOffset, n * componentCount) : new Uint16Array(out.buffer, out.byteOffset, n * componentCount))
      : out;
    const bias = isSigned ? (bytes === 2 ? 32768 : 128) : 0;
    const rgba = new Uint8ClampedArray(n * 4);
    const comp = Math.min(componentCount, 4);
    for (let i = 0; i < n; i++) {
      const o = i * 4, s = i * componentCount;
      const v = (k: number) => ((view[s + k] as number) + bias) >> shift;
      if (comp >= 3) { rgba[o] = v(0); rgba[o + 1] = v(1); rgba[o + 2] = v(2); rgba[o + 3] = comp === 4 ? v(3) : 255; }
      else { const g = v(0); rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255; }
    }
    return { rgba, channels: 4, width, height };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/^JP2/.test(msg)) throw e;
    throw new Error(`JP2: kunne ikke avkode bildet (${msg}). Filen kan være for stor for nettleseren. Konverter til GeoTIFF/COG med QGIS eller GDAL.`);
  } finally {
    try { dec.delete(); } catch { /* ignorer */ }
  }
}

export function isJp2(f: File) {
  return /\.(jp2|j2k|jpx)$/i.test(f.name) || /jp2|jpx/i.test(f.type);
}

export function isWorldFile(f: File) {
  return /\.(j2w|jgw|wld|jp2w)$/i.test(f.name);
}
