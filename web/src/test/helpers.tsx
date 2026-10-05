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
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
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
