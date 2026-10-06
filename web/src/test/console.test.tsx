import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../App';
import { setToken } from '../api';
import { ConsoleLayout } from '../layouts/ConsoleLayout';
import { PublicLayout } from '../layouts/PublicLayout';
import { ApplicationPage } from '../pages/console/ApplicationPage';
import { CandidatesPage } from '../pages/console/CandidatesPage';
import { JobBoardPage } from '../pages/console/JobBoardPage';
import { JobsPage } from '../pages/console/JobsPage';
import { OverviewPage } from '../pages/console/OverviewPage';
import { TeamPage } from '../pages/console/TeamPage';
import { LoginPage } from '../pages/LoginPage';
import { ADMIN, detail, job, ME, mockApi, overview, renderWithProviders, Reply, row, zeroStatuses } from './helpers';

const signedIn = (user = ME) => {
  setToken('t');
  return { 'GET /v1/auth/me': user };
};

describe('signing in', () => {
  const guarded = () => (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/recruiter" element={<RequireAuth><p>the console</p></RequireAuth>} />
    </Routes>
  );

  it('rejects a wrong password with the API reason, then signs in and stores the session', async () => {
    mockApi({
      'POST /v1/auth/login': ({ body }: { body: unknown }) =>
        (body as { password: string }).password === 'right-password-1'
          ? { accessToken: 'jwt-token', user: ME }
          : new Reply(401, { message: 'Invalid email or password' }),
    });
    const user = userEvent.setup();
    renderWithProviders(guarded(), { route: '/login' });

    await user.type(screen.getByLabelText('Email'), 'r@x.co');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'right-password-1');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('the console')).toBeInTheDocument();
    expect(sessionStorage.getItem('hireflow.token')).toBe('jwt-token');
  });

  it('sends a visitor who is not signed in to the login page', async () => {
    mockApi({});
    renderWithProviders(guarded(), { route: '/recruiter' });
    expect(await screen.findByRole('heading', { name: 'Recruiter sign in' })).toBeInTheDocument();
    expect(screen.queryByText('the console')).not.toBeInTheDocument();
  });

  it('shows a waiting message while it checks a stored session, then lets the person in', async () => {
    mockApi(signedIn());
    renderWithProviders(guarded(), { route: '/recruiter' });
    expect(screen.getByText('Signing you in...')).toBeInTheDocument();
    expect(await screen.findByText('the console')).toBeInTheDocument();
  });

  it('drops a token the API no longer accepts', async () => {
    setToken('stale');
    mockApi({ 'GET /v1/auth/me': () => new Reply(401, { message: 'Invalid or expired token' }) });
    renderWithProviders(guarded(), { route: '/recruiter' });
    expect(await screen.findByRole('heading', { name: 'Recruiter sign in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('hireflow.token')).toBeNull();
  });

  it('keeps non-admins out of admin pages', async () => {
    mockApi(signedIn());
    renderWithProviders(<Routes><Route path="/" element={<RequireAuth role="admin"><p>admin only</p></RequireAuth>} /></Routes>);
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });

  it('goes straight to the console when already signed in', async () => {
    mockApi(signedIn());
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recruiter" element={<p>the console</p>} />
      </Routes>,
      { route: '/login' },
    );
    expect(await screen.findByText('the console')).toBeInTheDocument();
  });
});

describe('the console shell', () => {
  const shell = () => (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<p>public board</p>} />
      </Route>
      <Route path="/recruiter" element={<RequireAuth><ConsoleLayout /></RequireAuth>}>
        <Route index element={<p>overview page</p>} />
      </Route>
    </Routes>
  );

  it('shows the team link to admins only', async () => {
    mockApi(signedIn(ADMIN));
    const { unmount } = renderWithProviders(shell(), { route: '/recruiter' });
    expect(await screen.findByRole('link', { name: /Team/ })).toHaveAttribute('href', '/recruiter/team');
    expect(screen.getByText('Admin')).toBeInTheDocument();
    unmount();

    mockApi(signedIn(ME));
    renderWithProviders(shell(), { route: '/recruiter' });
    await screen.findByText('Rina Recruiter');
    expect(screen.queryByRole('link', { name: /Team/ })).not.toBeInTheDocument();
    expect(screen.getByText('Recruiter')).toBeInTheDocument();
  });

  it('marks the current page, and signs out to the public board', async () => {
    mockApi(signedIn());
    const user = userEvent.setup();
    renderWithProviders(shell(), { route: '/recruiter' });
    expect(await screen.findByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Jobs/ })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(await screen.findByText('public board')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('hireflow.token')).toBeNull());
    expect(await screen.findByRole('link', { name: 'Recruiter sign in' })).toBeInTheDocument();
  });
});

