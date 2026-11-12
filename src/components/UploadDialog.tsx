import { useRef, useState } from 'react';
import type { Project, UploadResult } from '../state';
import { CRS_LIST } from '../lib/crs';
import { IconClose, IconFolder, IconUpload, KIND_ICON } from './icons';
import { googleConfig } from './DriveDialog';
import { downloadDriveFile, pickFiles } from '../lib/google';
import { isOrthoFile } from '../lib/ortho';
import { isWorldFile } from '../lib/jp2';
import { usePickerOpen } from '../lib/usePickerOpen';

interface Props {
  project: Project;
  initialFiles?: File[];
  onClose: () => void;
  onDone: (r: UploadResult) => void;
}

function kindOf(f: File): 'dxf' | 'ortho' | 'photo' | 'world' | null {
  if (isWorldFile(f)) return 'world';
  if (/\.dxf$/i.test(f.name)) return 'dxf';
  if (isOrthoFile(f)) return 'ortho';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return 'photo';
  return null;
}

const sizeFmt = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

export default function UploadDialog({ project, initialFiles = [], onClose, onDone }: Props) {
  const pickerOpen = usePickerOpen();
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [target, setTarget] = useState('auto');
  const [crs, setCrs] = useState(project.settings?.projectCrs ?? 'EPSG:25832');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cfg = googleConfig(project);
  const [fetching, setFetching] = useState(false);
  const [driveMsg, setDriveMsg] = useState<string | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);

  const add = (list: FileList | File[]) => setFiles((f) => [...f, ...Array.from(list)]);
  const hasGeo = files.some((f) => kindOf(f) === 'dxf' || kindOf(f) === 'ortho');
  const startable = files.filter((f) => { const k = kindOf(f); return k && k !== 'world'; }).length;

  async function fromDrive() {
    setDriveErr(null);
    setDriveMsg(null);
    setFetching(true);
    try {
      const picked = await pickFiles(cfg, project.settings?.driveFolder?.id);
      const got: File[] = [];
      const errs: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        setDriveMsg(`Henter ${i + 1} av ${picked.length}: ${picked[i].name} …`);
        try { got.push(await downloadDriveFile(cfg, picked[i])); } catch (e: any) { errs.push(String(e?.message ?? e)); }
      }
      if (got.length) add(got);
      setDriveMsg(got.length ? `${got.length} fil(er) hentet fra Google Disk.` : null);
      if (errs.length) setDriveErr(errs.join(' '));
    } catch (e: any) {
      setDriveErr(String(e?.message ?? e));
    }
    setFetching(false);
  }

  async function start() {
    setBusy(true);
    const r = await project.upload(files, target, crs, setProgress);
    setBusy(false);
    setResult(r);
    onDone(r);
  }

  return (
    <div className="modal-back" style={pickerOpen ? { display: 'none' } : undefined} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal upload">
        <div className="modal-head">
          <h2>Last opp</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Lukk"><IconClose /></button>
        </div>

        {result ? (
          <div className="modal-body">
            <p><strong>{result.added.length}</strong> fil(er) lagt til{result.failed.length ? `, ${result.failed.length} feilet` : ''}.</p>
            {result.messages.map((m, i) => <p key={i} className="small">{m}</p>)}
            {result.failed.map((f, i) => <p key={i} className="small error">{f.name}: {f.reason}</p>)}
            <div className="modal-foot"><button className="btn primary" onClick={onClose}>Ferdig</button></div>
          </div>
        ) : (
          <div className="modal-body">
            <div
              className={`dropzone${drag ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
              onClick={() => input.current?.click()}
            >
              <IconUpload size={28} />
              <strong>Dra filer hit eller klikk for å velge</strong>
              <span>Bilder (JPG/PNG), 360-bilder, DXF med prosjekterte data og ortofoto fra drone (GeoTIFF eller JP2)</span>
              <input ref={input} type="file" multiple hidden accept="image/*,.dxf,.tif,.tiff,.jp2,.j2k,.j2w,.jgw,.wld" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
            </div>

            <div className="drive-pick">
              <button className="btn" onClick={fromDrive} disabled={busy || fetching || !cfg.clientId}>
                <IconFolder size={16} /> {fetching ? 'Henter …' : 'Velg filer fra Google Disk'}
              </button>
              {!cfg.clientId && <span className="muted small">Krever Google-oppsett under Innstillinger.</span>}
              {driveMsg && <span className="muted small">{driveMsg}</span>}
              {driveErr && <span className="error small">{driveErr}</span>}
            </div>

            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f, i) => {
                  const k = kindOf(f);
                  const Icon = k && k !== 'world' ? KIND_ICON[k] : k === 'world' ? KIND_ICON.ortho : IconClose;
                  return (
                    <li key={i} className={k ? '' : 'unsupported'}>
                      <Icon size={16} className={`kind kind-${k ?? 'none'}`} />
                      <span className="label">{f.name}</span>
                      <span className="muted small">{k === 'world' ? 'georeferanse' : k ? sizeFmt(f.size) : 'støttes ikke'}</span>
                      {!busy && <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Fjern"><IconClose size={14} /></button>}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="form-grid">
              <div className="field">
                <label>Mappe</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
                  <option value="auto">Automatisk etter filtype</option>
                  {project.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              {hasGeo && (
                <div className="field">
                  <label>Koordinatsystem (DXF / ortofoto uten georeferanse)</label>
                  <select value={crs} onChange={(e) => setCrs(e.target.value)} disabled={busy}>
                    {CRS_LIST.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                  </select>
                </div>
              )}
            </div>
            <p className="muted small">360-bilder kjennes igjen automatisk (2:1-format eller panorama-metadata). Posisjon og dato leses fra bildene.</p>

            <div className="modal-foot">
              <span className="muted small progress">{busy ? progress : ''}</span>
              <button className="btn" onClick={onClose} disabled={busy}>Avbryt</button>
              <button className="btn primary" onClick={start} disabled={busy || fetching || startable === 0}>
                {busy ? 'Laster opp …' : `Last opp ${startable || ''} fil(er)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
