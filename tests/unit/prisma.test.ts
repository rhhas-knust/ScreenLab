import { describe, expect, it } from 'vitest';
import { NOT_RETRIEVED_RE, prismaCounts } from '../../src/lib/methods/prisma';
import { EMPTY_PRISMA, prismaManual, type SearchSource } from '../../src/lib/api/methods';
import type { ProjectSettings, ProjectStats } from '../../src/lib/types';
import { wrap } from '../../src/methods/PrismaDiagram';

const stats = (o: Partial<ProjectStats> = {}): ProjectStats => ({
  total: 5784, duplicates_removed: 6, possible_duplicates: 0, after_dedup: 5778,
  ta_screened: 5778, ta_unscreened: 0, ta_include: 361, ta_exclude: 5411, ta_maybe: 6,
  ft_pool: 361, ft_screened: 286, ft_include: 42, ft_exclude: 244, ft_unscreened: 75, ft_not_available: 0,
  stage2_enabled: true, additional_records_other_sources: 0, by_source: [], by_year: [], imports: [], ta_reasons: [],
  ft_reasons: [
    { reason: 'Wrong outcome', count: 200 }, { reason: 'Wrong study design', count: 41 },
    { reason: 'Full text unavailable', count: 2 }, { reason: 'Paper mot eevailable', count: 1 },
  ],
  ...o,
});
const src = (name: string, n: number, kind: SearchSource['kind'] = 'database'): SearchSource =>
  ({ id: name, project_id: 'p', kind, name, searched_on: '2026-09-01', search_string: null, filters: null, results_count: n, notes: null, sort_order: 0, created_at: '' });

describe('PRISMA 2020 counts', () => {
  it('without a search log, shows the import total and asks for the databases', () => {
    const c = prismaCounts(stats(), [], EMPTY_PRISMA);
    expect(c.fromSearchLog).toBe(false);
    expect(c.identified).toBe(5784);
    expect(c.gap).toBe(0);
    expect(c.warnings.some((w) => /Search log/.test(w))).toBe(true);
  });

  it('per-database numbers plus duplicates removed before import reconcile with what was screened', () => {
    const m = { ...EMPTY_PRISMA, duplicates_before_import: 1216 };
    const c = prismaCounts(stats(), [src('PubMed', 3000), src('Scopus', 4000), src('ClinicalTrials.gov', 0, 'register')], m);
    expect(c.databases.map((d) => d.name)).toEqual(['PubMed', 'Scopus']);
    expect(c.duplicates).toBe(1222);
    expect(c.gap).toBe(0);
    expect(c.warnings.some((w) => /not accounted/.test(w))).toBe(false);
  });

  it('flags records that are not accounted for', () => {
    const c = prismaCounts(stats(), [src('PubMed', 7000)], EMPTY_PRISMA);
    expect(c.gap).toBe(7000 - 6 - 5778);
    expect(c.warnings.some((w) => /Duplicates removed before import/.test(w))).toBe(true);
  });

  it('full-text "unavailable" exclusions become reports not retrieved, not exclusions', () => {
    const c = prismaCounts(stats(), [], EMPTY_PRISMA);
    expect(c.notRetrieved).toBe(3);
    expect(c.assessed).toBe(283);
    expect(c.excludedFullText).toBe(241);
    expect(c.excludedReasons.map((r) => r.reason)).toEqual(['Wrong outcome', 'Wrong study design']);
    expect(c.included).toBe(42);
    expect(c.warnings.some((w) => /Maybe/.test(w))).toBe(true);
    expect(c.warnings.some((w) => /awaiting full-text/.test(w))).toBe(true);
  });

  it('recognises common "not retrieved" wordings only', () => {
    for (const r of ['Full text unavailable', 'Not available', 'Report not retrieved', 'No full-text', 'Could not obtain'])
      expect(NOT_RETRIEVED_RE.test(r)).toBe(true);
    for (const r of ['Wrong outcome', 'Conference abstract', 'Wrong language']) expect(NOT_RETRIEVED_RE.test(r)).toBe(false);
  });

  it('manual numbers are read safely from settings and other keys are untouched', () => {
    const s = { settings: { prisma: { duplicates_before_import: '12', automation_excluded: -3 }, criteria_terms: {} } } as unknown as ProjectSettings;
    expect(prismaManual(s)).toEqual({ ...EMPTY_PRISMA, duplicates_before_import: 12 });
  });

  it('diagram text wraps at word boundaries', () => {
    expect(wrap('Records marked as ineligible by automation tools (n = 0)', 30)).toEqual(['Records marked as ineligible', 'by automation tools (n = 0)']);
  });
});
