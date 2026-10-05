import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { JobPage } from '../pages/JobPage';
import { job, mockApi, pdfFile, renderWithProviders, Reply, ticket } from './helpers';

const page = () => (
  <Routes>
    <Route path="/jobs/:id" element={<JobPage />} />
  </Routes>
);

async function fillAndApply(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Full name'), 'Asha Rao');
  await user.type(screen.getByLabelText('Email'), 'asha@example.com');
  await user.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('applying for a job', () => {
  it('shows the role, then applies, uploads the resume to S3 and confirms', async () => {
    const s3 = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const api = mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () =>
        new Reply(201, { application: { id: 'app-1', status: 'applied' }, created: true, applicationToken: 'tok', resumeUpload: ticket() }),
    });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url.includes('s3.') ? s3(url, init) : base(url, init)));

    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });

    expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Skills' })).toHaveTextContent('postgresql');

    await fillAndApply(user);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'asha@example.com', fullName: 'Asha Rao' });

    await user.upload(await screen.findByLabelText('Resume (PDF)'), pdfFile());
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));

    expect(await screen.findByText('Application received')).toBeInTheDocument();
    expect(s3).toHaveBeenCalledTimes(1);
  });

  it('says so, and offers no upload, when the candidate has already applied', async () => {
    mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () => new Reply(200, { application: { id: 'app-1', status: 'applied' }, created: false }),
    });
    const user = userEvent.setup();
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);

    expect(await screen.findByText('You have already applied')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resume (PDF)')).not.toBeInTheDocument();
  });

  it('refuses a file that is not a PDF before sending anything', async () => {
    const api = mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () =>
        new Reply(201, { application: { id: 'app-1', status: 'applied' }, created: true, applicationToken: 'tok', resumeUpload: ticket() }),
    });
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(page(), { route: '/jobs/job-1' });
    await fillAndApply(user);

    await user.upload(await screen.findByLabelText('Resume (PDF)'), new File(['x'], 'cv.docx', { type: 'application/msword' }));
    await user.click(screen.getByRole('button', { name: 'Upload resume' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a PDF file.');
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1); // only the application, no upload attempt
  });

  it('asks for a fresh upload link when the first one fails, using the application token', async () => {
    let uploads = 0;
    const api = mockApi({
      'GET /v1/public/jobs/job-1': job(),
      'POST /v1/public/jobs/job-1/applications': () =>
        new Reply(201, { application: { id: 'app-1', status: 'applied' }, created: true, applicationToken: 'tok-123', resumeUpload: ticket() }),
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
    expect(await screen.findByText('Application received')).toBeInTheDocument();
  });

  it('shows the API reason when applying fails', async () => {
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

  it('tells the visitor when the role is closed or missing', async () => {
    mockApi({ 'GET /v1/public/jobs/job-9': () => new Reply(404, { message: 'Job not found' }) });
    renderWithProviders(page(), { route: '/jobs/job-9' });
    expect(await screen.findByRole('heading', { name: 'This role is no longer open' })).toBeInTheDocument();
  });
});
