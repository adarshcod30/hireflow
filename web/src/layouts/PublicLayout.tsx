import { ArrowUpRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="HireFlow home">
      HireFlow<i>.</i>
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
    <div className="theme-light pub">
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
