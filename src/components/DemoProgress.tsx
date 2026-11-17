import { useEffect, useState } from 'react';

/** Kaffekopp med rykende damp */
export function CoffeeCup({ size = 22 }: { size?: number }) {
  return (
    <svg className="coffee" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path className="steam s1" d="M11 9c-1.6-1.6 1.6-3 0-5" />
      <path className="steam s2" d="M16 9c-1.6-1.6 1.6-3 0-5" />
      <path className="steam s3" d="M21 9c-1.6-1.6 1.6-3 0-5" />
      <path d="M6 12h17v7a6 6 0 0 1-6 6h-5a6 6 0 0 1-6-6z" fill="#fff" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M23 14h2a3 3 0 0 1 0 6h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 28h21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Fremdriftsvisning for innlasting av demodata: statuslinje, prosent og klokke. */
export default function DemoProgress({ pct, msg, startedAt }: { pct: number; msg: string; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const p = Math.max(1, Math.min(100, Math.round(pct)));
  return (
    <div className="dp">
      <strong className="dp-title">Laster demodata … kan ta litt tid <CoffeeCup /></strong>
      <div className="dp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
        <div className="dp-fill" style={{ width: `${p}%` }} />
      </div>
      <div className="dp-meta">
        <span>{p} %</span>
        <span>⏱ {fmt(elapsed)} · antatt tid ca. 60 sekunder</span>
      </div>
      {msg && <span className="dp-msg">{msg}</span>}
    </div>
  );
}
