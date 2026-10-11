import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { answerText, deleteResponse, getRhProject, listFields, listResponses, responsesToCsv, rk } from '../lib/api/research';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, Button, Card, EmptyState, PageLoader, Stat, cx } from '../components/ui';
import { fieldStats, overview } from '../lib/research/analytics';
import { PerDayChart } from './Charts';
import { QuestionStats } from './QuestionStats';
import { AiSummaryCard } from './AiSummaryCard';
import { useToast } from '../components/Toast';
import { StatusBadge } from './StatusBadge';

export function ResponsesPage() {
  const { formId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const pq = useQuery({ queryKey: rk.project(formId), queryFn: () => getRhProject(formId), retry: 1 });
  const fq = useQuery({ queryKey: rk.fields(formId), queryFn: () => listFields(formId) });
  const rq = useQuery({ queryKey: rk.responses(formId), queryFn: () => listResponses(formId), refetchInterval: 30_000 });
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') === 'table' ? 'table' : 'summary';
  const stats = useMemo(() => (fq.data && rq.data ? fq.data.map((f) => fieldStats(f, rq.data)) : []), [fq.data, rq.data]);
  const ov = useMemo(() => (fq.data && rq.data ? overview(fq.data, rq.data) : null), [fq.data, rq.data]);

  if (pq.error) return <div className="p-6"><Alert>{friendlyError(pq.error, 'Questionnaire not found.')}</Alert></div>;
  if (!pq.data || !fq.data || !rq.data) return <PageLoader />;
  const project = pq.data;
  const fields = fq.data;
  const responses = rq.data;

  const exportCsv = () => downloadText(`${safeFileName(project.title)}_responses.csv`, responsesToCsv(fields, responses), 'text/csv');
  const remove = async (id: string, n: number) => {
    if (!window.confirm(`Delete response #${n}? This cannot be undone.`)) return;
    try {
      await deleteResponse(id);
      await qc.invalidateQueries({ queryKey: rk.responses(formId) });
      await qc.invalidateQueries({ queryKey: rk.list });
      toast('Response deleted');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/research/${formId}`} className="text-sm text-slate-600 hover:underline">← Edit questionnaire</Link>
        <span className="flex-1" />
        <StatusBadge status={project.status} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-ink-900">{project.title}</h1>
          <p className="text-sm text-slate-600" data-testid="rh-response-count">{fmt(responses.length)} response{responses.length === 1 ? '' : 's'}</p>
        </div>
        <Link to={`/research/${formId}/report`} className={cx('inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 hover:bg-slate-50', !responses.length && 'pointer-events-none opacity-50')} aria-disabled={!responses.length}>
          PDF report
        </Link>
        <Button onClick={exportCsv} disabled={!responses.length}>Download CSV (Excel/SPSS)</Button>
        <Button variant="ghost" onClick={() => rq.refetch()} loading={rq.isFetching}>Refresh</Button>
      </div>

      {responses.length === 0 ? (
        <EmptyState title="No responses yet">
          {project.status === 'draft' ? 'Publish the questionnaire and share its link to start collecting responses.' : 'Share the link with respondents — answers appear here automatically.'}
        </EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Responses view" className="flex gap-1 border-b border-slate-200">
            {([['summary', 'Summary'], ['table', 'Individual responses']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'table' ? { view: 'table' } : {}, { replace: true })}
                className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'summary' && ov ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Responses" value={fmt(ov.responses)} />
                <Stat label="Questions" value={fields.length} />
                <Stat label="Avg. completion" value={`${ov.completion}%`} sub="share of questions answered" />
                <Stat label="Collected" value={<span className="text-base">{fmtDate(ov.first, false)}</span>} sub={ov.last && ov.first?.slice(0, 10) !== ov.last.slice(0, 10) ? `to ${fmtDate(ov.last, false)}` : undefined} />
              </div>
              {ov.perDay.length > 1 && (
                <Card className="p-4">
                  <h2 className="mb-2 text-sm font-semibold text-ink-900">Responses per day</h2>
                  <PerDayChart days={ov.perDay} />
                </Card>
              )}
              <AiSummaryCard formId={formId} responseCount={responses.length} />
              <div className="space-y-3">
                {stats.map((st, i) => <QuestionStats key={st.fieldId} s={st} index={i} />)}
              </div>
            </div>
          ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2 whitespace-nowrap">Submitted</th>
                  {fields.map((f) => <th key={f.id} className="max-w-[16rem] px-3 py-2">{f.label}</th>)}
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDate(r.submitted_at)}</td>
                    {fields.map((f) => <td key={f.id} className="max-w-[16rem] px-3 py-2 break-words">{answerText(r.answers[f.id]) || <span className="text-slate-300">—</span>}</td>)}
                    <td className="px-3 py-2"><Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(r.id, i + 1)} aria-label={`Delete response ${i + 1}`}>Delete</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          )}
        </>
      )}
      <p className="text-xs text-slate-500">Statistics are calculated from all responses. SD is the sample standard deviation. The CSV opens in Excel, SPSS, Stata or R.</p>
    </div>
  );
}
