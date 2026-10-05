import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { ApplicationPage } from './pages/ApplicationPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobApplicationsPage } from './pages/JobApplicationsPage';
import { JobPage } from './pages/JobPage';
import { JobsPage } from './pages/JobsPage';
import { LoginPage } from './pages/LoginPage';
import { UsersPage } from './pages/UsersPage';

export function RequireAuth({ children, role }: { children: ReactNode; role?: 'admin' }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <p className="error">You do not have access to this page.</p>;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="recruiter" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="recruiter/jobs/:id" element={<RequireAuth><JobApplicationsPage /></RequireAuth>} />
        <Route path="recruiter/applications/:id" element={<RequireAuth><ApplicationPage /></RequireAuth>} />
        <Route path="recruiter/users" element={<RequireAuth role="admin"><UsersPage /></RequireAuth>} />
        <Route path="*" element={<p className="empty">Page not found.</p>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
