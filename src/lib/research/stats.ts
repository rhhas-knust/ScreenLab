// Statistical tests for the Chart Studio. Pure functions, checked against R's
// t.test / aov / cor.test in the unit tests, so the numbers match what a
// supervisor gets when they re-run the analysis in R, SPSS or MATLAB.
import { logGamma, mean, median, round, sd } from './analytics';

export interface Describe {
  n: number; mean: number | null; sd: number | null; median: number | null;
  q1: number | null; q3: number | null; min: number | null; max: number | null;
}

/** Quantile by linear interpolation between order statistics (R type 7, Excel QUARTILE.INC). */
export function quantile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]) - s[lo]);
}

export function describe(xs: number[]): Describe {
  return {
    n: xs.length, mean: mean(xs), sd: sd(xs), median: median(xs),
    q1: quantile(xs, 0.25), q3: quantile(xs, 0.75),
    min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null,
  };
}

/** Regularised incomplete beta I_x(a, b) (Numerical Recipes betai). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(x, a, b)) / a : 1 - (bt * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Two-sided p-value of Student's t with df degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return betaI(df / (df + t * t), df / 2, 0.5);
}

/** Upper-tail p-value of the F distribution. */
export function fP(f: number, df1: number, df2: number): number {
  if (f <= 0) return 1;
  return betaI(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Critical value of t for a two-sided 95% interval (bisection on the p-value). */
export function tCrit95(df: number): number {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > 0.05) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Correlation { n: number; r: number; p: number; slope: number; intercept: number; r2: number }

/** Pearson correlation with its t-test, and the least-squares line y = slope·x + intercept. */
export function pearson(xs: number[], ys: number[]): Correlation | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!, my = mean(ys.slice(0, n))!;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const t = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
  const slope = sxy / sxx;
  return { n, r: round(r, 3), p: tTwoSidedP(t, n - 2), slope, intercept: my - slope * mx, r2: round(r * r, 3) };
}

export interface TTest { t: number; df: number; p: number; diff: number; groups: [string, string] }

/** Welch's two-sample t-test (unequal variances) — R's t.test default, MATLAB ttest2(…, 'Vartype', 'unequal'). */
export function welchT(a: number[], b: number[], names: [string, string]): TTest | null {
  if (a.length < 2 || b.length < 2) return null;
  const va = sd(a)! ** 2 / a.length, vb = sd(b)! ** 2 / b.length;
  if (va + vb === 0) return null;
  const t = (mean(a)! - mean(b)!) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t: round(t, 3), df: round(df, 2), p: tTwoSidedP(t, df), diff: mean(a)! - mean(b)!, groups: names };
}

export interface Anova { f: number; df1: number; df2: number; p: number; eta2: number }

/** One-way ANOVA across groups (groups with no values are left out). */
export function anova1(groups: number[][]): Anova | null {
  const gs = groups.filter((g) => g.length);
  const all = gs.flat();
  const k = gs.length, n = all.length;
  if (k < 2 || n <= k) return null;
  const grand = mean(all)!;
  const ssb = gs.reduce((s, g) => s + g.length * (mean(g)! - grand) ** 2, 0);
  const ssw = gs.reduce((s, g) => { const m = mean(g)!; return s + g.reduce((t, x) => t + (x - m) ** 2, 0); }, 0);
  if (ssw === 0) return null;
  const df1 = k - 1, df2 = n - k;
  const f = ssb / df1 / (ssw / df2);
  return { f: round(f, 3), df1, df2, p: fP(f, df1, df2), eta2: round(ssb / (ssb + ssw), 3) };
}
