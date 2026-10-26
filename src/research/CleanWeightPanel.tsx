import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rk, setExcluded, updateRhProject, type AnalysisOptions, type RhField, type RhProject, type RhResponse, type WeightTarget } from '../lib/api/research';
import { categories } from '../lib/research/analytics';
import { FLAG_LABEL, fmtDuration, type FlagKind, type QualityFlag } from '../lib/research/quality';
import { canWeightBy, computeWeights, sampleShares } from '../lib/research/weights';
import { friendlyError } from '../lib/errors';
import { fmtDate } from '../lib/hooks';
import { Alert, Button, Card, Input, Select, cx } from '../components/ui';
import { useToast } from '../components/Toast';

const KINDS: FlagKind[] = ['speeder', 'straightline', 'duplicate', 'incomplete'];

/**
 * Data quality (review flagged responses, set them aside) and weighting
 * (population targets). Nothing is deleted: set-aside responses stay in the
 * table and can be brought back.
 */
export function CleanWeightPanel({ project, fields, responses, flags }: {
  project: RhProject;
  fields: RhField[];
  /** All responses, including set-aside ones, in submission order. */
  responses: RhResponse[];
  flags: Map<string, QualityFlag[]>;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const analysis = project.analysis ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [show, setShow] = useState<FlagKind | 'all' | 'excluded'>('all');
  const num = new Map(responses.map((r, i) => [r.id, i + 1]));

  const saveAnalysis = async (next: AnalysisOptions, done: string) => {
    setBusy('save');
    try {
      qc.setQueryData(rk.project(project.id), await updateRhProject(project.id, { analysis: next }));
      toast(done);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const exclude = async (ids: string[], on: boolean, reason: string | null) => {
    setBusy(on ? 'exclude' : 'restore');
    try {
      await setExcluded(ids, on, reason);
      await qc.invalidateQueries({ queryKey: rk.responses(project.id) });
      toast(on ? `${ids.length} response${ids.length === 1 ? '' : 's'} set aside from the analysis` : `${ids.length} response${ids.length === 1 ? '' : 's'} brought back`);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const flagged = responses.filter((r) => flags.get(r.id)?.length);
  const counts = Object.fromEntries(KINDS.map((k) => [k, responses.filter((r) => !r.excluded && flags.get(r.id)?.some((f) => f.kind === k)).length])) as Record<FlagKind, number>;
  const excludedRs = responses.filter((r) => r.excluded);
  const list = show === 'excluded' ? excludedRs
    : flagged.filter((r) => show === 'all' || flags.get(r.id)!.some((f) => f.kind === show));
  const pendingIds = list.filter((r) => !r.excluded).map((r) => r.id);
  const reasonOf = (r: RhResponse) => (flags.get(r.id) ?? []).map((f) => FLAG_LABEL[f.kind]).join(', ') || 'Set aside by the researcher';
  const timed = responses.filter((r) => typeof r.duration_s === 'number').length;

  return (
    <div className="space-y-5" data-testid="rh-clean">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-semibold text-ink-900">Data quality</h2>
          <label className="flex items-center gap-1.5 text-sm">Too fast:
            <Select aria-label="Speeder threshold" className="h-8 w-auto py-0.5" value={analysis.quality?.speeder_ratio ?? 0.4} disabled={!!busy}
              onChange={(e) => saveAnalysis({ ...analysis, quality: { ...analysis.quality, speeder_ratio: Number(e.target.value) } }, 'Threshold saved')}>
              {[0.3, 0.4, 0.5].map((v) => <option key={v} value={v}>under {v * 100}% of the typical time</option>)}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">Mostly blank:
            <Select aria-label="Completion threshold" className="h-8 w-auto py-0.5" value={analysis.quality?.min_completion ?? 0.5} disabled={!!busy}
              onChange={(e) => saveAnalysis({ ...analysis, quality: { ...analysis.quality, min_completion: Number(e.target.value) } }, 'Threshold saved')}>
              {[0.25, 0.5, 0.75].map((v) => <option key={v} value={v}>under {v * 100}% answered</option>)}
            </Select>
          </label>
        </div>
        <p className="text-sm text-slate-600">
          These checks only <em>flag</em> responses for you to look at. Setting one aside removes it from statistics, charts, regression and downloads — it is never deleted, and you can bring it back.
          {timed < responses.length && ` Time taken is known for ${timed} of ${responses.length} responses (it is recorded from this update on).`}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {([['all', `All flagged (${flagged.filter((r) => !r.excluded).length})`], ...KINDS.map((k) => [k, `${FLAG_LABEL[k]} (${counts[k]})`]), ['excluded', `Set aside (${excludedRs.length})`]] as [typeof show, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setShow(k)} aria-pressed={show === k} data-testid={`rh-flag-${k}`}
              className={cx('rounded-full border px-3 py-1 text-sm', show === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {label}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-slate-500" data-testid="rh-clean-empty">{show === 'excluded' ? 'No responses have been set aside.' : 'Nothing flagged here.'}</p>
        ) : (
          <>
            {pendingIds.length > 0 && show !== 'excluded' && (
              <Button size="sm" variant="secondary" loading={busy === 'exclude'} data-testid="rh-exclude-all"
                onClick={() => { if (window.confirm(`Set aside ${pendingIds.length} flagged response${pendingIds.length === 1 ? '' : 's'} from the analysis? You can bring them back at any time.`)) void exclude(pendingIds, true, show === 'all' ? 'Flagged by data-quality checks' : FLAG_LABEL[show as FlagKind]); }}>
                Set aside all {pendingIds.length} shown
              </Button>
            )}
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                  <tr><th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Submitted</th><th className="px-2 py-1.5 text-left">Time taken</th><th className="px-2 py-1.5 text-left">Why</th><th className="px-2 py-1.5"><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={cx('border-t border-slate-100 align-top', r.excluded && 'bg-slate-50 text-slate-500')} data-testid="rh-flag-row">
                      <td className="px-2 py-1.5 tabular-nums">{num.get(r.id)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(r.submitted_at)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{typeof r.duration_s === 'number' ? fmtDuration(r.duration_s) : '—'}</td>
                      <td className="px-2 py-1.5">
                        {(flags.get(r.id) ?? []).map((f, i) => <div key={i}><span className="font-medium">{FLAG_LABEL[f.kind]}:</span> {f.detail}</div>)}
                        {r.excluded && <div className="text-xs">Set aside{r.exclude_reason ? ` — ${r.exclude_reason}` : ''}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {r.excluded
                          ? <Button size="sm" variant="ghost" onClick={() => exclude([r.id], false, null)} disabled={!!busy}>Bring back</Button>
                          : <Button size="sm" variant="ghost" onClick={() => exclude([r.id], true, reasonOf(r))} disabled={!!busy}>Set aside</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <WeightingCard project={project} fields={fields} responses={responses.filter((r) => !r.excluded)} busy={busy === 'save'}
        onSave={(w) => saveAnalysis({ ...analysis, weighting: w }, w.enabled ? 'Weights saved and switched on' : 'Weighting switched off')} />
    </div>
  );
}

function WeightingCard({ project, fields, responses, busy, onSave }: {
  project: RhProject; fields: RhField[]; responses: RhResponse[]; busy: boolean;
  onSave: (w: NonNullable<AnalysisOptions['weighting']>) => void;
}) {
  const saved = project.analysis?.weighting;
  const [targets, setTargets] = useState<WeightTarget[]>(saved?.targets ?? []);
  const usable = fields.filter((f) => canWeightBy(f) && f.label.trim());
  const preview = useMemo(() => (targets.length ? computeWeights(fields, responses, targets) : null), [fields, responses, targets]);
  const dirty = JSON.stringify(targets) !== JSON.stringify(saved?.targets ?? []);
  const set = (i: number, patch: Partial<WeightTarget>) => setTargets((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold text-ink-900">Weighting</h2>
        {saved?.enabled && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-900" data-testid="rh-weighting-on">On</span>}
      </div>
      <p className="text-sm text-slate-600">
        If some groups answered more than others (say 70% women when the population is 52%), enter the real population shares. ResearchHub gives each respondent a weight so the results represent the population (raking, as in R’s <code>survey</code> package). Weighted percentages and means appear in the Summary, Chart studio and Regression; counts of people stay as they are.
      </p>
      {targets.map((t, i) => {
        const f = fields.find((x) => x.id === t.field);
        const sample = f ? sampleShares(f, responses) : {};
        const got = preview?.achieved.find((a) => a.field === t.field)?.shares ?? {};
        const total = f ? categories(f).reduce((s, c) => s + (t.targets[c] ?? 0), 0) : 0;
        return (
          <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="rh-weight-target">
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Weighting question ${i + 1}`} className="max-w-md" value={t.field} onChange={(e) => set(i, { field: e.target.value, targets: {} })}>
                {usable.map((x) => <option key={x.id} value={x.id}>Q{fields.indexOf(x) + 1}. {x.label.slice(0, 70)}</option>)}
              </Select>
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setTargets((ts) => ts.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {f && (
              <table className="w-full max-w-xl text-sm">
                <thead><tr className="text-xs text-slate-600"><th className="py-1 text-left">Answer</th><th className="py-1 text-right">In your sample</th><th className="py-1 text-right">In the population</th><th className="py-1 text-right">After weighting</th></tr></thead>
                <tbody className="tabular-nums">
                  {categories(f).map((c) => (
                    <tr key={c} className="border-t border-slate-100">
                      <td className="py-1">{c}</td>
                      <td className="py-1 text-right">{sample[c] ?? 0}%</td>
                      <td className="py-1 text-right">
                        <Input aria-label={`Population % for ${c}`} type="number" min={0} max={100} step="0.1" className="ml-auto h-8 w-24 py-0.5 text-right" value={t.targets[c] ?? ''}
                          onChange={(e) => set(i, { targets: { ...t.targets, [c]: e.target.value === '' ? 0 : Number(e.target.value) } })} />
                      </td>
                      <td className="py-1 text-right">{preview && !preview.errors.length ? `${got[c] ?? 0}%` : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 text-xs text-slate-600"><td className="py-1">Total</td><td /><td className={cx('py-1 text-right', Math.abs(total - 100) > 1 && 'text-amber-700')}>{Math.round(total * 10) / 10}%</td><td /></tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {usable.length > 0
        ? <Button size="sm" variant="secondary" onClick={() => setTargets((t) => [...t, { field: usable.find((u) => !t.some((x) => x.field === u.id))?.id ?? usable[0].id, targets: {} }])} data-testid="rh-add-weight">+ Add a question to weight by</Button>
        : <p className="text-xs text-slate-500">Weighting needs a multiple-choice or scale question (e.g. gender, level, region).</p>}
      {preview && (preview.errors.length > 0
        ? <Alert>{preview.errors.map((e) => <div key={e}>{e}</div>)}</Alert>
        : (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800" data-testid="rh-weight-summary">
            Weights range from {preview.min} to {preview.max}. Design effect {preview.deff}: the weighted results are about as precise as {Math.round(preview.neff)} unweighted responses (out of {responses.length}).
            {preview.warnings.map((w) => <div key={w} className="mt-1 text-amber-800">{w}</div>)}
          </div>
        ))}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onSave({ enabled: true, targets })} disabled={busy || !targets.length || !!preview?.errors.length || (!dirty && !!saved?.enabled)} loading={busy} data-testid="rh-weight-save">
          {saved?.enabled && dirty ? 'Save and apply' : 'Apply weights'}
        </Button>
        {saved?.enabled && <Button variant="ghost" onClick={() => onSave({ enabled: false, targets })} disabled={busy}>Switch weighting off</Button>}
      </div>
    </Card>
  );
}
