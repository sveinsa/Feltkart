// Tverrsnitt: skjærer terreng og IFC-modeller langs en målt linje og gir et profil (avstand langs linjen mot høyde).
// Ren matte uten nettleserkode (slik at det kan testes), pluss tegning til canvas og eksport til DXF.
import { partBBox, vertexOf, triCount } from './snap';
import type { SnapPart } from './snap';

/** En IFC-del med farge (scenekoordinater i meter, som SnapPart) */
export interface SectionPart extends SnapPart { color: string }

type P2 = [number, number]; // [avstand langs snittet (s), høyde (z)]

export interface SectionObject {
  layer: string;
  color: string;
  /** Lukkede omriss (fylles) */
  loops: P2[][];
  /** Åpne linjer (flater som er skåret, men ikke danner et lukket omriss) */
  lines: P2[][];
}

export interface Section {
  /** Total lengde langs linjen (m) */
  length: number;
  /** Avstand (m) til hvert punkt i linjen, først 0 og sist `length` */
  stations: number[];
  /** Terrengprofil. null = ingen høyde der (hull i linjen) */
  terrain: (P2 | null)[];
  objects: SectionObject[];
  zmin: number;
  zmax: number;
}

export interface PathPoint { x: number; y: number; lng: number; lat: number }

export interface BuildInput {
  /** Punktene i målingen. x og y er scenekoordinater i meter (samme som IFC-delene). */
  path: PathPoint[];
  parts: SectionPart[];
  /** Terrenghøyde (m o.h.) eller null */
  terrainAt: (lng: number, lat: number) => number | null;
  /** Maks avstand mellom terrengpunktene (m). Standard 0,5 m, men aldri mer enn 600 punkter. */
  step?: number;
}

// ---------- Skjæring av trekanter mot et loddrett plan ----------

interface Node { s: number; z: number }

/** Skjærer en del mot planet gjennom P0→P1 og returnerer omriss/linjer i (s, z). Ikke avklippet i s. */
function sliceParts(parts: SectionPart[], x0: number, y0: number, x1: number, y1: number, len: number): Map<string, { color: string; segs: [Node, Node][] }> {
  const out = new Map<string, { color: string; segs: [Node, Node][] }>();
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const nx = -uy, ny = ux;
  for (const part of parts) {
    // Hele delen utenfor planet, eller utenfor strekningen, hoppes over
    const [bx0, by0, , bx1, by1] = partBBox(part);
    let dmin = Infinity, dmax = -Infinity, smin = Infinity, smax = -Infinity;
    for (const x of [bx0, bx1]) for (const y of [by0, by1]) {
      const d = nx * (x - x0) + ny * (y - y0), s = ux * (x - x0) + uy * (y - y0);
      if (d < dmin) dmin = d; if (d > dmax) dmax = d;
      if (s < smin) smin = s; if (s > smax) smax = s;
    }
    if (dmin > 0 || dmax < 0 || smax < 0 || smin > len) continue;
    const key = part.layer;
    let bucket = out.get(key);
    if (!bucket) { bucket = { color: part.color, segs: [] }; out.set(key, bucket); }
    const n = triCount(part);
    const seen = new Set<string>();
    for (let t = 0; t < n; t++) {
      const v = [vertexOf(part, t, 0), vertexOf(part, t, 1), vertexOf(part, t, 2)];
      const d = [nx * (v[0][0] - x0) + ny * (v[0][1] - y0), nx * (v[1][0] - x0) + ny * (v[1][1] - y0), nx * (v[2][0] - x0) + ny * (v[2][1] - y0)];
      if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;
      if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue; // trekanten ligger i planet
      const pts: Node[] = [];
      const toNode = (p: number[]): Node => ({ s: ux * (p[0] - x0) + uy * (p[1] - y0), z: p[2] });
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
        if (da === 0) pts.push(toNode(a));
        else if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          // Samme beregning uansett hvilken trekant kanten tilhører (like punkter i naboene)
          const swap = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
          const p = swap ? b : a, q = swap ? a : b, dp = swap ? db : da, dq = swap ? da : db;
          const f = dp / (dp - dq);
          pts.push(toNode([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]));
        }
      }
      if (pts.length < 2) continue;
      const a = pts[0], b = pts[1];
      if (a.s === b.s && a.z === b.z) continue;
      const ka = nodeKey(a), kb = nodeKey(b);
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (seen.has(ek)) continue;
      seen.add(ek);
      bucket.segs.push([a, b]);
    }
  }
  return out;
}

