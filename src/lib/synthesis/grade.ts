// GRADE summary of findings: one row per outcome, the five downgrading domains,
// and the resulting certainty (which reviewers can override with a reason).
// Stored in project_settings.settings.grade.
import Papa from 'papaparse';

export const LEVELS = ['Very low', 'Low', 'Moderate', 'High'] as const;
export type Level = (typeof LEVELS)[number];
export const DOMAIN_OPTIONS = ['Not serious', 'Serious', 'Very serious'] as const;
export const PUB_OPTIONS = ['Undetected', 'Strongly suspected'] as const;
export const DOMAINS = [
  { key: 'risk_of_bias', label: 'Risk of bias' },
  { key: 'inconsistency', label: 'Inconsistency' },
  { key: 'indirectness', label: 'Indirectness' },
  { key: 'imprecision', label: 'Imprecision' },
] as const;
type DomainKey = (typeof DOMAINS)[number]['key'];

export interface GradeRow {
  id: string;
  outcome: string;
  studies: string;
  design: string;
  /** Where the rating starts: High for randomised trials, Low for observational evidence. */
  start: 'High' | 'Low';
  risk_of_bias: string;
  inconsistency: string;
  indirectness: string;
  imprecision: string;
  publication_bias: string;
  /** Number of levels to upgrade (large effect, dose-response…), 0–2. */
  upgrade: number;
  effect: string;
  /** Reviewer's own certainty when it differs from the calculated one. */
  override: Level | '';
  comments: string;
}

export const blankRow = (id: string): GradeRow => ({
  id, outcome: '', studies: '', design: '', start: 'Low', risk_of_bias: 'Not serious', inconsistency: 'Not serious',
  indirectness: 'Not serious', imprecision: 'Not serious', publication_bias: 'Undetected', upgrade: 0, effect: '', override: '', comments: '',
});

const steps = (v: string) => (v === 'Very serious' ? 2 : v === 'Serious' || v === 'Strongly suspected' ? 1 : 0);

/** Start level, minus one per serious concern (two if very serious), plus upgrades, kept within Very low–High. */
export function calculatedCertainty(r: GradeRow): Level {
  let i = r.start === 'High' ? 3 : 1;
  for (const d of DOMAINS) i -= steps(r[d.key as DomainKey]);
  i -= steps(r.publication_bias);
  i += Math.max(0, Math.min(2, Math.floor(r.upgrade || 0)));
  return LEVELS[Math.max(0, Math.min(3, i))];
}
export const certaintyOf = (r: GradeRow): Level => r.override || calculatedCertainty(r);

export function readGrade(settings: { settings?: Record<string, unknown> } | undefined): GradeRow[] {
  const raw = (settings?.settings?.grade as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Partial<GradeRow> & { id: string } => !!x && typeof (x as GradeRow).id === 'string')
    .map((x) => ({ ...blankRow(x.id), ...x, override: LEVELS.includes(x.override as Level) ? (x.override as Level) : '' }));
}

export const GRADE_HEAD = ['Outcome', 'Studies', 'Design', 'Risk of bias', 'Inconsistency', 'Indirectness', 'Imprecision', 'Publication bias', 'Summary of findings', 'Certainty', 'Comments'];
export function gradeTableRows(rows: GradeRow[]): string[][] {
  return rows.map((r) => [
    r.outcome, r.studies, r.design, r.risk_of_bias, r.inconsistency, r.indirectness, r.imprecision, r.publication_bias, r.effect,
    certaintyOf(r) + (r.override && r.override !== calculatedCertainty(r) ? ' (reviewer judgement)' : ''), r.comments,
  ]);
}
export const gradeCsv = (rows: GradeRow[]) => '﻿' + Papa.unparse([GRADE_HEAD, ...gradeTableRows(rows)]);
