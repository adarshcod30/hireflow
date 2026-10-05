import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, query } from '../api';
import { ErrorNote, ScoreBadge, StatusBadge } from '../components/badges';
import { APPLICATION_STATUSES, type ApplicationRow, type ApplicationStatus, type Job, type Page } from '../types';

export function JobApplicationsPage() {
  const { id = '' } = useParams();
  const [status, setStatus] = useState<ApplicationStatus | ''>('');

  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/v1/jobs/${id}`, { auth: true }) });
  const apps = useInfiniteQuery({
    queryKey: ['applications', id, status],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationRow>>(`/v1/jobs/${id}/applications${query({ status, cursor: pageParam, limit: 25 })}`, {
        auth: true,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = apps.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section>
      <p>
        <Link to="/recruiter">Pipeline</Link>
      </p>
      <h1>{job.data?.title ?? 'Applications'}</h1>
      <div className="tabs" role="tablist" aria-label="Filter by status">
        {(['', ...APPLICATION_STATUSES] as const).map((s) => (
          <button
            key={s || 'all'}
            role="tab"
            aria-selected={status === s}
            className={status === s ? 'tab active' : 'tab'}
            onClick={() => setStatus(s)}
          >
            {s || 'all'}
          </button>
        ))}
      </div>

      <ErrorNote error={apps.error} />
      {apps.isPending && <p className="muted">Loading...</p>}
      {!apps.isPending && rows.length === 0 && <p className="empty">No applications here.</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th>Fit</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/recruiter/applications/${a.id}`}>{a.candidateName}</Link>
                    <div className="muted small">{a.candidateEmail}</div>
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td>
                    <ScoreBadge score={a.fitScore} status={a.screeningStatus} />
                  </td>
                  <td className="muted">{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {apps.hasNextPage && (
        <button className="secondary" onClick={() => void apps.fetchNextPage()} disabled={apps.isFetchingNextPage}>
          {apps.isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}
    </section>
  );
}
