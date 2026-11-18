# Feltkart for Android (APK)

Android-appen er **den samme Feltkart-løsningen** (samme kart, bilder, prosjektfiler og Google Disk) pakket som en app, pluss feltfunksjoner:

- **RTK-posisjon** fra Leica FLX100 (via Leica Zeno Connect, eller direkte Bluetooth)
- **Ta bilder** som får RTK-posisjonen der du står
- **Innmåling**: mål punkter med kode og stanghøyde, lagres som KOF-fil i prosjektet (og kan også lagres som KOF/CSV i Nedlastinger)
- **Min posisjon** som blå prikk i kartet, med usikkerhetssirkel

APK-en bygges **automatisk av GitHub** hver gang du laster opp endringer. Du trenger ikke Android Studio.

---

## Engangsoppsett (ca. 10 minutter)

### 1. Last opp filene til GitHub
Last opp innholdet i denne mappen til GitHub-repoet ditt, slik du har gjort før (inkludert mappene `android` og `.github`).

### 2. Legg inn signeringsnøkkelen (hemmelighet)
Android krever at alle apper er «signert». Du har fått en fil, **`KEYSTORE_B64.txt`**. Den inneholder nøkkelen din som tekst.

1. Åpne filen `KEYSTORE_B64.txt` i Notisblokk og **kopier hele innholdet** (én lang linje).
2. På GitHub: åpne repoet → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. **Name:** `KEYSTORE_B64` · **Secret:** lim inn teksten → **Add secret**.

> Hold nøkkelen privat. Ikke legg `KEYSTORE_B64.txt` eller `.jks`-filen i repoet. Mister du nøkkelen, kan du ikke oppdatere appen over den gamle (du må avinstallere først).

### 3. La GitHub bygge APK-en
1. Gå til fanen **Actions** → **Bygg Android-app (APK)** → **Run workflow** (eller bare last opp en endring).
2. Vent 5–10 minutter til den får grønn hake.
3. Gå til **Releases** (høyre side av repoet) → **Feltkart for Android** → last ned **`Feltkart.apk`**.
   Fast lenke (bytt ut brukernavn og repo): `https://github.com/BRUKERNAVN/REPO/releases/download/android-latest/Feltkart.apk`
   (Repoet må være offentlig for at lenken skal virke uten innlogging.)

### 4. Installer på telefonen
1. Åpne lenken til `Feltkart.apk` i Chrome på telefonen og last ned filen.
2. Åpne den. Android spør om Chrome får installere apper: velg **Tillat fra denne kilden** og trykk **Installer**.
3. Åpne **Feltkart**. Tillat **posisjon** når Android spør.

Nye versjoner: last ned `Feltkart.apk` på nytt og installer oppå. Data og innstillinger beholdes.

---

## Google Disk i appen (valgfritt, én gang)

Nettsiden din bruker en OAuth-klient av typen «nettapplikasjon». Android-appen trenger en **egen** klient av typen **Android**:

1. [Google Cloud Console](https://console.cloud.google.com/) → ditt prosjekt → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
2. **Application type:** `Android`
3. **Package name:** `no.sveinsa.feltkart`
4. **SHA-1 certificate fingerprint:** `79:81:26:3B:31:D9:14:0A:40:28:42:39:35:E9:14:F8:47:A9:07:E2`
   (Dette er nøkkelen i `KEYSTORE_B64.txt`. Bruker du en annen nøkkel, hent SHA-1 med `keytool -list -v -keystore din.jks`.)
5. Trykk **Create** og kopier **Client ID** (slutter på `.apps.googleusercontent.com`).
6. I appen: **Felt → Oppsett → Android Client ID for Google Disk** → lim inn.
   (Alternativt: legg den som *Variable* `ANDROID_GOOGLE_CLIENT_ID` under Settings → Secrets and variables → Actions → Variables, så ligger den i appen etter neste bygg.)
7. Åpne Google Disk-dialogen i appen og logg inn. Innloggingen åpnes i Chrome og huskes.

Står OAuth-skjermen i «Testing»-modus må din Google-konto ligge under **Test users**, og innloggingen må fornyes ca. hver 7. dag (Googles regel for testmodus).

Mappevelgeren fra Google (Picker) er laget for nettlesere og er **ikke testet i appen**. Bruk gjerne «Last demodata»/synkronisering av prosjektmappen i stedet.

---

## RTK fra Leica FLX100

Leica FLX100 gir RTK-posisjon til andre apper via **Leica Zeno Connect**. Den tar også imot RTK-korreksjoner (NTRIP) og geoidemodell. Det er derfor **anbefalt vei**:

### A) Android-posisjon via Zeno Connect (anbefalt)
1. Parkoble FLX100 i Android (**Innstillinger → Bluetooth**, kode 0000 hvis du blir spurt).
2. Installer **Leica Zeno Connect** fra Google Play. Koble til FLX100 og sett opp RTK/NTRIP-korreksjon og geoidemodell der.
3. Slå på **utviklertilgang** (Innstillinger → Om telefonen → trykk 7 ganger på Build-nummer). Under **Utviklermuligheter → Velg app for falsk posisjon (mock location)** velger du **Zeno Connect**.
4. I Zeno Connect: la posisjonen sendes til Android (Location Service).
5. I Feltkart: **Felt → Kilde: Android-posisjon → Koble til**.

Android-posisjon gir ikke RTK-status direkte. Feltkart **anslår** Fix/Float ut fra oppgitt nøyaktighet (≤ 5 cm = «RTK Fix», ≤ 50 cm = «Float») og merker det som «anslått».

### B) Direkte Bluetooth (NMEA)
1. Parkoble FLX100 i Android som over.
2. **Felt → Kilde: Direkte Bluetooth → Finn enheter → velg FLX100 → Koble til.**
3. Feltkart leser NMEA (GGA, GST) og viser **ekte RTK-status** (Fix/Float), nøyaktighet fra GST, satellitter og korreksjonsalder.

> Denne veien er **ikke prøvd mot en ekte FLX100**. Den forutsetter at mottakeren sender NMEA over seriell Bluetooth (SPP) og at den ikke er opptatt av en annen app. Virker den ikke, bruk A). RTK-korreksjonene må uansett settes opp (Zeno Connect eller annen NTRIP-løsning).

