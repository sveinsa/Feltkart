# Feltkart

Kartløsning for anleggsprosjekter. Du kan samle alt fra byggeplassen i ett kart:

- **Bilder og 360-bilder.** De plasseres automatisk ut fra GPS-en i bildet og vises med hvert sitt ikon: grønn firkant for foto og mørkegrønn «360»-sirkel for 360-bilder.
- **DXF med prosjekterte data.** Du kan slå hvert lag av og på, klikke på et objekt for å se lag, lengde, areal og høyder, og se tekst når du zoomer helt inn.
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

For å prøve DXF-visningen kan du laste opp `eksempeldata/eksempel-veg-utm32.dxf` med koordinatsystem **EUREF89 UTM sone 32**. Den ligger i Trondheim.

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
| Ortofoto | GeoTIFF (`.tif`) | Koordinatsystemet leses fra filen. Store filer bør ha innebygde oversiktsbilder (COG), ellers kan det gå tregt. |

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
    photos.ts          EXIF og gjenkjenning av 360-bilder
    dxf.ts             DXF → kartgeometri (inkl. blokker, buer, høyder)
    ortho.ts           GeoTIFF → reprojisert bilde (Web Mercator)
    basemaps.ts        Bakgrunnskart
  components/
    MapView.tsx        Leaflet-kartet, markører, DXF-lag, måling
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
- **Store droneortofoto** (flere GB) blir for tunge for nettleseren. Bildet lagres med inntil 4096 piksler på lengste side.
- **Bakgrunnskart:** Sjekk vilkårene før offentlig bruk med mye trafikk. OpenStreetMap sine fliser er ikke for produksjon med stor trafikk. Norge i bilder og Kartverket har egne vilkår.

## Veien videre til en løsning for mange brukere

1. **Backend og database.** For eksempel Node (Fastify/NestJS) eller Python (FastAPI), med PostgreSQL + PostGIS. Erstatt `src/lib/db.ts` med kall mot et API. Datamodellen i `types.ts` kan brukes nesten direkte.
2. **Fillagring.** Bruk S3, Cloudflare R2 eller Azure Blob, med opplasting direkte fra nettleseren via forhåndssignerte lenker.
3. **Bakgrunnsjobber:**
   - **Ortofoto:** GDAL gjør om til Cloud Optimized GeoTIFF, som serveres som fliser via TiTiler. Da vises full oppløsning uansett filstørrelse.
   - **DXF:** konverteres til GeoJSON eller vektorfliser (ogr2ogr/tippecanoe) for store tegninger. LandXML-støtte kan legges til.
   - **Bilder:** miniatyrer lages og HEIC gjøres om.
4. **Brukere og tilgang.** Innlogging (Auth.js, Clerk eller Entra ID), prosjekter med medlemmer og roller (les/skriv/admin), og deling av mapper.
5. **Personvern.** Bilder kan vise personer og bilskilt. Tenk på tilgangsstyring, og fjern EXIF-posisjon ved deling utenfor prosjektet.
