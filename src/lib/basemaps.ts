export interface Basemap {
  id: string;
  group: 'Kart' | 'Ortofoto' | 'Ingen';
  name: string;
  url: string | null;
  attribution: string;
  maxNativeZoom?: number;
  dark?: boolean; // lys tekst/ikoner passer best over denne bakgrunnen
}

// Merk: «Norge i bilder» er ikke lenger åpent tilgjengelig (krever pålogging hos Geonorge). Bruk «Egen bakgrunn» i Innstillinger hvis du har tilgang.
// Merk: Sjekk vilkårene til hver tjeneste før offentlig bruk med mye trafikk (se README).
export const BASEMAPS: Basemap[] = [
  {
    id: 'kv-topo',
    group: 'Kart',
    name: 'Kartverket topografisk',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attribution: '© <a href="https://www.kartverket.no/">Kartverket</a>',
    maxNativeZoom: 18,
  },
  {
    id: 'kv-gra',
    group: 'Kart',
    name: 'Kartverket gråtone',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
    attribution: '© <a href="https://www.kartverket.no/">Kartverket</a>',
    maxNativeZoom: 18,
  },
  {
    id: 'osm',
    group: 'Kart',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsytere',
    maxNativeZoom: 19,
  },
  {
    id: 'esri',
    group: 'Ortofoto',
    name: 'Esri verdensbilder',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
    dark: true,
  },
  {
    id: 'none',
    group: 'Ingen',
    name: 'Ingen bakgrunn',
    url: null,
    attribution: '',
  },
];

/** Egendefinert bakgrunn (XYZ/WMTS-URL med {z}/{x}/{y}) som brukeren selv har lagt inn under Innstillinger. */
export interface CustomBasemap { name: string; url: string; maxNativeZoom?: number }

export const customToBasemap = (c?: CustomBasemap | null): Basemap | null =>
  c && c.url.trim()
    ? { id: 'custom', group: 'Ortofoto', name: c.name.trim() || 'Egen bakgrunn', url: c.url.trim(), attribution: '', maxNativeZoom: c.maxNativeZoom ?? 19, dark: true }
    : null;

export const basemapById = (id: string, custom?: CustomBasemap | null): Basemap => {
  // «Norge i bilder» (åpen tjeneste hos Kartverket) finnes ikke lenger – bruk Esri-ortofoto i stedet
  if (id === 'nib') id = 'esri';
  if (id === 'custom') return customToBasemap(custom) ?? BASEMAPS[0];
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
};
