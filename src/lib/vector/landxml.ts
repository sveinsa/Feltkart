// LandXML: punkter (CgPoints), trasé/plangeometri (Alignments, PlanFeatures, Parcels) og terrengmodell (Surfaces/TIN).
// Koordinater i LandXML står som nord, øst, høyde.
import { Builder, type LL, type XYZ } from './builder';
import type { ParsedDxf } from '../dxf';
import type { XNode } from './xml';
import { descendants, kid, kids, nums, parseXml } from './xml';
import { ensureCrs } from '../crs';

const pt = (n: XNode | undefined): XYZ | null => {
  if (!n) return null;
  const v = nums(n.text);
  return v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[1], v[0], v.length > 2 ? v[2] : NaN] : null;
};

/** Tegner en sirkelbue fra start til slutt rundt senter */
function arc(s: XYZ, c: XYZ, e: XYZ, cw: boolean): XYZ[] {
  const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  const a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  const TAU = Math.PI * 2;
  let sweep = cw ? (((a0 - a1) % TAU) + TAU) % TAU : (((a1 - a0) % TAU) + TAU) % TAU;
  if (sweep === 0) sweep = TAU;
  const n = Math.max(6, Math.ceil((sweep / TAU) * 72));
  const out: XYZ[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = cw ? a0 - sweep * t : a0 + sweep * t;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), Number.isFinite(s[2]) && Number.isFinite(e[2]) ? s[2] + (e[2] - s[2]) * t : NaN]);
  }
  return out;
}

/** Overgangskurve (klotoide) tilnærmet med en kvadratisk kurve via skjæringspunktet (PI) */
function spiral(s: XYZ, pi: XYZ, e: XYZ): XYZ[] {
  const out: XYZ[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    out.push([u * u * s[0] + 2 * u * t * pi[0] + t * t * e[0], u * u * s[1] + 2 * u * t * pi[1] + t * t * e[1], NaN]);
  }
  return out;
}

