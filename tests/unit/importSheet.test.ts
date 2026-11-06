import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  buildRows, convertValue, detectLayout, firstAuthor, guessRole, matchField, matchStudy, newFields, readSheetFile, toTable, type PoolRef,
} from '../../src/lib/extraction/importSheet';
import { PRESETS, ROB_PRESETS, characteristicsByFieldCsv, characteristicsCsv, type ExtractionData, type ExtractionForm, type StudyRow } from '../../src/lib/extraction/form';

const form = PRESETS[0].form as ExtractionForm;
const pool: PoolRef[] = [
  { id: 'a', seq: 3, title: 'Racial bias in triage advice from large language models', authors: 'Doe, Jane; Roe, R.', year: 2021, doi: '10.1/abc', pmid: '111', included: true },
  { id: 'b', seq: 7, title: 'Language and culture in chatbot answers', authors: 'Mensah K; Owusu A', year: 2023, doi: null, pmid: null, included: true },
  { id: 'c', seq: 9, title: 'Something not included', authors: 'Smith, A', year: 2020, doi: '10.9/zzz', pmid: null, included: false },
];
const toBuf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function xlsx(sheets: Record<string, string[][]>): ArrayBuffer {
  const shared: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const names = Object.keys(sheets);
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  names.forEach((n, si) => {
    const rows = sheets[n].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
      if (v === '') return '';
      if (/^\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      if (v.startsWith('inline:')) return `<c r="${ref}" t="inlineStr"><is><t>${v.slice(7)}</t></is></c>`;
      shared.push(v);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  });
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared.map((s) => `<si><r><t>${esc(s.split('|')[0])}</t></r>${s.includes('|') ? `<r><t xml:space="preserve">${esc(s.split('|')[1])}</t></r>` : ''}</si>`).join('')}</sst>`);
  return toBuf(zipSync(files));
}

describe('reading files', () => {
  it('reads an Excel workbook: shared, rich and inline strings, numbers, gaps and several sheets', () => {
    const sheets = readSheetFile('mine.xlsx', xlsx({
      Extraction: [['Study', 'Tier', 'Number of cases / prompts', 'Notes'], ['Doe et al., 2021', 'Tier 1', '250', 'Rich |text & more'], ['Mensah 2023', '', '12.5', 'inline:Inline note']],
      Other: [['x'], ['y']],
    }));
    expect(sheets.map((s) => s.name)).toEqual(['Extraction', 'Other']);
    expect(sheets[0].rows).toEqual([
      ['Study', 'Tier', 'Number of cases / prompts', 'Notes'],
      ['Doe et al., 2021', 'Tier 1', '250', 'Rich text & more'],
      ['Mensah 2023', '', '12.5', 'Inline note'],
    ]);
  });
  it('reads CSV and TSV, and explains old .xls files', () => {
    expect(readSheetFile('a.csv', toBuf(strToU8('﻿Study,Tier\n"Doe, 2021",Tier 1\n\n')))[0].rows).toEqual([['Study', 'Tier'], ['Doe, 2021', 'Tier 1']]);
    expect(readSheetFile('a.tsv', toBuf(strToU8('Study\tTier\nDoe 2021\tTier 2')))[0].rows[1]).toEqual(['Doe 2021', 'Tier 2']);
    expect(() => readSheetFile('a.xls', toBuf(strToU8('junk')))).toThrow(/Save As/);
  });
});

describe('columns and layout', () => {
  it('recognises study details and form fields from their headings', () => {
    expect(guessRole('DOI', form).kind).toBe('doi');
    expect(guessRole('First author', form).kind).toBe('authors');
    expect(guessRole('Study', form).kind).toBe('study');
    expect(guessRole('tier', form)).toEqual({ kind: 'field', key: 'tier' });
    expect(guessRole('LLMs tested', form)).toEqual({ kind: 'field', key: 'llms' });
    expect(guessRole('Key findings of the study', form)).toEqual({ kind: 'field', key: 'key_findings' });
    expect(guessRole('Funding source', form).kind).toBe('new');
    expect(matchField('Q3', ROB_PRESETS[0].form)).toBe('q3');
  });
  it('detects studies-as-columns (ScreenLab’s PDF-style CSV) and turns it round', () => {
    const rows = [['Field', 'Doe et al., 2021 (#3)', 'Mensah et al., 2023 (#7)'], ['Title', 'T1', 'T2'], ['Tier', 'Tier 1', 'Tier 2'], ['Country / setting', 'Ghana', 'UK']];
    expect(detectLayout(rows, form)).toBe('fields');
    expect(toTable(rows, 'fields')).toEqual({ headers: ['Field', 'Title', 'Tier', 'Country / setting'], records: [['Doe et al., 2021 (#3)', 'T1', 'Tier 1', 'Ghana'], ['Mensah et al., 2023 (#7)', 'T2', 'Tier 2', 'UK']] });
    expect(detectLayout([['Study', 'Tier', 'Country'], ['Doe 2021', 'Tier 1', 'Ghana']], form)).toBe('studies');
  });
});

describe('matching studies', () => {
  it('uses DOI, PMID, title, ScreenLab ID, then first author and year', () => {
    expect(matchStudy({ doi: 'https://doi.org/10.1/ABC' }, pool)).toMatchObject({ refId: 'a', how: 'DOI' });
    expect(matchStudy({ pmid: 'PMID: 111' }, pool)).toMatchObject({ refId: 'a', how: 'PMID' });
    expect(matchStudy({ title: 'Language and Culture in Chatbot Answers.' }, pool)).toMatchObject({ refId: 'b', how: 'title' });
    expect(matchStudy({ title: 'Language and culture in chatbot answers: a study' }, pool)).toMatchObject({ refId: 'b', how: 'similar title' });
    expect(matchStudy({ study: 'Doe et al., 2021 (#3)' }, pool)).toMatchObject({ refId: 'a', how: 'ScreenLab ID' });
    expect(matchStudy({ study: 'Mensah et al. 2023' }, pool)).toMatchObject({ refId: 'b', how: 'first author and year' });
    expect(matchStudy({ authors: 'Jane Doe', year: '2021' }, pool)).toMatchObject({ refId: 'a' });
    expect(matchStudy({ study: 'Nobody 1999' }, pool).refId).toBeNull();
    expect(firstAuthor('Mensah K; Owusu A')).toBe('mensah');
  });
});

describe('values', () => {
  const field = (key: string) => form.fields.find((f) => f.key === key)!;
  it('fits answers to the field type and flags what does not fit', () => {
    expect(convertValue('tier 1', field('tier'))).toEqual({ value: 'Tier 1' });
    expect(convertValue('Tier 3', field('tier'))).toMatchObject({ value: 'Tier 3', warning: expect.stringMatching(/not one of the options/) });
    expect(convertValue('Race/ethnicity; language', field('factors'))).toEqual({ value: ['Race/ethnicity', 'Language'] });
    expect(convertValue('Race/ethnicity, Skin tone', field('factors'))).toEqual({ value: ['Race/ethnicity', 'Skin tone'] });
    expect(convertValue('1,200', field('sample_size'))).toEqual({ value: '1200' });
    expect(convertValue('about 40', field('sample_size')).warning).toMatch(/not a number/);
    expect(convertValue('  ', field('country'))).toEqual({ value: null });
  });
});

describe('a whole import', () => {
  it('round-trips ScreenLab’s own CSVs in both layouts', () => {
    const studies: { study: StudyRow; data: ExtractionData }[] = [
      { study: { seq: 3, title: pool[0].title, authors: pool[0].authors, year: 2021, journal: 'J', doi: '10.1/abc' }, data: { tier: 'Tier 1', factors: ['Race/ethnicity', 'Language'], sample_size: '250' } },
      { study: { seq: 7, title: pool[1].title, authors: pool[1].authors, year: 2023, journal: null, doi: null }, data: { tier: 'Tier 2', country: 'Ghana' } },
    ];
    for (const csv of [characteristicsByFieldCsv(form, studies), characteristicsCsv(form, studies)]) {
      const rows = readSheetFile('x.csv', toBuf(strToU8(csv)))[0].rows;
      const table = toTable(rows, detectLayout(rows, form));
      const roles = table.headers.map((h) => guessRole(h, form));
      expect(newFields(table, roles, form)).toEqual([]);
      const out = buildRows(table, roles, form, pool);
      expect(out.map((r) => r.match.refId)).toEqual(['a', 'b']);
      expect(out[0].data).toEqual({ tier: 'Tier 1', factors: ['Race/ethnicity', 'Language'], sample_size: '250' });
      expect(out[1].data).toEqual({ tier: 'Tier 2', country: 'Ghana' });
    }
  });
  it('adds unknown columns as new fields and flags a paper that appears twice', () => {
    const table = toTable([['Title', 'Tier', 'Funding source'], [pool[1].title!, 'Tier 2', 'NIH'], [pool[1].title!, 'Tier 1', 'none']], 'studies');
    const roles = table.headers.map((h) => guessRole(h, form));
    const added = newFields(table, roles, form);
    expect(added).toEqual([{ key: 'funding_source', label: 'Funding source', type: 'text' }]);
    const out = buildRows(table, roles, form, pool, added);
    expect(out[0]).toMatchObject({ match: { refId: 'b' }, data: { tier: 'Tier 2', funding_source: 'NIH' } });
    expect(out[1].match).toMatchObject({ refId: null, how: 'Same paper as an earlier row' });
  });
});
