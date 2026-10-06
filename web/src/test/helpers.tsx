import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth';

export type Handler = (init: { body: unknown; headers: Record<string, string>; url: string }) => unknown;

/** The API replies with JSON; a thrown status object becomes an error response. */
export class Reply {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
}

/**
 * Replace fetch with a router keyed by "METHOD /path". Query strings are ignored
 * for matching but handed to the handler, so tests can check what was asked for.
 */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const path = url.pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, url: input, body, headers });

    const route = routes[`${method} ${path}`];
    if (route === undefined) return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
    const result = typeof route === 'function' ? (route as Handler)({ body, headers, url: input }) : route;
    if (result instanceof Reply) {
      return new Response(result.body === null ? null : JSON.stringify(result.body), { status: result.status });
    }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

export const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  title: 'Platform Engineer',
  team: 'Core',
  location: 'Remote',
  description: 'Build and run reliable services.',
  requiredSkills: ['postgresql', 'aws'],
  status: 'open',
  employmentType: 'full_time',
  workMode: 'remote',
  salaryMin: 90000,
  salaryMax: 130000,
  salaryCurrency: 'USD',
  salaryPeriod: 'year',
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
  ...over,
});

export const ME = { id: 'u1', email: 'r@x.co', fullName: 'Rina Recruiter', role: 'recruiter' };
export const ADMIN = { id: 'u0', email: 'a@x.co', fullName: 'Ada Admin', role: 'admin' };

export const row = (over: Record<string, unknown> = {}) => ({
  id: 'app-1',
  status: 'applied',
  version: 1,
  screeningStatus: 'done',
  fitScore: 82,
  hasResume: true,
  candidateName: 'Asha Rao',
  candidateEmail: 'asha@example.com',
  jobId: 'job-1',
  jobTitle: 'Platform Engineer',
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
  ...over,
});

export const detail = (over: Record<string, unknown> = {}) => ({
  ...row(),
  screeningSummary: 'Strong SQL and AWS background.',
  extractedSkills: ['sql', 'aws'],
  screenedAt: '2030-01-01T00:00:00.000Z',
  allowedNext: ['screening', 'interview', 'rejected', 'withdrawn'],
  history: [{ id: '1', from: null, to: 'applied', note: 'Applied', by: null, at: '2030-01-01T00:00:00.000Z' }],
  ...over,
});

export const zeroStatuses = { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 };

export const overview = (over: Record<string, unknown> = {}) => ({
  totals: {
    openJobs: 4,
    jobs: 6,
    applications: 40,
    last7Days: 12,
    previous7Days: 8,
    screened: 30,
    screeningInFlight: 2,
    avgFitScore: 61,
    stale: 5,
  },
  byStatus: { ...zeroStatuses, applied: 20, screening: 10, interview: 6, offer: 2, hired: 1, rejected: 1 },
  daily: Array.from({ length: 14 }, (_, i) => ({ date: `2030-01-${String(i + 1).padStart(2, '0')}`, count: i % 4 })),
  scoreDistribution: [
    { label: '0-19', count: 1 },
    { label: '20-39', count: 5 },
    { label: '40-59', count: 8 },
    { label: '60-79', count: 10 },
    { label: '80-100', count: 6 },
  ],
  topJobs: [{ id: 'job-1', title: 'Platform Engineer', status: 'open', applications: 18, avgFitScore: 66 }],
  ...over,
});

export const ticket = (over: Record<string, unknown> = {}) => ({
  url: 'https://hireflow-resumes.s3.ap-south-1.amazonaws.com/',
  fields: { key: 'resumes/app-1/resume.pdf', 'Content-Type': 'application/pdf', Policy: 'abc', 'X-Amz-Signature': 'sig' },
  key: 'resumes/app-1/resume.pdf',
  maxBytes: 5 * 1024 * 1024,
  expiresInSeconds: 600,
  ...over,
});

export const pdfFile = (name = 'resume.pdf', size = 1000) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });
