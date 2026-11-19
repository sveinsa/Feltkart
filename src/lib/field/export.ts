// Eksport av innmålte punkter til KOF, SOSI, LandXML og CSV i valgt koordinatsystem.
import { crsName } from '../crs';
import { QUALITY_LABEL } from './nmea';
import { localDate, pointEN, safe, stamp, toCsv, toKof, type ExportPoint } from './survey';

export type ExportFormat = 'kof' | 'sosi' | 'landxml' | 'csv' | 'dxf';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: 'kof', label: 'KOF', ext: 'kof', mime: 'text/plain' },
  { id: 'sosi', label: 'SOSI', ext: 'sos', mime: 'text/plain' },
  { id: 'landxml', label: 'LandXML', ext: 'xml', mime: 'application/xml' },
  { id: 'csv', label: 'CSV (Excel)', ext: 'csv', mime: 'text/csv' },
  { id: 'dxf', label: 'DXF (AutoCAD)', ext: 'dxf', mime: 'application/dxf' },
];

/** SOSI-kode for ..KOORDSYS: EUREF89 UTM sone 31–36 (samme koder som leses ved opplasting) */
const SOSI_KOORDSYS: Record<string, number> = {
  'EPSG:25831': 21, 'EPSG:25832': 22, 'EPSG:25833': 23, 'EPSG:25834': 24, 'EPSG:25835': 25, 'EPSG:25836': 26,
};
export const sosiSupported = (crs: string) => crs in SOSI_KOORDSYS;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SOSI 4.0 punktfil: ett .PUNKT-objekt per punkt, koordinater som nord øst høyde i millimeter (ENHET 0.001) */
export function toSosi(points: ExportPoint[], crs: string): string {
  const code = SOSI_KOORDSYS[crs];
  if (!code) throw new Error('SOSI støttes her bare i EUREF89 UTM (sone 31–36). Velg et UTM-system, eller bruk KOF eller LandXML.');
  const mm = (v: number) => String(Math.round(v * 1000));
  const rows = points.map((p) => { const [e, n] = pointEN(p, crs); return { p, e, n }; });
  const L: string[] = ['.HODE', '..TEGNSETT UTF-8', '..TRANSPAR', `...KOORDSYS ${code}`, '...ORIGO-NØ 0 0', '...ENHET 0.001'];
  if (rows.length) {
    const ns = rows.map((r) => r.n), es = rows.map((r) => r.e);
    L.push('..OMRÅDE', `...MIN-NØ ${mm(Math.min(...ns))} ${mm(Math.min(...es))}`, `...MAX-NØ ${mm(Math.max(...ns))} ${mm(Math.max(...es))}`);
  }
  L.push('..SOSI-VERSJON 4.0', '..SOSI-NIVÅ 4');
  rows.forEach(({ p, e, n }, i) => {
    L.push(`.PUNKT ${i + 1}:`, '..OBJTYPE Innmaaling', `..PUNKTNAVN ${safe(p.name)}`);
    if (p.code.trim()) L.push(`..KODE ${safe(p.code)}`);
    L.push(`..DATAFANGSTDATO ${localDate(p.time).replace(/-/g, '')}`);
    if (p.poleHeight !== undefined) L.push(`..STANGHØYDE ${p.poleHeight.toFixed(3)}`);
    if (p.quality) L.push(`..KVALITET ${QUALITY_LABEL[p.quality]}${p.estimated ? ' (anslått)' : ''}`);
    if (p.accH != null) L.push(`..USIKKERHET-H ${p.accH.toFixed(3)}`);
    if (p.pdop != null) L.push(`..PDOP ${p.pdop.toFixed(2)}`);
    if (p.hdop != null) L.push(`..HDOP ${p.hdop.toFixed(2)}`);
    if (p.vdop != null) L.push(`..VDOP ${p.vdop.toFixed(2)}`);
    if (p.user?.trim()) L.push(`..BRUKER ${p.user.trim().replace(/\s+/g, ' ')}`);
    if (p.h !== null) L.push('..NØH', `${mm(n)} ${mm(e)} ${mm(p.h)}`);
    else L.push('..NØ', `${mm(n)} ${mm(e)}`);
  });
  L.push('.SLUTT');
  return L.join('\n') + '\n';
}