const nodeKey = (n: Node) => n.s.toFixed(5) + ',' + n.z.toFixed(5);

/** Setter streker sammen til lange linjer og lukkede omriss */
export function chain(segs: [Node, Node][]): { loops: P2[][]; lines: P2[][] } {
  const ids = new Map<string, number>();
  const nodes: Node[] = [];
  const adj: number[][] = [];
  const edges: [number, number][] = [];
  const id = (nd: Node) => {
    const k = nodeKey(nd);
    let i = ids.get(k);
    if (i === undefined) { i = nodes.length; ids.set(k, i); nodes.push(nd); adj.push([]); }
    return i;
  };
  for (const [a, b] of segs) {
    const ia = id(a), ib = id(b);
    if (ia === ib) continue;
    adj[ia].push(edges.length); adj[ib].push(edges.length);
    edges.push([ia, ib]);
  }
  const used = new Uint8Array(edges.length);
  const loops: P2[][] = [], lines: P2[][] = [];
  const walk = (start: number) => {
    const path = [start];
    let cur = start;
    for (;;) {
      const e = adj[cur].find((ei) => !used[ei]);
      if (e === undefined) break;
      used[e] = 1;
      cur = edges[e][0] === cur ? edges[e][1] : edges[e][0];
      path.push(cur);
    }
    const pts = path.map((i): P2 => [nodes[i].s, nodes[i].z]);
    if (path.length > 3 && path[0] === path[path.length - 1]) { pts.pop(); loops.push(pts); }
    else if (pts.length >= 2) lines.push(pts);
  };
  for (let i = 0; i < nodes.length; i++) if (adj[i].length === 1) walk(i); // åpne ender først
  for (let e = 0; e < edges.length; e++) if (!used[e]) walk(edges[e][0]);
  return { loops, lines };
}

// ---------- Avklipping til strekningen [0, len] ----------

/** Sutherland–Hodgman mot s ≥ lo og s ≤ hi */
export function clipPolygon(poly: P2[], lo: number, hi: number): P2[] {
  const clip = (pts: P2[], inside: (p: P2) => boolean, at: (a: P2, b: P2) => P2): P2[] => {
    const res: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) res.push(a);
      if (ia !== ib) res.push(at(a, b));
    }
    return res;
  };
  const cut = (x: number) => (a: P2, b: P2): P2 => { const f = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + (b[1] - a[1]) * f]; };
  let r = clip(poly, (p) => p[0] >= lo, cut(lo));
  if (r.length) r = clip(r, (p) => p[0] <= hi, cut(hi));
  return r.length >= 3 ? r : [];
}

/** Klipper en åpen linje til s ∈ [lo, hi]; gir ett eller flere stykker */
export function clipLine(line: P2[], lo: number, hi: number): P2[][] {
  const pieces: P2[][] = [];
  let cur: P2[] = [];
  const flush = () => { if (cur.length >= 2) pieces.push(cur); cur = []; };
  for (let i = 0; i + 1 < line.length; i++) {
    let [s0, z0] = line[i];
    let [s1, z1] = line[i + 1];
    const ds = s1 - s0;
    let t0 = 0, t1 = 1;
    if (ds === 0) { if (s0 < lo || s0 > hi) { flush(); continue; } }
    else {
      const ta = (lo - s0) / ds, tb = (hi - s0) / ds;
      t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
      if (t0 > t1) { flush(); continue; }
    }
    const a: P2 = [s0 + ds * t0, z0 + (z1 - z0) * t0], b: P2 = [s0 + ds * t1, z0 + (z1 - z0) * t1];
    if (cur.length && (Math.abs(cur[cur.length - 1][0] - a[0]) > 1e-9 || Math.abs(cur[cur.length - 1][1] - a[1]) > 1e-9)) flush();
    if (!cur.length) cur.push(a);
    cur.push(b);
    s0 = s1; z0 = z1;
  }
  flush();
  return pieces;
}

// ---------- Hovedfunksjon ----------

