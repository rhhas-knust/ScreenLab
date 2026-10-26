// Per-question statistics for a ResearchHub questionnaire. Pure functions:
// computed in the browser from the owner's own responses (RLS-scoped), so the
// numbers shown, exported and printed are always the same ones.
import { visibleFields } from './logic';
import { scaleRange, type AnswerValue, type FieldType, type RhField, type RhResponse } from '../api/research';

export interface Bar { label: string; count: number; pct: number }

interface Base { fieldId: string; label: string; type: FieldType; answered: number; missing: number; /** Percentages and means use survey weights (counts stay as people). */ weighted?: boolean }
export interface NumericStats extends Base {
  kind: 'numeric';
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  bars: Bar[];
}
export interface ChoiceStats extends Base { kind: 'choice'; bars: Bar[] }
/** Checkboxes: percentages are of people who answered (they can tick several). */
export interface MultiStats extends Base { kind: 'multi'; bars: Bar[] }
export interface TextStats extends Base {
  kind: 'text';
  /** Answers given by more than one person (case-insensitive), most common first. */
  repeated: Bar[];
  /** Most recent answers, newest first. Never filled for email questions. */
  recent: string[];
}
/** Likert grid: answer counts per statement. */
export interface GridStats extends Base {
  kind: 'grid';
  columns: string[];
  rows: { label: string; answered: number; cells: Bar[] }[];
}
/** Ranking: mean position of each option (1 = top), lower is better. */
export interface RankingStats extends Base {
  kind: 'ranking';
  items: { label: string; meanRank: number | null; first: number; firstPct: number }[];
}
export interface DateStats extends Base { kind: 'date'; earliest: string | null; latest: string | null; bars: Bar[] }
/** File-upload and signature questions: only how many were given (the files open from the responses table). */
export interface FileStats extends Base { kind: 'files' }
export interface Theme { code: string; count: number; pct: number }
export type FieldStats = (NumericStats | ChoiceStats | MultiStats | TextStats | GridStats | RankingStats | DateStats | FileStats) & { themes?: Theme[] };

export const isBlank = (v: AnswerValue | undefined) =>
  v == null || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v).length === 0 : String(v).trim() === '');

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const pct = (count: number, of: number) => (of ? round((count / of) * 100, 1) : 0);

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Sample standard deviation (n − 1), as SPSS and Excel's STDEV report it. */
export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : String(round(n, 2));
}

/** Bars for a numeric question: one per value when there are few distinct values, else ~8 equal bins. */
export function numericBars(xs: number[], type: FieldType, points = [1, 2, 3, 4, 5]): Bar[] {
  if (!xs.length) return [];
  if (type === 'scale') {
    return points.map((v) => {
      const c = xs.filter((x) => x === v).length;
      return { label: String(v), count: c, pct: pct(c, xs.length) };
    });
  }
  const distinct = [...new Set(xs)].sort((a, b) => a - b);
  if (distinct.length <= 10) {
    return distinct.map((v) => {
      const c = xs.filter((x) => x === v).length;
      return { label: fmtNum(v), count: c, pct: pct(c, xs.length) };
    });
  }
  const lo = distinct[0], hi = distinct[distinct.length - 1];
  const bins = 8, width = (hi - lo) / bins;
  return Array.from({ length: bins }, (_, i) => {
    const a = lo + i * width, b = i === bins - 1 ? hi : lo + (i + 1) * width;
    const c = xs.filter((x) => (i === bins - 1 ? x >= a && x <= b : x >= a && x < b)).length;
    return { label: `${fmtNum(a)}–${fmtNum(b)}`, count: c, pct: pct(c, xs.length) };
  });
}

/**
 * Statistics for one question. With `weights`, percentages of choice,
 * checkbox and scale answers and the mean/SD of numbers are weighted; counts,
 * medians and ranges stay as plain counts of people.
 */
