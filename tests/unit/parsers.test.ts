import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectFormat, latexToText, parseBibtex, parseCsv, parseMedline, parseRis } from '../../src/lib/import/parsers';
import { findWithinFileDuplicates } from '../../src/lib/import/dedupe';
import { isValidDoi, normDoi, normTitle, parseYear } from '../../src/lib/normalize';

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('normalisation', () => {
  it('normalises titles and DOIs', () => {
    expect(normTitle('Deep-Learning: A Study!')).toBe('deep learning a study');
    expect(normDoi('https://doi.org/10.5555/ABC')).toBe('10.5555/abc');
    expect(normDoi('doi: 10.5555/x')).toBe('10.5555/x');
    expect(isValidDoi('10.5555/abc')).toBe(true);
    expect(isValidDoi('not a doi')).toBe(false);
    expect(parseYear('2021 Mar 3')).toBe(2021);
    expect(parseYear('in press')).toBeNull();
  });
});

describe('CSV', () => {
  it('maps common header variants', () => {
    const r = parseCsv(fx('sample.csv'));
    expect(r.records).toHaveLength(4);
    const a = r.records[0];
    expect(a.title).toBe('Fictional trial of widget therapy in imaginary patients');
    expect(a.authors).toBe('Doe, A.; Roe, B.');
    expect(a.year).toBe(2021);
    expect(a.journal).toBe('Journal of Invented Results');
    expect(a.doi).toBe('10.5555/demo.1');
    expect(a.pmid).toBe('90000001');
    expect(a.database_source).toBe('Scopus');
    expect(a.pages).toBe('10-20');
    expect(r.records[2].title).toBeNull(); // missing title is kept, not dropped
    expect(r.fieldsDetected).toContain('abstract');
  });
  it('accepts "Article Title" / "Publication Year" / TSV', () => {
    const r = parseCsv('Article Title\tPublication Year\tAU\tAF\tDI\nA made-up paper\t2019\tSmith J\tSmith, John\t10.5555/x\n');
    expect(r.records[0].title).toBe('A made-up paper');
    expect(r.records[0].year).toBe(2019);
    expect(r.records[0].authors).toBe('Smith J');
    expect(r.records[0].doi).toBe('10.5555/x');
  });
  it('reports a missing title column', () => {
    const r = parseCsv('foo,bar\n1,2\n');
    expect(r.malformed.length).toBeGreaterThan(0);
    expect(r.records).toHaveLength(1);
  });
});

describe('RIS', () => {
  it('parses records, multi-value tags and continuation lines', () => {
    const r = parseRis(fx('sample.ris'));
    expect(r.records).toHaveLength(3);
    const a = r.records[0];
    expect(a.title).toBe('Imaginary sensors for detecting fictional pathogens in a pretend hospital');
    expect(a.authors).toBe('Lovelace, Ada; Babbage, Charles');
    expect(a.keywords).toBe('biosensor; fiction');
    expect(a.publication_type).toBe('Journal Article');
    expect(a.pages).toBe('100-110');
    expect(a.journal).toBe('Pretend Sensors Journal');
    expect(a.abstract).toContain('continues on the next line');
    expect(r.records[2].warnings.join()).toMatch(/ER/);
  });
});

describe('BibTeX', () => {
  it('parses entries with nested braces, quotes and LaTeX', () => {
    const r = parseBibtex(fx('sample.bib'));
    expect(r.records).toHaveLength(3);
    const a = r.records[0];
    expect(a.title).toBe('A {Made-Up} Analysis of Données'.replace(/[{}]/g, ''));
    expect(a.authors).toBe('Müller, Hans; Smith, Jane');
    expect(a.year).toBe(2020);
    expect(a.doi).toBe('10.5555/bib.1');
    expect(a.publication_type).toBe('Journal Article');
    expect(r.records[1].journal).toBe('Proceedings of the Pretend Conference');
    expect(latexToText('Caf\\\'{e} \\& Bar')).toBe('Café & Bar');
  });
  it('reports unbalanced braces', () => {
    const r = parseBibtex('@article{x, title={Broken\n');
    expect(r.malformed.length).toBe(1);
  });
});

describe('MEDLINE', () => {
  it('parses PubMed format', () => {
    const r = parseMedline(fx('sample.nbib'));
    expect(r.records).toHaveLength(2);
    expect(r.records[0].pmid).toBe('90000011');
    expect(r.records[0].doi).toBe('10.5555/med.1');
    expect(r.records[0].authors).toBe('Example, Alice; Sample, Bob');
    expect(r.records[0].database_source).toBe('PubMed');
    expect(r.records[0].abstract).toContain('wrapped');
  });
});

describe('format detection', () => {
  it('detects by extension and content', () => {
    expect(detectFormat('a.ris', '')).toBe('ris');
    expect(detectFormat('a.txt', 'TY  - JOUR\nER  -')).toBe('ris');
    expect(detectFormat('a.txt', 'PMID- 1\nTI  - x')).toBe('medline');
    expect(detectFormat('a.txt', '@article{a, title={x}}')).toBe('bibtex');
    expect(detectFormat('a.pdf', '%PDF-1.4 binary')).toBeNull();
  });
});

describe('within-file duplicates', () => {
  it('groups by DOI, PMID and title+year', () => {
    const g = findWithinFileDuplicates([
      { doi: '10.5555/a', pmid: null, title: 'First fictional paper title', year: 2020 },
      { doi: 'https://doi.org/10.5555/A', pmid: null, title: 'different', year: 2020 },
      { doi: null, pmid: '5', title: 'Second fictional paper title', year: 2021 },
      { doi: null, pmid: '5', title: 'x', year: 2021 },
      { doi: null, pmid: null, title: 'Third Fictional paper title!', year: 2019 },
      { doi: null, pmid: null, title: 'third fictional paper title', year: 2019 },
      { doi: null, pmid: null, title: 'third fictional paper title', year: 2018 },
    ]);
    expect(g.map((x) => x.sort()).sort()).toEqual([[0, 1], [2, 3], [4, 5]]);
  });
});
