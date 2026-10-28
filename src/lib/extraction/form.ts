// Data extraction form: field definitions, presets, comparison of two
// reviewers' extractions, agreement statistics and the characteristics table.
// Pure functions; the form itself is stored in project_settings.settings.extraction_form.
import Papa from 'papaparse';

export type FieldType = 'text' | 'long' | 'number' | 'choice' | 'multi';
export interface FormField {
  /** Stable id used in saved data. Never changes once extraction has started. */
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  help?: string;
}
export interface ExtractionForm { fields: FormField[]; /** Name of the preset it started from, e.g. the appraisal tool. */ name?: string }
export type Value = string | string[];
export type ExtractionData = Record<string, Value>;

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short text', long: 'Long text', number: 'Number', choice: 'One choice', multi: 'Several choices',
};
/** The field PRISMA uses to split the included studies. */
export const TIER_KEY = 'tier';
/** The risk-of-bias field holding the overall judgement. */
export const OVERALL_KEY = 'overall';

/** Data extraction and risk-of-bias appraisal share one engine (blinding, comparison, agreed final). */
export type ModuleKind = 'extraction' | 'rob';
export const MODULES: Record<ModuleKind, { title: string; path: string; settingsKey: string; noun: string; summaryKey: string; aiDraftsKey: string }> = {
  extraction: { title: 'Data extraction', path: 'extraction', settingsKey: 'extraction_form', noun: 'extraction', summaryKey: TIER_KEY, aiDraftsKey: 'ai_extraction_drafts' },
  rob: { title: 'Risk of bias', path: 'risk-of-bias', settingsKey: 'rob_form', noun: 'appraisal', summaryKey: OVERALL_KEY, aiDraftsKey: 'ai_rob_drafts' },
};

const JBI = ['Yes', 'No', 'Unclear', 'Not applicable'];
const ROB_LEVELS = ['Low', 'Moderate', 'High'];

const f = (key: string, label: string, type: FieldType, extra: Partial<FormField> = {}): FormField => ({ key, label, type, ...extra });

export const PRESETS: { id: string; name: string; description: string; form: ExtractionForm }[] = [
  {
    id: 'llm-equity',
    name: 'LLM safety and equity studies',
    description: 'For reviews of studies that test large language models for bias or disparities, with a Tier field.',
    form: {
      fields: [
        f('tier', 'Tier', 'choice', { options: ['Tier 1', 'Tier 2'], help: 'Tier 1: tests a safety mechanism against one disparity factor at a time. Tier 2: examines two or more factors together, or tests no safety mechanism.' }),
        f('study_design', 'Study design', 'choice', { options: ['Evaluation / benchmark (vignettes or prompts)', 'Experimental (with vs without a mechanism)', 'Observational (real-world use)', 'Randomised trial', 'Mixed methods', 'Other'] }),
        f('country', 'Country / setting', 'text'),
        f('clinical_domain', 'Clinical domain or task', 'text', { help: 'e.g. emergency triage, dermatology diagnosis, patient education' }),
        f('llms', 'LLMs tested', 'long', { help: 'Model names and versions, with dates if reported' }),
        f('factors', 'Disparity factor(s)', 'multi', { options: ['Race/ethnicity', 'Language', 'Culture', 'Skin tone', 'Other'] }),
        f('other_factors', 'Other factors tested alongside', 'text', { help: 'e.g. sex, age, income' }),
        f('safety_mechanism', 'Safety mechanism tested', 'multi', { options: ['None', 'Alignment / RLHF', 'Fine-tuning', 'Guardrails', 'Prompt-level safeguards', 'Retrieval / grounding', 'Refusal', 'Output filtering', 'Human review', 'Other'] }),
        f('data_source', 'Data, vignettes or prompts', 'long', { help: 'Dataset or how prompts were built' }),
        f('sample_size', 'Number of cases / prompts', 'number'),
        f('outcome_measures', 'Outcome measures', 'long', { help: 'e.g. accuracy, refusal rate, readability, harmful output' }),
        f('disparity_found', 'Disparity found?', 'choice', { options: ['Yes', 'No', 'Mixed', 'Not reported'] }),
        f('mechanism_effect', 'Effect of the safety mechanism', 'choice', { options: ['Reduced disparity', 'No change', 'Increased disparity', 'Mixed', 'Not applicable'] }),
        f('key_findings', 'Key findings', 'long'),
        f('limitations', 'Limitations noted', 'long'),
        f('notes', 'Notes', 'long'),
      ],
    },
  },
  {
    id: 'general',
    name: 'General systematic review',
    description: 'Standard study characteristics (PICO, design, setting, results).',
    form: {
      fields: [
        f('study_design', 'Study design', 'choice', { options: ['Randomised trial', 'Cohort', 'Case-control', 'Cross-sectional', 'Qualitative', 'Mixed methods', 'Other'] }),
        f('country', 'Country', 'text'),
        f('setting', 'Setting', 'text'),
        f('population', 'Population', 'long'),
        f('sample_size', 'Sample size', 'number'),
        f('intervention', 'Intervention / exposure', 'long'),
        f('comparator', 'Comparator', 'long'),
        f('outcomes', 'Outcomes', 'long'),
        f('key_findings', 'Key findings', 'long'),
        f('funding', 'Funding', 'text'),
        f('notes', 'Notes', 'long'),
      ],
    },
  },
];

