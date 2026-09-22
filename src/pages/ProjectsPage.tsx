import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectsOverview, qk, fmt, pct, fmtDate } from '../lib/hooks';
import { createDemoProject } from '../lib/api/demo';
import { friendlyError } from '../lib/errors';
import { REVIEW_TYPE_LABELS } from '../lib/types';
import { Alert, Button, Card, PageLoader, ProgressBar } from '../components/ui';
import { RestoreBackupModal } from '../components/RestoreBackup';
import { useToast } from '../components/Toast';

export function ProjectsPage() {
  const { data, isLoading, error, refetch } = useProjectsOverview();
  const [restore, setRestore] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const tryDemo = async () => {
    setDemoBusy(true);
    try {
      const p = await createDemoProject();
      await qc.invalidateQueries({ queryKey: qk.projects });
      nav(`/p/${p.id}`);
    } catch (e) {
      toast(friendlyError(e, 'Could not create the demo project.'), { kind: 'error' });
    } finally {
      setDemoBusy(false);
    }
  };

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>{friendlyError(error, 'Could not load your projects.')}</Alert>
        <Button className="mt-3" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => nav('/projects/new')}>+ Create review</Button>
      <Button onClick={() => setRestore(true)}>Import project</Button>
      <Button variant="ghost" onClick={tryDemo} loading={demoBusy}>Try demo</Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {data && data.length === 0 ? (
        <Card className="mx-auto mt-6 max-w-xl p-8 text-center">
          <h1 className="text-2xl font-semibold text-ink-900">Welcome to ScreenLab</h1>
          <p className="mt-2 text-slate-600">Create your first systematic review.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button variant="primary" size="lg" onClick={() => nav('/projects/new')}>Create review</Button>
            <Button size="lg" onClick={() => setRestore(true)}>Import project</Button>
            <Button size="lg" variant="subtle" onClick={tryDemo} loading={demoBusy}>Try demo</Button>
          </div>
          <p className="mt-6 text-xs text-slate-500">The demo creates a practice project with 20 clearly fictional references.</p>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-ink-900">My Systematic Reviews</h1>
              <p className="text-sm text-slate-600">{data?.length} project{data?.length === 1 ? '' : 's'}</p>
            </div>
            {actions}
          </div>
          <ul className="space-y-3">
            {data?.map((p) => {
              const pool = p.total - p.duplicates;
              return (
                <li key={p.id}>
                  <Card className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {p.is_demo && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">DEMO DATA</span>}
                          <span className="text-xs text-slate-500">{REVIEW_TYPE_LABELS[p.review_type]}</span>
                        </div>
                        <h2 className="mt-1 text-lg font-semibold text-ink-900">
                          <Link to={`/p/${p.id}`} className="hover:underline">{p.title}</Link>
                        </h2>
                        {p.research_question && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{p.research_question}</p>}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums text-slate-700">
                          <span><strong>{fmt(p.total)}</strong> records</span>
                          <span><strong>{fmt(p.screened)}</strong> screened</span>
                          <span><strong>{fmt(p.unscreened)}</strong> remaining</span>
                          <span><strong>{pct(p.screened, pool)}</strong> complete</span>
                        </div>
                        <div className="mt-2 max-w-md"><ProgressBar value={p.screened} max={pool} label={`${p.title} screening progress`} /></div>
                        <p className="mt-2 text-xs text-slate-500">Last activity {fmtDate(p.last_activity ?? p.created_at)}</p>
                      </div>
                      <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                        <Button variant="primary" onClick={() => nav(`/p/${p.id}/screening`)}>Continue screening</Button>
                        <Button onClick={() => nav(`/p/${p.id}`)}>Open dashboard</Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <RestoreBackupModal open={restore} onClose={() => setRestore(false)} />
    </div>
  );
}
