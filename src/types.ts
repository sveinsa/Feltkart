export type ItemKind = 'photo' | 'pano' | 'dxf' | 'ortho';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

interface BaseItem {
  id: string;
  kind: ItemKind;
  name: string;
  folderId: string;
  createdAt: number;
  hidden?: boolean;
}

export interface PhotoItem extends BaseItem {
  kind: 'photo' | 'pano';
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  heading: number | null;
  takenAt: string; // ISO
  width: number;
  height: number;
  thumb: string; // data-URL
  blob: Blob;
  note?: string;
}

export interface DxfItem extends BaseItem {
  kind: 'dxf';
  crs: string;
  blob: Blob;
  hiddenLayers: string[];
}

export interface OrthoItem extends BaseItem {
  kind: 'ortho';
  crs: string;
  image: Blob; // ferdig reprojisert til Web Mercator
  bounds: [[number, number], [number, number]]; // [[sør, vest], [nord, øst]]
  opacity: number;
  resolution: number | null; // meter per piksel i originalen
  sourceSize: [number, number];
}

export type Item = PhotoItem | DxfItem | OrthoItem;

export interface Settings {
  projectName: string;
  projectCrs: string;
  basemapId: string;
  defaultFolders: Record<ItemKind, string>;
  /** Mappemaler for Google Disk (innrykket tekst) */
  templates?: { id: string; name: string; text: string }[];
  /** Overstyrer VITE_GOOGLE_* fra .env (nyttig på GitHub Pages) */
  google?: { clientId: string; apiKey: string; appId: string };
  /** Sist opprettede prosjektmappe på Google Disk */
  drive?: { id: string; url: string; name: string; createdAt: string };
  projectNumber?: string;
}

/** Hva som er valgt i kartet og vises i objektinformasjon */
export type Selection =
  | { type: 'item'; id: string }
  | { type: 'dxf-feature'; itemId: string; index: number }
  | { type: 'point'; lat: number; lng: number }
  | null;

export type Tool = 'select' | 'distance' | 'area' | 'place';
