// Per-question statistics for a ResearchHub questionnaire. Pure functions:
// computed in the browser from the owner's own responses (RLS-scoped), so the
// numbers shown, exported and printed are always the same ones.
import type { AnswerValue, FieldType, RhField, RhResponse } from '../api/research';

export interface Bar { label: string; count: number; pct: number }

interface Base { fieldId: string; label: string; type: FieldType; answered: number; missing: number }
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
export type FieldStats = NumericStats | ChoiceStats | MultiStats | TextStats;

const isBlank = (v: AnswerValue | undefined) =>
  v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');

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
export function numericBars(xs: number[], type: FieldType): Bar[] {
  if (!xs.length) return [];
  if (type === 'scale') {
    return [1, 2, 3, 4, 5].map((v) => {
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

export function fieldStats(field: RhField, responses: RhResponse[]): FieldStats {
  const values = responses.map((r) => r.answers[field.id]).filter((v) => !isBlank(v));
  const base = { fieldId: field.id, label: field.label, type: field.type, answered: values.length, missing: responses.length - values.length };

  if (field.type === 'number' || field.type === 'scale') {
    const xs = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    return {
      ...base, kind: 'numeric', mean: mean(xs), median: median(xs), sd: sd(xs),
      min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null,
      bars: numericBars(xs, field.type),
    };
  }

  if (field.type === 'radio' || field.type === 'checkbox') {
    const counts = new Map<string, number>(field.options.map((o) => [o, 0]));
    for (const v of values) {
      for (const choice of Array.isArray(v) ? v : [String(v)]) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    }
    const bars = [...counts].map(([label, count]) => ({ label, count, pct: pct(count, values.length) }));
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
  return { ...base, kind: 'text', repeated, recent };
}

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
  const answeredShare = responses.map((r) =>
    fields.length ? fields.filter((f) => !isBlank(r.answers[f.id])).length / fields.length : 1);
  return {
    responses: responses.length,
    first: responses[0]?.submitted_at ?? null,
    last: responses.at(-1)?.submitted_at ?? null,
    completion: round((mean(answeredShare) ?? 0) * 100, 0),
    perDay: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
  };
}
