import { describe, expect, it } from 'vitest';
import { buildPayload, conditionMet, conditionProblems, isRealDate, localize, validate, visibleFields } from '../../src/lib/research/logic';
import { applyFilters, chiSquare, chiSquareP, crossTab, crossTabCsv, fieldStats, overview, themeCounts } from '../../src/lib/research/analytics';
import { cleanSettings, responsesToCsv, scaleRange, type PublicForm, type RhField, type RhResponse } from '../../src/lib/api/research';
import { buildUserText } from '../../supabase/functions/rh-summary/prompt';

const field = (id: string, type: RhField['type'], extra: Partial<RhField> = {}): RhField =>
  ({ id, project_id: 'p', label: `Q ${id}`, help: null, type, options: [], required: false, field_order: 0, settings: {}, ...extra });
const resp = (i: number, answers: RhResponse['answers'], extra: Partial<RhResponse> = {}): RhResponse =>
  ({ id: `r${i}`, project_id: 'p', answers, submitted_at: `2026-10-0${(i % 9) + 1}T10:00:00Z`, ...extra });

const smoker = field('smoke', 'radio', { options: ['Yes', 'No'], required: true });
const perDay = field('perday', 'number', { required: true, settings: { show_if: { field: 'smoke', op: 'equals', value: 'Yes' } } });
const brand = field('brand', 'text', { settings: { show_if: { field: 'perday', op: 'answered' } } });
const why = field('why', 'textarea', { settings: { show_if: { field: 'smoke', op: 'not_equals', value: 'Yes' } } });

describe('skip logic', () => {
  it('shows a question only when its condition is met, and chains through hidden questions', () => {
    const fs = [smoker, perDay, brand, why];
    expect(visibleFields(fs, {}).map((f) => f.id)).toEqual(['smoke']);
    expect(visibleFields(fs, { smoke: 'Yes' }).map((f) => f.id)).toEqual(['smoke', 'perday']);
    expect(visibleFields(fs, { smoke: 'Yes', perday: '10' }).map((f) => f.id)).toEqual(['smoke', 'perday', 'brand']);
    // Switching to "No" hides perday, so brand (which depends on perday) hides too, even though perday still has a stale value.
    expect(visibleFields(fs, { smoke: 'No', perday: '10' }).map((f) => f.id)).toEqual(['smoke', 'why']);
  });

  it('drops answers to hidden questions from what is submitted', () => {
    expect(buildPayload([smoker, perDay, brand, why], { smoke: 'No', perday: '10', brand: ' X ', why: ' cost ' })).toEqual({ smoke: 'No', why: 'cost' });
    expect(buildPayload([smoker, perDay, brand], { smoke: 'Yes', perday: ' 12 ', brand: 'B' })).toEqual({ smoke: 'Yes', perday: 12, brand: 'B' });
  });

  it('checkbox conditions match a ticked option', () => {
    expect(conditionMet({ field: 'a', op: 'equals', value: 'R' }, { a: ['Excel', 'R'] })).toBe(true);
    expect(conditionMet({ field: 'a', op: 'not_equals', value: 'R' }, { a: ['Excel'] })).toBe(true);
    expect(conditionMet({ field: 'a', op: 'not_equals', value: 'R' }, {})).toBe(false);
  });

  it('the builder flags conditions on later or deleted questions', () => {
    expect(conditionProblems([smoker, perDay])).toEqual([]);
    expect(conditionProblems([perDay, smoker])[0]).toMatch(/depends on question 2, which comes after it/);
    expect(conditionProblems([perDay])[0]).toMatch(/deleted/);
    expect(conditionProblems([smoker, field('x', 'text', { settings: { show_if: { field: 'smoke', op: 'equals', value: '' } } })])[0]).toMatch(/choose the answer/);
  });
});

