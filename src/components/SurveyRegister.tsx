import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../state';
import { compareFolders, descendantFolderIds } from '../state';
import type { Folder } from '../types';
import { CRS_LIST, crsName, measureCrs } from '../lib/crs';
import { EXPORT_FORMATS, buildExport, sosiSupported, type ExportFormat } from '../lib/field/export';
import { saveFile } from '../lib/field/native';
import {
  COLUMNS, DEFAULT_COLS, activeFilters, applyFilters, cellText, colDef, describeFilter, distinctValues, emptyLabel, isActive, rowsFromParsed, sortRows, toViewRows,
  type ColFilter, type ColKey, type Filters, type SortState, type SurveyRow, type ViewRow,
} from '../lib/field/register';
import { fmtTime } from '../lib/field/survey';
import { VERSION } from '../version';
import { IconChevron, IconChevronDown, IconClose, IconDownload, IconFilter, IconFolder, IconFolderOpen, IconPin, IconPlus, IconSearch, IconUpload } from './icons';

interface Props {
  project: Project;
  onUpload: () => void;
  onShowOnMap: (lat: number, lng: number) => void;
  onToast: (msg: string) => void;
}

const PAGE = 100;
const SKEY = 'feltkart.register';
const SURVEY_FORMATS = ['kof', 'sosi', 'landxml'];

interface Prefs { crs: string; crsBase?: string; format: ExportFormat; cols: ColKey[]; colsV?: number }
/** Versjon 2: nye kolonner (stanghøyde, kvalitet, PDOP, HDOP, VDOP, bruker) legges til for dem som har lagret et eldre valg */
const COLS_V = 2;
const NEW_COLS: ColKey[] = ['stang', 'kvalitet', 'pdop', 'hdop', 'vdop', 'bruker'];
function loadPrefs(): Prefs {
  const d: Prefs = { crs: '', format: 'kof', cols: DEFAULT_COLS };
  try {
    const p = JSON.parse(localStorage.getItem(SKEY) || '{}');
    return {
      crs: typeof p.crs === 'string' ? p.crs : d.crs,
      crsBase: typeof p.crsBase === 'string' ? p.crsBase : undefined,
      format: EXPORT_FORMATS.some((f) => f.id === p.format) ? p.format : d.format,
      cols: Array.isArray(p.cols) ? DEFAULT_COLS.filter((c) => p.cols.includes(c) || (p.colsV !== COLS_V && NEW_COLS.includes(c))) : d.cols,
      colsV: COLS_V,
    };
  } catch { return d; }
}

