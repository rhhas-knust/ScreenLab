import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams, Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth/AuthProvider';
import { supabaseConfigured } from './lib/supabase';
import { outbox } from './lib/outbox';
import { qk, useProject } from './lib/hooks';
import { friendlyError } from './lib/errors';
import { AppShell } from './components/AppShell';
import { Alert, Button, PageLoader } from './components/ui';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages';
import { ProjectsPage } from './pages/ProjectsPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { ScreeningPage } from './screening/ScreeningPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountPage } from './pages/AccountPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader label="Starting ScreenLab…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** Loads the project first; RLS makes other users' projects indistinguishable from missing ones. */
function ProjectGuard() {
  const { projectId = '' } = useParams();
  const { isLoading, error } = useProject(projectId);
  const valid = /^[0-9a-f-]{36}$/i.test(projectId);
  if (!valid) return <ProjectMissing />;
  if (isLoading) return <PageLoader />;
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'PGRST116' || code === '22P02') return <ProjectMissing />;
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>{friendlyError(error, 'Could not load the project.')}</Alert>
        <Button className="mt-4" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );
  }
  return <Outlet />;
}

function ProjectMissing() {
  return (
    <div className="mx-auto max-w-lg p-6 text-center">
      <h1 className="text-xl font-semibold text-ink-900">Project not found</h1>
      <p className="mt-2 text-sm text-slate-600">This review project does not exist, was deleted, or belongs to another account.</p>
      <Link to="/projects" className="mt-4 inline-block font-medium text-ink-800 underline">Go to my projects</Link>
    </div>
  );
}

function Shell({ full = false }: { full?: boolean }) {
  return (
    <RequireAuth>
      <AppShell fullHeight={full}>
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-ink-900">ScreenLab is not configured yet</h1>
      <p className="mt-3 text-slate-700">
        The environment variables <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are missing.
        Add them in Vercel → Project → Settings → Environment Variables, then redeploy. See the README for step-by-step instructions.
      </p>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  useEffect(() => {
    // Refresh counts and lists after changes reach the server (debounced).
    let t: ReturnType<typeof setTimeout> | null = null;
    const projects = new Set<string>();
    return outbox.onSynced((op) => {
      projects.add(op.projectId);
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        for (const p of projects) {
          qc.invalidateQueries({ queryKey: qk.stats(p) });
          qc.invalidateQueries({ queryKey: qk.refs(p) });
          qc.invalidateQueries({ queryKey: qk.activity(p) });
        }
        qc.invalidateQueries({ queryKey: qk.projects });
        projects.clear();
      }, 800);
    });
  }, [qc]);

  if (!supabaseConfigured) return <NotConfigured />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<Navigate to="/projects" replace />} />

      <Route element={<Shell />}>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>

      <Route path="/p/:projectId" element={<Shell full />}>
        <Route element={<ProjectGuard />}>
          <Route path="screening" element={<ScreeningPage />} />
        </Route>
      </Route>
      <Route path="/p/:projectId" element={<Shell />}>
        <Route element={<ProjectGuard />}>
          <Route index element={<DashboardPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="references" element={<ReferencesPage />} />
          <Route path="duplicates" element={<DuplicatesPage />} />
          <Route path="statistics" element={<StatisticsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={
        <div className="p-8 text-center">
          <h1 className="text-xl font-semibold">Page not found</h1>
          <Link to="/projects" className="mt-3 inline-block underline">Go to my projects</Link>
        </div>
      } />
    </Routes>
  );
}
