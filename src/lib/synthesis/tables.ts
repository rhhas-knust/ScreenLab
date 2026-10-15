// Synthesis tables built from the agreed (final) extractions: evidence tables
// grouped by a field (e.g. tier), cross-tabulations of two fields, and exports.
import Papa from 'papaparse';
import { display, isEmpty, type ExtractionData, type ExtractionForm, type FormField } from '../extraction/form';

export interface SynthesisStudy {
  seq: number;
  label: string;
  title: string | null;
  data: ExtractionData;
  /** Agreed overall risk of bias, if appraised. */
  rob: string | null;
}

/** Pseudo-field so risk of bias can be used like any extraction field. */
export const ROB_FIELD: FormField = { key: '__rob', label: 'Overall risk of bias', type: 'choice', options: ['Low', 'Moderate', 'High'] };
export const NOT_RECORDED = 'Not recorded';

export function fieldsWithRob(form: ExtractionForm, hasRob: boolean): FormField[] {
  return hasRob ? [...form.fields, ROB_FIELD] : form.fields;
}
const valueOf = (s: SynthesisStudy, f: FormField) => (f.key === ROB_FIELD.key ? (s.rob ?? '') : s.data[f.key]);
/** The values a study takes for a field: one for choice/text, possibly several for multi. */
export function valuesOf(s: SynthesisStudy, f: FormField): string[] {
  const v = valueOf(s, f);
  if (isEmpty(v)) return [NOT_RECORDED];
  return Array.isArray(v) ? v : [v.trim()];
}
/** Option order first, then any other values seen, "Not recorded" last. */
function orderedValues(f: FormField, studies: SynthesisStudy[]): string[] {
  const seen = new Set(studies.flatMap((s) => valuesOf(s, f)));
  const out = (f.options ?? []).filter((o) => seen.has(o));
  for (const v of seen) if (!out.includes(v) && v !== NOT_RECORDED) out.push(v);
  if (seen.has(NOT_RECORDED)) out.push(NOT_RECORDED);
  return out;
}

export interface Group { value: string; studies: SynthesisStudy[] }
/** Studies grouped by a field. With a several-choice field a study can appear in more than one group. */
export function groupStudies(f: FormField, studies: SynthesisStudy[]): Group[] {
  return orderedValues(f, studies).map((value) => ({ value, studies: studies.filter((s) => valuesOf(s, f).includes(value)) }));
}

export interface CrossTab { rows: string[]; cols: string[]; counts: number[][]; rowTotals: number[]; colTotals: number[]; studies: number; multi: boolean }
/** Number of studies for each pair of values. Several-choice fields count a study once per value. */
export function crossTab(rowField: FormField, colField: FormField, studies: SynthesisStudy[]): CrossTab {
  const rows = orderedValues(rowField, studies);
  const cols = orderedValues(colField, studies);
  const counts = rows.map((r) => cols.map((c) => studies.filter((s) => valuesOf(s, rowField).includes(r) && valuesOf(s, colField).includes(c)).length));
  return {
    rows, cols, counts,
    rowTotals: rows.map((r) => studies.filter((s) => valuesOf(s, rowField).includes(r)).length),
    colTotals: cols.map((c) => studies.filter((s) => valuesOf(s, colField).includes(c)).length),
    studies: studies.length,
    multi: rowField.type === 'multi' || colField.type === 'multi',
  };
}

const cell = (s: SynthesisStudy, f: FormField) => (f.key === ROB_FIELD.key ? (s.rob ?? '') : display(s.data[f.key]));

export function evidenceCsv(groupBy: FormField, columns: FormField[], groups: Group[]): string {
  return '﻿' + Papa.unparse([
    [groupBy.label, 'ID', 'Study', ...columns.map((c) => c.label)],
    ...groups.flatMap((g) => g.studies.map((s) => [g.value, `#${s.seq}`, s.label, ...columns.map((c) => cell(s, c))])),
  ]);
}
export function crossTabCsv(rowField: FormField, colField: FormField, t: CrossTab): string {
  return '﻿' + Papa.unparse([
    [`${rowField.label} \\ ${colField.label}`, ...t.cols, 'Total'],
    ...t.rows.map((r, i) => [r, ...t.counts[i].map(String), String(t.rowTotals[i])]),
    ['Total', ...t.colTotals.map(String), String(t.studies)],
  ]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A minimal Word-compatible document (Word opens HTML saved as .doc) with one or more tables. */
export function wordDoc(title: string, sections: { heading: string; head: string[]; rows: string[][]; note?: string }[]): string {
  const table = (head: string[], rows: string[][]) =>
    `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:9pt"><tr>${head.map((h) => `<th style="background:#eef1f5">${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td valign="top">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  return `<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Arial,sans-serif">` +
    `<h1 style="font-size:14pt">${esc(title)}</h1>` +
    sections.map((s) => `<h2 style="font-size:12pt">${esc(s.heading)}</h2>${table(s.head, s.rows)}${s.note ? `<p style="font-size:9pt">${esc(s.note)}</p>` : ''}`).join('') +
    '</body></html>';
}

export function evidenceWord(title: string, groupBy: FormField, columns: FormField[], groups: Group[]): string {
  return wordDoc(title, groups.map((g) => ({
    heading: `${groupBy.label}: ${g.value} (${g.studies.length} stud${g.studies.length === 1 ? 'y' : 'ies'})`,
    head: ['Study', ...columns.map((c) => c.label)],
    rows: g.studies.map((s) => [`${s.label} (#${s.seq})`, ...columns.map((c) => cell(s, c))]),
  })));
}
