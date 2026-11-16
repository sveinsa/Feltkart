// Leser DXF (prosjekterte data) og gjør geometrien om til kartkoordinater.
import DxfParser from 'dxf-parser';
import { toLatLng } from './crs';

export interface DxfFeature {
  layer: string;
  type: string; // DXF-entitetstype (LINE, LWPOLYLINE …)
  color: string;
  geom: 'line' | 'polygon' | 'point' | 'text';
  latlngs: [number, number][];
  z: number[];
  length: number; // i prosjektenheter (normalt meter)
  area?: number;
  text?: string;
  textHeight?: number;
  rotation?: number;
  block?: string;
  /** Egenskaper fra kildefilen (SOSI-attributter, IFC-navn, kode osv.) */
  attrs?: Record<string, string>;
  /** Egen fyllfarge (IFC-farge). `color` er da omrisset. */
  fill?: string;
  fillOpacity?: number;
}

export interface DxfLayer {
  name: string;
  color: string;
  count: number;
}

/** Ekte 3D-geometri (trekanter) fra IFC. Koordinater er meter relativt til `origin` (Ø, N) i koordinatsystemet `crs`; Z er absolutt høyde. */
export interface Mesh3D {
  crs: string;
  origin: [number, number];
  /** `color` (0xRRGGBB) og `opacity` kommer fra IFC-filens overflatestiler. Mangler de, brukes standardfarge for laget. */
  parts: { layer: string; positions: Float32Array; color?: number; opacity?: number }[];
  triangles: number;
  truncated: boolean;
}

export interface ParsedDxf {
  features: DxfFeature[];
  layers: DxfLayer[];
  bounds: [[number, number], [number, number]] | null;
  warnings: string[];
  skipped: Record<string, number>;
  /** Koordinatsystemet filen faktisk ble lest i (kan avvike fra det brukeren valgte hvis filen oppgir sitt eget) */
  crs?: string;
  /** 3D-geometri (bare IFC) til bruk i fanen Terreng 3D */
  mesh3d?: Mesh3D;
}

type P3 = [number, number, number];
type Xf = (p: P3) => P3;

const identity: Xf = (p) => p;

function hex(n: number | undefined): string | null {
  if (n === undefined || n === null || !Number.isFinite(n)) return null;
  return '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
}

/** Svart og hvitt synes dårlig på kartet, så de tegnes mørkegrått */
function visible(c: string): string {
  const v = c.toLowerCase();
  return v === '#ffffff' || v === '#000000' ? '#2b2f36' : c;
}

function cleanMText(t: string): string {
  return String(t ?? '')
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .trim();
}

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, z = 0): P3[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 72));
  const pts: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  return pts;
}

/** Bulge-segment mellom to polylinjepunkter (buer i LWPOLYLINE) */
function bulgePoints(p0: P3, p1: P3, bulge: number): P3[] {
  const theta = 4 * Math.atan(bulge);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0 || Math.abs(theta) < 1e-9) return [p1];
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const h = r * Math.cos(theta / 2);
  const ux = -dy / chord, uy = dx / chord;
  const cx = mx + ux * h, cy = my + uy * h;
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  const n = Math.max(4, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
  const pts: P3[] = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (theta * i) / n;
    const rr = Math.abs(r);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a), p0[2] + ((p1[2] - p0[2]) * i) / n]);
  }
  // Sørg for at siste punkt er nøyaktig endepunktet
  pts[pts.length - 1] = p1;
  return pts;
}