export const ROB_PRESETS: typeof PRESETS = [
  {
    id: 'jbi-llm',
    name: 'Adapted JBI checklist for LLM evaluation studies',
    description: 'JBI Critical Appraisal Checklist for Analytical Cross-Sectional Studies, adapted for studies that evaluate LLM outputs. Answers: Yes, No, Unclear, Not applicable.',
    form: {
      fields: [
        f('q1', 'Q1. Were the prompts, cases or vignettes clearly defined, and was their selection described?', 'choice', { options: JBI }),
        f('q2', 'Q2. Were the model(s), version(s) and settings (e.g. temperature, date of access) reported?', 'choice', { options: JBI }),
        f('q3', 'Q3. Was the demographic, language or cultural variation (or the safety mechanism) applied validly and consistently?', 'choice', { options: JBI }),
        f('q4', 'Q4. Were objective, standard criteria used to judge the outputs?', 'choice', { options: JBI }),
        f('q5', 'Q5. Were factors that could distort comparisons (e.g. prompt wording, order) identified?', 'choice', { options: JBI }),
        f('q6', 'Q6. Were strategies to deal with those factors stated (e.g. matched prompts, randomisation)?', 'choice', { options: JBI }),
        f('q7', 'Q7. Were outputs measured validly and reliably (e.g. blinded or multiple raters)?', 'choice', { options: JBI }),
        f('q8', 'Q8. Were repeated runs performed, or output variability accounted for?', 'choice', { options: JBI }),
        f('q9', 'Q9. Was appropriate statistical analysis used?', 'choice', { options: JBI }),
        f(OVERALL_KEY, 'Overall risk of bias', 'choice', { options: ROB_LEVELS, help: 'Your overall judgement for this study, based on the answers above.' }),
        f('rob_notes', 'Reasons for the judgement', 'long'),
      ],
    },
  },
  {
    id: 'jbi-cross-sectional',
    name: 'JBI checklist for analytical cross-sectional studies',
    description: 'The standard 8-item JBI checklist, unchanged.',
    form: {
      fields: [
        f('q1', 'Q1. Were the criteria for inclusion in the sample clearly defined?', 'choice', { options: JBI }),
        f('q2', 'Q2. Were the study subjects and the setting described in detail?', 'choice', { options: JBI }),
        f('q3', 'Q3. Was the exposure measured in a valid and reliable way?', 'choice', { options: JBI }),
        f('q4', 'Q4. Were objective, standard criteria used for measurement of the condition?', 'choice', { options: JBI }),
        f('q5', 'Q5. Were confounding factors identified?', 'choice', { options: JBI }),
        f('q6', 'Q6. Were strategies to deal with confounding factors stated?', 'choice', { options: JBI }),
        f('q7', 'Q7. Were the outcomes measured in a valid and reliable way?', 'choice', { options: JBI }),
        f('q8', 'Q8. Was appropriate statistical analysis used?', 'choice', { options: JBI }),
        f(OVERALL_KEY, 'Overall risk of bias', 'choice', { options: ROB_LEVELS }),
        f('rob_notes', 'Reasons for the judgement', 'long'),
      ],
    },
  },
];
export const presetsFor = (kind: ModuleKind) => (kind === 'rob' ? ROB_PRESETS : PRESETS);

