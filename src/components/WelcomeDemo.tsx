import { IconFolder } from './icons';

/** Velkomstboks som vises før demodata lastes automatisk. */
export default function WelcomeDemo({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="modal-back">
      <div className="modal welcome">
        <div className="modal-body welcome-body">
          <span className="welcome-logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="44" height="44"><rect width="32" height="32" rx="7" fill="#8dc63f" /><path d="M8 23l5.5-13 4.5 8.5 2.2-4L24 23z" fill="#0f5a3c" /></svg>
          </span>
          <h2>Velkommen til demo av Feltkart</h2>
          <p>Vil du laste ned demodata? Du får bilder, 360-bilder, prosjekterte data (DXF), innmålinger og ortofoto fra drone, fra Google Disk, slik at du kan prøve kartet.</p>
          <div className="welcome-actions">
            <button className="btn primary big" onClick={onYes} autoFocus><IconFolder size={18} /> Ja, last ned demodata</button>
            <button className="btn big" onClick={onNo}>Nei</button>
          </div>
          <span className="muted small">(Tar ca. 1 minutt å laste fra en litt treg Google Disk)</span>
        </div>
      </div>
    </div>
  );
}
