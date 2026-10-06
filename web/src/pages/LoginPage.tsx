import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorNote } from '../components/ui';
import { Brand } from '../layouts/PublicLayout';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/recruiter';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="themed login" data-theme="dark">
      <section className="login-art" aria-hidden="true">
        <Brand />
        <div>
          <h2>
            <span>Let the machine read first.</span>
            <span>You make the call.</span>
          </h2>
          <h3>Every resume is scored in seconds, every move is yours to make, and every candidate hears back exactly once.</h3>
        </div>
        <span className="muted small">
          <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Signed requests, least-privilege access
        </span>
      </section>
      <section className="login-form">
        <form onSubmit={(e) => void submit(e)}>
          <div>
            <h1>Recruiter sign in</h1>
            <p className="muted">Use the account your administrator created for you.</p>
          </div>
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <ErrorNote error={error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      </section>
    </div>
  );
}
