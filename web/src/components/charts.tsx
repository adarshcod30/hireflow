import type { CSSProperties } from 'react';
import { STATUS_LABEL } from '../lib/format';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../types';

const colourOf = (status: ApplicationStatus): CSSProperties => ({ '--c': `var(--s-${status})` }) as CSSProperties;

/** A smooth path through the points, using a Catmull-Rom spline turned into cubic curves. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Applications per day as a smooth area chart that fills whatever width it is given. The curve is
 * drawn in a stretched viewBox, so text and dots live in plain HTML on top where they stay sharp.
 * A plain description is attached for screen readers, since the drawing carries no text.
 */
export function DailyTrend({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const n = data.length;
  const y = (count: number) => 92 - (count / max) * 78;
  const x = (i: number) => ((i + 0.5) / Math.max(n, 1)) * 100;
  const points: [number, number][] = data.map((d, i) => [x(i), y(d.count)]);
  const line = smoothPath(points);
  const area = n === 0 ? '' : `${line} L${x(n - 1)},100 L${x(0)},100 Z`;

  return (
    <div className="trend" role="img" aria-label={`Applications per day for the last ${n} days, ${total} in total`}>
      <div className="trend-plot">
        <span className="trend-max faint">{max}</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[14, 40, 66, 92].map((line) => (
            <line key={line} className="trend-grid" x1="0" x2="100" y1={line} y2={line} />
          ))}
          {area && <path d={area} fill="url(#trend-fill)" />}
          {line && <path d={line} className="trend-line" />}
        </svg>
        <div className="trend-hits">
          {data.map((d) => (
            <div className="trend-hit" key={d.date} style={{ '--y': `${y(d.count)}%` } as CSSProperties}>
              <i />
              <span className="trend-tip">
                <b>{d.count}</b> {d.count === 1 ? 'application' : 'applications'}
                <small>{dayLabel(d.date)}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="trend-axis" aria-hidden="true">
        {data.map((d) => (
          <span key={d.date}>{new Date(`${d.date}T00:00:00Z`).getUTCDate()}</span>
        ))}
      </div>
    </div>
  );
}

const BAND_TONE = ['low', 'low', 'mid', 'mid', 'high'];

/** How many applications fall in each fit-score band, coloured from red to green. */
export function Histogram({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="hist" role="img" aria-label={`Fit score distribution: ${data.map((d) => `${d.label}: ${d.count}`).join(', ')}`}>
      {data.map((d, i) => (
        <div className={`hist-col tone-${BAND_TONE[Math.min(i, BAND_TONE.length - 1)]}`} key={d.label} title={`${d.label}: ${d.count}`}>
          <b>{d.count}</b>
          <i style={{ height: `calc((100% - 46px) * ${d.count / max})` }} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Where every application sits right now: a ring split by stage, with the total in the middle
 * and a legend that doubles as the text version of the chart.
 */
export function PipelineDonut({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const total = APPLICATION_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 1.2 : 0;
  let offset = 0;

  return (
    <div className="donut">
      <div className="donut-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="donut-track" cx="60" cy="60" r={radius} />
          {total > 0 &&
            APPLICATION_STATUSES.map((status) => {
              const length = (byStatus[status] / total) * circumference;
              if (length === 0) return null;
              const dash = Math.max(length - gap, 0.5);
              const circle = (
                <circle
                  key={status}
                  className="donut-seg"
                  cx="60"
                  cy="60"
                  r={radius}
                  style={colourOf(status)}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += length;
              return circle;
            })}
        </svg>
        <div className="donut-centre">
          <strong>{total}</strong>
          <span>applications</span>
        </div>
      </div>
      <ul className="donut-legend">
        {APPLICATION_STATUSES.map((status) => (
          <li key={status} style={colourOf(status)}>
            <span className="dot" aria-hidden="true" />
            <span className="name">{STATUS_LABEL[status]}</span>
            <b>{byStatus[status]}</b>
            <small>{total ? `${Math.round((byStatus[status] / total) * 100)}%` : '0%'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A tiny trend line for a stat card. Decorative: the number beside it says everything. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const points: [number, number][] = values.map((v, i) => [(i / (values.length - 1)) * 100, 90 - (v / max) * 74]);
  const line = smoothPath(points);
  return (
    <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L100,100 L0,100 Z`} className="spark-area" />
      <path d={line} className="spark-line" />
    </svg>
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
