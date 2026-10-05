import type { InternalApi } from '../shared/api-client';
import { metricLine, type Logger } from '../shared/log';
import { escapeHtml } from '../notifier/templates';

interface StaleReport {
  days: number;
  total: number;
  items: { id: string; status: string; jobTitle: string; candidateName: string; daysIdle: number }[];
}

export interface DigestDeps {
  api: InternalApi;
  sendEmail(input: { to: string; subject: string; text: string; html: string }): Promise<void>;
  to: string;
  days: number;
  log: Logger;
  emit(line: string): void;
}

/**
 * Runs on a schedule (EventBridge). Asks the API which open applications nobody
 * has touched for N days, publishes the count as a CloudWatch metric, and emails
 * the team a short list when there is something to chase.
 */
export function createDigestHandler(deps: DigestDeps) {
  return async function handler(): Promise<{ total: number; emailed: boolean }> {
    const report = await deps.api.get<StaleReport>(`/v1/internal/reports/stale-applications?days=${deps.days}`);
    deps.emit(metricLine('HireFlow', 'StaleApplications', report.total));

    if (report.total === 0) {
      deps.log('info', 'no stale applications');
      return { total: 0, emailed: false };
    }

    const lines = report.items.map(
      (i) => `${i.candidateName} for ${i.jobTitle}: ${i.status}, untouched for ${i.daysIdle} days`,
    );
    const more = report.total > lines.length ? [`...and ${report.total - lines.length} more`] : [];
    const text = [
      `${report.total} applications have not moved for ${report.days} days or more:`,
      ...lines,
      ...more,
    ].join('\n');
    const html = `<p>${report.total} applications have not moved for ${report.days} days or more:</p><ul>${[
      ...lines,
      ...more,
    ]
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join('')}</ul>`;

    await deps.sendEmail({
      to: deps.to,
      subject: `HireFlow digest: ${report.total} applications waiting`,
      text,
      html,
    });
    deps.log('info', 'digest sent', { total: report.total });
    return { total: report.total, emailed: true };
  };
}
