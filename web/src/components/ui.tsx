import type { CSSProperties, ReactNode } from 'react';
import { initials, scoreTone, STATUS_LABEL } from '../lib/format';
import type { ApplicationStatus, JobStatus, ScreeningStatus } from '../types';

export function StatusBadge({ status }: { status: ApplicationStatus | JobStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** A stable colour per person, so the same candidate always gets the same avatar. */
const hueOf = (name: string): number => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const style = { '--size': `${size}px`, '--hue': hueOf(name) } as CSSProperties;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** A circular fit score. Without a score it says why, instead of showing a misleading zero. */
export function ScoreRing({
  score,
  status = 'done',
  size = 44,
}: {
  score: number | null;
  status?: ScreeningStatus;
  size?: number;
}) {
  if (status !== 'done' || score === null) {
    const label: Record<ScreeningStatus, string> = {
      pending: 'Awaiting resume',
      processing: 'Screening',
      failed: 'Not screened',
      done: '',
    };
    return <span className="score-none">{label[status]}</span>;
  }
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className={`score score-${scoreTone(score)}`}
      style={{ '--size': `${size}px` } as CSSProperties}
      role="img"
      aria-label={`Fit score ${score} out of 100`}
      title="Fit score from resume screening"
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="track" cx="22" cy="22" r={radius} />
        <circle
          className="value"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <b>{score}</b>
    </span>
  );
}

/** Skills as chips. `max` collapses the rest into "+N", the way a job card needs. */
export function Chips({ items, max, label = 'Skills' }: { items: string[]; max?: number; label?: string }) {
  if (items.length === 0) return null;
  const shown = max === undefined ? items : items.slice(0, max);
  const hidden = items.length - shown.length;
  return (
    <ul className="chips" aria-label={label}>
      {shown.map((s) => (
        <li key={s} className="chip">
          {s}
        </li>
      ))}
      {hidden > 0 && <li className="chip">+{hidden}</li>}
    </ul>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; requestId?: string };
  return (
    <p role="alert" className="notice notice-error">
      {e.message ?? 'Something went wrong.'}
      {e.requestId ? <small>Reference: {e.requestId}</small> : null}
    </p>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}...</span>
    </div>
  );
}