/** Innmåling: alle punkter fra KOF-, SOSI- og LandXML-filer i prosjektet. Her måles det ikke, punktene vises, filtreres, sorteres og lastes ned. */
export default function SurveyRegister({ project, onUpload, onShowOnMap, onToast }: Props) {
  const { folders, items, dxf, settings } = project;
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const setPref = (p: Partial<Prefs>) => setPrefs((x) => { const n = { ...x, ...p }; try { localStorage.setItem(SKEY, JSON.stringify(n)); } catch { /* ignorer */ } return n; });

  const [off, setOff] = useState<Set<string>>(() => new Set()); // mapper uten hake
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState<SortState>({ key: 'dato', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [pop, setPop] = useState<ColKey | 'add' | null>(null);
  const [menu, setMenu] = useState<'cols' | 'dl' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Lukk menyer og filtervinduer ved klikk utenfor
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.rg-pop') && !t.closest('[data-rg-open]')) { setPop(null); setMenu(null); }
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPop(null); setMenu(null); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);

  const surveyItems = useMemo(() => items.filter((i) => i.kind === 'dxf' && SURVEY_FORMATS.includes(i.format ?? 'dxf')), [items]);
  const loading = surveyItems.filter((i) => !dxf[i.id]?.data && !dxf[i.id]?.error).length;
  const errors = surveyItems.filter((i) => dxf[i.id]?.error);

  const allRows = useMemo<SurveyRow[]>(() => {
    const out: SurveyRow[] = [];
    for (const it of surveyItems) {
      if (it.kind !== 'dxf') continue;
      const data = dxf[it.id]?.data;
      if (!data) continue;
      out.push(...rowsFromParsed({ id: it.id, name: it.name, folderId: it.folderId, crs: it.crs, fileIso: new Date(it.modifiedAt ?? it.createdAt).toISOString() }, data));
    }
    return out;
  }, [surveyItems, dxf]);

  const projectCrs = settings?.projectCrs ?? 'EPSG:25832';
  const baseCrs = projectCrs !== 'EPSG:4326' ? projectCrs : measureCrs(projectCrs, allRows[0]?.lng ?? 10);
  // Valgt system gjelder bare så lenge prosjektet har samme system som da valget ble gjort
  const crs = prefs.crs && prefs.crs !== 'EPSG:4326' && prefs.crsBase === projectCrs ? prefs.crs : baseCrs;
  const view = useMemo(() => toViewRows(allRows, crs), [allRows, crs]);

  // ---------- Mappetre ----------
  const ownCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of surveyItems) m.set(it.folderId, m.get(it.folderId) ?? 0);
    for (const r of allRows) m.set(r.folderId, (m.get(r.folderId) ?? 0) + 1);
    return m; // mapper som har innmålingsfiler (også de som ennå leses)
  }, [surveyItems, allRows]);
  const subCount = (id: string) => descendantFolderIds(folders, id).reduce((s, f) => s + (ownCount.get(f) ?? 0), 0);
  const hasSurvey = (id: string) => descendantFolderIds(folders, id).some((f) => ownCount.has(f));
  const ownIds = (id: string) => descendantFolderIds(folders, id).filter((f) => ownCount.has(f));

  const nodes = useMemo(() => {
    const out: { f: Folder; depth: number }[] = [];
    const needle = q.trim().toLowerCase();
    const matches = (f: Folder): boolean => f.name.toLowerCase().includes(needle) || folders.some((c) => c.parentId === f.id && matches(c));
    const walk = (parent: string | null, depth: number) => {
      folders.filter((f) => f.parentId === parent).sort(compareFolders).forEach((f) => {
        if (!hasSurvey(f.id) || (needle && !matches(f))) return;
        out.push({ f, depth });
        if (!collapsed.has(f.id) || needle) walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, ownCount, collapsed, q]);

  const state = (id: string): 'on' | 'off' | 'mixed' => {
    const ids = ownIds(id);
    const n = ids.filter((x) => off.has(x)).length;
    return n === 0 ? 'on' : n === ids.length ? 'off' : 'mixed';
  };
  const toggleFolder = (id: string) => {
    const ids = ownIds(id);
    setOff((o) => { const n = new Set(o); if (state(id) === 'on') ids.forEach((x) => n.add(x)); else ids.forEach((x) => n.delete(x)); return n; });
    setPage(0);
  };

  // ---------- Utvalg ----------
  const inFolders = useMemo(() => (off.size ? view.filter((r) => !off.has(r.folderId)) : view), [view, off]);
  const filtered = useMemo(() => applyFilters(inFolders, filters), [inFolders, filters]);
  const rows = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const nActive = activeFilters(filters).length;
  const narrowed = nActive > 0 || off.size > 0;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const selRows = sel.size ? rows.filter((r) => sel.has(r.key)) : [];
  const allShownSel = shown.length > 0 && shown.every((r) => sel.has(r.key));

  const setFilter = (k: ColKey, f: ColFilter | null) => {
    setFilters((cur) => { const n = { ...cur }; if (f && isActive(f)) n[k] = f; else delete n[k]; return n; });
    setPage(0);
  };
  const clearAll = () => { setFilters({}); setOff(new Set()); setPage(0); setSel(new Set()); };
  const toggleSort = (k: ColKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  async function download(fmt: ExportFormat) {
    setMenu(null);
    const pts = selRows.length ? selRows : rows;
    if (!pts.length) return;
    try {
      const out = buildExport(fmt, pts, crs, VERSION);
      const where = await saveFile(out.name, new Blob([out.text], { type: `${out.mime};charset=utf-8` }));
      setPref({ format: fmt });
      onToast(`${out.count} punkter lagret som ${out.name} i ${where}`);
    } catch (e: any) {
      onToast(String(e?.message ?? e));
    }
  }

  const cols = COLUMNS.filter((c) => prefs.cols.includes(c.key));
  const cell = (r: ViewRow, k: ColKey) => {
    switch (k) {
      case 'punkt': return r.name;
      case 'kode': return r.code || <span className="rg-none">–</span>;
      case 'dato': return fmtTime(r.time);
      case 'fil': return r.fileName;
      default: return cellText(r, k) || <span className="rg-none">–</span>;
    }
  };

  const exportCount = selRows.length || rows.length;

  return (
    <div className="rg" data-testid="register">
      <aside className="rg-side">
        <button className="btn rg-import" onClick={onUpload}><IconUpload size={16} /> Importer innmålinger</button>
        <label className="rg-search">
          <IconSearch size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk i mappestruktur" aria-label="Søk i mappestruktur" />
        </label>
        <div className="rg-tree" role="tree" aria-label="Mapper med innmålinger">
          {nodes.length === 0 && <p className="rg-hint">{q ? 'Ingen mapper passer søket.' : 'Ingen innmålinger ennå. Importer KOF-, SOSI- eller LandXML-filer.'}</p>}
          {nodes.map(({ f, depth }) => {
            const st = state(f.id);
            const kids = folders.some((c) => c.parentId === f.id && hasSurvey(c.id));
            const open = !collapsed.has(f.id);
            return (
              <div key={f.id} className="rg-node" role="treeitem" aria-expanded={kids ? open : undefined} style={{ paddingLeft: 6 + depth * 18 }}>
                <button className={`rg-chev${kids ? '' : ' hid'}`} aria-label={open ? 'Skjul undermapper' : 'Vis undermapper'}
                  onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
                  <IconChevron size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} />
                </button>
                <input type="checkbox" checked={st === 'on'} aria-label={`Vis ${f.name}`} ref={(el) => { if (el) el.indeterminate = st === 'mixed'; }} onChange={() => toggleFolder(f.id)} />
                {open && kids ? <IconFolderOpen size={17} /> : <IconFolder size={17} />}
                <span className="rg-fname" title={f.name}>{f.name}</span>
                <span className="rg-fcount">({subCount(f.id)})</span>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="rg-main">
        <div className="rg-bar" ref={barRef}>
          <div className="rg-addwrap">
            <button className="btn rg-add" data-rg-open onClick={() => setPop(pop === 'add' ? null : 'add')}><IconPlus size={15} /> Legg til filter</button>
            {pop === 'add' && <AddFilter rows={inFolders} filters={filters} onApply={(k, f) => { setFilter(k, f); setPop(null); }} />}
          </div>
          <div className="rg-chips">
            {activeFilters(filters).map((k) => (
              <span key={k} className="rg-chip" data-testid="chip">
                {describeFilter(k, filters[k]!)}
                <button aria-label={`Fjern filter ${colDef(k).label}`} onClick={() => setFilter(k, null)}><IconClose size={12} /></button>
              </span>
            ))}
          </div>
          <label className="rg-crs">Koordinatsystem
            <select aria-label="Koordinatsystem" value={crs} onChange={(e) => setPref(e.target.value === baseCrs ? { crs: '', crsBase: undefined } : { crs: e.target.value, crsBase: projectCrs })}>
              {CRS_LIST.filter((c) => c.code !== 'EPSG:4326').map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <div className="rg-addwrap">
            <button className="btn rg-dl" data-rg-open disabled={!exportCount} onClick={() => setMenu(menu === 'dl' ? null : 'dl')}>
              <IconDownload size={16} /> Last ned innmålinger <IconChevronDown size={14} />
            </button>
            {menu === 'dl' && (
              <div className="rg-pop rg-menu" role="menu" aria-label="Filformat">
                <div className="rg-menu-h">{exportCount} {selRows.length ? 'valgte' : narrowed ? 'viste' : ''} punkter i {crsName(crs)}</div>
                {EXPORT_FORMATS.map((f) => {
                  const bad = f.id === 'sosi' && !sosiSupported(crs);
                  return <button key={f.id} role="menuitem" disabled={bad} title={bad ? 'SOSI støttes bare i EUREF89 UTM (sone 31–36)' : undefined} onClick={() => download(f.id)}>{f.label} <span>.{f.ext}</span></button>;
                })}
              </div>
            )}
          </div>
          <button className="btn rg-clear" onClick={clearAll} disabled={!narrowed && !sel.size}>Fjern filter</button>
        </div>
        <div className="rg-count" data-testid="count">
          {allRows.length === 0 && loading === 0 ? 'Ingen innmålinger/punkter å vise'
            : narrowed ? `Viser ${rows.length} av ${allRows.length} innmålinger/punkter` : `Viser alle ${allRows.length} innmålinger/punkter`}
          {loading > 0 && <span className="rg-load"> · leser {loading} fil{loading === 1 ? '' : 'er'} …</span>}
          {sel.size > 0 && <span> · {selRows.length} valgt</span>}
        </div>
        {errors.length > 0 && <div className="rg-err" role="alert">Kunne ikke lese: {errors.map((i) => `${i.name} (${dxf[i.id]?.error})`).join('; ')}</div>}

        <div className="rg-tools">
          <button className="btn rg-tb" disabled={!selRows.length} onClick={() => selRows[0] && onShowOnMap(selRows[0].lat, selRows[0].lng)} title="Vis første valgte punkt i kartet"><IconPin size={16} /> Vis i kart</button>
          <div className="rg-addwrap rg-colswrap">
            <button className="btn" data-rg-open onClick={() => setMenu(menu === 'cols' ? null : 'cols')}>Vis kolonner <IconChevronDown size={14} /></button>
            {menu === 'cols' && (
              <div className="rg-pop rg-menu rg-cols" role="group" aria-label="Kolonner">
                {COLUMNS.map((c) => (
                  <label key={c.key}>
                    <input type="checkbox" checked={prefs.cols.includes(c.key)} disabled={prefs.cols.length === 1 && prefs.cols.includes(c.key)}
                      onChange={(e) => setPref({ cols: DEFAULT_COLS.filter((k) => (k === c.key ? e.target.checked : prefs.cols.includes(k))) })} /> {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rg-tablewrap">
          <table className="rg-table" data-testid="points">
            <thead>
              <tr>
                <th className="rg-chk"><input type="checkbox" aria-label="Velg alle på siden" checked={allShownSel} onChange={() => setSel((s) => { const n = new Set(s); if (allShownSel) shown.forEach((r) => n.delete(r.key)); else shown.forEach((r) => n.add(r.key)); return n; })} /></th>
                <th className="rg-act">Handlinger</th>
                {cols.map((c) => (
                  <th key={c.key} className={c.kind === 'num' ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <div className="rg-th">
                      <button className="rg-sort" onClick={() => toggleSort(c.key)} aria-label={`Sorter på ${c.label}`}>
                        {c.label}<span className="rg-arr" aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                      <button className={`rg-fbtn${isActive(filters[c.key]) ? ' on' : ''}`} data-rg-open aria-label={`Filtrer ${c.label}`} onClick={() => setPop(pop === c.key ? null : c.key)}><IconFilter size={13} /></button>
                    </div>
                    {pop === c.key && (
                      <FilterBox col={c.key} rows={inFolders} value={filters[c.key]} onApply={(f) => { setFilter(c.key, f); setPop(null); }} onClear={() => { setFilter(c.key, null); setPop(null); }} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={sel.has(r.key) ? 'sel' : ''}>
                  <td className="rg-chk"><input type="checkbox" aria-label={`Velg ${r.name || 'punkt'}`} checked={sel.has(r.key)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} /></td>
                  <td className="rg-act"><button className="rg-pinbtn" title="Vis i kartet" aria-label={`Vis ${r.name || 'punkt'} i kartet`} onClick={() => onShowOnMap(r.lat, r.lng)}><IconPin size={15} /></button></td>
                  {cols.map((c) => <td key={c.key} className={c.kind === 'num' ? 'num' : c.key === 'fil' ? 'rg-file' : ''}>{cell(r, c.key)}</td>)}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={cols.length + 2} className="rg-empty">
                  {allRows.length === 0 ? (loading ? 'Leser innmålingsfiler …' : 'Ingen innmålinger i prosjektet. Trykk «Importer innmålinger» for å legge til KOF-, SOSI- eller LandXML-filer.') : 'Ingen punkter passer utvalget.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > PAGE && (
          <div className="rg-pager">
            <button className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Forrige</button>
            <span data-testid="pageinfo">{cur * PAGE + 1}–{Math.min(rows.length, (cur + 1) * PAGE)} av {rows.length}</span>
            <button className="btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Neste</button>
          </div>
        )}
      </section>
    </div>
  );
}

/** «Legg til filter»: velg kolonne, og sett så filteret */
function AddFilter({ rows, filters, onApply }: { rows: ViewRow[]; filters: Filters; onApply: (k: ColKey, f: ColFilter) => void }) {
  const [col, setCol] = useState<ColKey>(() => COLUMNS.find((c) => !isActive(filters[c.key]))?.key ?? 'kode');
  return (
    <div className="rg-pop rg-fbox" role="dialog" aria-label="Legg til filter">
      <label className="rg-field">Kolonne
        <select aria-label="Filtrer kolonne" value={col} onChange={(e) => setCol(e.target.value as ColKey)}>
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      <FilterBody key={col} col={col} rows={rows} value={filters[col]} onApply={(f) => onApply(col, f)} />
    </div>
  );
}

function FilterBox({ col, rows, value, onApply, onClear }: { col: ColKey; rows: ViewRow[]; value?: ColFilter; onApply: (f: ColFilter) => void; onClear: () => void }) {
  return (
    <div className="rg-pop rg-fbox" role="dialog" aria-label={`Filter ${colDef(col).label}`}>
      <FilterBody col={col} rows={rows} value={value} onApply={onApply} onClear={onClear} />
    </div>
  );
}

function FilterBody({ col, rows, value, onApply, onClear }: { col: ColKey; rows: ViewRow[]; value?: ColFilter; onApply: (f: ColFilter) => void; onClear?: () => void }) {
  const kind = colDef(col).kind;
  const [d, setD] = useState<ColFilter>(() => ({ ...value, set: value?.set ? [...value.set] : undefined }));
  const [find, setFind] = useState('');
  const values = useMemo(() => (kind === 'set' ? distinctValues(rows, col as 'kode' | 'fil' | 'kvalitet' | 'bruker') : []), [kind, rows, col]);
  const shownVals = values.filter((v) => (v.value || emptyLabel(col)).toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (v: string) => setD((x) => { const s = new Set(x.set ?? []); if (s.has(v)) s.delete(v); else s.add(v); return { ...x, set: [...s] }; });
  const submit = (e?: FormEvent) => { e?.preventDefault(); onApply(d); };
  return (
    <form className="rg-fbody" onSubmit={submit}>
      {kind === 'text' && (
        <label className="rg-field">Inneholder
          <input autoFocus value={d.text ?? ''} aria-label="Inneholder" onChange={(e) => setD({ ...d, text: e.target.value })} />
        </label>
      )}
      {kind === 'set' && (
        <>
          {values.length > 8 && <input className="rg-vfind" placeholder="Søk" aria-label="Søk i verdier" value={find} onChange={(e) => setFind(e.target.value)} />}
          <div className="rg-vals" role="group" aria-label="Verdier">
            {shownVals.map((v) => (
              <label key={v.value || '__ingen'}>
                <input type="checkbox" checked={d.set?.includes(v.value) ?? false} onChange={() => toggle(v.value)} />
                <span className="rg-vname">{v.value || emptyLabel(col)}</span><span className="rg-vcnt">{v.count}</span>
              </label>
            ))}
            {!shownVals.length && <p className="rg-hint">Ingen verdier.</p>}
          </div>
        </>
      )}
      {kind === 'date' && (
        <div className="rg-range">
          <label className="rg-field">Fra dato<input type="date" aria-label="Fra dato" value={d.min ?? ''} onChange={(e) => setD({ ...d, min: e.target.value })} /></label>
          <label className="rg-field">Til dato<input type="date" aria-label="Til dato" value={d.max ?? ''} onChange={(e) => setD({ ...d, max: e.target.value })} /></label>
        </div>
      )}
      {kind === 'num' && (
        <div className="rg-range">
          <label className="rg-field">Fra<input inputMode="decimal" aria-label="Fra verdi" value={d.min ?? ''} onChange={(e) => setD({ ...d, min: e.target.value })} /></label>
          <label className="rg-field">Til<input inputMode="decimal" aria-label="Til verdi" value={d.max ?? ''} onChange={(e) => setD({ ...d, max: e.target.value })} /></label>
        </div>
      )}
      <div className="rg-fact">
        {onClear && <button type="button" className="btn" onClick={onClear}>Fjern</button>}
        <button type="submit" className="btn primary">Bruk filter</button>
      </div>
    </form>
  );
}

