// SOSI-format (Kartverket). Støtter punkt, sverm, kurve, bue (BUEP), flate (via ..REF), trase og tekst.
import { arcThrough, Builder, type LL, type XYZ } from './builder';
import type { ParsedDxf } from '../dxf';
import { ensureCrs } from '../crs';

interface Obj {
  type: string;
  id: number;
  attrs: Record<string, string>;
  raw: number[][];
  kind: string; // NØ, NØH …
  refs: string;
  pts?: XYZ[];
}

// SYSKODE i ..KOORDSYS (EUREF89/WGS84 UTM). Andre koder (ED50, NGO, lokale nett) kan ikke omregnes sikkert her.
const KOORDSYS_TO_CRS: Record<number, string> = {
  21: 'EPSG:25831', 22: 'EPSG:25832', 23: 'EPSG:25833', 24: 'EPSG:25834', 25: 'EPSG:25835', 26: 'EPSG:25836',
};

function stripComment(line: string): string {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === '!' && !q) return line.slice(0, i);
  }
  return line;
}

export function parseSosi(text: string, crs: string, mkLl: (crs: string) => LL, detect: boolean): ParsedDxf {
  const objs: Obj[] = [];
  const head: Record<string, string> = {};
  let cur: Obj | null = null;
  let inHead = false;
  let coordMode = false;
  let lastKey = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (line[0] === '.') {
      if (line.startsWith('...')) {
        const m = /^\.\.\.(\S+)\s*(.*)$/.exec(line);
        if (m && inHead) head[m[1]] = m[2];
        continue; // ...KP og andre underegenskaper
      }
      if (line.startsWith('..')) {
        const m = /^\.\.(\S+)\s*(.*)$/.exec(line);
        if (!m || !cur) continue;
        lastKey = m[1];
        if (/^NØ[HD]*$/.test(m[1])) {
          cur.kind = m[1];
          coordMode = true;
          if (m[2]) pushCoords(cur, m[2]);
        } else {
          coordMode = false;
          if (m[1] === 'REF') cur.refs = m[2];
          else cur.attrs[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
        }
        continue;
      }
      const m = /^\.([^\s:\d]+)\s*(\d+)?\s*:?/.exec(line);
      if (!m) continue;
      const type = m[1].toUpperCase();
      coordMode = false; lastKey = '';
      if (type === 'HODE') { inHead = true; cur = null; continue; }
      if (type === 'SLUTT') break;
      inHead = false;
      cur = { type, id: m[2] ? +m[2] : -1, attrs: {}, raw: [], kind: 'NØ', refs: '' };
      objs.push(cur);
      continue;
    }
    if (!cur) continue;
    if (coordMode) pushCoords(cur, line);
    else if (lastKey === 'REF') cur.refs += ' ' + line;
  }

  function pushCoords(o: Obj, s: string) {
    const v = s.trim().split(/\s+/).map(Number);
    const stride = /H$|D$/.test(o.kind) ? 3 : 2;
    for (let i = 0; i + 1 < v.length; i += stride) {
      const row = v.slice(i, i + stride);
      if (row.every(Number.isFinite)) o.raw.push(row);
    }
  }

  // ----- hode: koordinatsystem og enhet -----
  let useCrs = crs;
  const warn: string[] = [];
  const ks = parseInt((head['KOORDSYS'] ?? '').trim(), 10);
  if (Number.isFinite(ks)) {
    const c = KOORDSYS_TO_CRS[ks];
    if (c && detect) { useCrs = c; ensureCrs(c); }
    else if (!c) warn.push(`SOSI-filen bruker koordinatsystem-kode ${ks}, som ikke kan leses direkte. Brukte ${crs}. Kontroller at plasseringen stemmer.`);
  }
  const enhet = parseFloat(head['ENHET'] ?? '1') || 1;
  const enhetH = parseFloat(head['ENHET-H'] ?? '') || enhet;
  const origo = (head['ORIGO-NØ'] ?? '0 0').trim().split(/\s+/).map(Number);
  const o0 = Number.isFinite(origo[0]) ? origo[0] : 0, o1 = Number.isFinite(origo[1]) ? origo[1] : 0;

  const b = new Builder(mkLl(useCrs));
  b.warnings.push(...warn);

  const toXYZ = (r: number[]): XYZ => [o1 + r[1] * enhet, o0 + r[0] * enhet, r.length > 2 ? r[2] * enhetH : NaN];
  for (const o of objs) o.pts = o.raw.map(toXYZ);

  const layerOf = (o: Obj) => (o.attrs['OBJTYPE'] || o.type.charAt(0) + o.type.slice(1).toLowerCase());
  const attrsOf = (o: Obj) => {
    const a: Record<string, string> = {};
    let n = 0;
    for (const [k, v] of Object.entries(o.attrs)) { if (v && n < 12) { a[k] = v; n++; } }
    return a;
  };
  const geomPts = (o: Obj): XYZ[] => {
    const p = o.pts ?? [];
    if (o.type === 'BUEP' && p.length === 3) return arcThrough(p[0], p[1], p[2]);
    return p;
  };

  const byId = new Map<number, Obj>();
  for (const o of objs) if (o.id >= 0 && ['KURVE', 'BUEP', 'TRASE', 'KLOTOIDE', 'BEZIER', 'LINJE', 'RUNDING'].includes(o.type)) byId.set(o.id, o);

  let holes = 0;
  for (const o of objs) {
    const pts = o.pts ?? [];
    const layer = layerOf(o);
    switch (o.type) {
      case 'PUNKT':
        if (pts[0]) b.point(layer, 'SOSI punkt', pts[0], undefined, attrsOf(o));
        break;
      case 'SVERM':
        pts.forEach((p) => b.point(layer, 'SOSI sverm', p, undefined, attrsOf(o)));
        break;
      case 'TEKST': {
        const s = o.attrs['STRENG'];
        if (s && pts[0]) b.text(layer, 'SOSI tekst', pts[0], s);
        break;
      }
      case 'KURVE': case 'TRASE': case 'BUEP': case 'KLOTOIDE': case 'BEZIER': case 'LINJE': case 'RUNDING':
        b.line(layer, `SOSI ${o.type.toLowerCase()}`, geomPts(o), attrsOf(o));
        break;
      case 'FLATE': {
        const toks = o.refs.match(/[()]|:\s*-?\d+/g) ?? [];
        const ring: XYZ[] = [];
        let depth = 0, missing = 0;
        for (const t of toks) {
          if (t === '(') { depth++; continue; }
          if (t === ')') { depth = Math.max(0, depth - 1); continue; }
          if (depth > 0) { holes++; continue; } // hull støttes ikke i visningen
          const n = parseInt(t.replace(':', ''), 10);
          const ref = byId.get(Math.abs(n));
          if (!ref) { missing++; continue; }
          let seg = geomPts(ref).slice();
          if (n < 0) seg.reverse();
          if (ring.length && seg.length && ring[ring.length - 1][0] === seg[0][0] && ring[ring.length - 1][1] === seg[0][1]) seg = seg.slice(1);
          ring.push(...seg);
        }
        if (ring.length >= 3) b.polygon(layer, 'SOSI flate', ring, attrsOf(o));
        else if (!toks.length && pts.length >= 3) b.polygon(layer, 'SOSI flate', pts, attrsOf(o));
        else b.skip('flate uten gyldige grenser');
        if (missing) b.skip('flategrenser som mangler', missing);
        break;
      }
      default:
        if (pts.length) b.skip(`.${o.type}`);
    }
  }
  if (holes) b.warnings.push(`${holes} hull (øyer) i flater ble ikke tegnet.`);
  return b.finish(useCrs);
}
