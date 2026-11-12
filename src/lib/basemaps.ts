export interface Basemap {
  id: string;
  group: 'Kart' | 'Ortofoto' | 'Ingen';
  name: string;
  url: string | null;
  attribution: string;
  maxNativeZoom?: number;
  dark?: boolean; // lys tekst/ikoner passer best over denne bakgrunnen
}

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
    id: 'nib',
    group: 'Ortofoto',
    name: 'Norge i bilder',
    url:
      'https://opencache.statkart.no/gatekeeper/gk/gk.open_nib_web_mercator_wmts_v2?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Nibcache_web_mercator_v2&STYLE=default&FORMAT=image/jpgpng&TILEMATRIXSET=default028mm&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    attribution: '© <a href="https://www.norgeibilder.no/">Norge i bilder</a> (Kartverket, Geovekst)',
    maxNativeZoom: 19,
    dark: true,
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

export const basemapById = (id: string) => BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
