import { useState } from 'react';
import type { RhField, RhResponse } from '../lib/api/research';
import { crossTab, crossTabCsv, fmtP, isCategorical, round } from '../lib/research/analytics';
import { downloadText, safeFileName } from '../lib/export/formats';
import { Button, Card, EmptyState, Label, Select } from '../components/ui';

/** Two-way table of two choice/scale questions, with row percentages and a chi-square test. */
export function CrossTabPanel({ title, fields, responses }: { title: string; fields: RhField[]; responses: RhResponse[] }) {
  const usable = fields.filter((f) => isCategorical(f.type));
  const [rowId, setRowId] = useState(usable[0]?.id ?? '');
  const [colId, setColId] = useState(usable[1]?.id ?? '');
  const [showPct, setShowPct] = useState(true);
  if (usable.length < 2) {
    return <EmptyState title="Not enough questions to compare">Cross-tabulation needs two multiple-choice, checkbox or scale questions.</EmptyState>;
  }
  const rowF = usable.find((f) => f.id === rowId) ?? usable[0];
  const colF = usable.find((f) => f.id === colId) ?? usable[1];
  const qn = (f: RhField) => `Q${fields.indexOf(f) + 1}. ${f.label}`;
  const t = crossTab(rowF, colF, responses);
  const pct = (c: number, of: number) => (of ? `${round((c / of) * 100, 1)}%` : '–');

  return (
    <div data-testid="rh-crosstab"><Card className="space-y-3 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="ct-row">Rows</Label>
          <Select id="ct-row" value={rowF.id} onChange={(e) => setRowId(e.target.value)}>
            {usable.map((f) => <option key={f.id} value={f.id}>{qn(f).slice(0, 80)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ct-col">Columns</Label>
          <Select id="ct-col" value={colF.id} onChange={(e) => setColId(e.target.value)}>
            {usable.map((f) => <option key={f.id} value={f.id}>{qn(f).slice(0, 80)}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showPct} onChange={(e) => setShowPct(e.target.checked)} /> Show row percentages</label>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => downloadText(`${safeFileName(title)}_crosstab.csv`, crossTabCsv(rowF, colF, t), 'text/csv')}>Download CSV</Button>
      </div>
      {rowF.id === colF.id ? (
        <p className="text-sm text-slate-600">Choose two different questions.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="text-xs text-slate-600">
                  <th className="px-2 py-1 text-left font-semibold">{rowF.label} ↓ / {colF.label} →</th>
                  {t.cols.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold">{c}</th>)}
                  <th className="px-2 py-1 text-left font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {t.rows.map((r, i) => (
                  <tr key={r} className="border-t border-slate-100">
                    <th className="px-2 py-1 text-left font-medium text-slate-800">{r}</th>
                    {t.counts[i].map((c, j) => (
                      <td key={j} className="px-2 py-1">{c}{showPct && <span className="text-slate-500"> ({pct(c, t.rowTotals[i])})</span>}</td>
                    ))}
                    <td className="px-2 py-1 font-medium">{t.rowTotals[i]}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 font-medium">
                  <th className="px-2 py-1 text-left">Total</th>
                  {t.colTotals.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}
                  <td className="px-2 py-1">{t.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-700" data-testid="rh-chi">
            {t.respondents} respondent{t.respondents === 1 ? '' : 's'} answered both questions.{' '}
            {t.chi
              ? <>Chi-square test of independence: χ² = {t.chi.chi2}, df = {t.chi.df}, p = {fmtP(t.chi.p)}{t.chi.p < 0.05 ? ' (the two answers are associated at the 5% level)' : ' (no evidence of an association at the 5% level)'}.</>
              : rowF.type === 'checkbox' || colF.type === 'checkbox'
                ? 'No chi-square test: a checkbox question lets people pick several answers, so the cells overlap.'
                : 'Not enough data for a chi-square test yet.'}
          </p>
          {t.chi && t.chi.lowExpected > 20 && (
            <p className="text-xs text-amber-800">{t.chi.lowExpected}% of cells have an expected count below 5, so the chi-square result is unreliable. Consider combining categories or using Fisher’s exact test in SPSS or R.</p>
          )}
        </>
      )}
    </Card></div>
  );
}
