// Eksport av innmålte punkter til KOF, SOSI, LandXML og CSV i valgt koordinatsystem.
import { crsName } from '../crs';
import { QUALITY_LABEL } from './nmea';
import { localDate, pointEN, safe, stamp, toCsv, toKof, type FieldPoint } from './survey';

export type ExportFormat = 'kof' | 'sosi' | 'landxml' | 'csv';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: 'kof', label: 'KOF', ext: 'kof', mime: 'text/plain' },
  { id: 'sosi', label: 'SOSI', ext: 'sos', mime: 'text/plain' },
  { id: 'landxml', label: 'LandXML', ext: 'xml', mime: 'application/xml' },
  { id: 'csv', label: 'CSV (Excel)', ext: 'csv', mime: 'text/csv' },
];

/** SOSI-kode for ..KOORDSYS: EUREF89 UTM sone 31–36 (samme koder som leses ved opplasting) */
const SOSI_KOORDSYS: Record<string, number> = {
  'EPSG:25831': 21, 'EPSG:25832': 22, 'EPSG:25833': 23, 'EPSG:25834': 24, 'EPSG:25835': 25, 'EPSG:25836': 26,
};
export const sosiSupported = (crs: string) => crs in SOSI_KOORDSYS;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SOSI 4.0 punktfil: ett .PUNKT-objekt per punkt, koordinater som nord øst høyde i millimeter (ENHET 0.001) */
export function toSosi(points: FieldPoint[], crs: string): string {
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
    if (p.h !== null) L.push('..NØH', `${mm(n)} ${mm(e)} ${mm(p.h)}`);
    else L.push('..NØ', `${mm(n)} ${mm(e)}`);
  });
  L.push('.SLUTT');
  return L.join('\n') + '\n';
}

/** LandXML 1.2: punkter i <CgPoints>. Koordinater står som nord øst høyde. */
export function toLandXml(points: FieldPoint[], crs: string, version = '', now = new Date()): string {
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
    const desc = `${QUALITY_LABEL[p.quality]}${p.estimated ? ' (anslått)' : ''}${p.accH !== null ? ` ±${(p.accH * 100).toFixed(1)} cm` : ''}, stang ${p.poleHeight.toFixed(3)} m`;
    const coords = [n.toFixed(3), e.toFixed(3)].concat(p.h !== null ? [p.h.toFixed(3)] : []).join(' ');
    L.push(`    <CgPoint name="${esc(p.name)}"${p.code.trim() ? ` code="${esc(p.code.trim())}"` : ''} desc="${esc(desc)}" timeStamp="${esc(p.time)}">${coords}</CgPoint>`);
  }
  L.push('  </CgPoints>', '</LandXML>');
  return L.join('\n') + '\n';
}

export interface BuiltExport { name: string; mime: string; text: string; count: number }

/** Lager filen som skal lastes ned. `crs` er koordinatsystemet punktene skrives i. */
export function buildExport(format: ExportFormat, points: FieldPoint[], crs: string, version = ''): BuiltExport {
  const f = EXPORT_FORMATS.find((x) => x.id === format)!;
  const text = format === 'kof' ? toKof(points, crs) : format === 'sosi' ? toSosi(points, crs) : format === 'landxml' ? toLandXml(points, crs, version) : toCsv(points, crs);
  return { name: `Innmaaling_${stamp()}.${f.ext}`, mime: f.mime, text, count: points.length };
}
