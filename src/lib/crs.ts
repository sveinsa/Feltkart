// Koordinatsystemer brukt i norske anleggsprosjekter.
import proj4 from 'proj4';

export interface CrsInfo {
  code: string;
  name: string;
}

const TOWGS = '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

proj4.defs('EPSG:25832', `+proj=utm +zone=32 ${TOWGS}`);
proj4.defs('EPSG:25833', `+proj=utm +zone=33 ${TOWGS}`);
proj4.defs('EPSG:25835', `+proj=utm +zone=35 ${TOWGS}`);
// Sonene under brukes bare når en fil oppgir dem selv (SOSI, LandXML, IFC)
proj4.defs('EPSG:25831', `+proj=utm +zone=31 ${TOWGS}`);
proj4.defs('EPSG:25834', `+proj=utm +zone=34 ${TOWGS}`);
proj4.defs('EPSG:25836', `+proj=utm +zone=36 ${TOWGS}`);

export const CRS_LIST: CrsInfo[] = [
  { code: 'EPSG:25832', name: 'EUREF89 UTM sone 32' },
  { code: 'EPSG:25833', name: 'EUREF89 UTM sone 33' },
  { code: 'EPSG:25835', name: 'EUREF89 UTM sone 35' },
];

// EUREF89 NTM sone 5–30 (EPSG:5105–5130)
for (let zone = 5; zone <= 30; zone++) {
  const code = `EPSG:${5100 + zone}`;
  proj4.defs(code, `+proj=tmerc +lat_0=58 +lon_0=${zone}.5 +k=1 +x_0=100000 +y_0=1000000 ${TOWGS}`);
  CRS_LIST.push({ code, name: `EUREF89 NTM sone ${zone}` });
}

CRS_LIST.push({ code: 'EPSG:4326', name: 'WGS84 lengde/bredde (grader)' });

/** Sørger for at en EPSG-kode er kjent. Støtter i tillegg WGS84 UTM (326xx/327xx). */
export function ensureCrs(code: string): boolean {
  if (proj4.defs(code)) return true;
  const m = /^EPSG:(32[67])(\d{2})$/.exec(code);
  if (m) {
    const south = m[1] === '327' ? ' +south' : '';
    proj4.defs(code, `+proj=utm +zone=${+m[2]}${south} +datum=WGS84 +units=m +no_defs`);
    return true;
  }
  return false;
}

export function crsName(code: string): string {
  return CRS_LIST.find((c) => c.code === code)?.name ?? code;
}

const converters = new Map<string, proj4.Converter>();
function conv(from: string, to: string): proj4.Converter {
  const key = from + '>' + to;
  let c = converters.get(key);
  if (!c) {
    ensureCrs(from);
    ensureCrs(to);
    c = proj4(from, to);
    converters.set(key, c);
  }
  return c;
}

/** Prosjektkoordinater (øst, nord) → [lat, lng] */
export function toLatLng(crs: string, x: number, y: number): [number, number] {
  const [lng, lat] = conv(crs, 'EPSG:4326').forward([x, y]);
  return [lat, lng];
}

/** [lat, lng] → prosjektkoordinater [øst, nord] */
export function fromLatLng(crs: string, lat: number, lng: number): [number, number] {
  const [x, y] = conv('EPSG:4326', crs).forward([lng, lat]);
  return [x, y];
}

export function transform(from: string, to: string, x: number, y: number): [number, number] {
  const [a, b] = conv(from, to).forward([x, y]);
  return [a, b];
}

/**
 * Koordinatsystem som brukes til å måle avstand og areal. Prosjektets eget system brukes når det er et
 * metersystem; er prosjektet satt til grader (WGS84) velges UTM-sonen ut fra lengdegraden.
 */
export function measureCrs(projectCrs: string, lng: number): string {
  if (projectCrs && projectCrs !== 'EPSG:4326') return projectCrs;
  const zone = Math.floor((lng + 180) / 6) + 1;
  return `EPSG:258${zone >= 31 && zone <= 36 ? zone : 33}`;
}

/** Punkter (bredde/lengde, evt. høyde) → meter i målekoordinatsystemet, klare for målefunksjonene i measure.ts */
export function pointsToMeters(
  projectCrs: string,
  pts: { lat: number; lng: number; z?: number | null }[],
): { crs: string; pts: { x: number; y: number; z?: number | null }[] } {
  const crs = measureCrs(projectCrs, pts[0]?.lng ?? 10);
  return { crs, pts: pts.map((p) => { const [x, y] = fromLatLng(crs, p.lat, p.lng); return { x, y, z: p.z }; }) };
}

const nf2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf6 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

export function formatProjected(crs: string, lat: number, lng: number): { e: string; n: string } {
  if (crs === 'EPSG:4326') return { e: nf6.format(lng), n: nf6.format(lat) };
  const [x, y] = fromLatLng(crs, lat, lng);
  return { e: nf2.format(x), n: nf2.format(y) };
}

export const fmt = {
  m: (v: number) => `${nf2.format(v)} m`,
  m2: (v: number) => `${nf2.format(v)} m²`,
  num: (v: number, d = 2) => new Intl.NumberFormat('nb-NO', { maximumFractionDigits: d }).format(v),
};
