import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { anova1, pearson, quantile, tCrit95, welchT } from '../../src/lib/research/stats';
import { buildChart, buildDataset } from '../../src/lib/research/studio';
import { parseCommand, runCommand } from '../../src/lib/research/commands';
import { columns, dataCsv, exportPack, script } from '../../src/lib/research/exportPack';
import type { RhField, RhResponse } from '../../src/lib/api/research';

// Reference values from SciPy (scipy.stats.ttest_ind(equal_var=False), pearsonr, f_oneway, t.ppf).
describe('statistical tests match SciPy / R', () => {
  it('Welch t-test', () => {
    const t = welchT([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], ['a', 'b'])!;
    expect(t.t).toBeCloseTo(-1.897, 3);
    expect(t.df).toBeCloseTo(5.88, 2);
    expect(t.p).toBeCloseTo(0.10753, 4);
  });
  it('Pearson correlation', () => {
    const c = pearson([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 4, 5, 4, 5, 7, 8, 9, 10, 12])!;
    expect(c.r).toBeCloseTo(0.972, 3);
    expect(c.p).toBeCloseTo(2.634e-6, 8);
  });
  it('one-way ANOVA', () => {
    const a = anova1([[1, 2, 3, 4], [2, 3, 5, 6], [6, 7, 8, 9]])!;
    expect(a.f).toBeCloseTo(11.85, 2);
    expect(a.p).toBeCloseTo(0.00301, 5);
    expect([a.df1, a.df2]).toEqual([2, 9]);
  });
  it('t critical values and quartiles', () => {
    expect(tCrit95(4)).toBeCloseTo(2.7764, 3);
    expect(tCrit95(29)).toBeCloseTo(2.0452, 3);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
});

const f = (id: string, type: RhField['type'], options: string[] = [], settings: RhField['settings'] = {}): RhField =>
  ({ id, project_id: 'p', label: `Question ${id}`, help: null, type, options, required: false, field_order: 0, settings });
const fields = [f('lvl', 'radio', ['100', '200']), f('hrs', 'number'), f('mode', 'checkbox', ['Bus', 'Walk']), f('sat', 'scale', [], { min: 1, max: 5 }), f('mail', 'email')];
const rs: RhResponse[] = [
  [{ lvl: '100', hrs: 2, mode: ['Bus'], sat: 4, mail: 'a@b.c' }, '2026-10-01'],
  [{ lvl: '100', hrs: '4', mode: ['Bus', 'Walk'], sat: 5 }, '2026-10-01'],
  [{ lvl: '200', hrs: 10, mode: ['Walk'], sat: 2 }, '2026-10-02'],
  [{ lvl: '200', hrs: 12, sat: 1 }, '2026-10-03'],
  [{ lvl: '200', mode: ['Bus'] }, '2026-10-03'],
].map(([answers, day], i) => ({ id: `r${i}`, project_id: 'p', answers: answers as RhResponse['answers'], submitted_at: `${day}T10:00:00Z` }));
const ds = buildDataset(fields, rs);

describe('Chart Studio dataset and charts', () => {
  it('names variables Q1, Q2 … and adds the submission date', () => {
    expect(ds.vars.map((v) => `${v.name}:${v.kind}`)).toEqual(['Q1:categorical', 'Q2:numeric', 'Q3:multi', 'Q4:numeric', 'Q5:text', 'Submitted:date']);
    expect(ds.vars[1].values).toEqual([2, 4, 10, 12, null]);
  });
  it('bar chart counts, with percentages of those who answered', () => {
    const c = buildChart({ type: 'bar', x: 'Q3', percent: true }, ds);
    expect(c.model.kind === 'bars' && c.model.series[0].values).toEqual([75, 50]);
  });
  it('grouped bars run a chi-square test', () => {
    const c = buildChart({ type: 'bar', x: 'Q4', group: 'Q1' }, ds);
    expect(c.model.kind === 'bars' && c.model.series.map((s) => s.values)).toEqual([[0, 0, 0, 1, 1], [1, 1, 0, 0, 0]]);
    expect(c.stats[0]).toMatch(/Chi-square/);
  });
  it('box plot by group runs a Welch t-test for two groups', () => {
    const c = buildChart({ type: 'box', x: 'Q1', y: 'Q2' }, ds);
    expect(c.model.kind).toBe('box');
    expect(c.stats[0]).toMatch(/Welch two-sample t-test: t = -/);
  });
  it('scatter reports Pearson r and a trend line', () => {
    const c = buildChart({ type: 'scatter', x: 'Q2', y: 'Q4' }, ds);
    expect(c.model.kind === 'scatter' && c.model.points).toHaveLength(4);
    expect(c.stats[0]).toMatch(/Pearson correlation: r = -0\.9/);
  });
  it('explains why a chart cannot be drawn', () => {
    expect(buildChart({ type: 'pie', x: 'Q3' }, ds).model.kind).toBe('empty');
    expect(buildChart({ type: 'histogram', x: 'Q1' }, ds).model.kind).toBe('empty');
  });
});

describe('command window', () => {
  const spec = { type: 'bar' as const, x: 'Q1' };
  it('parses MATLAB call and command syntax', () => {
    expect(parseCommand("bar(Q1, Q3, 'stacked');")).toEqual({ fn: 'bar', args: [{ kind: 'name', v: 'Q1' }, { kind: 'name', v: 'Q3' }, { kind: 'str', v: 'stacked' }] });
    expect(parseCommand('title Hours per week')).toEqual({ fn: 'title', args: [{ kind: 'str', v: 'Hours per week' }] });
    expect(parseCommand("title('It''s mine')")).toEqual({ fn: 'title', args: [{ kind: 'str', v: "It's mine" }] });
    expect(parseCommand('bar(Q1')).toHaveProperty('error');
  });
  it('plots and computes', () => {
    expect(runCommand('histogram(Q2, 4)', ds, spec).spec).toEqual({ type: 'histogram', x: 'Q2', bins: 4 });
    expect(runCommand('boxchart(Q1, Q2)', ds, spec).spec).toEqual({ type: 'box', x: 'Q1', y: 'Q2' });
    expect(runCommand('mean(Q2)', ds, spec).output).toMatch(/^ans = 7 /);
    expect(runCommand('ttest2(Q2, Q1)', ds, spec).output).toMatch(/Welch/);
    expect(runCommand('title("Hours")', ds, spec).spec?.title).toBe('Hours');
    expect(runCommand('tabulate(Q1)', ds, spec).output).toMatch(/200\s+3\s+60\.0%/);
  });
  it('rejects unknown names safely', () => {
    expect(runCommand('bar(Q9)', ds, spec)).toMatchObject({ error: true });
    expect(runCommand('system("rm -rf")', ds, spec)).toMatchObject({ error: true });
  });
});

describe('export pack', () => {
  it('data.csv splits checkboxes into 0/1 columns and can leave out emails', () => {
    const cols = columns(ds);
    expect(dataCsv(ds, cols).split('\r\n')[0]).toBe('Response,Q1,Q2,Q3_1,Q3_2,Q4,Submitted');
    expect(dataCsv(ds, cols).split('\r\n')[1]).toBe('1,100,2,1,0,4,2026-10-01');
    expect(columns(ds, { includeEmail: true }).map((c) => c.name)).toContain('Q5');
  });
  it('MATLAB script reads data.csv and draws the same chart', () => {
    const spec = { type: 'bar' as const, x: 'Q1', group: 'Q3' };
    const m = script('matlab', spec, ds, buildChart(spec, ds));
    expect(m).toMatch(/readtable\("data\.csv", opts\)/);
    expect(m).toMatch(/setvartype\(opts, \["Q1", "Submitted"\], "string"\)/);
    expect(m).toMatch(/gX = T\{:, \["Q3_1", "Q3_2"\]\} == 1/);
    expect(m).toMatch(/bar\(categorical\(xCats, xCats\), values\);/);
  });
  it('zip has data, codebook, chart data, README and four scripts', () => {
    const spec = { type: 'scatter' as const, x: 'Q2', y: 'Q4' };
    const files = unzipSync(exportPack(spec, ds, buildChart(spec, ds), { title: 'Survey' }));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'chart.R', 'chart.do', 'chart.m', 'chart.sps', 'chart_data.csv', 'codebook.csv', 'data.csv']);
    expect(strFromU8(files['chart.R'])).toMatch(/cor\.test\(d\$Q2, d\$Q4\)/);
    expect(strFromU8(files['chart.do'])).toMatch(/lfit Q4 Q2/);
    expect(strFromU8(files['data.csv'])).not.toMatch(/a@b\.c/);
  });
});
