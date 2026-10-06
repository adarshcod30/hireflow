import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, KanbanSquare, List, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, query } from '../../api';
import { ApplicationDrawer } from '../../components/ApplicationDrawer';
import { JobFormModal } from '../../components/JobFormModal';
import { Avatar, EmptyState, ErrorNote, Loading, ScoreRing, StatusBadge } from '../../components/ui';
import { EMPLOYMENT_LABEL, formatPay, STATUS_LABEL, timeAgo, WORK_MODE_LABEL } from '../../lib/format';
import { type ApplicationRow, type ApplicationStatus, type Job, type Page, TRANSITIONS } from '../../types';

const ACTIVE: ApplicationStatus[] = ['applied', 'screening', 'interview', 'offer', 'hired'];
const CLOSED: ApplicationStatus[] = ['rejected', 'withdrawn'];

type View = 'board' | 'list';

export function JobBoardPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('board');
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dragged, setDragged] = useState<ApplicationRow | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);

  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/v1/jobs/${id}`, { auth: true }) });
  const apps = useInfiniteQuery({
    queryKey: ['applications', id],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationRow>>(`/v1/jobs/${id}/applications${query({ cursor: pageParam, limit: 100 })}`, { auth: true }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = apps.data?.pages.flatMap((p) => p.items) ?? [];

  const move = useMutation({
    mutationFn: ({ row, to }: { row: ApplicationRow; to: ApplicationStatus }) =>
      api(`/v1/applications/${row.id}/status`, { method: 'PATCH', auth: true, body: { to, version: row.version } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['applications'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const lanes = showClosed ? [...ACTIVE, ...CLOSED] : ACTIVE;
  const closedCount = rows.filter((r) => CLOSED.includes(r.status)).length;
  const j = job.data;
  const pay = j ? formatPay(j) : null;

  const dropState = (lane: ApplicationStatus): 'ok' | 'no' | undefined => {
    if (!dragged || dragged.status === lane) return undefined;
    if (!TRANSITIONS[dragged.status].includes(lane)) return 'no';
    return over === lane ? 'ok' : undefined;
  };

  return (
    <>
      <Link to="/recruiter/jobs" className="crumb" style={{ marginTop: 0 }}>
        <ArrowLeft size={16} aria-hidden="true" /> Jobs
      </Link>
      <header className="page-head">
        <div>
          <div className="row" style={{ gap: 14 }}>
            <h1>{j?.title ?? 'Applications'}</h1>
            {j && <StatusBadge status={j.status} />}
          </div>
          {j && (
            <p>
              {j.team} · {j.location} · {WORK_MODE_LABEL[j.workMode]} · {EMPLOYMENT_LABEL[j.employmentType]}
              {pay ? ` · ${pay}` : ''}
            </p>
          )}
        </div>
        <div className="row">
          <div className="tabs" role="tablist" aria-label="View">
            <button role="tab" className="tab" aria-selected={view === 'board'} onClick={() => setView('board')}>
              <KanbanSquare size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> Board
            </button>
            <button role="tab" className="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
              <List size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> List
            </button>
          </div>
          {j && (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <Pencil size={15} aria-hidden="true" /> Edit job
            </button>
          )}
        </div>
      </header>

      <ErrorNote error={apps.error ?? move.error} />
      {apps.isPending && <Loading label="Loading applications" />}
      {!apps.isPending && rows.length === 0 && (
        <div className="card">
          <EmptyState title="No applications yet">Share the job link and candidates will appear here.</EmptyState>
        </div>
      )}

      {rows.length > 0 && view === 'board' && (
        <>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <span className="muted small">Drag a card to move it, or open it for the full picture.</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowClosed((s) => !s)} aria-pressed={showClosed}>
              {showClosed ? 'Hide' : 'Show'} rejected and withdrawn ({closedCount})
            </button>
          </div>
          <div className="board" aria-label="Pipeline board">
            {lanes.map((lane) => {
              const cards = rows.filter((r) => r.status === lane);
              return (
                <section
                  key={lane}
                  className="lane"
                  style={{ '--c': `var(--s-${lane})` } as React.CSSProperties}
                  aria-label={`${STATUS_LABEL[lane]}, ${cards.length} ${cards.length === 1 ? 'application' : 'applications'}`}
                  data-drop={dropState(lane)}
                  onDragOver={(e) => {
                    if (dragged && TRANSITIONS[dragged.status].includes(lane)) {
                      e.preventDefault();
                      setOver(lane);
                    }
                  }}
                  onDragLeave={() => setOver((cur) => (cur === lane ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged && TRANSITIONS[dragged.status].includes(lane)) move.mutate({ row: dragged, to: lane });
                    setDragged(null);
                    setOver(null);
                  }}
                >
                  <div className="lane-head">
                    <h3>{STATUS_LABEL[lane]}</h3>
                    <span>{cards.length}</span>
                  </div>
                  {cards.length === 0 && <p className="lane-empty">Nothing here</p>}
                  {cards.map((r) => (
                    <button
                      key={r.id}
                      className="app-card"
                      draggable={TRANSITIONS[r.status].length > 0}
                      data-dragging={dragged?.id === r.id}
                      onDragStart={() => setDragged(r)}
                      onDragEnd={() => {
                        setDragged(null);
                        setOver(null);
                      }}
                      onClick={() => setOpenId(r.id)}
                      aria-label={`Open ${r.candidateName}`}
                    >
                      <span className="top">
                        <Avatar name={r.candidateName} size={32} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <strong>{r.candidateName}</strong>
                          <span className="faint small email">{r.candidateEmail}</span>
                        </span>
                        <ScoreRing score={r.fitScore} status={r.screeningStatus} size={38} />
                      </span>
                      <span className="foot">
                        <span>{timeAgo(r.updatedAt)}</span>
                        {r.hasResume && (
                          <span title="Resume on file">
                            <FileText size={14} aria-label="Resume on file" />
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}

      {rows.length > 0 && view === 'list' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th>Fit</th>
                <th>Last change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-click" onClick={() => setOpenId(r.id)}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={r.candidateName} size={34} />
                      <div>
                        <button className="link-btn" style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}>
                          {r.candidateName}
                        </button>
                        <div className="faint small">{r.candidateEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <ScoreRing score={r.fitScore} status={r.screeningStatus} size={38} />
                  </td>
                  <td className="muted">{timeAgo(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {apps.hasNextPage && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => void apps.fetchNextPage()} disabled={apps.isFetchingNextPage}>
            {apps.isFetchingNextPage ? 'Loading...' : 'Load more applications'}
          </button>
        </div>
      )}

      {openId && <ApplicationDrawer id={openId} onClose={() => setOpenId(null)} />}
      {editing && j && <JobFormModal job={j} onClose={() => setEditing(false)} />}
    </>
  );
}
