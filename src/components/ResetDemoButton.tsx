import { useEffect, useState } from 'react';
import type { Project } from '../state';
import { IconTrash } from './icons';

/** «Nullstill demo»: sletter alt innhold i prosjektet (to trinn for å unngå uhell). Demodata kan lastes på nytt etterpå. */
export default function ResetDemoButton({ project, onDone, className = 'btn danger' }: { project: Project; onDone?: () => void; className?: string }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  useEffect(() => {
    if (step === 'idle') return;
    const t = window.setTimeout(() => setStep('idle'), step === 'done' ? 4000 : 8000);
    return () => window.clearTimeout(t);
  }, [step]);

  if (step === 'confirm') {
    return (
      <span className="reset-confirm">
        <span className="small">Slette alt innhold i prosjektet?</span>
        <button className="btn danger solid" onClick={() => { project.resetContent(); setStep('done'); onDone?.(); }}>Ja, nullstill</button>
        <button className="btn" onClick={() => setStep('idle')}>Avbryt</button>
      </span>
    );
  }
  if (step === 'done') return <span className="success small">✓ Nullstilt – du kan laste demodata på nytt</span>;
  return (
    <button className={className} onClick={() => setStep('confirm')} title="Sletter alle bilder, ortofoto og prosjekterte data fra Feltkart (Google Disk berøres ikke)">
      <IconTrash size={15} /> Nullstill demo
    </button>
  );
}
