import { describe, expect, it } from 'vitest';
import { parseSearch } from '../../src/lib/api/references';

describe('search syntax', () => {
  it('plain words are ANDed across all fields', () => {
    expect(parseSearch('Machine  learning')).toEqual([
      { neg: false, alts: [{ col: 'search_text', term: 'machine' }] },
      { neg: false, alts: [{ col: 'search_text', term: 'learning' }] },
    ]);
  });
  it('phrases, OR, NOT, minus and fields', () => {
    expect(parseSearch('"deep learning" OR cnn NOT review -protocol title:sepsis author:"van der Berg" year:2020')).toEqual([
      { neg: false, alts: [{ col: 'search_text', term: 'deep learning' }, { col: 'search_text', term: 'cnn' }] },
      { neg: true, alts: [{ col: 'search_text', term: 'review' }] },
      { neg: true, alts: [{ col: 'search_text', term: 'protocol' }] },
      { neg: false, alts: [{ col: 'title', term: 'sepsis' }] },
      { neg: false, alts: [{ col: 'authors', term: 'van der berg' }] },
      { neg: false, alts: [{ col: 'search_text', term: 'year:2020' }] },
    ]);
  });
  it('lower-case "or" is a word, and a leading OR is ignored', () => {
    expect(parseSearch('OR fish or chips').map((c) => c.alts.map((a) => a.term))).toEqual([['fish'], ['or'], ['chips']]);
  });
});
