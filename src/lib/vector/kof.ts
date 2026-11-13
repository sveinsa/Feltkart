// KOF (Norkart/GIS-Line koordinatfil). Post 05 = koordinatblokk: punktnavn, temakode, X (nord), Y (øst), H.
import { Builder, type LL, type XYZ } from './builder';
import type { ParsedDxf } from '../dxf';

export function parseKof(text: string, crs: string, ll: LL): ParsedDxf {
  const b = new Builder(ll);
  interface Row { name: string; code: string; a: number; b: number; h: number }
  const rows: Row[] = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^[\s-]*05\s+(\S.*)$/.exec(raw);
    if (!m) continue;
    const tok = m[1].trim().split(/\s+/);
    const dec = tok.findIndex((t, i) => i > 0 && /^-?\d+\.\d+$/.test(t));
    let ci = dec;
    if (ci < 0) ci = tok.findIndex((t, i) => i > 0 && i + 1 < tok.length && /^-?\d+$/.test(t) && /^-?\d+$/.test(tok[i + 1]) && Math.abs(+t) > 1000);
    if (ci < 1 || ci + 1 >= tok.length) { bad++; continue; }
    const a = parseFloat(tok[ci]), c = parseFloat(tok[ci + 1]);
    const h = ci + 2 < tok.length && /^-?\d+(\.\d+)?$/.test(tok[ci + 2]) ? parseFloat(tok[ci + 2]) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(c)) { bad++; continue; }
    rows.push({ name: tok[0], code: ci > 1 ? tok.slice(1, ci).join(' ') : '', a, b: c, h });
  }
  if (!rows.length) throw new Error('Fant ingen koordinatposter (05) i KOF-filen.');
  // KOF har normalt X = nord først, deretter Y = øst. Noen filer er skrevet motsatt, så vi avgjør etter størrelse.
  const northFirst = rows.filter((r) => r.a > r.b).length >= rows.length / 2;
  if (!northFirst) b.warnings.push('Koordinatene ser ut til å stå som Y (øst) før X (nord). Byttet om automatisk.');
  // Enkeltpunkter langt unna resten (typisk feilskrevet koordinat) rettes hvis det hjelper å bytte øst/nord, ellers hoppes de over.
  const E = (r: Row) => (northFirst ? r.b : r.a), N = (r: Row) => (northFirst ? r.a : r.b);
  const med = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const mE = med(rows.map(E)), mN = med(rows.map(N));
  const FAR = 20000; // meter
  const far = (e: number, n: number) => Math.hypot(e - mE, n - mN) > FAR;
  let fixed = 0, dropped = 0;
  for (let i = rows.length - 1; i >= 0 && rows.length > 2; i--) {
    const r = rows[i];
    if (!far(E(r), N(r))) continue;
    if (!far(N(r), E(r))) { const t = r.a; r.a = r.b; r.b = t; fixed++; } else { rows.splice(i, 1); dropped++; }
  }
  if (fixed) b.warnings.push(`${fixed} punkt hadde byttet øst/nord og ble rettet.`);
  if (dropped) b.warnings.push(`${dropped} punkt lå mer enn ${FAR / 1000} km fra de andre punktene (feil koordinat?) og ble utelatt.`);
  for (const r of rows) {
    const e = northFirst ? r.b : r.a, n = northFirst ? r.a : r.b;
    const p: XYZ = [e, n, r.h];
    const attrs: Record<string, string> = { Punkt: r.name };
    if (r.code) attrs.Kode = r.code;
    if (Number.isFinite(r.h)) attrs.Høyde = r.h.toFixed(3);
    b.point(r.code ? `Kode ${r.code}` : 'Punkter', 'KOF-punkt', p, Number.isFinite(r.h) ? `${r.name}\n${r.h.toFixed(2)}` : r.name, attrs);
  }
  if (bad) b.warnings.push(`${bad} linje(r) med post 05 kunne ikke leses.`);
  b.warnings.push(`${rows.length} punkter lest. KOF inneholder punkter, ingen linjer.`);
  return b.finish(crs);
}
