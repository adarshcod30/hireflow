import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, AlertTriangle, Briefcase, Inbox, Sparkles, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { DailyBars, Funnel, Histogram } from '../../components/charts';
import { Avatar, EmptyState, ErrorNote, ScoreRing, Skeleton, StatusBadge } from '../../components/ui';
import { useAuth } from '../../auth';
import { percentChange, timeAgo } from '../../lib/format';
import type { ApplicationRow, Overview, Page } from '../../types';

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="delta delta-up">New activity</span>;
  if (change === 0) return <span className="faint">No change</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      {up ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}
      {Math.abs(change)}% <span className="faint" style={{ fontWeight: 400 }}>vs the week before</span>
    </span>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/v1/stats/overview', { auth: true }) });
  const recent = useQuery({
    queryKey: ['applications', 'recent'],
    queryFn: () => api<Page<ApplicationRow>>('/v1/applications?limit=6', { auth: true }),
  });

  const o = overview.data;
  const first = user?.fullName.split(' ')[0] ?? '';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Welcome back, {first}</h1>
          <p>Here is where hiring stands today.</p>
        </div>
        <Link to="/recruiter/jobs" className="btn btn-primary">
          <Briefcase size={16} aria-hidden="true" /> Manage jobs
        </Link>
      </header>

      <ErrorNote error={overview.error} />
      {overview.isPending && (
        <div className="kpis" aria-label="Loading">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={116} />
          ))}
        </div>
      )}

      {o && (
        <>
          <section className="kpis" aria-label="Key numbers">
            <div className="kpi">
              <span className="label">
                <Briefcase size={15} aria-hidden="true" /> Open roles
              </span>
              <span className="value">{o.totals.openJobs}</span>
              <span className="sub">{o.totals.jobs} roles in total</span>
            </div>
            <div className="kpi">
              <span className="label">
                <Inbox size={15} aria-hidden="true" /> Applications
              </span>
              <span className="value">{o.totals.applications}</span>
              <span className="sub">across every role</span>
            </div>
            <div className="kpi">
              <span className="label">
                <TrendingUp size={15} aria-hidden="true" /> This week
              </span>
              <span className="value">{o.totals.last7Days}</span>
              <span className="sub">
                <Delta current={o.totals.last7Days} previous={o.totals.previous7Days} />
              </span>
            </div>
            <div className="kpi">
              <span className="label">
                <Sparkles size={15} aria-hidden="true" /> Average fit score
              </span>
              <span className="value">{o.totals.avgFitScore ?? '-'}</span>
              <span className="sub">
                {o.totals.screened} screened
                {o.totals.screeningInFlight > 0 ? `, ${o.totals.screeningInFlight} in progress` : ''}
              </span>
            </div>
            <div className={`kpi ${o.totals.stale > 0 ? 'kpi-attn' : ''}`}>
              <span className="label">
                <AlertTriangle size={15} aria-hidden="true" /> Needs attention
              </span>
              <span className="value">{o.totals.stale}</span>
              <span className="sub">idle for over 7 days</span>
            </div>
          </section>

          <div className="panel-grid">
            <section className="panel span-7" aria-label="Applications per day">
              <div className="panel-head">
                <h2>Applications per day</h2>
                <span className="faint small">Last 14 days</span>
              </div>
              <DailyBars data={o.daily} />
            </section>
            <section className="panel span-5" aria-label="Pipeline">
              <div className="panel-head">
                <h2>Pipeline right now</h2>
                <span className="faint small">Share of all applications</span>
              </div>
              <Funnel byStatus={o.byStatus} />
            </section>
          </div>

          <div className="panel-grid">
            <section className="panel span-4" aria-label="Fit score distribution">
              <div className="panel-head">
                <h2>Fit scores</h2>
                <span className="faint small">{o.totals.screened} screened</span>
              </div>
              <Histogram data={o.scoreDistribution} />
            </section>
            <section className="panel span-4" aria-label="Busiest roles">
              <div className="panel-head">
                <h2>Busiest roles</h2>
              </div>
              {o.topJobs.length === 0 ? (
                <EmptyState title="No applications yet" />
              ) : (
                o.topJobs.map((j) => (
                  <div className="list-row" key={j.id}>
                    <div className="main-text">
                      <Link to={`/recruiter/jobs/${j.id}`}>
                        <strong>{j.title}</strong>
                      </Link>
                      <span className="faint small">
                        {j.applications} applications{j.avgFitScore !== null ? `, average fit ${j.avgFitScore}` : ''}
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
                    <Avatar name={a.candidateName} size={34} />
                    <div className="main-text">
                      <Link to={`/recruiter/applications/${a.id}`}>
                        <strong>{a.candidateName}</strong>
                      </Link>
                      <span className="faint small">
                        {a.jobTitle} · {timeAgo(a.createdAt)}
                      </span>
                    </div>
                  </div>
                  <ScoreRing score={a.fitScore} status={a.screeningStatus} size={36} />
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}
