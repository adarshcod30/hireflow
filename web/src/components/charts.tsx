import type { CSSProperties } from 'react';
import { STATUS_LABEL } from '../lib/format';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../types';

const colourOf = (status: ApplicationStatus): CSSProperties => ({ '--c': `var(--s-${status})` }) as CSSProperties;

/** One bar per day. A plain description is attached for screen readers, since the bars carry no text. */
export function DailyBars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="bars" role="img" aria-label={`Applications per day for the last ${data.length} days, ${total} in total`}>
      {data.map((d) => (
        <div className="bar" key={d.date} title={`${d.date}: ${d.count}`}>
          <i style={{ height: `${(d.count / max) * 100}%` }} />
          <span>{new Date(`${d.date}T00:00:00Z`).getUTCDate()}</span>
        </div>
      ))}
    </div>
  );
}

export function Histogram({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bars bars-wide hist-ok" role="img" aria-label={`Fit score distribution: ${data.map((d) => `${d.label}: ${d.count}`).join(', ')}`}>
      {data.map((d) => (
        <div className="bar" key={d.label} title={`${d.label}: ${d.count}`}>
          <b className="small">{d.count}</b>
          <i style={{ height: `${(d.count / max) * 78}%` }} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Where every application sits right now, as a share of all of them. */
export function Funnel({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const total = APPLICATION_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  const max = Math.max(1, ...APPLICATION_STATUSES.map((s) => byStatus[s]));
  return (
    <div className="funnel">
      {APPLICATION_STATUSES.map((status) => (
        <div className="funnel-row" key={status} style={colourOf(status)}>
          <span>{STATUS_LABEL[status]}</span>
          <div className="funnel-track" aria-hidden="true">
            <div className="funnel-fill" style={{ width: `${(byStatus[status] / max) * 100}%` }} />
          </div>
          <b>
            {byStatus[status]}
            <small>{total ? `${Math.round((byStatus[status] / total) * 100)}%` : '0%'}</small>
          </b>
        </div>
      ))}
    </div>
  );
}

/** A thin stacked bar for a table row: how a job's applications split across the active stages. */
export function StageBar({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const stages = APPLICATION_STATUSES;
  const total = stages.reduce((sum, s) => sum + byStatus[s], 0);
  if (total === 0) return <span className="faint small">No applications</span>;
  const summary = stages.filter((s) => byStatus[s] > 0).map((s) => `${byStatus[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ');
  return (
    <div className="stage-bar" role="img" aria-label={summary} title={summary}>
      {stages.map((s) =>
        byStatus[s] > 0 ? <i key={s} style={{ ...colourOf(s), width: `${(byStatus[s] / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}
