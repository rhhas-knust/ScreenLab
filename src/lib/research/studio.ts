// Chart Studio: turns a questionnaire's responses into named variables (Q1,
// Q2, Q4_1 …) and builds the charts and tests a researcher would otherwise
// make in MATLAB, R or SPSS. Pure functions; the page only renders the model.
import { chiSquare, isBlank, round, type CrossTab } from './analytics';
import { anova1, describe, pearson, tCrit95, welchT, type Anova, type Correlation, type Describe, type TTest } from './stats';
import { isFileAnswer, isUpload, scaleRange, type RhField, type RhResponse } from '../api/research';
import { refsToDisplay } from './formula';

export type VarKind = 'numeric' | 'categorical' | 'multi' | 'date' | 'text';
export type Value = number | string | string[] | null;

export interface StudioVar {
  /** Short name used in commands, files and scripts: Q1, Q4_2, Submitted. */
  name: string;
  label: string;
  kind: VarKind;
  /** Categories in display order (categorical, multi, and scale questions). */
  categories: string[];
  /** A 1–5 / 0–10 scale: numeric, but also usable as categories. */
  scale?: boolean;
  /** Email answers: never charted, and left out of shared results. */
  email?: boolean;
  values: Value[];
}

export interface Dataset {
  vars: StudioVar[];
  n: number;
  ids: string[];
  /** Survey weights aligned with the responses (mean 1), when weighting is on. */
  weights?: number[] | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One variable per question; grids get one per statement, rankings one per option (its rank). */
export function buildDataset(fields: RhField[], responses: RhResponse[], weights?: Map<string, number> | null): Dataset {
  const vars: StudioVar[] = [];
  // Labels with piped answers show as {Q2}, not the stored reference.
  fields = fields.map((f) => (f.label.includes('{@') ? { ...f, label: refsToDisplay(f.label, fields) } : f));
  fields.forEach((f, i) => {
    const q = `Q${i + 1}`;
    const raw = responses.map((r) => r.answers[f.id]);
    if (f.type === 'number' || f.type === 'scale' || f.type === 'calc') {
      vars.push({
        name: q, label: f.label, kind: 'numeric', scale: f.type === 'scale',
        categories: f.type === 'scale' ? scaleRange(f.settings).points.map(String) : [],
        values: raw.map(num),
      });
    } else if (f.type === 'radio') {
      vars.push({ name: q, label: f.label, kind: 'categorical', categories: f.options, values: raw.map((v) => (isBlank(v) ? null : String(v))) });
    } else if (f.type === 'checkbox') {
      vars.push({ name: q, label: f.label, kind: 'multi', categories: f.options, values: raw.map((v) => (Array.isArray(v) && v.length ? v : null)) });
    } else if (f.type === 'grid') {
      (f.settings?.rows ?? []).forEach((row, j) => vars.push({
        name: `${q}_${j + 1}`, label: `${f.label} — ${row}`, kind: 'categorical', categories: f.options,
        values: raw.map((v) => (v && typeof v === 'object' && !Array.isArray(v) && v[row] ? v[row] : null)),
      }));
    } else if (f.type === 'ranking') {
      f.options.forEach((o, j) => vars.push({
        name: `${q}_${j + 1}`, label: `${f.label} — rank of ${o}`, kind: 'numeric', categories: [],
        values: raw.map((v) => { const k = Array.isArray(v) ? v.indexOf(o) : -1; return k < 0 ? null : k + 1; }),
      }));
    } else if (f.type === 'date') {
      vars.push({ name: q, label: f.label, kind: 'date', categories: [], values: raw.map((v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)) });
    } else if (isUpload(f.type)) {
      vars.push({ name: q, label: f.label, kind: 'text', categories: [], values: raw.map((v) => (isFileAnswer(v) ? v.name : null)) });
    } else {
      vars.push({ name: q, label: f.label, kind: 'text', categories: [], email: f.type === 'email', values: raw.map((v) => (isBlank(v) ? null : String(v).trim())) });
    }
  });
  vars.push({ name: 'Submitted', label: 'Date submitted', kind: 'date', categories: [], values: responses.map((r) => r.submitted_at.slice(0, 10)) });
  return { vars, n: responses.length, ids: responses.map((r) => r.id), weights: weights ? responses.map((r) => weights.get(r.id) ?? 1) : null };
}

/** Variables that can go on a category axis (choices, checkboxes, scales). */
export const isCat = (v: StudioVar) => v.kind === 'categorical' || v.kind === 'multi' || !!v.scale;
export const isNum = (v: StudioVar) => v.kind === 'numeric';

/** The categories one response falls into for a variable. */
export function catsOf(v: StudioVar, i: number): string[] {
  const x = v.values[i];
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  return [String(x)];
}

/** Category lists of everyone who answered. */
export function answeredCats(ds: Dataset, v: StudioVar): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ds.n; i++) { const c = catsOf(v, i); if (c.length) out.push(c); }
  return out;
}

