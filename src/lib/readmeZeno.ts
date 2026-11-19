// Readme-seksjon: hvordan RTK-korreksjon via Leica Zeno Connect kommer fram til Feltkart (med figurer).
// Egen fil for å holde readme.ts oversiktlig. Figurene er inline SVG (ingen bildefiler) og stiles av CSS i readme.ts.

const defs = (id: string) =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0f5a3c"/></marker></defs>`;

const badge = (n: number, x: number, y: number) =>
  `<circle cx="${x}" cy="${y}" r="11" class="bk"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" class="tw">${n}</text>`;

/** Figur 1: hele kjeden fra satellitt til lagret punkt. Nummerne tilsvarer trinnene i listen under figuren. */
const FIG_KJEDE = `<svg viewBox="0 0 560 500" role="img" aria-label="Flytskjema: satellitter og referansenett via FLX100 og Zeno Connect til Feltkart">${defs('a1')}
<rect x="20" y="10" width="230" height="56" rx="10" class="bx"/><text x="135" y="34" text-anchor="middle" class="t">Satellitter</text><text x="135" y="52" text-anchor="middle" class="ts">GPS, Galileo, GLONASS, BeiDou</text>
<rect x="310" y="10" width="230" height="56" rx="10" class="bl"/><text x="425" y="34" text-anchor="middle" class="t">Referansenett (f.eks. CPOS)</text><text x="425" y="52" text-anchor="middle" class="ts">sender korreksjoner</text>
<rect x="20" y="130" width="230" height="64" rx="10" class="bx"/><text x="135" y="156" text-anchor="middle" class="t">Leica FLX100</text><text x="135" y="175" text-anchor="middle" class="ts">antenne og mottaker på stanga</text>
<rect x="310" y="130" width="230" height="64" rx="10" class="bx"/><text x="425" y="156" text-anchor="middle" class="t">Zeno Connect</text><text x="425" y="175" text-anchor="middle" class="ts">app på telefonen</text>
<rect x="310" y="250" width="230" height="54" rx="10" class="bx"/><text x="425" y="274" text-anchor="middle" class="t">Android-posisjon</text><text x="425" y="292" text-anchor="middle" class="ts">«mock location»</text>
<rect x="310" y="340" width="230" height="54" rx="10" class="bk"/><text x="425" y="364" text-anchor="middle" class="tw">Feltkart</text><text x="425" y="382" text-anchor="middle" class="tws">leser posisjonen i appen</text>
<rect x="310" y="430" width="230" height="52" rx="10" class="bl"/><text x="425" y="453" text-anchor="middle" class="t">Innmålt punkt</text><text x="425" y="471" text-anchor="middle" class="ts">koordinat, høyde og kode</text>
<path d="M135 66V126" class="ln dt" marker-end="url(#a1)"/>${badge(1, 135, 96)}
<path d="M425 66V126" class="ln dn" marker-end="url(#a1)"/>${badge(2, 425, 96)}
<path d="M254 152H306" class="ln" marker-end="url(#a1)"/>
<path d="M306 174H254" class="ln" marker-end="url(#a1)"/>${badge(3, 280, 163)}
<text x="280" y="214" text-anchor="middle" class="ts">Bluetooth: posisjon ut, korreksjoner inn</text>
<path d="M425 196V246" class="ln" marker-end="url(#a1)"/>${badge(4, 425, 221)}
<path d="M425 306V336" class="ln" marker-end="url(#a1)"/>${badge(5, 400, 321)}
<path d="M425 396V426" class="ln" marker-end="url(#a1)"/>${badge(6, 400, 411)}
<text x="20" y="400" class="ts">Linjetyper:</text>
<path d="M20 416H70" class="ln dt"/><text x="78" y="420" class="ts">radiosignal</text>
<path d="M20 436H70" class="ln dn"/><text x="78" y="440" class="ts">internett (mobildata)</text>
<path d="M20 456H70" class="ln"/><text x="78" y="460" class="ts">Bluetooth / inne i telefonen</text>
</svg>`;

