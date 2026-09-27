import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRhProject, listRhProjects, rk } from '../lib/api/research';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, Button, Card, EmptyState, Input, Label, PageLoader, Stat } from '../components/ui';
import { StatusBadge } from './StatusBadge';

export function ResearchListPage() {
  const q = useQuery({ queryKey: rk.list, queryFn: listRhProjects });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await createRhProject({ title: title.trim() });
      await qc.invalidateQueries({ queryKey: rk.list });
      nav(`/research/${p.id}`);
    } catch (err) {
      setError(friendlyError(err, 'Could not create the form.'));
      setBusy(false);
    }
  };

  const rows = q.data ?? [];
  const totalResponses = rows.reduce((n, r) => n + r.response_count, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">ResearchHub</h1>
        <p className="mt-1 text-sm text-slate-600">Build a questionnaire, share the link with respondents, and collect their answers in one place.</p>
      </div>

      <Card className="p-4">
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="rh-new-title">New questionnaire</Label>
            <Input id="rh-new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Study habits of final-year students" maxLength={300} />
          </div>
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>Create questionnaire</Button>
        </form>
        {error && <Alert className="mt-3">{error}</Alert>}
      </Card>

      {q.isLoading ? <PageLoader /> : q.error ? (
        <Alert>{friendlyError(q.error, 'Could not load your questionnaires.')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title="No questionnaires yet">Create your first questionnaire above — you can add questions, publish it and share the link.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Questionnaires" value={fmt(rows.length)} />
            <Stat label="Published" value={fmt(rows.filter((r) => r.status === 'active').length)} />
            <Stat label="Responses" value={fmt(totalResponses)} />
          </div>
          <ul className="space-y-2" aria-label="My questionnaires">
            {rows.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link to={`/research/${r.id}`} className="font-semibold text-ink-900 hover:underline">{r.title}</Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fmt(r.field_count)} question{r.field_count === 1 ? '' : 's'} · {fmt(r.response_count)} response{r.response_count === 1 ? '' : 's'}
                      {r.last_response_at && ` · last response ${fmtDate(r.last_response_at)}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                  <div className="flex gap-2">
                    <Link to={`/research/${r.id}`} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Edit</Link>
                    <Link to={`/research/${r.id}/responses`} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Responses</Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