/** Read the form from settings, dropping anything malformed. */
export function readForm(settings: { settings?: Record<string, unknown> } | undefined, kind: ModuleKind = 'extraction'): ExtractionForm | null {
  const raw = settings?.settings?.[MODULES[kind].settingsKey] as { fields?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.fields)) return null;
  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const x of raw.fields as Partial<FormField>[]) {
    if (!x || typeof x.key !== 'string' || typeof x.label !== 'string' || !x.key || seen.has(x.key)) continue;
    const type = (['text', 'long', 'number', 'choice', 'multi'] as FieldType[]).includes(x.type as FieldType) ? x.type as FieldType : 'text';
    seen.add(x.key);
    fields.push({
      key: x.key, label: x.label, type,
      ...(Array.isArray(x.options) ? { options: x.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') } : {}),
      ...(typeof x.help === 'string' && x.help ? { help: x.help } : {}),
    });
  }
  return { fields, ...(typeof (raw as { name?: unknown }).name === 'string' ? { name: (raw as { name: string }).name } : {}) };
}

/** A key for a new field, unique within the form. */
/**
 * AI-drafted extractions and appraisals, stored apart from reviewers' own work in
 * settings (MODULES[kind].aiDraftsKey) keyed by reference id. A reviewer can copy one
 * into their form to check; nothing is saved until they save it themselves.
 */
export interface AiDraft { source: string; data: ExtractionData; created_at?: string }
export function readAiDraft(settings: { settings?: Record<string, unknown> } | undefined, referenceId: string, kind: ModuleKind = 'extraction'): AiDraft | null {
  const all = settings?.settings?.[MODULES[kind].aiDraftsKey] as Record<string, unknown> | undefined;
  const d = all?.[referenceId] as Partial<AiDraft> | undefined;
  if (!d || typeof d.data !== 'object' || d.data === null) return null;
  return { source: typeof d.source === 'string' ? d.source : '', data: d.data as ExtractionData, created_at: d.created_at };
}
/** Fills only the fields that are still empty, so a reviewer's own answers are never overwritten. */
export function fillEmpty(form: ExtractionForm, mine: ExtractionData, draft: ExtractionData): { data: ExtractionData; filled: number } {
  const data = { ...mine };
  let filled = 0;
  for (const fl of form.fields) {
    const v = draft[fl.key];
    if (v == null || isEmpty(v) || !isEmpty(data[fl.key])) continue;
    data[fl.key] = Array.isArray(v) ? [...v] : v;
    filled++;
  }
  return { data, filled };
}

export function newKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`;
  return k;
}

const norm = (v: Value | undefined, type: FieldType): string => {
  if (v == null) return '';
  if (type === 'multi') return (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean).sort().join('\u0001');
  const s = (Array.isArray(v) ? v.join(' ') : v).trim().replace(/\s+/g, ' ');
  if (type === 'number') return s === '' ? '' : String(Number(s));
  return type === 'choice' ? s : s.toLowerCase();
};
export const isEmpty = (v: Value | undefined) => v == null || (Array.isArray(v) ? v.length === 0 : v.trim() === '');
export const sameValue = (a: Value | undefined, b: Value | undefined, type: FieldType) => norm(a, type) === norm(b, type);
export const display = (v: Value | undefined) => (v == null ? '' : Array.isArray(v) ? v.join('; ') : v);

/** Start the final extraction: agreed values are filled in, conflicts left for the reviewers. */
export function mergeForFinal(form: ExtractionForm, a: ExtractionData, b: ExtractionData | null): { data: ExtractionData; conflicts: string[] } {
  const data: ExtractionData = {};
  const conflicts: string[] = [];
  for (const fl of form.fields) {
    const va = a[fl.key], vb = b ? b[fl.key] : va;
    if (sameValue(va, vb, fl.type)) { if (!isEmpty(va)) data[fl.key] = va!; } else conflicts.push(fl.key);
  }
  return { data, conflicts };
}

export interface FieldAgreement {
  key: string;
  label: string;
  compared: number;
  agreed: number;
  /** Cohen's kappa for one-choice fields; null when not meaningful. */
  kappa: number | null;
}

/** Cohen's kappa for two raters' categorical labels. */
export function cohensKappa(pairs: [string, string][]): number | null {
  if (!pairs.length) return null;
  const n = pairs.length;
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const ca = new Map<string, number>(), cb = new Map<string, number>();
  for (const [x, y] of pairs) { ca.set(x, (ca.get(x) ?? 0) + 1); cb.set(y, (cb.get(y) ?? 0) + 1); }
  let pe = 0;
  for (const [k, c] of ca) pe += (c / n) * ((cb.get(k) ?? 0) / n);
  if (pe >= 1) return null;
  return (po - pe) / (1 - pe);
}

/** Agreement between the first two completed extractions of each study. */
export function agreement(form: ExtractionForm, pairs: [ExtractionData, ExtractionData][]): { fields: FieldAgreement[]; studies: number; cells: number; agreedCells: number } {
  const fields = form.fields.map((fl) => {
    let compared = 0, agreed = 0;
    const labels: [string, string][] = [];
    for (const [a, b] of pairs) {
      if (isEmpty(a[fl.key]) && isEmpty(b[fl.key])) continue;
      compared++;
      if (sameValue(a[fl.key], b[fl.key], fl.type)) agreed++;
      if (fl.type === 'choice') labels.push([norm(a[fl.key], 'choice') || '(blank)', norm(b[fl.key], 'choice') || '(blank)']);
    }
    return { key: fl.key, label: fl.label, compared, agreed, kappa: fl.type === 'choice' ? cohensKappa(labels) : null };
  });
  return {
    fields, studies: pairs.length,
    cells: fields.reduce((s, x) => s + x.compared, 0),
    agreedCells: fields.reduce((s, x) => s + x.agreed, 0),
  };
}

/** "Smith et al., 2024" from an author string in the usual export formats. */
export function studyLabel(authors: string | null, year: number | null): string {
  const list = (authors ?? '').split(/;|\band\b|\n/).map((s) => s.trim()).filter(Boolean);
  const first = list[0] ? (list[0].includes(',') ? list[0].split(',')[0] : list[0].split(/\s+/)[0]).trim() : 'Unknown';
  return `${first}${list.length > 1 ? ' et al.' : ''}${year ? `, ${year}` : ''}`;
}

export interface StudyRow { seq: number; title: string | null; authors: string | null; year: number | null; journal: string | null; doi: string | null }

/** Characteristics of included studies, one row per study, from the final extractions. */
export function characteristicsCsv(form: ExtractionForm, rows: { study: StudyRow; data: ExtractionData | null }[]): string {
  return '﻿' + Papa.unparse([
    ['ID', 'Study', 'Title', 'Journal', 'DOI', ...form.fields.map((x) => x.label)],
    ...rows.map(({ study: s, data }) => [
      `#${s.seq}`, studyLabel(s.authors, s.year), s.title ?? '', s.journal ?? '', s.doi ?? '',
      ...form.fields.map((x) => (data ? display(data[x.key]) : '')),
    ]),
  ]);
}

