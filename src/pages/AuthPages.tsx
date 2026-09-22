import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Field, Input } from '../components/ui';
import { Logo } from '../components/Logo';

function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-ink-50 to-slate-50 px-4 py-10">
      <div className="mb-6"><Logo tagline /></div>
      <main className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-ink-900">{title}</h1>
        {children}
      </main>
      {footer && <div className="mt-4 text-sm text-slate-600">{footer}</div>}
      <p className="mt-8 max-w-sm text-center text-xs text-slate-500">
        Your research data belongs to you. Export everything at any time.
      </p>
    </div>
  );
}

export function LoginPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? '/projects'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else nav(loc.state?.from ?? '/projects', { replace: true });
  };

  return (
    <AuthFrame title="Sign in" footer={<>New to ScreenLab? <Link className="font-medium text-ink-800 underline" to="/signup">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="password" label="Password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
        <p className="text-center text-sm"><Link className="text-ink-700 underline" to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </AuthFrame>
  );
}

export function SignupPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/projects" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Please use a password with at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/projects` },
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return setError('An account with this email already exists. Try signing in instead.');
    }
    if (!data.session) setDone(true);
  };

  if (done) {
    return (
      <AuthFrame title="Check your email">
        <Alert kind="success">
          We sent a confirmation link to <strong>{email}</strong>. Open it on this device to activate your account, then sign in.
        </Alert>
        <p className="mt-4 text-sm"><Link className="font-medium text-ink-800 underline" to="/login">Back to sign in</Link></p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create your account" footer={<>Already have an account? <Link className="font-medium text-ink-800 underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="password" label="Password" hint="(at least 8 characters)">
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id="confirm" label="Confirm password">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else setSent(true);
  };
  return (
    <AuthFrame title="Reset your password" footer={<Link className="font-medium text-ink-800 underline" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert kind="success">If an account exists for <strong>{email}</strong>, a password-reset link is on its way. Open it to choose a new password.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field id="email" label="Email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Please use a password with at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else nav('/projects', { replace: true });
  };
  if (!loading && !user) {
    return (
      <AuthFrame title="Reset link expired">
        <Alert>This password-reset link is invalid or has expired. Please request a new one.</Alert>
        <p className="mt-4 text-sm"><Link className="font-medium text-ink-800 underline" to="/forgot-password">Request a new link</Link></p>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field id="password" label="New password" hint="(at least 8 characters)">
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id="confirm" label="Confirm new password">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Save new password</Button>
      </form>
    </AuthFrame>
  );
}
