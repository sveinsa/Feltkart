// Felles byggeklosser for KOF, SOSI, LandXML og IFC. Resultatet har samme form som DXF-lesingen,
// slik at kartvisning, lagtre og objektinfo fungerer likt for alle formater.
import type { DxfFeature, DxfLayer, ParsedDxf } from '../dxf';

export type LL = (e: number, n: number) => [number, number];
export type XYZ = [number, number, number]; // øst, nord, høyde (NaN hvis ukjent)

const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2', '#6b7280', '#b5a300'];

export class Builder {
  features: DxfFeature[] = [];
  warnings: string[] = [];
  skipped: Record<string, number> = {};
  private layers = new Map<string, DxfLayer>();

  constructor(private ll: LL) {}

  skip(what: string, n = 1) { this.skipped[what] = (this.skipped[what] ?? 0) + n; }

  private layer(name: string): DxfLayer {
    let l = this.layers.get(name);
    if (!l) { l = { name, color: PALETTE[this.layers.size % PALETTE.length], count: 0 }; this.layers.set(name, l); }
    l.count++;
    return l;
  }

  private base(layer: string, type: string, geom: DxfFeature['geom'], pts: XYZ[], attrs?: Record<string, string>): DxfFeature {
    const l = this.layer(layer);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const f: DxfFeature = {
      layer, type, color: l.color, geom,
      latlngs: pts.map((p) => this.ll(p[0], p[1])),
      z: pts.map((p) => (Number.isFinite(p[2]) ? p[2] : 0)),
      length,
    };
    if (attrs && Object.keys(attrs).length) f.attrs = attrs;
    return f;
  }

  point(layer: string, type: string, p: XYZ, label?: string, attrs?: Record<string, string>) {
    this.features.push(this.base(layer, type, 'point', [p], attrs));
    if (label) {
      const t = this.base(layer, type, 'text', [p]);
      t.text = label; t.textHeight = 1; t.rotation = 0;
      this.features.push(t);
    }
  }

  line(layer: string, type: string, pts: XYZ[], attrs?: Record<string, string>) {
    if (pts.length < 2) return;
    this.features.push(this.base(layer, type, 'line', pts, attrs));
  }

  polygon(layer: string, type: string, pts: XYZ[], attrs?: Record<string, string>) {
    if (pts.length < 3) return;
    const ring = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
    if (ring.length < 3) return;
    const f = this.base(layer, type, 'polygon', ring, attrs);
    f.length += Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]);
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    f.area = Math.abs(a / 2);
    this.features.push(f);
  }

  text(layer: string, type: string, p: XYZ, text: string, rotation = 0) {
    const t = this.base(layer, type, 'text', [p]);
    t.text = text; t.textHeight = 1; t.rotation = rotation;
    this.features.push(t);
  }

  finish(crs: string): ParsedDxf {
    const layers = [...this.layers.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    const lats: number[] = [], lngs: number[] = [];
    for (const f of this.features) for (const p of f.latlngs) if (Number.isFinite(p[0]) && Number.isFinite(p[1])) { lats.push(p[0]); lngs.push(p[1]); }
    let bounds: ParsedDxf['bounds'] = null;
    if (lats.length) {
      lats.sort((a, b) => a - b); lngs.sort((a, b) => a - b);
      const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
      bounds = [[q(lats, 0.01), q(lngs, 0.01)], [q(lats, 0.99), q(lngs, 0.99)]];
      const midLat = (bounds[0][0] + bounds[1][0]) / 2, midLng = (bounds[0][1] + bounds[1][1]) / 2;
      if (!(midLat > 55 && midLat < 82 && midLng > -10 && midLng < 35)) {
        this.warnings.push('Dataene havner utenfor Norge. Sjekk at riktig koordinatsystem er valgt.');
      }
    } else {
      this.warnings.push('Fant ingen geometri som kan vises.');
    }
    const st = Object.keys(this.skipped);
    if (st.length) this.warnings.push(`Hoppet over: ${st.map((t) => `${t} (${this.skipped[t]})`).join(', ')}`);
    return { features: this.features, layers, bounds, warnings: this.warnings, skipped: this.skipped, crs };
  }
}

/** Bue gjennom tre punkter (SOSI .BUEP). Faller tilbake til rette linjer hvis punktene ligger på linje. */
export function arcThrough(a: XYZ, b: XYZ, c: XYZ, steps = 24): XYZ[] {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return [a, b, c];
  const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
  const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  const ang = (p: XYZ) => Math.atan2(p[1] - uy, p[0] - ux);
  const TAU = Math.PI * 2;
  const a1 = ang(a), a2 = ang(b), a3 = ang(c);
  const s12 = (((a2 - a1) % TAU) + TAU) % TAU;
  const s13 = (((a3 - a1) % TAU) + TAU) % TAU;
  const sweep = s12 <= s13 ? s13 : s13 - TAU;
  const out: XYZ[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang_ = a1 + sweep * t;
    const z = Number.isFinite(a[2]) && Number.isFinite(c[2]) ? a[2] + (c[2] - a[2]) * t : NaN;
    out.push([ux + r * Math.cos(ang_), uy + r * Math.sin(ang_), z]);
  }
  return out;
}

/** Leser tekstfil med fornuftig tegnsett (UTF-8, ellers ISO-8859 etter TEGNSETT i SOSI-hodet, ellers Windows-1252). */
export function decodeSmart(u8: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { /* ikke UTF-8 */ }
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 6000));
  const m = /TEGNSETT\s+([A-Za-z0-9_-]+)/i.exec(head);
  const wanted = m ? m[1].toUpperCase().replace(/^ISO[_-]?8859/, 'ISO-8859') : '';
  for (const enc of [wanted, 'windows-1252', 'latin1']) {
    if (!enc) continue;
    try { return new TextDecoder(enc).decode(u8); } catch { /* prøv neste */ }
  }
  return new TextDecoder('latin1').decode(u8);
}
