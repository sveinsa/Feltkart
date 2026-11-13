// Felles inngang for alle vektorformater som vises som «prosjekterte data» i kartet.
import { parseDxf, type ParsedDxf } from '../dxf';
import { ensureCrs, toLatLng } from '../crs';
import { decodeSmart, type LL } from './builder';
import { parseKof } from './kof';
import { parseSosi } from './sosi';
import { isLandXml, parseLandXml } from './landxml';
import { parseIfc, type Placement } from './ifc';

export type VectorFormat = 'dxf' | 'kof' | 'sosi' | 'landxml' | 'ifc';
export type { Placement };

export const FORMAT_LABEL: Record<VectorFormat, string> = { dxf: 'DXF', kof: 'KOF', sosi: 'SOSI', landxml: 'LandXML', ifc: 'IFC' };
export const VECTOR_ACCEPT = '.dxf,.kof,.sos,.sosi,.xml,.ifc';

/** Filformat ut fra filnavn. .xml regnes som LandXML (innholdet sjekkes ved lesing). */
export function vectorFormatOf(name: string): VectorFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  switch (m?.[1].toLowerCase()) {
    case 'dxf': return 'dxf';
    case 'kof': return 'kof';
    case 'sos': case 'sosi': return 'sosi';
    case 'xml': return 'landxml';
    case 'ifc': return 'ifc';
    default: return null;
  }
}

export const isVectorFile = (f: { name: string }) => vectorFormatOf(f.name) !== null;

const mkLl = (crs: string): LL => { ensureCrs(crs); return (e, n) => toLatLng(crs, e, n); };

export interface VectorOptions {
  /** true: la filen overstyre koordinatsystemet hvis den oppgir sitt eget (ved opplasting). false: bruk valgt system. */
  detect?: boolean;
  placement?: Placement;
  onProgress?: (m: string) => void;
}

/** Leser en fil og gir kartobjekter. Resultatets `crs` er systemet filen ble lest i. */
export async function parseVector(blob: Blob, format: VectorFormat, crs: string, opts: VectorOptions = {}): Promise<ParsedDxf> {
  const detect = opts.detect ?? false;
  if (format === 'ifc') return parseIfc(await blob.arrayBuffer(), crs, mkLl, detect, opts.placement, opts.onProgress);
  const text = decodeSmart(new Uint8Array(await blob.arrayBuffer()));
  switch (format) {
    case 'dxf': { const r = parseDxf(text, crs); r.crs = crs; return r; }
    case 'kof': return parseKof(text, crs, mkLl(crs));
    case 'sosi': return parseSosi(text, crs, mkLl, detect);
    case 'landxml':
      if (!isLandXml(text)) throw new Error('XML-filen er ikke LandXML. Bare LandXML støttes.');
      return parseLandXml(text, crs, mkLl, detect);
  }
}