describe('validation of the new question types', () => {
  it('scale range and labels', () => {
    expect(scaleRange({}).points).toEqual([1, 2, 3, 4, 5]);
    expect(scaleRange({ min: 0, max: 10 }).points).toHaveLength(11);
    const s = field('s', 'scale', { settings: { min: 0, max: 10 } });
    expect(validate(s, 0)).toBeNull();
    expect(validate(s, 11)).toMatch(/0 to 10/);
    expect(cleanSettings({ type: 'scale', settings: { min: 0, max: 10, min_label: ' Not at all ', rows: ['x'] } })).toEqual({ min: 0, max: 10, min_label: 'Not at all' });
  });

  it('grids need every row when required; dates must be real', () => {
    const g = field('g', 'grid', { options: ['Agree', 'Disagree'], required: true, settings: { rows: ['A', 'B'] } });
    expect(validate(g, { A: 'Agree' })).toMatch(/every row/);
    expect(validate(g, { A: 'Agree', B: 'Disagree' })).toBeNull();
    expect(validate(field('r', 'ranking', { required: true, options: ['x', 'y'] }), undefined)).toMatch(/order/);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(validate(field('d', 'date'), '2026-13-01')).toMatch(/real date/);
  });
});

describe('translations', () => {
  const form: PublicForm = {
    id: 'f', title: 'Survey', description: 'Intro', status: 'active', university: null, department: null, thank_you_message: null,
    consent_text: 'Consent', translations: { base_name: 'English', items: [{ code: 'tw', name: 'Twi', title: 'Nhwehwɛmu', fields: { smoke: { label: 'Wonom sigaret?', options: ['Aane', ''] } } }] },
    fields: [smoker],
  };
  it('shows translated text but keeps the original values; blanks fall back to the original', () => {
    const tw = localize(form, 'tw');
    expect(tw.title).toBe('Nhwehwɛmu');
    expect(tw.description).toBe('Intro');
    expect(tw.consent_text).toBe('Consent');
    expect(tw.fields[0].label).toBe('Wonom sigaret?');
    expect(tw.fields[0].options).toEqual(['Yes', 'No']);
    expect(tw.fields[0].optionLabels).toEqual(['Aane', 'No']);
    expect(localize(form, 'xx').title).toBe('Survey');
  });
});

