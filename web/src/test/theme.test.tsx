import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialTheme, ThemeProvider, ThemeToggle, useTheme } from '../theme';
import { LoginPage } from '../pages/LoginPage';
import { mockApi, renderWithProviders } from './helpers';

const prefersDark = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark && query.includes('dark'), media: query }));

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

describe('choosing a theme', () => {
  it('uses a saved choice first, then the system setting, then light', () => {
    prefersDark(true);
    expect(initialTheme()).toBe('dark');
    prefersDark(false);
    expect(initialTheme()).toBe('light');
    localStorage.setItem('hireflow.theme', 'dark');
    expect(initialTheme()).toBe('dark');
    localStorage.setItem('hireflow.theme', 'sepia');
    expect(initialTheme()).toBe('light');
  });

  it('falls back to light when the browser cannot answer', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(initialTheme()).toBe('light');
  });

  it('flips on click, labels the button for what it will do, and remembers the choice', async () => {
    prefersDark(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hireflow.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hireflow.theme')).toBe('light');
  });

  it('still switches for the visit when storage is blocked', async () => {
    prefersDark(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle className="extra" />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.restoreAllMocks();
  });

  it('refuses to be used outside a provider', () => {
    const Probe = () => {
      useTheme();
      return null;
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useTheme must be used inside ThemeProvider');
    quiet.mockRestore();
  });
});

describe('the sign-in page', () => {
  it('stays on the dark set whichever theme is chosen', () => {
    mockApi({});
    localStorage.setItem('hireflow.theme', 'light');
    const { container } = renderWithProviders(<LoginPage />, { route: '/login' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(container.querySelector('.login')).toHaveAttribute('data-theme', 'dark');
  });
});
