// Leser bilder: posisjon, høyde, retning og dato fra EXIF, og avgjør om bildet er et 360-bilde.
import exifr from 'exifr';
import type { PhotoItem } from '../types';

export type PhotoData = Omit<PhotoItem, 'id' | 'folderId' | 'createdAt' | 'name'>;

export async function makeThumb(source: Blob, size = 360): Promise<{ thumb: string; width: number; height: number }> {
  const bmp = await createImageBitmap(source);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const result = { thumb: canvas.toDataURL('image/jpeg', 0.8), width: bmp.width, height: bmp.height };
  bmp.close?.();
  return result;
}

export async function readPhoto(file: File): Promise<PhotoData> {
  let meta: any = {};
  try {
    meta = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true })) || {};
  } catch {
    meta = {};
  }

  const { thumb, width, height } = await makeThumb(file);

  const projection = String(meta.ProjectionType ?? meta.GPano?.ProjectionType ?? '').toLowerCase();
  const isPano =
    projection === 'equirectangular' ||
    meta.UsePanoramaViewer === true ||
    meta.UsePanoramaViewer === 'True' ||
    Math.abs(width / height - 2) < 0.02;

  const lat = Number.isFinite(meta.latitude) ? meta.latitude : null;
  const lng = Number.isFinite(meta.longitude) ? meta.longitude : null;
  const altitude = Number.isFinite(meta.GPSAltitude) ? meta.GPSAltitude * (meta.GPSAltitudeRef === 1 ? -1 : 1) : null;
  const heading = Number.isFinite(meta.GPSImgDirection) ? meta.GPSImgDirection : Number.isFinite(meta.PoseHeadingDegrees) ? meta.PoseHeadingDegrees : null;
  const date = meta.DateTimeOriginal || meta.CreateDate || new Date(file.lastModified || Date.now());

  return {
    kind: isPano ? 'pano' : 'photo',
    lat,
    lng,
    altitude,
    heading,
    takenAt: new Date(date).toISOString(),
    width,
    height,
    thumb,
    blob: file,
  };
}

export function isImageFile(f: File) {
  return f.type.startsWith('image/') && !/tiff?$/i.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
}