export const numsOf = (v: StudioVar) => v.values.map((x) => (typeof x === 'number' ? x : null));

// ---------------------------------------------------------------------------
// Chart specification and model
// ---------------------------------------------------------------------------

export type ChartType = 'bar' | 'barh' | 'pie' | 'histogram' | 'box' | 'means' | 'scatter' | 'line' | 'heatmap';

export const CHART_TYPES: { type: ChartType; label: string; matlab: string; needs: string }[] = [
  { type: 'bar', label: 'Bar chart', matlab: 'bar', needs: 'a choice or scale question' },
  { type: 'barh', label: 'Horizontal bar', matlab: 'barh', needs: 'a choice or scale question' },
  { type: 'pie', label: 'Pie chart', matlab: 'pie', needs: 'a single-choice or scale question' },
  { type: 'histogram', label: 'Histogram', matlab: 'histogram', needs: 'a number or scale question' },
  { type: 'box', label: 'Box plot', matlab: 'boxchart', needs: 'a number question (optionally split by a choice question)' },
  { type: 'means', label: 'Means with 95% CI', matlab: 'errorbar', needs: 'a number question split by a choice question' },
  { type: 'scatter', label: 'Scatter + trend line', matlab: 'scatter', needs: 'two number or scale questions' },
  { type: 'line', label: 'Line over time', matlab: 'plot', needs: 'a date (submission date by default)' },
  { type: 'heatmap', label: 'Heatmap (cross-tab)', matlab: 'heatmap', needs: 'two choice or scale questions' },
];

export interface ChartSpec {
  type: ChartType;
  /** Category axis (bar/pie/heatmap rows), x of a scatter, the date of a line, the value of a histogram. */
  x: string;
  /** Numeric value (box/means/scatter y) or heatmap columns. */
  y?: string;
  /** Split bars into series, or colour scatter points. */
  group?: string;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  percent?: boolean;
  stacked?: boolean;
  sort?: boolean;
  bins?: number;
  fit?: boolean;
  cumulative?: boolean;
}

export interface Series { name: string; values: number[] }
export interface BoxGroup extends Describe { name: string; lo: number; hi: number; outliers: number[] }
export interface MeanGroup { name: string; n: number; mean: number; lo: number; hi: number }

export type ChartModel =
  | { kind: 'bars'; horizontal: boolean; categories: string[]; series: Series[]; stacked: boolean; percent: boolean; n: number; multi: boolean }
  | { kind: 'pie'; slices: { label: string; count: number; pct: number }[]; n: number }
  | { kind: 'hist'; bins: { lo: number; hi: number; count: number }[]; n: number; d: Describe }
  | { kind: 'box'; groups: BoxGroup[] }
  | { kind: 'means'; groups: MeanGroup[] }
  | { kind: 'scatter'; points: { x: number; y: number; g: number }[]; groups: string[]; fit: { slope: number; intercept: number } | null; xr: [number, number]; yr: [number, number] }
  | { kind: 'line'; points: { x: string; y: number }[]; cumulative: boolean }
  | { kind: 'heatmap'; rows: string[]; cols: string[]; counts: number[][] }
  | { kind: 'empty'; message: string };

