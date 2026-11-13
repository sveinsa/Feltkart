// Mappen på Google Disk som brukes som demodata. Lastes automatisk når kartet er tomt.
// Mappen må være delt med «alle med lenken» (Leser). Kan overstyres med VITE_DEMO_FOLDER_ID.
export const DEMO_FOLDER_ID: string =
  ((import.meta as any).env?.VITE_DEMO_FOLDER_ID as string | undefined) || '1kzhz4bUFH7Zc96ecQ3kR7I574h4yLAdA';
export const DEMO_FOLDER_URL = `https://drive.google.com/drive/folders/${DEMO_FOLDER_ID}`;

// Google API-nøkkel som brukes til å lese demomappen uten innlogging.
// Lim inn nøkkelen her (den er ikke hemmelig – sikre den med referanse- og API-begrensning i Google Cloud),
// eller sett VITE_GOOGLE_API_KEY (GitHub: Settings → Secrets and variables → Actions → Variables → GOOGLE_API_KEY).
export const DEMO_API_KEY = 'AIzaSyAO0Hn7zqT6YeW-31JdVX-e5dWbuCZ7J_w';
