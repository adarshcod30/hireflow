import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../App';
import { setToken } from '../api';
import { ApplicationPage } from '../pages/ApplicationPage';
import { DashboardPage } from '../pages/DashboardPage';
import { JobApplicationsPage } from '../pages/JobApplicationsPage';
import { LoginPage } from '../pages/LoginPage';
import { UsersPage } from '../pages/UsersPage';
import { mockApi, renderWithProviders, Reply } from './helpers';

const ME = { id: 'u1', email: 'r@x.co', fullName: 'Rina Recruiter', role: 'recruiter' };

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'app-1',
  status: 'applied',
  version: 1,
  screeningStatus: 'done',
  fitScore: 82,
  hasResume: true,
  candidateName: 'Asha Rao',
  candidateEmail: 'asha@example.com',
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
  jobId: 'job-1',
  jobTitle: 'Platform Engineer',
  screeningSummary: 'Strong SQL and AWS background.',
  extractedSkills: ['sql', 'aws'],
  screenedAt: '2030-01-01T00:00:00.000Z',
  allowedNext: ['screening', 'interview', 'rejected', 'withdrawn'],
  history: [{ id: '1', from: null, to: 'applied', note: 'Applied', by: null, at: '2030-01-01T00:00:00.000Z' }],
  ...over,
});

describe('signing in', () => {
  it('signs in, stores the session and goes to the recruiter area', async () => {
    mockApi({
      'POST /v1/auth/login': ({ body }: { body: unknown }) =>
        (body as { password: string }).password === 'right-password-1'
          ? { accessToken: 'jwt-token', user: ME }
          : new Reply(401, { message: 'Invalid email or password' }),
      'GET /v1/stats/pipeline': { jobs: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recruiter" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      </Routes>,
      { route: '/login' },
    );

    await user.type(screen.getByLabelText('Email'), 'r@x.co');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'right-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(sessionStorage.getItem('hireflow.token')).toBe('jwt-token');
  });

  it('sends a visitor who is not signed in to the login page', async () => {
    mockApi({});
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/recruiter" element={<RequireAuth><p>secret</p></RequireAuth>} />
      </Routes>,
      { route: '/recruiter' },
    );
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('restores the session after a reload, and drops a token the API no longer accepts', async () => {
    setToken('stale');
    mockApi({ 'GET /v1/auth/me': () => new Reply(401, { message: 'Invalid or expired token' }) });
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/recruiter" element={<RequireAuth><p>secret</p></RequireAuth>} />
      </Routes>,
      { route: '/recruiter' },
    );
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(sessionStorage.getItem('hireflow.token')).toBeNull();
  });

  it('keeps non-admins out of admin pages', async () => {
    setToken('t');
    mockApi({ 'GET /v1/auth/me': ME });
    renderWithProviders(<Routes><Route path="/" element={<RequireAuth role="admin"><p>admin only</p></RequireAuth>} /></Routes>);
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });
});

describe('pipeline dashboard', () => {
  const stats = {
    jobs: [
      { id: 'j1', title: 'Platform Engineer', status: 'open', total: 3, avgFitScore: 71, byStatus: { applied: 2, screening: 0, interview: 1, offer: 0, hired: 0, rejected: 0, withdrawn: 0 } },
      { id: 'j2', title: 'Designer', status: 'draft', total: 0, avgFitScore: null, byStatus: { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 } },
    ],
  };

  it('shows counts per stage and lets a recruiter publish or close a job', async () => {
    setToken('t');
    const api = mockApi({ 'GET /v1/stats/pipeline': stats, 'PATCH /v1/jobs/j2': { id: 'j2' }, 'PATCH /v1/jobs/j1': { id: 'j1' } });
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    const row = (await screen.findByRole('link', { name: 'Platform Engineer' })).closest('tr')!;
    expect(within(row).getByText('71')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Designer' }).closest('tr')!).getByText('-')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/jobs/j2')?.body).toEqual({ status: 'open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/jobs/j1')?.body).toEqual({ status: 'closed' }));
  });

  it('creates a job with skills split into a list', async () => {
    setToken('t');
    const api = mockApi({ 'GET /v1/stats/pipeline': { jobs: [] }, 'POST /v1/jobs': { id: 'new' } });
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    await user.type(await screen.findByLabelText('Title'), 'Backend Engineer');
    await user.type(screen.getByLabelText('Team'), 'Platform');
    await user.type(screen.getByLabelText('Description'), 'Build reliable services.');
    await user.type(screen.getByLabelText(/Required skills/), 'PostgreSQL, aws ,');
    await user.click(screen.getByRole('button', { name: 'Create job' }));

    expect(await screen.findByText('Job created.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      title: 'Backend Engineer',
      team: 'Platform',
      description: 'Build reliable services.',
      requiredSkills: ['PostgreSQL', 'aws'],
      status: 'open',
    });
  });
});

