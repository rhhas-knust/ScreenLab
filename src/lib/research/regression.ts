// Linear (OLS / weighted least squares) and logistic regression for the
// Chart Studio and the Regression tab. Checked against R's lm() and glm() in
// the unit tests. Categorical predictors become dummy variables against the
// first answer (the reference group), as R and SPSS do by default.
import { chiSquareP, round } from './analytics';
import { fP, tCrit95, tTwoSidedP } from './stats';
import { catsOf, findVar, isCat, numsOf, type Dataset, type StudioVar } from './studio';

export interface Term { name: string; label: string; estimate: number; se: number; stat: number; p: number; lo: number; hi: number; /** logistic: odds ratio and its CI */ or?: number; orLo?: number; orHi?: number }
export interface LinearFit { kind: 'linear'; n: number; terms: Term[]; r2: number; adjR2: number; f: number; df1: number; df2: number; pModel: number; sigma: number; weighted: boolean; outcome: string; reference: Record<string, string> }
export interface LogisticFit { kind: 'logistic'; n: number; terms: Term[]; deviance: number; nullDeviance: number; lr: number; df: number; pModel: number; mcfadden: number; aic: number; iterations: number; converged: boolean; weighted: boolean; outcome: string; event: string; events: number; reference: Record<string, string>; warning?: string }
export type Fit = LinearFit | LogisticFit;

export interface ModelSpec {
  outcome: string;
  predictors: string[];
  kind?: 'linear' | 'logistic';
  /** logistic: which answer of the outcome counts as the event (1). */
  event?: string;
  weighted?: boolean;
}

// ---------------------------------------------------------------------------
// Linear algebra on small dense matrices
// ---------------------------------------------------------------------------
type M = number[][];
/** Inverse of a symmetric positive-definite matrix (Gauss–Jordan, partial pivoting). Null when singular. */
export function invert(a: M): M | null {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(1e-300, ...a.map((r, i) => Math.abs(r[i])));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-10 * scale) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || m[r][c] === 0) continue;
      const k = m[r][c];
      for (let j = 0; j < 2 * n; j++) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}
/** XᵀWX and XᵀWz. */
function crossprod(X: M, w: number[], z: number[]): { xtx: M; xtz: number[] } {
  const k = X[0].length;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xtz = new Array(k).fill(0);
  X.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      const v = row[a] * w[i];
      xtz[a] += v * z[i];
      for (let b = a; b < k; b++) xtx[a][b] += v * row[b];
    }
  });
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
  return { xtx, xtz };
}
const matvec = (m: M, v: number[]) => m.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));

/** Standard normal two-sided p-value. */
export function normalTwoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  // erfc via Numerical Recipes' Chebyshev approximation (|error| < 1.2e-7)
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return Math.min(1, erfc);
}

// ---------------------------------------------------------------------------
// Design matrix
// ---------------------------------------------------------------------------
interface Design { X: M; y: number[]; w: number[]; names: string[]; labels: string[]; reference: Record<string, string>; rows: number[] }

function design(ds: Dataset, spec: ModelSpec, yOf: (i: number) => number | null): Design | string {
  const preds = spec.predictors.map((p) => findVar(ds, p));
  if (preds.some((p) => !p)) return 'A predictor question no longer exists.';
  const vars = preds as StudioVar[];
  if (!vars.length) return 'Choose at least one predictor.';
  const reference: Record<string, string> = {};
  // Columns per predictor: numbers as they are; single choices as dummies; checkboxes as 0/1 per option.
  type Col = { name: string; label: string; get: (i: number) => number | null };
  const cols: Col[] = [];
  for (const v of vars) {
    if (v.kind === 'numeric') {
      const xs = numsOf(v);
      cols.push({ name: v.name, label: v.label, get: (i) => xs[i] });
    } else if (v.kind === 'categorical') {
      const present = v.categories.filter((c) => v.values.some((x, i) => x === c && yOf(i) != null));
      if (present.length < 2) return `${v.name} has only one answer among these respondents, so it cannot explain differences.`;
      reference[v.name] = present[0];
      for (const c of present.slice(1)) cols.push({ name: `${v.name}=${c}`, label: `${v.name}: “${c}” vs “${present[0]}”`, get: (i) => (v.values[i] == null ? null : v.values[i] === c ? 1 : 0) });
    } else if (v.kind === 'multi') {
      // A checkbox left empty is saved as no answer, so "not ticked" and "skipped" look the same: both count as 0.
      v.categories.forEach((c) => cols.push({ name: `${v.name}=${c}`, label: `${v.name}: ticked “${c}”`, get: (i) => (catsOf(v, i).includes(c) ? 1 : 0) }));
    } else {
      return `${v.name} is not a number, choice or scale question.`;
    }
  }
  const X: M = [], y: number[] = [], w: number[] = [], rows: number[] = [];
  for (let i = 0; i < ds.n; i++) {
    const yi = yOf(i);
    if (yi == null) continue;
    const row = cols.map((c) => c.get(i));
    if (row.some((x) => x == null || !Number.isFinite(x))) continue;
    const wi = spec.weighted && ds.weights ? ds.weights[i] : 1;
    if (!(wi > 0)) continue;
    X.push([1, ...(row as number[])]); y.push(yi); w.push(wi); rows.push(i);
  }
  // Drop dummy columns that never vary in the rows used (e.g. a checkbox option nobody ticked).
  const keep = [0, ...cols.map((_, j) => j + 1).filter((j) => new Set(X.map((r) => r[j])).size > 1)];
  return {
    X: X.map((r) => keep.map((j) => r[j])), y, w, rows,
    names: keep.map((j) => (j === 0 ? '(Intercept)' : cols[j - 1].name)),
    labels: keep.map((j) => (j === 0 ? 'Intercept' : cols[j - 1].label)),
    reference,
  };
}

