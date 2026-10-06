import type { ApplicationStatus, EmploymentType, Job, JobStatus, WorkMode } from '../types';

export const STATUS_LABEL: Record<ApplicationStatus | JobStatus, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  draft: 'Draft',
  open: 'Open',
  paused: 'Paused',
  closed: 'Closed',
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

const PERIOD_SUFFIX = { hour: '/ hr', month: '/ month', year: '/ yr' } as const;

/**
 * "$150K - $210K / yr", "₹18L - ₹28L / yr", "$45 - $70 / hr". Compact notation reads better for
 * large salaries, and rupees follow the lakh convention that Indian candidates expect.
 */
export function formatPay(job: Pick<Job, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period } = job;
  if (min === null && max === null) return null;

  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const compact = period !== 'hour' && Math.max(min ?? 0, max ?? 0) >= 10_000;
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    // Both limits are set on purpose: left alone, currency formatting asks for two decimals and
    // different runtimes disagree about what that means for "$150K"
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  });

  const lo = min === null ? null : money.format(min);
  const hi = max === null ? null : money.format(max);
  const amount = lo && hi ? (min === max ? lo : `${lo} - ${hi}`) : (lo ?? hi);
  return `${amount} ${PERIOD_SUFFIX[period]}`;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/** "Oct 6, 2026", the way job boards print a posting date. */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "3 days ago", "just now". `now` is a parameter so tests do not depend on the clock. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
  }
  return rtf.format(-Math.max(1, Math.floor(seconds / 60)), 'minute');
}

export type ScoreTone = 'high' | 'mid' | 'low';
export const scoreTone = (score: number): ScoreTone => (score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low');

/** Percent change between two counts, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
