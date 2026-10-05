import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Hire<span>Flow</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Open roles
          </NavLink>
          {user && <NavLink to="/recruiter">Recruiter</NavLink>}
          {user?.role === 'admin' && <NavLink to="/recruiter/users">Users</NavLink>}
        </nav>
        <div className="who">
          {user ? (
            <>
              <span className="muted">{user.fullName}</span>
              <button
                className="link"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login">Recruiter sign in</Link>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
