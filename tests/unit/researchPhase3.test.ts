import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/lib/research/studio';
import { fitModel, invert, normalTwoSidedP, type Fit } from '../../src/lib/research/regression';
import { computeWeights, sampleShares } from '../../src/lib/research/weights';
import { qualityFlags } from '../../src/lib/research/quality';
import { fieldStats } from '../../src/lib/research/analytics';
import type { RhField, RhResponse } from '../../src/lib/api/research';

const f = (id: string, type: RhField['type'], options: string[] = [], settings: RhField['settings'] = {}): RhField =>
  ({ id, project_id: 'p', label: id, help: null, type, options, required: false, field_order: 0, settings });

// A deterministic sample; the reference numbers below come from R 4.x lm()/glm() on the same data.
const fields = [f('hrs', 'number'), f('lvl', 'radio', ['100', '200', '300']), f('mode', 'checkbox', ['Bus', 'Walk']), f('sat', 'scale', [], { min: 1, max: 5 }), f('yes', 'radio', ['No', 'Yes'])];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rs: RhResponse[] = Array.from({ length: 80 }, (_, i) => {
  const hrs = Math.round(2 + rnd() * 20), lvl = ['100', '200', '300'][Math.floor(rnd() * 3)];
  const mode = [rnd() < 0.5 ? 'Bus' : null, rnd() < 0.4 ? 'Walk' : null].filter(Boolean) as string[];
  const sat = Math.max(1, Math.min(5, Math.round(1 + hrs / 6 + (lvl === '300' ? 1 : 0) + (rnd() - 0.5) * 2)));
  const yes = rnd() < 1 / (1 + Math.exp(-(-2 + hrs * 0.15 + (lvl === '200' ? 0.8 : 0)))) ? 'Yes' : 'No';
  return { id: `r${i}`, project_id: 'p', submitted_at: '2026-10-01T00:00:00Z', answers: { ...(i === 3 ? {} : { hrs }), lvl, ...(i % 9 ? { mode } : {}), sat, yes } };
});
const W = computeWeights(fields, rs, [{ field: 'lvl', targets: { '100': 50, '200': 30, '300': 20 } }, { field: 'yes', targets: { No: 40, Yes: 60 } }]);
const ds = buildDataset(fields, rs, W.weights);
const est = (fit: Fit | string) => (typeof fit === 'string' ? fit : fit.terms.map((t) => Math.round(t.estimate * 1e4) / 1e4));
const ses = (fit: Fit | string) => (typeof fit === 'string' ? fit : fit.terms.map((t) => Math.round(t.se * 1e4) / 1e4));

