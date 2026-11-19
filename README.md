# Feltkart

Kartløsning for anleggsprosjekter. Du kan samle alt fra byggeplassen i ett kart:

- **Bilder og 360-bilder.** De plasseres automatisk ut fra GPS-en i bildet og vises med hvert sitt ikon: grønn firkant for foto og mørkegrønn «360»-sirkel for 360-bilder.
- **Datofilter for bilder i kartet.** Knappen «Dato» øverst til høyre i kartet filtrerer bildene på tatt-dato: fra/til-dato, hurtigvalg (I dag, siste 7/30 dager, siste bildedag) og en glidebryter som blar mellom dagene som har bilder. Filteret gjelder bare kartvisningen.
- **Innmåling og prosjekterte data: DXF, KOF, SOSI, LandXML og IFC.** Innmålinger (KOF, SOSI, LandXML) havner automatisk i egen mappe «Innmålinger», mens DXF og IFC havner i «Prosjektert (DXF/IFC)». I eldre prosjekter opprettes «Innmålinger» første gang du laster opp innmåling. Du kan slå hvert lag av og på, klikke på et objekt for å se lag, lengde, areal og høyder, og se tekst når du zoomer helt inn.
- **Ortofoto fra drone** (GeoTIFF). Det reprojiseres slik at det ligger riktig i kartet, og du kan gjøre det mer eller mindre gjennomsiktig.
- **Bakgrunnskart.** Du kan velge mellom kart (Kartverket topo/gråtone, OpenStreetMap) og ortofoto (Norge i bilder, Esri), og legge eget droneortofoto oppå.
- **Prosjektmapper på Google Disk.** Du lager en mappemal (innrykket tekst), ser en forhåndsvisning og oppretter hele strukturen på Google Disk med ett klikk.
- **Mappestruktur** med avkrysning for hva som vises, søk, måling av avstand og areal, og koordinatvisning i EUREF89 UTM/NTM.

## Kom i gang

