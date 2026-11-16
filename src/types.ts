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
  /** Fil-ID på Google Disk hvis elementet kommer fra eller er lastet opp til Disk */
  driveId?: string;
  /** Bare forhåndsvisning er lagret i nettleseren. Originalen hentes fra Google Disk ved behov. */
  previewOnly?: boolean;
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
  kind: 'dxf'; // «prosjekterte data»: DXF, KOF, SOSI, LandXML eller IFC
  crs: string;
  blob: Blob;
  hiddenLayers: string[];
  /** Filformat. Mangler på eldre elementer og betyr da DXF. */
  format?: 'dxf' | 'kof' | 'sosi' | 'landxml' | 'ifc';
  /** IFC uten georeferanse: modellens origo i prosjektets koordinatsystem */
  placement?: { e: number; n: number; rot: number };
}

export interface OrthoItem extends BaseItem {
  kind: 'ortho';
  crs: string;
  image: Blob; // ferdig reprojisert til Web Mercator
  /** Lite bilde for utzoomet visning (valgfritt, eldre ortofoto har det ikke) */
  preview?: Blob;
  bounds: [[number, number], [number, number]]; // [[sør, vest], [nord, øst]]
  opacity: number;
  resolution: number | null; // meter per piksel i originalen
  sourceSize: [number, number];
}

export type Item = PhotoItem | DxfItem | OrthoItem;

export interface Settings {
  projectName: string;
  projectCrs: string;
  /** Demodata er forsøkt lastet automatisk (gjøres bare én gang) */
  demoAutoLoaded?: boolean;
  /** Eldre speilede Disk-mapper er ryddet bort (gjøres én gang) */
  foldersCleaned?: boolean;
  basemapId: string;
  /** Egen bakgrunn (XYZ-URL) som vises under Ortofoto i bakgrunnsvelgeren */
  customBasemap?: { name: string; url: string; maxNativeZoom?: number };
  /** Standardmapper per type. «survey» = innmålinger (KOF/SOSI/LandXML), opprettes ved behov. */
  defaultFolders: Record<ItemKind, string> & { survey?: string };
  /** Mappemaler for Google Disk (innrykket tekst) */
  templates?: { id: string; name: string; text: string }[];
  /** Overstyrer VITE_GOOGLE_* fra .env (nyttig på GitHub Pages) */
  google?: { clientId: string; apiKey: string; appId: string };
  /** Sist opprettede prosjektmappe på Google Disk */
  drive?: { id: string; url: string; name: string; createdAt: string };
  projectNumber?: string;
  /** Mappen på Google Disk som er koblet til prosjektet (hente fra / laste opp til) */
  driveFolder?: { id: string; name: string; url: string };
  /** 'file' = bare filer appen oppretter/velges (drive.file). 'full' = kan lese og skrive i hele mapper (drive). */
  driveAccess?: 'file' | 'full';
}

/** Hva som er valgt i kartet og vises i objektinformasjon */
export type Selection =
  | { type: 'item'; id: string }
  | { type: 'dxf-feature'; itemId: string; index: number }
  | { type: 'point'; lat: number; lng: number }
  | null;

export type Tool = 'select' | 'distance' | 'area' | 'place';
