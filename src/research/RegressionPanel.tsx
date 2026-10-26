import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { describeFit, fitModel, fitTable, fmtPv, modelVars, type ModelSpec } from '../lib/research/regression';
import { modelScript } from '../lib/research/modelScripts';
import { SCRIPT_NAME, type ScriptLang } from '../lib/research/exportPack';
import { findVar, isCat, numsOf, type Dataset } from '../lib/research/studio';
import { round } from '../lib/research/analytics';
import { downloadText, safeFileName } from '../lib/export/formats';
import { Alert, Button, Card, Label, Select, cx } from '../components/ui';

const EXT: Record<ScriptLang, string> = { r: 'R', matlab: 'm', spss: 'sps', stata: 'do' };

/** Linear and logistic regression with plain-language results and scripts to re-run them elsewhere. */
export function RegressionPanel({ title, ds }: { title: string; ds: Dataset }) {
  const vars = modelVars(ds);
  const outcomes = vars.filter((v) => v.kind !== 'multi' || v.categories.length > 0);
  const [spec, setSpec] = useState<ModelSpec>(() => {
    const y = outcomes.find((v) => v.kind === 'numeric') ?? outcomes[0];
    return { outcome: y?.name ?? '', predictors: vars.filter((v) => v.name !== y?.name).slice(0, 2).map((v) => v.name), weighted: !!ds.weights };
  });
  const y = findVar(ds, spec.outcome);
  const kind = spec.kind ?? (y?.kind === 'numeric' ? 'linear' : 'logistic');
  const eventChoices = y ? (y.kind === 'numeric' && !y.scale ? [...new Set(numsOf(y).filter((v) => v != null).map(String))].sort((a, b) => Number(a) - Number(b)) : isCat(y) ? y.categories : []) : [];
  const fit = useMemo(() => (spec.outcome ? fitModel(ds, { ...spec, kind, weighted: spec.weighted && !!ds.weights }) : 'Choose the outcome question.'), [ds, spec, kind]);
  const ok = typeof fit !== 'string';
  const toggle = (name: string) => setSpec((s) => ({ ...s, predictors: s.predictors.includes(name) ? s.predictors.filter((p) => p !== name) : [...s.predictors, name] }));
  const base = `${safeFileName(title)}_${kind}_regression_${spec.outcome}`;
  const csv = () => ok && downloadText(`${base}.csv`, '﻿' + Papa.unparse(fitTable(fit).map((r) => r.map(String))), 'text/csv');
  const script = (l: ScriptLang) => ok && downloadText(`${base}.${EXT[l]}`, modelScript(l, { ...spec, kind }, ds, fit), 'text/plain');
  const n2 = (v: number) => String(round(v, 3));

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]" data-testid="rh-regression">
      <Card className="space-y-3 p-4">
        <div>
          <Label htmlFor="rg-y">Outcome (what you want to explain)</Label>
          <Select id="rg-y" value={spec.outcome} onChange={(e) => setSpec((s) => ({ ...s, outcome: e.target.value, kind: undefined, event: undefined, predictors: s.predictors.filter((p) => p !== e.target.value) }))}>
            {outcomes.map((v) => <option key={v.name} value={v.name}>{v.name}. {v.label.slice(0, 60)}</option>)}
          </Select>
        </div>
        {y && (
          <div>
            <Label htmlFor="rg-kind">Model</Label>
            <Select id="rg-kind" value={kind} onChange={(e) => setSpec((s) => ({ ...s, kind: e.target.value as 'linear' | 'logistic' }))}>
              {y.kind === 'numeric' && <option value="linear">Linear (a number or score)</option>}
              <option value="logistic">Logistic (yes/no — one answer vs the rest)</option>
            </Select>
          </div>
        )}
        {kind === 'logistic' && eventChoices.length > 0 && (
          <div>
            <Label htmlFor="rg-event">Counts as “yes” (1)</Label>
            <Select id="rg-event" value={spec.event ?? (eventChoices.length === 2 ? eventChoices[1] : '')} onChange={(e) => setSpec((s) => ({ ...s, event: e.target.value }))}>
              {eventChoices.length !== 2 && !spec.event && <option value="">(choose an answer)</option>}
              {eventChoices.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Predictors (what might explain it)</legend>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {vars.filter((v) => v.name !== spec.outcome).map((v) => (
              <label key={v.name} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={spec.predictors.includes(v.name)} onChange={() => toggle(v.name)} />
                <span><span className="font-medium">{v.name}</span> {v.label.slice(0, 60)} <span className="text-xs text-slate-500">({v.kind === 'numeric' ? (v.scale ? 'scale' : 'number') : v.kind === 'multi' ? 'checkboxes' : 'choice'})</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {ds.weights && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!spec.weighted} onChange={(e) => setSpec((s) => ({ ...s, weighted: e.target.checked }))} data-testid="rg-weighted" /> Use survey weights</label>
        )}
        <p className="text-xs text-slate-500">Choice questions are compared with their first answer (the reference group). Unticked checkboxes count as 0. Respondents missing any of these questions are left out.</p>
      </Card>

      <div className="min-w-0 space-y-3">
        {!ok ? <Alert kind="info">{fit}</Alert> : (
          <Card className="space-y-3 p-4">
            <div className="space-y-1 text-sm text-slate-800" data-testid="rh-regression-summary">
              {describeFit(fit, ds).map((l, i) => <p key={i} className={i === 0 ? 'font-medium text-ink-900' : ''}>{l}</p>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm" data-testid="rh-regression-table">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-600">
                    <th className="px-2 py-1 text-left">Term</th>
                    <th className="px-2 py-1 text-right">{fit.kind === 'linear' ? 'Estimate' : 'Odds ratio'}</th>
                    <th className="px-2 py-1 text-right">95% CI</th>
                    <th className="px-2 py-1 text-right">Std. error</th>
                    <th className="px-2 py-1 text-right">{fit.kind === 'linear' ? 't' : 'z'}</th>
                    <th className="px-2 py-1 text-right">p</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {fit.terms.map((t, i) => (
                    <tr key={t.name} className={cx('border-t border-slate-100', i > 0 && t.p < 0.05 && 'bg-emerald-50/60')}>
                      <td className="px-2 py-1 text-left">{t.label}</td>
                      <td className="px-2 py-1 text-right">{fit.kind === 'linear' ? n2(t.estimate) : n2(t.or!)}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{fit.kind === 'linear' ? `${n2(t.lo)} to ${n2(t.hi)}` : `${n2(t.orLo!)} to ${n2(t.orHi!)}`}</td>
                      <td className="px-2 py-1 text-right">{n2(t.se)}</td>
                      <td className="px-2 py-1 text-right">{round(t.stat, 2)}</td>
                      <td className="px-2 py-1 text-right">{fmtPv(t.p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {fit.kind === 'linear'
                ? `n = ${fit.n} · R² = ${n2(fit.r2)} · adjusted R² = ${n2(fit.adjR2)} · residual SD = ${n2(fit.sigma)}`
                : `n = ${fit.n} (${fit.events} “${fit.event}”) · deviance ${round(fit.deviance, 2)} on ${fit.n - fit.terms.length} df · AIC ${round(fit.aic, 1)}`}
              {Object.keys(fit.reference).length > 0 && ` · reference groups: ${Object.entries(fit.reference).map(([k, v]) => `${k} = “${v}”`).join(', ')}`}
              {fit.weighted && ' · weighted (standard errors treat weights as frequency weights; use the survey package for design-based ones)'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={csv} data-testid="rh-regression-csv">Table (CSV)</Button>
              <span className="text-xs text-slate-600">Re-run it in:</span>
              {(['r', 'matlab', 'spss', 'stata'] as ScriptLang[]).map((l) => (
                <button key={l} type="button" className="text-xs text-ink-700 underline" onClick={() => script(l)} data-testid={`rh-regression-${l}`}>{SCRIPT_NAME[l]}</button>
              ))}
              <span className="text-xs text-slate-500">(with data.csv from the Chart studio download)</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
