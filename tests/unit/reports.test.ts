import { describe, expect, it } from 'vitest';
import { buildProtocol, buildSearchStrategy, TO_COMPLETE } from '../../src/lib/methods/reports';
import { prosperoFields, EMPTY_PROSPERO } from '../../src/lib/methods/prospero';
import type { ProtocolDecision, SearchSource } from '../../src/lib/api/methods';
import type { Project, ProjectStats } from '../../src/lib/types';

const src = (name: string, o: Partial<SearchSource> = {}): SearchSource => ({
  id: name, project_id: 'p', kind: 'database', name, searched_on: '2026-09-05', search_string: `${name} query`, filters: '2020-2026, English only',
  results_count: 1000, notes: null, sort_order: 0, created_at: '', ...o,
});
const project: Project = {
  id: 'p', owner_id: 'u', title: 'Safety mechanisms in medical LLMs', description: null, research_question: 'Do safeguards reduce disparities?',
  review_type: 'systematic', inclusion_criteria: 'Evaluates an LLM\nMedical context', exclusion_criteria: 'Opinion piece\nNon-English with no translation',
  population: 'Medical LLM applications', intervention_or_exposure: 'Safety mechanisms', comparator: 'Across groups', outcomes: 'Disparity',
  study_design: 'Peer-reviewed studies', date_range: '2020-2026', language: null, start_date: '2026-09-02', is_demo: false, created_at: '', updated_at: '',
};
const stats = {
  total: 100, duplicates_removed: 0, possible_duplicates: 0, after_dedup: 100, ta_screened: 100, ta_unscreened: 0, ta_include: 10, ta_exclude: 90, ta_maybe: 0,
  ft_pool: 10, ft_screened: 10, ft_include: 5, ft_exclude: 5, ft_unscreened: 0, ft_not_available: 0, stage2_enabled: true,
  additional_records_other_sources: 0, by_source: [], by_year: [], imports: [], ta_reasons: [], ft_reasons: [],
} as ProjectStats;
const dec = (title: string, category: ProtocolDecision['category']): ProtocolDecision =>
  ({ id: title, project_id: 'p', decided_on: '2026-10-12', category, title, detail: 'Detail', rationale: 'Why', created_at: '' });

describe('search strategy document', () => {
  it('summarises each source with its date, limits and total', () => {
    const d = buildSearchStrategy([src('PubMed', { results_count: 3172 }), src('Scopus', { results_count: 4298 })], 1668);
    expect(d.rows.map((r) => [r.name, r.date, r.records])).toEqual([['PubMed', '5 Sep 2026', '3,172'], ['Scopus', '5 Sep 2026', '4,298']]);
    expect(d.total).toBe(7470);
    expect(d.duplicatesNote).toMatch(/1,668 duplicates/);
    expect(d.details[0].strategy).toBe('PubMed query');
    expect(d.missing).toEqual([]);
  });

  it('marks what still needs filling in', () => {
    const d = buildSearchStrategy([src('Embase', { searched_on: null, results_count: null, search_string: ' ' })], 0);
    expect(d.rows[0]).toMatchObject({ date: TO_COMPLETE, records: TO_COMPLETE });
    expect(d.details[0].strategy).toBe(TO_COMPLETE);
    expect(d.total).toBeNull();
    expect(d.duplicatesNote).toBeNull();
    expect(d.missing).toEqual(['Embase: date searched', 'Embase: number of records', 'Embase: search string']);
  });
});

describe('protocol document', () => {
  const sources = [src('PubMed')];
  const fields = prosperoFields({ project, stats, sources, decisions: [], ai: null, screeningMode: 'single', dataItems: ['Tier', 'LLMs tested'], duplicatesBeforeImport: 1668 });
  const item = (d: ReturnType<typeof buildProtocol>, num: string) => d.parts.flatMap((p) => p.items).find((i) => i.num === num)!;

  it('follows PRISMA-P 2015: three parts, items 1 to 17 in order', () => {
    const d = buildProtocol(project, fields, EMPTY_PROSPERO, sources, []);
    expect(d.parts.map((p) => p.heading)).toEqual(['Administrative information', 'Introduction', 'Methods', 'Additional information']);
    expect(d.parts.slice(0, 3).flatMap((p) => p.items.map((i) => i.num))).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17']);
    expect(item(d, '1').blocks[0]).toMatchObject({ label: '1a Identification', text: 'Safety mechanisms in medical LLMs: a systematic review: protocol' });
    expect(item(d, '10').blocks[0]).toMatchObject({ kind: 'code', text: 'PubMed query' });
    expect(item(d, '12').blocks[0]).toMatchObject({ text: expect.stringContaining('Tier; LLMs tested') });
    expect(item(d, '11').blocks[0]).toMatchObject({ text: expect.stringContaining('1,668 duplicates removed') });
  });

  it('uses saved answers over drafts and lists what is missing, including protocol-only items', () => {
    const saved = { ...EMPTY_PROSPERO, registration_id: 'CRD42026000001', answers: { country: 'Ghana', funding: 'None', confidence: 'GRADE' } };
    const d = buildProtocol(project, fields, saved, sources, [dec('Tier 2 in scope', 'classification'), dec('Registered', 'registration')]);
    expect(d.registration).toBe('PROSPERO CRD42026000001');
    expect(item(d, '2').blocks[0]).toMatchObject({ text: 'Registered with PROSPERO: CRD42026000001.' });
    const authors = item(d, '3').blocks[0];
    expect(authors.kind === 'fields' && authors.rows.find((r) => r.label === 'Country')?.text).toBe('Ghana');
    expect(item(d, '17').blocks[0]).toMatchObject({ text: 'GRADE' });
    expect(d.missing).toEqual(expect.arrayContaining(['Named contact, email and organisation', 'Rationale (item 6)', 'Meta-bias(es) (item 16)']));
    expect(d.missing).not.toContain('Country');
    expect(d.missing).not.toContain('Confidence in cumulative evidence (item 17)');
    const amend = item(d, '4').blocks[1];
    expect(amend.kind === 'table' && amend.rows.map((r) => r[2])).toEqual(['Tier 2 in scope. Detail']);
  });

  it('includes the eligibility lists and the PRISMA-P checklist', () => {
    const d = buildProtocol(project, fields, EMPTY_PROSPERO, sources, []);
    const lists = item(d, '8').blocks.filter((b) => b.kind === 'list');
    expect(lists.map((b) => b.kind === 'list' && b.items)).toEqual([['Evaluates an LLM', 'Medical context'], ['Opinion piece', 'Non-English with no translation']]);
    expect(item(d, '4').blocks).toHaveLength(1);
    const checklist = d.parts[3].items.find((i) => /checklist/.test(i.heading))!.blocks[1];
    expect(checklist.kind === 'table' && checklist.rows).toHaveLength(17);
  });
});
