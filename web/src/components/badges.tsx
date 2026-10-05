import type { ApplicationStatus, JobStatus, ScreeningStatus } from '../types';

export function StatusBadge({ status }: { status: ApplicationStatus | JobStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function ScoreBadge({ score, status }: { score: number | null; status: ScreeningStatus }) {
  if (status === 'done' && score !== null) {
    const tone = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
    return (
      <span className={`score score-${tone}`} title="Fit score from resume screening">
        {score}
      </span>
    );
  }
  const label: Record<ScreeningStatus, string> = {
    pending: 'No resume yet',
    processing: 'Screening...',
    failed: 'Could not screen',
    done: '',
  };
  return <span className="muted">{label[status]}</span>;
}

export function Skills({ skills }: { skills: string[] }) {
  if (skills.length === 0) return null;
  return (
    <ul className="chips" aria-label="Skills">
      {skills.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; requestId?: string };
  return (
    <p role="alert" className="error">
      {e.message ?? 'Something went wrong.'}
      {e.requestId ? <small> Reference: {e.requestId}</small> : null}
    </p>
  );
}
