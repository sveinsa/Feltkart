import { useEffect, useState } from 'react';
import type { Project } from '../state';
import { CRS_LIST } from '../lib/crs';

import { IconGoogle } from './icons';
import ResetDemoButton from './ResetDemoButton';

export default function SettingsView({ project }: { project: Project }) {
  const s = project.settings!;
  const root = project.folders.find((f) => f.parentId === null);
  const counts = {
    photo: project.items.filter((i) => i.kind === 'photo').length,
    pano: project.items.filter((i) => i.kind === 'pano').length,
    dxf: project.items.filter((i) => i.kind === 'dxf').length,
    ortho: project.items.filter((i) => i.kind === 'ortho').length,
  };

  const initial = () => ({
    name: s.projectName,
    crs: s.projectCrs,
    clientId: s.google?.clientId ?? '',
    apiKey: s.google?.apiKey ?? '',
    appId: s.google?.appId ?? '',
  });
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setF(initial()); }, [s.projectName, s.projectCrs, s.google?.clientId, s.google?.apiKey, s.google?.appId]);

  const orig = initial();
  const dirty = (Object.keys(orig) as (keyof typeof orig)[]).some((k) => orig[k] !== f[k]);
  const set = (k: keyof typeof orig, v: string) => { setSaved(false); setF((x) => ({ ...x, [k]: v })); };

  const save = () => {
    const name = f.name.trim();
    if (name && name !== s.projectName && root) project.renameFolder(root.id, name);
    project.updateSettings({
      projectCrs: f.crs,
      google: { clientId: f.clientId.trim(), apiKey: f.apiKey.trim(), appId: f.appId.trim() },
    });
    setSaved(true);
  };

  return (
    <div className="settings">
      <h2>Prosjektinnstillinger</h2>
      <div className="card">
        <div className="field">
          <label>Prosjektnavn</label>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>Prosjektets koordinatsystem</label>
          <select value={f.crs} onChange={(e) => set('crs', e.target.value)}>
            {CRS_LIST.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <p className="muted small">Brukes for koordinatvisning, måling og som standard ved opplasting av DXF, KOF, SOSI, LandXML og IFC.</p>
        </div>
      </div>

      <h3>Innhold</h3>
      <div className="card stats">
        <div><strong>{counts.photo}</strong><span>bilder</span></div>
        <div><strong>{counts.pano}</strong><span>360-bilder</span></div>
        <div><strong>{counts.dxf}</strong><span>prosjekterte data</span></div>
        <div><strong>{counts.ortho}</strong><span>ortofoto</span></div>
      </div>
      <div className="card">
        <div className="reset-row">
          <div>
            <strong>Nullstill demo</strong>
            <span className="muted small" style={{ display: 'block' }}>Sletter alt innhold i Feltkart (bilder, ortofoto, DXF og innmålinger). Filer på Google Disk berøres ikke. Etterpå kan du laste demodata på nytt.</span>
          </div>
          <ResetDemoButton project={project} />
        </div>
      </div>

      <h3 className="g-title"><IconGoogle size={18} /> Google Disk <span className="beta-tag dark">beta</span></h3>
      <div className="card">
        <div className="field">
          <label>Client ID (OAuth, nettapplikasjon)</label>
          <input value={f.clientId} onChange={(e) => set('clientId', e.target.value)} placeholder="123456-abc.apps.googleusercontent.com" />
        </div>
        <div className="field">
          <label>API-nøkkel (trengs for mappe- og filvelgeren)</label>
          <input value={f.apiKey} onChange={(e) => set('apiKey', e.target.value)} />
        </div>
        <div className="field">
          <label>Prosjektnummer i Google Cloud (trengs for mappe- og filvelgeren)</label>
          <input value={f.appId} onChange={(e) => set('appId', e.target.value)} />
        </div>
        <p className="muted small">Verdiene lagres bare i nettleseren din. Slik får du dem: se «Google Disk» i README.</p>
        {s.drive && <p className="small">Sist opprettet: <a href={s.drive.url} target="_blank" rel="noreferrer">{s.drive.name}</a></p>}
      </div>

      <div className="form-actions">
        <button className="btn" onClick={() => { setF(initial()); setSaved(false); }} disabled={!dirty}>Avbryt</button>
        <button className="btn primary" onClick={save} disabled={!dirty}>Lagre</button>
        {saved && !dirty && <span className="muted small">Lagret</span>}
      </div>

      {project.storageError && <p className="error">{project.storageError}</p>}
      <p className="muted small">
        Denne versjonen lagrer alt lokalt i nettleseren din (IndexedDB). For deling mellom flere brukere må løsningen
        kobles mot en server – se README i prosjektet.
      </p>
    </div>
  );
}