/** LandXML 1.2: punkter i <CgPoints>. Koordinater står som nord øst høyde. */
export function toLandXml(points: ExportPoint[], crs: string, version = '', now = new Date()): string {
  const epsg = /(\d{4,5})$/.exec(crs)?.[1] ?? '';
  const d = localDate(now.toISOString());
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const L: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${d}" time="${t}" language="Norwegian">`,
    '  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPa"/></Units>',
    `  <CoordinateSystem name="${esc(crsName(crs))}"${epsg ? ` epsgCode="${epsg}"` : ''}/>`,
    '  <Project name="Feltkart innmåling"/>',
    `  <Application name="Feltkart" desc="Innmåling med RTK-GNSS"${version ? ` version="${esc(version)}"` : ''}/>`,
    '  <CgPoints name="Innmåling">',
  ];
  for (const p of points) {
    const [e, n] = pointEN(p, crs);
    const parts: string[] = [];
    if (p.quality) parts.push(`${QUALITY_LABEL[p.quality]}${p.estimated ? ' (anslått)' : ''}${p.accH != null ? ` ±${(p.accH * 100).toFixed(1)} cm` : ''}`);
    if (p.poleHeight !== undefined) parts.push(`stang ${p.poleHeight.toFixed(3)} m`);
    const desc = parts.join(', ');
    const coords = [n.toFixed(3), e.toFixed(3)].concat(p.h !== null ? [p.h.toFixed(3)] : []).join(' ');
    const props: [string, string][] = [];
    if (p.poleHeight !== undefined) props.push(['Stanghøyde', p.poleHeight.toFixed(3)]);
    if (p.pdop != null) props.push(['PDOP', p.pdop.toFixed(2)]);
    if (p.hdop != null) props.push(['HDOP', p.hdop.toFixed(2)]);
    if (p.vdop != null) props.push(['VDOP', p.vdop.toFixed(2)]);
    if (p.user?.trim()) props.push(['Bruker', p.user.trim()]);
    if (p.quality) props.push(['Kvalitet', `${QUALITY_LABEL[p.quality]}${p.estimated ? ' (anslått)' : ''}`]);
    const open = `    <CgPoint name="${esc(p.name)}"${p.code.trim() ? ` code="${esc(p.code.trim())}"` : ''}${desc ? ` desc="${esc(desc)}"` : ''} timeStamp="${esc(p.time)}">${coords}`;
    if (props.length) L.push(open, `      <Feature code="Feltkart">${props.map(([k, v]) => `<Property label="${esc(k)}" value="${esc(v)}"/>`).join('')}</Feature>`, '    </CgPoint>');
    else L.push(`${open}</CgPoint>`);
  }
  L.push('  </CgPoints>', '</LandXML>');
  return L.join('\n') + '\n';
}

/** Bokstaver DXF R12 ikke kan lagre: æøå m.m. skrives som \U+XXXX i tekst, og forenkles i lagnavn. */
const dxfText = (t: string) => t.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const TRANSLIT: Record<string, string> = { æ: 'ae', ø: 'o', å: 'aa', Æ: 'AE', Ø: 'O', Å: 'AA' };
export const dxfLayerName = (code: string) => {
  const c = code.trim() ? code.trim().replace(/[æøåÆØÅ]/g, (m) => TRANSLIT[m]).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_\-$]/g, '_').slice(0, 31) : '';
  return c || 'UTEN_KODE';
};

/**
 * DXF (R12, ASCII) som åpnes i AutoCAD, Civil 3D, BricsCAD og alle kartprogrammer.
 * Hvert punkt blir et POINT i et lag oppkalt etter koden, pluss en TEXT med punktnavn og høyde.
 * X = øst, Y = nord, Z = høyde (0 hvis høyde mangler).
 */
export function toDxf(points: ExportPoint[], crs: string): string {
  const g: string[] = [];
  const w = (code: number, v: string | number) => { g.push(String(code), String(v)); };
  const layers = [...new Set(points.map((p) => dxfLayerName(p.code)))].sort();
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, 6); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES');
  w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1); w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, 0); w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.length + 1);
  for (const l of ['0', ...layers]) { w(0, 'LAYER'); w(2, l); w(70, 0); w(62, 7); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  for (const p of points) {
    const [e, n] = pointEN(p, crs);
    const layer = dxfLayerName(p.code);
    const z = p.h ?? 0;
    w(0, 'POINT'); w(8, layer); w(10, e.toFixed(3)); w(20, n.toFixed(3)); w(30, z.toFixed(3));
    w(0, 'TEXT'); w(8, layer); w(10, (e + 0.3).toFixed(3)); w(20, (n + 0.3).toFixed(3)); w(30, z.toFixed(3)); w(40, 0.5);
    w(1, dxfText(p.h !== null ? `${p.name}  ${p.h.toFixed(2)}` : p.name));
  }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return g.join('\r\n') + '\r\n';
}

export interface BuiltExport { name: string; mime: string; text: string; count: number }

/** Lager filen som skal lastes ned. `crs` er koordinatsystemet punktene skrives i. */
export function buildExport(format: ExportFormat, points: ExportPoint[], crs: string, version = ''): BuiltExport {
  const f = EXPORT_FORMATS.find((x) => x.id === format)!;
  const text = format === 'kof' ? toKof(points, crs) : format === 'sosi' ? toSosi(points, crs) : format === 'landxml' ? toLandXml(points, crs, version) : format === 'dxf' ? toDxf(points, crs) : toCsv(points, crs);
  return { name: `Innmaaling_${stamp()}.${f.ext}`, mime: f.mime, text, count: points.length };
}