function planarLength(pts: P3[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

function planarArea(pts: P3[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}


/**
 * Fjerner entiteter i papirrom (gruppekode 67 = 1) fra ENTITIES-seksjonen før filen tolkes.
 * Gjøres på tekstnivå slik at det virker uavhengig av hva DXF-biblioteket tar med.
 */
export function stripPaperSpace(text: string): { text: string; removed: number } {
  if (!/^\s*67\s*\r?\n\s*1\s*$/m.test(text)) return { text, removed: 0 };
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0, removed = 0, inEntities = false;
  let skipChain = false; // underordnede VERTEX/ATTRIB/SEQEND følger moren
  while (i + 1 < lines.length) {
    if (lines[i].trim() !== '0') { out.push(lines[i], lines[i + 1]); i += 2; continue; }
    const type = lines[i + 1].trim();
    if (type === 'SECTION') {
      inEntities = lines[i + 2]?.trim() === '2' && lines[i + 3]?.trim() === 'ENTITIES';
      out.push(lines[i], lines[i + 1]); i += 2; continue;
    }
    if (type === 'ENDSEC' || !inEntities) { inEntities = false; out.push(lines[i], lines[i + 1]); i += 2; continue; }
    // Finn slutten på entiteten (neste gruppekode 0)
    let j = i + 2;
    while (j + 1 < lines.length && lines[j].trim() !== '0') j += 2;
    let paper = false;
    for (let k = i + 2; k + 1 < j; k += 2) if (lines[k].trim() === '67' && lines[k + 1].trim() === '1') { paper = true; break; }
    const child = type === 'VERTEX' || type === 'SEQEND' || type === 'ATTRIB';
    const drop = child ? skipChain : paper;
    if (!child) skipChain = paper;
    if (drop) { if (!child) removed++; } else for (let k = i; k < j; k++) out.push(lines[k]);
    i = j;
  }
  while (i < lines.length) out.push(lines[i++]);
  return { text: out.join('\n'), removed };
}

export function parseDxf(text: string, crs: string): ParsedDxf {
  const stripped = stripPaperSpace(text);
  const parser = new DxfParser();
  const dxf: any = parser.parseSync(stripped.text);
  if (!dxf) throw new Error('Kunne ikke lese DXF-filen');

  const layerTable: Record<string, any> = dxf.tables?.layer?.layers ?? {};
  const blocks: Record<string, any> = dxf.blocks ?? {};
  const features: DxfFeature[] = [];
  const skipped: Record<string, number> = {};
  const warnings: string[] = [];

  const layerColor = (name: string) => visible(hex(layerTable[name]?.color) ?? '#2b2f36');

  const colorOf = (e: any, inheritedColor?: string): string => {
    const idx = e.colorIndex;
    if (idx === 0 && inheritedColor) return inheritedColor; // BYBLOCK
    if (idx !== undefined && idx !== 256 && idx !== 0) {
      const c = hex(e.color);
      if (c) return visible(c);
    }
    return layerColor(e.layer ?? '0');
  };

  const toLL = (p: P3): [number, number] => toLatLng(crs, p[0], p[1]);

  const pushLine = (e: any, pts: P3[], closed: boolean, color: string, layer: string, block?: string) => {
    if (pts.length < 2) return;
    const geomPts = closed && pts.length > 2 ? pts : pts;
    features.push({
      layer,
      type: e.type,
      color,
      geom: closed && pts.length > 2 ? 'polygon' : 'line',
      latlngs: geomPts.map(toLL),
      z: pts.map((p) => p[2]),
      length: planarLength(pts, closed),
      area: closed && pts.length > 2 ? planarArea(pts) : undefined,
      block,
    });
  };

  const walk = (entities: any[], xf: Xf, depth: number, inheritedLayer?: string, inheritedColor?: string, block?: string, rot = 0) => {
    if (!entities) return;
    for (const e of entities) {
      // Entiteter på lag "0" inne i blokker arver laget til blokkreferansen
      const layer = e.layer && !(e.layer === '0' && inheritedLayer) ? e.layer : inheritedLayer ?? e.layer ?? '0';
      const color = colorOf({ ...e, layer }, inheritedColor);
      const v = (p: any): P3 => xf([p?.x ?? 0, p?.y ?? 0, p?.z ?? 0]);
      try {
        switch (e.type) {
          case 'LINE':
            pushLine(e, (e.vertices ?? []).map(v), false, color, layer, block);
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE': {
            const verts: any[] = e.vertices ?? [];
            if (verts.some((x) => x.faceA !== undefined)) { skipped['POLYFACE'] = (skipped['POLYFACE'] ?? 0) + 1; break; }
            const closed = !!e.shape;
            const elev = e.elevation ?? 0;
            const pts: P3[] = [];
            const n = verts.length;
            for (let i = 0; i < n; i++) {
              const cur = verts[i];
              const p = v({ x: cur.x, y: cur.y, z: cur.z ?? elev });
              if (i === 0) pts.push(p);
              const next = i + 1 < n ? verts[i + 1] : closed ? verts[0] : null;
              if (!next) break;
              const q = v({ x: next.x, y: next.y, z: next.z ?? elev });
              if (cur.bulge) pts.push(...bulgePoints(p, q, cur.bulge));
              else pts.push(q);
            }
            // Ved lukket polylinje er siste punkt lik første – fjern duplikat
            if (closed && pts.length > 2) pts.pop();
            pushLine(e, pts, closed, color, layer, block);
            break;
          }
          case 'CIRCLE': {
            const c = e.center;
            const pts = arcPoints(c.x, c.y, e.radius, 0, Math.PI * 2, c.z ?? 0).slice(0, -1).map((p) => xf(p));
            pushLine(e, pts, true, color, layer, block);
            break;
          }
          case 'ARC': {
            const c = e.center;
            const pts = arcPoints(c.x, c.y, e.radius, e.startAngle, e.endAngle, c.z ?? 0).map((p) => xf(p));
            pushLine(e, pts, false, color, layer, block);
            break;
          }
          case 'ELLIPSE': {
            const c = e.center, m = e.majorAxisEndPoint;
            const ratio = e.axisRatio ?? 1;
            const a = Math.hypot(m.x, m.y), b = a * ratio, ang = Math.atan2(m.y, m.x);
            let t0 = e.startAngle ?? 0, t1 = e.endAngle ?? Math.PI * 2;
            while (t1 <= t0) t1 += Math.PI * 2;
            const n = 72, pts: P3[] = [];
            for (let i = 0; i <= n; i++) {
              const t = t0 + ((t1 - t0) * i) / n;
              const x = a * Math.cos(t), y = b * Math.sin(t);
              pts.push(xf([c.x + x * Math.cos(ang) - y * Math.sin(ang), c.y + x * Math.sin(ang) + y * Math.cos(ang), c.z ?? 0]));
            }
            const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
            if (full) pts.pop();
            pushLine(e, pts, full, color, layer, block);
            break;
          }
          case 'SPLINE': {
            const src = e.fitPoints?.length ? e.fitPoints : e.controlPoints ?? [];
            pushLine(e, src.map(v), !!e.closed, color, layer, block);
            break;
          }
          case '3DFACE':
          case 'SOLID': {
            const src = e.vertices ?? e.points ?? [];
            let pts: P3[] = src.map(v);
            // SOLID lagres i rekkefølgen 1-2-4-3
            if (e.type === 'SOLID' && pts.length === 4) pts = [pts[0], pts[1], pts[3], pts[2]];
            pushLine(e, pts, true, color, layer, block);
            break;
          }
          case 'POINT': {
            const p = v(e.position);
            features.push({ layer, type: e.type, color, geom: 'point', latlngs: [toLL(p)], z: [p[2]], length: 0, block });
            break;
          }
          case 'TEXT':
          case 'MTEXT':
          case 'ATTRIB': {
            const pos = e.type === 'TEXT' || e.type === 'ATTRIB' ? (e.endPoint && (e.halign || e.valign) ? e.endPoint : e.startPoint) : e.position;
            if (!pos) break;
            const p = v(pos);
            const txt = cleanMText(e.text);
            if (!txt) break;
            features.push({
              layer, type: e.type, color, geom: 'text', latlngs: [toLL(p)], z: [p[2]], length: 0,
              text: txt, textHeight: e.textHeight ?? e.height, rotation: (e.rotation ?? 0) + rot, block,
            });
            break;
          }
          case 'INSERT': {
            const b = blocks[e.name];
            if (!b || depth > 6) break;
            const base = b.position ?? { x: 0, y: 0, z: 0 };
            const sx = e.xScale ?? 1, sy = e.yScale ?? 1, sz = e.zScale ?? 1;
            const r = ((e.rotation ?? 0) * Math.PI) / 180;
            const ins = e.position ?? { x: 0, y: 0, z: 0 };
            const cos = Math.cos(r), sin = Math.sin(r);
            const local: Xf = (p) => {
              const x = (p[0] - base.x) * sx, y = (p[1] - base.y) * sy, z = (p[2] - (base.z ?? 0)) * sz;
              return [ins.x + x * cos - y * sin, ins.y + x * sin + y * cos, (ins.z ?? 0) + z];
            };
            const composed: Xf = (p) => xf(local(p));
            walk(b.entities, composed, depth + 1, layer, color, block ?? e.name, rot + (e.rotation ?? 0));
            // Attributter på blokkreferansen
            if (Array.isArray(e.attribs)) walk(e.attribs, xf, depth + 1, layer, color, block ?? e.name, rot);
            break;
          }
          default:
            skipped[e.type] = (skipped[e.type] ?? 0) + 1;
        }
      } catch (err) {
        skipped[e.type + ' (feil)'] = (skipped[e.type + ' (feil)'] ?? 0) + 1;
      }
    }
  };

  // Bare modellrommet (Model space) skal med. Entiteter i papirrom/layout (rammer, tittelfelt, målestokk, viewporter)
  // er merket med gruppekode 67 = 1 og ligger i arkkoordinater (mm), ikke i kartkoordinater.
  const all: any[] = dxf.entities ?? [];
  const model = all.filter((e) => !(e.inPaperSpace || e.paperSpace) && e.type !== 'VIEWPORT');
  const paper = all.length - model.length + stripped.removed;
  walk(model, identity, 0);
  if (paper) warnings.push(`${paper} objekt(er) i papirrom (layout) ble utelatt. Bare modellrommet vises.`);

  // Lagoversikt
  const layerMap = new Map<string, DxfLayer>();
  for (const f of features) {
    const l = layerMap.get(f.layer);
    if (l) l.count++;
    else layerMap.set(f.layer, { name: f.layer, color: layerColor(f.layer), count: 1 });
  }
  const layers = [...layerMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));

  // Utstrekning: bruk 1.–99. persentil så enkeltobjekter langt unna (f.eks. i 0,0) ikke ødelegger zoom
  const lats: number[] = [], lngs: number[] = [];
  for (const f of features) for (const ll of f.latlngs) if (Number.isFinite(ll[0]) && Number.isFinite(ll[1])) { lats.push(ll[0]); lngs.push(ll[1]); }
  let bounds: ParsedDxf['bounds'] = null;
  if (lats.length) {
    lats.sort((a, b) => a - b); lngs.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
    bounds = [[q(lats, 0.01), q(lngs, 0.01)], [q(lats, 0.99), q(lngs, 0.99)]];
    const midLat = (bounds[0][0] + bounds[1][0]) / 2, midLng = (bounds[0][1] + bounds[1][1]) / 2;
    if (!(midLat > 55 && midLat < 82 && midLng > -10 && midLng < 35)) {
      warnings.push('Tegningen havner utenfor Norge. Sjekk at riktig koordinatsystem er valgt, og at tegningen er georeferert (ikke lokale koordinater).');
    }
  } else {
    warnings.push('Fant ingen geometri som kan vises.');
  }
  const skippedTypes = Object.keys(skipped);
  if (skippedTypes.length) warnings.push(`Ikke støttet/hoppet over: ${skippedTypes.map((t) => `${t} (${skipped[t]})`).join(', ')}`);

  return { features, layers, bounds, warnings, skipped };
}