describe('analysis', () => {
  const sex = field('sex', 'radio', { options: ['F', 'M'] });
  const ok = field('ok', 'radio', { options: ['Yes', 'No'] });
  const tools = field('tools', 'checkbox', { options: ['Excel', 'R'] });
  const rs = [
    ...Array.from({ length: 10 }, (_, i) => resp(i, { sex: 'F', ok: 'Yes', tools: ['R'] })),
    ...Array.from({ length: 20 }, (_, i) => resp(10 + i, { sex: 'F', ok: 'No' })),
    ...Array.from({ length: 30 }, (_, i) => resp(30 + i, { sex: 'M', ok: 'Yes', tools: ['Excel', 'R'] })),
    ...Array.from({ length: 40 }, (_, i) => resp(60 + i, { sex: 'M', ok: 'No' })),
  ];

  it('cross-tab counts and a textbook chi-square', () => {
    const t = crossTab(sex, ok, rs);
    expect(t.counts).toEqual([[10, 20], [30, 40]]);
    expect(t.rowTotals).toEqual([30, 70]);
    expect(t.total).toBe(100);
    expect(t.chi!.chi2).toBeCloseTo(0.794, 3);
    expect(t.chi!.df).toBe(1);
    expect(t.chi!.p).toBeCloseTo(0.373, 3);
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(30, 4)).toBeLessThan(0.001);
    expect(chiSquare([[5, 0], [0, 0]])).toBeNull();
    expect(crossTab(sex, tools, rs).chi).toBeNull();
    expect(crossTabCsv(sex, ok, t)).toMatch(/F,10 \(33\.3%\),20 \(66\.7%\),30/);
  });

  it('filters combine with AND and match ticked checkbox options', () => {
    expect(applyFilters([sex, ok, tools], rs, [{ field: 'sex', value: 'M' }])).toHaveLength(70);
    expect(applyFilters([sex, ok, tools], rs, [{ field: 'sex', value: 'M' }, { field: 'tools', value: 'Excel' }])).toHaveLength(30);
    expect(applyFilters([sex, ok, tools], rs, [{ field: 'sex', value: 'F' }, { field: 'tools', value: 'Excel' }])).toHaveLength(0);
  });

  it('grid, ranking and date statistics', () => {
    const g = field('g', 'grid', { options: ['Agree', 'Disagree'], settings: { rows: ['Fair', 'Fast'] } });
    const rk = field('rk', 'ranking', { options: ['Cost', 'Speed', 'Trust'] });
    const d = field('d', 'date');
    const data = [
      resp(1, { g: { Fair: 'Agree', Fast: 'Agree' }, rk: ['Trust', 'Cost', 'Speed'], d: '2026-01-15' }),
      resp(2, { g: { Fair: 'Disagree' }, rk: ['Trust', 'Speed', 'Cost'], d: '2026-01-20' }),
      resp(3, { rk: ['Cost', 'Trust', 'Speed'], d: '2026-03-02' }),
    ];
    const gs = fieldStats(g, data);
    expect(gs.kind === 'grid' && gs.rows.map((r) => r.cells.map((c) => c.count))).toEqual([[1, 1], [1, 0]]);
    const rks = fieldStats(rk, data);
    expect(rks.kind === 'ranking' && rks.items.map((i) => [i.label, i.meanRank, i.first])).toEqual([['Trust', 1.33, 2], ['Cost', 2, 1], ['Speed', 2.67, 0]]);
    const ds = fieldStats(d, data);
    expect(ds.kind === 'date' && [ds.earliest, ds.latest, ds.bars.map((b) => `${b.label}=${b.count}`)]).toEqual(['2026-01-15', '2026-03-02', ['2026-01=2', '2026-03=1']]);
    const prompt = buildUserText({ title: 'T' }, [g, rk, d], data.map((r) => r.answers));
    expect(prompt).toMatch(/"Fair": "Agree" 1 \(50%\)/);
    expect(prompt).toMatch(/"Trust": mean rank 1\.33/);
  });

  it('theme codes are counted per coded answer and exported', () => {
    const t = field('t', 'text');
    const data = [
      resp(1, { t: 'too costly' }, { codes: { t: ['cost'] } }),
      resp(2, { t: 'slow and costly' }, { codes: { t: ['cost', 'speed'] } }),
      resp(3, { t: 'fine' }),
    ];
    expect(themeCounts('t', data)).toEqual([{ code: 'cost', count: 2, pct: 100 }, { code: 'speed', count: 1, pct: 50 }]);
    const s = fieldStats(t, data);
    expect(s.themes?.[0].code).toBe('cost');
    const csv = responsesToCsv([t], data);
    expect(csv.split('\n')[0]).toContain('Q t — codes');
    expect(csv).toContain('cost; speed');
  });

  it('CSV splits grids and rankings into columns and adds language and consent', () => {
    const g = field('g', 'grid', { label: 'Views', options: ['Agree', 'Disagree'], settings: { rows: ['Fair', 'Fast'] } });
    const rk = field('rk', 'ranking', { label: 'Priorities', options: ['Cost', 'Speed'] });
    const data = [resp(1, { g: { Fair: 'Agree' }, rk: ['Speed', 'Cost'] }, { language: 'tw', consent_at: '2026-10-01T09:00:00Z' }), resp(2, { g: { Fast: 'Disagree' } })];
    const [head, r1, r2] = responsesToCsv([g, rk], data, { base_name: 'English', items: [{ code: 'tw', name: 'Twi', fields: {} }] }).replace('\ufeff', '').split(/\r?\n/);
    expect(head).toBe('Response #,Submitted at,Views — Fair,Views — Fast,Priorities — rank of Cost,Priorities — rank of Speed,Language,Consent given at');
    expect(r1).toMatch(/,Agree,,2,1,Twi,2026-10-01T09:00:00.000Z$/);
    expect(r2).toMatch(/,,Disagree,,,English,$/);
  });

  it('completion only counts the questions a respondent was shown', () => {
    expect(overview([smoker, perDay, why], [resp(1, { smoke: 'Yes', perday: 3 }), resp(2, { smoke: 'No', why: 'x' })]).completion).toBe(100);
  });
});
