// Standardfarger per IFC-klasse (brukes når IFC-filen ikke har egne farger, eller brukeren velger standardfarger).
export const LAYER_COLORS: Record<string, string> = {
  Vegger: '#d9d4c7', 'Dekker og plater': '#b9bcc0', Tak: '#b5524a', Bjelker: '#8a8f98', Søyler: '#8a8f98', Vinduer: '#8cc7e8', Glassfasader: '#8cc7e8',
  Dører: '#9b6b43', Trapper: '#a7a39a', Rekkverk: '#6e7378', Fundamenter: '#9d9a94', Peler: '#9d9a94', Rør: '#3d7ea6', Ledninger: '#3d7ea6',
  Kummer: '#4f6b8a', 'Terreng og geografi': '#8fa77a', Veg: '#555a60', Overbygning: '#555a60', Anleggsobjekter: '#c08a3e', Masseforflytning: '#b89a6b',
};
export const colorFor = (layer: string) => LAYER_COLORS[layer] ?? '#c9ccd1';

/** Fargen som heltall (0xRRGGBB) fra #rrggbb */
export const hexNum = (css: string) => parseInt(css.replace('#', '').slice(0, 6), 16) || 0;
/** #rrggbb fra heltall */
export const hexCss = (n: number) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
/** Mørkere utgave av en farge (til omriss i kartet) */
export function darken(n: number, f = 0.62): number {
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return (r << 16) | (g << 8) | b;
}