### Høyde
- «Slik mottakeren oppgir den» = høyden fra Zeno Connect/GGA (over geoiden når geoidemodell er valgt i Zeno Connect).
- **Stanghøyde** (standard 2,000 m) trekkes fra høyden. Endres under **Felt → Oppsett**.

---

## Slik bruker du Felt-fanen

1. **Koble til** GNSS (kortet øverst blir grønt ved RTK Fix, gult ved Float).
2. **Innmåling:** skriv/velg kode → **Mål punkt**. Appen tar gjennomsnitt (standard 3 sekunder). Er det ikke RTK Fix, nektes måling (kan slås av under Oppsett, eller du trykker «Mål likevel»).
3. **Punkter** viser alle målte punkter i en tabell. Sorter på **dato**, **kode**, punktnavn eller høyde (trykk på kolonneoverskriften eller bruk «Sortering»), og filtrer på **kode** og **dato** (fra/til).
4. **Koordinatsystem** velges øverst i Punkter (standard er prosjektets). Punktene regnes om og vises i valgt system.
5. **Last ned** gir **KOF, SOSI, LandXML eller CSV** i valgt koordinatsystem, med utvalget og rekkefølgen du har valgt. I appen havner filen i *Nedlastinger/Feltkart*, i nettleseren i nedlastingsmappen på PC-en. SOSI støttes i EUREF89 UTM (sone 31–36); i NTM bruker du KOF eller LandXML.
6. **Lagre i prosjektet** legger de nye punktene inn som KOF-fil i mappen *Innmålinger* (vises i kartet og kan synkroniseres til Google Disk). Punktene blir liggende i tabellen, merket med ✓, til du trykker **Fjern lagrede** eller **Tøm**.
7. **Bilde:** **Ta bilde** åpner kameraet. Bildet får RTK-posisjonen du hadde da du trykket på knappen, og havner i bildemappen.
8. I **Kart** vises din posisjon som blå prikk. Knappen ◎ følger posisjonen.

Punktene ligger trygt i enheten til du fjerner dem. **Felt-fanen (selve målingen) finnes bare i Android-appen.** I nettleseren finnes fanen **Innmåling**, som viser innmålingene i prosjektet (KOF, SOSI, LandXML) med filter, sortering og nedlasting – se README «Innmåling-fanen (v 6.1)».

Hold appen åpen mens du måler (skjermen holdes våken når GNSS er tilkoblet). Trykk «Tilbake» for å legge appen i bakgrunnen uten å miste Bluetooth-forbindelsen.

---

## Feil og løsninger

| Problem | Løsning |
|---|---|
| Actions-jobben feiler på «Hent signeringsnøkkelen» | Hemmeligheten `KEYSTORE_B64` mangler eller er limt feil inn (trinn 2). |
| Actions feiler under «Bygg APK» | Åpne jobben, kopier de siste røde linjene og send dem til meg. |
| «Ingen tilgang til posisjon» | Innstillinger → Apper → Feltkart → Tillatelser → Posisjon → «Tillat». |
| «Finn enheter» viser ingenting | Parkoble FLX100 i Android først. Gi Feltkart tillatelsen «Enheter i nærheten» (Felt → Oppsett → Åpne Android-innstillinger for appen). |
| Google: «Android Client ID mangler» | Se «Google Disk i appen» over. |
| Google avviser innloggingen | Sjekk pakkenavn `no.sveinsa.feltkart` og SHA-1 i Google Cloud, og at kontoen er Test user. |

## Hva er og er ikke testet

- Webdelen (Felt-fanen i appen, NMEA-tolking, KOF, bilde, kart) er testet automatisk med en simulert Android-bro.
- **Selve Android-appen (Kotlin) er ikke kompilert eller kjørt her**, fordi Android-verktøyene ikke finnes i dette arbeidsmiljøet. Første bygg på GitHub kan derfor gi en feilmelding som må rettes.
- Ikke prøvd mot ekte Leica FLX100, ekte Zeno Connect eller ekte Google-innlogging på telefon.
