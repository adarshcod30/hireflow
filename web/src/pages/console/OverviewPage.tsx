import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, Inbox, Sparkles, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { DailyBars, Histogram, PipelineDonut, Sparkline } from '../../components/charts';
import { Avatar, EmptyState, ErrorNote, ScoreRing, Skeleton, StatusBadge } from '../../components/ui';
import { percentChange, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import type { ApplicationRow, Overview, Page } from '../../types';

/** How often the numbers refresh on their own while the page is open. */
const REFRESH_MS = 30_000;

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="delta delta-up">New activity</span>;
  if (change === 0) return <span className="faint">No change vs prior week</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      {up ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}
      {Math.abs(change)}% <span className="faint">vs prior week</span>
    </span>
  );
}

function Kpi({
  tone,
  icon,
  label,
  value,
  children,
  spark,
  attention,
}: {
  tone: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children: ReactNode;
  spark?: number[];
  attention?: boolean;
}) {
  return (
    <div className={`kpi tone-${tone} ${attention ? 'kpi-attn' : ''}`}>
      <span className="label">
        <i className="kpi-icon" aria-hidden="true">
          {icon}
        </i>
        {label}
      </span>
      <span className="value">{value}</span>
      <span className="sub">{children}</span>
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const now = useNow();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/v1/stats/overview', { auth: true }),
    refetchInterval: REFRESH_MS,
  });
  const recent = useQuery({
    queryKey: ['applications', 'recent'],
    queryFn: () => api<Page<ApplicationRow>>('/v1/applications?limit=5', { auth: true }),
    refetchInterval: REFRESH_MS,
  });

  const o = overview.data;
  const first = user?.fullName.split(' ')[0] ?? '';
  const topMax = Math.max(1, ...(o?.topJobs.map((j) => j.applications) ?? [1]));
  const updated = overview.dataUpdatedAt ? timeAgo(new Date(overview.dataUpdatedAt).toISOString(), now) : null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Welcome back, {first}</h1>
          <p>Here is where hiring stands today.</p>
        </div>
        <div className="head-actions">
          {updated && (
            <span className="live-pill" title={`Refreshes every ${REFRESH_MS / 1000} seconds`}>
              <i aria-hidden="true" /> Live, updated {updated}
            </span>
          )}
          <Link to="/recruiter/jobs" className="btn btn-primary">
            <Briefcase size={16} aria-hidden="true" /> Manage jobs
          </Link>
        </div>
      </header>

      <ErrorNote error={overview.error} />
      {overview.isPending && (
        <div className="kpis" aria-label="Loading">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={132} />
          ))}
        </div>
      )}

      {o && (
        <>
          <section className="kpis" aria-label="Key numbers">
            <Kpi tone="accent" icon={<Briefcase size={16} />} label="Open roles" value={o.totals.openJobs}>
              {o.totals.jobs} roles in total
            </Kpi>
            <Kpi
              tone="blue"
              icon={<Inbox size={16} />}
              label="Applications"
              value={o.totals.applications}
              spark={o.daily.map((d) => d.count)}
            >
              across every role
            </Kpi>
            <Kpi tone="green" icon={<TrendingUp size={16} />} label="This week" value={o.totals.last7Days}>
              <Delta current={o.totals.last7Days} previous={o.totals.previous7Days} />
            </Kpi>
            <Kpi tone="violet" icon={<Sparkles size={16} />} label="Average fit score" value={o.totals.avgFitScore ?? '-'}>
              {o.totals.screened} screened
              {o.totals.screeningInFlight > 0 ? `, ${o.totals.screeningInFlight} in progress` : ''}
            </Kpi>
            <Kpi tone="amber" icon={<AlertTriangle size={16} />} label="Needs attention" value={o.totals.stale} attention={o.totals.stale > 0}>
              idle for over 7 days
            </Kpi>
          </section>

          <div className="panel-grid">
            <section className="panel span-7" aria-label="Applications per day">
              <div className="panel-head">
                <div>
                  <h2>Applications per day</h2>
                  <span className="faint small">Last {o.daily.length} days</span>
                </div>
                <span className="chip chip-accent">{o.daily.reduce((sum, d) => sum + d.count, 0)} in total</span>
              </div>
              <DailyBars data={o.daily} />
            </section>
            <section className="panel span-5" aria-label="Pipeline">
              <div className="panel-head">
                <div>
                  <h2>Pipeline right now</h2>
                  <span className="faint small">Share of all applications</span>
                </div>
              </div>
              <PipelineDonut byStatus={o.byStatus} />
            </section>
          </div>

          <div className="panel-grid">
            <section className="panel span-4" aria-label="Fit score distribution">
              <div className="panel-head">
                <div>
                  <h2>Fit scores</h2>
                  <span className="faint small">{o.totals.screened} screened</span>
                </div>
              </div>
              <Histogram data={o.scoreDistribution} />
            </section>
            <section className="panel span-4" aria-label="Busiest roles">
              <div className="panel-head">
                <h2>Busiest roles</h2>
                <Link to="/recruiter/jobs" className="small">
                  All jobs
                </Link>
              </div>
              {o.topJobs.length === 0 ? (
                <EmptyState title="No applications yet" />
              ) : (
                o.topJobs.map((j) => (
                  <div className="list-row role-row" key={j.id}>
                    <div className="main-text">
                      <Link to={`/recruiter/jobs/${j.id}`}>
                        <strong>{j.title}</strong>
                      </Link>
                      <span className="faint small">
                        {j.applications} applications{j.avgFitScore !== null ? `, average fit ${j.avgFitScore}` : ''}
                      </span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${(j.applications / topMax) * 100}%` }} />
                      </span>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                ))
              )}
            </section>
            <section className="panel span-4" aria-label="Recent applications">
              <div className="panel-head">
                <h2>Recent applications</h2>
                <Link to="/recruiter/candidates" className="small">
                  View all
                </Link>
              </div>
              {recent.data?.items.length === 0 && <EmptyState title="Nothing yet" />}
              {recent.data?.items.map((a) => (
                <div className="list-row" key={a.id}>
                  <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                    <Avatar name={a.candidateName} size={36} />
                    <div className="main-text">
                      <Link to={`/recruiter/applications/${a.id}`}>
                        <strong>{a.candidateName}</strong>
                      </Link>
                      <span className="faint small">
                        {a.jobTitle} · {timeAgo(a.createdAt, now)}
                      </span>
                    </div>
                  </div>
                  <ScoreRing score={a.fitScore} status={a.screeningStatus} size={38} />
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}
