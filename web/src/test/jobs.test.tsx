import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { JobsPage } from '../pages/JobsPage';
import { job, mockApi, renderWithProviders, Reply } from './helpers';

describe('open roles page', () => {
  it('lists roles and pages with the cursor from the API', async () => {
    const api = mockApi({
      'GET /v1/public/jobs': ({ url }: { url: string }) =>
        new URL(url).searchParams.get('cursor') === 'next-page'
          ? { items: [job({ id: 'j2', title: 'Data Analyst' })], nextCursor: null }
          : { items: [job({ id: 'j1', title: 'Platform Engineer' })], nextCursor: 'next-page' },
    });
    const user = userEvent.setup();
    renderWithProviders(<JobsPage />);

    expect(await screen.findByRole('link', { name: 'Platform Engineer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Data Analyst' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(api.calls.at(-1)?.url).toContain('cursor=next-page');
  });

  it('searches as the visitor types', async () => {
    const api = mockApi({ 'GET /v1/public/jobs': { items: [], nextCursor: null } });
    const user = userEvent.setup();
    renderWithProviders(<JobsPage />);
    await user.type(await screen.findByRole('searchbox'), 'react');
    await waitFor(() => expect(api.calls.some((c) => c.url.includes('q=react'))).toBe(true));
    expect(await screen.findByText('No open roles match that search.')).toBeInTheDocument();
  });

  it('shows an error without crashing when the API is down', async () => {
    mockApi({ 'GET /v1/public/jobs': () => new Reply(500, { message: 'Internal server error', requestId: 'r1' }) });
    renderWithProviders(<JobsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });

  it('shortens a long description', async () => {
    mockApi({ 'GET /v1/public/jobs': { items: [job({ description: 'x'.repeat(400) })], nextCursor: null } });
    renderWithProviders(<JobsPage />);
    expect(await screen.findByText(/x{180}\.\.\./)).toBeInTheDocument();
  });
});
