import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { answerText, deleteResponse, fileUrl, isFileAnswer, type DashboardItem, type RhField, getRhProject, latestSummary, listFields, listResponses, responsesToCsv, rk, updateRhProject } from '../lib/api/research';
import { scoreResponses } from '../lib/research/formula';
import { analysed, qualityFlags } from '../lib/research/quality';
import { computeWeights } from '../lib/research/weights';
import { buildDataset } from '../lib/research/studio';
import { CleanWeightPanel } from './CleanWeightPanel';
import { RegressionPanel } from './RegressionPanel';
import { DashboardPanel } from './DashboardPanel';
import { ConnectPanel } from './ConnectPanel';
import { newItemId } from '../lib/research/dashboard';
import { quotaCount } from './QuotasEditor';
import { downloadBlob, downloadText, safeFileName } from '../lib/export/formats';
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
  const tab = view === 'table' || view === 'crosstab' || view === 'coding' || view === 'studio' || view === 'regression' || view === 'clean' || view === 'dashboard' || view === 'connect' ? view : 'summary';
  const [filters, setFilters] = useState<Filter[]>([]);
  // Calculated scores are worked out from the answers here, so every view, chart and download has them.
  const scored = useMemo(() => (fq.data && rq.data ? scoreResponses(fq.data, rq.data) : null), [fq.data, rq.data]);
  const [includeSetAside, setIncludeSetAside] = useState(false);
  const [makingDoc, setMakingDoc] = useState(false);
  const analysis = pq.data?.analysis;
  const flags = useMemo(() => (fq.data && scored ? qualityFlags(fq.data, scored, { speederRatio: analysis?.quality?.speeder_ratio, minCompletion: analysis?.quality?.min_completion }) : new Map()), [fq.data, scored, analysis?.quality]);
  // Set-aside responses leave every analysis; weights are worked out on what remains.
  const active = useMemo(() => (scored ? analysed(scored, includeSetAside) : []), [scored, includeSetAside]);
  const weighting = useMemo(() => (fq.data && analysis?.weighting?.enabled && analysis.weighting.targets?.length ? computeWeights(fq.data, active, analysis.weighting.targets) : null), [fq.data, active, analysis?.weighting]);
  const weights = weighting && !weighting.errors.length ? weighting.weights : null;
  const filtered = useMemo(() => (fq.data ? applyFilters(fq.data, active, filters) : []), [fq.data, active, filters]);
  const stats = useMemo(() => (fq.data ? fq.data.map((f) => fieldStats(f, filtered, weights)) : []), [fq.data, filtered, weights]);
  const regData = useMemo(() => (fq.data ? buildDataset(fq.data, filtered, weights) : null), [fq.data, filtered, weights]);
  const ov = useMemo(() => (fq.data && scored ? overview(fq.data, filtered) : null), [fq.data, scored, filtered]);

  if (pq.error) return <div className="p-6"><Alert>{friendlyError(pq.error, 'Questionnaire not found.')}</Alert></div>;
  if (!pq.data || !fq.data || !scored) return <PageLoader />;
  const project = pq.data;
  const fields = fq.data;
  const responses = scored;
  const quotas = (project.form_options?.quotas ?? []).filter((q) => q.value && q.limit);

  const setAside = responses.filter((r) => r.excluded).length;
  const isFiltered = filtered.length !== active.length || filters.length > 0;
  const exportCsv = () => downloadText(`${safeFileName(project.title)}_responses${isFiltered ? '_filtered' : ''}.csv`, responsesToCsv(fields, filtered, project.translations ?? {}, weights), 'text/csv');
  const num = new Map(responses.map((r, i) => [r.id, i + 1]));
  const wordReport = async () => {
    setMakingDoc(true);
    try {
      const [{ buildWordReport }, summary] = await Promise.all([import('./wordReport'), latestSummary(formId).catch(() => null)]);
      const blob = await buildWordReport({ project, fields, responses: active, setAside: responses.filter((r) => r.excluded).length, weights, weighting, summary, dashboard: analysis?.dashboard ?? [] });
      downloadBlob(`${safeFileName(project.title)}_findings_report.docx`, blob);
    } catch (e) {
      toast(friendlyError(e, 'The Word report could not be made.'), { kind: 'error' });
    } finally {
      setMakingDoc(false);
    }
  };
  const saveDashboard = async (dashboard: DashboardItem[], done?: string) => {
    try {
      qc.setQueryData(rk.project(formId), await updateRhProject(formId, { analysis: { ...project.analysis, dashboard } }));
      if (done) toast(done);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };
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
          {setAside > 0 && <p className="text-xs text-slate-500" data-testid="rh-setaside-count">{setAside} set aside {includeSetAside ? '(included in this view)' : 'and left out of the analysis'}</p>}
        </div>
        <Link to={`/research/${formId}/report`} className={cx('inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 hover:bg-slate-50', !responses.length && 'pointer-events-none opacity-50')} aria-disabled={!responses.length}>
          PDF report
        </Link>
        <Button variant="secondary" onClick={wordReport} loading={makingDoc} disabled={!active.length} data-testid="rh-word-report">Word report</Button>
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
            {([['summary', 'Summary'], ['dashboard', 'Dashboard'], ['studio', 'Chart studio'], ['regression', 'Regression'], ['crosstab', 'Cross-tab'], ['coding', 'Code open answers'], ['clean', 'Clean & weight'], ['table', 'Individual responses'], ['connect', 'Connect']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'summary' ? {} : { view: k }, { replace: true })}
                className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
                {label}
              </button>
            ))}
          </div>
          {tab !== 'clean' && tab !== 'connect' && <FilterBar fields={fields} filters={filters} onChange={setFilters} matched={filtered.length} total={active.length} />}
          {tab !== 'clean' && tab !== 'connect' && (weighting || setAside > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="rh-analysis-status">
              {weighting && (weighting.errors.length
                ? <span className="text-amber-800">Weighting is on but cannot be applied: {weighting.errors[0]} <button type="button" className="underline" onClick={() => setParams({ view: 'clean' }, { replace: true })}>Fix it</button></span>
                : <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-violet-900" data-testid="rh-weighted-status">Weighted results · design effect {weighting.deff} · effective n {Math.round(weighting.neff)}</span>)}
              {setAside > 0 && <label className="flex items-center gap-1.5 text-slate-700"><input type="checkbox" checked={includeSetAside} onChange={(e) => setIncludeSetAside(e.target.checked)} /> Include the {setAside} set-aside response{setAside === 1 ? '' : 's'}</label>}
            </div>
          )}
          {tab === 'connect' ? (
            <ConnectPanel project={project} />
          ) : tab === 'dashboard' && regData ? (
            <DashboardPanel items={analysis?.dashboard ?? []} ds={regData} completion={ov?.completion ?? 0} editable onChange={saveDashboard}
              onOpenStudio={() => setParams({ view: 'studio' }, { replace: true })} />
          ) : tab === 'clean' ? (
            <CleanWeightPanel project={project} fields={fields} responses={responses} flags={flags} />
          ) : tab === 'regression' && regData ? (
            <RegressionPanel title={project.title} ds={regData} />
          ) : tab === 'studio' ? (
            <ChartStudio key={params.get('x') ?? ''} title={project.title} fields={fields} responses={filtered} weights={weights} initialVar={params.get('x')}
              onPin={(spec) => void saveDashboard([...(analysis?.dashboard ?? []), { id: newItemId(), kind: 'chart', spec }], 'Pinned to the dashboard')} />
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
              {quotas.length > 0 && (
                <div data-testid="rh-quota-status"><Card className="p-4">
                  <h2 className="mb-2 text-sm font-semibold text-ink-900">Quotas</h2>
                  <ul className="space-y-1 text-sm">
                    {quotas.map((q, i) => {
                      const f = fields.find((x) => x.id === q.field);
                      const n = quotaCount(q, rq.data ?? []);
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1">Q{f ? fields.indexOf(f) + 1 : '?'} = “{q.value}”</span>
                          <span className="tabular-nums">{n} / {q.limit}</span>
                          {n >= q.limit && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">full</span>}
                        </li>
                      );
                    })}
                  </ul>
                </Card></div>
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
                    {fields.map((f) => <td key={f.id} className="max-w-[16rem] px-3 py-2 break-words">{isFileAnswer(r.answers[f.id]) ? <FileLink path={r.answers[f.id] as unknown as { file: string }} name={answerText(r.answers[f.id])} /> : answerText(r.answers[f.id]) || <span className="text-slate-300">—</span>}</td>)}
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

/** Opens an uploaded file or signature through a short-lived private link. */
function FileLink({ path, name }: { path: { file: string }; name: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try { window.open(await fileUrl(path.file), '_blank', 'noopener'); } catch (e) { toast(friendlyError(e, 'Could not open the file.'), { kind: 'error' }); } finally { setBusy(false); }
  };
  return <button type="button" className="text-left text-ink-700 underline disabled:opacity-50" onClick={open} disabled={busy} data-testid="rh-file-link">📎 {name}</button>;
}