function coordGeom(cg: XNode): { pts: XYZ[]; closedHint: boolean } {
  const pts: XYZ[] = [];
  const push = (p: XYZ[]) => {
    for (const q of p) {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
  };
  for (const el of cg.children) {
    if (el.tag === 'Line') {
      const s = pt(kid(el, 'Start')), e = pt(kid(el, 'End'));
      if (s && e) push([s, e]);
    } else if (el.tag === 'Curve') {
      const s = pt(kid(el, 'Start')), e = pt(kid(el, 'End')), c = pt(kid(el, 'Center'));
      if (s && e && c) push(arc(s, c, e, (el.attrs.rot ?? 'ccw').toLowerCase() === 'cw'));
      else if (s && e) push([s, e]);
    } else if (el.tag === 'Spiral') {
      const s = pt(kid(el, 'Start')), e = pt(kid(el, 'End')), p = pt(kid(el, 'PI'));
      if (s && e && p) push(spiral(s, p, e));
      else if (s && e) push([s, e]);
    } else if (el.tag === 'IrregularLine') {
      const list = kid(el, 'PntList3D') ?? kid(el, 'PntList2D');
      if (list) {
        const v = nums(list.text), k = list.tag === 'PntList3D' ? 3 : 2;
        const row: XYZ[] = [];
        for (let i = 0; i + k <= v.length; i += k) row.push([v[i + 1], v[i], k === 3 ? v[i + 2] : NaN]);
        push(row);
      } else {
        const row = kids(el, 'Start').concat(kids(el, 'PI'), kids(el, 'End')).map(pt).filter(Boolean) as XYZ[];
        push(row);
      }
    }
  }
  return { pts, closedHint: false };
}

export function isLandXml(text: string): boolean {
  return /<\s*(\w+:)?LandXML[\s>]/i.test(text.slice(0, 5000));
}

export function parseLandXml(text: string, crs: string, mkLl: (crs: string) => LL, detect: boolean): ParsedDxf {
  const root = parseXml(text);
  const lx = kid(root, 'LandXML') ?? root.children[0];
  if (!lx || lx.tag !== 'LandXML') throw new Error('Filen er ikke en LandXML-fil.');

  let useCrs = crs;
  const cs = descendants(lx, 'CoordinateSystem')[0];
  const epsg = cs?.attrs.epsgCode ?? cs?.attrs.ogcWktCode;
  const m = epsg && /(\d{4,5})/.exec(epsg);
  const warn: string[] = [];
  if (m) {
    const code = `EPSG:${m[1]}`;
    if (detect && ensureCrs(code)) useCrs = code;
    else if (!ensureCrs(code)) warn.push(`LandXML oppgir koordinatsystem ${code}, som ikke støttes. Brukte ${crs}.`);
  }
  const unit = descendants(lx, 'Metric')[0]?.attrs.linearUnit ?? (descendants(lx, 'Imperial').length ? 'foot' : 'meter');
  if (!/met/i.test(unit)) warn.push(`LandXML bruker lengdeenhet «${unit}». Visningen antar meter.`);

  const b = new Builder(mkLl(useCrs));
  b.warnings.push(...warn);

  // Punkter
  for (const grp of descendants(lx, 'CgPoints')) {
    const gName = grp.attrs.name;
    for (const p of kids(grp, 'CgPoint')) {
      const xyz = pt(p);
      if (!xyz) { b.skip('punkt uten koordinat'); continue; }
      const code = p.attrs.code || p.attrs.desc || '';
      const attrs: Record<string, string> = { Punkt: p.attrs.name ?? '' };
      if (code) attrs.Kode = code;
      if (Number.isFinite(xyz[2])) attrs.Høyde = xyz[2].toFixed(3);
      if (p.attrs.timeStamp) attrs.Tid = p.attrs.timeStamp;
      b.point(gName || (code ? `Kode ${code}` : 'Punkter'), 'LandXML punkt', xyz,
        Number.isFinite(xyz[2]) ? `${p.attrs.name ?? ''}\n${xyz[2].toFixed(2)}` : p.attrs.name, attrs);
    }
  }

  // Trasé
  for (const al of descendants(lx, 'Alignment')) {
    const cg = kid(al, 'CoordGeom');
    if (!cg) continue;
    const { pts } = coordGeom(cg);
    b.line(`Trasé ${al.attrs.name ?? ''}`.trim(), 'LandXML trasé', pts, {
      Navn: al.attrs.name ?? '', ...(al.attrs.length ? { Lengde: al.attrs.length } : {}), ...(al.attrs.staStart ? { Startstasjon: al.attrs.staStart } : {}),
    });
  }

  // Plangeometri og eiendommer
  for (const pf of descendants(lx, 'PlanFeature')) {
    for (const cg of kids(pf, 'CoordGeom')) {
      const { pts } = coordGeom(cg);
      b.line(pf.attrs.name || 'Plangeometri', 'LandXML plangeometri', pts, { Navn: pf.attrs.name ?? '' });
    }
  }
  for (const pc of descendants(lx, 'Parcel')) {
    for (const cg of kids(pc, 'CoordGeom')) {
      const { pts } = coordGeom(cg);
      b.polygon(`Eiendom ${pc.attrs.name ?? ''}`.trim(), 'LandXML eiendom', pts, { Navn: pc.attrs.name ?? '' });
    }
  }

  // Terrengmodeller (TIN): kant og trekanter
  for (const sf of descendants(lx, 'Surface')) {
    const def = kid(sf, 'Definition');
    const pnts = kid(def, 'Pnts'), faces = kid(def, 'Faces');
    if (!pnts || !faces) continue;
    const P = new Map<string, XYZ>();
    for (const p of kids(pnts, 'P')) { const xyz = pt(p); if (xyz && p.attrs.id !== undefined) P.set(p.attrs.id, xyz); }
    const edgeCount = new Map<string, number>();
    const edgeList: [string, string][] = [];
    let nFaces = 0;
    for (const f of kids(faces, 'F')) {
      if (f.attrs.i === '1') continue; // usynlig flate
      const ids = f.text.trim().split(/\s+/);
      if (ids.length < 3) continue;
      nFaces++;
      for (let i = 0; i < 3; i++) {
        const a = ids[i], c = ids[(i + 1) % 3];
        const key = a < c ? `${a} ${c}` : `${c} ${a}`;
        const n = edgeCount.get(key) ?? 0;
        if (n === 0) edgeList.push(a < c ? [a, c] : [c, a]);
        edgeCount.set(key, n + 1);
      }
    }
    const name = sf.attrs.name || 'Terrengmodell';
    let boundary = 0, interior = 0;
    const draw = edgeList.length <= 60000;
    for (const [a, c] of edgeList) {
      const pa = P.get(a), pc = P.get(c);
      if (!pa || !pc) continue;
      if (edgeCount.get(`${a} ${c}`) === 1) { b.line(`${name} (kant)`, 'LandXML TIN-kant', [pa, pc]); boundary++; }
      else if (draw) { b.line(`${name} (trekanter)`, 'LandXML TIN', [pa, pc]); interior++; }
    }
    b.warnings.push(`${name}: ${nFaces} trekanter. ${draw ? 'Alle kanter tegnet.' : 'Modellen er stor, så bare ytterkanten er tegnet.'}`);
    if (!boundary && !interior) b.skip('terrengmodell uten gyldige punkter');
  }

  if (!b.features.length) b.warnings.push('Fant ingen punkter, trasé, plangeometri eller terrengmodell i LandXML-filen.');
  return b.finish(useCrs);
}
