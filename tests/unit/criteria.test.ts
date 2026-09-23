import { describe, expect, it } from 'vitest';
import { matchTerms, parseTerms, suggestTerms, termsFromSettings } from '../../src/lib/criteria';

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
    expect(termsFromSettings({ criteria_terms: { include: ['a'], exclude: 'bad' } })).toEqual({ include: ['a'], exclude: [] });
    expect(termsFromSettings(null)).toEqual({ include: [], exclude: [] });
  });
});
