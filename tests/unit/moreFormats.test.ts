import { describe, expect, it } from 'vitest';
import { detectFormat, parseByFormat } from '../../src/lib/import/parsers';

const WOS = `FN Clarivate Analytics Web of Science
VR 1.0
PT J
AU Doe, J
   Roe, R
AF Doe, Jane
   Roe, Richard
TI Bias in large language models for
   clinical triage
SO JOURNAL OF MEDICAL AI
DE LLM; triage
ID FAIRNESS
AB We test bias.
PY 2024
VL 3
IS 2
BP 10
EP 19
DI 10.1234/jmai.2024.1
PM 38000001
DT Article
LA English
UT WOS:000123
ER

PT J
AU Smith, A
TI Second record
PY 2023
ER

EF
`;

const ENDNOTE = `<?xml version="1.0" encoding="UTF-8" ?><xml><records><record><database name="My.enl">My.enl</database>
<ref-type name="Journal Article">17</ref-type><contributors><authors><author><style face="normal">Doe, Jane</style></author><author><style>Roe, R.</style></author></authors></contributors>
<titles><title><style face="normal">Bias &amp; fairness in LLM triage</style></title><secondary-title><style>J Med AI</style></secondary-title></titles>
<pages><style>10-19</style></pages><volume><style>3</style></volume><number><style>2</style></number>
<keywords><keyword><style>LLM</style></keyword><keyword><style>triage</style></keyword></keywords>
<dates><year><style>2024</style></year></dates><electronic-resource-num><style>https://doi.org/10.1234/jmai.2024.1</style></electronic-resource-num>
<accession-num><style>38000001</style></accession-num><abstract><style>We test bias.</style></abstract><remote-database-name><style>Embase</style></remote-database-name>
</record><record><titles><title>Second</title></titles><dates><year>2023</year></dates></record></records></xml>`;

describe('Web of Science plain text', () => {
  it('is detected and parsed, with wrapped lines and full author names', () => {
    expect(detectFormat('savedrecs.txt', WOS)).toBe('wos');
    const r = parseByFormat('wos', WOS);
    expect(r.records).toHaveLength(2);
    expect(r.records[0]).toMatchObject({
      title: 'Bias in large language models for clinical triage', authors: 'Doe, Jane; Roe, Richard', journal: 'JOURNAL OF MEDICAL AI',
      year: 2024, volume: '3', issue: '2', pages: '10-19', doi: '10.1234/jmai.2024.1', pmid: '38000001', keywords: 'LLM; triage; FAIRNESS',
      publication_type: 'Article', language: 'English', database_source: 'Web of Science', abstract: 'We test bias.',
    });
    expect(r.records[1]).toMatchObject({ title: 'Second record', authors: 'Smith, A', year: 2023 });
    expect(r.malformed).toEqual([]);
  });
});

describe('EndNote XML', () => {
  it('is detected and parsed', () => {
    expect(detectFormat('library.xml', ENDNOTE)).toBe('endnote');
    const r = parseByFormat('endnote', ENDNOTE);
    expect(r.records).toHaveLength(2);
    expect(r.records[0]).toMatchObject({
      title: 'Bias & fairness in LLM triage', authors: 'Doe, Jane; Roe, R.', journal: 'J Med AI', year: 2024, pages: '10-19', volume: '3', issue: '2',
      doi: '10.1234/jmai.2024.1', pmid: '38000001', keywords: 'LLM; triage', abstract: 'We test bias.', publication_type: 'Journal Article', database_source: 'Embase',
    });
    expect(r.records[1]).toMatchObject({ title: 'Second', year: 2023 });
  });
});

import { referencesToBibtex, referencesToCsv, referencesToEndnoteXml } from '../../src/lib/export/formats';
import type { Reference } from '../../src/lib/types';

const ref = {
  id: 'r1', seq: 4, title: 'Bias & {fairness} in 100% of LLMs', authors: 'Doe, Jane; Roe, R.', year: 2024, journal: 'J Med AI', volume: '3', issue: '2', pages: '10-19',
  doi: '10.1234/x', pmid: '38000001', url: null, abstract: 'We test bias.', keywords: 'LLM; triage', publication_type: 'Journal Article', language: 'English',
  database_source: 'Embase', title_abstract_decision: 'exclude', title_abstract_exclusion_reason: 'Wrong population', full_text_decision: null, full_text_exclusion_reason: null,
  notes: 'Check again', tag_names: ['Hospital'], title_abstract_conflict: true, full_text_conflict: false,
} as unknown as Reference;

describe('exports', () => {
  it('BibTeX and EndNote XML read back in with the same details', () => {
    const bib = parseByFormat('bibtex', referencesToBibtex([ref])).records[0];
    expect(bib).toMatchObject({ title: 'Bias & {fairness} in 100% of LLMs', authors: 'Doe, Jane; Roe, R.', year: 2024, journal: 'J Med AI', doi: '10.1234/x' });
    const xml = parseByFormat('endnote', referencesToEndnoteXml([ref])).records[0];
    expect(xml).toMatchObject({ title: ref.title, authors: 'Doe, Jane; Roe, R.', year: 2024, journal: 'J Med AI', doi: '10.1234/x', pmid: '38000001', pages: '10-19', database_source: 'Embase' });
    expect(referencesToEndnoteXml([ref])).toContain('ScreenLab title/abstract: Excluded (Wrong population)');
  });
  it('CSV adds each reviewer’s decisions and the conflict flags', () => {
    const csv = referencesToCsv([ref], {
      reviewers: [{ id: 'a', name: 'kofi' }, { id: 'b', name: 'nana' }],
      votes: new Map([['r1:title_abstract:a', { decision: 'include', reason: null }], ['r1:title_abstract:b', { decision: 'exclude', reason: 'Wrong population' }]]),
    });
    expect(csv).toContain('"Title/Abstract conflict","Full-text conflict","Title/Abstract — kofi","Full text — kofi","Title/Abstract — nana","Full text — nana"');
    expect(csv).toContain('"Yes","","Included","","Excluded (Wrong population)",""');
  });
});
