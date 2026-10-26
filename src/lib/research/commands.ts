// The Chart Studio command window: a small, safe subset of MATLAB syntax
// (no eval). Commands either redraw the figure or print a result, e.g.
//   bar(Q1)  histogram(Q2, 8)  boxchart(Q1, Q2)  scatter(Q2, Q5)
//   mean(Q2)  corr(Q2, Q5)  ttest2(Q2, Q1)  anova1(Q2, Q1)  crosstab(Q1, Q3)
import { findVar, isCat, isNum, numsOf, answeredCats, catsOf, fmtP, type ChartSpec, type Dataset, type StudioVar } from './studio';
import { anova1, describe, pearson, welchT } from './stats';
import { describeFit, fitModel, fitTable } from './regression';
import { chiSquare, round } from './analytics';

type Arg = { kind: 'name'; v: string } | { kind: 'num'; v: number } | { kind: 'str'; v: string };
export interface Parsed { fn: string; args: Arg[] }

/** `name`, `name(arg, …)` or `name arg` (command syntax, e.g. `title Hello`). Returns null for empty input. */
export function parseCommand(src: string): Parsed | { error: string } | null {
  const s = src.trim().replace(/;+\s*$/, '');
  if (!s) return null;
  const head = /^([A-Za-z_]\w*)\s*/.exec(s);
  if (!head) return { error: 'A command starts with a name, e.g. bar(Q1). Type help for the list.' };
  const fn = head[1];
  let rest = s.slice(head[0].length);
  if (!rest) return { fn, args: [] };
  if (!rest.startsWith('(')) return { fn, args: [{ kind: 'str', v: rest.replace(/^['"]|['"]$/g, '') }] };
  if (!rest.endsWith(')')) return { error: 'Missing closing bracket “)”.' };
  rest = rest.slice(1, -1);
  const args: Arg[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === ' ' || c === ',') { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, out = '';
      while (j < rest.length) {
        if (rest[j] === c) { if (rest[j + 1] === c) { out += c; j += 2; continue; } break; }
        out += rest[j++];
      }
      if (j >= rest.length) return { error: 'A text value is missing its closing quote.' };
      args.push({ kind: 'str', v: out });
      i = j + 1;
      continue;
    }
    const m = /^(-?\d+(?:\.\d+)?)|^([A-Za-z_]\w*)/.exec(rest.slice(i));
    if (!m) return { error: `Could not read “${rest.slice(i, i + 12)}”.` };
    args.push(m[1] != null ? { kind: 'num', v: Number(m[1]) } : { kind: 'name', v: m[2] });
    i += m[0].length;
  }
  return { fn, args };
}

export interface CommandResult {
  /** A new figure to draw, when the command plots. */
  spec?: ChartSpec;
  output: string;
  error?: boolean;
  clear?: boolean;
}

export const HELP = `Plots (redraw the figure)
  bar(Q1)            bar(Q1, Q3)   bar(Q1, Q3, 'stacked')   barh(Q1)
  pie(Q1)            histogram(Q2)   histogram(Q2, 10)
  boxchart(Q2)       boxchart(Q1, Q2)      errorbar(Q1, Q2)   (means ± 95% CI)
  scatter(Q2, Q5)    scatter(Q2, Q5, Q1)   (colour by Q1)
  heatmap(Q1, Q3)    plot(Submitted)       plot(Submitted, 'cumulative')
  title('My title')  xlabel('…')  ylabel('…')   grid   sort   percent
Results (printed here)
  mean(Q2)  median(Q2)  std(Q2)  var(Q2)  min(Q2)  max(Q2)  numel(Q2)
  summary(Q2)  tabulate(Q1)  corr(Q2, Q5)  fitlm(Q2, Q5)
  fitlm(Q1, Q2, Q5)   (regression: predictors, then the outcome)
  fitglm(Q2, Q3, Q4, 'Yes')   (logistic: chance that Q4 is “Yes”)
  ttest2(Q2, Q1)   anova1(Q2, Q1)   crosstab(Q1, Q3)
Other
  who / whos   (list variables)   clc   (clear this window)   help`;

const PLOTS: Record<string, ChartSpec['type']> = {
  bar: 'bar', barh: 'barh', pie: 'pie', histogram: 'histogram', hist: 'histogram', boxchart: 'box', boxplot: 'box',
  errorbar: 'means', scatter: 'scatter', plot: 'line', heatmap: 'heatmap',
};

const n4 = (v: number | null) => (v == null ? 'NaN' : String(round(v, 4)));

export function runCommand(src: string, ds: Dataset, current: ChartSpec): CommandResult {
  const p = parseCommand(src);
  if (!p) return { output: '' };
  if ('error' in p) return { output: p.error, error: true };
  const fn = p.fn.toLowerCase();
  const err = (output: string): CommandResult => ({ output, error: true });
  const vars: StudioVar[] = [];
  const opts: string[] = [];
  let numArg: number | undefined;
  for (const a of p.args) {
    if (a.kind === 'name') {
      const v = findVar(ds, a.v);
      if (!v) {
        if (PLOTS[fn] && /^(stacked|cumulative|percent|sorted?)$/i.test(a.v)) { opts.push(a.v.toLowerCase()); continue; }
        return err(`Undefined variable “${a.v}”. Type who to list the variables.`);
      }
      vars.push(v);
    } else if (a.kind === 'num') numArg = a.v;
    else opts.push(a.v.toLowerCase());
  }
  const text = p.args.find((a) => a.kind === 'str')?.v as string | undefined;
  const needNum = (v: StudioVar | undefined, what = 'This'): string | null =>
    !v ? `${what} needs a variable, e.g. ${fn}(Q2).` : !isNum(v) ? `${v.name} is not a number question.` : null;
  const values = (v: StudioVar) => numsOf(v).filter((x): x is number => x != null);

  if (fn === 'help' || fn === 'doc') return { output: HELP };
  if (fn === 'clc') return { output: '', clear: true };
  if (fn === 'who' || fn === 'whos') {
    return {
      output: ds.vars.map((v) => `  ${v.name.padEnd(10)} ${(v.scale ? 'scale' : v.kind).padEnd(12)} ${v.label.slice(0, 70)}`).join('\n') + `\n  ${ds.n} responses`,
    };
  }
  if (fn === 'title' || fn === 'xlabel' || fn === 'ylabel') {
    return { spec: { ...current, [fn]: text ?? '' }, output: '' };
  }
  if (fn === 'sort' || fn === 'percent') return { spec: { ...current, [fn]: !current[fn] }, output: `${fn} ${current[fn] ? 'off' : 'on'}` };
  if (fn === 'grid') return { output: 'Grid lines are always on.' };

  const type = PLOTS[fn];
  if (type) {
    const [a, b, c] = vars;
    if (!a && type !== 'line') return err(`${fn} needs a variable, e.g. ${fn}(${ds.vars.find((v) => (type === 'histogram' || type === 'scatter' ? isNum(v) : isCat(v)))?.name ?? 'Q1'}).`);
    let spec: ChartSpec;
    switch (type) {
      case 'bar': case 'barh': spec = { type, x: a.name, group: b?.name, stacked: opts.includes('stacked'), percent: opts.includes('percent'), sort: opts.some((o) => o.startsWith('sort')) }; break;
      case 'pie': spec = { type, x: a.name }; break;
      case 'histogram': spec = { type, x: a.name, bins: numArg }; break;
      // MATLAB order: boxchart(xgroupdata, ydata) and errorbar(groups, values).
      case 'box': spec = b ? { type, x: a.name, y: b.name } : { type, x: a.name }; break;
      case 'means': spec = b ? { type, x: a.name, y: b.name } : { type, x: a.name }; break;
      case 'scatter': spec = { type, x: a.name, y: b?.name, group: c?.name, fit: true }; break;
      case 'line': spec = { type, x: a?.name ?? 'Submitted', cumulative: opts.includes('cumulative') }; break;
      case 'heatmap': spec = { type, x: a.name, y: b?.name }; break;
    }
    return { spec, output: '' };
  }

  const [a, b] = vars;
  switch (fn) {
    case 'mean': case 'median': case 'std': case 'var': case 'min': case 'max': case 'numel': case 'length': case 'sum': {
      const e = needNum(a); if (e) return err(e);
      const xs = values(a), d = describe(xs);
      const v = fn === 'mean' ? d.mean : fn === 'median' ? d.median : fn === 'std' ? d.sd : fn === 'var' ? (d.sd == null ? null : d.sd ** 2)
        : fn === 'min' ? d.min : fn === 'max' ? d.max : fn === 'sum' ? xs.reduce((s, x) => s + x, 0) : xs.length;
      return { output: `ans = ${n4(v)}${fn === 'numel' || fn === 'length' ? '' : `   (n = ${xs.length}, blanks left out)`}` };
    }
    case 'summary': case 'describe': {
      if (!a) return err('summary needs a variable, e.g. summary(Q2).');
      if (isNum(a)) {
        const d = describe(values(a));
        return { output: `${a.name}: ${a.label}\n  n ${d.n}   missing ${ds.n - d.n}\n  mean ${n4(d.mean)}   SD ${n4(d.sd)}\n  min ${n4(d.min)}   Q1 ${n4(d.q1)}   median ${n4(d.median)}   Q3 ${n4(d.q3)}   max ${n4(d.max)}` };
      }
      return runCommand(`tabulate(${a.name})`, ds, current);
    }
    case 'tabulate': case 'tabulation': case 'countcats': {
      if (!a || !isCat(a)) return err('tabulate needs a choice or scale question, e.g. tabulate(Q1).');
      const ans = answeredCats(ds, a);
      const w = Math.max(5, ...a.categories.map((c) => Math.min(30, c.length)));
      const lines = a.categories.map((c) => { const k = ans.filter((x) => x.includes(c)).length; return `  ${c.slice(0, 30).padEnd(w)}  ${String(k).padStart(5)}  ${(ans.length ? (k / ans.length) * 100 : 0).toFixed(1).padStart(6)}%`; });
      return { output: `  ${'Value'.padEnd(w)}  ${'Count'.padStart(5)}  Percent\n${lines.join('\n')}\n  ${ans.length} answered, ${ds.n - ans.length} blank` };
    }
    case 'fitglm': case 'logit': case 'fitlm': case 'regress': {
      // MATLAB order: predictors first, outcome last — fitlm(Q2, Q3, Q5) explains Q5 by Q2 and Q3.
      if (fn === 'fitlm' && vars.length === 2 && isNum(vars[0]) && isNum(vars[1])) return runCommand(`corr_fit(${vars[0].name}, ${vars[1].name})`, ds, current);
      if (vars.length < 2) return err(`${fn} needs predictors and then the outcome, e.g. ${fn}(Q2, Q3, Q5).`);
      const y = vars[vars.length - 1];
      const logistic = fn === 'fitglm' || fn === 'logit';
      const event = p.args.find((x) => x.kind === 'str')?.v as string | undefined;
      const fit = fitModel(ds, { outcome: y.name, predictors: vars.slice(0, -1).map((v) => v.name), kind: logistic ? 'logistic' : 'linear', event, weighted: !!ds.weights });
      if (typeof fit === 'string') return err(fit);
      const rows = fitTable(fit);
      const w = rows[0].map((_, j) => Math.max(...rows.map((r) => String(r[j]).length)));
      const table = rows.map((r) => '  ' + r.map((c, j) => (j === 0 ? String(c).padEnd(w[j]) : String(c).padStart(w[j]))).join('  ')).join('\n');
      return { output: `${describeFit(fit, ds).join('\n')}\n${table}` };
    }
    case 'corr_fit': case 'corr': case 'corrcoef': case 'polyfit': {
      const e = needNum(a, fn) ?? needNum(b, fn); if (e) return err(e.replace('This', fn));
      const xs: number[] = [], ys: number[] = [];
      numsOf(a).forEach((x, i) => { const y = numsOf(b)[i]; if (x != null && y != null) { xs.push(x); ys.push(y); } });
      const c = pearson(xs, ys);
      if (!c) return err('Not enough paired, varied answers yet.');
      return fn === 'corr' || fn === 'corrcoef'
        ? { output: `r = ${c.r}   ${fmtP(c.p)}   n = ${c.n}   (Pearson)` }
        : { output: `${b.name} = ${n4(c.slope)} × ${a.name} ${c.intercept < 0 ? '−' : '+'} ${n4(Math.abs(c.intercept))}\n  R² = ${c.r2}   ${fmtP(c.p)}   n = ${c.n}` };
    }
    case 'ttest2': case 'anova1': {
      // ttest2(values, groups) — the second argument splits the first, as in MATLAB's anova1(y, group).
      const e = needNum(a, fn); if (e) return err(e.replace('This', fn));
      if (!b || !isCat(b) || b.kind === 'multi') return err(`${fn} needs a single-choice question to split by, e.g. ${fn}(${a.name}, Q1).`);
      const groups = new Map<string, number[]>();
      numsOf(a).forEach((x, i) => { const g = catsOf(b, i)[0]; if (x != null && g != null) groups.set(g, [...(groups.get(g) ?? []), x]); });
      const ordered = b.categories.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!] as const);
      if (fn === 'ttest2') {
        if (ordered.length !== 2) return err(`ttest2 compares exactly two groups; ${b.name} has ${ordered.length} with answers. Use anova1 for more.`);
        const t = welchT(ordered[0][1], ordered[1][1], [ordered[0][0], ordered[1][0]]);
        if (!t) return err('Each group needs at least two answers.');
        return { output: `Welch two-sample t-test\n  t = ${t.t}   df = ${t.df}   ${fmtP(t.p)}\n  mean difference (${t.groups[0]} − ${t.groups[1]}) = ${n4(t.diff)}` };
      }
      const r = anova1(ordered.map(([, xs]) => xs));
      if (!r) return err('Need at least two groups with answers, and some spread within them.');
      return { output: `One-way ANOVA\n  F(${r.df1}, ${r.df2}) = ${r.f}   ${fmtP(r.p)}   η² = ${r.eta2}` };
    }
    case 'crosstab': case 'chi2': {
      if (!a || !b || !isCat(a) || !isCat(b)) return err('crosstab needs two choice or scale questions, e.g. crosstab(Q1, Q3).');
      if (a.kind === 'multi' || b.kind === 'multi') return err('Chi-square needs single-choice questions (checkbox answers overlap).');
      const t = a.categories.map((r) => b.categories.map((c) => { let k = 0; for (let i = 0; i < ds.n; i++) if (catsOf(a, i)[0] === r && catsOf(b, i)[0] === c) k++; return k; }));
      const chi = chiSquare(t);
      const w = Math.max(6, ...a.categories.map((c) => Math.min(20, c.length)));
      const head = `  ${''.padEnd(w)}  ${b.categories.map((c) => c.slice(0, 10).padStart(10)).join(' ')}`;
      const body = a.categories.map((r, i) => `  ${r.slice(0, 20).padEnd(w)}  ${t[i].map((x) => String(x).padStart(10)).join(' ')}`).join('\n');
      return { output: `${head}\n${body}\n${chi ? `  χ² = ${chi.chi2}   df = ${chi.df}   ${fmtP(chi.p)}` : '  Not enough data for a chi-square test.'}` };
    }
  }
  return err(`Unknown command “${p.fn}”. Type help for the list.`);
}
