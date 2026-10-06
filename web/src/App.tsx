import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import { Loading } from './components/ui';
import { ConsoleLayout } from './layouts/ConsoleLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { ApplicationPage } from './pages/console/ApplicationPage';
import { CandidatesPage } from './pages/console/CandidatesPage';
import { JobBoardPage } from './pages/console/JobBoardPage';
import { JobsPage } from './pages/console/JobsPage';
import { OverviewPage } from './pages/console/OverviewPage';
import { TeamPage } from './pages/console/TeamPage';
import { LoginPage } from './pages/LoginPage';
import { JobPage } from './pages/public/JobPage';
import { OpportunitiesPage } from './pages/public/OpportunitiesPage';

export function RequireAuth({ children, role }: { children: ReactNode; role?: 'admin' }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="themed" style={{ padding: 40 }}>
        <Loading label="Signing you in" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <p className="notice notice-error">You do not have access to this page.</p>;
  return children;
}

function NotFound() {
  return (
    <div className="pub-hero">
      <h1>Page not found</h1>
      <p>That page does not exist, or the role has been filled.</p>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<OpportunitiesPage />} />
        <Route path="jobs/:id" element={<JobPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="login" element={<LoginPage />} />
      <Route
        path="recruiter"
        element={
          <RequireAuth>
            <ConsoleLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobBoardPage />} />
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="applications/:id" element={<ApplicationPage />} />
        <Route
          path="team"
          element={
            <RequireAuth role="admin">
              <TeamPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
