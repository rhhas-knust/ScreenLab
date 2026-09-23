import { describe, expect, it } from 'vitest';
import { activePico, matchTerms, parseTerms, picoCheck, suggestTerms, termsFromSettings } from '../../src/lib/criteria';

describe('criteria keywords', () => {
  it('parses terms from a textarea', () => {
    expect(parseTerms('Machine learning\ndeep learning, hospital;  "ICU" \n\nx')).toEqual(['machine learning', 'deep learning', 'hospital', 'icu']);
  });
  it('matches whole words, phrases across hyphens, and wildcards', () => {
    const text = 'A deep-learning model for children in a hospital setting (editorial).';
    expect(matchTerms(text, ['deep learning', 'child*', 'hospital', 'editor', 'editorial', 'icu'])).toEqual(['deep learning', 'child*', 'hospital', 'editorial']);
    expect(matchTerms(null, ['x'])).toEqual([]);
  });
  it('suggests editable terms from written criteria', () => {
    const s = suggestTerms('• Primary studies developing a machine-learning model\n• Hospital-acquired infections\n• Published 2015 or later\n- Editorials, conference abstracts');
    expect(s).toEqual(expect.arrayContaining(['primary', 'machine-learning model', 'hospital-acquired infections', 'editorials', 'conference abstracts']));
    expect(s).not.toContain('studies');
  });
  it('reads terms from project settings safely', () => {
    const none = { P: [], I: [], C: [], O: [], S: [] };
    expect(termsFromSettings({ criteria_terms: { include: ['a'], exclude: 'bad' } })).toEqual({ include: ['a'], exclude: [], pico: none });
    expect(termsFromSettings(null)).toEqual({ include: [], exclude: [], pico: none });
    expect(termsFromSettings({ criteria_terms: { pico: { P: ['adult*', 3], O: 'x' } } }).pico).toEqual({ ...none, P: ['adult*'] });
  });
});

describe('PICO check', () => {
  const terms = termsFromSettings({ criteria_terms: { pico: { P: ['adult*', 'intensive care'], I: ['machine learning'], C: [], O: ['mortality'], S: ['cohort'] } } });
  it('ignores elements without keywords', () => {
    expect(activePico(terms)).toEqual(['P', 'I', 'O', 'S']);
  });
  it('reports which elements are found in the text', () => {
    const r = picoCheck('Machine-learning prediction of mortality in adults admitted to intensive care: a review', terms);
    expect(r.map((x) => [x.key, x.found])).toEqual([
      ['P', ['adult*', 'intensive care']], ['I', ['machine learning']], ['O', ['mortality']], ['S', []],
    ]);
    expect(r[0].label).toBe('Population');
  });
  it('returns nothing when no PICO keywords are set', () => {
    expect(picoCheck('anything', termsFromSettings({}))).toEqual([]);
  });
});
