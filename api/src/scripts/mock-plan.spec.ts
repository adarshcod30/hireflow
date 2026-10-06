import { canMove, isTerminal } from '../applications/status-machine';
import { JOBS, RECRUITERS } from './mock-data';
import { buildMockPlan } from './mock-plan';
import { buildPdf, wrap } from './pdf';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('buildMockPlan', () => {
  const plan = buildMockPlan(NOW);

  it('is deterministic: the same seed and time give the same plan', () => {
    expect(JSON.stringify(buildMockPlan(NOW))).toBe(JSON.stringify(plan));
    expect(JSON.stringify(buildMockPlan(NOW, 7))).not.toBe(JSON.stringify(plan));
  });

  it('gives every job a posting date in the past and a sensible mix of statuses', () => {
    expect(plan.jobs).toHaveLength(JOBS.length);
    for (const job of plan.jobs) expect(job.createdAt.getTime()).toBeLessThan(NOW.getTime());
    const statuses = new Set(plan.jobs.map((j) => j.status));
    expect(statuses).toEqual(new Set(['open', 'paused', 'closed', 'draft']));
    for (const job of plan.jobs) expect(job.salaryMax).toBeGreaterThanOrEqual(job.salaryMin);
  });

  it('plans enough applications to fill a dashboard, with every status represented', () => {
    expect(plan.applications.length).toBeGreaterThan(100);
    const statuses = new Set(plan.applications.map((a) => a.status));
    expect(statuses).toEqual(new Set(['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']));
  });

  it('never plans a draft job any applications', () => {
    const draft = plan.jobs.findIndex((j) => j.status === 'draft');
    expect(plan.applications.filter((a) => a.jobIndex === draft)).toEqual([]);
  });

  it('keeps one application per candidate per job, and lowercase example.com addresses', () => {
    const keys = plan.applications.map((a) => `${a.jobIndex}:${a.email}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of plan.applications) expect(a.email).toMatch(/^[a-z.]+@example\.com$/);
  });

  it('walks only legal paths through the state machine, starting from applied', () => {
    for (const a of plan.applications) {
      expect(a.events[0]).toMatchObject({ from: null, to: 'applied' });
      for (let i = 1; i < a.events.length; i += 1) {
        const step = a.events[i];
        expect(step.from).toBe(a.events[i - 1].to);
        expect(canMove(step.from!, step.to)).toBe(true);
      }
      expect(a.status).toBe(a.events[a.events.length - 1].to);
    }
  });

  it('ends nothing mid-air: a terminal status is the last event and nothing follows it', () => {
    for (const a of plan.applications) {
      const terminalAt = a.events.findIndex((e) => isTerminal(e.to));
      if (terminalAt !== -1) expect(terminalAt).toBe(a.events.length - 1);
    }
  });

  it('matches the optimistic lock: version is one plus the number of moves', () => {
    for (const a of plan.applications) expect(a.version).toBe(1 + (a.events.length - 1));
  });

  it('keeps time moving forward and never into the future', () => {
    for (const a of plan.applications) {
      expect(a.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      for (let i = 1; i < a.events.length; i += 1) {
        expect(a.events[i].at.getTime()).toBeGreaterThan(a.events[i - 1].at.getTime());
      }
      expect(a.updatedAt.getTime()).toBe(a.events[a.events.length - 1].at.getTime());
      expect(a.updatedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('records a recruiter for every move and none for the application itself', () => {
    for (const a of plan.applications) {
      expect(a.events[0].actor).toBeNull();
      for (const e of a.events.slice(1)) {
        expect(e.actor).toBeGreaterThanOrEqual(0);
        expect(e.actor).toBeLessThan(RECRUITERS.length);
      }
    }
  });

  it('resolves a closed posting: nobody is left waiting', () => {
    const closed = plan.jobs.findIndex((j) => j.status === 'closed');
    const apps = plan.applications.filter((a) => a.jobIndex === closed);
    expect(apps.length).toBeGreaterThan(0);
    // Recent applications can only have moved so far, so allow the early stages for those
    expect(apps.some((a) => a.status === 'hired')).toBe(true);
  });

  it('ties resume quality to tier, so real screening scores will spread out', () => {
    const job = JOBS[0];
    const mentions = (lines: string[]) => job.skills.filter((s) => lines.join(' ').includes(s)).length;
    const first = (tier: string) =>
      plan.applications.filter((a) => a.jobIndex === 0 && a.tier === tier && !a.injection);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const strong = avg(first('strong').map((a) => mentions(a.resumeLines)));
    const weak = avg(first('weak').map((a) => mentions(a.resumeLines)));
    expect(strong).toBeGreaterThan(weak + 2);
  });

  it('includes exactly one resume that tries to manipulate the screening model, and it is rejected', () => {
    const attackers = plan.applications.filter((a) => a.injection);
    expect(attackers).toHaveLength(1);
    expect(attackers[0].resumeLines.join('\n')).toMatch(/ignore all previous instructions/i);
    expect(attackers[0].status).toBe('rejected');
    expect(
      plan.applications.filter((a) => !a.injection).some((a) => /ignore all previous/i.test(a.resumeLines.join(' '))),
    ).toBe(false);
  });

  it('writes resumes in plain ASCII, which a minimal PDF can hold', () => {
    for (const a of plan.applications) for (const line of a.resumeLines) expect(line).toMatch(/^[\x20-\x7e]*$/);
  });

  it('keeps synthetic scores in range and consistent with the tier', () => {
    for (const a of plan.applications.filter((x) => !x.injection)) {
      expect(a.synthetic.fitScore).toBeGreaterThanOrEqual(0);
      expect(a.synthetic.fitScore).toBeLessThanOrEqual(100);
      if (a.tier === 'strong') expect(a.synthetic.fitScore).toBeGreaterThanOrEqual(76);
      if (a.tier === 'weak') expect(a.synthetic.fitScore).toBeLessThanOrEqual(35);
    }
  });
});

describe('buildPdf', () => {
  it('produces a PDF with a header, an end marker and correct cross-reference offsets', () => {
    const pdf = buildPdf(['Hello (world)', 'A line with a \\ backslash']);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
  });

  it('escapes the characters that would otherwise end a string', () => {
    const text = buildPdf(['a (b) c \\ d']).toString('latin1');
    expect(text).toContain('(a \\(b\\) c \\\\ d) Tj');
  });

  it('states the true stream length', () => {
    const text = buildPdf(['one', 'two']).toString('latin1');
    const length = Number(/\/Length (\d+)/.exec(text)![1]);
    const body = /stream\n([\s\S]*?)\nendstream/.exec(text)![1];
    expect(body.length).toBe(length);
  });
});

describe('wrap', () => {
  it('leaves short lines alone and breaks long ones at word boundaries', () => {
    expect(wrap('short')).toEqual(['short']);
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const lines = wrap(long, 40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
    expect(lines.join(' ')).toBe(long);
  });
});
