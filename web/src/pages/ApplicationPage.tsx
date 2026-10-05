import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { ErrorNote, ScoreBadge, Skills, StatusBadge } from '../components/badges';
import type { ApplicationDetail, ApplicationStatus } from '../types';

const VERB: Record<ApplicationStatus, string> = {
  applied: 'Reset to applied',
  screening: 'Start screening',
  interview: 'Invite to interview',
  offer: 'Make an offer',
  hired: 'Mark as hired',
  rejected: 'Reject',
  withdrawn: 'Mark as withdrawn',
};

export function ApplicationPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const app = useQuery({
    queryKey: ['application', id],
    queryFn: () => api<ApplicationDetail>(`/v1/applications/${id}`, { auth: true }),
  });

  const move = useMutation({
    mutationFn: (to: ApplicationStatus) =>
      api<ApplicationDetail>(`/v1/applications/${id}/status`, {
        method: 'PATCH',
        auth: true,
        // Sending the version we saw is what lets the server refuse a stale change
        body: { to, version: app.data?.version, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['application', id], updated);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['applications'] });
    },
    // Someone else changed it first: show the latest state instead of the stale one
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void qc.invalidateQueries({ queryKey: ['application', id] });
    },
  });

  const resume = useMutation({
    mutationFn: () => api<{ url: string }>(`/v1/applications/${id}/resume-url`, { auth: true }),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer'),
  });

  if (app.isPending) return <p className="muted">Loading...</p>;
  if (app.error) return <ErrorNote error={app.error} />;
  const a = app.data;

  return (
    <article>
      <p>
        <Link to={`/recruiter/jobs/${a.jobId}`}>Back to {a.jobTitle}</Link>
      </p>
      <h1>{a.candidateName}</h1>
      <p className="muted">
        {a.candidateEmail} · applied for {a.jobTitle}
      </p>
      <p>
        <StatusBadge status={a.status} />
      </p>

      <div className="panel">
        <h2>Resume screening</h2>
        <p>
          <ScoreBadge score={a.fitScore} status={a.screeningStatus} />
        </p>
        {a.screeningSummary && <p className="prose">{a.screeningSummary}</p>}
        <Skills skills={a.extractedSkills} />
        {a.hasResume && (
          <button className="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
            Download resume
          </button>
        )}
        <ErrorNote error={resume.error} />
      </div>

      <div className="panel">
        <h2>Move forward</h2>
        {a.allowedNext.length === 0 ? (
          <p className="muted">This application has ended, so it cannot move any further.</p>
        ) : (
          <>
            <label>
              Note (optional, saved in the history)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
            <div className="row">
              {a.allowedNext.map((to) => (
                <button
                  key={to}
                  className={to === 'rejected' || to === 'withdrawn' ? 'danger' : undefined}
                  onClick={() => move.mutate(to)}
                  disabled={move.isPending}
                >
                  {VERB[to]}
                </button>
              ))}
            </div>
          </>
        )}
        <ErrorNote error={move.error} />
      </div>

      <div className="panel">
        <h2>History</h2>
        <ol className="timeline">
          {a.history.map((h) => (
            <li key={h.id}>
              <strong>{h.from ? `${h.from} to ${h.to}` : h.to}</strong>
              <span className="muted">
                {' '}
                {new Date(h.at).toLocaleString()}
                {h.by ? ` by ${h.by}` : ''}
              </span>
              {h.note && <div>{h.note}</div>}
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
