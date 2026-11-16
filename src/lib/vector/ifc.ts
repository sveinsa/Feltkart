// IFC vist som grunnriss i kartet. Leses i nettleseren med web-ifc (WASM) som lastes fra CDN første gang.
// Hvert objekt tegnes som omrisset (konveks innhylling) av geometrien sett ovenfra, med lag etter IFC-klasse.
import { Builder, type LL, type XYZ } from './builder';
import type { Mesh3D, ParsedDxf } from '../dxf';
import { ensureCrs, fromLatLng } from '../crs';
import { colorFor, darken, hexCss, hexNum } from '../ifcColors';

export interface Placement { e: number; n: number; rot: number } // modellens origo i prosjektets koordinatsystem, rotasjon (grader mot klokka)

const V = '0.0.51';
const CDN = `https://cdn.jsdelivr.net/npm/web-ifc@${V}/`;

let apiP: Promise<{ api: any; W: any }> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`Kunne ikke laste ${src}`));
    document.head.appendChild(s);
  });
}

async function loadApi() {
  if (!apiP) {
    apiP = (async () => {
      let W: any = null;
      const dyn = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
      for (const u of [`${CDN}web-ifc-api.js`, `https://unpkg.com/web-ifc@${V}/web-ifc-api.js`]) {
        try { const m = await dyn(u); const mod = m?.IfcAPI ? m : m?.default; if (mod?.IfcAPI) { W = mod; break; } } catch { /* prøv neste */ }
      }
      if (!W) {
        try { await loadScript(`${CDN}web-ifc-api-iife.js`); W = (window as any).WebIFC; } catch { /* gir feil under */ }
      }
      if (!W?.IfcAPI) throw new Error('Kunne ikke laste IFC-leseren (web-ifc) fra nettet. Sjekk internettilgangen og prøv igjen.');
      const api = new W.IfcAPI();
      api.SetWasmPath(CDN, true);
      await api.Init(undefined, true);
      return { api, W };
    })().catch((e) => { apiP = null; throw e; });
  }
  return apiP;
}

const LABELS: Record<string, string> = {
  IFCWALL: 'Vegger', IFCWALLSTANDARDCASE: 'Vegger', IFCSLAB: 'Dekker og plater', IFCROOF: 'Tak', IFCBEAM: 'Bjelker', IFCCOLUMN: 'Søyler',
  IFCWINDOW: 'Vinduer', IFCDOOR: 'Dører', IFCSTAIR: 'Trapper', IFCRAILING: 'Rekkverk', IFCCOVERING: 'Kledning', IFCMEMBER: 'Stag', IFCPLATE: 'Plater',
  IFCFOOTING: 'Fundamenter', IFCPILE: 'Peler', IFCPIPESEGMENT: 'Rør', IFCPIPEFITTING: 'Rørdeler', IFCFLOWSEGMENT: 'Ledninger', IFCFLOWFITTING: 'Koblinger',
  IFCDISTRIBUTIONELEMENT: 'Distribusjon', IFCDISTRIBUTIONCHAMBERELEMENT: 'Kummer', IFCBUILDINGELEMENTPROXY: 'Andre objekter',
  IFCGEOGRAPHICELEMENT: 'Terreng og geografi', IFCCIVILELEMENT: 'Anleggsobjekter', IFCEARTHWORKSELEMENT: 'Masseforflytning',
  IFCROAD: 'Veg', IFCPAVEMENT: 'Overbygning', IFCCURTAINWALL: 'Glassfasader', IFCFURNISHINGELEMENT: 'Inventar',
};
const SKIP = new Set(['IFCOPENINGELEMENT', 'IFCSPACE', 'IFCOPENINGSTANDARDCASE', 'IFCVIRTUALELEMENT', 'IFCANNOTATION']);

