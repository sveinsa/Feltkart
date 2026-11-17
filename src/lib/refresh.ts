// «Sjekk ny versjon Feltkart»: samme virkning som Ctrl + Shift + R. Tømmer hurtigbufferen og henter siden på nytt fra nettstedet,
// slik at nyeste versjon (etter at den er publisert på GitHub) tas i bruk. Lagrede data (bilder, målinger, innstillinger) berøres ikke.
const PARAM = '_u';

/** Gir opp å vente på en nettleserfunksjon som aldri svarer (kan skje i enkelte nettlesere og i utradisjonelle omgivelser). */
const within = <T,>(p: Promise<T>, ms = 1500): Promise<T | void> => Promise.race([p, new Promise<void>((r) => window.setTimeout(r, ms))]);

export async function hardRefresh(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await within(navigator.serviceWorker.getRegistrations());
      if (regs) await within(Promise.all(regs.map((r) => r.unregister())));
    }
  } catch { /* ikke tilgjengelig */ }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await within(caches.keys());
      if (keys) await within(Promise.all(keys.map((k) => caches.delete(k))));
    }
  } catch { /* ikke tilgjengelig */ }
  // Et nytt «tall» i adressen tvinger nettleseren til å hente siden fra nettet i stedet for fra hurtigbufferen
  const u = new URL(window.location.href);
  u.searchParams.set(PARAM, String(Date.now()));
  window.location.replace(u.toString());
}

/** Fjerner det midlertidige tallet fra adressen igjen etter oppdatering. */
export function cleanRefreshParam(): void {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(PARAM)) return;
    u.searchParams.delete(PARAM);
    window.history.replaceState(null, '', u.toString());
  } catch { /* ikke kritisk */ }
}
