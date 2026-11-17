import { describe, expect, it } from 'vitest';
import { matchPdf, type PdfPoolRef } from '../../src/lib/import/pdfMatch';

const pool: PdfPoolRef[] = [
  { id: 'a', seq: 3, title: 'Racial bias in triage advice from large language models', authors: 'Doe, Jane; Roe, R.', year: 2021, doi: '10.1001/jama.2021.1234', pmid: '33445566' },
  { id: 'b', seq: 7, title: 'Language and culture in chatbot answers to patients', authors: 'Mensah K; Owusu A', year: 2023, doi: null, pmid: null },
  { id: 'c', seq: 9, title: 'Soil nitrogen and wheat yield', authors: 'Smith, A', year: 2020, doi: '10.9999/zzz', pmid: null },
];

describe('matching PDFs to papers by file name', () => {
  it('DOI in several spellings', () => {
    expect(matchPdf('10.1001_jama.2021.1234.pdf', pool)).toEqual({ refId: 'a', how: 'DOI' });
    expect(matchPdf('10.1001%2Fjama.2021.1234.pdf', pool).refId).toBe('a');
    expect(matchPdf('folder/doi 10.9999-zzz.pdf', pool).refId).toBe('c');
  });
  it('PubMed ID and ScreenLab ID', () => {
    expect(matchPdf('PMID_33445566.pdf', pool)).toEqual({ refId: 'a', how: 'PubMed ID' });
    expect(matchPdf('33445566.pdf', pool).refId).toBe('a');
    expect(matchPdf('#7 notes.pdf', pool)).toEqual({ refId: 'b', how: 'ScreenLab ID' });
  });
  it('title (often cut short) and Zotero-style author – year – title names', () => {
    expect(matchPdf('Language and culture in chatbot answers.pdf', pool)).toEqual({ refId: 'b', how: 'title' });
    expect(matchPdf('Mensah et al. - 2023 - Something else.pdf', pool)).toEqual({ refId: 'b', how: 'first author and year' });
    expect(matchPdf('Doe 2021.pdf', pool).refId).toBe('a');
  });
  it('says when nothing matches', () => {
    expect(matchPdf('scan0001.pdf', pool)).toEqual({ refId: null, how: 'No matching paper found' });
  });
});
