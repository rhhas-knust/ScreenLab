// Survey weights: make the sample match known population shares (e.g. 52%
// women, 48% men; 30% Level 100 …). With one question this is
// post-stratification; with several it is raking (iterative proportional
// fitting), as in R's survey::rake and SPSS's RAKE extension.
import type { RhField, RhResponse, WeightTarget } from '../api/research';
import { answerCategories, categories, round } from './analytics';

export interface WeightResult {
  /** Weight per response id, scaled so the average is 1 (sum = number of responses). */
  weights: Map<string, number>;
  /** Kish design effect and effective sample size. */
  deff: number;
  neff: number;
  min: number;
  max: number;
  iterations: number;
  converged: boolean;
  /** Problems that stop weighting (empty = weights are usable). */
  errors: string[];
  /** Things worth knowing that do not stop it. */
  warnings: string[];
  /** Achieved weighted shares per question, to compare with the targets. */
  achieved: { field: string; shares: Record<string, number> }[];
}

/** Only single-choice and scale questions can be weighting variables. */
export const canWeightBy = (f: RhField) => f.type === 'radio' || f.type === 'scale';

export function computeWeights(fields: RhField[], responses: RhResponse[], targets: WeightTarget[], opts: { maxIter?: number; tol?: number } = {}): WeightResult {
  const maxIter = opts.maxIter ?? 100, tol = opts.tol ?? 1e-7;
  const n = responses.length;
  const w = new Array(n).fill(1);
  const errors: string[] = [], warnings: string[] = [];
  const qn = (id: string) => `Q${fields.findIndex((f) => f.id === id) + 1}`;

  // Validate and normalise targets to proportions.
  const used = targets.map((t) => {
    const f = fields.find((x) => x.id === t.field);
    if (!f || !canWeightBy(f)) { errors.push(`A weighting question was deleted or is not single-choice.`); return null; }
    const cats = categories(f).filter((c) => (t.targets[c] ?? 0) > 0);
    const total = cats.reduce((s, c) => s + t.targets[c], 0);
    if (!cats.length || total <= 0) { errors.push(`${qn(f.id)}: enter the population percentages.`); return null; }
    if (Math.abs(total - 100) > 1) warnings.push(`${qn(f.id)}: the percentages add up to ${round(total, 1)}, so they were scaled to 100.`);
    const groupOf = responses.map((r) => answerCategories(r.answers[f.id])[0] ?? null);
    for (const c of cats) if (!groupOf.includes(c)) errors.push(`${qn(f.id)}: nobody answered “${c}”, so that group cannot be weighted up. Set its target to 0 or merge it.`);
    const zero = categories(f).filter((c) => !(t.targets[c] > 0) && groupOf.includes(c));
    if (zero.length) warnings.push(`${qn(f.id)}: respondents answering ${zero.map((z) => `“${z}”`).join(', ')} get weight 0 (target 0%).`);
    const missing = groupOf.filter((g) => g == null).length;
    if (missing) warnings.push(`${qn(f.id)}: ${missing} respondent${missing === 1 ? '' : 's'} did not answer, so this question does not adjust their weight.`);
    return { f, share: Object.fromEntries(categories(f).map((c) => [c, (t.targets[c] ?? 0) / total])), groupOf };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  if (!used.length && !errors.length) errors.push('Add at least one question with population percentages.');
  let it = 0, converged = false;
  if (!errors.length) {
    for (it = 1; it <= maxIter; it++) {
      let change = 0;
      for (const u of used) {
        // Total weight of those who answered this question, shared out by target.
        const answered = u.groupOf.reduce((s, g, i) => (g == null ? s : s + w[i]), 0);
        const cur: Record<string, number> = {};
        u.groupOf.forEach((g, i) => { if (g != null) cur[g] = (cur[g] ?? 0) + w[i]; });
        u.groupOf.forEach((g, i) => {
          if (g == null) return;
          const f = cur[g] > 0 ? (u.share[g] * answered) / cur[g] : 0;
          change = Math.max(change, Math.abs(f - 1));
          w[i] *= f;
        });
      }
      if (change < tol) { converged = true; break; }
    }
    if (!converged) warnings.push('The weights did not fully settle — some targets may conflict. Check the achieved shares below.');
  }

  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const scaled = w.map((x) => (x * n) / sum);
  const sumsq = scaled.reduce((a, b) => a + b * b, 0);
  const neff = sumsq ? (n * n) / sumsq : 0;
  const pos = scaled.filter((x) => x > 0);
  const max = pos.length ? Math.max(...pos) : 0, min = pos.length ? Math.min(...pos) : 0;
  if (max > 5) warnings.push(`The largest weight is ${round(max, 1)}: a few respondents count for a lot, which makes results less stable.`);
  const achieved = used.map((u) => {
    const tot: Record<string, number> = {};
    let all = 0;
    u.groupOf.forEach((g, i) => { if (g != null) { tot[g] = (tot[g] ?? 0) + scaled[i]; all += scaled[i]; } });
    return { field: u.f.id, shares: Object.fromEntries(categories(u.f).map((c) => [c, all ? round(((tot[c] ?? 0) / all) * 100, 1) : 0])) };
  });
  return {
    weights: new Map(responses.map((r, i) => [r.id, errors.length ? 1 : scaled[i]])),
    deff: errors.length || !n ? 1 : round(n / neff, 2), neff: errors.length ? n : round(neff, 1),
    min: round(min, 3), max: round(max, 3), iterations: it, converged, errors, warnings, achieved,
  };
}

/** Unweighted share (%) of each answer, to show next to the targets. */
export function sampleShares(f: RhField, responses: RhResponse[]): Record<string, number> {
  const groups = responses.map((r) => answerCategories(r.answers[f.id])[0]).filter(Boolean) as string[];
  return Object.fromEntries(categories(f).map((c) => [c, groups.length ? round((groups.filter((g) => g === c).length / groups.length) * 100, 1) : 0]));
}
