import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconLayers = (p: P) => <Svg {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></Svg>;
export const IconMap = (p: P) => <Svg {...p}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></Svg>;
export const IconPano = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="9" ry="3.5" /><path d="M12 3v18" /></Svg>;
export const IconDxf = (p: P) => <Svg {...p}><path d="M4 18l5-9 4 5 3-4 4 8" /><circle cx="9" cy="9" r="1.2" /><circle cx="16" cy="10" r="1.2" /></Svg>;
export const IconOrtho = (p: P) => <Svg {...p}><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v10l8 4 8-4V7" /><path d="M12 11v10" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Svg>;
export const IconFolderOpen = (p: P) => <Svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v1" /><path d="M3 19l3-8h16l-3 8H3z" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
export const IconPointer = (p: P) => <Svg {...p}><path d="M5 3l14 7-6 2-2 6L5 3z" /></Svg>;
export const IconRuler = (p: P) => <Svg {...p}><rect x="2" y="8" width="20" height="8" rx="1" /><path d="M6 8v3M10 8v4M14 8v3M18 8v4" /></Svg>;
export const IconArea = (p: P) => <Svg {...p}><path d="M5 6l12-2 3 12-11 4-4-14z" /><circle cx="5" cy="6" r="1.2" fill="currentColor" /><circle cx="17" cy="4" r="1.2" fill="currentColor" /><circle cx="20" cy="16" r="1.2" fill="currentColor" /><circle cx="9" cy="20" r="1.2" fill="currentColor" /></Svg>;
export const IconExtent = (p: P) => <Svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></Svg>;
export const IconPin = (p: P) => <Svg {...p}><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><circle cx="12" cy="5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="19" r="1.3" fill="currentColor" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
export const IconSettings = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></Svg>;
export const IconEdit = (p: P) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></Svg>;
export const IconExpand = (p: P) => <Svg {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></Svg>;
export const IconCollapse = (p: P) => <Svg {...p}><path d="M7 14l5-5 5 5" /></Svg>;

export const KIND_ICON = { photo: IconImage, pano: IconPano, dxf: IconDxf, ortho: IconOrtho } as const;

// Markørikoner i kartet (HTML-strenger for Leaflet divIcon)
export const markerHtml = {
  photo: (selected: boolean) =>
    `<div class="mk mk-photo${selected ? ' sel' : ''}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M21 16l-5-5-8 8"/><circle cx="9" cy="10" r="1.5"/></svg></div>`,
  pano: (selected: boolean) =>
    `<div class="mk mk-pano${selected ? ' sel' : ''}"><span>360</span></div>`,
};