/**
 * The characteristics table turned on its side, as in the PDF report: one row
 * per field, one column per study. Easier to read and print; the one-row-per-
 * study layout above is the one to use for analysis.
 */
export function characteristicsByFieldCsv(form: ExtractionForm, rows: { study: StudyRow; data: ExtractionData | null }[]): string {
  return '\ufeff' + Papa.unparse([
    ['Field', ...rows.map(({ study: s }) => `${studyLabel(s.authors, s.year)} (#${s.seq})`)],
    ['Title', ...rows.map(({ study: s }) => s.title ?? '')],
    ['Journal', ...rows.map(({ study: s }) => s.journal ?? '')],
    ['DOI', ...rows.map(({ study: s }) => s.doi ?? '')],
    ...form.fields.map((x) => [x.label, ...rows.map(({ data }) => (data ? display(data[x.key]) : ''))]),
  ]);
}

/** Every reviewer's extraction, for the audit trail / appendix. */
export function allExtractionsCsv(form: ExtractionForm, rows: { seq: number; reviewer: string; status: string; data: ExtractionData }[]): string {
  return '﻿' + Papa.unparse([
    ['ID', 'Reviewer', 'Status', ...form.fields.map((x) => x.label)],
    ...rows.map((r) => [`#${r.seq}`, r.reviewer, r.status, ...form.fields.map((x) => display(r.data[x.key]))]),
  ]);
}

/** Counts of a one-choice field's agreed values, in the form's option order. */
export function optionCounts(form: ExtractionForm | null, key: string, values: (string | null)[], noneLabel: string, suffix = ''): { name: string; n: number }[] | null {
  const field = form?.fields.find((x) => x.key === key);
  if (!field || !values.length) return null;
  const opts = field.options ?? [];
  const out = opts.map((o) => ({ name: `${o}${suffix}`, n: values.filter((t) => t === o).length }));
  const other = values.filter((t) => t && !opts.includes(t)).length;
  if (other) out.push({ name: 'Other', n: other });
  const none = values.filter((t) => !t).length;
  if (none) out.push({ name: noneLabel, n: none });
  return out;
}

/** Tier counts for the PRISMA "included" box, in the form's option order. */
export function tierCounts(form: ExtractionForm | null, finals: (string | null)[]): { name: string; n: number }[] | null {
  const tier = form?.fields.find((x) => x.key === TIER_KEY);
  if (!tier || !finals.length) return null;
  const opts = tier.options ?? [];
  const out = opts.map((o) => ({ name: o, n: finals.filter((t) => t === o).length }));
  const other = finals.filter((t) => t && !opts.includes(t)).length;
  if (other) out.push({ name: 'Other tier', n: other });
  const none = finals.filter((t) => !t).length;
  if (none) out.push({ name: 'Tier not yet assigned', n: none });
  return out;
}
