import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getSharedResults } from '../lib/api/research';
import { fieldStats, overview } from '../lib/research/analytics';
import { scoreResponses } from '../lib/research/formula';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, PageLoader, Stat, cx } from '../components/ui';
import { PerDayChart } from './Charts';
import { QuestionStats } from './QuestionStats';
import { ChartStudio } from './ChartStudio';

/** Read-only results for a supervisor or co-author, opened from /r/<token>. No account needed. */
export function SharedResultsPage() {
  const { token = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') === 'studio' ? 'studio' : 'summary';
  const q = useQuery({ queryKey: ['rh', 'shared', token], queryFn: () => getSharedResults(token), retry: 1 });
  const d = useMemo(() => (q.data ? { ...q.data, responses: scoreResponses(q.data.fields, q.data.responses) } : q.data), [q.data]);
  const stats = useMemo(() => (d ? d.fields.map((f) => fieldStats(f, d.responses)) : []), [d]);
  const ov = useMemo(() => (d ? overview(d.fields, d.responses) : null), [d]);
  useEffect(() => {
    if (d) document.title = `${d.title} — results`;
    return () => { document.title = 'ScreenLab'; };
  }, [d]);

  if (q.isLoading) return <PageLoader label="Loading results…" />;
  if (q.error || !d || !ov) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>{q.error ? friendlyError(q.error) : 'This results link is not valid. It may have been turned off or replaced — ask the researcher for a new one.'}</Alert>
      </div>
    );
  }
  const meta = [d.university, d.department, d.year].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6" data-testid="rh-shared-results">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Survey results · read-only</p>
        <h1 className="text-2xl font-semibold text-ink-900">{d.title}</h1>
        {meta && <p className="text-sm text-slate-600">{meta}</p>}
        {d.description && <p className="max-w-3xl pt-1 text-sm text-slate-700">{d.description}</p>}
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Responses" value={fmt(ov.responses)} />
        <Stat label="Questions shown" value={d.fields.length} />
        <Stat label="Avg. completion" value={`${ov.completion}%`} />
        <Stat label="Collected" value={<span className="text-base">{fmtDate(ov.first, false)}</span>} sub={ov.last && ov.first?.slice(0, 10) !== ov.last.slice(0, 10) ? `to ${fmtDate(ov.last, false)}` : undefined} />
      </div>
      <div role="tablist" aria-label="Results view" className="flex gap-1 border-b border-slate-200">
        {([['summary', 'Summary'], ['studio', 'Chart studio']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'summary' ? {} : { view: k }, { replace: true })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
            {label}
          </button>
        ))}
      </div>
      {d.responses.length === 0 ? (
        <p className="text-sm text-slate-600">No responses yet.</p>
      ) : tab === 'studio' ? (
        <ChartStudio key={params.get('x') ?? ''} title={d.title} fields={d.fields} responses={d.responses} initialVar={params.get('x')} includeEmail={false} />
      ) : (
        <div className="space-y-3">
          {ov.perDay.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink-900">Responses per day</h2>
              <PerDayChart days={ov.perDay} />
            </div>
          )}
          {stats.map((s, i) => <QuestionStats key={s.fieldId} s={s} index={i} onChart={(x) => setParams({ view: 'studio', x }, { replace: true })} />)}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Shared from ResearchHub (ScreenLab). Email-address answers are never shown{d.include_text ? '' : ', and open-text answers are hidden'}. Question numbers (Q1, Q2 …) follow the questions shown here.
      </p>
    </div>
  );
}
