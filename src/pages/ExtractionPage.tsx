import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getProgress, listTeam, xk, type ProgressRow } from '../lib/api/extraction';
import { readForm, studyLabel } from '../lib/extraction/form';
import { useProject, useSettings } from '../lib/hooks';
import { cx, EmptyState, PageLoader, Stat } from '../components/ui';
import { FormEditor } from '../extraction/FormEditor';
import { AgreementTab } from '../extraction/AgreementTab';

const TABS = [
  { key: 'studies', label: 'Studies' },
  { key: 'form', label: 'Form' },
  { key: 'agreement', label: 'Agreement & export' },
] as const;
type Filter = 'all' | 'todo' | 'compare' | 'final';

function stateOf(r: ProgressRow, reviewers: number): { key: Exclude<Filter, 'all'> | 'waiting'; text: string; cls: string } {
  if (r.has_final) return { key: 'final', text: 'Final agreed', cls: 'bg-emerald-50 text-emerald-800' };
  if (r.my_status !== 'complete') return { key: 'todo', text: r.my_status === 'draft' ? 'Your draft' : 'To do', cls: 'bg-slate-100 text-slate-700' };
  if (r.complete_count >= Math.min(2, Math.max(reviewers, 1))) return { key: 'compare', text: 'Ready to compare', cls: 'bg-amber-50 text-amber-800' };
  return { key: 'waiting', text: 'Waiting for co-reviewer', cls: 'bg-sky-50 text-sky-800' };
}

export function ExtractionPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const settings = useSettings(projectId);
  const [params, setParams] = useSearchParams();
  const progress = useQuery({ queryKey: xk.progress(projectId), queryFn: () => getProgress(projectId) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const [filter, setFilter] = useState<Filter>('all');
  const form = readForm(settings.data);
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? (form ? 'studies' : 'form'));
  if (!project.data || !settings.data || !progress.data) return <PageLoader />;

  const rows = progress.data;
  const reviewers = (team.data ?? []).filter((t) => t.role !== 'viewer').length;
  const states = rows.map((r) => ({ r, s: stateOf(r, reviewers) }));
  const count = (k: string) => states.filter((x) => x.s.key === k).length;
  const shown = states.filter((x) => filter === 'all' || x.s.key === filter);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Data extraction</h1>
        <p className="text-sm text-slate-600">
          Each reviewer extracts every included study on their own; answers stay hidden from the other reviewer until both are complete.
          Then you compare, agree the final version, and export the characteristics table.
        </p>
      </div>
      <div role="tablist" aria-label="Extraction sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams(t.key === 'studies' ? {} : { tab: t.key }, { replace: true })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.key ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'form' && <FormEditor key={JSON.stringify(form)} projectId={projectId} form={form} started={rows.some((r) => r.started_count > 0)} />}
      {tab === 'agreement' && form && <AgreementTab projectId={projectId} title={project.data.title} form={form} progress={rows} />}
      {tab !== 'form' && !form && (
        <EmptyState title="Set up the extraction form first" action={<Link className="underline" to="?tab=form">Choose a form</Link>}>
          Pick a ready-made form and adjust it. Your co-reviewer will use the same one.
        </EmptyState>
      )}

      {tab === 'studies' && form && (
        rows.length === 0 ? (
          <EmptyState title="No included studies yet">Studies you include at full text appear here.</EmptyState>
        ) : (
          <div className="space-y-3">
            {reviewers < 2 && (
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                You are the only reviewer on this project. To extract in duplicate, add your co-reviewer in{' '}
                <Link className="underline" to={`/p/${projectId}/settings#team`}>Settings → Review team</Link>.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Your to do" value={count('todo')} />
              <Stat label="Waiting for co-reviewer" value={count('waiting')} tone="muted" />
              <Stat label="Ready to compare" value={count('compare')} tone="maybe" />
              <Stat label="Final agreed" value={count('final')} tone="include" />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
              {([['all', 'All'], ['todo', 'To do'], ['compare', 'Ready to compare'], ['final', 'Final agreed']] as [Filter, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={cx('rounded-full px-3 py-1 text-sm', filter === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-800 ring-1 ring-slate-200 hover:bg-ink-50')}>{l}</button>
              ))}
            </div>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="extraction-list">
              {shown.map(({ r, s }) => (
                <li key={r.reference_id}>
                  <Link to={`/p/${projectId}/extraction/${r.reference_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50" data-testid="extraction-row">
                    <span className="w-14 shrink-0 text-xs text-slate-500">#{r.seq}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                      <span className="block text-xs text-slate-500">{studyLabel(r.authors, r.year)}{r.final_tier ? ` · ${r.final_tier}` : ''}</span>
                    </span>
                    <span className="text-xs text-slate-500">{r.complete_count} done</span>
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>{s.text}</span>
                  </Link>
                </li>
              ))}
              {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing here.</li>}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
