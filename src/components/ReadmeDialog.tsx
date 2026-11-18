import { useEffect, useMemo } from 'react';
import { buildReadmeHtml } from '../lib/readme';
import { IconClose } from './icons';

/** Readme i en dialog (brukes i Android-appen, eller hvis nettleseren blokkerer eget vindu). Samme side som i eget vindu. */
export default function ReadmeDialog({ version, versionLabel, onClose }: { version: string; versionLabel: string; onClose: () => void }) {
  const html = useMemo(() => buildReadmeHtml(version, versionLabel), [version, versionLabel]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal readme" role="dialog" aria-label="Readme">
        <div className="modal-head">
          <h2>Readme</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Lukk Readme"><IconClose size={16} /></button>
        </div>
        <iframe className="readme-frame" title="Feltkart – Readme" srcDoc={html} />
      </div>
    </div>
  );
}