/** Figur 2: hvorfor korreksjon trengs. */
const FIG_HVORFOR = `<svg viewBox="0 0 560 260" role="img" aria-label="Referansestasjon og mottaker ser de samme satellittene; feilen er lik og kan fjernes">${defs('a2')}
<rect x="250" y="12" width="60" height="26" rx="6" class="bx"/><path d="M230 25H250M310 25H330" class="ln"/><text x="280" y="30" text-anchor="middle" class="t">Satellitt</text>
<path d="M262 40L120 172" class="ln dt"/><path d="M298 40L440 172" class="ln dt"/>
<ellipse cx="280" cy="108" rx="120" ry="28" class="bl"/><text x="280" y="106" text-anchor="middle" class="t">Atmosfære og klokkefeil</text><text x="280" y="122" text-anchor="middle" class="ts">gir nesten lik feil begge steder</text>
<rect x="30" y="176" width="170" height="58" rx="10" class="bl"/><text x="115" y="200" text-anchor="middle" class="t">Referansestasjon</text><text x="115" y="218" text-anchor="middle" class="ts">står på kjent sted</text>
<rect x="360" y="176" width="170" height="58" rx="10" class="bx"/><text x="445" y="200" text-anchor="middle" class="t">Din mottaker</text><text x="445" y="218" text-anchor="middle" class="ts">FLX100 på stanga</text>
<path d="M204 205H356" class="ln dn" marker-end="url(#a2)"/><text x="280" y="198" text-anchor="middle" class="ts">korreksjon</text><text x="280" y="226" text-anchor="middle" class="ts">via internett</text>
</svg>`;

/** Figur 3: kvalitetstrappen og når Feltkart tillater måling. */
const FIG_KVALITET = `<svg viewBox="0 0 560 250" role="img" aria-label="Kvalitetstrapp fra GPS til Fix med grenser for nøyaktighet">
<rect x="20" y="115" width="115" height="40" class="q0"/><rect x="150" y="90" width="115" height="65" class="q0"/><rect x="280" y="60" width="115" height="95" class="q1"/><rect x="410" y="25" width="130" height="130" class="q2"/>
<text x="77" y="108" text-anchor="middle" class="t">over 3 m</text><text x="207" y="83" text-anchor="middle" class="t">0,5 – 3 m</text><text x="337" y="53" text-anchor="middle" class="t">5 – 50 cm</text><text x="475" y="18" text-anchor="middle" class="t">5 cm eller bedre</text>
<text x="77" y="180" text-anchor="middle" class="tb">GPS</text><text x="207" y="180" text-anchor="middle" class="tb">DGPS</text><text x="337" y="180" text-anchor="middle" class="tb">Float</text><text x="475" y="180" text-anchor="middle" class="tb">Fix</text>
<path d="M20 198H265" class="ln r"/><text x="142" y="218" text-anchor="middle" class="ts">Rød: ikke klar til å måle</text>
<path d="M280 198H395" class="ln r2"/><text x="337" y="218" text-anchor="middle" class="ts">Rød med standardvalg</text>
<path d="M410 198H540" class="ln"/><text x="475" y="218" text-anchor="middle" class="ts">Grønn: klar</text>
<text x="280" y="240" text-anchor="middle" class="ts">Grensen for Fix følger «Maks usikkerhet» i Oppsett (standard 5 cm).</text>
</svg>`;