export function buildSection(inp: BuildInput): Section | null {
  const path = inp.path;
  if (path.length < 2) return null;
  const segLen: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) segLen.push(Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y));
  const stations = [0];
  for (const l of segLen) stations.push(stations[stations.length - 1] + l);
  const length = stations[stations.length - 1];
  if (!(length > 0)) return null;

  // Terreng
  const terrain: (P2 | null)[] = [];
  const maxStep = Math.max(inp.step ?? 0.5, length / 600);
  for (let i = 0; i < segLen.length; i++) {
    if (segLen[i] <= 0) continue;
    const a = path[i], b = path[i + 1];
    const n = Math.max(1, Math.ceil(segLen[i] / maxStep));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      const z = inp.terrainAt(a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f);
      terrain.push(z === null || !Number.isFinite(z) ? null : [stations[i] + segLen[i] * f, z]);
    }
  }

  // Objekter: hver strekning skjæres for seg
  const merged = new Map<string, SectionObject>();
  for (let i = 0; i < segLen.length; i++) {
    if (segLen[i] <= 0) continue;
    const a = path[i], b = path[i + 1];
    const sliced = sliceParts(inp.parts, a.x, a.y, b.x, b.y, segLen[i]);
    for (const [layer, { color, segs }] of sliced) {
      if (!segs.length) continue;
      const { loops, lines } = chain(segs);
      let obj = merged.get(layer);
      if (!obj) { obj = { layer, color, loops: [], lines: [] }; merged.set(layer, obj); }
      const off = stations[i];
      for (const lp of loops) { const c = clipPolygon(lp, 0, segLen[i]); if (c.length) obj.loops.push(c.map(([s, z]): P2 => [s + off, z])); }
      for (const ln of lines) for (const c of clipLine(ln, 0, segLen[i])) obj.lines.push(c.map(([s, z]): P2 => [s + off, z]));
    }
  }
  const objects = [...merged.values()].filter((o) => o.loops.length || o.lines.length).sort((x, y) => x.layer.localeCompare(y.layer, 'nb'));

  let zmin = Infinity, zmax = -Infinity;
  const see = (z: number) => { if (z < zmin) zmin = z; if (z > zmax) zmax = z; };
  for (const p of terrain) if (p) see(p[1]);
  for (const o of objects) { for (const l of o.loops) for (const p of l) see(p[1]); for (const l of o.lines) for (const p of l) see(p[1]); }
  if (!Number.isFinite(zmin)) { zmin = 0; zmax = 1; }
  return { length, stations, terrain, objects, zmin, zmax };
}

// ---------- Tegning ----------

export const fmtNum = (n: number, d = 2) => n.toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Antall desimaler som trengs for å vise et intervall */
const decFor = (step: number) => Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

