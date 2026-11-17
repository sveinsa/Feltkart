// Snapping for måleverktøyet. Rene funksjoner uten avhengigheter, slik at de kan testes uten kart og uten WebGL.
//  • 3D: stråle mot IFC-trekanter → hjørne, kant eller flate (snapToHit / snapAt3d)
//  • 2D: nærmeste hjørne eller kant blant linjer og flater i kartet (snapPlanar)

export type V3 = [number, number, number];
export type SnapKind = 'vertex' | 'edge' | 'face';

export const SNAP_VERTEX_PX = 12;
export const SNAP_EDGE_PX = 9;
/** Kanter regnes som «ekte» kanter (og ikke som skjøt mellom trekanter i en flate) når flatene møtes i større vinkel enn dette */
export const FEATURE_EDGE_DEG = 28;
/** Over dette antall trekanter i én del hoppes kantsøket over (alle kanter kan da snappes), for å spare tid og minne */
export const MAX_TRIS_FOR_EDGE_INDEX = 250_000;

// ---------- Geometri i 3D ----------

/** Fra IFC-delens koordinater (Ø, N relativt til origo, Z absolutt) til scenen: x = ax·e + bx·n + tx, y = ay·e + by·n + ty, z = z */
export interface Affine2 { ax: number; ay: number; bx: number; by: number; tx: number; ty: number }

export interface SnapPart {
  layer: string;
  positions: Float32Array; // 3 hjørner × 3 tall per trekant
  xf: Affine2;
  /** Mellomlagrede verdier (fylles ved behov) */
  _bbox?: [number, number, number, number, number, number];
  _edges?: Uint8Array | null;
}

export const triCount = (p: SnapPart) => Math.floor(p.positions.length / 9);

export function vertexOf(p: SnapPart, tri: number, k: number): V3 {
  const i = tri * 9 + k * 3;
  const e = p.positions[i], n = p.positions[i + 1], z = p.positions[i + 2];
  const f = p.xf;
  return [f.ax * e + f.bx * n + f.tx, f.ay * e + f.by * n + f.ty, z];
}

export function partBBox(p: SnapPart): [number, number, number, number, number, number] {
  if (p._bbox) return p._bbox;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const f = p.xf, a = p.positions;
  for (let i = 0; i + 2 < a.length; i += 3) {
    const x = f.ax * a[i] + f.bx * a[i + 1] + f.tx, y = f.ay * a[i] + f.by * a[i + 1] + f.ty, z = a[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  p._bbox = [x0, y0, z0, x1, y1, z1];
  return p._bbox;
}

/** Treffer strålen boksen? (slab-metoden) */
export function rayHitsBox(o: V3, d: V3, b: [number, number, number, number, number, number]): boolean {
  let tmin = 0, tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    const lo = b[k], hi = b[k + 3];
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo || o[k] > hi) return false;
    } else {
      let t1 = (lo - o[k]) / d[k], t2 = (hi - o[k]) / d[k];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** Stråle mot trekant (Möller–Trumbore), dobbeltsidig. Gir avstand langs strålen eller null. */
export function rayTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}

export interface RayHit {
  part: SnapPart;
  tri: number;
  t: number;
  point: V3;
  v: [V3, V3, V3];
}

/** Nærmeste treff blant alle deler. Deler som strålen ikke treffer boksen til hoppes over. */
export function raycast(parts: SnapPart[], o: V3, d: V3): RayHit | null {
  let best: RayHit | null = null;
  for (const part of parts) {
    if (!rayHitsBox(o, d, partBBox(part))) continue;
    const n = triCount(part);
    for (let tri = 0; tri < n; tri++) {
      const a = vertexOf(part, tri, 0), b = vertexOf(part, tri, 1), c = vertexOf(part, tri, 2);
      const t = rayTriangle(o, d, a, b, c);
      if (t !== null && (!best || t < best.t)) {
        best = { part, tri, t, point: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], v: [a, b, c] };
      }
    }
  }
  return best;
}

// ---------- Kanter som er «ekte» (ikke skjøter i en flate) ----------

function triNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Finner hvilke trekantkanter som er ekte kanter: ytterkanter (bare én trekant), kanter der flatene møtes i større vinkel enn
 * `angleDeg`, og kanter med mer enn to trekanter. Resultatet har én byte per trekant; bit k er satt hvis kant k (hjørne k → k+1) er en ekte kant.
 * Diagonalene som deler en plan flate i trekanter blir dermed ikke snappet til.
 * Regner i IFC-delens egne koordinater (affin avbildning bevarer ikke vinkler eksakt, men det har liten betydning for vinkelgrensen).
 */
export function featureEdges(positions: Float32Array, angleDeg = FEATURE_EDGE_DEG): Uint8Array {
  const n = Math.floor(positions.length / 9);
  const out = new Uint8Array(n);
  const ids = new Map<string, number>();
  const vid = new Int32Array(n * 3);
  const q = (v: number) => Math.round(v * 1000);
  for (let i = 0; i < n * 3; i++) {
    const k = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`;
    let id = ids.get(k);
    if (id === undefined) { id = ids.size; ids.set(k, id); }
    vid[i] = id;
  }
  const normals = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const p = (k: number): V3 => [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]];
    const nn = triNormal(p(0), p(1), p(2));
    normals[t * 3] = nn[0]; normals[t * 3 + 1] = nn[1]; normals[t * 3 + 2] = nn[2];
  }
  const BIG = 1 << 26;
  const edgeKey = (a: number, b: number) => (a < b ? a * BIG + b : b * BIG + a);
  // kant → [første trekant, andre trekant (-1), antall]
  const edges = new Map<number, [number, number, number]>();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(vid[t * 3 + k], vid[t * 3 + ((k + 1) % 3)]);
      const e = edges.get(key);
      if (!e) edges.set(key, [t, -1, 1]);
      else { if (e[1] < 0) e[1] = t; e[2]++; }
    }
  }
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const a = vid[t * 3 + k], b = vid[t * 3 + ((k + 1) % 3)];
      if (a === b) continue; // degenerert kant
      const e = edges.get(edgeKey(a, b))!;
      let feature = false;
      if (e[2] !== 2) feature = true; // ytterkant eller flere enn to trekanter
      else {
        const o = e[0] === t ? e[1] : e[0];
        const dot = normals[t * 3] * normals[o * 3] + normals[t * 3 + 1] * normals[o * 3 + 1] + normals[t * 3 + 2] * normals[o * 3 + 2];
        feature = Math.abs(dot) < cosLimit; // trekantene kan vende hver sin vei (retning på flaten), så vinkelen måles uten fortegn
      }
      if (feature) out[t] |= 1 << k;
    }
  }
  return out;
}

function edgeFlags(part: SnapPart): Uint8Array | null {
  if (part._edges !== undefined) return part._edges;
  part._edges = triCount(part) <= MAX_TRIS_FOR_EDGE_INDEX ? featureEdges(part.positions) : null;
  return part._edges;
}

// ---------- Snapping i 3D ----------

/** Skjermposisjon (piksler) og «w» (dybde) for et punkt i scenen. null hvis punktet er bak kameraet. */
export type Project3 = (p: V3) => { x: number; y: number; w: number } | null;

export interface SnapResult3d {
  kind: SnapKind;
  /** Punkt i scenen */
  point: V3;
  layer: string;
}

export interface SnapOpts { vertexPx?: number; edgePx?: number }

/** Fra posisjon langs kant på skjermen (ts) til posisjon langs kanten i 3D, korrigert for perspektiv */
export function perspectiveT(ts: number, wA: number, wB: number): number {
  const d = (1 - ts) * wB + ts * wA;
  return d === 0 ? ts : (ts * wA) / d;
}

/** Hjørne, kant eller flate for ett treff. Hjørner foran kanter foran flate. */
export function snapToHit(hit: RayHit, cursor: { x: number; y: number }, project: Project3, opts: SnapOpts = {}, allowFace = true): SnapResult3d | null {
  const vpx = opts.vertexPx ?? SNAP_VERTEX_PX, epx = opts.edgePx ?? SNAP_EDGE_PX;
  const pr = hit.v.map((p) => project(p));
  // Hjørner
  let bi = -1, bd = Infinity;
  for (let k = 0; k < 3; k++) {
    const s = pr[k];
    if (!s) continue;
    const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
    if (d < bd) { bd = d; bi = k; }
  }
  if (bi >= 0 && bd <= vpx) return { kind: 'vertex', point: hit.v[bi], layer: hit.part.layer };
  // Ekte kanter
  const flags = edgeFlags(hit.part);
  let ek = -1, ed = Infinity, et = 0;
  for (let k = 0; k < 3; k++) {
    if (flags && !(flags[hit.tri] & (1 << k))) continue;
    const a = pr[k], b = pr[(k + 1) % 3];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    const ts = Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * ts - cursor.x, a.y + dy * ts - cursor.y);
    if (d < ed) { ed = d; ek = k; et = ts; }
  }
  if (ek >= 0 && ed <= epx) {
    const A = hit.v[ek], B = hit.v[(ek + 1) % 3];
    const t = perspectiveT(et, pr[ek]!.w, pr[(ek + 1) % 3]!.w);
    return { kind: 'edge', point: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], layer: hit.part.layer };
  }
  if (!allowFace) return null;
  return { kind: 'face', point: hit.point, layer: hit.part.layer };
}

const RING: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

/**
 * Snapper markørposisjonen (skjermpiksler) til IFC-modellen. Først stråle rett gjennom markøren (hjørne, kant eller flate).
 * Bommer den, prøves en ring av stråler rundt markøren, slik at hjørner og kanter også treffes like utenfor silhuetten.
 */
export function snapAt3d(
  parts: SnapPart[],
  rayAt: (x: number, y: number) => { o: V3; d: V3 },
  cursor: { x: number; y: number },
  project: Project3,
  opts: SnapOpts = {},
): SnapResult3d | null {
  if (!parts.length) return null;
  const r0 = rayAt(cursor.x, cursor.y);
  const hit = raycast(parts, r0.o, r0.d);
  if (hit) return snapToHit(hit, cursor, project, opts, true);
  const rad = (opts.vertexPx ?? SNAP_VERTEX_PX) * 0.9;
  let best: SnapResult3d | null = null, bestD = Infinity;
  for (const [ox, oy] of RING) {
    const r = rayAt(cursor.x + ox * rad, cursor.y + oy * rad);
    const h = raycast(parts, r.o, r.d);
    if (!h) continue;
    const s = snapToHit(h, cursor, project, opts, false);
    if (!s) continue;
    const ps = project(s.point);
    const d = ps ? Math.hypot(ps.x - cursor.x, ps.y - cursor.y) : Infinity;
    // hjørne vinner over kant når avstandene er like gode
    const score = d + (s.kind === 'vertex' ? 0 : 3);
    if (score < bestD) { bestD = score; best = s; }
  }
  return best;
}

// ---------- Snapping i 2D (flate kart) ----------

export interface PlanarFeature {
  /** [bredde, lengde] */
  pts: [number, number][];
  closed: boolean;
  bbox?: [number, number, number, number]; // minLat, minLng, maxLat, maxLng
}

export interface PlanarIndex { features: PlanarFeature[] }

export function buildPlanarIndex(features: { pts: [number, number][]; closed: boolean }[]): PlanarIndex {
  const out: PlanarFeature[] = [];
  for (const f of features) {
    if (!f.pts.length) continue;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [la, ln] of f.pts) {
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
      if (la < a) a = la; if (la > c) c = la;
      if (ln < b) b = ln; if (ln > d) d = ln;
    }
    if (a === Infinity) continue;
    out.push({ pts: f.pts, closed: f.closed, bbox: [a, b, c, d] });
  }
  return { features: out };
}

export interface SnapResult2d { kind: 'vertex' | 'edge'; lat: number; lng: number }

/**
 * Nærmeste hjørne (innenfor vertexPx) eller kant (innenfor edgePx) til markøren.
 * `pxPerLat` / `pxPerLng`: hvor mange skjermpiksler én grad tilsvarer akkurat her (lengde og bredde skaleres ulikt).
 */
export function snapPlanar(
  idx: PlanarIndex,
  cur: { lat: number; lng: number },
  scale: { pxPerLat: number; pxPerLng: number },
  opts: SnapOpts = {},
): SnapResult2d | null {
  const vpx = opts.vertexPx ?? SNAP_VERTEX_PX, epx = opts.edgePx ?? SNAP_EDGE_PX;
  const maxPx = Math.max(vpx, epx);
  const dLat = maxPx / Math.abs(scale.pxPerLat || 1), dLng = maxPx / Math.abs(scale.pxPerLng || 1);
  let bestV: { d: number; lat: number; lng: number } | null = null;
  let bestE: { d: number; lat: number; lng: number } | null = null;
  const px = (lat: number, lng: number): [number, number] => [(lng - cur.lng) * scale.pxPerLng, (cur.lat - lat) * scale.pxPerLat];
  for (const f of idx.features) {
    const bb = f.bbox!;
    if (cur.lat < bb[0] - dLat || cur.lat > bb[2] + dLat || cur.lng < bb[1] - dLng || cur.lng > bb[3] + dLng) continue;
    const n = f.pts.length;
    for (let i = 0; i < n; i++) {
      const [la, ln] = f.pts[i];
      const [x, y] = px(la, ln);
      const d = Math.hypot(x, y);
      if (d <= vpx && (!bestV || d < bestV.d)) bestV = { d, lat: la, lng: ln };
      const j = i + 1 < n ? i + 1 : f.closed && n > 2 ? 0 : -1;
      if (j < 0) continue;
      const [x2, y2] = px(f.pts[j][0], f.pts[j][1]);
      const dx = x2 - x, dy = y2 - y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / len2));
      const de = Math.hypot(x + dx * t, y + dy * t);
      if (de <= epx && (!bestE || de < bestE.d)) {
        bestE = { d: de, lat: la + (f.pts[j][0] - la) * t, lng: ln + (f.pts[j][1] - ln) * t };
      }
    }
  }
  if (bestV) return { kind: 'vertex', lat: bestV.lat, lng: bestV.lng };
  if (bestE) return { kind: 'edge', lat: bestE.lat, lng: bestE.lng };
  return null;
}

export const SNAP_LABEL: Record<SnapKind, string> = { vertex: 'Hjørne', edge: 'Kant', face: 'Flate' };

// ---------- Hjelpere for kartprojeksjonen ----------

/** Normalisert Mercator (0–1, som i MapLibre) → [lengde, bredde] i grader */
export function mercatorToLngLat(mx: number, my: number): [number, number] {
  const lng = mx * 360 - 180;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * my))) - 90;
  return [lng, lat];
}

/**
 * Skjermposisjon for et punkt i scenen, gitt scenens samlede matrise (kolonnevis, 16 tall: scene → klipperom).
 * `width` og `height` er kartflatens størrelse i piksler. null hvis punktet er bak kameraet.
 */
export function projectWithMatrix(m: ArrayLike<number>, width: number, height: number): Project3 {
  return (p) => {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (!(w > 1e-9)) return null;
    return { x: ((x / w + 1) / 2) * width, y: ((1 - y / w) / 2) * height, w };
  };
}

/** Invers av en 4×4-matrise (kolonnevis). null hvis den ikke kan inverteres. */
export function invert4(m: ArrayLike<number>): number[] | null {
  const a = Array.from(m);
  const inv = new Array<number>(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det || !Number.isFinite(det)) return null;
  const k = 1 / det;
  return inv.map((v) => v * k);
}

/** Stråle gjennom en skjermposisjon, i scenens koordinater. `invProj` er inversen av scenens samlede matrise. */
export function rayFromMatrix(invProj: ArrayLike<number>, x: number, y: number, width: number, height: number): { o: V3; d: V3 } {
  const nx = (x / width) * 2 - 1, ny = 1 - (y / height) * 2;
  const un = (z: number): V3 => {
    const m = invProj;
    const X = m[0] * nx + m[4] * ny + m[8] * z + m[12];
    const Y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
    const Z = m[2] * nx + m[6] * ny + m[10] * z + m[14];
    const W = m[3] * nx + m[7] * ny + m[11] * z + m[15];
    return [X / W, Y / W, Z / W];
  };
  const a = un(-1), b = un(1);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return { o: a, d: [dx / l, dy / l, dz / l] };
}

/** Nærmeste punkt (i skjermpiksler) til markøren, innen `maxPx`. Brukes til å treffe bildebobler selv om klikket bommer litt. */
export function nearestOnScreen<T extends { p: V3 }>(items: T[], cursor: { x: number; y: number }, project: Project3, maxPx: number): T | null {
  let best: T | null = null, bd = maxPx;
  for (const it of items) {
    const s = project(it.p);
    if (!s) continue;
    const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
    if (d <= bd) { bd = d; best = it; }
  }
  return best;
}
