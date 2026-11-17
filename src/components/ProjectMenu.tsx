// Prosjektvelger i toppfeltet: nedtrekksmeny med alle prosjekter. Hvert prosjekt har sin egen lagring.
import { useEffect, useRef, useState } from 'react';
import { activeProjectId, listProjects, setActiveProject } from '../lib/projects';
import { IconCheck, IconChevronDown, IconSettings } from './icons';

export default function ProjectMenu({ name, onSettings }: { name: string; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = activeProjectId();
  // Navnet på det aktive prosjektet kommer fra innstillingene; resten fra listen
  const list = listProjects().map((p) => (p.id === active ? { ...p, name } : p));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id === active) return;
    if (setActiveProject(id)) window.location.reload(); // hvert prosjekt har egen lagring: start på nytt med det valgte
  };

  return (
    <div className="project-menu" ref={box}>
      <button className="project-pill" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Velg prosjekt">
        <span className="pm-name">{name}</span> <IconChevronDown size={15} />
      </button>
      {open && (
        <div className="pm-pop" role="listbox" aria-label="Prosjekter">
          <div className="pm-head">Prosjekter</div>
          {list.map((p) => (
            <button key={p.id} role="option" aria-selected={p.id === active} className={p.id === active ? 'pm-item on' : 'pm-item'} onClick={() => pick(p.id)}>
              <span className="pm-check">{p.id === active && <IconCheck size={15} />}</span>
              <span>{p.name}</span>
            </button>
          ))}
          <div className="pm-sep" />
          <button className="pm-item" onClick={() => { setOpen(false); onSettings(); }}>
            <span className="pm-check"><IconSettings size={15} /></span><span>Prosjektinnstillinger</span>
          </button>
        </div>
      )}
    </div>
  );
}