/** Figur 4: stanghøyde. */
const FIG_STANG = `<svg viewBox="0 0 560 300" role="img" aria-label="Antennehøyde minus stanghøyde gir høyde på bakken">${defs('a4')}
<path d="M20 262H300" class="gr"/><path d="M30 262l-10 12M60 262l-10 12M90 262l-10 12M120 262l-10 12M150 262l-10 12M180 262l-10 12M210 262l-10 12M240 262l-10 12M270 262l-10 12M300 262l-10 12" class="hat"/>
<path d="M120 262V82" class="pole"/><path d="M100 262h40" class="ln"/><path d="M108 262l12 12 12-12" class="ln"/>
<rect x="98" y="64" width="44" height="18" rx="5" class="bk"/><text x="120" y="56" text-anchor="middle" class="t">Antenne</text>
<path d="M200 76V258" class="ln" marker-start="url(#a4)" marker-end="url(#a4)"/><text x="210" y="170" class="t">Stanghøyde</text><text x="210" y="188" class="ts">standard 2,000 m</text>
<text x="120" y="292" text-anchor="middle" class="ts">Bakkepunkt</text>
<rect x="335" y="40" width="205" height="150" rx="10" class="bx"/>
<text x="350" y="68" class="ts">Eksempel</text>
<text x="350" y="96" class="t">Antenne</text><text x="525" y="96" text-anchor="end" class="tb">125,430</text>
<text x="350" y="122" class="t">− Stang</text><text x="525" y="122" text-anchor="end" class="tb">2,000</text>
<path d="M350 134H525" class="ln"/>
<text x="350" y="160" class="t">= Bakke</text><text x="525" y="160" text-anchor="end" class="tb">123,430</text>
<rect x="335" y="204" width="205" height="76" rx="10" class="wn"/><text x="347" y="226" class="t">Sett stang bare ett sted</text><text x="347" y="244" class="ts">Hvis Zeno Connect trekker fra</text><text x="347" y="260" class="ts">antennehøyde selv, bruk 0 her.</text>
</svg>`;

/** Figur 5: ellipsoidehøyde, geoide og høyde over havet. */
const FIG_GEOIDE = `<svg viewBox="0 0 560 250" role="img" aria-label="Høyde over havet er ellipsoidehøyde minus geoidehøyde">${defs('a5')}
<path d="M20 200H540" class="ln"/><text x="530" y="218" text-anchor="end" class="ts">Ellipsoide (matematisk jordform, EUREF89)</text>
<path d="M20 150C120 130 200 172 300 148S460 130 540 148" class="geo"/><text x="30" y="128" class="ts">Geoide (middelvann, ca. NN2000)</text>
<circle cx="380" cy="55" r="7" class="bk"/><text x="392" y="52" class="t">Punkt</text>
<path d="M300 196V152" class="ln" marker-start="url(#a5)" marker-end="url(#a5)"/><text x="290" y="180" text-anchor="end" class="tb">N</text>
<path d="M380 144V64" class="ln" marker-start="url(#a5)" marker-end="url(#a5)"/><text x="370" y="110" text-anchor="end" class="tb">H</text>
<path d="M470 196V58" class="ln dn" marker-start="url(#a5)" marker-end="url(#a5)"/><text x="480" y="130" class="tb">h</text>
<text x="280" y="242" text-anchor="middle" class="t">H = h − N</text>
</svg>`;

