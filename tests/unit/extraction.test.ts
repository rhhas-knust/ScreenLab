import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import {
  agreement, characteristicsCsv, cohensKappa, mergeForFinal, newKey, PRESETS, readForm, sameValue, studyLabel, tierCounts,
  type ExtractionForm,
} from '../../src/lib/extraction/form';

const form: ExtractionForm = {
  fields: [
    { key: 'tier', label: 'Tier', type: 'choice', options: ['Tier 1', 'Tier 2'] },
    { key: 'factors', label: 'Factors', type: 'multi', options: ['Race', 'Language'] },
    { key: 'n', label: 'Sample size', type: 'number' },
    { key: 'findings', label: 'Findings', type: 'long' },
  ],
};

describe('extraction form', () => {
  it('compares answers the way reviewers would', () => {
    expect(sameValue(' GPT-4o  ', 'gpt-4o', 'text')).toBe(true);
    expect(sameValue(['Language', 'Race'], ['Race', 'Language'], 'multi')).toBe(true);
    expect(sameValue('120', '120.0', 'number')).toBe(true);
    expect(sameValue('Tier 1', 'Tier 2', 'choice')).toBe(false);
    expect(sameValue(undefined, '', 'text')).toBe(true);
  });

  it('fills agreed values into the final version and lists conflicts', () => {
    const r = mergeForFinal(form, { tier: 'Tier 1', factors: ['Race'], n: '50', findings: 'Bias found' }, { tier: 'Tier 2', factors: ['Race'], n: '50', findings: 'bias found' });
    expect(r.conflicts).toEqual(['tier']);
    expect(r.data).toEqual({ factors: ['Race'], n: '50', findings: 'Bias found' });
    expect(mergeForFinal(form, { tier: 'Tier 1' }, null)).toEqual({ data: { tier: 'Tier 1' }, conflicts: [] });
  });

  it('computes agreement per field and Cohen’s kappa', () => {
    expect(cohensKappa([['a', 'a'], ['b', 'b'], ['a', 'b'], ['b', 'b']])).toBeCloseTo(0.5, 5);
    expect(cohensKappa([['a', 'a'], ['a', 'a']])).toBeNull();
    const ag = agreement(form, [
      [{ tier: 'Tier 1', n: '10' }, { tier: 'Tier 1', n: '12' }],
      [{ tier: 'Tier 2' }, { tier: 'Tier 2' }],
      [{ tier: 'Tier 1' }, { tier: 'Tier 2' }],
    ]);
    const tier = ag.fields.find((x) => x.key === 'tier')!;
    expect([tier.compared, tier.agreed]).toEqual([3, 2]);
    expect(tier.kappa).toBeCloseTo(0.4, 5);
    expect(ag.fields.find((x) => x.key === 'n')).toMatchObject({ compared: 1, agreed: 0, kappa: null });
    expect(ag.fields.find((x) => x.key === 'findings')!.compared).toBe(0);
    expect([ag.studies, ag.cells, ag.agreedCells]).toEqual([3, 4, 2]);
  });

  it('counts tiers for the PRISMA box, including studies without one', () => {
    expect(tierCounts(form, ['Tier 1', 'Tier 2', 'Tier 1', null])).toEqual([
      { name: 'Tier 1', n: 2 }, { name: 'Tier 2', n: 1 }, { name: 'Tier not yet assigned', n: 1 },
    ]);
    expect(tierCounts({ fields: form.fields.slice(1) }, ['Tier 1'])).toBeNull();
    expect(tierCounts(null, [])).toBeNull();
  });

  it('builds the characteristics table from final extractions', () => {
    const csv = characteristicsCsv(form, [
      { study: { seq: 80, title: 'Disparities', authors: 'Smith, J.; Doe, A.', year: 2024, journal: 'JAMIA', doi: '10.1/x' }, data: { tier: 'Tier 2', factors: ['Race', 'Language'] } },
      { study: { seq: 9, title: 'Other', authors: 'Lee K', year: 2025, journal: null, doi: null }, data: null },
    ]);
    const rows = Papa.parse<string[]>(csv.replace(/^﻿/, '')).data;
    expect(rows[0]).toEqual(['ID', 'Study', 'Title', 'Journal', 'DOI', 'Tier', 'Factors', 'Sample size', 'Findings']);
    expect(rows[1].slice(0, 7)).toEqual(['#80', 'Smith et al., 2024', 'Disparities', 'JAMIA', '10.1/x', 'Tier 2', 'Race; Language']);
    expect(rows[2][1]).toBe('Lee, 2025');
  });

  it('reads a stored form safely and makes unique keys', () => {
    const f = readForm({ settings: { extraction_form: { fields: [{ key: 'a', label: 'A', type: 'weird' }, { key: 'a', label: 'dup' }, { label: 'no key' }, { key: 'c', label: 'C', type: 'choice', options: ['x', 3, ''] }] } } });
    expect(f).toEqual({ fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'c', label: 'C', type: 'choice', options: ['x'] }] });
    expect(readForm({ settings: {} })).toBeNull();
    expect(newKey('Key findings', ['key_findings'])).toBe('key_findings_2');
    expect(studyLabel(null, null)).toBe('Unknown');
  });

  it('ships presets with unique keys, and the LLM preset has the Tier field first', () => {
    for (const p of PRESETS) expect(new Set(p.form.fields.map((x) => x.key)).size).toBe(p.form.fields.length);
    expect(PRESETS[0].form.fields[0]).toMatchObject({ key: 'tier', options: ['Tier 1', 'Tier 2'] });
  });
});
