import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { crossTab, crossTabCsv, evidenceCsv, fieldsWithRob, groupStudies, NOT_RECORDED, ROB_FIELD, type SynthesisStudy } from '../../src/lib/synthesis/tables';
import { blankRow, calculatedCertainty, certaintyOf, gradeTableRows, readGrade } from '../../src/lib/synthesis/grade';
import { plotColumns, robSummary, robTone, trafficLight } from '../../src/lib/extraction/robPlot';
import { optionCounts, PRESETS, readForm, ROB_PRESETS, type ExtractionForm } from '../../src/lib/extraction/form';
import { methodsDraft, methodsText } from '../../src/lib/methods/methodsDraft';
import { checklistCsv, checklistProgress, PRISMA_2020, readChecklist } from '../../src/lib/methods/prisma2020';
import { buildPilot } from '../../src/lib/extraction/pilot';
import type { Project, ProjectStats } from '../../src/lib/types';

const form: ExtractionForm = {
  fields: [
    { key: 'tier', label: 'Tier', type: 'choice', options: ['Tier 1', 'Tier 2'] },
    { key: 'factors', label: 'Factors', type: 'multi', options: ['Race', 'Language'] },
    { key: 'findings', label: 'Findings', type: 'long' },
  ],
};
const st = (seq: number, data: SynthesisStudy['data'], rob: string | null = null): SynthesisStudy => ({ seq, label: `S${seq}`, title: null, data, rob });
const studies = [
  st(1, { tier: 'Tier 1', factors: ['Race'], findings: 'A' }, 'Low'),
  st(2, { tier: 'Tier 2', factors: ['Race', 'Language'], findings: 'B' }, 'High'),
  st(3, { tier: 'Tier 2', factors: [] }),
];

describe('synthesis tables', () => {
  it('groups studies by a field in option order, with unrecorded values last', () => {
    expect(groupStudies(form.fields[0], studies).map((g) => [g.value, g.studies.map((s) => s.seq)])).toEqual([['Tier 1', [1]], ['Tier 2', [2, 3]]]);
    expect(groupStudies(form.fields[1], studies).map((g) => [g.value, g.studies.map((s) => s.seq)])).toEqual([['Race', [1, 2]], ['Language', [2]], [NOT_RECORDED, [3]]]);
  });

  it('cross-tabulates two fields, counting several-choice answers once each', () => {
    const t = crossTab(form.fields[0], form.fields[1], studies);
    expect(t.rows).toEqual(['Tier 1', 'Tier 2']);
    expect(t.cols).toEqual(['Race', 'Language', NOT_RECORDED]);
    expect(t.counts).toEqual([[1, 0, 0], [1, 1, 1]]);
    expect(t.rowTotals).toEqual([1, 2]);
    expect(t.colTotals).toEqual([2, 1, 1]);
    expect(t.multi).toBe(true);
    const csv = Papa.parse<string[]>(crossTabCsv(form.fields[0], form.fields[1], t).replace(/^﻿/, '')).data;
    expect(csv[3]).toEqual(['Total', '2', '1', '1', '3']);
  });

  it('can group and cross-tabulate by the agreed risk of bias', () => {
    const fields = fieldsWithRob(form, true);
    expect(fields.at(-1)).toBe(ROB_FIELD);
    expect(groupStudies(ROB_FIELD, studies).map((g) => g.value)).toEqual(['Low', 'High', NOT_RECORDED]);
    const csv = Papa.parse<string[]>(evidenceCsv(form.fields[0], [form.fields[1], ROB_FIELD], groupStudies(form.fields[0], studies)).replace(/^﻿/, '')).data;
    expect(csv[0]).toEqual(['Tier', 'ID', 'Study', 'Factors', 'Overall risk of bias']);
    expect(csv[2]).toEqual(['Tier 2', '#2', 'S2', 'Race; Language', 'High']);
  });
});