/** Figur 6: feilsøking når statusfeltet ikke blir grønt. */
const FIG_FEIL = `<svg viewBox="0 0 560 480" role="img" aria-label="Flytskjema for feilsøking når statusfeltet er rødt">${defs('a6')}
<rect x="20" y="8" width="250" height="42" rx="10" class="bad"/><text x="145" y="34" text-anchor="middle" class="t">Status er rød eller viser GPS</text>
<rect x="20" y="76" width="250" height="54" rx="10" class="bx"/><text x="145" y="98" text-anchor="middle" class="t">Er FLX100 tilkoblet</text><text x="145" y="116" text-anchor="middle" class="t">i Zeno Connect?</text>
<rect x="20" y="156" width="250" height="54" rx="10" class="bx"/><text x="145" y="178" text-anchor="middle" class="t">Viser Zeno Connect</text><text x="145" y="196" text-anchor="middle" class="t">RTK Fix?</text>
<rect x="20" y="236" width="250" height="54" rx="10" class="bx"/><text x="145" y="258" text-anchor="middle" class="t">Er Zeno Connect valgt som</text><text x="145" y="276" text-anchor="middle" class="t">mock location-app?</text>
<rect x="20" y="316" width="250" height="54" rx="10" class="bx"/><text x="145" y="338" text-anchor="middle" class="t">Er kilden Android-posisjon, og</text><text x="145" y="356" text-anchor="middle" class="t">posisjon tillatt for Feltkart?</text>
<rect x="20" y="404" width="250" height="46" rx="10" class="bk"/><text x="145" y="432" text-anchor="middle" class="tw">Grønn status: trykk Mål</text>
<rect x="310" y="76" width="230" height="54" rx="10" class="bl"/><text x="320" y="98" class="ts2">Slå på FLX100 og koble til</text><text x="320" y="114" class="ts2">via Bluetooth i Zeno Connect.</text>
<rect x="310" y="156" width="230" height="54" rx="10" class="bl"/><text x="320" y="174" class="ts2">Sjekk korreksjonsprofilen (server,</text><text x="320" y="190" class="ts2">port, mountpoint, innlogging) og</text><text x="320" y="206" class="ts2">mobildekning. Vent på Fix.</text>
<rect x="310" y="236" width="230" height="54" rx="10" class="bl"/><text x="320" y="254" class="ts2">Utviklermuligheter → Velg app for</text><text x="320" y="270" class="ts2">falsk posisjon → Zeno Connect.</text>
<rect x="310" y="316" width="230" height="54" rx="10" class="bl"/><text x="320" y="334" class="ts2">Velg «Android-posisjon» som</text><text x="320" y="350" class="ts2">kilde i Felt, og tillat posisjon</text><text x="320" y="366" class="ts2">for Feltkart i Android.</text>
<path d="M145 50V72" class="ln" marker-end="url(#a6)"/>
<path d="M145 130V152" class="ln" marker-end="url(#a6)"/><text x="153" y="146" class="ts">ja</text>
<path d="M145 210V232" class="ln" marker-end="url(#a6)"/><text x="153" y="226" class="ts">ja</text>
<path d="M145 290V312" class="ln" marker-end="url(#a6)"/><text x="153" y="306" class="ts">ja</text>
<path d="M145 370V400" class="ln" marker-end="url(#a6)"/><text x="153" y="388" class="ts">ja</text>
<path d="M270 103H306" class="ln" marker-end="url(#a6)"/><text x="288" y="97" text-anchor="middle" class="ts">nei</text>
<path d="M270 183H306" class="ln" marker-end="url(#a6)"/><text x="288" y="177" text-anchor="middle" class="ts">nei</text>
<path d="M270 263H306" class="ln" marker-end="url(#a6)"/><text x="288" y="257" text-anchor="middle" class="ts">nei</text>
<path d="M270 343H306" class="ln" marker-end="url(#a6)"/><text x="288" y="337" text-anchor="middle" class="ts">nei</text>
</svg>`;

const fig = (svg: string, text: string) => `<figure class="fig"><div class="sc">${svg}</div><figcaption>${text}</figcaption></figure>`;