const MIN_PER_TERM = 2;

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------
export function fitModel(ds: Dataset, spec: ModelSpec): Fit | string {
  const yv = findVar(ds, spec.outcome);
  if (!yv) return 'Choose the outcome question.';
  if (spec.predictors.includes(spec.outcome)) return 'The outcome cannot also be a predictor.';
  const kind = spec.kind ?? (yv.kind === 'numeric' ? 'linear' : 'logistic');
  const weighted = !!(spec.weighted && ds.weights);

  if (kind === 'linear') {
    if (yv.kind !== 'numeric') return `${yv.name} is not a number or scale question; use logistic regression for a yes/no outcome.`;
    const ys = numsOf(yv);
    const d = design(ds, spec, (i) => ys[i]);
    if (typeof d === 'string') return d;
    const n = d.y.length, k = d.X[0]?.length ?? 0;
    if (n < k + MIN_PER_TERM) return `Only ${n} respondents answered all of these questions — too few for ${k} terms.`;
    // Weights are scaled to sum to n, so their size does not change the standard errors.
    const sw = d.w.reduce((a, b) => a + b, 0);
    const w = d.w.map((x) => (x * n) / sw);
    const { xtx, xtz } = crossprod(d.X, w, d.y);
    const inv = invert(xtx);
    if (!inv) return 'Two predictors carry the same information (perfect overlap). Remove one of them.';
    const b = matvec(inv, xtz);
    const fitted = d.X.map((r) => r.reduce((s, x, j) => s + x * b[j], 0));
    const ybar = d.y.reduce((s, v, i) => s + v * w[i], 0) / n;
    const sse = d.y.reduce((s, v, i) => s + w[i] * (v - fitted[i]) ** 2, 0);
    const sst = d.y.reduce((s, v, i) => s + w[i] * (v - ybar) ** 2, 0);
    const df2 = n - k, df1 = k - 1;
    const s2 = sse / df2;
    const tc = tCrit95(df2);
    const terms = b.map((est, j) => {
      const se = Math.sqrt(s2 * inv[j][j]);
      const t = se > 0 ? est / se : 0;
      return { name: d.names[j], label: d.labels[j], estimate: est, se, stat: t, p: tTwoSidedP(t, df2), lo: est - tc * se, hi: est + tc * se };
    });
    if (sst > 0 && sse <= 1e-12 * sst) return `The predictors explain ${yv.name} exactly (for example, it is a score calculated from them), so there is nothing left to test.`;
    const r2 = sst > 0 ? 1 - sse / sst : 0;
    const f = df1 > 0 && sse > 0 ? ((sst - sse) / df1) / s2 : 0;
    return {
      kind: 'linear', n, terms, r2, adjR2: 1 - (1 - r2) * (n - 1) / df2, f, df1, df2, pModel: df1 > 0 ? fP(f, df1, df2) : 1,
      sigma: Math.sqrt(s2), weighted, outcome: yv.name, reference: d.reference,
    };
  }

  // Logistic: outcome is 1 when the chosen answer was given.
  if (!isCat(yv) && yv.kind !== 'numeric') return `${yv.name} cannot be an outcome.`;
  const cats = yv.kind === 'numeric' && !yv.scale ? [...new Set(numsOf(yv).filter((v) => v != null).map(String))] : yv.categories;
  const event = spec.event && cats.includes(spec.event) ? spec.event : cats.length === 2 ? cats[1] : null;
  if (!event) return `Choose which answer of ${yv.name} counts as the event (1).`;
  const d = design(ds, spec, (i) => { const c = catsOf(yv, i); return c.length ? (c.includes(event) ? 1 : 0) : null; });
  if (typeof d === 'string') return d;
  const n = d.y.length, k = d.X[0]?.length ?? 0;
  const events = d.y.filter((v) => v === 1).length;
  if (n < k + MIN_PER_TERM) return `Only ${n} respondents answered all of these questions — too few for ${k} terms.`;
  if (events === 0 || events === n) return `Everyone (or no one) answered “${event}”, so there is nothing to explain.`;
  const sw = d.w.reduce((a, b) => a + b, 0);
  const pw = d.w.map((x) => (x * n) / sw);
  let b = new Array(k).fill(0);
  let it = 0, converged = false, inv: M | null = null;
  const ll = (beta: number[]) => d.X.reduce((s, r, i) => {
    const eta = r.reduce((a, x, j) => a + x * beta[j], 0);
    const lp = eta > 0 ? -Math.log1p(Math.exp(-eta)) : eta - Math.log1p(Math.exp(eta));
    const lq = eta > 0 ? -eta - Math.log1p(Math.exp(-eta)) : -Math.log1p(Math.exp(eta));
    return s + pw[i] * (d.y[i] ? lp : lq);
  }, 0);
  let prev = ll(b);
  for (it = 1; it <= 50; it++) {
    const mu = d.X.map((r) => 1 / (1 + Math.exp(-r.reduce((a, x, j) => a + x * b[j], 0))));
    const wt = mu.map((m, i) => pw[i] * Math.max(m * (1 - m), 1e-10));
    const z = d.X.map((r, i) => r.reduce((a, x, j) => a + x * b[j], 0) + (d.y[i] - mu[i]) / Math.max(mu[i] * (1 - mu[i]), 1e-10));
    const { xtx, xtz } = crossprod(d.X, wt, z);
    inv = invert(xtx);
    if (!inv) return 'Two predictors carry the same information (perfect overlap). Remove one of them.';
    b = matvec(inv, xtz);
    const cur = ll(b);
    if (Math.abs(cur - prev) < 1e-10 * (Math.abs(cur) + 1e-10)) { converged = true; prev = cur; break; }
    prev = cur;
  }
  // Final information matrix at the estimate.
  const mu = d.X.map((r) => 1 / (1 + Math.exp(-r.reduce((a, x, j) => a + x * b[j], 0))));
  const SEPARATION = `The answers separate the groups completely (for example, everyone above a certain score answered “${event}”), so no odds ratio can be estimated. Collect more responses, merge small groups or drop that predictor.`;
  inv = invert(crossprod(d.X, mu.map((m, i) => pw[i] * Math.max(m * (1 - m), 1e-12)), d.y).xtx);
  if (!inv) return SEPARATION;
  const pbar = d.y.reduce((s, v, i) => s + v * pw[i], 0) / n;
  const ll0 = n * (pbar * Math.log(pbar) + (1 - pbar) * Math.log(1 - pbar));
  const dev = -2 * prev, dev0 = -2 * ll0;
  const lr = Math.max(0, dev0 - dev);
  const terms = b.map((est, j) => {
    const se = Math.sqrt(Math.max(0, inv![j][j]));
    const z = se > 0 ? est / se : 0;
    const lo = est - 1.959964 * se, hi = est + 1.959964 * se;
    return { name: d.names[j], label: d.labels[j], estimate: est, se, stat: z, p: normalTwoSidedP(z), lo, hi, or: Math.exp(est), orLo: Math.exp(lo), orHi: Math.exp(hi) };
  });
  // Separation: estimates run off towards infinity (R warns "fitted probabilities numerically 0 or 1").
  if (terms.some((t) => Math.abs(t.estimate) > 15 || t.se > 1e3) || mu.some((m) => m < 1e-8 || m > 1 - 1e-8)) return SEPARATION;
  return {
    kind: 'logistic', n, terms, deviance: dev, nullDeviance: dev0, lr, df: k - 1, pModel: chiP(lr, k - 1), mcfadden: ll0 ? 1 - prev / ll0 : 0,
    aic: dev + 2 * k, iterations: it, converged, weighted, outcome: yv.name, event, events, reference: d.reference,
    warning: !converged ? 'The model did not settle; treat the results with caution.' : undefined,
  };
}