function hull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq: [number, number][] = [];
  for (const q of p) if (!uniq.length || uniq[uniq.length - 1][0] !== q[0] || uniq[uniq.length - 1][1] !== q[1]) uniq.push(q);
  if (uniq.length < 3) return uniq;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of uniq) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up: [number, number][] = [];
  for (let i = uniq.length - 1; i >= 0; i--) { const q = uniq[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

const val = (v: any) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

function angle(list: any): number | null {
  if (!Array.isArray(list) || !list.length) return null;
  const v = list.map((x) => Number(val(x)) || 0);
  const sign = v[0] < 0 || Object.is(v[0], -0) ? -1 : 1;
  return sign * (Math.abs(v[0]) + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600 + (v[3] ?? 0) / 3.6e9);
}

export async function parseIfc(
  buf: ArrayBuffer,
  crs: string,
  mkLl: (crs: string) => LL,
  detect: boolean,
  placement?: Placement,
  onProgress?: (m: string) => void,
): Promise<ParsedDxf> {
  if (buf.byteLength > 400e6) throw new Error('IFC-filen er for stor til å åpnes i nettleseren (over 400 MB).');
  onProgress?.('laster IFC-leseren …');
  const { api, W } = await loadApi();
  onProgress?.('leser IFC …');
  const id = api.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: false });
  try {
    // Typenavn
    const typeName = new Map<number, string>();
    for (const k of Object.keys(LABELS).concat([...SKIP])) if (typeof W[k] === 'number') typeName.set(W[k], k);
    const nameOf = (eid: number): string => {
      try {
        const t = api.GetLineType(id, eid);
        const known = typeName.get(t);
        if (known) return known;
        if (typeof api.GetNameFromTypeCode === 'function') return String(api.GetNameFromTypeCode(t)).toUpperCase();
      } catch { /* ignorer */ }
      return 'IFCPRODUCT';
    };

    // Rågeometri: per objekt en liste «biter» (én per del-geometri), hver med egen farge fra IFC-filens overflatestiler
    interface Piece { xyz: Float64Array; tris: Float32Array[]; rgb: number | null; alpha: number }
    interface M { eid: number; pieces: Piece[] }
    const TRI_CAP = 2_500_000; // maks antall trekanter som beholdes for 3D-visning
    let triTotal = 0;
    let truncated = false;
    let rawO: [number, number, number] | null = null; // første punkt – trekanter lagres relativt til dette (Float32 holder da full presisjon)
    const meshes: M[] = [];
    let pieceCount = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    // web-ifc gir fargen som {x,y,z,w} = rød, grønn, blå, alfa (0–1). Nyere versjoner kan bruke {r,g,b,a}.
    // Hvit (1,1,1) betyr at modellen ikke har noen farge her, og da brukes standardfargen for klassen.
    const readColor = (c: any): { rgb: number | null; alpha: number } => {
      if (!c) return { rgb: null, alpha: 1 };
      const r = Number(c.x ?? c.r), g = Number(c.y ?? c.g), b = Number(c.z ?? c.b), a = Number(c.w ?? c.a ?? 1);
      if (![r, g, b].every((v) => Number.isFinite(v))) return { rgb: null, alpha: 1 };
      const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
      const alpha = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
      const white = q(r) >= 253 && q(g) >= 253 && q(b) >= 253;
      return { rgb: white && alpha >= 0.99 ? null : (q(r) << 16) | (q(g) << 8) | q(b), alpha };
    };
    api.StreamAllMeshes(id, (mesh: any) => {
      const geoms = mesh.geometries;
      const pieces: Piece[] = [];
      for (let g = 0; g < geoms.size(); g++) {
        const pg = geoms.get(g);
        const geo = api.GetGeometry(id, pg.geometryExpressID);
        const verts: Float32Array = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        const m = pg.flatTransformation as number[];
        const n = verts.length / 6;
        const { rgb, alpha } = readColor(pg.color);
        const chunks: number[] = [];
        const tris: Float32Array[] = [];
        // Trekanter til 3D-visning (transformert, relativt til første punkt)
        try {
          if (triTotal < TRI_CAP) {
            const idx: Uint32Array = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
            const nTri = Math.floor(idx.length / 3);
            const take = Math.min(nTri, TRI_CAP - triTotal);
            if (take < nTri) truncated = true;
            const out = new Float32Array(take * 9);
            for (let t = 0; t < take; t++) {
              for (let k = 0; k < 3; k++) {
                const vi = idx[t * 3 + k] * 6;
                const x = verts[vi], y = verts[vi + 1], z = verts[vi + 2];
                const X = m[0] * x + m[4] * y + m[8] * z + m[12];
                const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
                const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
                if (!rawO) rawO = [X, Y, Z];
                const o = t * 9 + k * 3;
                out[o] = X - rawO[0]; out[o + 1] = Y - rawO[1]; out[o + 2] = Z - rawO[2];
              }
            }
            tris.push(out);
            triTotal += take;
          } else truncated = true;
        } catch { /* ingen trekantdata – grunnriss fungerer likevel */ }
        const step = Math.max(1, Math.floor(n / 20000));
        for (let i = 0; i < n; i += step) {
          const x = verts[i * 6], y = verts[i * 6 + 1], z = verts[i * 6 + 2];
          const X = m[0] * x + m[4] * y + m[8] * z + m[12];
          const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
          const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
          chunks.push(X, Y, Z);
          if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
          if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
          if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
        }
        geo.delete?.();
        if (chunks.length >= 9) { pieces.push({ xyz: Float64Array.from(chunks), tris, rgb, alpha }); pieceCount++; }
      }
      if (pieces.length) meshes.push({ eid: mesh.expressID, pieces });
      mesh.delete?.();
    });
    if (!meshes.length) throw new Error('Fant ingen geometri i IFC-filen.');

    // web-ifc leverer normalt Y opp (x, høyde, -nord). Ved store projiserte koordinater kan vi se det direkte.
    const big = (v: number) => Math.abs(v) > 1e5;
    let yUp = true;
    const ay = Math.max(Math.abs(min[1]), Math.abs(max[1])), az = Math.max(Math.abs(min[2]), Math.abs(max[2]));
    if (big(max[0]) || big(min[0]) || big(ay) || big(az)) {
      if (big(az) && !big(ay)) yUp = true;
      else if (big(ay) && !big(az)) yUp = false;
    }
    const local = (x: number, y: number, z: number): [number, number, number] => (yUp ? [x, -z, y] : [x, y, z]);
    const lmin = local(min[0], min[1], min[2]), lmax = local(max[0], max[1], max[2]);
    const cx = (lmin[0] + lmax[0]) / 2, cy = (Math.min(lmin[1], lmax[1]) + Math.max(lmin[1], lmax[1])) / 2;

    // Georeferanse
    let useCrs = crs;
    const warn: string[] = [];
    let xf: ((x: number, y: number) => [number, number]) | null = null;
    let dz = 0;
    try {
      const mcIds = typeof W.IFCMAPCONVERSION === 'number' ? api.GetLineIDsWithType(id, W.IFCMAPCONVERSION) : null;
      if (mcIds && mcIds.size() > 0) {
        const mc = api.GetLine(id, mcIds.get(0));
        const E0 = Number(val(mc.Eastings)) || 0, N0 = Number(val(mc.Northings)) || 0;
        const a = val(mc.XAxisAbscissa) ?? 1, b = val(mc.XAxisOrdinate) ?? 0;
        const s = val(mc.Scale) ?? 1;
        dz = Number(val(mc.OrthogonalHeight)) || 0;
        xf = (x, y) => [E0 + s * (a * x - b * y), N0 + s * (b * x + a * y)];
        const pcIds = typeof W.IFCPROJECTEDCRS === 'number' ? api.GetLineIDsWithType(id, W.IFCPROJECTEDCRS) : null;
        if (pcIds && pcIds.size() > 0) {
          const nm = String(val(api.GetLine(id, pcIds.get(0)).Name) ?? '');
          const mm = /EPSG\s*[:\-]?\s*(\d{4,5})/i.exec(nm);
          if (mm) {
            const code = `EPSG:${mm[1]}`;
            if (detect && ensureCrs(code)) useCrs = code;
            else if (!ensureCrs(code)) warn.push(`IFC oppgir koordinatsystem «${nm}», som ikke støttes. Brukte ${crs}.`);
          }
        }
      }
    } catch { /* ingen MapConversion */ }

    if (!xf) {
      const projected = Math.abs(cx) > 1e5 || Math.abs(cy) > 1e5;
      if (projected && !placement) {
        xf = (x, y) => [x, y];
        warn.push('IFC-filen ser ut til å ligge i prosjektert koordinatsystem (store koordinater). Brukt som den er.');
      } else if (placement) {
        const t = (placement.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
        xf = (x, y) => [placement.e + x * c - y * s, placement.n + x * s + y * c];
      } else {
        try {
          const siteIds = typeof W.IFCSITE === 'number' ? api.GetLineIDsWithType(id, W.IFCSITE) : null;
          if (siteIds && siteIds.size() > 0) {
            const site = api.GetLine(id, siteIds.get(0));
            const lat = angle(site.RefLatitude), lng = angle(site.RefLongitude);
            if (lat !== null && lng !== null) {
              const [e0, n0] = fromLatLng(crs, lat, lng);
              xf = (x, y) => [e0 + x, n0 + y];
              warn.push('IFC-filen har ingen kartkonvertering. Plassert ut fra stedets breddegrad og lengdegrad (IfcSite). Kontroller plasseringen.');
            }
          }
        } catch { /* ingen IfcSite */ }
      }
    }
    if (!xf) throw new Error('IFC-filen mangler georeferanse (IfcMapConversion eller stedets posisjon). Oppgi Øst og Nord for modellens origo i opplastingsdialogen, og last opp på nytt.');

    ensureCrs(useCrs);
    const b = new Builder(mkLl(useCrs));
    // Grunnriss: ett omriss per del-geometri (med egen farge) så lenge modellen ikke er enorm, ellers ett per objekt
    const detailed = pieceCount <= 40000;
    b.warnings.push(...warn, detailed
      ? 'IFC vises som grunnriss (omriss) av hver del, med fargene fra modellen. Høyder er fra IFC-modellen.'
      : 'IFC vises som grunnriss (omriss) av hvert objekt. Høyder er fra IFC-modellen.');

    onProgress?.('lager grunnriss …');
    // 3D: trekanter omregnes til prosjektets koordinatsystem (meter relativt til modellens midtpunkt)
    const [E0, N0] = xf(cx, cy);
    interface PartAcc { layer: string; color?: number; opacity?: number; chunks: Float32Array[] }
    const partsMap = new Map<string, PartAcc>();
    const toProject = (ch: Float32Array): Float32Array => {
      const o = new Float32Array(ch.length);
      const r = rawO ?? [0, 0, 0];
      for (let i = 0; i < ch.length; i += 3) {
        const l = local(ch[i] + r[0], ch[i + 1] + r[1], ch[i + 2] + r[2]);
        const [E, N] = xf(l[0], l[1]);
        o[i] = E - E0; o[i + 1] = N - N0; o[i + 2] = l[2] + dz;
      }
      return o;
    };

    // Egenskaper (property sets) leses bare for modeller av moderat størrelse – oppslaget er tregt i store filer
    const wantProps = meshes.length <= 1500;
    const t0 = Date.now();
    let propsStopped = false;
    const psetAttrs = (eid: number): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!wantProps || propsStopped) return out;
      if (Date.now() - t0 > 6000) { propsStopped = true; return out; }
      try {
        const sets = api.properties?.getPropertySets?.(id, eid, true);
        if (!Array.isArray(sets)) return out;
        let n = 0;
        for (const ps of sets) {
          const pn = String(val(ps?.Name) ?? '').trim();
          const props = ps?.HasProperties ?? ps?.Quantities ?? [];
          if (!Array.isArray(props)) continue;
          for (const pr of props) {
            const k = val(pr?.Name);
            let v = val(pr?.NominalValue);
            if (v === undefined || v === null) v = val(pr?.LengthValue ?? pr?.AreaValue ?? pr?.VolumeValue ?? pr?.CountValue ?? pr?.WeightValue);
            if (!k || v === undefined || v === null || v === '' || typeof v === 'object') continue;
            const txt = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v).replace(/^\.T\.$/, 'Ja').replace(/^\.F\.$/, 'Nei');
            out[`${pn ? pn + ': ' : ''}${String(k)}`] = txt;
            if (++n >= 40) return out;
          }
        }
      } catch { /* ingen egenskaper */ }
      return out;
    };

    interface Out2D { zhi: number; layer: string; h: [number, number][]; zs: [number, number]; attrs: Record<string, string>; rgb: number; alpha: number }
    const out2d: Out2D[] = [];
    for (const m of meshes) {
      const name0 = nameOf(m.eid);
      if (SKIP.has(name0)) { b.skip(name0.replace(/^IFC/, 'Ifc')); continue; }
      const layer = LABELS[name0] ?? name0.replace(/^IFC/, 'Ifc');
      const attrs: Record<string, string> = { Klasse: name0.replace(/^IFC/, 'Ifc') };
      try {
        const line = api.GetLine(id, m.eid);
        const nm = val(line?.Name); if (nm) attrs.Navn = String(nm);
        const gid = val(line?.GlobalId); if (gid) attrs.GlobalId = String(gid);
        const desc = val(line?.Description); if (desc) attrs.Beskrivelse = String(desc);
        const ot = val(line?.ObjectType); if (ot) attrs.Objekttype = String(ot);
        const pt = val(line?.PredefinedType); if (pt && String(pt) !== 'NOTDEFINED') attrs.Type = String(pt);
        const tg = val(line?.Tag); if (tg) attrs.Tag = String(tg);
      } catch { /* ignorer */ }
      Object.assign(attrs, psetAttrs(m.eid));

      // 3D-deler grupperes etter lag, farge og gjennomsiktighet (få materialer – rask tegning)
      for (const pc of m.pieces) {
        if (!pc.tris.length) continue;
        const key = `${layer}|${pc.rgb ?? 'x'}|${Math.round(pc.alpha * 20)}`;
        let acc = partsMap.get(key);
        if (!acc) { acc = { layer, color: pc.rgb ?? undefined, opacity: pc.alpha < 0.99 ? pc.alpha : undefined, chunks: [] }; partsMap.set(key, acc); }
        for (const ch of pc.tris) acc.chunks.push(toProject(ch));
        pc.tris = []; // frigjør minne
      }

      // Grunnriss
      const groups: { pieces: Piece[] }[] = detailed ? m.pieces.map((pc) => ({ pieces: [pc] })) : [{ pieces: m.pieces }];
      for (const grp of groups) {
        const pts: [number, number][] = [];
        let zlo = Infinity, zhi = -Infinity;
        for (const pc of grp.pieces) {
          for (let i = 0; i < pc.xyz.length; i += 3) {
            const l = local(pc.xyz[i], pc.xyz[i + 1], pc.xyz[i + 2]);
            pts.push(xf(l[0], l[1]));
            if (l[2] < zlo) zlo = l[2]; if (l[2] > zhi) zhi = l[2];
          }
        }
        const first = grp.pieces.find((pc) => pc.rgb !== null) ?? grp.pieces[0];
        out2d.push({
          zhi: zhi + dz, layer, h: hull(pts), zs: [zlo + dz, zhi + dz], attrs,
          rgb: first.rgb ?? hexNum(colorFor(layer)), alpha: first.alpha,
        });
      }
    }
    // Lave deler tegnes først, slik at høyere deler (tak, motorer) havner oppå
    out2d.sort((p, q) => p.zhi - q.zhi);
    for (const o of out2d) {
      if (o.h.length >= 3) {
        b.polygon(o.layer, 'IFC-objekt', o.h.map((p) => [p[0], p[1], NaN] as XYZ), o.attrs);
        const f = b.features[b.features.length - 1];
        if (f) {
          f.z = o.zs;
          f.fill = hexCss(o.rgb);
          f.color = hexCss(darken(o.rgb));
          f.fillOpacity = o.alpha < 0.99 ? Math.max(0.2, o.alpha * 0.85) : 0.85;
        }
      } else if (o.h.length === 2) {
        b.line(o.layer, 'IFC-objekt', o.h.map((p) => [p[0], p[1], o.zs[0]] as XYZ), o.attrs);
      } else if (o.h.length === 1) {
        b.point(o.layer, 'IFC-objekt', [o.h[0][0], o.h[0][1], o.zs[0]], undefined, o.attrs);
      }
    }
    if (propsStopped) b.warnings.push('Egenskapene (property sets) ble bare lest for deler av modellen, fordi lesingen tok for lang tid.');
    else if (!wantProps) b.warnings.push('Modellen er stor. Egenskaper fra property sets er ikke lest (navn, type og tag vises).');

    const res = b.finish(useCrs);
    if (partsMap.size) {
      const parts: Mesh3D['parts'] = [];
      let triangles = 0;
      for (const acc of partsMap.values()) {
        const len = acc.chunks.reduce((a, c) => a + c.length, 0);
        const positions = new Float32Array(len);
        let off = 0;
        for (const c of acc.chunks) { positions.set(c, off); off += c.length; }
        triangles += len / 9;
        parts.push({ layer: acc.layer, positions, color: acc.color, opacity: acc.opacity });
      }
      res.mesh3d = { crs: useCrs, origin: [E0, N0], parts, triangles, truncated };
      if (truncated) res.warnings.push(`3D-visningen viser de første ${TRI_CAP.toLocaleString('nb-NO')} trekantene (modellen er stor).`);
    }
    return res;
  } finally {
    try { api.CloseModel(id); } catch { /* ignorer */ }
  }
}