describe('applications list', () => {
  it('filters by status and pages through results', async () => {
    setToken('t');
    const row = (id: string, name: string) => ({
      id, status: 'applied', version: 1, screeningStatus: 'done', fitScore: 90, hasResume: true,
      candidateName: name, candidateEmail: `${name}@x.co`, createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
    });
    const api = mockApi({
      'GET /v1/jobs/job-1': { id: 'job-1', title: 'Platform Engineer' },
      'GET /v1/jobs/job-1/applications': ({ url }: { url: string }) => {
        const sp = new URL(url).searchParams;
        if (sp.get('status') === 'interview') return { items: [row('a3', 'Cleo')], nextCursor: null };
        return sp.get('cursor') ? { items: [row('a2', 'Ben')], nextCursor: null } : { items: [row('a1', 'Asha')], nextCursor: 'c1' };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Routes><Route path="/r/:id" element={<JobApplicationsPage />} /></Routes>, { route: '/r/job-1' });

    expect(await screen.findByRole('link', { name: 'Asha' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Ben' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'interview' }));
    expect(await screen.findByRole('link', { name: 'Cleo' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Asha' })).not.toBeInTheDocument();
    expect(api.calls.at(-1)?.url).toContain('status=interview');
  });
});

describe('application detail', () => {
  const page = () => (
    <Routes>
      <Route path="/a/:id" element={<ApplicationPage />} />
      <Route path="*" element={<p>elsewhere</p>} />
    </Routes>
  );

  it('shows the screening result and only the moves the pipeline allows', async () => {
    setToken('t');
    mockApi({ 'GET /v1/applications/app-1': detail() });
    renderWithProviders(page(), { route: '/a/app-1' });

    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Strong SQL and AWS background.')).toBeInTheDocument();
    for (const name of ['Start screening', 'Invite to interview', 'Reject', 'Mark as withdrawn']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Mark as hired' })).not.toBeInTheDocument();
  });

  it('moves the application, sends the version it saw and the note, and shows the new state', async () => {
    setToken('t');
    const api = mockApi({
      'GET /v1/applications/app-1': detail(),
      'PATCH /v1/applications/app-1/status': detail({ status: 'interview', version: 2, allowedNext: ['offer', 'rejected', 'withdrawn'] }),
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/a/app-1' });

    await user.type(await screen.findByLabelText(/Note/), 'Strong portfolio');
    await user.click(screen.getByRole('button', { name: 'Invite to interview' }));

    expect(await screen.findByRole('button', { name: 'Make an offer' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ to: 'interview', version: 1, note: 'Strong portfolio' });
  });

  it('when someone else changed it first, explains and reloads the latest state', async () => {
    setToken('t');
    let reads = 0;
    mockApi({
      'GET /v1/applications/app-1': () => (reads++ === 0 ? detail() : detail({ status: 'rejected', version: 2, allowedNext: [] })),
      'PATCH /v1/applications/app-1/status': () => new Reply(409, { message: 'This application was changed by someone else. Reload and try again.' }),
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/a/app-1' });

    await user.click(await screen.findByRole('button', { name: 'Invite to interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else');
    expect(await screen.findByText('This application has ended, so it cannot move any further.')).toBeInTheDocument();
  });

  it('offers a download only when there is a resume, and opens it in a new tab', async () => {
    setToken('t');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApi({
      'GET /v1/applications/app-1': detail(),
      'GET /v1/applications/app-1/resume-url': { url: 'https://s3.example/resume.pdf?sig=1' },
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/a/app-1' });
    await user.click(await screen.findByRole('button', { name: 'Download resume' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://s3.example/resume.pdf?sig=1', '_blank', 'noopener,noreferrer'));
  });

  it('shows no download button before a resume exists', async () => {
    setToken('t');
    mockApi({ 'GET /v1/applications/app-1': detail({ hasResume: false, screeningStatus: 'pending', fitScore: null }) });
    renderWithProviders(page(), { route: '/a/app-1' });
    expect(await screen.findByText('No resume yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download resume' })).not.toBeInTheDocument();
  });
});

describe('users page', () => {
  it('lists users, adds one and toggles access', async () => {
    setToken('t');
    const api = mockApi({
      'GET /v1/users': [{ ...ME, isActive: true }],
      'POST /v1/users': { id: 'u2' },
      'PATCH /v1/users/u1/active': { id: 'u1' },
    });
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);

    expect(await screen.findByText('Rina Recruiter')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Full name'), 'New Person');
    await user.type(screen.getByLabelText('Email'), 'new@x.co');
    await user.type(screen.getByLabelText(/Password/), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/users' && c.method === 'POST')?.body).toMatchObject({ role: 'recruiter', email: 'new@x.co' }));

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/users/u1/active')?.body).toEqual({ isActive: false }));
  });
});
