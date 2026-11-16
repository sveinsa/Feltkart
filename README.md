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
    photos.ts          EXIF og gjenkjenning av 360-bilder
    dxf.ts             DXF → kartgeometri (inkl. blokker, buer, høyder)
    ortho.ts           GeoTIFF → reprojisert bilde (Web Mercator)
    basemaps.ts        Bakgrunnskart
  components/
    MapView.tsx        Leaflet-kartet, markører, DXF-lag, måling
    MeasurePanel.tsx   Målepanel (felles for kart og Terreng 3D)
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
- **Terreng** fra åpne høydedata (Mapterhorn – Norge i 1 m, eller AWS Terrain Tiles globalt). Bakgrunn: Esri, OpenStreetMap, Kartverket eller egen. Overdrivelse av høyder 1–5×.
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
