import type { Project } from '../state';
import { CRS_LIST } from '../lib/crs';

export default function SettingsView({ project }: { project: Project }) {
  const s = project.settings!;
  const root = project.folders.find((f) => f.parentId === null);
  const counts = {
    photo: project.items.filter((i) => i.kind === 'photo').length,
    pano: project.items.filter((i) => i.kind === 'pano').length,
    dxf: project.items.filter((i) => i.kind === 'dxf').length,
    ortho: project.items.filter((i) => i.kind === 'ortho').length,
  };

  return (
    <div className="settings">
      <h2>Prosjektinnstillinger</h2>
      <div className="card">
        <div className="field">
          <label>Prosjektnavn</label>
          <input defaultValue={s.projectName} key={s.projectName}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && root) project.renameFolder(root.id, v); }} />
        </div>
        <div className="field">
          <label>Prosjektets koordinatsystem</label>
          <select value={s.projectCrs} onChange={(e) => project.updateSettings({ projectCrs: e.target.value })}>
            {CRS_LIST.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <p className="muted small">Brukes for koordinatvisning, måling og som standard ved opplasting av DXF.</p>
        </div>
      </div>

      <h3>Innhold</h3>
      <div className="card stats">
        <div><strong>{counts.photo}</strong><span>bilder</span></div>
        <div><strong>{counts.pano}</strong><span>360-bilder</span></div>
        <div><strong>{counts.dxf}</strong><span>DXF-filer</span></div>
        <div><strong>{counts.ortho}</strong><span>ortofoto</span></div>
      </div>

      <h3>Google Disk</h3>
      <div className="card">
        <div className="field">
          <label>Client ID (OAuth, nettapplikasjon)</label>
          <input defaultValue={s.google?.clientId ?? ''} placeholder="123456-abc.apps.googleusercontent.com"
            onBlur={(e) => project.updateSettings({ google: { clientId: e.target.value, apiKey: s.google?.apiKey ?? '', appId: s.google?.appId ?? '' } })} />
        </div>
        <div className="field">
          <label>API-nøkkel (valgfri – trengs for mappevelgeren)</label>
          <input defaultValue={s.google?.apiKey ?? ''}
            onBlur={(e) => project.updateSettings({ google: { clientId: s.google?.clientId ?? '', apiKey: e.target.value, appId: s.google?.appId ?? '' } })} />
        </div>
        <div className="field">
          <label>Prosjektnummer i Google Cloud (valgfri – trengs for mappevelgeren)</label>
          <input defaultValue={s.google?.appId ?? ''}
            onBlur={(e) => project.updateSettings({ google: { clientId: s.google?.clientId ?? '', apiKey: s.google?.apiKey ?? '', appId: e.target.value } })} />
        </div>
        <p className="muted small">Verdiene lagres bare i nettleseren din. Slik får du dem: se «Google Disk» i README.</p>
        {s.drive && <p className="small">Sist opprettet: <a href={s.drive.url} target="_blank" rel="noreferrer">{s.drive.name}</a></p>}
      </div>

      {project.storageError && <p className="error">{project.storageError}</p>}
      <p className="muted small">
        Denne versjonen lagrer alt lokalt i nettleseren din (IndexedDB). For deling mellom flere brukere må løsningen
        kobles mot en server – se README i prosjektet.
      </p>
    </div>
  );
}
