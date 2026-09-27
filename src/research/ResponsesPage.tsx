import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { answerText, deleteResponse, getRhProject, listFields, listResponses, responsesToCsv, rk } from '../lib/api/research';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate } from '../lib/hooks';
import { Alert, Button, Card, EmptyState, PageLoader } from '../components/ui';
import { useToast } from '../components/Toast';
import { StatusBadge } from './StatusBadge';

export function ResponsesPage() {
  const { formId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const pq = useQuery({ queryKey: rk.project(formId), queryFn: () => getRhProject(formId), retry: 1 });
  const fq = useQuery({ queryKey: rk.fields(formId), queryFn: () => listFields(formId) });
  const rq = useQuery({ queryKey: rk.responses(formId), queryFn: () => listResponses(formId), refetchInterval: 30_000 });

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
        <Button onClick={exportCsv} disabled={!responses.length}>Download CSV (Excel/SPSS)</Button>
        <Button variant="ghost" onClick={() => rq.refetch()} loading={rq.isFetching}>Refresh</Button>
      </div>

      {responses.length === 0 ? (
        <EmptyState title="No responses yet">
          {project.status === 'draft' ? 'Publish the questionnaire and share its link to start collecting responses.' : 'Share the link with respondents — answers appear here automatically.'}
        </EmptyState>
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
      <p className="text-xs text-slate-500">Charts and statistics for each question are coming next. The CSV opens in Excel, SPSS, Stata or R.</p>
    </div>
  );
}