describe('the theme button in the console', () => {
  const shell = () => (
    <Routes>
      <Route path="/recruiter" element={<RequireAuth><ConsoleLayout /></RequireAuth>}>
        <Route index element={<p>overview page</p>} />
      </Route>
    </Routes>
  );

  it('flips the whole console between light and dark, and says what it will do', async () => {
    localStorage.setItem('hireflow.theme', 'light');
    mockApi(signedIn());
    const user = userEvent.setup();
    renderWithProviders(shell(), { route: '/recruiter' });
    await user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    localStorage.clear();
  });
});

describe('overview', () => {
  const page = () => (
    <Routes>
      <Route path="/recruiter" element={<RequireAuth><OverviewPage /></RequireAuth>} />
    </Routes>
  );
  const recent = { items: [row({ id: 'a1', candidateName: 'Asha Rao' }), row({ id: 'a2', candidateName: 'Ben Lee', fitScore: null, screeningStatus: 'processing' })], nextCursor: null };

  it('greets the person and shows the key numbers with the week-over-week change', async () => {
    mockApi({ ...signedIn(), 'GET /v1/stats/overview': overview(), 'GET /v1/applications': recent });
    renderWithProviders(page(), { route: '/recruiter' });

    expect(await screen.findByRole('heading', { name: 'Welcome back, Rina' })).toBeInTheDocument();
    const kpis = within(await screen.findByRole('region', { name: 'Key numbers' }));
    expect(kpis.getByText('Open roles').closest('.kpi')).toHaveTextContent('4');
    expect(kpis.getByText('Applications').closest('.kpi')).toHaveTextContent('40');
    expect(kpis.getByText('This week').closest('.kpi')).toHaveTextContent('12');
    expect(kpis.getByText('This week').closest('.kpi')).toHaveTextContent('50%'); // 12 against 8
    expect(kpis.getByText('Average fit score').closest('.kpi')).toHaveTextContent('61');
    expect(kpis.getByText('Average fit score').closest('.kpi')).toHaveTextContent('30 screened, 2 in progress');
    expect(kpis.getByText('Needs attention').closest('.kpi')).toHaveClass('kpi-attn');
  });

  it('says it is live, with when the numbers last refreshed', async () => {
    mockApi({ ...signedIn(), 'GET /v1/stats/overview': overview(), 'GET /v1/applications': recent });
    renderWithProviders(page(), { route: '/recruiter' });
    expect(await screen.findByText(/Live, updated just now/)).toBeInTheDocument();
  });

  it('describes a drop, no change and brand new activity in plain words', async () => {
    const totals = (over: Record<string, number | null>) => ({ ...overview().totals, ...over });
    const cases: [Record<string, number | null>, RegExp][] = [
      [{ last7Days: 6, previous7Days: 8 }, /25%/],
      [{ last7Days: 5, previous7Days: 5 }, /No change vs prior week/],
      [{ last7Days: 4, previous7Days: 0 }, /New activity/],
    ];
    for (const [over, expected] of cases) {
      mockApi({ ...signedIn(), 'GET /v1/stats/overview': overview({ totals: totals(over) }), 'GET /v1/applications': recent });
      const { unmount } = renderWithProviders(page(), { route: '/recruiter' });
      const kpi = (await screen.findByText('This week')).closest('.kpi')!;
      expect(kpi).toHaveTextContent(expected);
      unmount();
    }
  });

  it('shows dashes and quiet styling when there is nothing to report yet', async () => {
    const empty = overview({
      totals: { ...overview().totals, applications: 0, avgFitScore: null, stale: 0, screeningInFlight: 0, screened: 0 },
      byStatus: zeroStatuses,
      topJobs: [],
    });
    mockApi({ ...signedIn(), 'GET /v1/stats/overview': empty, 'GET /v1/applications': { items: [], nextCursor: null } });
    renderWithProviders(page(), { route: '/recruiter' });

    const kpis = within(await screen.findByRole('region', { name: 'Key numbers' }));
    expect(kpis.getByText('Average fit score').closest('.kpi')).toHaveTextContent('-');
    expect(kpis.getByText('Needs attention').closest('.kpi')).not.toHaveClass('kpi-attn');
    expect(screen.getByRole('heading', { name: 'No applications yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
  });

  it('lists the busiest roles and the latest applications as links', async () => {
    mockApi({ ...signedIn(), 'GET /v1/stats/overview': overview(), 'GET /v1/applications': recent });
    renderWithProviders(page(), { route: '/recruiter' });

    const busiest = within(await screen.findByRole('region', { name: 'Busiest roles' }));
    expect(busiest.getByRole('link', { name: 'Platform Engineer' })).toHaveAttribute('href', '/recruiter/jobs/job-1');
    expect(busiest.getByText('18 applications, average fit 66')).toBeInTheDocument();

    const latest = within(screen.getByRole('region', { name: 'Recent applications' }));
    expect(await latest.findByRole('link', { name: 'Asha Rao' })).toHaveAttribute('href', '/recruiter/applications/a1');
    expect(latest.getByText('Screening')).toBeInTheDocument(); // the ring explains an unscored one
  });

  it('shows the reason when the numbers cannot load', async () => {
    mockApi({ ...signedIn(), 'GET /v1/stats/overview': () => new Reply(500, { message: 'stats are down' }), 'GET /v1/applications': recent });
    renderWithProviders(page(), { route: '/recruiter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('stats are down');
  });
});

describe('jobs', () => {
  const byStatus = (over: Record<string, number>) => ({ ...zeroStatuses, ...over });
  const pipeline = {
    jobs: [
      { id: 'j1', title: 'Platform Engineer', status: 'open', total: 3, avgFitScore: 71, byStatus: byStatus({ applied: 2, interview: 1 }) },
      { id: 'j2', title: 'Designer', status: 'draft', total: 0, avgFitScore: null, byStatus: byStatus({}) },
      { id: 'j3', title: 'Data Engineer', status: 'paused', total: 1, avgFitScore: 55, byStatus: byStatus({ applied: 1 }) },
      { id: 'j4', title: 'Old Role', status: 'closed', total: 0, avgFitScore: null, byStatus: byStatus({}) },
    ],
  };
  const details = {
    items: [
      job({ id: 'j1', title: 'Platform Engineer', team: 'Core', location: 'Remote, India' }),
      job({ id: 'j2', title: 'Designer', status: 'draft', team: 'Design', salaryMin: null, salaryMax: null }),
      job({ id: 'j3', title: 'Data Engineer', status: 'paused', team: 'Data' }),
      job({ id: 'j4', title: 'Old Role', status: 'closed', team: 'Ops' }),
    ],
    nextCursor: null,
  };
  const routes = () => ({ ...signedIn(), 'GET /v1/stats/pipeline': pipeline, 'GET /v1/jobs': details });
  const page = () => <JobsPage />;

  it('merges the pipeline numbers with the role details, one row per role', async () => {
    mockApi(routes());
    renderWithProviders(page());

    const link = await screen.findByRole('link', { name: 'Platform Engineer' });
    const r = link.closest('tr')!;
    expect(link).toHaveAttribute('href', '/recruiter/jobs/j1');
    expect(r).toHaveTextContent('Core · Remote, India · Remote · Full-time · $90K - $130K / yr');
    expect(within(r).getByText('71')).toBeInTheDocument();
    expect(within(r).getByRole('img', { name: '2 applied, 1 interview' })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Designer' }).closest('tr')!).getByText('No applications')).toBeInTheDocument();
  });

  it('filters by status with counts on the tabs, and by a search', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderWithProviders(page());
    await screen.findByRole('link', { name: 'Platform Engineer' });

    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('4');
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveTextContent('1');
    await user.click(screen.getByRole('tab', { name: /Paused/ }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Data Engineer' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /All/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'design');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Designer' })).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search jobs' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'nothing like this');
    expect(screen.getByRole('heading', { name: 'No jobs match' })).toBeInTheDocument();
  });

  it('offers the one status change that makes sense next, and a separate close', async () => {
    const api = mockApi({ ...routes(), 'PATCH /v1/jobs/j1': { id: 'j1' }, 'PATCH /v1/jobs/j2': { id: 'j2' }, 'PATCH /v1/jobs/j3': { id: 'j3' }, 'PATCH /v1/jobs/j4': { id: 'j4' } });
    const user = userEvent.setup();
    renderWithProviders(page());
    await screen.findByRole('link', { name: 'Platform Engineer' });
    const sent = (id: string) => api.calls.find((c) => c.method === 'PATCH' && c.path === `/v1/jobs/${id}`)?.body;

    await user.click(screen.getByRole('button', { name: 'Publish Designer' }));
    await waitFor(() => expect(sent('j2')).toEqual({ status: 'open' }));
    await user.click(screen.getByRole('button', { name: 'Pause Platform Engineer' }));
    await waitFor(() => expect(sent('j1')).toEqual({ status: 'paused' }));
    await user.click(screen.getByRole('button', { name: 'Resume Data Engineer' }));
    await waitFor(() => expect(sent('j3')).toEqual({ status: 'open' }));
    await user.click(screen.getByRole('button', { name: 'Reopen Old Role' }));
    await waitFor(() => expect(sent('j4')).toEqual({ status: 'open' }));

    api.calls.length = 0;
    await user.click(screen.getByRole('button', { name: 'Close Platform Engineer' }));
    await waitFor(() => expect(sent('j1')).toEqual({ status: 'closed' }));
    expect(screen.queryByRole('button', { name: 'Close Designer' })).not.toBeInTheDocument(); // only open roles can be closed
  });

  it('creates a job with every field, splitting skills and omitting empty pay', async () => {
    const api = mockApi({ ...routes(), 'POST /v1/jobs': { id: 'new' } });
    const user = userEvent.setup();
    renderWithProviders(page());
    await user.click(await screen.findByRole('button', { name: /New job/ }));

    const dialog = within(screen.getByRole('dialog', { name: 'New job' }));
    await user.type(dialog.getByLabelText('Title'), 'Backend Engineer');
    await user.type(dialog.getByLabelText('Team'), 'Platform');
    await user.clear(dialog.getByLabelText('Location'));
    await user.type(dialog.getByLabelText('Location'), 'Pune, India');
    await user.selectOptions(dialog.getByLabelText('Employment type'), 'contract');
    await user.selectOptions(dialog.getByLabelText('Work mode'), 'hybrid');
    await user.type(dialog.getByLabelText('Minimum pay'), '40');
    await user.type(dialog.getByLabelText('Maximum pay'), '90');
    await user.selectOptions(dialog.getByLabelText('Currency'), 'EUR');
    await user.selectOptions(dialog.getByLabelText('Paid'), 'hour');
    await user.type(dialog.getByLabelText('Description'), 'Build reliable services.');
    await user.type(dialog.getByLabelText(/Required skills/), 'PostgreSQL, aws ,');
    await user.click(dialog.getByRole('button', { name: 'Create job' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      title: 'Backend Engineer',
      team: 'Platform',
      location: 'Pune, India',
      description: 'Build reliable services.',
      requiredSkills: ['PostgreSQL', 'aws'],
      employmentType: 'contract',
      workMode: 'hybrid',
      salaryMin: 40,
      salaryMax: 90,
      salaryCurrency: 'EUR',
      salaryPeriod: 'hour',
      status: 'open',
    });
  });

  it('saves a draft when "publish immediately" is switched off, and leaves out pay that was not filled in', async () => {
    const api = mockApi({ ...routes(), 'POST /v1/jobs': { id: 'new' } });
    const user = userEvent.setup();
    renderWithProviders(page());
    await user.click(await screen.findByRole('button', { name: /New job/ }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Title'), 'Quiet Role');
    await user.type(dialog.getByLabelText('Team'), 'Ops');
    await user.type(dialog.getByLabelText('Description'), 'A role without pay yet.');
    await user.click(dialog.getByRole('checkbox', { name: /Publish immediately/ }));
    await user.click(dialog.getByRole('button', { name: 'Create job' }));

    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true));
    const body = api.calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    expect(body.status).toBe('draft');
    expect(body).not.toHaveProperty('salaryMin');
    expect(body).not.toHaveProperty('salaryMax');
  });

  it('refuses a maximum below the minimum before asking the server', async () => {
    const api = mockApi({ ...routes(), 'POST /v1/jobs': { id: 'new' } });
    const user = userEvent.setup();
    renderWithProviders(page());
    await user.click(await screen.findByRole('button', { name: /New job/ }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Title'), 'Backend Engineer');
    await user.type(dialog.getByLabelText('Team'), 'Platform');
    await user.type(dialog.getByLabelText('Description'), 'Build reliable services.');
    await user.type(dialog.getByLabelText('Minimum pay'), '100');
    await user.type(dialog.getByLabelText('Maximum pay'), '50');
    await user.click(dialog.getByRole('button', { name: 'Create job' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('The maximum pay must be at least the minimum.');
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('edits an existing job, starting from its current values and including the status', async () => {
    const api = mockApi({ ...routes(), 'PATCH /v1/jobs/j1': { id: 'j1' } });
    const user = userEvent.setup();
    renderWithProviders(page());
    await user.click(await screen.findByRole('button', { name: 'Edit Platform Engineer' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Edit job' }));
    expect(dialog.getByLabelText('Title')).toHaveValue('Platform Engineer');
    expect(dialog.getByLabelText('Minimum pay')).toHaveValue(90000);
    expect(dialog.getByLabelText('Status')).toHaveValue('open');
    expect(dialog.queryByRole('checkbox', { name: /Publish immediately/ })).not.toBeInTheDocument();

    await user.selectOptions(dialog.getByLabelText('Status'), 'paused');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: 'Platform Engineer', status: 'paused', salaryMin: 90000, salaryMax: 130000 });
  });

  it('shows the server reason inside the dialog and keeps it open', async () => {
    mockApi({ ...routes(), 'POST /v1/jobs': () => new Reply(400, { message: ['title must be longer than or equal to 3 characters'] }) });
    const user = userEvent.setup();
    renderWithProviders(page());
    await user.click(await screen.findByRole('button', { name: /New job/ }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Title'), 'abc');
    await user.type(dialog.getByLabelText('Team'), 'x');
    await user.type(dialog.getByLabelText('Description'), 'long enough text');
    await user.click(dialog.getByRole('button', { name: 'Create job' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('title must be longer');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('invites the first job when there are none', async () => {
    mockApi({ ...signedIn(), 'GET /v1/stats/pipeline': { jobs: [] }, 'GET /v1/jobs': { items: [], nextCursor: null } });
    renderWithProviders(page());
    expect(await screen.findByRole('heading', { name: 'No jobs yet' })).toBeInTheDocument();
  });
});

describe('a role\'s pipeline board', () => {
  const apps = {
    items: [
      row({ id: 'a1', candidateName: 'Asha Rao', status: 'applied', version: 3 }),
      row({ id: 'a2', candidateName: 'Ben Lee', status: 'interview', fitScore: 64 }),
      row({ id: 'a3', candidateName: 'Cleo Park', status: 'hired', fitScore: 90 }),
      row({ id: 'a4', candidateName: 'Dev Shah', status: 'rejected', fitScore: 12 }),
      row({ id: 'a5', candidateName: 'Eli Wu', status: 'applied', fitScore: null, screeningStatus: 'pending', hasResume: false }),
    ],
    nextCursor: null,
  };
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...signedIn(),
    'GET /v1/jobs/job-1': job(),
    'GET /v1/jobs/job-1/applications': apps,
    'GET /v1/applications/a1': detail({ id: 'a1', version: 3 }),
    ...extra,
  });
  const page = () => (
    <Routes>
      <Route path="/recruiter/jobs/:id" element={<JobBoardPage />} />
    </Routes>
  );
  const open = () => renderWithProviders(page(), { route: '/recruiter/jobs/job-1' });
  const lane = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name},`) });

  it('puts each application in the lane for its status, and keeps rejected ones tucked away', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    open();

    expect(await screen.findByRole('heading', { level: 1, name: 'Platform Engineer' })).toBeInTheDocument();
    expect(screen.getByText(/Core · Remote · Remote · Full-time · \$90K - \$130K \/ yr/)).toBeInTheDocument();
    expect(lane('Applied')).toHaveAccessibleName('Applied, 2 applications');
    expect(within(lane('Applied')).getByRole('button', { name: 'Open Asha Rao' })).toBeInTheDocument();
    expect(within(lane('Interview')).getByRole('button', { name: 'Open Ben Lee' })).toBeInTheDocument();
    expect(within(lane('Hired')).getByRole('button', { name: 'Open Cleo Park' })).toBeInTheDocument();
    expect(within(lane('Offer')).getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Rejected,/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show rejected and withdrawn \(1\)/ }));
    expect(within(lane('Rejected')).getByRole('button', { name: 'Open Dev Shah' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Hide rejected and withdrawn/ }));
    expect(screen.queryByRole('region', { name: /^Rejected,/ })).not.toBeInTheDocument();
  });

  it('shows an unscored card honestly, and a resume marker only when there is one', async () => {
    mockApi(routes());
    open();
    const unscored = await screen.findByRole('button', { name: 'Open Eli Wu' });
    expect(within(unscored).getByText('Awaiting resume')).toBeInTheDocument();
    expect(within(unscored).queryByLabelText('Resume on file')).not.toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Open Asha Rao' })).getByLabelText('Resume on file')).toBeInTheDocument();
  });

  it('opens the full application in a side panel, and closes it again', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Open Asha Rao' }));

    const drawer = within(await screen.findByRole('dialog', { name: 'Asha Rao' }));
    expect(await drawer.findByText('Strong SQL and AWS background.')).toBeInTheDocument();
    expect(drawer.getByText('asha@example.com')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves a card to a legal lane when it is dropped there, sending the version it had', async () => {
    const api = mockApi(routes({ 'PATCH /v1/applications/a1/status': detail({ status: 'interview' }) }));
    open();
    const card = await screen.findByRole('button', { name: 'Open Asha Rao' });
    expect(card).toHaveAttribute('draggable', 'true');

    fireEvent.dragStart(card);
    fireEvent.dragOver(lane('Interview'));
    expect(lane('Interview')).toHaveAttribute('data-drop', 'ok');
    expect(lane('Hired')).toHaveAttribute('data-drop', 'no'); // applied cannot jump to hired
    fireEvent.drop(lane('Interview'));

    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ to: 'interview', version: 3 });
  });

  it('refuses a drop on a lane the pipeline does not allow, and drops on the same lane do nothing', async () => {
    const api = mockApi(routes());
    open();
    const card = await screen.findByRole('button', { name: 'Open Asha Rao' });

    fireEvent.dragStart(card);
    fireEvent.dragOver(lane('Hired'));
    fireEvent.drop(lane('Hired'));
    fireEvent.dragEnd(card);
    fireEvent.dragStart(card);
    fireEvent.dragOver(lane('Applied'));
    fireEvent.drop(lane('Applied'));

    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('clears the highlight when a drag leaves a lane, and cards that have ended cannot be dragged', async () => {
    mockApi(routes());
    open();
    const card = await screen.findByRole('button', { name: 'Open Asha Rao' });
    fireEvent.dragStart(card);
    fireEvent.dragOver(lane('Interview'));
    expect(lane('Interview')).toHaveAttribute('data-drop', 'ok');
    fireEvent.dragLeave(lane('Interview'));
    expect(lane('Interview')).not.toHaveAttribute('data-drop');
    expect(screen.getByRole('button', { name: 'Open Cleo Park' })).toHaveAttribute('draggable', 'false');
  });

  it('shows the reason when a move is refused, for example by a colleague moving it first', async () => {
    mockApi(routes({ 'PATCH /v1/applications/a1/status': () => new Reply(409, { message: 'This application was changed by someone else. Reload and try again.' }) }));
    open();
    const card = await screen.findByRole('button', { name: 'Open Asha Rao' });
    fireEvent.dragStart(card);
    fireEvent.dragOver(lane('Screening'));
    fireEvent.drop(lane('Screening'));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else');
  });

  it('switches to a list, where a row opens the same panel', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    open();
    await screen.findByRole('button', { name: 'Open Asha Rao' });
    await user.click(screen.getByRole('tab', { name: /List/ }));

    expect(screen.queryByLabelText('Pipeline board')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6);
    await user.click(screen.getByText('Asha Rao'));
    expect(await screen.findByRole('dialog', { name: 'Asha Rao' })).toBeInTheDocument();
  });

  it('pages further applications in with a cursor', async () => {
    const api = mockApi(routes({
      'GET /v1/jobs/job-1/applications': ({ url }: { url: string }) =>
        new URL(url).searchParams.get('cursor')
          ? { items: [row({ id: 'a9', candidateName: 'Late Arrival' })], nextCursor: null }
          : { items: [row({ id: 'a1', candidateName: 'Asha Rao' })], nextCursor: 'c1' },
    }));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Load more applications' }));
    expect(await screen.findByRole('button', { name: 'Open Late Arrival' })).toBeInTheDocument();
    expect(api.calls.at(-1)?.url).toContain('cursor=c1');
  });

  it('invites sharing the job when nobody has applied', async () => {
    mockApi(routes({ 'GET /v1/jobs/job-1/applications': { items: [], nextCursor: null } }));
    open();
    expect(await screen.findByRole('heading', { name: 'No applications yet' })).toBeInTheDocument();
  });

  it('edits the job from its own page', async () => {
    const api = mockApi(routes({ 'PATCH /v1/jobs/job-1': { id: 'job-1' } }));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Edit job/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edit job' })).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true));
  });
});

describe('candidates', () => {
  const list = (items: unknown[], next: string | null = null) => ({ items, nextCursor: next });
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...signedIn(),
    'GET /v1/jobs': { items: [job({ id: 'job-1', title: 'Platform Engineer' }), job({ id: 'job-2', title: 'Designer' })], nextCursor: null },
    'GET /v1/applications': list([row({ id: 'a1' }), row({ id: 'a2', candidateName: 'Ben Lee', jobTitle: 'Designer', status: 'interview' })]),
    'GET /v1/applications/a1': detail(),
    ...extra,
  });

  it('lists everyone with their role, status and score', async () => {
    mockApi(routes());
    renderWithProviders(<CandidatesPage />);
    const r = (await screen.findByText('Ben Lee')).closest('tr')!;
    expect(r).toHaveTextContent('Designer');
    expect(within(r).getByText('Interview')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('turns each control into a filter the server applies, and clears them all together', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderWithProviders(<CandidatesPage />);
    await screen.findByText('Ben Lee');

    await user.type(screen.getByRole('searchbox', { name: 'Search candidates' }), 'ben');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('q=ben'));
    await user.selectOptions(screen.getByLabelText('Status'), 'interview');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('status=interview'));
    await user.selectOptions(screen.getByLabelText('Role'), 'job-2');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('jobId=job-2'));
    await user.selectOptions(screen.getByLabelText('Fit score'), '70');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('minScore=70'));
    expect(api.calls.at(-1)?.url).toContain('q=ben');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(api.calls.at(-1)?.url).not.toMatch(/q=|status=|jobId=|minScore=/));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('explains an empty result differently when filters are on', async () => {
    mockApi(routes({ 'GET /v1/applications': list([]) }));
    const user = userEvent.setup();
    renderWithProviders(<CandidatesPage />);
    expect(await screen.findByRole('heading', { name: 'No applications yet' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'hired');
    expect(await screen.findByRole('heading', { name: 'No candidates match' })).toBeInTheDocument();
  });

  it('opens a candidate in the side panel and pages with a cursor', async () => {
    const api = mockApi(routes({
      'GET /v1/applications': ({ url }: { url: string }) =>
        new URL(url).searchParams.get('cursor') ? list([row({ id: 'a3', candidateName: 'Next Page' })]) : list([row({ id: 'a1' })], 'c1'),
    }));
    const user = userEvent.setup();
    renderWithProviders(<CandidatesPage />);

    await user.click(await screen.findByText('Asha Rao'));
    expect(await screen.findByRole('dialog', { name: 'Asha Rao' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Next Page')).toBeInTheDocument();
    expect(api.calls.at(-1)?.url).toContain('cursor=c1');
  });

  it('shows the reason when the list cannot load', async () => {
    mockApi(routes({ 'GET /v1/applications': () => new Reply(500, { message: 'database is down' }) }));
    renderWithProviders(<CandidatesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('database is down');
  });
});

describe('one application', () => {
  const page = () => (
    <Routes>
      <Route path="/recruiter/applications/:id" element={<ApplicationPage />} />
      <Route path="/recruiter/jobs/:id" element={<p>the job board</p>} />
    </Routes>
  );
  const open = (route = '/recruiter/applications/app-1') => renderWithProviders(page(), { route });

  it('shows who applied, the screening result and only the moves the pipeline allows', async () => {
    mockApi({ ...signedIn(), 'GET /v1/applications/app-1': detail() });
    open();

    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('asha@example.com')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Fit score 82 out of 100' })).toBeInTheDocument();
    expect(screen.getByText('Strong SQL and AWS background.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Skills found in the resume' })).toHaveTextContent('sql');
    for (const name of ['Start screening', 'Invite to interview', 'Reject', 'Mark as withdrawn']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Mark as hired' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Platform Engineer' })).toHaveAttribute('href', '/recruiter/jobs/job-1');
  });

  it('moves the application, sends the version it saw and the note, and shows the new state', async () => {
    const api = mockApi({
      ...signedIn(),
      'GET /v1/applications/app-1': detail(),
      'PATCH /v1/applications/app-1/status': detail({ status: 'interview', version: 2, allowedNext: ['offer', 'rejected', 'withdrawn'] }),
    });
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText(/Note/), 'Strong portfolio');
    await user.click(screen.getByRole('button', { name: 'Invite to interview' }));

    expect(await screen.findByRole('button', { name: 'Make an offer' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ to: 'interview', version: 1, note: 'Strong portfolio' });
    expect(screen.getByLabelText(/Note/)).toHaveValue(''); // the note was used, so the box is clear
  });

  it('sends no note when the box is blank', async () => {
    const api = mockApi({ ...signedIn(), 'GET /v1/applications/app-1': detail(), 'PATCH /v1/applications/app-1/status': detail({ status: 'screening' }) });
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByLabelText(/Note/), '   ');
    await user.click(screen.getByRole('button', { name: 'Start screening' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ to: 'screening', version: 1 });
  });

  it('when someone else changed it first, explains and reloads the latest state', async () => {
    let reads = 0;
    mockApi({
      ...signedIn(),
      'GET /v1/applications/app-1': () => (reads++ === 0 ? detail() : detail({ status: 'rejected', version: 2, allowedNext: [] })),
      'PATCH /v1/applications/app-1/status': () => new Reply(409, { message: 'This application was changed by someone else. Reload and try again.' }),
    });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Invite to interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else');
    expect(await screen.findByText('This application has ended, so it cannot move any further.')).toBeInTheDocument();
  });

  it('offers a download only when there is a resume, and opens it in a new tab', async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApi({
      ...signedIn(),
      'GET /v1/applications/app-1': detail(),
      'GET /v1/applications/app-1/resume-url': { url: 'https://s3.example/resume.pdf?sig=1' },
    });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Download resume/ }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith('https://s3.example/resume.pdf?sig=1', '_blank', 'noopener,noreferrer'));
  });

  it('shows why a resume could not be downloaded', async () => {
    mockApi({ ...signedIn(), 'GET /v1/applications/app-1': detail(), 'GET /v1/applications/app-1/resume-url': () => new Reply(404, { message: 'No resume has been uploaded' }) });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Download resume/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No resume has been uploaded');
  });

  it.each([
    ['pending', 'Waiting for a resume to screen.', 'Awaiting resume'],
    ['processing', 'The resume is being screened.', 'Screening'],
    ['failed', 'The resume could not be screened.', 'Not screened'],
  ] as const)('says what is happening while screening is %s', async (screeningStatus, sentence, ring) => {
    mockApi({
      ...signedIn(),
      'GET /v1/applications/app-1': detail({ hasResume: false, screeningStatus, fitScore: null, screeningSummary: null, extractedSkills: [], screenedAt: null }),
    });
    open();
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByText(ring)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download resume/ })).not.toBeInTheDocument();
  });

  it('lists the history newest first, with who did it and why', async () => {
    mockApi({
      ...signedIn(),
      'GET /v1/applications/app-1': detail({
        status: 'interview',
        history: [
          { id: '1', from: null, to: 'applied', note: 'Applied', by: null, at: '2030-01-01T09:00:00.000Z' },
          { id: '2', from: 'applied', to: 'interview', note: 'Great portfolio', by: 'Priya Menon', at: '2030-01-02T09:00:00.000Z' },
        ],
      }),
    });
    open();
    const history = within(await screen.findByRole('region', { name: 'History' }));
    const items = history.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Applied to Interview');
    expect(items[0]).toHaveTextContent('Priya Menon');
    expect(items[0]).toHaveTextContent('Great portfolio');
    expect(items[1]).toHaveTextContent('Applied');
  });

  it('shows the reason when the application cannot be found', async () => {
    mockApi({ ...signedIn(), 'GET /v1/applications/nope': () => new Reply(404, { message: 'Application not found' }) });
    open('/recruiter/applications/nope');
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Application not found');
  });
});

describe('team', () => {
  const people = [
    { ...ADMIN, isActive: true },
    { ...ME, isActive: true },
    { id: 'u2', email: 'old@x.co', fullName: 'Olly Old', role: 'recruiter', isActive: false },
  ];

  it('lists people with their role and whether they can sign in', async () => {
    mockApi({ ...signedIn(ADMIN), 'GET /v1/users': people });
    renderWithProviders(<TeamPage />);
    const r = (await screen.findByText('Olly Old')).closest('tr')!;
    expect(within(r).getByText('Deactivated')).toBeInTheDocument();
    expect(within(screen.getByText('Ada Admin').closest('tr')!).getByText('Admin')).toBeInTheDocument();
  });

  it('adds a user in a dialog, defaulting to the recruiter role', async () => {
    const api = mockApi({ ...signedIn(ADMIN), 'GET /v1/users': people, 'POST /v1/users': { id: 'u3' } });
    const user = userEvent.setup();
    renderWithProviders(<TeamPage />);
    await user.click(await screen.findByRole('button', { name: /Add user/ }));

    const dialog = within(screen.getByRole('dialog', { name: 'Add a user' }));
    await user.type(dialog.getByLabelText('Full name'), 'New Person');
    await user.type(dialog.getByLabelText('Email'), 'new@x.co');
    await user.type(dialog.getByLabelText(/Password/), 'a-long-enough-password');
    await user.click(dialog.getByRole('button', { name: 'Add user' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      fullName: 'New Person',
      email: 'new@x.co',
      password: 'a-long-enough-password',
      role: 'recruiter',
    });
  });

  it('can add an admin, and keeps the dialog open with the reason when the server refuses', async () => {
    const api = mockApi({ ...signedIn(ADMIN), 'GET /v1/users': people, 'POST /v1/users': () => new Reply(409, { message: 'Already exists (users_email_key)' }) });
    const user = userEvent.setup();
    renderWithProviders(<TeamPage />);
    await user.click(await screen.findByRole('button', { name: /Add user/ }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Full name'), 'Dup');
    await user.type(dialog.getByLabelText('Email'), 'a@x.co');
    await user.type(dialog.getByLabelText(/Password/), 'a-long-enough-password');
    await user.selectOptions(dialog.getByLabelText('Role'), 'admin');
    await user.click(dialog.getByRole('button', { name: 'Add user' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Already exists');
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ role: 'admin' });
  });

  it('deactivates and reactivates people', async () => {
    const api = mockApi({ ...signedIn(ADMIN), 'GET /v1/users': people, 'PATCH /v1/users/u1/active': { id: 'u1' }, 'PATCH /v1/users/u2/active': { id: 'u2' } });
    const user = userEvent.setup();
    renderWithProviders(<TeamPage />);

    await user.click(await screen.findByRole('button', { name: 'Deactivate Rina Recruiter' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/users/u1/active')?.body).toEqual({ isActive: false }));
    await user.click(screen.getByRole('button', { name: 'Reactivate Olly Old' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/v1/users/u2/active')?.body).toEqual({ isActive: true }));
  });
});
