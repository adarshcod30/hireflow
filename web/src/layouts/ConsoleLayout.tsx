import { ExternalLink, LayoutDashboard, LogOut, Briefcase, UsersRound, UserCog } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Avatar } from '../components/ui';
import { Brand } from './PublicLayout';

/** The recruiter console shell: a dark sidebar and a wide working area. */
export function ConsoleLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="theme-dark shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Console">
          <span className="side-label">Workspace</span>
          <NavLink to="/recruiter" end className="side-link">
            <LayoutDashboard size={18} aria-hidden="true" /> Overview
          </NavLink>
          <NavLink to="/recruiter/jobs" className="side-link">
            <Briefcase size={18} aria-hidden="true" /> Jobs
          </NavLink>
          <NavLink to="/recruiter/candidates" className="side-link">
            <UsersRound size={18} aria-hidden="true" /> Candidates
          </NavLink>
          {user.role === 'admin' && (
            <NavLink to="/recruiter/team" className="side-link">
              <UserCog size={18} aria-hidden="true" /> Team
            </NavLink>
          )}
          <span className="side-label">Public</span>
          <Link to="/" className="side-link">
            <ExternalLink size={18} aria-hidden="true" /> Job board
          </Link>
        </nav>
        <div className="side-user">
          <div className="who">
            <Avatar name={user.fullName} size={34} />
            <div>
              <strong>{user.fullName}</strong>
              <span className="muted small">{user.role === 'admin' ? 'Admin' : 'Recruiter'}</span>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            // Leave first, and let the public page finish the sign-out when it arrives. Ending the
            // session while this page is still on screen would send the route guard to the login page.
            onClick={() => navigate('/', { state: { signOut: true } })}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}
