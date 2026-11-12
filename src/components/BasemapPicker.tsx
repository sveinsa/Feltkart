import type { OrthoItem } from '../types';
import type { Project } from '../state';
import { BASEMAPS } from '../lib/basemaps';

interface Props {
  project: Project;
  onZoomTo: (id: string) => void;
}

export default function BasemapPicker({ project, onZoomTo }: Props) {
  const current = project.settings?.basemapId;
  const orthos = project.items.filter((i): i is OrthoItem => i.kind === 'ortho');
  const groups: Array<'Kart' | 'Ortofoto' | 'Ingen'> = ['Kart', 'Ortofoto', 'Ingen'];

  return (
    <div className="basemap-picker">
      {groups.map((g) => (
        <div key={g} className="bm-group">
          {g !== 'Ingen' && <h4>{g}</h4>}
          <div className="bm-options">
            {BASEMAPS.filter((b) => b.group === g).map((b) => (
              <label key={b.id} className={`bm-option${current === b.id ? ' on' : ''}`}>
                <input type="radio" name="basemap" checked={current === b.id} onChange={() => project.updateSettings({ basemapId: b.id })} />
                <span className={`bm-thumb bm-${b.id}`} />
                <span>{b.name}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="bm-group">
        <h4>Droneortofoto</h4>
        {orthos.length === 0 && <p className="muted small">Last opp en GeoTIFF fra drone for å bruke den som bakgrunn.</p>}
        {orthos.map((o) => (
          <div key={o.id} className="ortho-row">
            <label className="ortho-name">
              <input type="checkbox" className="chk" checked={!o.hidden} onChange={(e) => project.setVisible([o.id], e.target.checked)} />
              <span title={o.name}>{o.name}</span>
            </label>
            <div className="ortho-ctrl">
              <input type="range" min={0} max={1} step={0.05} value={o.opacity}
                onChange={(e) => project.saveItem({ ...o, opacity: +e.target.value })} aria-label="Gjennomsiktighet" />
              <span className="muted small">{Math.round(o.opacity * 100)} %</span>
              <button className="link-btn" onClick={() => onZoomTo(o.id)}>Zoom</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