export function fieldStats(field: RhField, responses: RhResponse[], weights?: Map<string, number> | null): FieldStats {
  const answeredRs = responses.filter((r) => !isBlank(r.answers[field.id]));
  const values = answeredRs.map((r) => r.answers[field.id]);
  const wOf = (r: RhResponse) => (weights ? weights.get(r.id) ?? 1 : 1);
  const weighted = !!weights && (field.type === 'radio' || field.type === 'checkbox' || field.type === 'number' || field.type === 'scale' || field.type === 'calc');
  const base = { fieldId: field.id, label: field.label, type: field.type, answered: values.length, missing: responses.length - values.length, ...(weighted ? { weighted } : {}) };

  if (field.type === 'file' || field.type === 'signature') return { ...base, kind: 'files' };

  if (field.type === 'number' || field.type === 'scale' || field.type === 'calc') {
    const pairs = answeredRs.map((r) => [Number(r.answers[field.id]), wOf(r)] as const).filter(([x]) => Number.isFinite(x));
    const xs = pairs.map(([x]) => x);
    const bars = numericBars(xs, field.type, scaleRange(field.settings).points);
    if (!weighted) {
      return { ...base, kind: 'numeric', mean: mean(xs), median: median(xs), sd: sd(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, bars };
    }
    // Weighted mean and SD (frequency-weight formula, as SPSS WEIGHT BY and Hmisc::wtd.var).
    const sw = pairs.reduce((s, [, w]) => s + w, 0);
    const wm = sw ? pairs.reduce((s, [x, w]) => s + x * w, 0) / sw : null;
    const wsd = wm != null && sw > 1 ? Math.sqrt(pairs.reduce((s, [x, w]) => s + w * (x - wm) ** 2, 0) / (sw - 1)) : null;
    if (field.type === 'scale') {
      for (const b of bars) { const v = Number(b.label); const wv = pairs.filter(([x]) => x === v).reduce((s, [, w]) => s + w, 0); b.pct = sw ? round((wv / sw) * 100, 1) : 0; }
    }
    return { ...base, kind: 'numeric', mean: wm, median: median(xs), sd: wsd, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, bars };
  }

  if (field.type === 'grid') {
    const rows = (field.settings?.rows ?? []).map((row) => {
      const picks = values.map((v) => (v as Record<string, string>)[row]).filter(Boolean);
      return {
        label: row, answered: picks.length,
        cells: field.options.map((o) => { const c = picks.filter((x) => x === o).length; return { label: o, count: c, pct: pct(c, picks.length) }; }),
      };
    });
    return { ...base, kind: 'grid', columns: field.options, rows };
  }

  if (field.type === 'ranking') {
    const lists = values.filter(Array.isArray) as string[][];
    const items = field.options.map((o) => {
      const ranks = lists.map((l) => l.indexOf(o) + 1).filter((r) => r > 0);
      const first = lists.filter((l) => l[0] === o).length;
      return { label: o, meanRank: ranks.length ? round(mean(ranks)!, 2) : null, first, firstPct: pct(first, lists.length) };
    }).sort((a, b) => (a.meanRank ?? Infinity) - (b.meanRank ?? Infinity));
    return { ...base, kind: 'ranking', items };
  }

  if (field.type === 'date') {
    const ds = values.map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const months = new Map<string, number>();
    for (const d of ds) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + 1);
    return {
      ...base, kind: 'date', earliest: ds[0] ?? null, latest: ds.at(-1) ?? null,
      bars: [...months].map(([label, count]) => ({ label, count, pct: pct(count, ds.length) })),
    };
  }

  if (field.type === 'radio' || field.type === 'checkbox') {
    const counts = new Map<string, number>(field.options.map((o) => [o, 0]));
    for (const v of values) {
      for (const choice of Array.isArray(v) ? v : [String(v)]) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    }
    const wsum = new Map<string, number>();
    let wall = 0;
    if (weighted) for (const r of answeredRs) { const v = r.answers[field.id]; const w = wOf(r); wall += w; for (const c of Array.isArray(v) ? v : [String(v)]) wsum.set(c, (wsum.get(c) ?? 0) + w); }
    const bars = [...counts].map(([label, count]) => ({ label, count, pct: weighted ? (wall ? round(((wsum.get(label) ?? 0) / wall) * 100, 1) : 0) : pct(count, values.length) }));
    return field.type === 'radio' ? { ...base, kind: 'choice', bars } : { ...base, kind: 'multi', bars };
  }

  // text, textarea, email
  const tally = new Map<string, { label: string; count: number }>();
  for (const v of values) {
    const text = String(v).trim();
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const t = tally.get(key);
    if (t) t.count++; else tally.set(key, { label: text, count: 1 });
  }
  const repeated = field.type === 'email' ? [] : [...tally.values()]
    .filter((t) => t.count > 1).sort((a, b) => b.count - a.count).slice(0, 5)
    .map((t) => ({ ...t, pct: pct(t.count, values.length) }));
  const recent = field.type === 'email' ? [] : responses
    .filter((r) => !isBlank(r.answers[field.id]))
    .slice(-5).reverse().map((r) => String(r.answers[field.id]).trim());
  const themes = themeCounts(field.id, responses);
  return { ...base, kind: 'text', repeated, recent, ...(themes.length ? { themes } : {}) };
}

/** How often each theme code was given to answers of a text question (share of answers that were coded). */
export function themeCounts(fieldId: string, responses: RhResponse[]): Theme[] {
  const coded = responses.filter((r) => r.codes?.[fieldId]?.length);
  const counts = new Map<string, number>();
  for (const r of coded) for (const c of new Set(r.codes![fieldId])) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count, pct: pct(count, coded.length) }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Filters and cross-tabulation
// ---------------------------------------------------------------------------

/** Questions whose answers fall into categories (usable for filters and cross-tabs). */
export const isCategorical = (t: FieldType) => t === 'radio' || t === 'checkbox' || t === 'scale';

/** The categories of a categorical question, in display order. */
export function categories(f: RhField): string[] {
  return f.type === 'scale' ? scaleRange(f.settings).points.map(String) : f.options;
}

/** The categories one response falls into for a question (several for checkboxes). */
export function answerCategories(v: AnswerValue | undefined): string[] {
  if (isBlank(v)) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return [];
  return [String(v)];
}

