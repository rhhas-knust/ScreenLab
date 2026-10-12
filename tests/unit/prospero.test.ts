import { describe, expect, it } from 'vitest';
import {
  amendments, amendmentText, answerFor, day, prosperoFields, prosperoSaved, prosperoToText, EMPTY_PROSPERO, type ProsperoInput,
} from '../../src/lib/methods/prospero';
import type { ProtocolDecision, SearchSource } from '../../src/lib/api/methods';
import type { Project, ProjectStats } from '../../src/lib/types';

const project = (o: Partial<Project> = {}): Project => ({
  id: 'p', owner_id: 'u', title: 'Safety mechanisms in medical LLMs', description: null,
  research_question: 'Do safety mechanisms reduce race and language disparities in medical LLM output?',
  review_type: 'systematic', inclusion_criteria: 'Involves an LLM',
  exclusion_criteria: 'Opinion piece or editorial\nNot a medical application\nNon-English with no translation available\nBook chapter or conference proceedings front matter',
  population: 'Medical LLM applications', intervention_or_exposure: 'Safety mechanisms', comparator: 'Across language or race',
  outcomes: 'Documented disparity', study_design: 'Peer-reviewed studies', date_range: '2020-2026', language: null,
  start_date: '2026-09-02', is_demo: false, created_at: '', updated_at: '', ...o,
});
const stats = (o: Partial<ProjectStats> = {}): ProjectStats => ({
  total: 5784, duplicates_removed: 6, possible_duplicates: 0, after_dedup: 5778,
  ta_screened: 5778, ta_unscreened: 0, ta_include: 361, ta_exclude: 5411, ta_maybe: 0,
  ft_pool: 361, ft_screened: 286, ft_include: 42, ft_exclude: 244, ft_unscreened: 75, ft_not_available: 0,
  stage2_enabled: true, additional_records_other_sources: 0, by_source: [], by_year: [], imports: [], ta_reasons: [], ft_reasons: [], ...o,
});
const src = (name: string, o: Partial<SearchSource> = {}): SearchSource => ({
  id: name, project_id: 'p', kind: 'database', name, searched_on: '2026-09-01', search_string: null, filters: null,
  results_count: 100, notes: null, sort_order: 0, created_at: '', ...o,
});
const dec = (title: string, decided_on: string, category: ProtocolDecision['category'], detail: string | null = null): ProtocolDecision =>
  ({ id: title, project_id: 'p', decided_on, category, title, detail, rationale: 'Because', created_at: '' });
const input = (o: Partial<ProsperoInput> = {}): ProsperoInput =>
  ({ project: project(), stats: stats(), sources: [], decisions: [], ai: null, screeningMode: 'single', ...o });
const get = (i: ProsperoInput, key: string) => prosperoFields(i).find((f) => f.key === key)!;

describe('PROSPERO helper', () => {
  it('fills fields from the protocol and marks the rest as needing the reviewer', () => {
    const fs = prosperoFields(input());
    expect(get(input(), 'question').status).toBe('auto');
    expect(get(input(), 'population').draft).toBe('Medical LLM applications');
    expect(get(input(), 'start_date').draft).toBe('2 Sep 2026');
    for (const k of ['contact', 'funding', 'risk_of_bias', 'country']) expect(get(input(), k).status).toBe('missing');
    expect(new Set(fs.map((f) => f.key)).size).toBe(fs.length);
  });

  it('adds the review type to the title when it is missing', () => {
    expect(get(input(), 'title')).toMatchObject({ draft: 'Safety mechanisms in medical LLMs: a systematic review', status: 'check' });
    expect(get(input({ project: project({ title: 'X: a systematic review' }) }), 'title')).toMatchObject({ draft: 'X: a systematic review', status: 'auto' });
  });

  it('describes searches and strategy from the search log', () => {
    expect(get(input(), 'searches').status).toBe('missing');
    const i = input({ sources: [src('PubMed', { search_string: '"large language model"[tiab]', filters: 'English' }), src('Scopus')] });
    expect(get(i, 'searches').draft).toMatch(/PubMed \(searched 1 Sep 2026\); Scopus/);
    expect(get(i, 'searches').draft).toMatch(/publication date 2020-2026; English/);
    expect(get(i, 'search_strategy').draft).toBe('PubMed:\n"large language model"[tiab]');
  });

  it('reports the stage of review from screening progress', () => {
    expect(get(input(), 'stage').draft).toMatch(/Formal screening of search results against eligibility criteria: Started/);
    expect(get(input({ stats: stats({ ft_unscreened: 0 }) }), 'stage').draft).toMatch(/eligibility criteria: Completed/);
  });

  it('takes study types, language and synthesis groups from criteria and the decision log', () => {
    const i = input({ decisions: [dec('Tier rule', '2026-10-10', 'classification', 'Tier 1: one factor. Tier 2: two or more.')] });
    expect(get(i, 'study_types').draft).toMatch(/Excluded:\n- Opinion piece or editorial\n- Book chapter/);
    expect(get(i, 'study_types').draft).not.toMatch(/Not a medical application/);
    expect(get(i, 'language')).toMatchObject({ draft: 'English', status: 'check' });
    expect(get(i, 'synthesis').draft).toMatch(/- Tier rule: Tier 1: one factor/);
    expect(get(input(), 'synthesis').status).toBe('missing');
  });

  it('mentions advisory AI use and dual screening only when they apply', () => {
    expect(get(input(), 'extraction').draft).not.toMatch(/language model/);
    const ai = { suggestions: 3, records: 3 } as ProsperoInput['ai'];
    const t = get(input({ ai, screeningMode: 'dual' }), 'extraction').draft;
    expect(t).toMatch(/two reviewers independently/);
    expect(t).toMatch(/every inclusion and exclusion decision will be made and recorded by a human reviewer/);
  });

  it('lists decisions from the registration date on as possible amendments', () => {
    const ds = [dec('Registered', '2026-09-05', 'registration'), dec('Tier 2 in scope', '2026-10-09', 'classification'), dec('Old rule', '2026-09-03', 'eligibility')];
    expect(amendments(ds, '2026-09-05').map((d) => d.title)).toEqual(['Tier 2 in scope']);
    expect(amendments(ds, null).map((d) => d.title)).toEqual(['Tier 2 in scope', 'Old rule']);
    expect(amendmentText([ds[1]])).toBe('9 Oct 2026: Tier 2 in scope. Reason: Because');
  });

  it('reads saved answers safely and prefers them over drafts', () => {
    const saved = prosperoSaved({ settings: { prospero: { registration_id: 'CRD42', registered_on: 'bad', answers: { country: 'Ghana', x: 3 } } } });
    expect(saved).toEqual({ registration_id: 'CRD42', registered_on: null, answers: { country: 'Ghana' } });
    expect(prosperoSaved(undefined)).toEqual(EMPTY_PROSPERO);
    const fs = prosperoFields(input());
    expect(answerFor(fs.find((f) => f.key === 'country')!, saved)).toBe('Ghana');
    const txt = prosperoToText('T', fs, saved);
    expect(txt).toMatch(/Country\nGhana/);
    expect(txt).toMatch(/Funding sources \/ sponsors\n\[to complete\]/);
    expect(day('2026-01-31')).toBe('31 Jan 2026');
  });
});