export interface ChartResult {
  model: ChartModel;
  title: string;
  xlabel: string;
  ylabel: string;
  /** Plain-language test results under the chart. */
  stats: string[];
  /** The numbers behind the chart, as a table (header row first) — for the CSV and the table view. */
  table: (string | number)[][];
}

/** The 8 categorical series colours, in fixed order (validated for colour-blind separation). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OTHER = '#8a8f98';
export const MAX_SERIES = 8;
/** Scatter colours by group: only the first three validate when every pair can sit side by side. */
export const MAX_SCATTER_GROUPS = 3;

export const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
const sig = (p: number) => (p < 0.05 ? 'a statistically significant difference at the 5% level' : 'no statistically significant difference at the 5% level');
const r2 = (n: number | null) => (n == null ? '—' : String(round(n, 2)));

export function findVar(ds: Dataset, name: string | undefined): StudioVar | undefined {
  if (!name) return undefined;
  const k = name.toLowerCase();
  return ds.vars.find((v) => v.name.toLowerCase() === k);
}

/** A sensible first chart: the first choice question as a bar chart, else the first number as a histogram. */
export function defaultSpec(ds: Dataset): ChartSpec {
  const c = ds.vars.find((v) => isCat(v));
  if (c) return { type: 'bar', x: c.name };
  const n = ds.vars.find(isNum);
  if (n) return { type: 'histogram', x: n.name };
  return { type: 'line', x: 'Submitted' };
}

/** Categories of a grouping variable, folding everything past `max` into "Other". */
function groupIndex(g: StudioVar, max: number): { names: string[]; of: (i: number) => number[] } {
  const cats = g.categories.length ? g.categories : [...new Set(g.values.filter((x): x is string => typeof x === 'string'))];
  const names = cats.length > max ? [...cats.slice(0, max - 1), 'Other'] : cats;
  const idx = (c: string) => { const k = cats.indexOf(c); return k < 0 ? -1 : Math.min(k, names.length - 1); };
  return { names, of: (i) => [...new Set(catsOf(g, i).map(idx).filter((k) => k >= 0))] };
}