Du trenger [Node.js](https://nodejs.org) versjon 18 eller nyere.

```bash
npm install
npm run dev
```

Åpne adressen som vises (vanligvis http://localhost:5173). På Windows kan du i stedet dobbeltklikke `start.bat`.

> Det fungerer **ikke** å åpne `index.html` direkte fra mappen (adressen starter med `file://`). Siden må kjøres via `npm run dev`, eller via `npm run build` og `npm run preview`.

For å prøve DXF-visningen kan du laste opp `eksempeldata/eksempel-veg-utm32.dxf` med koordinatsystem **EUREF89 UTM sone 32**. Den ligger i Trondheim. Eksempelfilene `eksempel-innmaaling-utm32.kof`, `.sos` og `eksempel-landxml-utm32.xml` ligger i Oppdal-området.

## Legge prosjektet på GitHub

```bash
git init
git add .
git commit -m "Første versjon av Feltkart"
git branch -M main
git remote add origin https://github.com/<brukernavn>/feltkart.git
git push -u origin main
```

### Publisere som nettside (GitHub Pages)

Prosjektet har en ferdig workflow i `.github/workflows/deploy.yml`.

1. Gå til **Settings → Pages** i repoet på GitHub.
2. Under **Build and deployment**, velg **Source: GitHub Actions**.
3. Push til `main`. Siden bygges automatisk og publiseres på `https://<brukernavn>.github.io/feltkart/`.

## Google Disk: opprette prosjektmapper

Knappen **Google Disk** øverst åpner en dialog der du:

1. velger en mal eller skriver din egen. Hvert innrykk (to mellomrom eller tab) lager en undermappe. `{prosjektnr}`, `{prosjektnavn}`, `{år}` og `{dato}` erstattes automatisk.
2. fyller inn prosjektnummer og navn og ser forhåndsvisningen av mappene.
3. velger om mappene skal opprettes i **Min disk** eller i en mappe du velger (også delte disker).
4. trykker **Opprett**. Du får en lenke til mappen i Google Disk når den er ferdig.

Du kan også hente malen fra mappene i kartets innhold, og opprette samme struktur i kartet.

### Google Disk-mappe: hente fra og laste opp til en felles mappe

Knappen **Google Disk** åpner nå dialogen **Google Disk-mappe**. Der kobler du prosjektet til én mappe på Disk og kan:

- **Hente fra mappen:** velg filer (begrenset tilgang) eller **skann hele mappen** inkludert undermapper (full tilgang). Filene hentes inn i kartet, og undermapper på Disk kan speiles som mapper i kartet. Med **Strøm bilder fra Disk** lagres bare en forhåndsvisning i nettleseren. Originalen hentes fra Disk når du åpner bildet.
- **Laste opp til mappen:** send filer fra maskinen og/eller bilder og DXF-filer som ligger i kartet men ikke på Disk. De havner i undermapper som speiler kartets mapper. Store filer lastes opp med fremdrift.
- **Opprette prosjektmapper fra mal:** lenken i dialogen åpner malverktøyet. Mappen som opprettes kobles automatisk til prosjektet.

**Tilgangsnivå.** *Begrenset* (`drive.file`) lar Feltkart bare se filer du velger og filer Feltkart selv har lagt inn. *Full* (`drive`) lar Feltkart skanne og skrive i mappen. For Full må du i Google Cloud gå til **Google Auth Platform → Datatilgang → Legg til eller fjern omfang** og legge til `https://www.googleapis.com/auth/drive`, og deretter logge inn på nytt. Google merker slike apper «ikke verifisert» så lenge de er i testmodus. Det er greit for deg og testbrukerne dine. En offentlig tjeneste med Full tilgang krever godkjenning fra Google.

### Hente filer fra Google Disk inn i kartet

I **Last opp**-dialogen finner du **Velg filer fra Google Disk**. Du blar i mappene dine i Googles filvelger, merker flere filer (bilder, 360-bilder, DXF, ortofoto og eventuelle world files), og de hentes inn i kartet som om du hadde lastet dem opp fra maskinen. Det krever API-nøkkel og prosjektnummer (se oppsettet under).

Appen har bare tilgang til filene du velger. Det er derfor ikke mulig å velge en hel mappe og hente alt i den med én gang. Merk filene i mappen i stedet. Å hente hele mapper automatisk krever en bredere Google-tilgang som må godkjennes av Google, og det kan legges til senere.

### Oppsett (én gang)

Appen trenger en egen innlogging mot Google. Det er gratis.

1. Gå til [Google Cloud Console](https://console.cloud.google.com/) og lag et prosjekt.
2. Under **APIs & Services → Library**, slå på **Google Drive API** og **Google Picker API**.
3. Under **OAuth consent screen**, sett opp appen (Internal hvis dere har Google Workspace, ellers External) og legg til deg selv som testbruker.
4. Under **Credentials**, lag en **OAuth client ID** av typen *Web application*. Under *Authorized JavaScript origins* legger du inn `http://localhost:5173` og eventuelt `https://<brukernavn>.github.io`.
5. Kopier **Client ID** og legg den i `.env` (kopier `.env.example`) som `VITE_GOOGLE_CLIENT_ID`, eller lim den inn under **Innstillinger → Google Disk**.
6. Vil du kunne velge målmappe eller delt disk: lag også en **API key** (begrens den til Picker API og nettadressene dine) og legg den inn som `VITE_GOOGLE_API_KEY`. Prosjektnummeret finner du på forsiden i Cloud Console (`VITE_GOOGLE_APP_ID`).

Appen ber bare om tilgangen `drive.file`. Den kan altså ikke lese resten av disken din, bare mapper den selv oppretter eller som du velger i mappevelgeren.

På GitHub Pages leses ikke `.env`, siden bygges uten den. Legg verdiene inn under **Innstillinger → Google Disk** i appen, så lagres de i nettleseren din.

## Filformater

| Type | Filer | Merknad |
|---|---|---|
| Foto | JPG, PNG, WebP | Posisjon, høyde, retning og dato leses fra EXIF. HEIC (iPhone) må gjøres om til JPG først. |
| 360-bilde | JPG (ekvirektangulært) | Kjennes igjen på 2:1-format eller panorama-metadata (GPano). Typen kan endres i objektinformasjonen. |
| DXF | `.dxf` (ASCII) | Linjer, polylinjer med buer, 3D-polylinjer, sirkler, buer, ellipser, splines, 3DFACE, punkter, tekst og blokker. Tegningen må være georeferert (ikke lokale koordinater). |
| KOF | `.kof` | Innmålte punkter (post 05: punktnavn, kode, X nord, Y øst, H). Laget heter «Kode …», og punktnavn og høyde vises som tekst når du zoomer inn. Koordinatsystemet velger du ved opplasting, siden KOF ikke oppgir det. |
| SOSI | `.sos`, `.sosi` | Punkt, sverm, kurve, bue (BUEP), flate (via REF) og tekst. Lag følger OBJTYPE, og egenskaper vises i objektinformasjonen. Koordinatsystemet leses fra hodet for EUREF89 UTM (kode 21–26), ellers brukes valgt system. Tegnsett (ISO 8859 eller UTF-8) kjennes igjen. Hull i flater og klotoider tegnes forenklet eller utelates. |
| LandXML | `.xml` | Punkter (CgPoints), trasé og plangeometri (linjer, sirkelbuer, overgangskurver), eiendommer og terrengmodeller (TIN, vises som kant og trekanter). EPSG-kode leses fra filen når den finnes. |
| IFC | `.ifc` | Vises som grunnriss (omriss) av hver del, med farger fra IFC-filen og lag etter IFC-klasse. Plasseres med IfcMapConversion, ellers prosjekterte koordinater eller IfcSite-posisjon. Mangler alt dette, oppgir du modellens origo (Øst/Nord) ved opplasting. IFC-leseren (web-ifc) lastes fra internett første gang. 3D-visning i fanen Terreng 3D. |
| Ortofoto | GeoTIFF (`.tif`) eller JPEG 2000 (`.jp2`) | GeoTIFF: koordinatsystemet leses fra filen, og store filer bør ha innebygde oversiktsbilder (COG). JP2: georeferanse leses fra filen (GeoJP2 eller GMLJP2), ellers legger du ved en world file (`.j2w`, `.jgw` eller `.wld`) med samme filnavn. Avkoderen (OpenJPEG) lastes fra internett første gang. |

Bilder uten GPS kan plasseres manuelt: velg bildet og trykk **Plasser på kart**.

## Oppbygning

```
src/
  App.tsx              Layout: toppmeny, sidemeny, kart, verktøylinje
  state.ts             Prosjektdata, opplasting og synlighet
  types.ts             Datamodell
  lib/
    db.ts              Lagring i nettleseren (IndexedDB)
    crs.ts             Koordinatsystemer (EUREF89 UTM 32/33/35, NTM 5–30) med proj4
    measure.ts         Måling: lengde, areal, stigning og formatering (felles for kart og 3D)
    snap.ts            Snapping: hjørner/kanter/flater på IFC (3D) og hjørner/kanter i tegninger (2D)
    measureStore.ts    Mellomlagring av målingen i nettleseren (deles av kart og Terreng 3D)
    photos.ts          EXIF og gjenkjenning av 360-bilder
    dxf.ts             DXF → kartgeometri (inkl. blokker, buer, høyder)
    ortho.ts           GeoTIFF → reprojisert bilde (Web Mercator)
    basemaps.ts        Bakgrunnskart
  components/
    MapView.tsx        Leaflet-kartet, markører, DXF-lag, måling
    MeasurePanel.tsx   Målepanel (felles for kart og Terreng 3D)
    MeasureChip.tsx    Liten «Lagret måling»-boks når måleverktøyet ikke er i bruk
    Terrain3D.tsx      Terreng 3D (MapLibre + three.js): terreng, ortofoto, IFC, bilder, måling
    LayerTree.tsx      Mappestruktur med avkrysning
    InfoPanel.tsx      Objektinformasjon
    UploadDialog.tsx   Opplasting
    BasemapPicker.tsx  Valg av bakgrunn og droneortofoto
    MediaViewer.tsx    Bildevisning
    PanoViewer.tsx     360-visning (three.js)
    Gallery.tsx        Bildeoversikt per måned
```

Teknologi: React + TypeScript + Vite, Leaflet, proj4, dxf-parser, geotiff.js, exifr og three.js.

## Viktig å vite om denne versjonen

- **Alt lagres lokalt i nettleseren.** Data deles ikke mellom brukere eller maskiner. Hvis du tømmer nettleserdata, forsvinner prosjektet.
- **JP2** avkodes i nettleseren i redusert oppløsning (maks ca. 48 megapiksler, begrenset av hvor mange oppløsningsnivåer filen har). Veldig store filer (flere hundre MB) kan fortsatt bli for tunge. Da må du konvertere til GeoTIFF/COG, for eksempel med QGIS eller `gdal_translate -of COG`.
- **Store droneortofoto** (flere GB) blir for tunge for nettleseren. Bildet lagres med inntil 4096 piksler på lengste side.
- **Bakgrunnskart:** Sjekk vilkårene før offentlig bruk med mye trafikk. OpenStreetMap sine fliser er ikke for produksjon med stor trafikk. Norge i bilder og Kartverket har egne vilkår.

## Veien videre til en løsning for mange brukere

1. **Backend og database.** For eksempel Node (Fastify/NestJS) eller Python (FastAPI), med PostgreSQL + PostGIS. Erstatt `src/lib/db.ts` med kall mot et API. Datamodellen i `types.ts` kan brukes nesten direkte.
2. **Fillagring.** Bruk S3, Cloudflare R2 eller Azure Blob, med opplasting direkte fra nettleseren via forhåndssignerte lenker.
3. **Bakgrunnsjobber:**
   - **Ortofoto:** GDAL gjør om til Cloud Optimized GeoTIFF, som serveres som fliser via TiTiler. Da vises full oppløsning uansett filstørrelse.
   - **DXF:** konverteres til GeoJSON eller vektorfliser (ogr2ogr/tippecanoe) for store tegninger. Større IFC-modeller og terrengmodeller bør konverteres til vektorfliser/GeoJSON.
   - **Bilder:** miniatyrer lages og HEIC gjøres om.
4. **Brukere og tilgang.** Innlogging (Auth.js, Clerk eller Entra ID), prosjekter med medlemmer og roller (les/skriv/admin), og deling av mapper.
5. **Personvern.** Bilder kan vise personer og bilskilt. Tenk på tilgangsstyring, og fjern EXIF-posisjon ved deling utenfor prosjektet.


## Demodata fra Google Disk (lastes automatisk)

Hver gang appen åpnes med helt tomt kart (og API-nøkkel er satt opp), leses demomappen på Google Disk automatisk og alle bilder, DXF/KOF/SOSI/LandXML/IFC og ortofoto legges i kartet. Du kan også trykke **Last demodata** i «Kom i gang»-boksen eller øverst i Google Disk-dialogen. Demodata legges i standardmappene (Bilder, 360-bilder, Prosjektert, Innmålinger, Ortofoto). «Last demodata» erstatter tidligere innlastet demodata.

**Det som må være på plass (én gang):**
1. Mappen er delt som **«Alle med lenken – Leser»**. Mappe-ID står i `src/lib/demo.ts` (kan overstyres med `VITE_DEMO_FOLDER_ID`).
2. En **Google API-nøkkel**: Google Cloud → APIer og tjenester → Legitimasjon → Opprett legitimasjon → API-nøkkel. Slå på *Google Drive API* i biblioteket. Begrens nøkkelen til *Google Drive API* og til nettstedet `https://sveinsa.github.io/*`.
3. Gi appen nøkkelen på **én** av disse måtene:
   - GitHub → repoet → Settings → Secrets and variables → Actions → fanen *Variables* → ny variabel `GOOGLE_API_KEY` (deploy-filen sender den videre ved bygging), eller
   - legg den inn i appen under Innstillinger → Google.
   I denne pakken ligger nøkkelen også i `src/lib/demo.ts` (`DEMO_API_KEY`), slik at demodata virker uten annet oppsett. GitHub kan varsle om nøkler i kildekode. Nøkkelen er begrenset til nettstedet og Drive-API-et, så varselet kan lukkes.

API-nøkler i nettapper er ikke hemmelige – sikkerheten ligger i begrensningene i punkt 2. Demofilene hentes ned fullt ut (ingen strømming).

## Koordinatsystem for DXF og KOF

DXF og KOF oppgir ikke koordinatsystem. Ved opplasting sjekker Feltkart at dataene havner i Norge og i nærheten av bildene/ortofotoet som allerede er i kartet. Passer ikke valgt koordinatsystem (f.eks. UTM 32), prøver den UTM 31–36 og NTM-sonene og bruker det som treffer. Endringen står i meldingene etter opplasting. Enkeltpunkter i KOF som ligger mer enn 20 km unna resten rettes (byttet øst/nord) eller utelates.

## DXF: bare modellrommet

Feltkart leser kun **modellrommet** (Model space) i DXF-filer. Alt i papirrom/layout (tegningsramme, tittelfelt, målestokk, viewporter) hoppes over, siden det ligger i arkkoordinater og ikke i kartkoordinater. Antall utelatte objekter står i meldingene etter opplasting. Koordinatsystemet gjettes ut fra modellrommets plassering (se over). Du kan også endre det manuelt i infopanelet («Koordinatsystem i filen»).

## Mappene i prosjektet

Standardmappene er Bilder, 360-bilder, Prosjektert (DXF/IFC), Innmålinger og Ortofoto (drone). Data fra Google Disk (inkl. demodata) legges direkte i disse. Eldre prosjekter som har fått egne speilede mapper (Foto, Innmåling, Ortofoto, Prosjektert) ryddes automatisk første gang appen åpnes: innholdet flyttes til standardmappene og de tomme duplikatene fjernes. Mapper som inneholder egne, opplastede filer røres ikke.

## Skarphet og hastighet på ortofoto

Ortofoto lagres i nettleseren med opptil 6144 piksler på lengste side (4096 på enheter med lite minne). Det lages også et lite forhåndsbilde (maks 2048 px) som vises når kartet er zoomet langt ut, og det store bildet tas i bruk når du zoomer inn. Det gjør panorering rask selv med skarpt bilde. JPEG 2000-filer avkodes opp til 64 millioner piksler. Er ortofotoet større enn dette, nedskaleres det, og i en produksjonsløsning bør det leveres som flisbelagt kart (tiles) fra serveren. Ortofoto som allerede er lastet inn beholder oppløsningen fra da det ble lastet inn, og må lastes inn på nytt for å bli skarpere eller få forhåndsbilde.

## Ortofoto – hastighet (v 2.8)
GeoTIFF avkodes nå med flere arbeidstråder (geotiff `Pool`), og fremdriften viser sekunder. Komprimerte TIFF-er er tregest; hvis det fortsatt tar lang tid, eksporter fra drone-programvaren som *tiled GeoTIFF med overviews (COG)* – da bruker Feltkart de innebygde oversiktsbildene og lastingen går på noen sekunder.

## Faner og bildevisning (v 2.9)
- Toppmeny: **Kart**, **Bilder**, **Prosjektfiler**, **Innstillinger**.
- **Bilder** (også knappen med rutenett-ikonet til venstre) viser kartet med et bildepanel: filtrer på type (Foto / 360°), dato (fra–til, hurtigvalg, sortering nyeste/eldste først) og hvilke mapper som skal vise bilder. Klikk et miniatyrbilde for å zoome til det i kartet, dobbeltklikk for å åpne det i visning. «Rutenett» gir den store bildeoversikten.
- **Prosjektfiler** er en filoversikt: mapper til venstre, tabell med alle filer til høyre (type, mappe, størrelse, dato, vis/skjul i kart, zoom, slett).

## Nullstill demo (v 3.0)
Knappen **Nullstill demo** (Innstillinger, Prosjektfiler og Google Disk-dialogen) sletter alt innhold i Feltkart – bilder, ortofoto, DXF/innmålinger og ekstra mapper. Rotmappen og standardmappene beholdes, og filer på Google Disk berøres ikke. Etterpå kommer «Kom i gang»-boksen tilbake med knappen **Last demodata**, slik at demoen kan hentes på nytt.

## Demo: Disk-mapper og velkomstboks (v 3.1)
- Før demodata lastes automatisk vises en velkomstboks («Velkommen til demo av Feltkart») med valgene **Ja** og **Nei**. Ved Nei starter Feltkart tomt, og demoen kan hentes senere med «Last demodata».
- Mappestrukturen til venstre følger nå mappene i demomappen på Google Disk (f.eks. *01 Foto, 02 Innmåling, 03 Prosjektert, 04 Ortofoto*, inkl. undermapper). Disse blir også standardmapper for nye opplastinger av tilsvarende type, og de tomme startmappene (Bilder, 360-bilder …) fjernes hvis de ikke inneholder egne filer.

## Mapperekkefølge og nullstilling (v 3.3)
Nummererte mapper (01 Foto, 02 Innmåling …) vises alltid i nummerrekkefølge øverst; øvrige mapper kommer etterpå i opprettelsesrekkefølge. Nederst i menyen til venstre ligger en rød **Nullstill demo**-knapp (med bekreftelse). Etter nullstilling spør Feltkart på nytt om demodata skal lastes ned.

## Demodata i selve nettstedet – raskere enn Google Disk (v 3.4)
Feltkart bruker `public/demo/manifest.json` hvis den finnes, ellers Google Disk.
1. Legg filene i `public/demo/` i mapper (`01 Foto`, `02 Innmåling`, `03 Prosjektert`, `04 Ortofoto`).
2. Kjør `node scripts/lag-demo-manifest.mjs` (lager manifest.json).
3. Last opp til GitHub (commit + push). Maks 100 MB per fil; nettleser-opplasting på github.com tar maks 25 MB per fil, så bruk GitHub Desktop eller git for større filer.
Tips for fart: nedskaler bilder (ca. 2000 px bredde, 360-bilder 4096 px) og lag ortofotoet som COG, f.eks. `gdal_translate in.tif ut.tif -of COG -co COMPRESS=JPEG -outsize 6144 0`.
Nedlastingen går også parallelt (4 filer om gangen), både fra nettstedet og fra Google Disk.

### Store filer (over 25 / 100 MB)
- github.com tar maks 25 MB per fil i nettleseren, og GitHub tar aldri over 100 MB. Legg små filer på GitHub via nettleseren, og store via **GitHub Desktop** (clone repoet, kopier filene inn, Commit, Push).
- Alternativt: la det store ortofotoet ligge på Google Disk. Kjør `node scripts/lag-demo-manifest.mjs --drive`. Da hentes alt som ikke ligger i `public/demo` fra Google Disk-demomappen (samme mappenavn som lokalt).

## Svart bakgrunn i ortofoto (v 3.6)
Ortofoto uten alfakanal (f.eks. JPEG-komprimert GeoTIFF/COG uten gjennomsiktighet) har svart bakgrunn utenfor flyområdet. Feltkart gjør nå svart bakgrunn som henger sammen med bildekanten gjennomsiktig ved innlasting (mørke områder inne i bildet beholdes). Det virker også for demo-ortofotoet. Last det opp på nytt (eller bruk Nullstill demo og last demodata) for at det skal gjelde.

## Bakgrunnskart: «Norge i bilder» (v 3.7)
Norge i bilder er ikke lenger en åpen kartflis-tjeneste hos Kartverket/Geonorge (den krever nå pålogging), så den er tatt ut. Ortofoto-bakgrunn er nå **Esri verdensbilder**. Har du tilgang til en annen tjeneste, legg inn en XYZ-adresse (`.../{z}/{x}/{y}.jpg`) under Innstillinger → Egen bakgrunn (ortofoto). Den vises da under «Ortofoto» i bakgrunnsvelgeren.

## Fremdrift ved demodata (v 3.8)
Innlasting av demodata viser en statuslinje med prosent og klokke (tid brukt, forventet ca. 1 min 10 s) og en kaffekopp med rykende damp. Fremdriften er reell: skanning, nedlasting (per fil) og behandling (veid etter filstørrelse, siden ortofoto tar lengst tid).

## Terreng 3D (v 4.0)
Egen fane **Terreng 3D** (MapLibre GL + three.js, lastes først når fanen åpnes):
- **Terreng** fra åpne høydedata (Mapterhorn – Norge i 1 m, eller AWS Terrain Tiles globalt). Bakgrunn: Esri, OpenStreetMap, Kartverket eller egen. (Overdrivelse av høyder er fjernet i v 4.8.)
- **Ortofoto** (droneortofoto) drapes på terrenget. Slå av «Vis terreng i 3D» for å se det flatt.
- **IFC-modeller** vises som ekte 3D (trekanter), farget etter objekttype. Modellen må ha georeferanse (som for kartvisning). Svært store modeller kuttes ved 2,5 mill. trekanter.
- **Dronefoto og 360-bilder** vises i riktig posisjon og høyde (fra bildets GPS-høyde), med stolpe ned til bakken. Vanlige bilder er rammer med «FOTO»-merke, 360-bilder er kuler med «360°»-merke (se v 4.2). Klikk et bilde for å åpne det. Datofilteret i kartet gjelder også her.
- Krever at nettleseren har WebGL. Kjør `npm install` på nytt etter oppdatering (ny avhengighet: `maplibre-gl`).

### Rettelser i v 4.1 (hvit side i Terreng 3D)
- **Feilfanger:** Krasjer noe i appen, vises nå en lesbar feilmelding med knappene «Last siden på nytt» og «Kopier feilmelding» i stedet for en hvit side. Feilen i Terreng 3D-fanen har også «Tilbake til kartet».
- **Funksjonsnavn rettet:** 3D-koden brukte `meterInMercatorUnits`, som ikke finnes i MapLibre. Riktig navn er `meterInMercatorCoordinateUnits`. Feilen tok ned hele appen så snart demodata med bilder var lastet.
- **Kartvinduet kollapset:** MapLibres stilark gjør kartvinduet til `position: relative`, og det lastes etter vårt eget stilark. Uten fast størrelse ble kartet 0 piksler høyt. Størrelsen settes nå både i CSS og som inline-stil.
- **Riktig høyde på bobler og IFC:** I MapLibre 4.x er matrisen til egne lag ikke senket med terrenghøyden i kartsenteret, og `queryTerrainElevation` gir høyde relativt til senteret. Begge deler er justert, så alt tegnes i høyde over havet.
- **Mapterhorn** leses nå via sin offisielle TileJSON (`https://tiles.mapterhorn.com/tilejson.json`). Svarer den ikke, byttes det automatisk til AWS Terrain Tiles, og du får beskjed.
- **Teknisk info** nederst i panelet (versjon, WebGL, størrelse på kartvinduet, antall bobler og IFC-deler) hjelper når noe ikke ser riktig ut.

## Måling og tydeligere bilder i 3D (v 4.2)

### Måling i kartet og i Terreng 3D
Verktøylinjen har to målevalg med tekst, **Avstand** og **Areal**. Samme målepanel brukes i både kartet og Terreng 3D (i 3D ligger knappene øverst i vinduet).
- **Avstand / lengde:** Klikk punkt for punkt. Hver delstrekning får en etikett på linjen, og samlet lengde («Σ») står ved siste punkt. Mens du måler, følger en stiplet strek og en etikett pekeren, så du ser lengden før du klikker.
- **Areal innenfor et polygon:** Klikk hjørnene. Du får areal i m², og i dekar (daa) og hektar (ha) fra 1 000 m², pluss omkrets. Krysser polygonet seg selv, vises en advarsel, siden arealet da ikke er pålitelig.
- **Panelet** har Angre, Fullfør, Nullstill og Kopier (kopierer resultatet som tekst). Midt i en måling kan du bytte mellom Avstand og Areal uten å miste punktene.
- **Snarveier:** Enter fullfører, Backspace angrer siste punkt, Esc avslutter målingen, dobbeltklikk fullfører. I kartet angrer også høyreklikk siste punkt. Bilder og DXF-punkter i kartet kan klikkes som målepunkter mens du måler.
- **I Terreng 3D** måles det direkte på terrenget (strekene legges langs bakken). I tillegg vises **skrå lengde**, **høydeforskjell** og **stigning** i prosent. Høydene leses av terrengmodellen når du klikker og er derfor omtrentlige. Er terrenget slått av, vises bare horisontale mål.
- **Regnet i prosjektets koordinatsystem** (står nederst i panelet). Er prosjektet i lengde/bredde (EPSG:4326), regnes det i UTM-sonen der målingen ligger. Avstander i UTM/NTM har små avvik fra målt avstand på bakken, slik som i all kartprogramvare. Skrå lengde er rette linjer mellom punktene du klikker, ikke terrengets krumning mellom dem.
- Målingen ryddes bort når du velger et annet verktøy eller bytter fane.

### Tydeligere forskjell på foto og 360-bilde i 3D
- **Vanlig foto** er en stående **bilderamme** med miniatyren av bildet og et grønt «FOTO»-merke.
- **360-bilde** er en **kule** med selve panoramabildet på utsiden, en hvit ring rundt og et mørkegrønt «360°»-merke.
- Merkelappene og rammene vender alltid mot kameraet, så de kan leses uansett fra hvilken side du ser.
- **Bilder i 3D**-panelet har egne avkrysningsbokser for «Vanlige bilder (rammer)» og «360-bilder (kuler)» med antall, og små tegnforklaringsikoner som ser ut som objektene i 3D. Størrelsen kan justeres.
- Holder du musen over et bilde, vises et lite kort med miniatyr, typen («Vanlig foto» eller «360-bilde») og filnavnet.

## Måling: dobbeltklikk og ny måling (v 4.3)
- **Dobbeltklikk (og dobbelttrykk på mobil) avslutter målingen, og neste klikk starter en helt ny måling.** Nettlesere og kartbiblioteker sender klikk og «dblclick» i ulik rekkefølge, og på mobil og nettbrett ofte ikke «dblclick» i det hele tatt. Da kunne målingen fortsette fra «sist brukte punkt» i stedet for å starte på nytt. Feltkart avgjør nå selv at to raske klikk (innen 0,4 sekunder og nesten på samme sted) er ett dobbeltklikk: det andre klikket legger ikke til et punkt, men avslutter målingen. Det gjelder både i kartet og i Terreng 3D.
- **Bytte mellom Avstand og Areal** beholder punktene bare midt i en måling. Er målingen ferdig, nullstilles den ved bytte, og neste klikk starter på nytt.
- **Langt trykk med finger** (som gir «høyreklikk» på mobil) angrer ikke lenger siste punkt i kartet.
- Hjelpeteksten etter en ferdig måling sier nå «Neste klikk starter en ny måling».

## IFC med farger og detaljer, filegenskaper og felles statusfelt (v 4.4)
- **IFC-farger:** Fargene (overflatestiler) i IFC-filen brukes nå både i kartet og i Terreng 3D, også gjennomsiktighet (f.eks. glass). Deler uten egen farge får standardfarge for klassen. I kartet tegnes ett omriss per del-geometri (ikke ett per objekt), med lave deler først, så høyere deler havner oppå. Modeller med over 40 000 deler tegnes fortsatt med ett omriss per objekt.
- **Detaljer i 3D:** I panelet «IFC-modeller» kan du slå av og på **Farger fra IFC-filen** og **Kantlinjer (detaljer)**, og skjule enkeltlag (Vegger, Tak, Vinduer …). Kantlinjer hoppes over i modeller med over 400 000 trekanter.
- **Egenskaper ved klikk:** Objekttype, type, tag og verdier fra property sets (Pset) vises under objektinformasjon. Property sets leses bare for modeller med inntil 1 500 objekter (oppslaget er tregt i store filer).
- **Prosjektfiler** har kolonnene **Navn, Type, Sist endret, Versjon, Beskrivelse og Endret av** (etterfulgt av Mappe, Størrelse og I kartet). Klikk på en kolonneoverskrift for å sortere. Klikk i **Beskrivelse** eller **Versjon** for å redigere (Enter lagrer, Esc avbryter). Sist endret og Endret av oppdateres da.
  - Filer fra Google Disk får Disk-datoen, beskrivelsen og navnet til den som sist endret filen der. Filer fra datamaskinen får filens egen dato. «Endret av» er navnet du skriver under **Innstillinger → Ditt navn**, ellers navnet på innlogget Google-bruker. Eldre filer får versjon 1 og opprettelsestidspunktet.
- **Felles statusfelt:** Fremdriften for nedlasting og opplasting (demodata, Google Disk, opplasting av filer) vises nederst i alle visninger (Kart, Bilder, Prosjektfiler, Terreng 3D og Innstillinger). Opplastings- og Disk-dialogene har **Skjul – fortsetter i bakgrunnen**, så du kan bytte visning mens det pågår. Feil blir stående til du lukker dem.

## Snapping til IFC og lagring av målinger (v 4.5)
- **Snapping til 3D-objekter:** Under måling i **Terreng 3D** snapper markøren til IFC-modellen. Den prøver først **hjørne** (firkantet markør, innen 12 piksler), så **kant** (rund markør, innen 9 piksler) og ellers punkt på **flaten** (liten rund markør). Markøren og panelet viser hva du snapper til. Det snappede punktet får **høyden fra IFC-modellen** (ikke terrenghøyde), så skrå lengde og høydeforskjell blir riktige mellom f.eks. to takhjørner. Mellom snappede punkter tegnes også en tynn 3D-linje med riktige høyder (selve målelinjen på kartet ligger fortsatt på bakken).
  - Bare «ekte» kanter snappes til (ytterkanter og knekk over 28°). Skjøtene som deler en plan flate i trekanter hoppes over.
  - Like utenfor modellens silhuett finnes hjørner og kanter likevel, så du trenger ikke treffe flaten nøyaktig.
- **Snapping i kartet (2D):** Markøren snapper til hjørner og kanter i synlige tegninger (DXF, KOF, SOSI, LandXML og IFC-omriss). Skjulte filer og skjulte lag hoppes over.
- **Av og på:** Avkrysningsboksen **Snap til objekter** i målepanelet slår snapping av og på (valget huskes). Hold inne **Alt** for å snappe av midlertidig.
- **Målingen lagres underveis:** Hvert punkt, hver angring og hver avslutning lagres straks i nettleseren. Målingen blir stående når du lukker måleverktøyet, bytter mellom Kart og Terreng 3D (de deler samme måling) eller laster siden på nytt, helt til du trykker **Nullstill**. Når verktøyet ikke er i bruk, vises en liten boks nederst i kartet («Lagret avstandsmåling: …») med **Åpne** og **Nullstill**.
  - Bytter du mellom Avstand og Areal, beholdes punktene (også i en ferdig måling). Et nytt klikk i en ferdig måling starter en ny måling og erstatter den lagrede.
  - Målingen lagres i nettleseren på denne maskinen (localStorage), ikke på Google Disk, og er ikke delt med andre.
- **Målepanelet i 2D-kartet** står nå øverst til venstre, så det ikke lenger kan dekkes av verktøylinjen på smalere skjermer.

## Målehistorikk, flere målinger i kartet og rettelser (v 4.6)
- **Flere målinger samtidig:** Når du har fullført en måling og klikker igjen, blir den ferdige målingen **stående i kartet** (og i Terreng 3D), og en ny måling starter ved siden av. Slik kan du for eksempel måle flere arealer etter og ved siden av hverandre.
- **Egen farge per måling:** Hver måling får sin egen farge (oransje, blå, rosa, grønn, lilla, turkis, gul, brun, deretter rundt igjen). Fargen brukes på linjer, flater, punkter og lengde- og arealetiketter, både i kartet og i 3D.
- **Historikk i målepanelet:** Panelet har nå en liste **Målinger (n)** med fargeprikk, type og verdi for hver måling. Klikk på en rad for å zoome til målingen, og på × for å slette bare den. Når to eller flere arealmålinger er ferdige, vises **Sum areal**, og tilsvarende **Sum lengde** for avstandsmålinger.
- **Nullstill alle:** Knappen **Nullstill alle** (i listen over målingene, og i boksen nederst når verktøyet er lukket) fjerner alle målingene, også de lagrede kopiene. Den gamle knappen «Nullstill» i bunnen av panelet er erstattet av denne og av × på hver rad.
- **Lagres løpende:** Alle målingene lagres i nettleseren hver gang noe endres, og er felles for Kart og Terreng 3D. Boksen nederst viser «Lagret: n målinger» med **Åpne** og **Nullstill alle** når verktøyet ikke er i bruk. Målinger lagret av v 4.5 leses fortsatt.
- **Bytte mellom Avstand og Areal** midt i en måling beholder punktene som før. Er målingen ferdig, blir den stående som den er (med sin egen type), og en ny måling starter.
- **Midtstilt innlastingsvindu:** Fremdriftsvinduet for demodata, Google Disk og opplasting står nå midt på skjermen i stedet for nederst.
- **Terreng 3D, bilder og 360:** Det er gjort flere sikringer, men årsaken kunne ikke bekreftes uten en ekte nettleser med GPU: (1) lettere å treffe bildeboblene, siden klikk innen 26 piksler fra en boble åpner bildet; (2) bildevisningen tilpasser bildet til hele vinduet (ingen beskjæring); (3) 360-visningen starter selv om vindustørrelsen ikke er kjent ennå, rydder opp WebGL-kontekst og viser en tydelig melding hvis WebGL ikke er tilgjengelig. Fungerer det fortsatt ikke, send et skjermbilde og teksten i rødt (om den vises), så kan feilen finnes.

## Prosjektvelger (v 4.7)
- **Nedtrekksmeny for prosjekter:** Prosjektnavnet øverst til høyre er nå en nedtrekksmeny med alle prosjektene, og «Prosjektinnstillinger» nederst. Listen inneholder **Oppdal Ålma** (standardprosjektet, med demodata) og de tomme dummyprosjektene **Prosjekt 1, 2 og 3**.
- **Egen lagring per prosjekt:** Hvert prosjekt har sin egen database i nettleseren (bilder, filer, innstillinger) og sine egne målinger. Når du bytter prosjekt, lastes siden på nytt med det valgte prosjektet. Oppdal Ålma bruker samme lagring som før, så eksisterende innhold beholdes. Et prosjekt som het «Mitt prosjekt» (uendret navn) får navnet «Oppdal Ålma».
- Spørsmålet om å laste demodata vises bare i Oppdal Ålma. Navn som endres under Innstillinger vises også i listen.
- **Google Disk-knappen** er fjernet fra toppfeltet og finnes nå bare i venstre meny.
- Dummyprosjektene er plassholdere: de kan brukes som tomme prosjekter nå, men det finnes ennå ingen funksjon for å opprette, slette eller dele prosjekter.

## Terreng 3D uten høydeoverdrivelse (v 4.8)
- Glideren **Overdrivelse av høyder** er fjernet fra Terreng 3D. Terrenget vises alltid i riktig høydemålestokk (1×), så målinger og IFC-modeller står riktig i forhold til terrenget.

## Info om ventetid ved demodata (v 4.9)
- Velkomstboksen og fremdriftsvinduet for demodata oppgir nå antatt tid: **ca. 60 sekunder**.

## Prosjektmenyen over kartet (v 4.10)
- Nedtrekksmenyen for prosjekter lå bak kartet i Kart-visningen; toppfeltet ligger nå over kartlagene, så menyen vises i alle visninger.
- Menyen har fått teksten **Prosjekt:** foran seg.
- Menyen tegnes nå direkte i siden med fast plassering, så ikke noe annet kan skjule den.

## Høydeforskjell (Δh) i målelisten (v 4.10)
- I Terreng 3D vises **Δh** (høydeforskjell, siste mot første punkt, f.eks. «Δh +3,20 m») på hver avstandsmåling i målelisten, med grønn bakgrunn ved stigning og rød ved fall. Fra to målinger vises også **Sum Δh**.
- I resultatpanelet er raden «Høydeforskjell (Δh)» fremhevet med egen bakgrunn og større tall, og den følger med når du kopierer resultatet.
- I vanlig 2D-kart finnes ingen høydedata, så Δh vises bare i Terreng 3D.

## Stigning/fall i prosent (v 4.11)
- Sammen med Δh vises nå **stigning (+) eller fall (−) i prosent**, f.eks. «Δh +3,20 m (+6,4 %)», både i målelisten og i resultatpanelet (Terreng 3D). Prosenten er Δh delt på horisontal lengde. Med mer enn to punkter er det gjennomsnittet for hele målingen.

## Antatt tid i demodata-vinduet (v 4.12)
- Statusvinduet «Laster demodata» (midt på skjermen) viser nå teksten **«Antatt tid for nedlasting er ca. 60 sekunder.»** under statuslinjen mens nedlastingen pågår.

## Antatt tid også i statusvinduet for demodata (v 5.0)
- Statusvinduet «Laster demodata» viser nå alltid teksten **«Antatt tid for nedlasting er ca. 60 sekunder.»**, også når demodata lastes fra Prosjektfiler/Google Disk-dialogen (tidligere sto den bare ved oppstartsspørsmålet).
- Versjonsnummeret er nå 5.0.

## Sjekk ny versjon og Nullstill demodata i menyen (v 5.1)
- Knappen nederst i venstre meny heter nå **Nullstill demodata** (tidligere «nullstill»).
- Ny knapp **Sjekk ny versjon Feltkart** over den: gjør det samme som Ctrl + Shift + R. Hurtigbufferen tømmes og siden hentes på nytt, så du får nyeste publiserte versjon av Feltkart. Bilder, målinger og innstillinger beholdes. Nytt versjonsnummer vises når oppdateringen er publisert på GitHub; knappen kan ikke hente en versjon som ikke er publisert ennå.

## Bugreport-knapp (v 5.2)
- Øverst til høyre i toppfeltet står en knapp **Bugreport 🪲** som åpner skjemaet for feilmeldinger i et nytt vindu. Den vises i alle visninger.

## Tverrsnitt (v 5.3)
- **Innstillinger** er fjernet fra øverste linje. De nås fortsatt via tannhjulet nederst i venstre meny og via «Prosjektinnstillinger» i prosjektmenyen.
- I **Terreng 3D**: mål en avstand (to eller flere punkter) og trykk **Lag tverrsnitt langs linjen** i målepanelet. Hver avstandsmåling i målelisten har også en **Snitt**-knapp.
- Snittet åpnes i et **eget vindu** som kan flyttes (dra i tittelen) og gjøres større (dra i hjørnet nede til høyre). Det viser terrengprofilen og alle viste **IFC-objekter** (skåret av et loddrett plan langs linjen, med IFC-fargene og fylt flate). Målelinjer med flere punkter følges rundt knekkene.
- **Overhøyde**: tilpass vinduet, ×1 (ekte målestokk), ×2, ×5 eller ×10. **Lag** (Terreng og hvert IFC-lag) kan slås av og på. Musepekeren viser avstand og terrenghøyde.
- **Kopier bilde**: legger snittet som PNG (minst 1600 piksler bredt) på utklippstavlen, så du kan lime det inn i Word, e-post eller Teams. Tillater ikke nettleseren bilde på utklippstavlen, lastes bildet ned i stedet.
- **Eksporter DXF**: AutoCAD-format (R12) i meter og 1:1, med x = avstand langs snittet og y = høyde (m o.h.). Lag: TERRENG, AKSER, TEKST, KNEKKPUNKT og ett lag per IFC-lag. Skjulte lag tas ikke med.
- Terrengprofilen leses av terrengmodellen (omtrentlig) og trenger at terrenget er slått på og lastet rundt linjen. Uten terreng vises bare objektene.
- Tverrsnitt finnes bare i Terreng 3D (2D-kartet har ingen høyder eller IFC-objekter).
- Kode: `src/lib/section.ts` (matte, tegning, DXF) og `src/components/SectionWindow.tsx` (vinduet).

## Tverrsnitt i 2D-kartet (v 5.4)
- Tverrsnitt finnes nå også i **Kart (2D)**: mål en avstand og trykk **Lag tverrsnitt langs linjen**, eller bruk **Snitt**-knappen på en måling i listen. Vinduet, overhøyde, lag, **Kopier bilde** og **Eksporter DXF** er de samme som i Terreng 3D.
- **IFC-objekter** tas fra de IFC-modellene som er synlige i kartet (lag du har skjult i lagtreet tas ikke med), og skjæres i prosjektets koordinatsystem.
- **Terreng** hentes direkte fra høydefliser (Mapterhorn, Norge i 1 m, med AWS som reserve), siden 2D-kartet ikke har egen terrengmodell. Det trenger nett. Er det ikke tilgjengelig, vises bare objektene, og statuslinjen i vinduet sier fra. Kode: `src/lib/dem.ts`.

## Markør i kartet fra tverrsnittet (v 5.5)
- Når du flytter musepekeren langs snittet, vises en **rød markør i kartet (2D og 3D)** på det stedet på måle-linjen som pekeren er over i snittet. Den følger også med rundt knekk i linjen, og forsvinner når pekeren forlater snittet eller du lukker vinduet.

## Snittvinduet kan ikke «henge seg opp» (v 5.6)
- Snittvinduet kan ikke lenger dras ut av skjermen eller bak toppfeltet: tittelen (med lukk-knappen) er alltid synlig og lagt over toppfeltet. Vinduet justeres også automatisk hvis nettleservinduet gjøres mindre.
- **Dobbeltklikk på tittelen** setter vinduet tilbake på standardplassen.

## 360-bilder kan roteres rett i bildedialogen (v 5.7)

Når du velger et 360-bilde (i kartet eller i Bilder-panelet), vises det nå som en levende 360-visning inne i dialogen til høyre i stedet for et flatt panorama:

- **Dra** med musen (eller fingeren) for å se rundt, **rull** for å zoome.
- Bla med pilene eller piltastene, så bytter visningen til neste 360-bilde (visningen starter etter et lite øyeblikk, så det går raskt å bla forbi).
- Knappen **«Åpne 360 i fullskjerm»** åpner den store visningen som før. Mens fullskjermen er åpen hviler visningen i dialogen, så nettleseren ikke bruker to 360-visninger samtidig.
- Vanlige bilder er uendret (flatt bilde, klikk åpner fullskjerm).

## Android-app med RTK, bilde og innmåling (v 5.8)

Feltkart finnes nå som Android-app (APK) med felt-funksjoner: RTK-posisjon fra Leica FLX100 (Android-posisjon via Zeno Connect eller direkte Bluetooth NMEA), bilder med RTK-posisjon, innmåling av punkter (KOF/CSV) og live posisjon i kartet. APK-en bygges av GitHub Actions (`.github/workflows/android.yml`). Oppsett og bruk står i **[ANDROID.md](ANDROID.md)**.

På telefon vises hovedmenyen i egen rad øverst.

## Felt i nettleseren, sortering og eksport (v 5.9)

- *(Erstattet i v 6.1: Felt-fanen med selve målingen finnes nå bare i Android-appen. Nettleseren har fanen Innmåling.)*
- Ny fane **Punkter**: alle målte punkter i en tabell, **sortert på dato, kode, punktnavn eller høyde** (kolonneoverskrift eller nedtrekksliste), med **filter på kode og dato** (fra/til). Punkter uten kode havner alltid sist ved kodesortering. Likt resultat avgjøres av dato og så navn (P2 før P10).
- **Koordinatsystem kan velges** (EUREF89 UTM og NTM). Punktene lagres med bredde/lengde og regnes om til valgt system ved visning og eksport. Valget huskes. Er prosjektet satt til grader (WGS84), brukes UTM til innmåling.
- **Nedlasting til PC (eller telefon) som KOF, SOSI, LandXML og CSV**, i valgt koordinatsystem, med utvalget og rekkefølgen du har valgt. SOSI støttes i EUREF89 UTM sone 31–36 (SOSI 4.0, punktobjekter, UTF-8, mm-oppløsning); i NTM brukes KOF eller LandXML. LandXML skrives som 1.2 med `<CgPoints>`.
- **Lagre i prosjektet** legger bare punkter som ikke allerede er lagret inn som KOF i *Innmålinger*. Punktene beholdes i tabellen med ✓ til du trykker **Fjern lagrede**. Tidligere ble listen tømt ved lagring.
- Kode: `src/lib/field/survey.ts` (sortering, filter, KOF/CSV), `src/lib/field/export.ts` (SOSI, LandXML, filnavn), `src/components/FieldPanel.tsx` (fanen).

## Android-bygget rettet (v 6.0)
- Forsøk på å rette Kotlin-feilen `onGeolocationShowPrompt overrides nothing` ved å gjøre parameterne «nullable». **Dette var ikke riktig årsak, se v 6.4.**

## Innmåling-fanen (v 6.1)

- **Nettleseren har ingen målefunksjon.** Fanen «Felt» (RTK, Bluetooth, bilde, mål punkt) vises nå bare i Android-appen. I nettleseren heter fanen **Innmåling** og viser innmålingene som ligger i prosjektet.
- **Innhold:** alle punkter fra KOF-, SOSI- og LandXML-filer i prosjektet (også de som er lagt inn fra Felt i appen eller hentet fra Google Disk), samlet i én tabell. Til venstre er et **mappetre** med antall punkter og hake per mappe (hake på en mappe tar med eller skjuler alt under den), og **Importer innmålinger** åpner vanlig opplasting.
- **Tabell:** Punkt, Kode, Dato, X (nord), Y (øst), Z (høyde) og Fil, med **sortering** (trykk på overskriften) og **filter per kolonne** (trakt-ikonet): kode og fil velges fra en liste, punkt søkes i, dato og X/Y/Z har fra–til. **Legg til filter** gjør det samme fra én knapp, aktive filter vises som merkelapper, og **Fjern filter** nullstiller alt. **Vis kolonner** skjuler og viser kolonner (valget huskes). Punkter uten kode eller uten høyde havner alltid sist. Over 100 punkter deles i sider. Pin-ikonet viser punktet i kartet.
- **Dato:** SOSI (`DATAFANGSTDATO`) og LandXML (`timeStamp`) har punktets egen dato. **KOF har ikke dato per punkt**, så der vises filens dato. Eksporterer du fra Felt-appen som SOSI eller LandXML følger måledatoen med.
- **Koordinatsystem** velges øverst (EUREF89 UTM og NTM). Punktene regnes om til valgt system i tabellen og i nedlastingen.
- **Last ned innmålinger** gir **KOF, CSV, LandXML, DXF** (og SOSI i UTM sone 31–36) i valgt koordinatsystem. Har du krysset av rader, lastes bare de ned. Ellers lastes alt som vises ned (etter filter og mapper). DXF er R12 (ASCII) med ett lag per kode, ett POINT per punkt og en tekst med punktnavn og høyde.
- Ikke med: Flatekode, Linjekode, DZ og Stanghøyde (finnes ikke i KOF/SOSI/LandXML), og endring eller sletting av enkeltpunkter i filene.
- Kode: `src/lib/field/register.ts` (rader, filter, sortering), `src/lib/field/export.ts` (nå også DXF), `src/components/SurveyRegister.tsx` (fanen). LandXML-leseren tar nå også med `timeStamp` som tid.

## Ett repo for web og app (v 6.2)
- Web og Android-app bygges nå fra samme repo, **`sveinsa/Feltkart`**. Repoet `Feltkart_android` brukes ikke lenger.
- Nettsiden publiseres av `deploy.yml` (GitHub Pages). APK-en bygges av `android.yml` og ligger som Release `android-latest`: `https://github.com/sveinsa/Feltkart/releases/download/android-latest/Feltkart.apk`.
- Signeringsnøkkelen (`KEYSTORE_B64`) må legges inn som *Repository secret* i `sveinsa/Feltkart` (ANDROID.md, trinn 2).
- `android.yml` hopper nå over APK-byggingen med en grå melding i stedet for en rød feil hvis nøkkelen mangler, slik at nettsiden aldri påvirkes.

## Readme-knapp (v 6.3)
- Ny knapp **Readme** i menyen til venstre (over «Sjekk ny versjon Feltkart») åpner en egen side i et nytt vindu: oversikt over Feltkart, kom i gang, fanene, filformater, måling og tverrsnitt, Android-appen, tips og **versjonshistorikk** (gruppert på hovedversjon, nyeste først). Siden har logoen og en innholdsliste som ruller til hver del.
- Blokkerer nettleseren vinduet, og i Android-appen, vises den samme siden i en dialog.
- **Vedlikehold:** legg en ny linje øverst i `CHANGELOG` i `src/lib/readme.ts` for hver ny versjon. Resten av siden bygges av `buildReadmeHtml` i samme fil.

## Android-bygget rettet på ordentlig (v 6.4)
- Årsaken til `onGeolocationShowPrompt overrides nothing` var at metoden i Android-SDK-en heter **`onGeolocationPermissionsShowPrompt`**. Navnet i `MainActivity.kt` er rettet. Funksjonen (be om posisjonstillatelse når nettsiden vil bruke `navigator.geolocation`) er den samme.
- Den lokale kompileringssjekken brukte et forenklet Android-bibliotek med samme feil navn, og slapp derfor feilen gjennom. Det er rettet, og det gamle navnet gir nå samme feilmelding som i GitHub.

## Enklere Android-app (v 6.5)
- **Bare «Felt» og «Kart» på øvre linje** i Android-appen. Sidemenyen, Bugreport, prosjektmenyen og «Last opp» er fjernet fra app-visningen (nettsiden er uendret). Appen starter i Felt.
- **Lite kart samtidig med Felt:** kartet vises over Felt på stående skjerm (ca. 30 % av høyden) og til venstre på liggende (ca. 42 % av bredden). Det viser din posisjon (følger deg som standard, knappen ◎ slår av og på) og innmålte punkter som ennå ikke er lagret i prosjektet. «Mål punkt» ligger alltid synlig nederst.
- **Stanghøyde** ligger nå øverst på Innmåling-fanen, ikke under Oppsett. Hurtigvalg 1,500 / 1,800 / 2,000, eget felt (komma eller punktum) og − / + for 1 cm. Linjen under viser regnestykket **antenne − stang = bakke**, og målknappen viser stanghøyden som brukes. Verdier mellom 0 og 10 m godtas. Stanghøyde 0 gir en advarsel, og da får punktene antennens høyde.
- **Snarveier** til Last opp filer, Google Disk, Prosjektinnstillinger, Readme og Sjekk ny versjon ligger under Felt → Oppsett → Mer.
- **Kart** i appen har en «Lag»-knapp i verktøylinjen som åpner kartlagene som et ark nederst.
- Stanghøyden regnes som før: høyde fra mottakeren (evt. ellipsoidehøyde) minus stanghøyde. Hvis Leica Zeno Connect selv er satt opp med antennehøyde, skal stanghøyden her være 0, ellers trekkes den fra to ganger.

## Status øverst, rund målknapp og pling (v 6.6)
- **GNSS-status helt øverst** i Android-appen, over Felt/Kart og kartet: **grønn** når posisjonen er klar til å måle (RTK Fix, og nøyaktigheten er innenfor grensen), **rød** ellers (også uten tilkobling, da blinker prikken). Den vises i både Felt og Kart.
- **«Nøyaktighet»** står i stedet for «anslått». Ved Android-posisjon er nøyaktigheten oppgitt av telefonen, og RTK-statusen er regnet ut fra den. Det står som tips (hold på tallet).
- **Stanghøyden** sitter i samme felt som statusen, med − / + og eget felt, uten hurtigvalg, og med regnestykket antenne − stang = bakke. Den følger med til Kart-visningen.
- **Kartet ligger rett under** statuslinjen og Felt/Kart.
- **Koordinatsystem og geoidemodell** vises sammen i infolinjen, f.eks. «EUREF89 UTM sone 32 · Geoidemodell NN2000». Velg NN2000, NN54 eller Annen under Felt → Oppsett. Valget er bare informasjon, og endrer ikke hvordan høyden regnes. Ved «Ellipsoidehøyde» står det i stedet «Ellipsoidehøyde (ingen geoide)».
- **Målknappen** er rund (88 px), på høyre side, med midten ca. 1/4 opp fra bunnen av skjermen. Faner og skjemafelt går ikke under den. Den vises bare på Innmåling-fanen i Felt.
- **Pling** (to korte toner) når et punkt er registrert. Slås av og på under Felt → Oppsett («Lyd ved registrering»). Lyden lages i appen, uten lydfil, og startes når du trykker på målknappen siden Android bare tillater lyd etter et trykk.

## Readme: korreksjon via Zeno Connect (v 6.7)

Readme-siden (knappen «Readme», også i Android-appen) har fått en ny del, **Korreksjon via Zeno Connect**, med seks figurer og flytskjema:

- hvorfor korreksjon trengs, og hvem som gjør hva (FLX100, Zeno Connect, Android, Feltkart)
- hele kjeden fra satellitt og referansenett til innmålt punkt, i seks nummererte trinn
- kvalitetstrappen GPS, DGPS, Float og Fix, med grensene Feltkart bruker
- koordinater og høyde (ellipsoide, geoide, H = h − N) og stanghøyde, med advarsel mot dobbelt fratrekk
- oppsett i Zeno Connect steg for steg
- feilsøking som flytskjema

Teksten ligger i `src/lib/readmeZeno.ts` (figurene er inline SVG, ingen bildefiler). Beskrivelsen er ikke prøvd mot en ekte FLX100.

## Statuslinje under menyen, Intern GPS og Bluetooth-rettelse (v 6.8)

- GNSS-statuslinjen (grønn/rød, Nøyaktighet og stanghøyde) ligger nå rett under menylinjen med Felt og Kart.
- Ny posisjonskilde **Intern GPS**: Android-appen leser Androids posisjonstjeneste direkte (`LocationManager`, ny fil `LocGnss.kt`). Både telefonens egen GPS og mock-posisjon fra Leica Zeno Connect kommer inn her. Under koordinatene vises **Rå data** (leverandør, mock ja/nei, nøyaktighet Android oppgir). Det gjør det mulig å se hvorfor nøyaktigheten blir ±300 cm når Zeno Connect viser 2 cm.
- **Direkte Bluetooth** feilet på Android 12 og nyere med «Need android.permission.BLUETOOTH_SCAN». Kallet som trengte tillatelsen (`cancelDiscovery`) tåler nå at tillatelsen mangler.
- Direkte Bluetooth gir bare RTK hvis mottakeren selv får korreksjoner. Feltkart har ikke egen NTRIP-klient.
- Kotlin-endringene er ikke kompilert eller prøvd på telefon her; det skjer første gang GitHub bygger APK-en.

## Android-demo på nettsiden, tydeligere kilder og enklere tilbake (v 6.9)

- **Android-app** (mobilikon) i øvre linje på nettsiden åpner `android-demo.html` i nytt vindu: den ekte appen kjører i en tegnet Android-mobil (iframe med `?demo=android`). `src/lib/field/demoBridge.ts` etterlikner Android-broen og lager simulert RTK-posisjon ved Oppdal (først Single og Float, så Fix, med NMEA GGA/GST). Google-innlogging er av i demoen. Punkter og bilder lagres bare i nettleseren.
- Kildene i Felt har forklaring under valget. **Direkte Bluetooth til FLX100** gir full status (Fix/Float, satellitter, korreksjonsalder) når mottakeren får korreksjoner, for eksempel satt opp i Zeno Connect. Feltkart henter ikke korreksjoner selv. Teksten «uten korreksjon» fra 6.8 var misvisende og er fjernet.
- **Tilbake:** i innstillinger vises «Tilbake til Felt». Androids tilbake-knapp går fra Kart og innstillinger til Felt (ellers legges appen i bakgrunnen som før). Opplasting kaster deg ikke lenger over i Kart.
- Kotlin: tilbake-knappen i `MainActivity.kt` er endret (ikke kompilert her).
