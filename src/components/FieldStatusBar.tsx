// Øverst i Android-appen: GNSS-status (grønn = klar til å måle, rød = ikke klar) og stanghøyde. Vises i både Felt og Kart.
import { useEffect, useState } from 'react';
import { useGnss } from '../lib/field/useGnss';
import { useFieldSettings } from '../lib/field/useFieldSettings';
import { canMeasure } from '../lib/field/survey';
import { QUALITY_LABEL } from '../lib/field/nmea';
import { cm } from '../lib/field/fmt';
import PoleHeight from './PoleHeight';

export default function FieldStatusBar() {
  const g = useGnss();
  const [fs, setF] = useFieldSettings();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const connected = g.connected && g.source !== 'none';
  const verdict = canMeasure(g, fs, now);
  const ready = connected && verdict.ok;
  return (
    <div className={`gbar ${ready ? 'ok' : 'bad'}`} data-testid="gbar" data-ready={ready ? '1' : '0'} role="status" aria-live="polite" title={ready ? 'Klar til å måle' : verdict.reason}>
      <div className="gbar-l">
        <div className="gbar-q">
          <i className="gbar-dot" aria-hidden="true" />
          <strong className="fld-qtxt">{connected ? QUALITY_LABEL[g.quality] : 'Ikke tilkoblet'}</strong>
        </div>
        <div className="gbar-acc">
          Nøyaktighet <b className="fld-acc" title={connected && g.estimated ? 'Android-posisjon gir ikke RTK-status. Nøyaktigheten er oppgitt av telefonen, og RTK-statusen er anslått ut fra den.' : undefined}>{connected ? cm(g.accH) : '–'}</b>
        </div>
      </div>
      <PoleHeight value={fs.poleHeight} onChange={(v) => setF({ poleHeight: v })} alt={g.alt} sep={g.sep} mode={fs.heightMode} />
    </div>
  );
}