describe('GRADE', () => {
  it('starts high or low, downgrades per concern and never leaves the scale', () => {
    expect(calculatedCertainty({ ...blankRow('a'), start: 'High' })).toBe('High');
    expect(calculatedCertainty({ ...blankRow('a'), start: 'High', risk_of_bias: 'Serious', imprecision: 'Very serious' })).toBe('Very low');
    expect(calculatedCertainty({ ...blankRow('a'), start: 'Low', publication_bias: 'Strongly suspected', inconsistency: 'Serious' })).toBe('Very low');
    expect(calculatedCertainty({ ...blankRow('a'), start: 'Low', upgrade: 1 })).toBe('Moderate');
    expect(calculatedCertainty({ ...blankRow('a'), start: 'High', upgrade: 2 })).toBe('High');
  });

  it('uses the reviewer override and says so in the table', () => {
    const r = { ...blankRow('a'), outcome: 'Accuracy gap', start: 'High' as const, risk_of_bias: 'Serious', override: 'Low' as const };
    expect(certaintyOf(r)).toBe('Low');
    expect(gradeTableRows([r])[0][9]).toBe('Low (reviewer judgement)');
    expect(readGrade({ settings: { grade: { rows: [{ id: 'x', outcome: 'O', override: 'Nonsense' }, { nope: 1 }] } } })).toEqual([{ ...blankRow('x'), outcome: 'O' }]);
  });
});

