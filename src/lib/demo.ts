// Mappen på Google Disk som brukes som demodata («Last demodata»).
// Mappen må være delt med «alle med lenken» (Leser). Kan overstyres med VITE_DEMO_FOLDER_ID.
export const DEMO_FOLDER_ID: string =
  ((import.meta as any).env?.VITE_DEMO_FOLDER_ID as string | undefined) || '1kzhz4bUFH7Zc96ecQ3kR7I574h4yLAdA';
export const DEMO_FOLDER_URL = `https://drive.google.com/drive/folders/${DEMO_FOLDER_ID}`;
