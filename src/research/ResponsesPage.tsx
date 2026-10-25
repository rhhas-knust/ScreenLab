import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { answerText, deleteResponse, type RhField, getRhProject, listFields, listResponses, responsesToCsv, rk } from '../lib/api/research';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, Button, Card, EmptyState, PageLoader, Select, Stat, cx } from '../components/ui';
import { applyFilters, categories, fieldStats, isCategorical, overview, type Filter } from '../lib/research/analytics';
import { CrossTabPanel } from './CrossTabPanel';
import { ChartStudio } from './ChartStudio';
import { CodingPanel } from './CodingPanel';
import { PerDayChart } from './Charts';
import { QuestionStats } from './QuestionStats';
import { AiSummaryCard } from './AiSummaryCard';
import { useToast } from '../components/Toast';
import { StatusBadge } from './StatusBadge';
import { ShareResultsButton } from './ShareResultsDialog';

export function ResponsesPage() {
  const { formId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const pq = useQuery({ queryKey: rk.project(formId), queryFn: () => getRhProject(formId), retry: 1 });
  const fq = useQuery({ queryKey: rk.fields(formId), queryFn: () => listFields(formId) });
  const rq = useQuery({ queryKey: rk.responses(formId), queryFn: () => listResponses(formId), refetchInterval: 30_000 });
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const tab = view === 'table' || view === 'crosstab' || view === 'coding' || view === 'studio' ? view : 'summary';
  const [filters, setFilters] = useState<Filter[]>([]);
  const filtered = useMemo(() => (fq.data && rq.data ? applyFilters(fq.data, rq.data, filters) : []), [fq.data, rq.data, filters]);
  const stats = useMemo(() => (fq.data ? fq.data.map((f) => fieldStats(f, filtered)) : []), [fq.data, filtered]);
  const ov = useMemo(() => (fq.data && rq.data ? overview(fq.data, filtered) : null), [fq.data, rq.data, filtered]);

  if (pq.error) return <div className="p-6"><Alert>{friendlyError(pq.error, 'Questionnaire not found.')}</Alert></div>;
  if (!pq.data || !fq.data || !rq.data) return <PageLoader />;
  const project = pq.data;
  const fields = fq.data;
  const responses = rq.data;

  const isFiltered = filtered.length !== responses.length || filters.length > 0;
  const exportCsv = () => downloadText(`${safeFileName(project.title)}_responses${isFiltered ? '_filtered' : ''}.csv`, responsesToCsv(fields, filtered, project.translations ?? {}), 'text/csv');
  const num = new Map(responses.map((r, i) => [r.id, i + 1]));
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
        <ShareResultsButton project={project} />
        <Button onClick={exportCsv} disabled={!filtered.length}>Download CSV (Excel/SPSS){isFiltered ? ` · ${filtered.length} filtered` : ''}</Button>
        <Button variant="ghost" onClick={() => rq.refetch()} loading={rq.isFetching}>Refresh</Button>
      </div>

      {responses.length === 0 ? (
        <EmptyState title="No responses yet">
          {project.status === 'draft' ? 'Publish the questionnaire and share its link to start collecting responses.' : 'Share the link with respondents — answers appear here automatically.'}
        </EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Responses view" className="flex gap-1 border-b border-slate-200">
            {([['summary', 'Summary'], ['studio', 'Chart studio'], ['crosstab', 'Cross-tab'], ['coding', 'Code open answers'], ['table', 'Individual responses']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'summary' ? {} : { view: k }, { replace: true })}
                className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
                {label}
              </button>
            ))}
          </div>
          <FilterBar fields={fields} filters={filters} onChange={setFilters} matched={filtered.length} total={responses.length} />
          {tab === 'studio' ? (
            <ChartStudio key={params.get('x') ?? ''} title={project.title} fields={fields} responses={filtered} initialVar={params.get('x')} />
          ) : tab === 'crosstab' ? (
            <CrossTabPanel title={project.title} fields={fields} responses={filtered} />
          ) : tab === 'coding' ? (
            <CodingPanel formId={formId} fields={fields} responses={filtered} allResponses={responses} />
          ) : tab === 'summary' && ov ? (
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
              {!isFiltered && <AiSummaryCard formId={formId} responseCount={responses.length} />}
              <div className="space-y-3">
                {stats.map((st, i) => <QuestionStats key={st.fieldId} s={st} index={i} onChart={(x) => setParams({ view: 'studio', x }, { replace: true })} />)}
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
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{num.get(r.id)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDate(r.submitted_at)}</td>
                    {fields.map((f) => <td key={f.id} className="max-w-[16rem] px-3 py-2 break-words">{answerText(r.answers[f.id]) || <span className="text-slate-300">—</span>}</td>)}
                    <td className="px-3 py-2"><Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(r.id, num.get(r.id)!)} aria-label={`Delete response ${num.get(r.id)}`}>Delete</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          )}
        </>
      )}
      <p className="text-xs text-slate-500">Statistics are calculated from {isFiltered ? 'the filtered' : 'all'} responses. SD is the sample standard deviation. The CSV opens in Excel, SPSS, Stata or R; Chart studio also downloads MATLAB, R, SPSS and Stata scripts.</p>
    </div>
  );
}

/** "Only respondents who answered …" filters, combined with AND. */
function FilterBar({ fields, filters, onChange, matched, total }: { fields: RhField[]; filters: Filter[]; onChange: (f: Filter[]) => void; matched: number; total: number }) {
  const usable = fields.filter((f) => isCategorical(f.type));
  const [fid, setFid] = useState('');
  if (!usable.length) return null;
  const f = usable.find((x) => x.id === fid);
  const label = (id: string) => { const x = fields.find((y) => y.id === id); return x ? `Q${fields.indexOf(x) + 1}` : '?'; };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm" data-testid="rh-filters">
      <span className="font-medium text-slate-700">Filter:</span>
      {filters.map((x, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2.5 py-0.5 text-xs text-white">
          {label(x.field)} = {x.value}
          <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <Select aria-label="Filter question" className="h-8 w-auto max-w-[14rem] py-1 text-sm" value={fid} onChange={(e) => setFid(e.target.value)}>
        <option value="">+ Add a filter…</option>
        {usable.map((x) => <option key={x.id} value={x.id}>Q{fields.indexOf(x) + 1}. {x.label.slice(0, 50)}</option>)}
      </Select>
      {f && (
        <Select aria-label="Filter answer" className="h-8 w-auto max-w-[12rem] py-1 text-sm" value="" onChange={(e) => { if (e.target.value) { onChange([...filters, { field: f.id, value: e.target.value }]); setFid(''); } }}>
          <option value="">…is</option>
          {categories(f).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      )}
      {filters.length > 0 && <span className="text-slate-600" data-testid="rh-filter-count">{matched} of {total} responses</span>}
    </div>
  );
}