export interface Filter { field: string; value: string }

/** Responses matching every filter (a checkbox answer matches when the option was ticked). */
export function applyFilters(fields: RhField[], responses: RhResponse[], filters: Filter[]): RhResponse[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const active = filters.filter((x) => byId.has(x.field) && x.value);
  if (!active.length) return responses;
  return responses.filter((r) => active.every((x) => answerCategories(r.answers[x.field]).includes(x.value)));
}

export interface CrossTab {
  rows: string[];
  cols: string[];
  /** counts[row][col] */
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
  /** Respondents who answered both questions. */
  respondents: number;
  /** Chi-square test of independence, when it can be computed (single-choice questions only). */
  chi: { chi2: number; df: number; p: number; lowExpected: number } | null;
}

export function crossTab(rowField: RhField, colField: RhField, responses: RhResponse[]): CrossTab {
  const rows = categories(rowField), cols = categories(colField);
  const counts = rows.map(() => cols.map(() => 0));
  let respondents = 0;
  for (const r of responses) {
    const a = answerCategories(r.answers[rowField.id]), b = answerCategories(r.answers[colField.id]);
    if (!a.length || !b.length) continue;
    respondents++;
    for (const x of a) for (const y of b) {
      const i = rows.indexOf(x), j = cols.indexOf(y);
      if (i >= 0 && j >= 0) counts[i][j]++;
    }
  }
  const rowTotals = counts.map((r) => r.reduce((s, x) => s + x, 0));
  const colTotals = cols.map((_, j) => counts.reduce((s, r) => s + r[j], 0));
  const total = rowTotals.reduce((s, x) => s + x, 0);
  const single = rowField.type !== 'checkbox' && colField.type !== 'checkbox';
  return { rows, cols, counts, rowTotals, colTotals, total, respondents, chi: single ? chiSquare(counts) : null };
}

/** Pearson chi-square test of independence. Empty rows/columns are left out. */
export function chiSquare(table: number[][]): CrossTab['chi'] {
  const rowsKept = table.filter((r) => r.some((x) => x > 0));
  if (!rowsKept.length) return null;
  const colKeep = rowsKept[0].map((_, j) => rowsKept.some((r) => r[j] > 0));
  const t = rowsKept.map((r) => r.filter((_, j) => colKeep[j]));
  const R = t.length, C = t[0].length;
  if (R < 2 || C < 2) return null;
  const rt = t.map((r) => r.reduce((s, x) => s + x, 0));
  const ct = t[0].map((_, j) => t.reduce((s, r) => s + r[j], 0));
  const n = rt.reduce((s, x) => s + x, 0);
  let chi2 = 0, low = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const e = (rt[i] * ct[j]) / n;
    if (e < 5) low++;
    chi2 += (t[i][j] - e) ** 2 / e;
  }
  const df = (R - 1) * (C - 1);
  return { chi2: round(chi2, 3), df, p: chiSquareP(chi2, df), lowExpected: round((low / (R * C)) * 100, 0) };
}

/** Upper-tail p-value of the chi-square distribution: Q(df/2, x/2). */
export function chiSquareP(x: number, df: number): number {
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

export function logGamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularised upper incomplete gamma function (Numerical Recipes gammq). */
function gammaQ(a: number, x: number): number {
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let i = 0; i < 500; i++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}

/** Cross-tab as CSV: counts with row percentages. */
export function crossTabCsv(rowField: RhField, colField: RhField, t: CrossTab): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [[`${rowField.label} \\ ${colField.label}`, ...t.cols, 'Total'].map(esc).join(',')];
  t.rows.forEach((r, i) => lines.push([r, ...t.counts[i].map((c) => `${c} (${t.rowTotals[i] ? round((c / t.rowTotals[i]) * 100, 1) : 0}%)`), String(t.rowTotals[i])].map(esc).join(',')));
  lines.push(['Total', ...t.colTotals.map(String), String(t.total)].map(esc).join(','));
  if (t.chi) lines.push(esc(`Chi-square = ${t.chi.chi2}, df = ${t.chi.df}, p = ${fmtP(t.chi.p)}`));
  return '\ufeff' + lines.join('\n');
}

export const fmtP = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

export interface Overview {
  responses: number;
  first: string | null;
  last: string | null;
  /** Average share of questions answered per response, 0–100. */
  completion: number;
  perDay: { date: string; count: number }[];
}

export function overview(fields: RhField[], responses: RhResponse[]): Overview {
  const days = new Map<string, number>();
  for (const r of responses) {
    const d = r.submitted_at.slice(0, 10);
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  // Share of the questions this respondent was shown (skip logic hides some) that they answered.
  const answeredShare = responses.map((r) => {
    const shown = visibleFields(fields, r.answers);
    return shown.length ? shown.filter((f) => !isBlank(r.answers[f.id])).length / shown.length : 1;
  });
  return {
    responses: responses.length,
    first: responses[0]?.submitted_at ?? null,
    last: responses.at(-1)?.submitted_at ?? null,
    completion: round((mean(answeredShare) ?? 0) * 100, 0),
    perDay: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
  };
}
