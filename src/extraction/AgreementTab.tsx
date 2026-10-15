import { useQuery } from '@tanstack/react-query';
import { getAll, listTeam, studyDetails, xk, type ProgressRow } from '../lib/api/extraction';
import {
  agreement, allExtractionsCsv, characteristicsCsv, MODULES, optionCounts, OVERALL_KEY, tierCounts, type ExtractionData, type ExtractionForm, type ModuleKind,
} from '../lib/extraction/form';
import { downloadText, safeFileName } from '../lib/export/formats';
import { Button, Card, EmptyState, Spinner, Stat } from '../components/ui';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

export function AgreementTab({ kind = 'extraction', projectId, title, form, progress }: { kind?: ModuleKind; projectId: string; title: string; form: ExtractionForm; progress: ProgressRow[] }) {
  const M = MODULES[kind];
  const all = useQuery({ queryKey: xk.all(projectId, kind), queryFn: () => getAll(projectId, kind) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  if (!all.data) return <div className="p-6"><Spinner /></div>;

  const byRef = new Map<string, ExtractionData[]>();
  for (const e of all.data.extractions) if (e.status === 'complete') byRef.set(e.reference_id, [...(byRef.get(e.reference_id) ?? []), e.data]);
  const pairs = [...byRef.values()].filter((x) => x.length >= 2).map((x) => [x[0], x[1]] as [ExtractionData, ExtractionData]);
  const ag = agreement(form, pairs);
  const tiers = kind === 'rob'
    ? optionCounts(form, OVERALL_KEY, progress.map((p) => (p.has_final ? p.final_overall : null)), 'Not yet agreed', ' risk')
    : tierCounts(form, progress.map((p) => (p.has_final ? p.final_tier : null)));
  const finals = new Map(all.data.finals.map((f) => [f.reference_id, f.data]));
  const base = safeFileName(title);

  const downloadTable = async () => {
    const details = new Map((await studyDetails(progress.map((p) => p.reference_id))).map((d) => [d.id, d]));
    const rows = progress.map((p) => ({ study: details.get(p.reference_id)!, data: finals.get(p.reference_id) ?? null })).filter((r) => r.study);
    downloadText(kind === 'rob' ? `${base}_risk_of_bias.csv` : `${base}_characteristics_of_included_studies.csv`, characteristicsCsv(form, rows), 'text/csv');
  };
  const downloadAll = () => {
    const seq = new Map(progress.map((p) => [p.reference_id, p.seq]));
    const email = (id: string) => team.data?.find((t) => t.user_id === id)?.email ?? id;
    downloadText(`${base}_all_${kind === 'rob' ? 'appraisals' : 'extractions'}.csv`, allExtractionsCsv(form, all.data!.extractions
      .filter((e) => seq.has(e.reference_id))
      .map((e) => ({ seq: seq.get(e.reference_id)!, reviewer: email(e.reviewer_id), status: e.status, data: e.data }))), 'text/csv');
  };

  return (
    <div className="space-y-4" data-testid="agreement">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Included studies" value={progress.length} />
        <Stat label={`Final ${M.noun}s`} value={progress.filter((p) => p.has_final).length} tone="include" />
        <Stat label="Double-extracted" value={ag.studies} sub="both reviewers complete" />
        <Stat label="Field agreement" value={pct(ag.agreedCells, ag.cells)} sub={`${ag.agreedCells} of ${ag.cells} answers`} />
      </div>

      {tiers && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-900">{kind === 'rob' ? 'Overall risk of bias (agreed)' : 'Tiers (final extractions)'}</h3>
          <ul className="flex flex-wrap gap-4 text-sm" data-testid="tier-counts">
            {tiers.map((t) => <li key={t.name}><span className="font-semibold tabular-nums">{t.n}</span> {t.name}</li>)}
          </ul>
        </Card>
      )}

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-ink-900">Agreement between reviewers, by field</h3>
        {ag.studies === 0 ? (
          <EmptyState title="Nothing to compare yet">Agreement appears once both reviewers have completed the same study.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1">Field</th><th>Compared</th><th>Agreed</th><th>Cohen’s κ</th></tr></thead>
              <tbody className="tabular-nums">
                {ag.fields.map((x) => (
                  <tr key={x.key} className="border-t border-slate-100">
                    <td className="py-1.5">{x.label}</td><td>{x.compared}</td><td>{x.agreed} ({pct(x.agreed, x.compared)})</td>
                    <td>{x.kappa == null ? '–' : x.kappa.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Compares the first two completed {M.noun}s of each study, before discussion. Text answers count as agreeing when they match ignoring case and spacing. κ is shown for one-choice fields.</p>
          </div>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-ink-900">Export</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={downloadTable} data-testid="table1-download">{kind === 'rob' ? 'Risk-of-bias table (CSV)' : 'Characteristics table (CSV)'}</Button>
          <Button variant="secondary" onClick={downloadAll}>Every reviewer’s {M.noun} (CSV)</Button>
        </div>
        <p className="text-xs text-slate-500">The table uses the final agreed {M.noun}; studies without one have empty cells. CSV files open in Excel and Google Sheets.</p>
      </Card>
    </div>
  );
}
