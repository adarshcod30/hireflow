import { Moon, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'hireflow.theme';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** A saved choice wins. Otherwise follow the operating system, and fall back to light. */
// eslint-disable-next-line react-refresh/only-export-components
export function initialTheme(): Theme {
  const saved = stored();
  if (saved) return saved;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface ThemeValue {
  theme: Theme;
  toggle(): void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // The attribute lives on <html> so dialogs rendered outside the app shell get the same colours.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Private windows can refuse storage. The choice still holds for this visit.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

/** A button that flips between light and dark. Icon only by default, or with a word beside the icon. */
export function ThemeToggle({ className = '', labelled = false }: { className?: string; labelled?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const action = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className={`btn btn-sm theme-toggle ${labelled ? 'btn-secondary' : 'btn-ghost btn-icon'} ${className}`.trim()}
      onClick={toggle}
      aria-label={action}
      title={action}
    >
      {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {labelled && <span className="btn-label">{dark ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
