import { useEffect, useState } from 'react';
import { dismissJob, useJobs, type Job } from '../lib/transfer';
import { CoffeeCup } from './DemoProgress';
import { IconClose } from './icons';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function JobCard({ job, now }: { job: Job; now: number }) {
  const elapsed = Math.max(0, ((job.finishedAt ?? now) - job.startedAt) / 1000);
  const running = job.state === 'running';
  const p = job.pct === null ? null : Math.max(1, Math.min(100, Math.round(job.pct)));
  return (
    <div className={`xfer-card ${job.state}`} role="status" aria-live="polite">
      <div className="xfer-head">
        <strong>{job.state === 'done' ? '✓ ' : job.state === 'error' ? '⚠ ' : ''}{job.title}</strong>
        {running ? <CoffeeCup size={18} /> : <button className="icon-btn" onClick={() => dismissJob(job.id)} aria-label="Lukk"><IconClose size={14} /></button>}
      </div>
      {running && (
        <>
          <div className={`dp-bar${p === null ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ?? undefined}>
            <div className="dp-fill" style={p === null ? undefined : { width: `${p}%` }} />
          </div>
          <div className="dp-meta"><span>{p === null ? 'Jobber …' : `${p} %`}</span><span>⏱ {fmt(elapsed)}</span></div>
          {job.hint && <div className="xfer-hint">{job.hint}</div>}
          {job.msg && <div className="xfer-msg" title={job.msg}>{job.msg}</div>}
        </>
      )}
      {!running && job.detail && <div className={`xfer-msg wrap${job.state === 'error' ? ' error' : ''}`}>{job.detail}</div>}
      {!running && <div className="dp-meta"><span>{job.state === 'done' ? 'Ferdig' : 'Feilet'}</span><span>⏱ {fmt(elapsed)}</span></div>}
    </div>
  );
}

/** Statusfelt for pågående nedlasting og opplasting. Vises øverst til høyre i alle visninger. */
export default function TransferStatus() {
  const jobs = useJobs();
  const [now, setNow] = useState(Date.now());
  const running = jobs.some((j) => j.state === 'running');
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);
  if (!jobs.length) return null;
  return <div className="xfer-stack">{jobs.map((j) => <JobCard key={j.id} job={j} now={now} />)}</div>;
}
