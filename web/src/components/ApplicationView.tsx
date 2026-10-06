import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { dateTime, STATUS_LABEL, timeAgo } from '../lib/format';
import type { ApplicationDetail, ApplicationStatus } from '../types';
import { Chips, ErrorNote, Loading, ScoreRing, Skeleton, StatusBadge } from './ui';

const VERB: Record<ApplicationStatus, string> = {
  applied: 'Reset to applied',
  screening: 'Start screening',
  interview: 'Invite to interview',
  offer: 'Make an offer',
  hired: 'Mark as hired',
  rejected: 'Reject',
  withdrawn: 'Mark as withdrawn',
};

/** Everything a recruiter needs to decide about one application. Shown in a drawer and on its own page. */
export function ApplicationView({ id }: { id: string }) {
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
      void qc.invalidateQueries({ queryKey: ['applications'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
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

  if (app.isPending) {
    return (
      <div className="stack">
        <Loading />
        <Skeleton height={120} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (app.error) return <ErrorNote error={app.error} />;
  const a = app.data;

  return (
    <>
      <div className="row">
        <StatusBadge status={a.status} />
        <span className="muted">
          Applied for <strong style={{ color: 'var(--text)', fontWeight: 500 }}>{a.jobTitle}</strong> {timeAgo(a.createdAt)}
        </span>
      </div>

      <section className="panel stack" aria-label="Resume screening">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3 className="panel-title">Resume screening</h3>
          {a.screenedAt && <span className="faint small">Screened {timeAgo(a.screenedAt)}</span>}
        </div>
        <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
          <ScoreRing score={a.fitScore} status={a.screeningStatus} size={68} />
          <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
            {a.screeningSummary ? (
              <p>{a.screeningSummary}</p>
            ) : (
              <p className="muted">
                {a.screeningStatus === 'pending' && 'Waiting for a resume to screen.'}
                {a.screeningStatus === 'processing' && 'The resume is being screened.'}
                {a.screeningStatus === 'failed' && 'The resume could not be screened.'}
              </p>
            )}
            <Chips items={a.extractedSkills} label="Skills found in the resume" />
          </div>
        </div>
        {a.hasResume && (
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => resume.mutate()} disabled={resume.isPending}>
              <Download size={15} aria-hidden="true" /> Download resume
            </button>
          </div>
        )}
        <ErrorNote error={resume.error} />
      </section>

      <section className="panel stack" aria-label="Move forward">
        <h3 className="panel-title">Move forward</h3>
        {a.allowedNext.length === 0 ? (
          <p className="muted">This application has ended, so it cannot move any further.</p>
        ) : (
          <>
            <label className="field">
              <span>Note (optional, saved in the history)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
            <div className="row">
              {a.allowedNext.map((to) => (
                <button
                  key={to}
                  className={`btn btn-sm ${to === 'rejected' || to === 'withdrawn' ? 'btn-danger' : 'btn-secondary'}`}
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
      </section>

      <section aria-label="History">
        <h3 className="panel-title" style={{ marginBottom: 14 }}>
          History
        </h3>
        <ol className="timeline">
          {[...a.history].reverse().map((h) => (
            <li key={h.id} style={{ '--c': `var(--s-${h.to})` } as React.CSSProperties}>
              <strong style={{ fontWeight: 500 }}>
                {h.from ? `${STATUS_LABEL[h.from]} to ${STATUS_LABEL[h.to]}` : STATUS_LABEL[h.to]}
              </strong>
              <div className="when">
                {dateTime(h.at)}
                {h.by ? ` · ${h.by}` : ''}
              </div>
              {h.note && <p className="note">{h.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