const chiP = (x: number, df: number) => (df > 0 ? chiSquareP(x, df) : 1);

// ---------------------------------------------------------------------------
// Plain-language reading and tables
// ---------------------------------------------------------------------------
const r2s = (n: number, dp = 2) => String(round(n, dp));
export const fmtPv = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

export function describeFit(fit: Fit, ds: Dataset): string[] {
  const out: string[] = [];
  const outcome = findVar(ds, fit.outcome)!;
  if (fit.kind === 'linear') {
    out.push(`Linear regression of ${fit.outcome} (${outcome.label}) on ${fit.terms.length - 1} term${fit.terms.length === 2 ? '' : 's'}, n = ${fit.n}${fit.weighted ? ', weighted' : ''}.`);
    out.push(`The model explains ${round(fit.r2 * 100, 1)}% of the variation (R² = ${r2s(fit.r2, 3)}, adjusted ${r2s(fit.adjR2, 3)}); F(${fit.df1}, ${fit.df2}) = ${r2s(fit.f)}, p ${fit.pModel < 0.001 ? '< 0.001' : `= ${fit.pModel.toFixed(3)}`}.`);
    for (const t of fit.terms.slice(1)) {
      if (t.p >= 0.05) continue;
      const dir = t.estimate > 0 ? 'higher' : 'lower';
      const what = t.name.includes('=') ? `${t.label.replace(/^Q\d+(_\d+)?: /, '')}:` : `Each 1-point increase in ${t.name} goes with`;
      out.push(`${what} ${r2s(Math.abs(t.estimate))} ${dir} ${fit.outcome} on average (95% CI ${r2s(t.lo)} to ${r2s(t.hi)}, p ${t.p < 0.001 ? '< 0.001' : `= ${t.p.toFixed(3)}`}), keeping the other predictors the same.`);
    }
  } else {
    out.push(`Logistic regression: the chance that ${fit.outcome} is “${fit.event}” (${fit.events} of ${fit.n}), ${fit.terms.length - 1} term${fit.terms.length === 2 ? '' : 's'}${fit.weighted ? ', weighted' : ''}.`);
    out.push(`Likelihood-ratio χ²(${fit.df}) = ${r2s(fit.lr)}, p ${fit.pModel < 0.001 ? '< 0.001' : `= ${fit.pModel.toFixed(3)}`}; McFadden R² = ${r2s(fit.mcfadden, 3)}.`);
    for (const t of fit.terms.slice(1)) {
      if (t.p >= 0.05 || t.or == null) continue;
      const what = t.name.includes('=') ? `${t.label.replace(/^Q\d+(_\d+)?: /, '')}:` : `Each 1-point increase in ${t.name}:`;
      out.push(`${what} the odds of “${fit.event}” are ${r2s(t.or)} times as high (95% CI ${r2s(t.orLo!)} to ${r2s(t.orHi!)}, p ${t.p < 0.001 ? '< 0.001' : `= ${t.p.toFixed(3)}`}), keeping the other predictors the same.`);
    }
    if (fit.warning) out.push(fit.warning);
  }
  if (out.length === 2) out.push('No predictor is statistically significant at the 5% level.');
  out.push('An association, not proof of cause.');
  return out;
}

export function fitTable(fit: Fit): (string | number)[][] {
  if (fit.kind === 'linear') {
    return [['Term', 'Estimate', 'Std. error', 't', 'p', '95% CI low', '95% CI high'],
      ...fit.terms.map((t) => [t.label, round(t.estimate, 4), round(t.se, 4), round(t.stat, 3), fmtPv(t.p), round(t.lo, 4), round(t.hi, 4)])];
  }
  return [['Term', 'Log-odds', 'Std. error', 'z', 'p', 'Odds ratio', 'OR 95% CI low', 'OR 95% CI high'],
    ...fit.terms.map((t) => [t.label, round(t.estimate, 4), round(t.se, 4), round(t.stat, 3), fmtPv(t.p), round(t.or!, 3), round(t.orLo!, 3), round(t.orHi!, 3)])];
}

/** Questions that can be predictors or outcomes. */
export const modelVars = (ds: Dataset) => ds.vars.filter((v) => v.kind === 'numeric' || v.kind === 'categorical' || v.kind === 'multi');
export { MIN_PER_TERM };