/** Pene intervaller (1, 2, 5 × 10^k) */
export function niceStep(range: number, target: number): number {
  const raw = Math.max(1e-9, range / Math.max(1, target));
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface RenderOpts {
  /** Overhøyde: 'auto' fyller vinduet, ellers fast forhold mellom høyde- og lengdemålestokk */
  vExag: 'auto' | number;
  /** Lag som er skjult */
  hidden?: Set<string>;
  title?: string;
  /** Vis markør ved denne avstanden */
  hoverS?: number | null;
}

export interface Layout {
  left: number; top: number; pw: number; ph: number;
  sx: number; sz: number;
  /** Plassering av s = 0 og z = øverste høyde i piksler */
  x0: number; y0: number; zhi: number;
  ratio: number;
}

export function layoutSection(sec: Section, w: number, h: number, vExag: 'auto' | number): Layout {
  const left = 66, right = 22, top = 44, bottom = 44;
  const pw = Math.max(50, w - left - right), ph = Math.max(50, h - top - bottom);
  const dz0 = Math.max(0.5, sec.zmax - sec.zmin);
  const pad = dz0 * 0.08;
  const dz = dz0 + pad * 2;
  const zhi = sec.zmax + pad;
  let sx = pw / sec.length, sz: number;
  if (vExag === 'auto') sz = ph / dz;
  else { sx = Math.min(sx, ph / (dz * vExag)); sz = sx * vExag; }
  const x0 = left;
  const y0 = top + (vExag === 'auto' ? 0 : (ph - dz * sz) / 2);
  return { left, top, pw, ph, sx, sz, x0, y0, zhi, ratio: sz / sx };
}

export function drawSection(ctx: CanvasRenderingContext2D, w: number, h: number, sec: Section, opts: RenderOpts): Layout {
  const L = layoutSection(sec, w, h, opts.vExag);
  const X = (s: number) => L.x0 + s * L.sx;
  const Y = (z: number) => L.y0 + (L.zhi - z) * L.sz;
  const hidden = opts.hidden ?? new Set<string>();
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  const plotR = L.x0 + sec.length * L.sx;
  const zlo = L.zhi - (L.top + L.ph - L.y0) / L.sz; // laveste høyde i tegneområdet
  const zup = L.zhi + (L.y0 - L.top) / L.sz; // høyeste høyde i tegneområdet
  const bottomY = Y(zlo);

  // Rutenett og akser
  ctx.lineWidth = 1;
  const zStep = niceStep(L.ph / L.sz, L.ph / 48);
  ctx.strokeStyle = '#e6e9ee'; ctx.fillStyle = '#4a5560'; ctx.textAlign = 'right';
  for (let z = Math.ceil(zlo / zStep) * zStep; z <= zup + 1e-9; z += zStep) {
    const y = Math.round(Y(z)) + 0.5;
    if (y < L.top - 1 || y > bottomY + 1) continue;
    ctx.beginPath(); ctx.moveTo(L.x0, y); ctx.lineTo(plotR, y); ctx.stroke();
    ctx.fillText(fmtNum(z, decFor(zStep)), L.x0 - 6, y);
  }
  const sStep = niceStep(sec.length, Math.max(2, (sec.length * L.sx) / 90));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let s = 0; s <= sec.length + 1e-9; s += sStep) {
    const x = Math.round(X(s)) + 0.5;
    ctx.strokeStyle = '#e6e9ee';
    ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, bottomY); ctx.stroke();
    ctx.fillStyle = '#4a5560';
    ctx.fillText(fmtNum(s, decFor(sStep)), x, bottomY + 5);
  }
  ctx.textBaseline = 'middle';

  // Alt under tegnes innenfor området
  ctx.save();
  ctx.beginPath(); ctx.rect(L.x0, L.top, sec.length * L.sx + 0.5, bottomY - L.top); ctx.clip();

  // Terreng (fylt nedover)
  const runs: P2[][] = [];
  let run: P2[] = [];
  for (const p of sec.terrain) { if (p) run.push(p); else { if (run.length) runs.push(run); run = []; } }
  if (run.length) runs.push(run);
  if (!hidden.has('Terreng')) {
    for (const r of runs) {
      ctx.beginPath();
      ctx.moveTo(X(r[0][0]), bottomY + 2);
      for (const p of r) ctx.lineTo(X(p[0]), Y(p[1]));
      ctx.lineTo(X(r[r.length - 1][0]), bottomY + 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(160,130,90,0.22)';
      ctx.fill();
    }
  }
  // Objekter
  for (const o of sec.objects) {
    if (hidden.has(o.layer)) continue;
    ctx.beginPath();
    for (const lp of o.loops) { lp.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.closePath(); }
    ctx.fillStyle = o.color; ctx.globalAlpha = 0.9; ctx.fill('evenodd'); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#20252b'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    for (const ln of o.lines) ln.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.strokeStyle = o.color === '#ffffff' ? '#20252b' : o.color; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineWidth = 1;
  }
  // Terrenglinje øverst
  if (!hidden.has('Terreng')) {
    ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    for (const r of runs) { ctx.beginPath(); r.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke(); }
    ctx.lineWidth = 1;
  }
  // Knekkpunkter i målelinjen
  ctx.setLineDash([4, 4]); ctx.strokeStyle = '#9aa3ad';
  for (let i = 1; i + 1 < sec.stations.length; i++) { const x = X(sec.stations[i]); ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, bottomY); ctx.stroke(); }
  ctx.setLineDash([]);
  // Markør
  if (opts.hoverS != null && opts.hoverS >= 0 && opts.hoverS <= sec.length) {
    const x = X(opts.hoverS);
    ctx.strokeStyle = '#ef6c1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, bottomY); ctx.stroke();
    const tz = terrainAtS(sec, opts.hoverS);
    if (tz !== null) { ctx.fillStyle = '#ef6c1a'; ctx.beginPath(); ctx.arc(x, Y(tz), 4, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();

  // Ramme og A/B
  ctx.strokeStyle = '#8a95a1'; ctx.lineWidth = 1;
  ctx.strokeRect(L.x0 + 0.5, L.top + 0.5, sec.length * L.sx, bottomY - L.top);
  ctx.fillStyle = '#1f2933'; ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('A', L.x0 + 2, L.top - 4);
  ctx.textAlign = 'right'; ctx.fillText('B', plotR - 2, L.top - 4);
  ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.fillStyle = '#4a5560'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Avstand langs snittet (m)', L.x0 + (sec.length * L.sx) / 2, bottomY + 22);
  ctx.save(); ctx.translate(16, L.top + (bottomY - L.top) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Høyde (m o.h.)', 0, 0); ctx.restore();

  // Tittel (øverst til venstre, over rammen)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1f2933'; ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
  const exTxt = Math.abs(L.ratio - 1) < 0.02 ? 'ingen overhøyde' : `overhøyde ×${fmtNum(L.ratio, L.ratio < 10 ? 1 : 0)}`;
  ctx.fillText(`${opts.title ?? 'Tverrsnitt'} · lengde ${fmtNum(sec.length, 1)} m · ${exTxt}`, 12, 14);

  // Forklaring
  const items: { name: string; color: string }[] = [];
  if (runs.length) items.push({ name: 'Terreng', color: '#7a5a2e' });
  for (const o of sec.objects) items.push({ name: o.layer, color: o.color });
  ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let lx = L.x0 + 8; let ly = L.top + 12;
  for (const it of items) {
    if (hidden.has(it.name)) continue;
    const tw = ctx.measureText(it.name).width + 26;
    if (lx + tw > plotR - 4) { lx = L.x0 + 8; ly += 16; }
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(lx - 3, ly - 8, tw, 16);
    ctx.fillStyle = it.color; ctx.fillRect(lx, ly - 5, 12, 10); ctx.strokeStyle = '#20252b'; ctx.strokeRect(lx + 0.5, ly - 4.5, 11, 9);
    ctx.fillStyle = '#26303a'; ctx.fillText(it.name, lx + 17, ly);
    lx += tw + 6;
  }
  ctx.restore();
  return L;
}

/** Terrenghøyde ved en avstand (lineær mellom punktene), eller null */
export function terrainAtS(sec: Section, s: number): number | null {
  const t = sec.terrain;
  for (let i = 0; i + 1 < t.length; i++) {
    const a = t[i], b = t[i + 1];
    if (!a || !b) continue;
    if (s >= a[0] && s <= b[0]) { const f = b[0] === a[0] ? 0 : (s - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; }
  }
  return null;
}

// ---------- DXF ----------

const ACI: [number, string][] = [[1, '#ff0000'], [2, '#ffff00'], [3, '#00ff00'], [4, '#00ffff'], [5, '#0000ff'], [6, '#ff00ff'], [7, '#000000'], [8, '#808080'], [9, '#c0c0c0'], [30, '#ff7f00'], [34, '#bf5f00'], [42, '#7f7f00'], [94, '#007f7f'], [150, '#3f5fbf'], [14, '#7f1f1f'], [32, '#a5651b']];
/** Nærmeste AutoCAD-farge (1–255) til en CSS-farge */
export function aciFor(css: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(css);
  const n = m ? parseInt(m[1], 16) : 0x808080;
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  let best = 7, bd = Infinity;
  for (const [i, c] of ACI) {
    const q = parseInt(c.slice(1), 16);
    const d = (r - (q >> 16)) ** 2 + (g - ((q >> 8) & 255)) ** 2 + (b - (q & 255)) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function dxfLayerName(name: string): string {
  const up = name.toUpperCase().replace(/Æ/g, 'AE').replace(/Ø/g, 'O').replace(/Å/g, 'AA').replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return (up || 'LAG').slice(0, 31);
}

/**
 * DXF (AutoCAD R12, ASCII). Tegnet i profilkoordinater i meter og i målestokk 1:1: x = avstand langs snittet, y = høyde (m o.h.).
 * Lag: TERRENG, AKSER, TEKST, KNEKKPUNKT og ett lag per objektklasse (IFC-lag).
 */
export function sectionToDxf(sec: Section, opts: { hidden?: Set<string>; title?: string } = {}): string {
  const hidden = opts.hidden ?? new Set<string>();
  const out: (string | number)[] = [];
  const g = (code: number, v: string | number) => { out.push(code, typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(4)) : v); };
  const layers: { name: string; color: number }[] = [
    { name: 'TERRENG', color: 32 }, { name: 'AKSER', color: 8 }, { name: 'TEKST', color: 7 }, { name: 'KNEKKPUNKT', color: 9 },
  ];
  const used = new Set(layers.map((l) => l.name));
  const objLayer = new Map<string, string>();
  for (const o of sec.objects) {
    if (hidden.has(o.layer)) continue;
    let nm = dxfLayerName(o.layer), k = 2;
    while (used.has(nm)) nm = dxfLayerName(o.layer).slice(0, 28) + '_' + k++;
    used.add(nm); objLayer.set(o.layer, nm);
    layers.push({ name: nm, color: aciFor(o.color) });
  }

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed'); g(72, 65); g(73, 2); g(40, 1); g(49, 0.6); g(49, -0.4);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const l of layers) { g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, l.name === 'KNEKKPUNKT' ? 'DASHED' : 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');

  const poly = (layer: string, pts: P2[], closed: boolean) => {
    if (pts.length < 2) return;
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, 'VERTEX'); g(8, layer); g(10, p[0]); g(20, p[1]); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const line = (layer: string, a: P2, b: P2) => { g(0, 'LINE'); g(8, layer); g(10, a[0]); g(20, a[1]); g(30, 0); g(11, b[0]); g(21, b[1]); g(31, 0); };
  const text = (layer: string, x: number, y: number, h: number, s: string, rightAlign = false) => {
    g(0, 'TEXT'); g(8, layer); g(10, x); g(20, y); g(30, 0); g(40, h); g(1, s);
    if (rightAlign) { g(72, 2); g(11, x); g(21, y); g(31, 0); }
  };

  // Terreng
  let run: P2[] = [];
  const flush = () => { poly('TERRENG', run, false); run = []; };
  for (const p of sec.terrain) { if (p) run.push(p); else flush(); }
  flush();
  // Objekter
  for (const o of sec.objects) {
    const ln = objLayer.get(o.layer);
    if (!ln) continue;
    for (const l of o.loops) poly(ln, l, true);
    for (const l of o.lines) poly(ln, l, false);
  }
  // Akser: nullinje under profilet, loddrett akse ved A, tegn og tall
  const dz = Math.max(0.5, sec.zmax - sec.zmin);
  const th = Math.max(sec.length, dz) / 80;
  const zStep = niceStep(dz, 6), sStep = niceStep(sec.length, 8);
  const zBase = Math.floor(sec.zmin / zStep) * zStep;
  const zTop = Math.ceil(sec.zmax / zStep) * zStep;
  line('AKSER', [0, zBase], [sec.length, zBase]);
  line('AKSER', [0, zBase], [0, zTop]);
  for (let s = 0; s <= sec.length + 1e-9; s += sStep) { line('AKSER', [s, zBase], [s, zBase - th * 0.7]); text('TEKST', s - th * 1.2, zBase - th * 2.6, th, fmtNum(s, decFor(sStep))); }
  for (let z = zBase; z <= zTop + 1e-9; z += zStep) { line('AKSER', [0, z], [-th * 0.7, z]); text('TEKST', -th * 1.2, z - th / 2, th, fmtNum(z, decFor(zStep)), true); }
  text('TEKST', 0, zTop + th * 1.5, th * 1.4, `${opts.title ?? 'Tverrsnitt'} - lengde ${fmtNum(sec.length, 1)} m (A til B)`);
  text('TEKST', 0, zBase - th * 5, th, 'Avstand (m)');
  text('TEKST', -th * 9, zTop + th * 0.2, th, 'Hoyde (m o.h.)');
  // Knekkpunkter
  for (let i = 1; i + 1 < sec.stations.length; i++) line('KNEKKPUNKT', [sec.stations[i], zBase], [sec.stations[i], zTop]);

  g(0, 'ENDSEC'); g(0, 'EOF');
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 2) lines.push(String(out[i]).padStart(3, ' '), String(out[i + 1]));
  return lines.join('\r\n') + '\r\n';
}