describe('risk of bias', () => {
  const rob = ROB_PRESETS[0].form;
  it('ships a JBI-based preset with an overall judgement, read back with its name', () => {
    expect(rob.fields.filter((f) => /^q\d$/.test(f.key))).toHaveLength(9);
    expect(rob.fields.find((f) => f.key === 'overall')?.options).toEqual(['Low', 'Moderate', 'High']);
    expect(readForm({ settings: { rob_form: { ...rob, name: ROB_PRESETS[0].name } } }, 'rob')?.name).toBe(ROB_PRESETS[0].name);
    expect(readForm({ settings: { rob_form: rob } }, 'extraction')).toBeNull();
  });

  it('colours answers and builds the traffic-light grid and summary', () => {
    expect(['Yes', 'No', 'Unclear', 'Not applicable', 'Low', 'Moderate', 'High', ''].map(robTone)).toEqual(['good', 'bad', 'unclear', 'na', 'good', 'some', 'bad', 'blank']);
    const cols = plotColumns(rob);
    expect(cols.map((c) => c.short)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Overall']);
    const tl = trafficLight(rob, [{ label: 'A', data: { q1: 'Yes', overall: 'Low' } }, { label: 'B', data: { q1: 'No', overall: 'High' } }]);
    expect(tl.rows[0].cells[0]).toBe('Yes');
    expect(tl.rows[1].cells.at(-1)).toBe('High');
    const sum = robSummary(rob, tl);
    expect(sum[0].parts).toEqual([{ answer: 'Yes', n: 1, tone: 'good' }, { answer: 'No', n: 1, tone: 'bad' }]);
    expect(sum[1].parts).toEqual([{ answer: 'Not answered', n: 2, tone: 'blank' }]);
    expect(optionCounts(rob, 'overall', ['Low', null, 'High'], 'Not yet agreed', ' risk')).toEqual([
      { name: 'Low risk', n: 1 }, { name: 'Moderate risk', n: 0 }, { name: 'High risk', n: 1 }, { name: 'Not yet agreed', n: 1 }]);
  });
});

describe('methods draft', () => {
  const project = {
    id: 'p', owner_id: 'u', title: 'T', description: null, research_question: null, review_type: 'systematic',
    inclusion_criteria: 'Evaluates an LLM\nMedical context.', exclusion_criteria: 'Opinion piece', population: null, intervention_or_exposure: null,
    comparator: null, outcomes: null, study_design: null, date_range: null, language: null, start_date: null, is_demo: false, created_at: '', updated_at: '',
  } as Project;
  const stats = { ta_screened: 5766, ft_screened: 349, stage2_enabled: true, duplicates_removed: 18 } as ProjectStats;
  const base = {
    project, stats, sources: [{ id: 'a', project_id: 'p', kind: 'database' as const, name: 'PubMed', searched_on: '2026-09-05', search_string: 'x', filters: 'English', results_count: 3, notes: null, sort_order: 0, created_at: '' }],
    duplicatesBeforeImport: 1668, decisions: [], reviewers: 2, screeningMode: 'single' as const, registrationId: '', aiText: 'AI was advisory.',
    extractionForm: PRESETS[0].form, extractionAgreement: { studies: 4, cells: 40, agreedCells: 36 },
    robForm: { ...ROB_PRESETS[0].form, name: ROB_PRESETS[0].name }, robAgreement: null, synthesisPlan: '', gradeOutcomes: 2,
  };

  it('writes each PRISMA 2020 methods section from the project data', () => {
    const s = methodsDraft(base);
    expect(s.map((x) => x.heading)).toEqual(['Protocol and registration', 'Eligibility criteria', 'Information sources and search strategy', 'Selection process',
      'Data collection process', 'Data items', 'Study risk of bias assessment', 'Synthesis methods', 'Certainty assessment']);
    const text = methodsText(s);
    expect(text).toMatch(/PROSPERO \(\[registration number\]\)/);
    expect(text).toMatch(/met all of the following: evaluates an LLM; and medical context\./);
    expect(text).toMatch(/PubMed \(searched 5 Sep 2026\) was searched, limited to English/);
    expect(text).toMatch(/1,668 duplicates removed\) and managed in ScreenLab, where a further 18 duplicates/);
    expect(text).toMatch(/One reviewer screened titles and abstracts \(5,766 records\) and then full texts \(349 reports\)/);
    expect(text).toMatch(/AI was advisory\./);
    expect(text).toMatch(/Two reviewers independently extracted .* agreed on 90% of extraction answers across 4 double-assessed studies/);
    expect(text).toMatch(/the adapted JBI checklist for LLM evaluation studies, comprising 9 items/);
    expect(text).toMatch(/\[Describe how results were combined/);
    expect(text).toMatch(/certainty of evidence for 2 main outcomes was assessed with the GRADE approach/);
  });

  it('leaves clear gaps when there is nothing to report from', () => {
    const text = methodsText(methodsDraft({ ...base, sources: [], extractionForm: null, robForm: null, gradeOutcomes: 0, aiText: null, reviewers: 1, registrationId: 'CRD420261' }));
    expect(text).toMatch(/PROSPERO \(CRD420261\)/);
    expect(text).toMatch(/\[List each database/);
    expect(text).toMatch(/\[Name the risk-of-bias tool/);
    expect(text).toMatch(/\[Describe how certainty/);
    expect(text).not.toMatch(/advisory/);
  });
});

describe('PRISMA 2020 checklist', () => {
  it('has all 42 items of the 27 PRISMA 2020 topics, with unique ids', () => {
    expect(PRISMA_2020).toHaveLength(42);
    expect(new Set(PRISMA_2020.map((i) => i.id)).size).toBe(42);
    expect(new Set(PRISMA_2020.map((i) => i.id.replace(/[a-z]$/, ''))).size).toBe(27);
  });
  it('reads, counts and exports locations', () => {
    const where = readChecklist({ settings: { prisma2020: { '1': 'Title page', '7': 'Supplement 1', bad: 3 } } });
    expect(where).toEqual({ '1': 'Title page', '7': 'Supplement 1' });
    expect(checklistProgress(where)).toBe(2);
    const rows = Papa.parse<string[]>(checklistCsv(where).replace(/^﻿/, '')).data;
    expect(rows[1]).toEqual(['Title', 'Title', '1', 'Identify the report as a systematic review.', 'Title page']);
  });
});

describe('pilot report', () => {
  const pf: ExtractionForm = {
    fields: [
      { key: 'tier', label: 'Tier', type: 'choice', options: ['Tier 1', 'Tier 2'] },
      { key: 'llms', label: 'LLMs tested', type: 'text' },
      { key: 'n', label: 'Sample size', type: 'number' },
    ],
  };
  it('puts each reviewer side by side, marks differences and ranks the hardest fields', () => {
    const p = buildPilot(pf, [
      { seq: 9, label: 'B', title: null, final: null, entries: [{ reviewer: 'me', data: { tier: 'Tier 2', llms: 'GPT-4o', n: '10' } }] },
      { seq: 3, label: 'A', title: null, final: { tier: 'Tier 1', llms: 'GPT-4o' }, entries: [
        { reviewer: 'me', data: { tier: 'Tier 1', llms: 'gpt-4o ', n: '120' } },
        { reviewer: 'nana', data: { tier: 'Tier 2', llms: 'GPT-4o', n: '120.0' } }] },
      { seq: 5, label: 'C', title: null, final: null, entries: [] },
    ]);
    expect(p.studies.map((s) => s.seq)).toEqual([3, 9]);
    expect(p.reviewers).toEqual(['me', 'nana']);
    const a = p.studies[0];
    expect(a.rows.map((r) => [r.key, r.values, r.final, r.differ])).toEqual([
      ['tier', ['Tier 1', 'Tier 2'], 'Tier 1', true],
      ['llms', ['gpt-4o ', 'GPT-4o'], 'GPT-4o', false],
      ['n', ['120', '120.0'], '', false],
    ]);
    expect(a.differences).toBe(1);
    expect(p.studies[1].rows.every((r) => !r.differ)).toBe(true);
    expect([p.agreement.studies, p.agreement.cells, p.agreement.agreedCells]).toEqual([1, 3, 2]);
    expect(p.hardest.map((f) => f.key)).toEqual(['tier']);
  });
});
