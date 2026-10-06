import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { setToken } from '../api';
import { PublicLayout } from '../layouts/PublicLayout';
import { JobPage } from '../pages/public/JobPage';
import { OpportunitiesPage } from '../pages/public/OpportunitiesPage';
import { ADMIN, job, mockApi, pdfFile, renderWithProviders, Reply, ticket } from './helpers';

const board = () => (
  <Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<OpportunitiesPage />} />
      <Route path="jobs/:id" element={<JobPage />} />
    </Route>
    <Route path="/login" element={<p>login page</p>} />
    <Route path="/recruiter" element={<p>console</p>} />
  </Routes>
);

describe('the job board', () => {
  it('shows each role with its pay, contract and skills, collapsing extra skills into a count', async () => {
    mockApi({
      'GET /v1/public/jobs': {
        items: [
          job({
            id: 'j1',
            title: 'Platform Engineer',
            requiredSkills: ['postgresql', 'aws', 'typescript', 'sqs', 'lambda'],
            salaryMin: 150000,
            salaryMax: 210000,
          }),
          job({ id: 'j2', title: 'Designer', salaryMin: null, salaryMax: null, employmentType: 'contract', workMode: 'hybrid' }),
        ],
        nextCursor: null,
      },
    });
    renderWithProviders(board());

    const first = (await screen.findByRole('heading', { name: 'Platform Engineer' })).closest('a')!;
    expect(first).toHaveAttribute('href', '/jobs/j1');
    expect(within(first).getByText('$150K - $210K / yr')).toBeInTheDocument();
    expect(within(first).getByText('Full-time · Remote')).toBeInTheDocument();
    expect(within(first).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['postgresql', 'aws', 'typescript', '+2']);

    const second = screen.getByRole('heading', { name: 'Designer' }).closest('a')!;
    expect(within(second).getByText('Pay on request')).toBeInTheDocument();
    expect(within(second).getByText('Contract · Hybrid')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('2 roles found');
  });

  it('searches as you type, and asks the server for work mode and employment type', async () => {
    const api = mockApi({ 'GET /v1/public/jobs': { items: [job()], nextCursor: null } });
    const user = userEvent.setup();
    renderWithProviders(board());
    await screen.findByRole('heading', { name: 'Platform Engineer' });

    await user.type(screen.getByRole('searchbox', { name: 'Search roles' }), 'postgres');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('q=postgres'));

    await user.click(within(screen.getByRole('group', { name: 'Work mode' })).getByRole('button', { name: 'Remote' }));
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('workMode=remote'));
    await user.click(within(screen.getByRole('group', { name: 'Employment type' })).getByRole('button', { name: 'Contract' }));
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('employmentType=contract'));
    expect(api.calls.at(-1)?.url).toContain('workMode=remote');
  });

  it('marks the active filter, and clicking it again or "All" clears it', async () => {
    const api = mockApi({ 'GET /v1/public/jobs': { items: [job()], nextCursor: null } });
    const user = userEvent.setup();
    renderWithProviders(board());
    await screen.findByRole('heading', { name: 'Platform Engineer' });

    const group = screen.getByRole('group', { name: 'Work mode' });
    const hybrid = within(group).getByRole('button', { name: 'Hybrid' });
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(hybrid);
    expect(hybrid).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain('workMode=hybrid'));

    await user.click(hybrid);
    expect(hybrid).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(api.calls.at(-1)?.url).not.toContain('workMode'));

    await user.click(hybrid);
    await user.click(within(group).getByRole('button', { name: 'All' }));
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('pages with a cursor and marks the count as a lower bound while more remain', async () => {
    const api = mockApi({
      'GET /v1/public/jobs': ({ url }: { url: string }) =>
        new URL(url).searchParams.get('cursor')
          ? { items: [job({ id: 'j2', title: 'Second page role' })], nextCursor: null }
          : { items: [job({ id: 'j1', title: 'First page role' })], nextCursor: 'c1' },
    });
    const user = userEvent.setup();
    renderWithProviders(board());

    expect(await screen.findByRole('status')).toHaveTextContent('1+ role found');
    await user.click(screen.getByRole('button', { name: 'Load more roles' }));
    expect(await screen.findByRole('heading', { name: 'Second page role' })).toBeInTheDocument();
    expect(api.calls.at(-1)?.url).toContain('cursor=c1');
    expect(screen.queryByRole('button', { name: 'Load more roles' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 roles found');
  });

  it('explains an empty result differently when filtering than when there is nothing at all', async () => {
    mockApi({ 'GET /v1/public/jobs': { items: [], nextCursor: null } });
    const user = userEvent.setup();
    renderWithProviders(board());
    expect(await screen.findByRole('heading', { name: 'No open roles right now' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search roles' }), 'zzz');
    expect(await screen.findByRole('heading', { name: 'No open roles match that search' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No roles found');
  });

  it('shows the reason when the board cannot load', async () => {
    mockApi({ 'GET /v1/public/jobs': () => new Reply(500, { message: 'The API is down', requestId: 'req-1' }) });
    renderWithProviders(board());
    expect(await screen.findByRole('alert')).toHaveTextContent('The API is down');
  });
});

describe('the site header', () => {
  it('offers recruiter sign in to visitors, and the console to people who are signed in', async () => {
    mockApi({ 'GET /v1/public/jobs': { items: [], nextCursor: null } });
    const { unmount } = renderWithProviders(board());
    expect(await screen.findByRole('link', { name: 'Recruiter sign in' })).toHaveAttribute('href', '/login');
    unmount();

    setToken('t');
    mockApi({ 'GET /v1/public/jobs': { items: [], nextCursor: null }, 'GET /v1/auth/me': ADMIN });
    renderWithProviders(board());
    expect(await screen.findByRole('link', { name: /Open console/ })).toHaveAttribute('href', '/recruiter');
  });

  it('lets keyboard users skip past the header', async () => {
    mockApi({ 'GET /v1/public/jobs': { items: [], nextCursor: null } });
    renderWithProviders(board());
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).not.toBeNull();
  });
});

const page = () => (
  <Routes>
    <Route path="/jobs/:id" element={<JobPage />} />
    <Route path="/" element={<p>the board</p>} />
  </Routes>
);

async function fillAndApply(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Full name'), 'Asha Rao');
  await user.type(screen.getByLabelText('Email'), 'asha@example.com');
  await user.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('a single role', () => {
  it('shows the details, the pay and the skills, with a way back', async () => {
    mockApi({ 'GET /v1/public/jobs/job-1': job({ salaryMin: 40, salaryMax: 90, salaryPeriod: 'hour', employmentType: 'contract', workMode: 'hybrid' }) });
    renderWithProviders(page(), { route: '/jobs/job-1' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Platform Engineer' })).toBeInTheDocument();
    expect(screen.getByText('$40 - $90 / hr')).toBeInTheDocument();
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(screen.getByText('Build and run reliable services.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Required skills' })).toHaveTextContent('postgresql');
    expect(screen.getByRole('link', { name: /All roles/ })).toHaveAttribute('href', '/');
  });

  it('leaves out the pay and skills sections when there are none', async () => {
    mockApi({ 'GET /v1/public/jobs/job-1': job({ salaryMin: null, salaryMax: null, requiredSkills: [] }) });
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await screen.findByRole('heading', { level: 1, name: 'Platform Engineer' });
    expect(screen.queryByText('Compensation')).not.toBeInTheDocument();
    expect(screen.queryByText('What you will need')).not.toBeInTheDocument();
  });

  it('tells the visitor when the role is closed or missing, and when it cannot be loaded', async () => {
    mockApi({ 'GET /v1/public/jobs/job-9': () => new Reply(404, { message: 'Job not found' }) });
    const { unmount } = renderWithProviders(page(), { route: '/jobs/job-9' });
    expect(await screen.findByRole('heading', { name: 'This role is no longer open' })).toBeInTheDocument();
    unmount();

    mockApi({ 'GET /v1/public/jobs/job-9': () => new Reply(500, { message: 'boom' }) });
    renderWithProviders(page(), { route: '/jobs/job-9' });
    expect(await screen.findByRole('heading', { name: 'Could not load this role' })).toBeInTheDocument();
  });
});

describe('applying for a role', () => {
  const applied = () =>
    new Reply(201, { application: { id: 'app-1', status: 'applied' }, created: true, applicationToken: 'tok-123', resumeUpload: ticket() });

  it('applies, uploads the resume straight to S3 and confirms, moving the progress bar along', async () => {
    const s3 = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = mockApi({ 'GET /v1/public/jobs/job-1': job(), 'POST /v1/public/jobs/job-1/applications': applied });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url.includes('s3.') ? s3(url, init) : base(url, init)));

    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await screen.findByRole('heading', { level: 1, name: 'Platform Engineer' });

    const progress = () => screen.getAllByRole('listitem', { hidden: false }).filter((li) => li.hasAttribute('data-state'));
    expect(progress().map((li) => li.getAttribute('data-state'))).toEqual(['current', 'todo', 'todo']);

    await fillAndApply(user);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'asha@example.com', fullName: 'Asha Rao' });
    expect(await screen.findByRole('heading', { name: 'Upload your resume' })).toBeInTheDocument();
    expect(progress().map((li) => li.getAttribute('data-state'))).toEqual(['done', 'current', 'todo']);

    await user.upload(screen.getByLabelText('Resume (PDF)'), pdfFile());
    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));

    expect(await screen.findByRole('heading', { name: 'Application received' })).toBeInTheDocument();
    expect(s3).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'See more roles' })).toHaveAttribute('href', '/');
  });

  it('accepts a PDF dropped on the upload area, and highlights the area while a file hovers', async () => {
    mockApi({ 'GET /v1/public/jobs/job-1': job(), 'POST /v1/public/jobs/job-1/applications': applied });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);

    const zone = (await screen.findByText('Choose a PDF or drop it here')).closest('label')!;
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute('data-active', 'true');
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute('data-active', 'false');

    fireEvent.drop(zone, { dataTransfer: { files: [pdfFile('dropped.pdf', 2048)] } });
    expect(await screen.findByText('dropped.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('says so, and offers no upload, when the candidate has already applied', async () => {
    mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () => new Reply(200, { application: { id: 'app-1', status: 'applied' }, created: false }),
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);

    expect(await screen.findByRole('heading', { name: 'You have already applied' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Resume (PDF)')).not.toBeInTheDocument();
  });

  it('refuses a file that is not a PDF before sending anything, and when nothing was chosen', async () => {
    const api = mockApi({ 'GET /v1/public/jobs/job-1': job(), 'POST /v1/public/jobs/job-1/applications': applied });
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);

    await user.click(await screen.findByRole('button', { name: 'Upload resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose your resume.');

    await user.upload(screen.getByLabelText('Resume (PDF)'), new File(['x'], 'cv.docx', { type: 'application/msword' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a PDF file.');
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1); // only the application, no upload attempt
  });

  it('asks for a fresh upload link when the first one fails, using the application token', async () => {
    let uploads = 0;
    const api = mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': applied,
      'POST /v1/public/applications/app-1/resume-upload-url': () => ({ resumeUpload: ticket({ url: 'https://fresh.s3.example/' }) }),
    });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('amazonaws') || url.includes('fresh.s3')) {
        uploads += 1;
        return uploads === 1
          ? new Response('<Message>Invalid according to Policy: Policy expired.</Message>', { status: 403 })
          : new Response(null, { status: 204 });
      }
      return base(url, init);
    });

    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);
    await user.upload(await screen.findByLabelText('Resume (PDF)'), pdfFile());
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Policy expired');
    await user.click(screen.getByRole('button', { name: 'Get a fresh upload link' }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/resume-upload-url'))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith('/resume-upload-url'))?.headers['X-Application-Token']).toBe('tok-123');

    await user.click(await screen.findByRole('button', { name: 'Upload resume' }));
    expect(await screen.findByRole('heading', { name: 'Application received' })).toBeInTheDocument();
  });

  it('shows the API reason when applying fails, with its reference', async () => {
    mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () => new Reply(400, { message: ['email must be an email'], requestId: 'req-5' }),
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('email must be an email');
    expect(screen.getByRole('alert')).toHaveTextContent('req-5');
  });

  it('shows why a fresh link could not be issued', async () => {
    mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': applied,
      'POST /v1/public/applications/app-1/resume-upload-url': () => new Reply(401, { message: 'Invalid or expired application token' }),
    });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
      url.includes('amazonaws') ? new Response('<Message>Policy expired.</Message>', { status: 403 }) : base(url, init),
    );
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);
    await user.upload(await screen.findByLabelText('Resume (PDF)'), pdfFile());
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));
    await user.click(await screen.findByRole('button', { name: 'Get a fresh upload link' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => /expired application token/.test(a.textContent ?? ''))).toBe(true));
  });
});
