// PRISMA 2020 flow counts (new systematic reviews, databases and registers + other
// sources). Pure: built from project_stats, the search log and the manual numbers,
// so the diagram always matches the records and decisions stored in ScreenLab.
import type { ProjectStats } from '../types';
import type { PrismaManual, SearchSource } from '../api/methods';

/** Full-text exclusion reasons that mean "report not retrieved" in PRISMA 2020, not "excluded". */
export const NOT_RETRIEVED_RE = /(unavailable|not\s+available|not\s+retrieved|no\s+full[\s-]?text|eevailable|could\s+not\s+(be\s+)?(obtain|access|retriev))/i;

export interface PrismaCounts {
  databases: { name: string; n: number }[];
  /** True when the per-database numbers come from the search log, false when only the import total is known. */
  fromSearchLog: boolean;
  registers: number;
  otherSources: { name: string; n: number }[];
  identified: number;
  duplicates: number;
  automation: number;
  otherRemoved: number;
  screened: number;
  excludedScreening: number;
  maybeUnresolved: number;
  unscreened: number;
  sought: number;
  notRetrieved: number;
  assessed: number;
  awaiting: number;
  excludedReasons: { reason: string; n: number }[];
  excludedFullText: number;
  included: number;
  reportsOfIncluded: number;
  stage2: boolean;
  /** Identified − removed should equal the records screened in ScreenLab; a gap usually means a missing manual number. */
  gap: number;
  warnings: string[];
}

export function prismaCounts(s: ProjectStats, sources: SearchSource[], m: PrismaManual): PrismaCounts {
  const withN = (k: SearchSource['kind']) => sources.filter((x) => x.kind === k && x.results_count != null);
  const dbs = withN('database').map((x) => ({ name: x.name, n: x.results_count! }));
  const fromSearchLog = dbs.length > 0;
  const databases = fromSearchLog ? dbs : [{ name: 'Databases (imported records)', n: s.total }];
  const registers = withN('register').reduce((a, x) => a + x.results_count!, 0);
  const otherSources = [
    ...withN('other').map((x) => ({ name: x.name, n: x.results_count! })),
    ...(s.additional_records_other_sources ? [{ name: 'Other sources (manual count)', n: s.additional_records_other_sources }] : []),
  ];
  const identified = databases.reduce((a, x) => a + x.n, 0) + registers + otherSources.reduce((a, x) => a + x.n, 0);
  const duplicates = m.duplicates_before_import + s.duplicates_removed;
  const automation = m.automation_excluded;
  const otherRemoved = m.other_removed;

  const stage2 = s.stage2_enabled;
  const retrieval = s.ft_reasons.filter((r) => NOT_RETRIEVED_RE.test(r.reason));
  const excludedReasons = s.ft_reasons.filter((r) => !NOT_RETRIEVED_RE.test(r.reason))
    .map((r) => ({ reason: r.reason, n: r.count })).sort((a, b) => b.n - a.n);
  const retrievalExcluded = retrieval.reduce((a, r) => a + r.count, 0);
  const notRetrieved = retrievalExcluded + m.reports_not_retrieved_extra;
  const excludedFullText = excludedReasons.reduce((a, r) => a + r.n, 0);
  const included = stage2 ? s.ft_include : s.ta_include;

  // Records that reached screening in ScreenLab (after its own de-duplication), plus other sources counted manually.
  const screened = s.ta_screened + s.ta_unscreened + s.additional_records_other_sources;
  const gap = identified - duplicates - automation - otherRemoved - screened;

  const warnings: string[] = [];
  if (!fromSearchLog) warnings.push('Add each database and its number of results in the Search log; until then the diagram shows only the total imported.');
  if (gap !== 0) {
    warnings.push(gap > 0
      ? `${gap.toLocaleString()} records identified are not accounted for. If duplicates were removed before import (e.g. in Rayyan, EndNote or Zotero), enter that number under "Duplicates removed before import".`
      : `${(-gap).toLocaleString()} more records were screened than identified. Check the result counts in the Search log.`);
  }
  if (s.ta_unscreened) warnings.push(`${s.ta_unscreened.toLocaleString()} records are not yet screened at title/abstract.`);
  if (s.ta_maybe) warnings.push(`${s.ta_maybe} record(s) are still marked Maybe at title/abstract; resolve them before reporting.`);
  if (stage2 && s.ft_unscreened) warnings.push(`${s.ft_unscreened.toLocaleString()} reports are still awaiting full-text assessment.`);
  if (s.possible_duplicates) warnings.push(`${s.possible_duplicates} possible duplicate(s) are not yet reviewed.`);

  return {
    databases, fromSearchLog, registers, otherSources, identified, duplicates, automation, otherRemoved,
    screened: s.ta_screened, excludedScreening: s.ta_exclude, maybeUnresolved: s.ta_maybe, unscreened: s.ta_unscreened,
    sought: s.ft_pool, notRetrieved, assessed: Math.max(0, s.ft_screened - retrievalExcluded),
    awaiting: s.ft_unscreened, excludedReasons, excludedFullText, included,
    reportsOfIncluded: m.reports_of_included ?? included, stage2, gap, warnings,
  };
}
