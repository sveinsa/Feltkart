import type { MeasureMode, Summary } from '../lib/measure';
import { formatArea, formatLength } from '../lib/measure';
import { IconArea, IconRuler } from './icons';

interface Props {
  mode: MeasureMode;
  summary: Summary;
  finished: boolean;
  onOpen: () => void;
  onClear: () => void;
}

/** Vises når en måling ligger lagret men måleverktøyet ikke er i bruk. Målingen blir stående til man trykker Nullstill. */
export default function MeasureChip({ mode, summary: s, finished, onOpen, onClear }: Props) {
  const value = mode === 'area'
    ? (s.area !== null ? formatArea(s.area) : `${s.count} punkt${s.count === 1 ? '' : 'er'}`)
    : (s.count >= 2 ? formatLength(s.horizontal) : `${s.count} punkt`);
  return (
    <div className="measure-chip" role="status" aria-label="Lagret måling">
      {mode === 'area' ? <IconArea size={16} /> : <IconRuler size={16} />}
      <span>Lagret {mode === 'area' ? 'arealmåling' : 'avstandsmåling'}: <b>{value}</b>{finished ? '' : ' (ikke avsluttet)'}</span>
      <button className="btn" onClick={onOpen} title="Åpne målingen igjen (og fortsett om den ikke er avsluttet)">Åpne</button>
      <button className="btn" onClick={onClear} title="Fjern målingen, også den lagrede kopien">Nullstill</button>
    </div>
  );
}
