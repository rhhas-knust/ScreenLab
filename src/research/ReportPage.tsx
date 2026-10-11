import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getRhProject, latestSummary, listFields, listResponses, rk } from '../lib/api/research';
import { fieldStats, overview } from '../lib/research/analytics';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, Button, PageLoader } from '../components/ui';
import { PerDayChart } from './Charts';
import { QuestionStats } from './QuestionStats';
import { SummaryBody } from './AiSummaryCard';

/**
 * Print-ready findings report. "Save as PDF" in the browser's print dialog
 * produces the PDF, so no PDF library ships to every visitor and the report
 * looks exactly like the screen.
 */
export function ReportPage() {
  const { formId = '' } = useParams();
  const pq = useQuery({ queryKey: rk.project(formId), queryFn: () => getRhProject(formId), retry: 1 });
  const fq = useQuery({ queryKey: rk.fields(formId), queryFn: () => listFields(formId) });
  const rq = useQuery({ queryKey: rk.responses(formId), queryFn: () => listResponses(formId) });
  const sq = useQuery({ queryKey: rk.summary(formId), queryFn: () => latestSummary(formId) });
  const stats = useMemo(() => (fq.data && rq.data ? fq.data.map((f) => fieldStats(f, rq.data)) : []), [fq.data, rq.data]);
  const ov = useMemo(() => (fq.data && rq.data ? overview(fq.data, rq.data) : null), [fq.data, rq.data]);

  useEffect(() => {
    if (pq.data) document.title = `${pq.data.title} — findings report`;
    return () => { document.title = 'ScreenLab'; };
  }, [pq.data]);

  if (pq.error) return <div className="p-6"><Alert>{friendlyError(pq.error, 'Questionnaire not found.')}</Alert></div>;
  if (!pq.data || !fq.data || !rq.data || !ov || sq.isLoading) return <PageLoader label="Preparing report…" />;
  const p = pq.data;
  const meta = [p.university, p.department, p.year].filter(Boolean).join(' · ');

  return (
    <div className="bg-slate-100 print:bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
        <Link to={`/research/${formId}/responses`} className="text-sm text-slate-600 hover:underline">← Back to responses</Link>
        <span className="flex-1" />
        <span className="hidden text-xs text-slate-500 sm:inline">In the print dialog choose “Save as PDF”.</span>
        <Button onClick={() => window.print()} data-testid="rh-print">Print / Save as PDF</Button>
      </div>

      <main className="mx-auto max-w-3xl space-y-6 bg-white p-6 sm:my-6 sm:rounded-xl sm:p-10 print:my-0 print:max-w-none print:p-0" data-testid="rh-report">
        <header className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Survey findings report</p>
          <h1 className="text-2xl font-semibold text-ink-900">{p.title}</h1>
          {meta && <p className="text-sm text-slate-600">{meta}</p>}
          <p className="text-sm text-slate-600">
            {fmt(ov.responses)} response{ov.responses === 1 ? '' : 's'}
            {ov.first && ` · collected ${fmtDate(ov.first, false)}${ov.last && ov.last.slice(0, 10) !== ov.first.slice(0, 10) ? ` to ${fmtDate(ov.last, false)}` : ''}`}
            {` · average completion ${ov.completion}%`}
          </p>
          {p.description && <p className="pt-2 text-sm text-slate-700">{p.description}</p>}
        </header>

        {sq.data && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink-900">Summary of findings</h2>
            <SummaryBody s={sq.data} />
          </section>
        )}

        {ov.perDay.length > 1 && (
          <section className="break-inside-avoid space-y-2">
            <h2 className="text-lg font-semibold text-ink-900">Responses per day</h2>
            <PerDayChart days={ov.perDay} />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-ink-900">Results by question</h2>
          {stats.map((s, i) => <QuestionStats key={s.fieldId} s={s} index={i} />)}
        </section>

        <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          Generated {fmtDate(new Date().toISOString())} with ResearchHub. Percentages are of respondents who answered each question; SD is the sample standard deviation.
        </footer>
      </main>
    </div>
  );
}
