// NMEA 0183: leser GGA (posisjon, høyde, RTK-status), GST (nøyaktighet), RMC (fart/kurs) og GSA (PDOP) fra en GNSS-mottaker (f.eks. Leica FLX100).
export type FixQuality = 'none' | 'gps' | 'dgps' | 'float' | 'fix';

export interface Gga {
  type: 'GGA';
  time: string; // «hhmmss.ss» slik mottakeren sender den
  lat: number;
  lng: number;
  /** Høyde over geoiden (MSL) i meter, slik mottakeren er satt opp */
  alt: number | null;
  /** Geoidehøyde (N). Ellipsoidehøyde h = alt + sep */
  sep: number | null;
  /** NMEA-kvalitet: 0 ingen, 1 GPS, 2 DGPS, 4 RTK fix, 5 RTK float … */
  q: number;
  sats: number;
  hdop: number | null;
  /** Alder på korreksjonsdata (sekunder) */
  age: number | null;
}
export interface Gst { type: 'GST'; time: string; rms: number | null; sigLat: number | null; sigLng: number | null; sigAlt: number | null }
export interface Rmc { type: 'RMC'; valid: boolean; speed: number | null; course: number | null }
export interface Gsa { type: 'GSA'; pdop: number | null; hdop: number | null; vdop: number | null }
export type Nmea = Gga | Gst | Rmc | Gsa;

/** Kontrollsum: XOR av alle tegn mellom «$» og «*». Linjer uten kontrollsum godtas ikke. */
export function checksumOk(line: string): boolean {
  const m = /^\$([^*]+)\*([0-9A-Fa-f]{2})\s*$/.exec(line.trim());
  if (!m) return false;
  let x = 0;
  for (let i = 0; i < m[1].length; i++) x ^= m[1].charCodeAt(i);
  return x === parseInt(m[2], 16);
}

export function makeSentence(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return `$${body}*${x.toString(16).toUpperCase().padStart(2, '0')}`;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** ddmm.mmmm / dddmm.mmmm + N/S/E/W → desimalgrader */
export function nmeaAngle(v: string, hemi: string): number | null {
  const m = /^(\d+)(\d\d\.\d+)$/.exec(v);
  if (!m) return null;
  const deg = Number(m[1]) + Number(m[2]) / 60;
  if (!Number.isFinite(deg)) return null;
  return hemi === 'S' || hemi === 'W' ? -deg : deg;
}

export function parseNmea(line: string): Nmea | null {
  const s = line.trim();
  if (!checksumOk(s)) return null;
  const f = s.slice(1, s.indexOf('*')).split(',');
  const id = f[0].slice(-3);
  if (id === 'GGA') {
    const lat = nmeaAngle(f[2], f[3]);
    const lng = nmeaAngle(f[4], f[5]);
    const q = Number(f[6]);
    if (!Number.isFinite(q)) return null;
    if (q === 0 || lat === null || lng === null) return { type: 'GGA', time: f[1] ?? '', lat: NaN, lng: NaN, alt: null, sep: null, q: 0, sats: Number(f[7]) || 0, hdop: num(f[8]), age: num(f[13]) };
    return { type: 'GGA', time: f[1] ?? '', lat, lng, alt: num(f[9]), sep: num(f[11]), q, sats: Number(f[7]) || 0, hdop: num(f[8]), age: num(f[13]) };
  }
  if (id === 'GST') return { type: 'GST', time: f[1] ?? '', rms: num(f[2]), sigLat: num(f[6]), sigLng: num(f[7]), sigAlt: num(f[8]) };
  if (id === 'RMC') return { type: 'RMC', valid: f[2] === 'A', speed: num(f[7]) === null ? null : num(f[7])! * 0.514444, course: num(f[8]) };
  if (id === 'GSA') return { type: 'GSA', pdop: num(f[15]), hdop: num(f[16]), vdop: num(f[17]?.split('*')[0]) };
  return null;
}

export function qualityOf(q: number): FixQuality {
  if (q === 4) return 'fix';
  if (q === 5) return 'float';
  if (q === 2) return 'dgps';
  if (q === 1 || q === 3 || q === 6 || q === 7) return 'gps';
  return 'none';
}

export const QUALITY_LABEL: Record<FixQuality, string> = {
  none: 'Ingen posisjon', gps: 'GPS (ukorrigert)', dgps: 'DGPS', float: 'RTK Float', fix: 'RTK Fix',
};

/** Setter sammen tekstbiter fra Bluetooth til hele linjer (en linje kan komme i flere deler). */
export class LineSplitter {
  private buf = '';
  feed(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let i: number;
    while ((i = this.buf.search(/[\r\n]/)) >= 0) {
      const l = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (l) out.push(l);
    }
    if (this.buf.length > 600) this.buf = ''; // søppel uten linjeskift
    return out;
  }
}
