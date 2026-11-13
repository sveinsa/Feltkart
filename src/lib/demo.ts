// Mappen på Google Disk som brukes som demodata. Lastes automatisk når kartet er tomt.
// Mappen må være delt med «alle med lenken» (Leser). Kan overstyres med VITE_DEMO_FOLDER_ID.
export const DEMO_FOLDER_ID: string =
  ((import.meta as any).env?.VITE_DEMO_FOLDER_ID as string | undefined) || '1kzhz4bUFH7Zc96ecQ3kR7I574h4yLAdA';
export const DEMO_FOLDER_URL = `https://drive.google.com/drive/folders/${DEMO_FOLDER_ID}`;

// Google API-nøkkel for å lese demomappen uten innlogging legges IKKE i koden (GitHub varsler om nøkler i kildekoden).
// Sett den som variabel i GitHub: Settings → Secrets and variables → Actions → Variables → GOOGLE_API_KEY.
// Deploy-filen sender den inn som VITE_GOOGLE_API_KEY ved bygging. Alternativt: Innstillinger → Google i appen.
export const DEMO_API_KEY = '';
