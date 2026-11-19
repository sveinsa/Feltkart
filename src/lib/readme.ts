// Readme-siden: oversikt over Feltkart og versjonshistorikk. Bygges som én selvstendig HTML-side,
// slik at den kan åpnes i eget vindu (nettleseren) eller vises i en dialog (Android-appen).

import { ZENO_SECTION } from './readmeZeno';

export interface Release { v: string; title: string; text: string }

/** Versjonshistorikk, nyeste først. Legg til en linje øverst for hver ny versjon. */
export const CHANGELOG: Release[] = [
  { v: '7.1', title: 'Utsetting: gå til punkter', text: 'Ny fane «Utsett» i Felt i Android-appen. Velg ett eller flere punkter fra prosjektet (objekter, prosjektpunkter, bilder med posisjon, innmålte punkter eller et punkt du trykker på i kartet) og gå til dem. Du ser avstand, en pil som peker mot punktet, nord- og østforskjell og skjær/fyll når punktet har høyde. Lilla markør og stiplet linje vises i kartet. Pling og «Fremme» når du er nærmere enn grensen du setter under Oppsett.' },
  { v: '7.0', title: 'Readme tilpasser seg bredden', text: 'Readme-siden ble feilaktig rundt 2000 piksler bred på grunn av tabellene i Zeno Connect-delen. Nå tilpasser den seg vinduet: tabeller bryter tekst, figurene skalerer, innholdslisten blir rader på smal skjerm, og på stor skjerm brukes mer av bredden.' },
  { v: '6.9', title: 'Android-demo på nettsiden, tydeligere kilder, enklere tilbake', text: 'Ny knapp «Android-app» med mobilikon øverst på nettsiden åpner en demoside der appen kjører i en Android-mobil i nettleseren, med simulert RTK-posisjon. Posisjonskildene i appen har fått forklaring, og «Direkte Bluetooth til FLX100» heter ikke lenger «uten korreksjon». I appen finnes «Tilbake til Felt» i innstillinger, Androids tilbake-knapp går mot Felt, og opplasting kaster deg ikke lenger over i Kart.' },
  { v: '6.8', title: 'Statuslinje under menyen, Intern GPS, Bluetooth-rettelse', text: 'GNSS-statuslinjen ligger nå rett under menylinjen (Felt og Kart). Ny posisjonskilde «Intern GPS» leser Androids posisjonstjeneste direkte, også mock-posisjon fra Zeno Connect, og viser rådata (leverandør, mock, nøyaktighet) til feilsøking. Direkte Bluetooth feilet på Android 12 og nyere på grunn av manglende tillatelse; det er rettet.' },
  { v: '6.7', title: 'Readme: korreksjon via Zeno Connect', text: 'Readme har fått en ny del om hvordan RTK-korreksjon går fra satellitt og referansenett via FLX100 og Zeno Connect til Feltkart, med flytskjema og figurer: kjeden, kvalitetstrappen, høyde og stanghøyde, oppsett steg for steg og feilsøking.' },
  { v: '6.6', title: 'GNSS-status og stang øverst, rund målknapp, pling', text: 'I Android-appen ligger GNSS-status øverst i grønt (klar til å måle) eller rødt (ikke klar), med «Nøyaktighet» i stedet for «anslått», og stanghøyden i samme felt (uten hurtigvalg). Kartet ligger rett under. Statusfeltet viser også geoidemodell (NN2000 som standard). Målknappen er rund og ligger på høyre side, ca. 1/4 opp fra bunnen. En liten lyd (pling) spilles når et punkt er registrert, og kan slås av under Oppsett.' },
  { v: '6.5', title: 'Enklere Android-app: Felt og Kart', text: 'Appen har nå bare «Felt» og «Kart» på øvre linje. Felt viser et lite kart samtidig (over på stående skjerm, til venstre på liggende), med posisjon og innmålte punkter. Stanghøyde er flyttet til Innmåling-fanen med hurtigvalg, felt og − / +, og en linje som viser antennehøyde − stang = bakkehøyde. Google Disk, Readme og Sjekk ny versjon ligger under Felt → Oppsett → Mer.' },
  { v: '6.4', title: 'Android-bygget rettet', text: 'Rettet feil metodenavn i Android-koden (posisjonstillatelse i WebView) som stoppet bygging av APK-en.' },
  { v: '6.3', title: 'Readme-knapp', text: 'Ny knapp «Readme» i menyen til venstre åpner denne siden i eget vindu, med oversikt og versjonshistorikk.' },
  { v: '6.2', title: 'Ett repo for web og app', text: 'Nettsiden og Android-appen bygges nå fra samme GitHub-repo. Android-bygget hoppes over uten feil hvis signeringsnøkkelen ikke er lagt inn.' },
  { v: '6.1', title: 'Innmåling-fanen', text: 'Register over innmålinger fra KOF, SOSI og LandXML med mappetre, filter per kolonne, sortering, valg av kolonner og koordinatsystem. Nedlasting som KOF, CSV, LandXML, DXF og SOSI. Selve målingen (Felt) finnes bare i Android-appen.' },
  { v: '6.0', title: 'Android-bygget rettet', text: 'Rettet en feil som stoppet bygging av Android-appen.' },
  { v: '5.9', title: 'Sortering og eksport av innmålingspunkter', text: 'Målte punkter kan sorteres på dato og kode, filtreres, vises i valgt koordinatsystem og lastes ned som KOF, SOSI, LandXML og CSV.' },
  { v: '5.8', title: 'Android-app', text: 'Feltkart som app (APK) med RTK-posisjon fra Leica FLX100, bilder med RTK-posisjon, innmåling av punkter og live posisjon i kartet.' },
  { v: '5.7', title: '360-bilder i bildedialogen', text: '360-bilder kan roteres og zoomes rett i bildedialogen. Knapp for fullskjerm.' },
  { v: '5.6', title: 'Stabilt snittvindu', text: 'Snittvinduet kan ikke lenger dras ut av skjermen. Dobbeltklikk på tittelen setter det tilbake.' },
  { v: '5.5', title: 'Markør fra tverrsnittet', text: 'En rød markør i kartet (2D og 3D) følger musepekeren langs tverrsnittet.' },
  { v: '5.4', title: 'Tverrsnitt i 2D-kartet', text: 'Tverrsnitt finnes også i vanlig kart, med terreng og IFC-objekter.' },
  { v: '5.3', title: 'Tverrsnitt i Terreng 3D', text: 'Lag tverrsnitt langs en målt linje, med overhøyde, lag, kopiering av bilde og eksport til DXF.' },
  { v: '5.2', title: 'Bugreport-knapp', text: 'Knapp øverst til høyre for å melde fra om feil.' },
  { v: '5.1', title: 'Sjekk ny versjon', text: '«Sjekk ny versjon Feltkart» henter nyeste utgave uten at du mister data. «Nullstill demodata» ligger i menyen.' },
  { v: '5.0', title: 'Antatt tid for demodata', text: 'Velkomstboksen og statusvinduet for demodata oppgir antatt tid (ca. 60 sekunder).' },
  { v: '4.9–4.12', title: 'Høydeforskjell og prosjektmeny', text: 'Δh og stigning/fall i prosent vises for avstandsmålinger i Terreng 3D. Prosjektmenyen ligger over kartet i alle visninger, og ventetiden for demodata oppgis.' },
  { v: '4.8', title: 'Riktig høydemålestokk i 3D', text: 'Terreng 3D vises alltid uten overdrivelse av høyder.' },
  { v: '4.7', title: 'Prosjektvelger', text: 'Nedtrekksmeny for prosjekter, med egen lagring per prosjekt.' },
  { v: '4.6', title: 'Målehistorikk', text: 'Flere målinger samtidig, hver med egen farge, med liste, zoom til måling og «Nullstill alle».' },
  { v: '4.5', title: 'Snapping og lagrede målinger', text: 'Måling snapper til hjørner og kanter i IFC og tegninger. Målingene lagres underveis og er felles for Kart og Terreng 3D.' },
  { v: '4.4', title: 'IFC med farger og filegenskaper', text: 'Farger og detaljer fra IFC-filer, flere kolonner i Prosjektfiler (versjon, beskrivelse, endret av) og felles statusfelt for nedlasting.' },
  { v: '4.3', title: 'Bedre måling', text: 'Dobbeltklikk avslutter målingen, og neste klikk starter en ny.' },
  { v: '4.2', title: 'Måling og tydeligere bilder i 3D', text: 'Måling av avstand og areal i kart og 3D. Foto vises som bilderammer og 360-bilder som kuler.' },
  { v: '4.0–4.1', title: 'Terreng 3D', text: 'Ny fane med terreng, ortofoto, IFC-modeller og bilder i riktig høyde. Lesbar feilmelding i stedet for hvit side.' },
  { v: '3.8', title: 'Fremdrift ved demodata', text: 'Statuslinje med prosent og klokke ved innlasting.' },
  { v: '3.6–3.7', title: 'Ortofoto og bakgrunnskart', text: 'Svart bakgrunn i ortofoto blir gjennomsiktig. Esri verdensbilder som ortofoto-bakgrunn.' },
  { v: '3.4', title: 'Demodata i nettstedet', text: 'Demodata hentes fra selve nettstedet, som er raskere enn Google Disk.' },
  { v: '3.0–3.3', title: 'Demo og mapper', text: 'Velkomstboks, nullstilling av demo og mapper som følger Google Disk. Nummererte mapper vises først.' },
  { v: '2.9', title: 'Faner og bildevisning', text: 'Toppmeny med Kart, Bilder og Prosjektfiler. Bildepanel med filter på type og dato.' },
  { v: '2.8', title: 'Raskere ortofoto', text: 'Skarpere og raskere visning av droneortofoto.' },
  { v: 'Før 2.8', title: 'De første versjonene', text: 'Bilder og 360-bilder, DXF, KOF, SOSI, LandXML og IFC, ortofoto, bakgrunnskart og prosjektmapper på Google Disk.' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gruppering på hovedversjon (6.x, 5.x …) til de sammenleggbare blokkene */
function groups(): { major: string; items: Release[] }[] {
  const out: { major: string; items: Release[] }[] = [];
  for (const r of CHANGELOG) {
    const m = /^\d+/.exec(r.v)?.[0] ?? 'Eldre';
    const g = out.find((x) => x.major === m);
    if (g) g.items.push(r); else out.push({ major: m, items: [r] });
  }
  return out;
}

const LOGO = '<svg viewBox="0 0 32 32" width="64" height="64" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#8dc63f"/><path d="M8 23l5.5-13 4.5 8.5 2.2-4L24 23z" fill="#0f5a3c"/></svg>';

const FORMATS: [string, string, string][] = [
  ['Foto', 'JPG, PNG, WebP', 'Posisjon, høyde, retning og dato leses fra bildet. iPhone-bilder (HEIC) må gjøres om til JPG først.'],
  ['360-bilde', 'JPG (2:1)', 'Kjennes igjen på 2:1-format eller panorama-info. Kan roteres i bildedialogen.'],
  ['DXF', '.dxf', 'Tegninger: linjer, polylinjer, buer, tekst, blokker m.m. Må være georeferert.'],
  ['KOF', '.kof', 'Innmålte punkter med punktnavn, kode og koordinater. Du velger koordinatsystem ved opplasting.'],
  ['SOSI', '.sos, .sosi', 'Punkt, kurve, flate og tekst. Koordinatsystemet leses fra filen for EUREF89 UTM.'],
  ['LandXML', '.xml', 'Punkter, trasé, plangeometri, eiendommer og terrengmodeller (TIN).'],
  ['IFC', '.ifc', 'Vises som grunnriss i kartet og som 3D-modell i Terreng 3D, med farger fra filen.'],
  ['Ortofoto', 'GeoTIFF, JPEG 2000', 'Droneortofoto som legges riktig i kartet. Kan gjøres gjennomsiktig.'],
];

const TABS: [string, string][] = [
  ['Kart', 'Alt samlet i ett kart: bilder, 360-bilder, tegninger, innmålinger og ortofoto. Slå lag av og på i mappetreet, mål avstand og areal, lag tverrsnitt og filtrer bilder på dato.'],
  ['Bilder', 'Kartet med et bildepanel. Filtrer på type (foto eller 360°), dato og mappe, og klikk et bilde for å se det.'],
  ['Innmåling', 'Register over alle innmålte punkter i prosjektet (KOF, SOSI, LandXML). Mappetre til venstre, tabell med sortering og filter, valg av koordinatsystem og nedlasting som KOF, CSV, LandXML, DXF og SOSI.'],
  ['Prosjektfiler', 'Filoversikt med mapper, type, dato, versjon, beskrivelse og hvem som sist endret filen. Vis eller skjul i kartet, zoom til fil og slett.'],
  ['Terreng 3D', 'Terreng, ortofoto, IFC-modeller og bilder i riktig høyde. Mål direkte på terrenget og lag tverrsnitt.'],
  ['Felt (bare i Android-appen)', 'Selve innmålingen: RTK-posisjon fra GNSS-mottaker, mål punkter med kode og stanghøyde (valgt rett over målknappen), ta bilder med posisjon og lagre i prosjektet. Appen har bare Felt og Kart på øvre linje, og Felt viser et lite kart samtidig.'],
];

/** Hele Readme-siden som HTML */
export function buildReadmeHtml(version: string, versionLabel = `v ${version} beta`): string {
  const toc: [string, string][] = [['om', 'Om Feltkart'], ['kom-i-gang', 'Kom i gang'], ['faner', 'Fanene'], ['filformater', 'Filformater'], ['maling', 'Måling og tverrsnitt'], ['android', 'Android-appen'], ['utsetting', 'Utsetting'], ['zeno', 'Korreksjon via Zeno Connect'], ['tips', 'Tips'], ['historikk', 'Versjonshistorikk']];
  const g = groups();
  const hist = g.map((grp, i) => `
    <details class="grp"${i < 2 ? ' open' : ''}>
      <summary><span class="gv">Versjon ${esc(grp.major)}.x</span><span class="gn">${grp.items.length} ${grp.items.length === 1 ? 'oppføring' : 'oppføringer'}</span></summary>
      <ol class="rel">${grp.items.map((r) => `<li><span class="badge">${esc(r.v)}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.text)}</p></div></li>`).join('')}</ol>
    </details>`).join('');
  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feltkart – Readme</title>
<style>
:root{--brand:#0f5a3c;--lime:#8dc63f;--soft:#e8f3ec;--ink:#1c2420;--muted:#5d6b63;--line:#dbe4de;--bg:#f5f8f6}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.hero{background:var(--brand);color:#fff}
.wrap{max-width:1280px;margin:0 auto;padding:0 24px}
.hero-in{display:flex;align-items:center;gap:18px;padding:28px 24px}
.hero h1{margin:0;font-size:32px;line-height:1.1;letter-spacing:-.01em}
.hero p{margin:4px 0 0;color:#cfe6d7;font-size:16px}
.ver{margin-left:auto;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 14px;font-size:13px;white-space:nowrap}
.layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:36px;padding-top:26px;padding-bottom:50px}
.toc{position:sticky;top:18px;align-self:start;display:flex;flex-direction:column;gap:2px;font-size:14px}
.toc a{color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:8px;border-left:3px solid transparent}
.toc a:hover{background:var(--soft);color:var(--brand)}
main section{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 26px;margin-bottom:18px}
h2{margin:0 0 10px;font-size:20px;color:var(--brand);display:flex;align-items:center;gap:10px}
h2:before{content:"";width:6px;height:20px;border-radius:3px;background:var(--lime)}
h3{margin:18px 0 6px;font-size:15px}
p{margin:8px 0}ul,ol{margin:8px 0;padding-left:22px}li{margin:4px 0}
.muted{color:var(--muted)}
.steps{counter-reset:s;list-style:none;padding:0}
.steps li{counter-increment:s;display:flex;gap:12px;align-items:flex-start;margin:10px 0}
.steps li:before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;margin-top:1px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:12px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}
.card b{display:block;color:var(--brand);margin-bottom:2px}
.card span{font-size:14px;color:#33413a}
table{border-collapse:collapse;width:100%;font-size:14px;margin-top:8px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td:first-child{font-weight:600}#filformater td:first-child,#filformater td:nth-child(2){white-space:nowrap}#filformater td:nth-child(2){color:var(--brand)}td{overflow-wrap:anywhere}table{max-width:100%}main{min-width:0}.steps li>div{min-width:0}
kbd{background:#eef2ef;border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:0 6px;font:12.5px ui-monospace,Consolas,monospace}
.fig{margin:14px 0;border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff}
.fig .sc{overflow-x:auto}.fig svg{display:block;width:100%;max-width:820px;margin:0 auto;min-width:460px;height:auto}
.fig figcaption{font-size:13px;color:var(--muted);margin-top:6px}
.fig .bx{fill:var(--soft);stroke:var(--brand);stroke-width:1.5}.fig .bl{fill:#eef7dc;stroke:var(--lime);stroke-width:1.5}
.fig .bk{fill:var(--brand)}.fig .bad{fill:#fbe3e1;stroke:#c0392b;stroke-width:1.5}.fig .wn{fill:#fff6dc;stroke:#d9a400;stroke-width:1.5}
.fig .t{font-size:14px;fill:#14261d}.fig .tb{font-size:14px;font-weight:700;fill:#14261d}.fig .ts{font-size:12px;fill:var(--muted)}.fig .ts2{font-size:12.5px;fill:#14261d}
.fig .tw{font-size:14px;font-weight:700;fill:#fff}.fig .tws{font-size:12px;fill:#d7eadf}
.fig .ln{stroke:var(--brand);stroke-width:2;fill:none}.fig .dn{stroke-dasharray:6 4}.fig .dt{stroke-dasharray:2 4;stroke-linecap:round}
.fig .r{stroke:#c0392b}.fig .r2{stroke:#d9a400}.fig .pole{stroke:#33413a;stroke-width:4}.fig .gr{stroke:#33413a;stroke-width:2}.fig .hat{stroke:#9aa59f;stroke-width:1.5}
.fig .geo{stroke:var(--lime);stroke-width:3;fill:none}.fig .q0{fill:#f4c9c5}.fig .q1{fill:#f7e3a3}.fig .q2{fill:var(--lime)}
.note{background:var(--soft);border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}
.grp{border:1px solid var(--line);border-radius:12px;margin:10px 0;background:#fff;overflow:hidden}
.grp summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--soft)}
.grp summary::-webkit-details-marker{display:none}
.grp summary:before{content:"▸";color:var(--brand);transition:transform .15s}
.grp[open] summary:before{transform:rotate(90deg)}
.gv{font-weight:700;color:var(--brand)}.gn{margin-left:auto;font-size:13px;color:var(--muted)}
.rel{list-style:none;margin:0;padding:6px 16px 10px}
.rel li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--line);margin:0}
.rel li:last-child{border-bottom:0}
.rel p{margin:2px 0 0;color:#33413a;font-size:14px}
.badge{flex:none;min-width:62px;height:24px;padding:0 8px;border-radius:999px;background:var(--brand);color:#fff;font-size:12px;font-weight:600;display:inline-grid;place-items:center;margin-top:2px;white-space:nowrap}
footer{text-align:center;color:var(--muted);font-size:13px;padding:0 0 30px}
@media(max-width:560px){.wrap{padding:0 12px}.hero-in{padding:20px 12px;gap:12px}.hero h1{font-size:23px}.hero p{font-size:14px}main section{padding:14px 12px;border-radius:12px}h2{font-size:18px}table{font-size:13px}th,td{padding:6px 6px}#filformater td:first-child,#filformater td:nth-child(2){white-space:normal}.fig{padding:6px}.grp summary{padding:10px 12px}}
@media(max-width:820px){.layout{grid-template-columns:minmax(0,1fr);gap:12px}.toc{position:static;flex-direction:row;flex-wrap:wrap}.hero h1{font-size:26px}.ver{display:none}main section{padding:18px}}
@media print{.toc{display:none}.layout{display:block}main section{break-inside:avoid;border:0;padding:0}.hero{background:#fff;color:#000}.hero p{color:#444}.grp:not([open]) ol{display:block}}
</style></head><body>
<header class="hero"><div class="wrap hero-in">${LOGO}<div><h1>Feltkart</h1><p>Kart, bilder og innmåling for anleggsprosjekter</p></div><span class="ver">${esc(versionLabel)}</span></div></header>
<div class="wrap layout">
<nav class="toc" aria-label="Innhold">${toc.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>
<main>

<section id="om"><h2>Om Feltkart</h2>
<p>Feltkart samler alt fra byggeplassen i ett kart: <strong>bilder og 360-bilder</strong> plassert ut fra GPS, <strong>prosjekterte tegninger</strong> (DXF, IFC), <strong>innmålinger</strong> (KOF, SOSI, LandXML) og <strong>ortofoto fra drone</strong>. Du kan måle avstand og areal, lage tverrsnitt og se terrenget i 3D.</p>
<p class="muted">Feltkart finnes som nettside og som Android-app. Begge bygger på samme løsning, og appen har i tillegg feltfunksjoner for innmåling med RTK-GNSS.</p>
</section>

<section id="kom-i-gang"><h2>Kom i gang</h2>
<ol class="steps">
<li><div><strong>Velg prosjekt.</strong> Prosjektmenyen står øverst til høyre. Hvert prosjekt har sine egne bilder, filer og innstillinger.</div></li>
<li><div><strong>Prøv med demodata.</strong> I prosjektet Oppdal Ålma kan du laste ned demodata (bilder, tegninger, innmålinger og ortofoto) for å se hvordan alt henger sammen.</div></li>
<li><div><strong>Last opp egne filer.</strong> Trykk den grønne knappen <em>Last opp</em> øverst til høyre. Bilder, DXF, KOF, SOSI, LandXML, IFC og ortofoto havner automatisk i riktig mappe.</div></li>
<li><div><strong>Bruk Google Disk (valgfritt).</strong> Knappen med Google-ikonet i menyen til venstre henter og lagrer filer i en prosjektmappe på Google Disk.</div></li>
<li><div><strong>Utforsk.</strong> Bruk fanene øverst: Kart, Bilder, Innmåling, Prosjektfiler og Terreng 3D.</div></li>
</ol>
<div class="note">Dine data lagres i nettleseren på denne maskinen. Filer på Google Disk berøres ikke når du nullstiller demodata.</div>
</section>

<section id="faner"><h2>Fanene</h2>
<div class="cards">${TABS.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>
</section>

<section id="filformater"><h2>Filformater</h2>
<table><thead><tr><th>Type</th><th>Filer</th><th>Merknad</th></tr></thead><tbody>${FORMATS.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table>
<p class="muted">Bilder uten GPS kan plasseres manuelt: velg bildet og trykk <em>Plasser på kart</em>. Koordinatsystemet for KOF og DXF velger du når du laster opp.</p>
</section>

<section id="maling"><h2>Måling og tverrsnitt</h2>
<ul>
<li><strong>Avstand og areal:</strong> klikk punkt for punkt i kartet eller i Terreng 3D. Du får lengde, areal (m², daa, ha) og omkrets. I Terreng 3D vises også skrå lengde, høydeforskjell (Δh) og stigning i prosent.</li>
<li><strong>Flere målinger samtidig:</strong> hver måling får sin egen farge og står i en liste der du kan zoome til den eller slette den. Målingene lagres i nettleseren.</li>
<li><strong>Snapping:</strong> markøren snapper til hjørner og kanter i IFC og tegninger. Hold <kbd>Alt</kbd> for å slå den av midlertidig.</li>
<li><strong>Tverrsnitt:</strong> mål en linje og velg <em>Lag tverrsnitt langs linjen</em>. Snittet viser terrenget og IFC-objektene, kan kopieres som bilde og eksporteres til DXF.</li>
</ul>
</section>

<section id="android"><h2>Android-appen</h2>
<p>Appen er den samme løsningen pakket for telefon, med feltfunksjoner: RTK-posisjon fra Leica FLX100 (via Zeno Connect eller direkte Bluetooth), innmåling av punkter med kode og stanghøyde, bilder med RTK-posisjon og din posisjon som blå prikk i kartet.</p>
<ol class="steps">
<li><div>Åpne repoets <em>Releases</em>-side på GitHub i Chrome på telefonen og last ned <strong>Feltkart.apk</strong>.</div></li>
<li><div>Åpne filen og velg <em>Tillat fra denne kilden</em>, deretter <em>Installer</em>.</div></li>
<li><div>Åpne Feltkart og tillat <em>posisjon</em> når Android spør.</div></li>
</ol>
<p>Vil du se hvordan appen ser ut først? Knappen <strong>Android-app</strong> øverst på nettsiden åpner en demo i en Android-mobil, med simulert posisjon.</p>
<p class="muted">Nye versjoner installeres oppå den gamle. Data og innstillinger beholdes.</p>
</section>

<section id="utsetting"><h2>Utsetting: gå til punkter</h2>
<p>Med utsetting kan du la appen lede deg fram til et punkt fra prosjektet. Det gjelder bare i Android-appen, der posisjonen kommer fra mottakeren.</p>
<ol class="steps">
<li><div>Åpne <strong>Felt</strong> og velg fanen <strong>Utsett</strong>. Der ligger alle punkter i prosjektet, nærmeste først. Søk på navn eller kode, og trykk <em>Gå til</em>. Vil du ha flere punkter i en rekkefølge, huk av og trykk <em>Utsett valgte</em>.</div></li>
<li><div>Eller trykk på et objekt, et punkt eller et bilde i <strong>Kart</strong> og velg <em>Gå til</em> under <em>Utsetting</em>. For en linje eller flate kan du gå til alle hjørnene eller bare ett.</div></li>
<li><div>Gå mot punktet. Pilen viser retningen ut fra hvordan du går, så den dreier seg etter deg. Står du stille, er nord opp. Under pilen står avstanden, og hvor mange meter nord/sør og øst/vest punktet ligger.</div></li>
<li><div>Når du er nærmere enn grensen, står det <strong>Fremme</strong>, og du hører et pling. Trykk <em>Mål her</em> for å måle inn punktet med samme navn, eller <em>Neste</em> for å gå videre.</div></li>
</ol>
<p><strong>Høyde:</strong> Har punktet høyde, vises <em>Skjær</em> (terrenget er for høyt) eller <em>Fyll</em> (for lavt) i meter. Det forutsetter at mottakeren oppgir høyde i samme system som prosjektdataene, og at stanghøyden under Oppsett stemmer.</p>
<p class="muted">Retningen er mot rutenettets nord i prosjektets koordinatsystem, ikke mot sann nord. Avstand og retning regnes fra posisjonen mottakeren oppgir. Vises ikke «Klar», kan posisjonen være unøyaktig. Da står det en advarsel i kortet.</p>
</section>

${ZENO_SECTION}
<section id="tips"><h2>Tips</h2>
<ul>
<li><strong>Måling:</strong> <kbd>Enter</kbd> eller dobbeltklikk fullfører, <kbd>Backspace</kbd> angrer siste punkt og <kbd>Esc</kbd> avslutter. Neste klikk etter en ferdig måling starter en ny.</li>
<li><strong>Få nyeste versjon:</strong> knappen <em>Sjekk ny versjon Feltkart</em> nederst i menyen gjør det samme som <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. Dine data beholdes.</li>
<li><strong>Feil?</strong> Knappen <em>Bugreport</em> øverst til høyre åpner skjemaet for feilmeldinger.</li>
<li><strong>Innmåling:</strong> hak av rader for å laste ned bare dem, ellers lastes alt som vises (etter filter og mapper) ned.</li>
</ul>
</section>

<section id="historikk"><h2>Versjonshistorikk</h2>
<p class="muted">Nåværende versjon: <strong>${esc(version)}</strong>. Nyeste øverst.</p>
${hist}
</section>

</main></div>
<footer>Feltkart ${esc(versionLabel)}</footer>
<script>
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;var t=document.getElementById(a.getAttribute('href').slice(1));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}});
</script>
</body></html>`;
}

/**
 * Åpner Readme i et eget vindu (som egen nettside). Gir false hvis nettleseren blokkerte vinduet,
 * eller hvis siden kjører inne i appen, slik at kalleren kan vise den i en dialog i stedet.
 */
export function openReadmeWindow(version: string, versionLabel?: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([buildReadmeHtml(version, versionLabel)], { type: 'text/html;charset=utf-8' }));
    const w = window.open(url, 'feltkart-readme', 'popup=yes,width=1040,height=860,resizable=yes,scrollbars=yes');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    if (!w) return false;
    w.focus?.();
    return true;
  } catch {
    return false;
  }
}
