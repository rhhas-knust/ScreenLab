import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fmt, fmtDate, pct, qk, useProject, useSettings, useStats } from '../lib/hooks';
import { listActivity } from '../lib/api/activity';
import { REVIEW_TYPE_LABELS } from '../lib/types';
import { Alert, Button, Card, Modal, PageLoader, ProgressBar, Stat } from '../components/ui';
import { ExportPanel } from '../components/ExportPanel';
import { CriteriaView } from '../components/CriteriaView';

export function DashboardPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const { data: project } = useProject(projectId);
  const { data: settings } = useSettings(projectId);
  const { data: s, isLoading } = useStats(projectId);
  const activity = useQuery({ queryKey: [...qk.activity(projectId), 'recent'], queryFn: () => listActivity(projectId, 0, 8) });
  const [exportOpen, setExportOpen] = useState(false);
  if (!project || isLoading || !s) return <PageLoader />;

  const stage2 = settings?.stage2_enabled ?? true;
  const included = stage2 ? s.ft_include : s.ta_include;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {project.is_demo && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-900">DEMO DATA</span>}
            <span className="text-slate-500">{REVIEW_TYPE_LABELS[project.review_type]}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-900">{project.title}</h1>
          {project.research_question && <p className="mt-1 text-slate-700"><span className="font-medium">Research question:</span> {project.research_question}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={() => nav(`/p/${projectId}/screening`)}>Continue screening →</Button>
        </div>
      </div>

      {s.total === 0 ? (
        <Card className="mt-6 p-6 text-center">
          <h2 className="text-lg font-semibold text-ink-900">No references yet</h2>
          <p className="mt-1 text-sm text-slate-600">Import a CSV, RIS, BibTeX or PubMed file exported from your database searches.</p>
          <Button className="mt-4" variant="primary" onClick={() => nav(`/p/${projectId}/import`)}>Import references</Button>
        </Card>
      ) : (
        <>
          <Card className="mt-6 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-ink-900">Title / abstract screening</h2>
              <span className="text-sm tabular-nums text-slate-700"><strong>{fmt(s.ta_screened)}</strong> / {fmt(s.after_dedup)} screened · <strong>{pct(s.ta_screened, s.after_dedup)}</strong></span>
            </div>
            <div className="mt-2"><ProgressBar value={s.ta_screened} max={s.after_dedup} label="Title/abstract screening progress" /></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label="Total records" value={fmt(s.total)} />
              <Stat label="Duplicates" value={fmt(s.duplicates_removed)} sub={s.possible_duplicates ? `${fmt(s.possible_duplicates)} to review` : 'removed'} tone="muted" />
              <Stat label="Unscreened" value={fmt(s.ta_unscreened)} />
              <Stat label="Screened" value={fmt(s.ta_screened)} />
              <Stat label="✓ Included" value={fmt(s.ta_include)} tone="include" />
              <Stat label="✕ Excluded" value={fmt(s.ta_exclude)} tone="exclude" />
              <Stat label="? Maybe" value={fmt(s.ta_maybe)} tone="maybe" />
            </div>
            {s.possible_duplicates > 0 && (
              <Alert kind="warning" className="mt-4">
                {fmt(s.possible_duplicates)} records are flagged as possible duplicates. <Link className="font-semibold underline" to={`/p/${projectId}/duplicates`}>Review duplicates</Link>
              </Alert>
            )}
          </Card>

          {stage2 && (
            <Card className="mt-4 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-ink-900">Full-text screening</h2>
                <span className="text-sm tabular-nums text-slate-700"><strong>{fmt(s.ft_screened)}</strong> / {fmt(s.ft_pool)} assessed</span>
              </div>
              <div className="mt-2"><ProgressBar value={s.ft_screened} max={s.ft_pool} label="Full-text screening progress" /></div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Full texts sought" value={fmt(s.ft_pool)} />
                <Stat label="Awaiting assessment" value={fmt(s.ft_unscreened)} />
                <Stat label="✓ Included" value={fmt(s.ft_include)} tone="include" />
                <Stat label="✕ Excluded" value={fmt(s.ft_exclude)} tone="exclude" />
              </div>
              {s.ft_pool > 0 && (
                <Button className="mt-4" onClick={() => nav(`/p/${projectId}/screening?stage=full_text`)}>Open full-text screening</Button>
              )}
            </Card>
          )}
          <p className="mt-3 text-sm text-slate-700">Studies included so far: <strong className="tabular-nums">{fmt(included)}</strong></p>
        </>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">Recent activity</h2>
            <Link to={`/p/${projectId}/activity`} className="text-sm text-ink-700 underline">Full activity log</Link>
          </div>
          {activity.data?.rows.length ? (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {activity.data.rows.map((a) => (
                <li key={a.id} className="flex gap-3 py-2">
                  <time className="w-32 shrink-0 text-xs text-slate-500" dateTime={a.created_at}>{fmtDate(a.created_at)}</time>
                  <span className="min-w-0">
                    {a.message}
                    {typeof a.details?.title === 'string' && <span className="block truncate text-xs text-slate-500">{a.details.title as string}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">No activity yet.</p>}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold text-ink-900">Actions</h2>
            <div className="mt-3 grid gap-2">
              <Button onClick={() => nav(`/p/${projectId}/import`)}>Import references</Button>
              <Button onClick={() => setExportOpen(true)}>Export</Button>
              <Button onClick={() => nav(`/p/${projectId}/statistics`)}>Statistics</Button>
              <Button onClick={() => nav(`/p/${projectId}/duplicates`)}>Duplicates</Button>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 font-semibold text-ink-900">Review criteria</h2>
            <CriteriaView project={project} compact />
          </Card>
        </div>
      </div>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export" size="lg">
        <ExportPanel project={project} stage2Enabled={stage2} />
      </Modal>
    </div>
  );
}
