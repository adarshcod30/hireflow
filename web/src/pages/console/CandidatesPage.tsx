import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search, UserSearch } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { api, query } from '../../api';
import { ApplicationDrawer } from '../../components/ApplicationDrawer';
import { Avatar, EmptyState, ErrorNote, ScoreRing, Skeleton, StatusBadge } from '../../components/ui';
import { STATUS_LABEL, timeAgo } from '../../lib/format';
import { APPLICATION_STATUSES, type ApplicationRow, type ApplicationStatus, type Job, type Page } from '../../types';

const SCORE_FLOORS = [
  { value: '', label: 'Any score' },
  { value: '50', label: 'Fit 50 or more' },
  { value: '70', label: 'Fit 70 or more' },
  { value: '85', label: 'Fit 85 or more' },
];

export function CandidatesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [jobId, setJobId] = useState('');
  const [minScore, setMinScore] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());

  const jobs = useQuery({ queryKey: ['jobs-all'], queryFn: () => api<Page<Job>>('/v1/jobs?limit=100', { auth: true }) });
  const apps = useInfiniteQuery({
    queryKey: ['applications', 'all', q, status, jobId, minScore],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationRow>>(`/v1/applications${query({ q, status, jobId, minScore, cursor: pageParam, limit: 25 })}`, {
        auth: true,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = apps.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(q || status || jobId || minScore);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Candidates</h1>
          <p>Everyone who has applied, across every role.</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="input-wrap">
          <span className="sr-only">Search candidates</span>
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}>
            <option value="">Any status</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Role</span>
          <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Any role</option>
            {jobs.data?.items.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Fit score</span>
          <select className="select" value={minScore} onChange={(e) => setMinScore(e.target.value)}>
            {SCORE_FLOORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('');
              setStatus('');
              setJobId('');
              setMinScore('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <ErrorNote error={apps.error} />
      {apps.isPending && <Skeleton height={360} />}
      {!apps.isPending && rows.length === 0 && (
        <div className="card">
          <EmptyState icon={<UserSearch size={32} />} title={filtered ? 'No candidates match' : 'No applications yet'}>
            {filtered ? 'Try loosening a filter.' : 'Applications will show up here as people apply.'}
          </EmptyState>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Role</th>
                <th>Status</th>
                <th>Fit</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-click" onClick={() => setOpenId(r.id)}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={r.candidateName} size={36} />
                      <div>
                        <button className="link-btn" style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}>
                          {r.candidateName}
                        </button>
                        <div className="faint small">{r.candidateEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td>{r.jobTitle}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <ScoreRing score={r.fitScore} status={r.screeningStatus} size={38} />
                  </td>
                  <td className="muted">{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {apps.hasNextPage && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => void apps.fetchNextPage()} disabled={apps.isFetchingNextPage}>
            {apps.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}

      {openId && <ApplicationDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
