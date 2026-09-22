import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Card, Field, Input } from '../components/ui';

export function AccountSection() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) return setMsg({ kind: 'error', text: 'Please use at least 8 characters.' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMsg({ kind: 'error', text: friendlyError(error) });
    else {
      setPassword('');
      setMsg({ kind: 'success', text: 'Password changed.' });
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <p>Signed in as <strong>{user?.email}</strong></p>
      <form onSubmit={change} className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field id="new-password" label="Change password">
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" />
          </Field>
        </div>
        <Button type="submit" loading={busy}>Update</Button>
      </form>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Button onClick={async () => { await supabase.auth.signOut(); nav('/login'); }}>Sign out</Button>
    </div>
  );
}

export function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold text-ink-900">Account</h1>
      <Card className="p-5"><AccountSection /></Card>
    </div>
  );
}
