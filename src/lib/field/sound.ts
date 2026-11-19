// Liten «pling» når et punkt er registrert. Lagd med Web Audio, så det trengs ingen lydfil.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
  } catch { return null; }
}

/** Kalles når du trykker på målknappen. Nettleseren og Android WebView tillater lyd bare etter et trykk. */
export function primeSound() {
  try { const c = getCtx(); if (c && c.state === 'suspended') void c.resume(); } catch { /* ignorer */ }
}

/** To korte toner, opp en kvint (ca. 0,4 s) */
export function pling() {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') void c.resume();
    const t0 = c.currentTime + 0.01;
    [[988, 0], [1480, 0.11]].forEach(([f, d]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.32);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.35);
    });
  } catch { /* ignorer */ }
}
