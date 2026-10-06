import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { StageBar } from '../../components/charts';
import { JobFormModal } from '../../components/JobFormModal';
import { EmptyState, ErrorNote, Skeleton, StatusBadge } from '../../components/ui';
import { EMPLOYMENT_LABEL, formatPay, shortDate, WORK_MODE_LABEL } from '../../lib/format';
import type { Job, JobStatus, Page, PipelineJob } from '../../types';

type Filter = JobStatus | 'all';
const FILTERS: Filter[] = ['all', 'open', 'draft', 'paused', 'closed'];

/** The one status change that makes sense next, so a row needs a single obvious button. */
const NEXT: Record<JobStatus, { to: JobStatus; label: string } | null> = {
  draft: { to: 'open', label: 'Publish' },
  open: { to: 'paused', label: 'Pause' },
  paused: { to: 'open', label: 'Resume' },
  closed: { to: 'open', label: 'Reopen' },
};

export function JobsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Job | 'new' | null>(null);

  const pipeline = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api<{ jobs: PipelineJob[] }>('/v1/stats/pipeline', { auth: true }),
  });
  const details = useQuery({
    queryKey: ['jobs-all'],
    queryFn: () => api<Page<Job>>('/v1/jobs?limit=100', { auth: true }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api<Job>(`/v1/jobs/${id}`, { method: 'PATCH', auth: true, body: { status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['jobs-all'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const byId = new Map(details.data?.items.map((j) => [j.id, j]));
  const rows = (pipeline.data?.jobs ?? []).filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false;
    return !search.trim() || p.title.toLowerCase().includes(search.trim().toLowerCase());
  });
  const count = (f: Filter) => (pipeline.data?.jobs ?? []).filter((p) => f === 'all' || p.status === f).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>Every role, how many people applied, and where they are.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> New job
        </button>
      </header>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} role="tab" className="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
              <small>{count(f)}</small>
            </button>
          ))}
        </div>
        <label className="input-wrap">
          <span className="sr-only">Search jobs</span>
          <Search size={16} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search jobs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <ErrorNote error={pipeline.error ?? details.error ?? setStatus.error} />
      {pipeline.isPending && <Skeleton height={320} />}
      {pipeline.data && rows.length === 0 && (
        <div className="card">
          <EmptyState title={pipeline.data.jobs.length === 0 ? 'No jobs yet' : 'No jobs match'}>
            {pipeline.data.jobs.length === 0 ? 'Create the first one to start receiving applications.' : 'Try a different filter.'}
          </EmptyState>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th className="num">Applicants</th>
                <th>Where they are</th>
                <th className="num">Avg fit</th>
                <th>Posted</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const d = byId.get(p.id);
                const next = NEXT[p.status];
                const pay = d ? formatPay(d) : null;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link className="table-link" to={`/recruiter/jobs/${p.id}`}>
                        {p.title}
                      </Link>
                      {d && (
                        <div className="faint small">
                          {d.team} · {d.location} · {WORK_MODE_LABEL[d.workMode]} · {EMPLOYMENT_LABEL[d.employmentType]}
                          {pay ? ` · ${pay}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="num">{p.total}</td>
                    <td>
                      <StageBar byStatus={p.byStatus} />
                    </td>
                    <td className="num">{p.avgFitScore ?? '-'}</td>
                    <td className="muted">{d ? shortDate(d.createdAt) : ''}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {next && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setStatus.mutate({ id: p.id, status: next.to })}
                            disabled={setStatus.isPending}
                            aria-label={`${next.label} ${p.title}`}
                          >
                            {next.label}
                          </button>
                        )}
                        {p.status === 'open' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setStatus.mutate({ id: p.id, status: 'closed' })}
                            disabled={setStatus.isPending}
                            aria-label={`Close ${p.title}`}
                          >
                            Close
                          </button>
                        )}
                        {d && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(d)} aria-label={`Edit ${p.title}`}>
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <JobFormModal job={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