export const ZENO_SECTION = `<section id="zeno"><h2>Korreksjon via Zeno Connect</h2>
<p>Her står det hvordan en vanlig mobilposisjon blir til en centimeternøyaktig RTK-posisjon i Feltkart, og hva du kan sjekke når det ikke virker.</p>

<h3>Grunnleggende: hvorfor trengs korreksjon?</h3>
<p>En enkel GPS-mottaker, som den i telefonen, treffer vanligvis innenfor noen få meter. Feilen kommer blant annet fra atmosfæren og små avvik i satellittenes klokker og baner. To mottakere som står nær hverandre får nesten <strong>samme feil</strong>.</p>
<p>En referansestasjon vet nøyaktig hvor den står. Den kan derfor regne ut feilen og sende den som <strong>korreksjon</strong> til mottakeren din. Dette kalles <strong>RTK</strong> (Real Time Kinematic) og gir centimeter i stedet for meter. Ved <strong>nettverks-RTK</strong>, som CPOS fra Kartverket, lages korreksjonen fra mange stasjoner og tilpasses der du står. Tjenesten krever abonnement og innlogging, og korreksjonene sendes over internett (NTRIP).</p>
${fig(FIG_HVORFOR, 'Figur 1. Referansestasjon og mottaker ser de samme satellittene. Feilen er lik, så korreksjonen fjerner den.')}

<h3>Hvem gjør hva?</h3>
<table class="who"><thead><tr><th>Del</th><th>Oppgave</th></tr></thead><tbody>
<tr><td>Leica FLX100</td><td>Måler på satellittsignalene og regner ut RTK-posisjonen når den får korreksjoner.</td></tr>
<tr><td>Zeno Connect</td><td>Kobler til FLX100 med Bluetooth, henter korreksjoner fra nettjenesten og sender dem til FLX100. Gir posisjonen videre til andre apper.</td></tr>
<tr><td>Android</td><td>Tar imot posisjonen fra Zeno Connect som «mock location» og gir den til alle apper som spør om posisjon.</td></tr>
<tr><td>Feltkart</td><td>Leser posisjonen, vurderer kvaliteten, trekker fra stanghøyde og lagrer punktet.</td></tr>
</tbody></table>

<h3>Inngående: veien fra satellitt til punkt</h3>
${fig(FIG_KJEDE, 'Figur 2. Hele kjeden. Tallene hører til trinnene under.')}
<ol class="steps">
<li><div><strong>FLX100 mottar satellitter.</strong> Uten korreksjon er posisjonen bare meternøyaktig.</div></li>
<li><div><strong>Zeno Connect henter korreksjoner.</strong> Appen logger inn på korreksjonstjenesten (NTRIP) over mobildata. Nettverkstjenester trenger å vite omtrent hvor du er, og får derfor mottakerens posisjon underveis.</div></li>
<li><div><strong>Bluetooth begge veier.</strong> Zeno Connect sender korreksjonene til FLX100. FLX100 regner ut RTK-posisjonen og sender den tilbake. Statusen går gjennom Single og Float til <em>Fix</em>. Det kan ta alt fra noen sekunder til noen minutter.</div></li>
<li><div><strong>Posisjonen til Android.</strong> Zeno Connect gir den ferdige posisjonen til Android som falsk posisjon (mock location). Derfor må Zeno Connect velges under Utviklermuligheter.</div></li>
<li><div><strong>Feltkart leser posisjonen.</strong> Appen spør Android om posisjon på vanlig måte. Android oppgir ikke Fix eller Float, bare nøyaktighet. Feltkart leser derfor kvaliteten ut fra nøyaktigheten (figur 3), og viser den som <em>Nøyaktighet</em> øverst.</div></li>
<li><div><strong>Mål.</strong> Du trykker på den runde knappen. Feltkart tar gjennomsnitt over innstilt tid (standard 3 sekunder), trekker fra stanghøyden og lagrer punktet med kode.</div></li>
</ol>

<h3>Kvalitet: når er det grønt?</h3>
${fig(FIG_KVALITET, 'Figur 3. Kvalitetstrappen. Feltkart avgjør nivået fra oppgitt nøyaktighet.')}
<table><thead><tr><th>Nivå</th><th>Nøyaktighet</th><th>Betyr</th></tr></thead><tbody>
<tr><td>GPS</td><td>over 3 m</td><td>Ingen korreksjon, eller ukjent nøyaktighet.</td></tr>
<tr><td>DGPS</td><td>0,5 til 3 m</td><td>Enkel korreksjon. Ikke nok for innmåling.</td></tr>
<tr><td>Float</td><td>5 til 50 cm</td><td>RTK er i gang, men ikke ferdig låst. Vent litt.</td></tr>
<tr><td>Fix</td><td>5 cm eller bedre</td><td>RTK er låst. Her kan du måle.</td></tr>
</tbody></table>
<p class="muted">Statusfeltet blir grønt når posisjonen er ferskere enn 5 sekunder og nøyaktigheten er innenfor «Maks usikkerhet» (og Fix, hvis «Krev Fix» er på). Fordi Feltkart bare ser nøyaktigheten, merkes den som anslått.</p>

<h3>Koordinater og høyde</h3>
<p>Korreksjonstjenester som CPOS leverer posisjon i <strong>EUREF89</strong> med <strong>ellipsoidehøyde</strong>. Ellipsoiden er en glatt, matematisk jordform. Høyden over havet i hverdagen (NN2000) regnes fra <strong>geoiden</strong>. Forskjellen er geoidehøyden N, og Zeno Connect kan trekke den fra hvis du velger en geoidemodell der.</p>
${fig(FIG_GEOIDE, 'Figur 4. h er høyde over ellipsoiden, N er geoidehøyden og H er høyde over havet.')}
<p>Linjen under koordinatsystemet i Felt viser valget du har gjort i Oppsett, for eksempel <em>Geoidemodell NN2000</em>. Med Android-posisjon er det <strong>Zeno Connect</strong> som avgjør om høyden er over geoiden eller ellipsoiden. Feltkart bruker høyden slik den kommer, og valget i Oppsett er bare en påminnelse om hva du forventer.</p>

<h3>Stanghøyde</h3>
<p>Antennen sitter på toppen av stanga, men du vil ha høyden på bakken. Feltkart trekker derfor stanghøyden fra høyden mottakeren oppgir. Du setter den øverst på skjermen, ved siden av GNSS-status.</p>
${fig(FIG_STANG, 'Figur 5. Bakke = høyde fra mottaker minus stanghøyde.')}
<div class="note"><strong>Unngå dobbel fratrekk.</strong> Sett antennehøyden ett sted. Er Zeno Connect satt opp med antennehøyde, skal stanghøyden i Feltkart være 0. Usikker? Mål et punkt med kjent høyde, for eksempel et fastmerke, og sjekk at høyden stemmer.</div>

<h3>Oppsett i Zeno Connect, steg for steg</h3>
<ol class="steps">
<li><div>Installer <strong>Leica Zeno Connect</strong> fra Google Play. Tillat posisjon og falsk posisjon (mock location) når appen spør.</div></li>
<li><div>Gå til <em>Innstillinger → Utviklermuligheter</em> og velg Zeno Connect under <em>Velg app for falsk posisjon</em>. Utviklermuligheter slås på ved å trykke 7 ganger på Build-nummer under Om telefonen.</div></li>
<li><div>Slå på FLX100, koble til i Zeno Connect og vent til posisjonen vises.</div></li>
<li><div>Lag en <strong>korreksjonsprofil</strong>: velg Internett, legg inn en ny server med navn, adresse, port, brukernavn og passord, og la NTRIP være på. Velg riktig mountpoint. Adresse, port og mountpoint får du fra tjenesten (for CPOS: Kartverket).</div></li>
<li><div>Velg geoidemodell hvis du vil ha høyde over havet. Vent til Zeno Connect viser <strong>RTK Fix</strong>.</div></li>
<li><div>Åpne Feltkart, velg <em>Android-posisjon</em> som kilde i Felt og vent på grønn status.</div></li>
</ol>

<h3>Feilsøking</h3>
${fig(FIG_FEIL, 'Figur 6. Gå ovenfra og ned til statusen blir grønn.')}
<p class="muted">Beskrivelsen følger Leicas oppsettguide for Zeno Connect. Menynavn kan være litt annerledes i din versjon av appen eller telefonen.</p>
</section>
`;
