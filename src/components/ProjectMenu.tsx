// Prosjektvelger i toppfeltet: nedtrekksmeny med alle prosjekter. Hvert prosjekt har sin egen lagring.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeProjectId, listProjects, setActiveProject } from '../lib/projects';
import { IconCheck, IconChevronDown, IconSettings } from './icons';

export default function ProjectMenu({ name, onSettings }: { name: string; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 56, right: 14 });
  const active = activeProjectId();
  // Navnet på det aktive prosjektet kommer fra innstillingene; resten fra listen
  const list = listProjects().map((p) => (p.id === active ? { ...p, name } : p));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (box.current && !box.current.contains(t) && !(pop.current && pop.current.contains(t))) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Menyen tegnes direkte i <body> med fast plassering, så ingen kartlag eller andre elementer kan skjule den
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    setOpen((o) => !o);
  };

  const pick = (id: string) => {
    setOpen(false);
    if (id === active) return;
    if (setActiveProject(id)) window.location.reload(); // hvert prosjekt har egen lagring: start på nytt med det valgte
  };

  return (
    <div className="project-menu" ref={box}>
      <span className="pm-label">Prosjekt:</span>
      <button className="project-pill" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} title="Velg prosjekt">
        <span className="pm-name">{name}</span> <IconChevronDown size={15} />
      </button>
      {open && createPortal(
        <div className="pm-pop" role="listbox" aria-label="Prosjekter" ref={pop} style={{ top: pos.top, right: pos.right }}>
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
        </div>,
        document.body
      )}
    </div>
  );
}
