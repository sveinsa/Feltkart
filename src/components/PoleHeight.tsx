// Stanghøyde (fra bakken opp til antennen): − / +, eget felt, og regnestykket antenne − stang = bakke.
import { useEffect, useState } from 'react';
import { cleanPole, groundHeight, POLE_MAX, type FieldSettings } from '../lib/field/survey';
import { nb } from '../lib/field/fmt';

interface Props { value: number; onChange: (v: number) => void; alt: number | null; sep: number | null; mode: FieldSettings['heightMode'] }

const parse = (t: string) => Number(t.trim().replace(',', '.'));

export default function PoleHeight({ value, onChange, alt, sep, mode }: Props) {
  const [draft, setDraft] = useState(nb(value, 3));
  // Følg verdien når den endres utenfra (− / +), men ikke mens du skriver samme tall
  useEffect(() => { setDraft((d) => (parse(d) === value ? d : nb(value, 3))); }, [value]);
  const type = (t: string) => {
    setDraft(t);
    const v = parse(t);
    if (t.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= POLE_MAX) onChange(cleanPole(v));
  };
  const step = (d: number) => onChange(cleanPole(value + d));
  const h = groundHeight(alt, sep, { poleHeight: value, heightMode: mode });
  return (
    <div className="pole" data-testid="pole">
      <div className="pole-row">
        <span className="pole-lbl">Stang</span>
        <button type="button" className="pole-step" aria-label="Minus 1 cm" onClick={() => step(-0.01)}>−</button>
        <label className="pole-input">
          <input inputMode="decimal" aria-label="Stanghøyde (m)" value={draft} onChange={(e) => type(e.target.value)} onBlur={() => setDraft(nb(value, 3))} onFocus={(e) => e.target.select()} />
          <span>m</span>
        </label>
        <button type="button" className="pole-step" aria-label="Pluss 1 cm" onClick={() => step(0.01)}>+</button>
      </div>
      <div className={`pole-calc${h.ground === null ? ' none' : ''}`} data-testid="pole-calc" title="Antennehøyde − stanghøyde = høyde på bakken">
        {h.ground === null
          ? <span>Ingen høyde fra mottakeren</span>
          : <><span><i>Antenne</i>{nb(h.antenna!, 3)}</span><b>−</b><span><i>Stang</i>{nb(value, 3)}</span><b>=</b><span className="res"><i>Bakke</i>{nb(h.ground, 3)} m</span></>}
      </div>
      {value === 0 && <div className="pole-warn">Stang 0 m: punktene får antennens høyde, ikke bakkens.</div>}
    </div>
  );
}
