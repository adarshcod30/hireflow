import { ArrowUpRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ThemeToggle } from '../theme';

/** A rounded mark with a flowing line, then the name in two tones: Hire in ink, Flow in the brand gradient. */
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="HireFlow home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="brand-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d5dfc" />
            <stop offset="0.55" stopColor="#c04df0" />
            <stop offset="1" stopColor="#ff8a5c" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="10" fill="url(#brand-fill)" />
        <path d="M7.5 20.5c3.2 0 3.2-9 6.5-9s3.2 9 6.5 9c1.7 0 3-1.6 4-4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="25" cy="12.5" r="2.4" fill="#fff" />
      </svg>
      <span className="brand-name">
        Hire<b>Flow</b>
        <i>.</i>
      </span>
    </Link>
  );
}

/** The candidate-facing shell: light, airy, and quiet about the recruiter side. */
export function PublicLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // The console sends people here to sign out. Do it once, then clear the marker so that a reload,
  // or signing in again later, does not repeat it.
  const signOut = (location.state as { signOut?: boolean } | null)?.signOut === true;
  useEffect(() => {
    if (!signOut) return;
    logout();
    navigate(location.pathname, { replace: true, state: null });
  }, [signOut, logout, navigate, location.pathname]);

  return (
    <div className="themed pub">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="pub-header">
        <Brand />
        <nav className="pub-nav" aria-label="Main">
          <NavLink to="/" end>
            Opportunities
          </NavLink>
        </nav>
        <div className="pub-actions">
          <ThemeToggle />
          {user ? (
            <Link className="btn btn-primary btn-sm" to="/recruiter">
              Open console <ArrowUpRight size={16} />
            </Link>
          ) : (
            <Link className="btn btn-secondary btn-sm" to="/login">
              Recruiter sign in
            </Link>
          )}
        </div>
      </header>
      <main id="main" className="pub-main">
        <Outlet />
      </main>
      <footer className="pub-footer">
        <span>HireFlow. A hiring pipeline on AWS.</span>
        <span>Resumes are screened by AI and always reviewed by a person.</span>
      </footer>
    </div>
  );
}