describe('weighting (raking)', () => {
  it('hits every target and reports the design effect', () => {
    expect(W.errors).toEqual([]);
    expect(W.converged).toBe(true);
    expect(W.achieved).toEqual([{ field: 'lvl', shares: { '100': 50, '200': 30, '300': 20 } }, { field: 'yes', shares: { No: 40, Yes: 60 } }]);
    expect([...W.weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(80, 6);
    expect(W.deff).toBeGreaterThan(1);
    expect(W.neff).toBeLessThan(80);
  });
  it('explains targets it cannot meet', () => {
    const bad = computeWeights(fields, rs.filter((r) => r.answers.lvl !== '300'), [{ field: 'lvl', targets: { '100': 40, '200': 40, '300': 20 } }]);
    expect(bad.errors[0]).toMatch(/nobody answered “300”/);
    expect(computeWeights(fields, rs, [{ field: 'lvl', targets: { '100': 1, '200': 1, '300': 2 } }]).warnings[0]).toMatch(/add up to 4/);
  });
  it('weights change percentages and means in the summary', () => {
    const plain = fieldStats(fields[4], rs), weighted = fieldStats(fields[4], rs, W.weights);
    expect(plain.kind === 'choice' && plain.bars.map((b) => b.pct)).toEqual(Object.values(sampleShares(fields[4], rs)));
    expect(weighted.kind === 'choice' && weighted.bars.map((b) => b.pct)).toEqual([40, 60]);
    expect(weighted.kind === 'choice' && weighted.bars.map((b) => b.count)).toEqual(plain.kind === 'choice' ? plain.bars.map((b) => b.count) : []);
  });
});

describe('regression matches R', () => {
  it('linear: lm(sat ~ hrs + lvl + bus + walk)', () => {
    const fit = fitModel(ds, { outcome: 'Q4', predictors: ['Q1', 'Q2', 'Q3'] });
    expect(est(fit)).toEqual([1.3958, 0.1515, 0.099, 0.8807, -0.2403, -0.0741]);
    expect(ses(fit)).toEqual([0.2179, 0.0126, 0.1843, 0.1753, 0.1613, 0.1645]);
    expect(typeof fit !== 'string' && fit.kind === 'linear' && fit.r2).toBeCloseTo(0.7083418, 6);
  });
  it('weighted linear: lm(..., weights = w)', () => {
    const fit = fitModel(ds, { outcome: 'Q4', predictors: ['Q1', 'Q2', 'Q3'], weighted: true });
    expect(est(fit)).toEqual([1.3802, 0.1538, 0.0561, 0.8804, -0.255, -0.0924]);
    expect(ses(fit)).toEqual([0.224, 0.0132, 0.185, 0.2073, 0.1678, 0.1787]);
    expect(typeof fit !== 'string' && fit.kind === 'linear' && fit.r2).toBeCloseTo(0.6877272, 6);
  });
  it('logistic: glm(yes ~ hrs + lvl, binomial)', () => {
    const fit = fitModel(ds, { outcome: 'Q5', predictors: ['Q1', 'Q2'] });
    expect(est(fit)).toEqual([-2.1814, 0.1424, 1.0853, -0.0745]);
    expect(ses(fit)).toEqual([0.7485, 0.0469, 0.6324, 0.5919]);
    expect(typeof fit !== 'string' && fit.kind === 'logistic' && [fit.deviance, fit.nullDeviance]).toEqual([expect.closeTo(92.73696, 4), expect.closeTo(109.2006, 3)]);
  });
  it('weighted logistic estimates match glm(..., weights = w)', () => {
    expect(est(fitModel(ds, { outcome: 'Q5', predictors: ['Q1', 'Q2'], weighted: true }))).toEqual([-1.6204, 0.1369, 1.0949, -0.0822]);
  });
  it('explains models that cannot be fitted', () => {
    expect(fitModel(ds, { outcome: 'Q4', predictors: [] })).toMatch(/at least one predictor/);
    expect(fitModel(ds, { outcome: 'Q4', predictors: ['Q4'] })).toMatch(/cannot also be a predictor/);
    expect(fitModel(ds, { outcome: 'Q2', predictors: ['Q1'], kind: 'logistic' })).toMatch(/counts as the event/);
    const twin = buildDataset([...fields, f('hrs2', 'calc', [], { formula: '' })], rs.map((r) => ({ ...r, answers: { ...r.answers, hrs2: r.answers.hrs } })));
    expect(fitModel(twin, { outcome: 'Q4', predictors: ['Q1', 'Q6'] })).toMatch(/same information/);
  });
  it('says so when the answers separate the groups or the fit is exact', () => {
    const qf = [f('a', 'radio', ['100', '200']), f('b', 'scale'), f('c', 'number')];
    const x = [4, 2, 5, 3, 3, 1, 4, 5], y = [1, 0, 1, 0, 1, 0, 1, 1];
    const sep = buildDataset(qf, x.map((v, i) => ({ id: `s${i}`, project_id: 'p', submitted_at: '', answers: { a: y[i] ? '200' : '100', b: v, c: v * 2 + 1 } })));
    expect(fitModel(sep, { outcome: 'Q1', predictors: ['Q2'] })).toMatch(/separate the groups completely/);
    expect(fitModel(sep, { outcome: 'Q3', predictors: ['Q2'] })).toMatch(/explain Q3 exactly/);
  });
  it('helpers', () => {
    expect(invert([[4, 7], [2, 6]])!.flat().map((x) => Math.round(x * 1000) / 1000)).toEqual([0.6, -0.7, -0.2, 0.4]);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
    expect(normalTwoSidedP(1.959964)).toBeCloseTo(0.05, 5);
  });
});

describe('data quality', () => {
  const qf = [f('a', 'radio', ['x', 'y']), f('b', 'number'), f('c', 'text'), f('g', 'grid', ['Agree', 'Disagree'], { rows: ['r1', 'r2', 'r3'] }), f('e', 'email')];
  const r = (i: number, answers: RhResponse['answers'], duration_s: number | null = 300): RhResponse => ({ id: `q${i}`, project_id: 'p', submitted_at: '2026-10-01T00:00:00Z', answers, duration_s });
  const all = [
    r(1, { a: 'x', b: 1, c: 'hi', g: { r1: 'Agree', r2: 'Disagree', r3: 'Agree' }, e: 'a@b.co' }),
    r(2, { a: 'y', b: 2, c: 'yo', g: { r1: 'Agree', r2: 'Agree', r3: 'Agree' } }, 280),
    r(3, { a: 'x', b: 1, c: 'HI ', g: { r1: 'Agree', r2: 'Disagree', r3: 'Agree' }, e: 'a@b.co' }, 320),
    r(4, { a: 'y' }, 40),
    r(5, { a: 'x', b: 9, c: 'other', e: 'A@B.CO' }, null),
  ];
  const flags = qualityFlags(qf, all);
  const kinds = (id: string) => (flags.get(id) ?? []).map((x) => x.kind).sort();
  it('finds rushed, straight-lined, duplicate and mostly blank responses', () => {
    expect(kinds('q1')).toEqual([]);
    expect(kinds('q2')).toEqual(['straightline']);
    expect(flags.get('q3')![0].detail).toBe('Exactly the same answers as response #1.');
    expect(kinds('q4')).toEqual(['incomplete', 'speeder']);
    expect(flags.get('q4')!.find((x) => x.kind === 'speeder')!.detail).toBe('Took 40 s; the typical time is 4 min 50 s.');
    expect(flags.get('q5')![0].detail).toBe('Same email address as response #1.');
  });
  it('thresholds can be changed', () => {
    expect(kinds.call(null, 'q4')).toContain('speeder');
    expect((qualityFlags(qf, all, { speederRatio: 0.1 }).get('q4') ?? []).map((x) => x.kind)).not.toContain('speeder');
  });
});
