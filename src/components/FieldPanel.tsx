// «Felt»: RTK-posisjon fra GNSS-mottaker (Leica FLX100 m.fl.), bilder og innmåling med punkter, sortering og eksport (KOF, SOSI, LandXML, CSV).
// Fungerer både i Android-appen (Bluetooth, kamera) og i nettleseren (enhetens posisjon).
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../state';
import { CRS_LIST, crsName, formatProjected, measureCrs } from '../lib/crs';
import { gnssState, startGnss, stopGnss, averageFix } from '../lib/field/gnss';
import { useGnss } from '../lib/field/useGnss';
import { useFieldSettings } from '../lib/field/useFieldSettings';
import { cm, nb } from '../lib/field/fmt';
import { primeSound, pling } from '../lib/field/sound';
import { QUALITY_LABEL } from '../lib/field/nmea';
import { isNative, listBtDevices, pickPhotoWeb, saveFile, takePhoto, native, type BtDevice } from '../lib/field/native';
import {
  canMeasure, codeStats, filterPoints, fmtTime, loadPoints, makePoint, nextName, pointEN, savePoints, sortPoints, stamp, toKof,
  type FieldPoint, type SortDir, type SortKey,
} from '../lib/field/survey';
import { buildExport, EXPORT_FORMATS, sosiSupported } from '../lib/field/export';
import { androidClientId, setAndroidClientId } from '../lib/google';
import { VERSION } from '../version';

interface Props {
  project: Project;
  onToast: (msg: string) => void;
  onShowOnMap: () => void;
  /** Snarveier til det som ikke lenger ligger i menyene i Android-appen (vises under Oppsett) */
  more?: { onUpload: () => void; onSync: () => void; onReadme: () => void; onRefresh: () => void; onSettings: () => void };
}


export default function FieldPanel({ project, onToast, onShowOnMap, more }: Props) {
  const projectCrs = project.settings!.projectCrs;
  const g = useGnss();
  const [tab, setTab] = useState<'mal' | 'punkter' | 'bilde' | 'oppsett'>('mal');
  const [fs, setF] = useFieldSettings();
  const [points, setPoints] = useState<FieldPoint[]>(() => loadPoints());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cid, setCid] = useState(androidClientId());
  const [photos, setPhotos] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [codeFilter, setCodeFilter] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const native_ = isNative();
  // Koordinatsystem for visning, måling og eksport. Prosjektets system, med mindre du velger et annet. Grader (WGS84) egner seg ikke for innmåling, så da brukes UTM.
  const baseCrs = projectCrs && projectCrs !== 'EPSG:4326' ? projectCrs : measureCrs(projectCrs, g.lng ?? 10);
  const crs = fs.exportCrs && CRS_LIST.some((c) => c.code === fs.exportCrs) ? fs.exportCrs : baseCrs;
  const source = native_ ? fs.source : 'android';

  const goTab = (t: typeof tab) => { setErr(null); setTab(t); };
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { savePoints(points); }, [points]);
  const suggested = useMemo(() => nextName(fs, points), [fs.prefix, fs.next, points]);
  useEffect(() => { setName(suggested.name); }, [suggested.name]);

  const verdict = canMeasure(g, fs, now);
  const connected = g.connected && g.source !== 'none';
  const age = g.updated ? Math.max(0, Math.round((now - g.updated) / 1000)) : null;
  const en = g.lat !== null && g.lng !== null ? formatProjected(crs, g.lat, g.lng) : null;
  const codes = fs.codes.split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
  const shown = useMemo(() => sortPoints(filterPoints(points, { code: codeFilter, from, to }), sortKey, sortDir), [points, codeFilter, from, to, sortKey, sortDir]);
  const stats = useMemo(() => codeStats(points), [points]);
  const unsaved = points.filter((p) => !p.saved).length;
  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'time' ? 'desc' : 'asc'); }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const connect = async () => {
    setErr(null);
    try {
      if (source === 'bt') {
        if (!fs.btAddress) { setErr('Velg en Bluetooth-enhet først (trykk «Finn enheter»).'); return; }
        await startGnss('bt', { address: fs.btAddress, name: fs.btName });
      } else await startGnss('android');
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };
  const findDevices = async () => {
    setErr(null);
    try { setDevices(await listBtDevices()); } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const measure = async (force = false) => {
    setErr(null);
    if (!force && !verdict.ok) { setErr(verdict.reason); return; }
    primeSound(); // lyd tillates bare etter et trykk, så lydmotoren startes her
    setBusy('Måler …'); setPct(0);
    try {
      const avg = await averageFix(
        fs.avgSeconds * 1000,
        (s) => force || !fs.requireFix || s.quality === 'fix',
        (_n, p) => setPct(p),
      );
      const pt = makePoint(avg, fs, crs, name.trim() || suggested.name, fs.code, crypto.randomUUID?.() ?? String(Date.now()));
      setPoints((p) => [...p, pt]);
      setF({ next: suggested.next });
      navigator.vibrate?.(60);
      if (fs.sound) pling();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(null);
  };

  const saveToProject = async () => {
    const todo = points.filter((p) => !p.saved);
    if (!todo.length) return;
    setBusy('Lagrer i prosjektet …');
    const file = new File([toKof(todo, crs)], `Innmaaling_${stamp()}.kof`, { type: 'text/plain', lastModified: Date.now() });
    try {
      const r = await project.upload([file], 'auto', crs, () => {});
      if (r.failed.length) setErr(r.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'));
      else {
        onToast(`${todo.length} punkter lagret i Innmålinger`);
        const ids = new Set(todo.map((p) => p.id));
        setPoints((l) => l.map((p) => (ids.has(p.id) ? { ...p, saved: true } : p)));
      }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(null);
  };
  const download = async () => {
    setErr(null);
    if (!shown.length) { setErr('Ingen punkter å laste ned med dette utvalget.'); return; }
    try {
      const out = buildExport(fs.exportFormat, shown, crs, VERSION);
      const where = await saveFile(out.name, new Blob([out.text], { type: `${out.mime};charset=utf-8` }));
      onToast(`${out.name} (${out.count} punkter, ${crsName(crs)}) lagret i ${where}`);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const takeImage = async () => {
    setErr(null);
    const at = gnssState(); // posisjonen der du står når du trykker
    const pos = at.lat !== null && at.lng !== null && Date.now() - at.updated < 10000 ? at : null;
    setBusy('Åpner kamera …');
    try {
      const r = native_ ? await takePhoto() : await pickPhotoWeb();
      if (!r) { setBusy(null); return; }
      setBusy('Lagrer bildet …');
      const file = new File([r.blob], `Foto_${stamp()}.jpg`, { type: r.blob.type || 'image/jpeg', lastModified: Date.now() });
      const positions = new Map();
      if (pos) positions.set(file, { lat: pos.lat!, lng: pos.lng!, altitude: pos.alt, takenAt: new Date().toISOString() });
      const meta = new Map([[file, { description: pos ? `${QUALITY_LABEL[pos.quality]}${pos.accH !== null ? ' ' + cm(pos.accH) : ''}` : undefined }]]);
      const res = await project.upload([file], 'auto', projectCrs, () => {}, { positions, meta });
      if (res.failed.length) setErr(res.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'));
      else {
        setPhotos((p) => [file.name + (pos ? '' : ' (uten posisjon)'), ...p].slice(0, 8));
        onToast(pos ? 'Bilde lagret med posisjon' : 'Bilde lagret – mangler posisjon (ikke koblet til GNSS)');
      }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(null);
  };

  const qCls = g.quality === 'fix' ? 'q-fix' : g.quality === 'float' ? 'q-float' : g.quality === 'none' ? 'q-none' : 'q-bad';

  return (
    <div className="fld" data-testid="field">
      <div className={`fld-card ${connected ? qCls : 'q-none'}`}>
        <div className="fld-msg">{g.message}{age !== null && connected ? ` · oppdatert for ${age} s siden` : ''}</div>
        {connected && en && (
          <div className="fld-coords">
            <span><i>Øst</i>{en.e}</span><span><i>Nord</i>{en.n}</span>
            <span><i>Høyde antenne</i>{g.alt !== null ? nb(g.alt, 3) + ' m' : '–'}</span>
            {g.sats !== null && <span><i>Satellitter</i>{g.sats}</span>}
            {g.hdop !== null && <span><i>HDOP</i>{nb(g.hdop, 1)}</span>}
            {g.age !== null && <span><i>Korreksjonsalder</i>{nb(g.age, 0)} s</span>}
          </div>
        )}
        <div className="fld-crs" data-testid="crsinfo">{crsName(crs)} · {fs.heightMode === 'ellipsoid' ? 'Ellipsoidehøyde (ingen geoide)' : `Geoidemodell ${fs.vdatum}`}</div>
        <div className="fld-conn">
          <select value={source} onChange={(e) => setF({ source: e.target.value as 'android' | 'bt' })} disabled={connected || !native_} aria-label="Posisjonskilde">
            <option value="android">{native_ ? 'Android-posisjon (Leica Zeno Connect)' : 'Enhetens posisjon (nettleseren)'}</option>
            {native_ && <option value="bt">Direkte Bluetooth (NMEA)</option>}
          </select>
          {connected
            ? <button className="btn" onClick={() => void stopGnss()}>Koble fra</button>
            : <button className="btn primary" onClick={() => void connect()}>Koble til</button>}
          {connected && <button className="btn fld-showmap" onClick={onShowOnMap}>Vis i kart</button>}
        </div>
        {source === 'bt' && !connected && (
          <div className="fld-bt">
            <button className="btn" onClick={() => void findDevices()}>Finn enheter</button>
            <span className="muted small">{fs.btName ? `Valgt: ${fs.btName}` : 'Parkoble FLX100 i Android først.'}</span>
            {devices && (devices.length
              ? <div className="fld-devs">{devices.map((d) => <button key={d.address} className={`btn${d.address === fs.btAddress ? ' primary' : ''}`} onClick={() => setF({ btAddress: d.address, btName: d.name })}>{d.name}</button>)}</div>
              : <div className="muted small">Fant ingen parkoblede enheter. Parkoble mottakeren under Android → Bluetooth.</div>)}
          </div>
        )}
      </div>

      <div className="fld-tabs" role="tablist">
        <button role="tab" className={tab === 'mal' ? 'on' : ''} onClick={() => goTab('mal')}>Innmåling</button>
        <button role="tab" className={tab === 'punkter' ? 'on' : ''} onClick={() => goTab('punkter')}>Punkter{points.length ? ` (${points.length})` : ''}</button>
        <button role="tab" className={tab === 'bilde' ? 'on' : ''} onClick={() => goTab('bilde')}>Bilde</button>
        <button role="tab" className={tab === 'oppsett' ? 'on' : ''} onClick={() => goTab('oppsett')}>Oppsett</button>
      </div>

      {err && <div className="fld-err" role="alert">{err}</div>}
      {busy && <div className="fld-busy" role="status">{busy}{busy === 'Måler …' && <div className="fld-bar"><i style={{ width: `${pct}%` }} /></div>}</div>}

      {tab === 'mal' && (
        <div className="fld-sec mal">
          <div className="fld-row">
            <label>Punkt<input value={name} onChange={(e) => setName(e.target.value)} aria-label="Punktnavn" /></label>
            <label>Kode<input value={fs.code} onChange={(e) => setF({ code: e.target.value })} aria-label="Kode" /></label>
          </div>
          {!!codes.length && <div className="fld-codes">{codes.map((c) => <button key={c} className={`chip${fs.code === c ? ' on' : ''}`} onClick={() => setF({ code: fs.code === c ? '' : c })}>{c}</button>)}</div>}
          <button className="fld-measure" aria-label="Mål punkt" title="Mål punkt" disabled={!!busy || !connected} onClick={() => void measure(false)}>
            <b>{busy === 'Måler …' ? '…' : 'Mål'}</b>{fs.avgSeconds > 0 && busy !== 'Måler …' && <small>{fs.avgSeconds} s</small>}
          </button>
          {connected && !verdict.ok && <div className="fld-warn">{verdict.reason} <button className="link" onClick={() => void measure(true)} disabled={!!busy}>Mål likevel</button></div>}

          {!!points.length && (() => {
            const last = sortPoints(points, 'time', 'desc')[0];
            const [le, ln] = pointEN(last, crs);
            return (
              <div className="fld-last" data-testid="last">
                <div><strong>{last.name}</strong>{last.code && <span className="chip small">{last.code}</span>}<span className="muted small"> · sist målt {fmtTime(last.time)}</span></div>
                <div className="muted small">N {nb(ln, 3)} · Ø {nb(le, 3)} · H {last.h !== null ? nb(last.h, 3) : '–'} · {QUALITY_LABEL[last.quality]}{last.estimated ? ' (anslått)' : ''} {cm(last.accH)}</div>
                <button className="link" onClick={() => goTab('punkter')}>Se alle {points.length} punkter, sorter og last ned</button>
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'punkter' && (
        <div className="fld-sec">
          {!points.length && <div className="muted">Ingen punkter ennå. Mål punkter under «Innmåling», så samles de her.</div>}
          <div className="fld-row">
            <label>Koordinatsystem
              <select aria-label="Koordinatsystem" value={crs} onChange={(e) => setF({ exportCrs: e.target.value })}>
                {CRS_LIST.filter((c) => c.code !== 'EPSG:4326').map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <label>Sortering
              <select aria-label="Sortering" value={`${sortKey}:${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSortKey(k as SortKey); setSortDir(d as SortDir); }}>
                <option value="time:desc">Dato, nyeste først</option>
                <option value="time:asc">Dato, eldste først</option>
                <option value="code:asc">Kode A–Å</option>
                <option value="code:desc">Kode Å–A</option>
                <option value="name:asc">Punkt A–Å</option>
                <option value="name:desc">Punkt Å–A</option>
                <option value="h:asc">Høyde, lavest først</option>
                <option value="h:desc">Høyde, høyest først</option>
              </select>
            </label>
          </div>
          {!!points.length && (
            <>
              <div className="fld-row">
                <label>Vis kode
                  <select aria-label="Filtrer på kode" value={codeFilter === null ? '__alle' : codeFilter === '' ? '__ingen' : codeFilter}
                    onChange={(e) => setCodeFilter(e.target.value === '__alle' ? null : e.target.value === '__ingen' ? '' : e.target.value)}>
                    <option value="__alle">Alle koder ({points.length})</option>
                    {stats.map((c) => <option key={c.code || '__ingen'} value={c.code || '__ingen'}>{c.code || 'Uten kode'} ({c.count})</option>)}
                  </select>
                </label>
                <label>Fra dato<input type="date" aria-label="Fra dato" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                <label>Til dato<input type="date" aria-label="Til dato" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              </div>
              <div className="muted small" data-testid="count">Viser {shown.length} av {points.length} punkter{(codeFilter !== null || from || to) && <> · <button className="link" onClick={() => { setCodeFilter(null); setFrom(''); setTo(''); }}>Nullstill utvalg</button></>}</div>
              <div className="fld-tablewrap">
                <table className="fld-table" data-testid="points">
                  <thead>
                    <tr>
                      <th><button className="fld-th" aria-label="Sorter på punkt" onClick={() => sortBy('name')}>Punkt{arrow('name')}</button></th>
                      <th><button className="fld-th" aria-label="Sorter på kode" onClick={() => sortBy('code')}>Kode{arrow('code')}</button></th>
                      <th><button className="fld-th" aria-label="Sorter på dato" onClick={() => sortBy('time')}>Dato{arrow('time')}</button></th>
                      <th className="num">Nord</th>
                      <th className="num">Øst</th>
                      <th className="num"><button className="fld-th" aria-label="Sorter på høyde" onClick={() => sortBy('h')}>Høyde{arrow('h')}</button></th>
                      <th>Kvalitet</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const [pe, pn] = pointEN(p, crs);
                      return (
                        <tr className="fld-trow" key={p.id}>
                          <td><strong>{p.name}</strong>{p.saved && <span className="fld-saved" title="Lagt inn i prosjektet">✓</span>}</td>
                          <td>{p.code ? <span className="chip small">{p.code}</span> : <span className="muted">–</span>}</td>
                          <td className="nowrap">{fmtTime(p.time)}</td>
                          <td className="num">{nb(pn, 3)}</td>
                          <td className="num">{nb(pe, 3)}</td>
                          <td className="num">{p.h !== null ? nb(p.h, 3) : '–'}</td>
                          <td className="nowrap">{QUALITY_LABEL[p.quality]}{p.estimated ? ' (anslått)' : ''} {cm(p.accH)}</td>
                          <td><button className="icon-btn" aria-label={`Slett ${p.name}`} onClick={() => setPoints((l) => l.filter((x) => x.id !== p.id))}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="fld-export">
                <div className="fld-row">
                  <label>Filformat
                    <select aria-label="Filformat" value={fs.exportFormat} onChange={(e) => setF({ exportFormat: e.target.value as FieldSettings['exportFormat'] })}>
                      {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </label>
                  <button className="btn primary fld-dl" disabled={!shown.length || (fs.exportFormat === 'sosi' && !sosiSupported(crs))} onClick={() => void download()}>
                    Last ned {shown.length} punkter
                  </button>
                </div>
                {fs.exportFormat === 'sosi' && !sosiSupported(crs) && <div className="fld-warn">SOSI støttes her bare i EUREF89 UTM (sone 31–36). Velg et UTM-system over, eller bruk KOF eller LandXML.</div>}
                <div className="muted small">Filen får punktene i utvalget over, i rekkefølgen du har sortert, og i koordinatsystemet {crsName(crs)}. {native_ ? 'Lagres i Nedlastinger/Feltkart på telefonen.' : 'Lastes ned til nedlastingsmappen på maskinen din.'}</div>
              </div>
              <div className="btn-row">
                <button className="btn" disabled={!!busy || !unsaved} onClick={() => void saveToProject()}>Lagre {unsaved ? `${unsaved} nye ` : ''}i prosjektet</button>
                {points.some((p) => p.saved) && <button className="btn" onClick={() => setPoints((l) => l.filter((p) => !p.saved))}>Fjern lagrede</button>}
                <button className="btn danger" onClick={() => { if (window.confirm(`Slette alle ${points.length} punkter?`)) setPoints([]); }}>Tøm</button>
              </div>
              <div className="muted small">Punktene ligger i denne enheten til du fjerner dem. «Lagre i prosjektet» legger dem også inn som KOF-fil i mappen Innmålinger, så de vises i kartet.</div>
            </>
          )}
        </div>
      )}

      {tab === 'bilde' && (
        <div className="fld-sec">
          <button className="btn primary fld-big" disabled={!!busy} onClick={() => void takeImage()}>Ta bilde</button>
          <div className="muted small">Bildet får posisjonen du hadde da du trykket på knappen, og havner i prosjektets bildemappe.{!native_ && ' På mobil åpner knappen kameraet, på PC et filvalg.'}</div>
          {!!photos.length && <div className="fld-list">{photos.map((p, i) => <div className="fld-pt" key={i}>{p}</div>)}</div>}
        </div>
      )}

      {tab === 'oppsett' && (
        <div className="fld-sec">
          <div className="fld-row">
            <label>Snitt (sekunder)<input type="number" min="0" max="60" value={fs.avgSeconds} onChange={(e) => setF({ avgSeconds: Math.max(0, Number(e.target.value) || 0) })} /></label>
          </div>
          <div className="fld-row">
            <label>Maks usikkerhet (cm)<input type="number" min="1" value={Math.round(fs.maxAccH * 100)} onChange={(e) => setF({ maxAccH: Math.max(0.01, (Number(e.target.value) || 5) / 100) })} /></label>
            <label>Høyde<select value={fs.heightMode} onChange={(e) => setF({ heightMode: e.target.value as 'device' | 'ellipsoid' })}>
              <option value="device">Slik mottakeren oppgir den</option>
              <option value="ellipsoid">Ellipsoidehøyde (bare direkte Bluetooth)</option>
            </select></label>
          </div>
          <label>Geoidemodell / høydesystem (vises i statusfeltet)
            <select aria-label="Geoidemodell" value={fs.vdatum} onChange={(e) => setF({ vdatum: e.target.value as 'NN2000' | 'NN54' | 'Annen' })}>
              <option value="NN2000">NN2000 (vanlig)</option>
              <option value="NN54">NN54</option>
              <option value="Annen">Annen</option>
            </select>
          </label>
          <label className="fld-check"><input type="checkbox" aria-label="Lyd ved registrering" checked={fs.sound} onChange={(e) => { setF({ sound: e.target.checked }); if (e.target.checked) { primeSound(); pling(); } }} /> Lyd (pling) når et punkt er registrert</label>
          <label className="fld-check"><input type="checkbox" checked={fs.requireFix} onChange={(e) => setF({ requireFix: e.target.checked })} /> Krev RTK Fix for å lagre punkt</label>
          <div className="fld-row">
            <label>Punkt-prefiks<input value={fs.prefix} onChange={(e) => setF({ prefix: e.target.value })} /></label>
            <label>Neste nummer<input type="number" min="1" value={fs.next} onChange={(e) => setF({ next: Math.max(1, Number(e.target.value) || 1) })} /></label>
          </div>
          <label>Hurtigkoder (én per linje)<textarea rows={4} value={fs.codes} onChange={(e) => setF({ codes: e.target.value })} /></label>
          {native_ && (
            <label>Android Client ID for Google Disk
              <input value={cid} placeholder="123456-abc.apps.googleusercontent.com" onChange={(e) => { setCid(e.target.value); setAndroidClientId(e.target.value); }} />
            </label>
          )}
          <div className="muted small">Feltkart {VERSION}{native_ ? ' · Android-appen' : ' · nettleser (Bluetooth krever Android-appen)'}</div>
          {native_ && <button className="btn" onClick={() => void native.call('openAppSettings', {})}>Åpne Android-innstillinger for appen</button>}
          {more && (
            <div className="fld-more" data-testid="more">
              <strong>Mer</strong>
              <div className="fld-more-grid">
                <button className="btn" onClick={more.onUpload}>Last opp filer</button>
                <button className="btn" onClick={more.onSync}>Google Disk</button>
                <button className="btn" onClick={more.onSettings}>Prosjektinnstillinger</button>
                <button className="btn" onClick={more.onReadme}>Readme</button>
                <button className="btn" onClick={more.onRefresh}>Sjekk ny versjon</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
