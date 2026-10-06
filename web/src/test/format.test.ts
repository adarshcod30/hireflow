import { describe, expect, it } from 'vitest';
import { formatPay, initials, percentChange, scoreTone, shortDate, timeAgo } from '../lib/format';

const pay = (over: Record<string, unknown>) => ({
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: 'USD',
  salaryPeriod: 'year' as const,
  ...over,
});

describe('formatPay', () => {
  it('abbreviates large yearly pay and names the period', () => {
    expect(formatPay(pay({ salaryMin: 150000, salaryMax: 210000 }))).toBe('$150K - $210K / yr');
    expect(formatPay(pay({ salaryMin: 75000, salaryMax: 105000, salaryCurrency: 'EUR' }))).toBe('€75K - €105K / yr');
    expect(formatPay(pay({ salaryMin: 70000, salaryMax: 95000, salaryCurrency: 'GBP' }))).toBe('£70K - £95K / yr');
  });

  it('writes rupees in lakhs, the way Indian candidates read them', () => {
    expect(formatPay(pay({ salaryMin: 1800000, salaryMax: 2800000, salaryCurrency: 'INR' }))).toBe('₹18L - ₹28L / yr');
    expect(formatPay(pay({ salaryMin: 4500000, salaryMax: 7000000, salaryCurrency: 'INR' }))).toBe('₹45L - ₹70L / yr');
  });

  it('keeps hourly rates exact instead of abbreviating them', () => {
    expect(formatPay(pay({ salaryMin: 45, salaryMax: 70, salaryPeriod: 'hour' }))).toBe('$45 - $70 / hr');
  });

  it('handles monthly pay below the abbreviation threshold, and above it', () => {
    expect(formatPay(pay({ salaryMin: 4000, salaryMax: 6000, salaryPeriod: 'month' }))).toBe('$4,000 - $6,000 / month');
    expect(formatPay(pay({ salaryMin: 40000, salaryMax: 60000, salaryCurrency: 'INR', salaryPeriod: 'month' }))).toBe(
      '₹40K - ₹60K / month',
    );
  });

  it('shows one figure when only one end, or both ends equal', () => {
    expect(formatPay(pay({ salaryMin: 90000 }))).toBe('$90K / yr');
    expect(formatPay(pay({ salaryMax: 120000 }))).toBe('$120K / yr');
    expect(formatPay(pay({ salaryMin: 50, salaryMax: 50, salaryPeriod: 'hour' }))).toBe('$50 / hr');
  });

  it('returns nothing when no pay is set, so the card can say so itself', () => {
    expect(formatPay(pay({}))).toBeNull();
  });
});

describe('small helpers', () => {
  it('builds initials from the first two words', () => {
    expect(initials('Asha Rao')).toBe('AR');
    expect(initials('mei lin zhang')).toBe('ML');
    expect(initials('Prince')).toBe('P');
    expect(initials('')).toBe('');
  });

  it('prints a posting date the way job boards do', () => {
    expect(shortDate('2026-10-06T12:00:00Z')).toBe('Oct 6, 2026');
  });

  it('describes elapsed time in the largest sensible unit', () => {
    const now = new Date('2026-10-06T12:00:00Z').getTime();
    const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
    expect(timeAgo(ago(10), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60), now)).toBe('5 minutes ago');
    expect(timeAgo(ago(3 * 3600), now)).toBe('3 hours ago');
    expect(timeAgo(ago(86400), now)).toBe('yesterday');
    expect(timeAgo(ago(3 * 86400), now)).toBe('3 days ago');
    expect(timeAgo(ago(14 * 86400), now)).toBe('2 weeks ago');
    expect(timeAgo(ago(70 * 86400), now)).toBe('2 months ago');
    expect(timeAgo(ago(800 * 86400), now)).toBe('2 years ago');
  });

  it('colours a score by band', () => {
    expect(scoreTone(100)).toBe('high');
    expect(scoreTone(75)).toBe('high');
    expect(scoreTone(74)).toBe('mid');
    expect(scoreTone(50)).toBe('mid');
    expect(scoreTone(49)).toBe('low');
    expect(scoreTone(0)).toBe('low');
  });

  it('computes week over week change, and refuses to divide by zero', () => {
    expect(percentChange(12, 8)).toBe(50);
    expect(percentChange(6, 8)).toBe(-25);
    expect(percentChange(5, 5)).toBe(0);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(4, 0)).toBeNull();
  });
});