export function buildChart(spec: ChartSpec, ds: Dataset): ChartResult {
  const x = findVar(ds, spec.x);
  const y = findVar(ds, spec.y);
  const g = findVar(ds, spec.group);
  const empty = (message: string): ChartResult => ({ model: { kind: 'empty', message }, title: spec.title ?? '', xlabel: '', ylabel: '', stats: [], table: [] });
  if (!x) return empty('Choose a question for the chart.');
  const title = spec.title || x.label;
  const label = (v?: StudioVar) => (v ? `${v.name}. ${v.label}` : '');
  const res = (model: ChartModel, xlabel: string, ylabel: string, stats: string[], table: (string | number)[][]): ChartResult =>
    ({ model, title, xlabel: spec.xlabel ?? xlabel, ylabel: spec.ylabel ?? ylabel, stats, table });

  switch (spec.type) {
    case 'bar':
    case 'barh':
    case 'pie': {
      if (!isCat(x)) return empty(`${x.name} is not a choice or scale question. Bar and pie charts need categories.`);
      const cats = x.categories;
      // With survey weights, counts are weighted sums (people still shown as n); tests stay on plain counts.
      const W = !!ds.weights;
      const wt = (i: number) => ds.weights?.[i] ?? 1;
      const show = (v: number) => (W ? round(v, 1) : v);
      const wNote = W ? ['Weighted counts and percentages (survey weights are on).'] : [];
      const counts = cats.map(() => 0);
      let n = 0, wn = 0;
      for (let i = 0; i < ds.n; i++) {
        const a = catsOf(x, i);
        if (!a.length) continue;
        n++; wn += wt(i);
        for (const c of a) { const k = cats.indexOf(c); if (k >= 0) counts[k] += wt(i); }
      }
      const pctOf = (c: number) => (wn ? round((c / wn) * 100, 1) : 0);
      if (spec.type === 'pie') {
        if (x.kind === 'multi') return empty('A checkbox question lets people tick several answers, so its slices would not add up to 100%. Use a bar chart.');
        const slices = cats.map((c, i) => ({ label: c, count: show(counts[i]), pct: pctOf(counts[i]) }));
        return res({ kind: 'pie', slices, n }, '', '', [`${n} respondent${n === 1 ? '' : 's'} answered ${x.name}.`, ...wNote],
          [['Answer', W ? 'Weighted count' : 'Count', 'Percent'], ...slices.map((s) => [s.label, s.count, s.pct])]);
      }
      let order = cats.map((_, i) => i);
      if (!g || g.name === x.name) {
        if (spec.sort) order = order.sort((a, b) => counts[b] - counts[a]);
        const values = order.map((i) => (spec.percent ? pctOf(counts[i]) : show(counts[i])));
        const stats = [`${n} respondent${n === 1 ? '' : 's'} answered ${x.name}.${x.kind === 'multi' ? ' People could tick more than one option, so percentages can add up to more than 100%.' : ''}`, ...wNote];
        if (x.scale) { const d = describe(numsOf(x).filter((v): v is number => v != null)); stats.push(`Mean ${r2(d.mean)}, SD ${r2(d.sd)}, median ${r2(d.median)}${W ? ' (unweighted)' : ''}.`); }
        return res(
          { kind: 'bars', horizontal: spec.type === 'barh', categories: order.map((i) => cats[i]), series: [{ name: 'Respondents', values }], stacked: false, percent: !!spec.percent, n, multi: x.kind === 'multi' },
          label(x), spec.percent ? '% of respondents' : W ? 'Respondents (weighted)' : 'Respondents', stats,
          [['Answer', W ? 'Weighted count' : 'Count', 'Percent'], ...order.map((i) => [cats[i], show(counts[i]), pctOf(counts[i])])],
        );
      }
      if (!isCat(g)) return empty(`${g.name} is not a choice or scale question, so it cannot split the bars.`);
      const gi = groupIndex(g, MAX_SERIES);
      const plain = cats.map(() => gi.names.map(() => 0));
      const cell = cats.map(() => gi.names.map(() => 0));
      const totals = gi.names.map(() => 0);
      let people = 0;
      for (let i = 0; i < ds.n; i++) {
        const a = catsOf(x, i), b = gi.of(i);
        if (!a.length || !b.length) continue;
        people++;
        for (const k of b) totals[k] += wt(i);
        for (const c of a) { const r = cats.indexOf(c); if (r >= 0) for (const k of b) { plain[r][k]++; cell[r][k] += wt(i); } }
      }
      const series = gi.names.map((name, k) => ({
        name, values: cats.map((_, r) => (spec.percent ? (totals[k] ? round((cell[r][k] / totals[k]) * 100, 1) : 0) : show(cell[r][k]))),
      }));
      const shownCells = W ? cell.map((r) => r.map(show)) : plain;
      const stats: string[] = [...(W ? ['Weighted counts and percentages; the chi-square test below uses the unweighted counts.'] : [])];
      const overlap = x.kind === 'multi' || g.kind === 'multi';
      const t = overlap ? null : chiSquare(plain);
      stats.push(t
        ? `Chi-square test of independence: χ² = ${t.chi2}, df = ${t.df}, ${fmtP(t.p)} — ${t.p < 0.05 ? `${x.name} and ${g.name} are associated at the 5% level` : `no evidence that ${x.name} and ${g.name} are associated at the 5% level`}.${t.lowExpected > 20 ? ` ${t.lowExpected}% of cells have an expected count below 5, so treat this with caution.` : ''}`
        : overlap ? 'No chi-square test: a checkbox question lets people pick several answers, so the groups overlap.' : 'Not enough data for a chi-square test yet.');
      if (spec.percent) stats.push(`Percentages are of each ${g.name} group.`);
      return res(
        { kind: 'bars', horizontal: spec.type === 'barh', categories: cats, series, stacked: !!spec.stacked, percent: !!spec.percent, n: people, multi: x.kind === 'multi' },
        label(x), spec.percent ? `% of each ${g.name} group` : 'Respondents', stats,
        [[`${x.name} \\ ${g.name}`, ...gi.names], ...cats.map((c, r) => [c, ...shownCells[r]])],
      );
    }

    case 'histogram': {
      if (!isNum(x)) return empty(`${x.name} is not a number question. Histograms need numbers.`);
      const xs = numsOf(x).filter((v): v is number => v != null);
      if (!xs.length) return empty(`No answers to ${x.name} yet.`);
      const d = describe(xs);
      const lo = d.min!, hi = d.max!;
      const k = Math.max(1, Math.min(50, spec.bins ?? (x.scale ? x.categories.length : Math.ceil(Math.log2(xs.length) + 1))));
      let bins: { lo: number; hi: number; count: number }[];
      if (x.scale) {
        const pts = x.categories.map(Number);
        bins = pts.map((p) => ({ lo: p - 0.5, hi: p + 0.5, count: xs.filter((v) => v === p).length }));
      } else if (lo === hi) {
        bins = [{ lo: lo - 0.5, hi: hi + 0.5, count: xs.length }];
      } else {
        const w = (hi - lo) / k;
        bins = Array.from({ length: k }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, count: 0 }));
        for (const v of xs) bins[Math.min(k - 1, Math.floor((v - lo) / w))].count++;
      }
      return res({ kind: 'hist', bins, n: xs.length, d }, label(x), 'Respondents',
        [`n = ${d.n}, mean ${r2(d.mean)}, SD ${r2(d.sd)}, median ${r2(d.median)}, IQR ${r2(d.q1)}–${r2(d.q3)}, range ${r2(d.min)}–${r2(d.max)}.`],
        [['From', 'To', 'Count'], ...bins.map((b) => [round(b.lo, 2), round(b.hi, 2), b.count])]);
    }

    case 'box':
    case 'means': {
      // box/means: y is the number; x (or group) splits it. Accept the number in x when no y is given.
      let val = y, by: StudioVar | undefined = y ? (isCat(x) ? x : g) : g;
      if (!val && isNum(x)) val = x;
      if (!val || !isNum(val)) return empty('Choose a number question for the values.');
      if (spec.type === 'means' && !by) return empty('Choose a choice question to compare the means across.');
      if (by && !isCat(by)) return empty(`${by.name} is not a choice or scale question, so it cannot split the values.`);
      const ys = numsOf(val);
      const gi = by ? groupIndex(by, MAX_SERIES) : { names: ['All'], of: () => [0] };
      const buckets = gi.names.map(() => [] as number[]);
      const wbuckets = gi.names.map(() => [] as number[]);
      ys.forEach((v, i) => { if (v != null) for (const k of gi.of(i)) { buckets[k].push(v); wbuckets[k].push(ds.weights?.[i] ?? 1); } });
      const stats: string[] = [];
      const kept = gi.names.map((n, k) => ({ n, xs: buckets[k], ws: wbuckets[k] })).filter((b) => b.xs.length);
      if (by) {
        if (kept.length === 2 && by.kind !== 'multi') {
          const t: TTest | null = welchT(kept[0].xs, kept[1].xs, [kept[0].n, kept[1].n]);
          if (t) stats.push(`Welch two-sample t-test: t = ${t.t}, df = ${t.df}, ${fmtP(t.p)} — ${sig(t.p)} in mean ${val.name} between “${t.groups[0]}” and “${t.groups[1]}” (difference ${r2(t.diff)}).`);
        } else if (kept.length > 2 && by.kind !== 'multi') {
          const a: Anova | null = anova1(kept.map((b) => b.xs));
          if (a) stats.push(`One-way ANOVA: F(${a.df1}, ${a.df2}) = ${a.f}, ${fmtP(a.p)}, η² = ${a.eta2} — ${sig(a.p)} in mean ${val.name} across the ${by.name} groups.`);
        } else if (by.kind === 'multi') {
          stats.push('No test: a checkbox question lets people be in several groups at once.');
        }
        if (!stats.length) stats.push('Not enough answers in each group for a test yet.');
      }
      const table: (string | number)[][] = [['Group', 'n', 'Mean', 'SD', 'Median', 'Q1', 'Q3', 'Min', 'Max'],
        ...kept.map((b) => { const d = describe(b.xs); return [b.n, d.n, r2(d.mean), r2(d.sd), r2(d.median), r2(d.q1), r2(d.q3), r2(d.min), r2(d.max)]; })];
      const xl = by ? label(by) : '';
      if (!kept.length) return empty(`No answers to ${val.name} yet.`);
      if (spec.type === 'box') {
        const groups = kept.map((b) => {
          const d = describe(b.xs);
          const iqr = d.q3! - d.q1!;
          const inside = b.xs.filter((v) => v >= d.q1! - 1.5 * iqr && v <= d.q3! + 1.5 * iqr);
          return { ...d, name: b.n, lo: Math.min(...inside), hi: Math.max(...inside), outliers: b.xs.filter((v) => v < d.q1! - 1.5 * iqr || v > d.q3! + 1.5 * iqr) };
        });
        return { ...res({ kind: 'box', groups }, xl, spec.ylabel ?? label(val), stats, table), title: spec.title || val.label };
      }
      const groups = kept.map((b) => {
        if (ds.weights) {
          // Weighted mean; the interval uses the effective sample size (Kish) so it is not too narrow.
          const sw = b.ws.reduce((a, w) => a + w, 0), sw2 = b.ws.reduce((a, w) => a + w * w, 0);
          const m = b.xs.reduce((a, x, i) => a + x * b.ws[i], 0) / sw;
          const neff = (sw * sw) / sw2;
          const v = sw > 1 ? b.xs.reduce((a, x, i) => a + b.ws[i] * (x - m) ** 2, 0) / sw : 0;
          const half = neff > 1 ? tCrit95(Math.max(1, neff - 1)) * Math.sqrt(v * neff / (neff - 1)) / Math.sqrt(neff) : 0;
          return { name: b.n, n: b.xs.length, mean: m, lo: m - half, hi: m + half };
        }
        const d = describe(b.xs);
        const half = d.n > 1 ? tCrit95(d.n - 1) * (d.sd! / Math.sqrt(d.n)) : 0;
        return { name: b.n, n: d.n, mean: d.mean!, lo: d.mean! - half, hi: d.mean! + half };
      });
      if (ds.weights) stats.unshift('Weighted means; intervals use the effective sample size. The test uses unweighted data.');
      return { ...res({ kind: 'means', groups }, xl, spec.ylabel ?? `Mean ${val.name} (95% CI)`, stats, table), title: spec.title || val.label };
    }

    case 'scatter': {
      if (!isNum(x) || !y || !isNum(y)) return empty('A scatter plot needs two number or scale questions.');
      const xs = numsOf(x), ys = numsOf(y);
      const gi = g && isCat(g) ? groupIndex(g, MAX_SCATTER_GROUPS + 1) : null;
      const points: { x: number; y: number; g: number }[] = [];
      xs.forEach((a, i) => { const b = ys[i]; if (a != null && b != null) points.push({ x: a, y: b, g: gi ? (gi.of(i)[0] ?? -1) : 0 }); });
      if (!points.length) return empty(`No respondent answered both ${x.name} and ${y.name} yet.`);
      const c: Correlation | null = pearson(points.map((p) => p.x), points.map((p) => p.y));
      const stats = [c
        ? `Pearson correlation: r = ${c.r}, ${fmtP(c.p)}, n = ${c.n}. Trend line: ${y.name} = ${r2(c.slope)} × ${x.name} ${c.intercept < 0 ? '−' : '+'} ${r2(Math.abs(c.intercept))} (R² = ${c.r2}).`
        : 'Not enough varied answers for a correlation yet.'];
      const ext = (v: number[]): [number, number] => { const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? [lo - 1, hi + 1] : [lo, hi]; };
      return {
        ...res({ kind: 'scatter', points, groups: gi?.names ?? [], fit: spec.fit !== false && c ? { slope: c.slope, intercept: c.intercept } : null, xr: ext(points.map((p) => p.x)), yr: ext(points.map((p) => p.y)) },
          label(x), label(y), stats, [[x.name, y.name, ...(gi ? [g!.name] : [])], ...points.map((p) => [p.x, p.y, ...(gi ? [gi.names[p.g] ?? ''] : [])])]),
        title: spec.title || `${y.name} against ${x.name}`,
      };
    }

    case 'line': {
      if (x.kind !== 'date') return empty(`${x.name} is not a date. A line over time needs a date — the submission date works.`);
      const days = new Map<string, number>();
      for (const v of x.values) if (typeof v === 'string') days.set(v, (days.get(v) ?? 0) + 1);
      let run = 0;
      const points = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([d, c]) => ({ x: d, y: spec.cumulative ? (run += c) : c }));
      if (!points.length) return empty(`No dates in ${x.name} yet.`);
      const peak = points.reduce((m, p) => (p.y > m.y ? p : m), points[0]);
      return res({ kind: 'line', points, cumulative: !!spec.cumulative }, label(x), spec.cumulative ? 'Cumulative responses' : 'Responses',
        [spec.cumulative ? `${run} in total by ${points.at(-1)!.x}.` : `${points.reduce((s, p) => s + p.y, 0)} in total over ${points.length} day${points.length === 1 ? '' : 's'}; busiest day ${peak.x} (${peak.y}).`],
        [['Date', spec.cumulative ? 'Cumulative' : 'Count'], ...points.map((p) => [p.x, p.y])]);
    }

    case 'heatmap': {
      const col = y ?? g;
      if (!isCat(x) || !col || !isCat(col)) return empty('A heatmap needs two choice or scale questions.');
      if (col.name === x.name) return empty('Choose two different questions.');
      const rows = x.categories, cols = col.categories;
      const counts = rows.map(() => cols.map(() => 0));
      for (let i = 0; i < ds.n; i++) {
        const a = catsOf(x, i), b = catsOf(col, i);
        for (const r of a) for (const c of b) { const ri = rows.indexOf(r), ci = cols.indexOf(c); if (ri >= 0 && ci >= 0) counts[ri][ci]++; }
      }
      const overlap = x.kind === 'multi' || col.kind === 'multi';
      const t: CrossTab['chi'] = overlap ? null : chiSquare(counts);
      return {
        ...res({ kind: 'heatmap', rows, cols, counts }, label(col), label(x),
          [t ? `Chi-square test of independence: χ² = ${t.chi2}, df = ${t.df}, ${fmtP(t.p)}.${t.lowExpected > 20 ? ` ${t.lowExpected}% of cells have an expected count below 5, so treat this with caution.` : ''}`
            : overlap ? 'No chi-square test: a checkbox question lets people pick several answers.' : 'Not enough data for a chi-square test yet.'],
          [[`${x.name} \\ ${col.name}`, ...cols], ...rows.map((r, i) => [r, ...counts[i]])]),
        title: spec.title || `${x.name} by ${col.name}`,
      };
    }
  }
}
