// Mappen på Google Disk som brukes som demodata. Lastes automatisk når kartet er tomt.
// Mappen må være delt med «alle med lenken» (Leser). Kan overstyres med VITE_DEMO_FOLDER_ID.
export const DEMO_FOLDER_ID: string =
  ((import.meta as any).env?.VITE_DEMO_FOLDER_ID as string | undefined) || '1kzhz4bUFH7Zc96ecQ3kR7I574h4yLAdA';
export const DEMO_FOLDER_URL = `https://drive.google.com/drive/folders/${DEMO_FOLDER_ID}`;

// Google API-nøkkel som leser demomappen uten innlogging. Nøkkelen er begrenset til nettstedet sveinsa.github.io
// og Google Drive/Picker API i Google Cloud. GitHub kan varsle om nøkler i kildekode; for en nøkkel med disse
// begrensningene kan varselet lukkes. Variabelen GOOGLE_API_KEY (GitHub Actions) eller Innstillinger → Google overstyrer denne.
export const DEMO_API_KEY = 'AIzaSyAO0Hn7zqT6YeW-31JdVX-e5dWbuCZ7J_w';
