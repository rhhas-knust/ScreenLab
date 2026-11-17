import { supabase } from '../supabase';
import { must } from '../errors';
import type { Decision, Reference, ReferenceListItem, Stage } from '../types';
import { PICO_KEYS, PICO_LABELS, activePico, type CriteriaTerms, type PicoKey } from '../criteria';

export type StatusFilter = 'all' | 'unscreened' | 'screened' | 'include' | 'exclude' | 'maybe' | 'conflict' | 'final_include' | 'final_exclude';
export type DupFilter = 'active' | 'all' | 'none' | 'possible' | 'duplicate' | 'kept' | 'merged';
export type SortKey = 'seq' | 'title' | 'year' | 'authors' | 'status' | 'screened_at' | 'database_source' | 'relevance';

export interface RefFilters {
  q: string;
  status: StatusFilter;
  source: string;
  yearFrom: string;
  yearTo: string;
  pubType: string;
  language: string;
  tags: string[];
  dup: DupFilter;
  ftStatus: '' | 'not_available' | 'available' | 'reviewed';
  reason: string;
  /** Criteria-keyword filter: has inclusion terms / has exclusion terms / exclusion but no inclusion / no inclusion terms. */
  kw: '' | 'inc' | 'exc' | 'exc_only' | 'no_inc';
  /** PICO filter: all elements found / at least one missing / none found / a specific element missing. */
  pico: PicoFilter;
  /** At least this many stars of predicted relevance (1–5). */
  minStars?: number;
  /** Facet filters from the "Browse" panel: an author, a journal or a keyword. */
  author?: string;
  journal?: string;
  keyword?: string;
  /** Who screened it at this stage: '' anyone, 'me', 'partner', 'partner_not_me', 'not_me', or a reviewer's user id. */
  by: string;
  /** The project's criteria keywords (not stored in the URL; supplied by the page). */
  terms?: CriteriaTerms;
  /** The signed-in user and their co-reviewers (supplied by the page; needed for `by`). */
  me?: string;
  partners?: string[];
  /** Dual screening: status filters use the signed-in reviewer's own decision. */
  dual?: boolean;
}

export type PicoFilter = '' | 'all' | 'miss_any' | 'none' | `miss_${PicoKey}`;

export const PICO_FILTER_LABELS: Record<PicoFilter, string> = {
  '': 'Any',
  all: 'All PICO elements found',
  miss_any: 'At least one element missing',
  none: 'No PICO keywords found',
  ...Object.fromEntries(PICO_KEYS.map((k) => [`miss_${k}`, `${PICO_LABELS[k]} missing`])),
} as Record<PicoFilter, string>;

export const KW_LABELS: Record<RefFilters['kw'], string> = {
  '': 'Any',
  inc: 'Has inclusion keywords',
  exc: 'Has exclusion keywords',
  exc_only: 'Exclusion keywords but no inclusion keywords',
  no_inc: 'No inclusion keywords',
};

export interface RefSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: RefFilters = {
  q: '', status: 'all', source: '', yearFrom: '', yearTo: '', pubType: '', language: '', tags: [],
  dup: 'active', ftStatus: '', reason: '', kw: '', pico: '', by: '', author: '', journal: '', keyword: '',
};
export const DEFAULT_SORT: RefSort = { key: 'seq', dir: 'asc' };

export const SORT_LABELS: Record<SortKey, string> = {
  seq: 'Import order', title: 'Title', year: 'Year', authors: 'Author', status: 'Screening status',
  screened_at: 'Date screened', database_source: 'Database', relevance: 'Predicted relevance',
};

export const LIST_COLUMNS =
  'id,seq,title,authors,year,journal,database_source,title_abstract_decision,title_abstract_exclusion_reason,' +
  'title_abstract_screened_at,full_text_decision,full_text_exclusion_reason,full_text_screened_at,duplicate_status,tag_names,full_text_status,' +
  'title_abstract_reviewers,full_text_reviewers,title_abstract_conflict,full_text_conflict,' +
  'my_title_abstract_decision,my_title_abstract_exclusion_reason,my_full_text_decision,my_full_text_exclusion_reason,' +
  'title_abstract_relevance,full_text_relevance';

/** Screening reads go through this view: the table plus the caller's own decisions. */
export const REFS_VIEW = 'screening_refs';

export function decisionColumn(stage: Stage, mine = false) {
  return `${mine ? 'my_' : ''}${stage === 'title_abstract' ? 'title_abstract_decision' : 'full_text_decision'}`;
}
export function reasonColumn(stage: Stage, mine = false) {
  return `${mine ? 'my_' : ''}${stage === 'title_abstract' ? 'title_abstract_exclusion_reason' : 'full_text_exclusion_reason'}`;
}
export function relevanceColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_relevance' : 'full_text_relevance';
}
/** Lowest predicted probability for each star rating (see lib/relevance stars()). */
export const STAR_FLOOR: Record<number, number> = { 5: 0.8, 4: 0.6, 3: 0.4, 2: 0.2, 1: 0 };
export function conflictColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_conflict' : 'full_text_conflict';
}
export function reviewersColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_reviewers' : 'full_text_reviewers';
}
export function screenedAtColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_screened_at' : 'full_text_screened_at';
}

export function sortColumn(key: SortKey, stage: Stage): string {
  switch (key) {
    case 'status': return decisionColumn(stage);
    case 'screened_at': return screenedAtColumn(stage);
    case 'relevance': return relevanceColumn(stage);
    default: return key;
  }
}

const SEARCH_FIELDS: Record<string, string> = {
  title: 'title', ti: 'title', abstract: 'abstract', ab: 'abstract', author: 'authors', au: 'authors', authors: 'authors',
  journal: 'journal', so: 'journal', keyword: 'keywords', kw: 'keywords', keywords: 'keywords', doi: 'doi', notes: 'notes', tag: 'tag_names',
};
export interface SearchClause { neg: boolean; alts: { col: string; term: string }[] }

/**
 * Search box syntax, as in Rayyan and the databases: words are ANDed;
 * "quoted phrases"; OR between alternatives; NOT or a leading - to exclude;
 * field:term for title, abstract, author, journal, keyword, doi, notes, tag.
 * Everything is case-insensitive and matches part of a word.
 */
export function parseSearch(input: string): SearchClause[] {
  const toks = [...input.matchAll(/(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)].map((m) => {
    const field = m[2]?.toLowerCase();
    const known = field && SEARCH_FIELDS[field];
    const word = (m[3] ?? m[4] ?? '').trim();
    return { neg: m[1] === '-', col: known ? SEARCH_FIELDS[field] : 'search_text', term: (known || !field ? word : `${m[2]}:${word}`).toLowerCase(), raw: m[0] };
  });
  const out: SearchClause[] = [];
  let neg = false, or = false;
  for (const t of toks) {
    if (t.raw === 'OR' || t.raw === '|') { or = out.length > 0; continue; }
    if (t.raw === 'AND' || t.raw === '&') continue;
    if (t.raw === 'NOT') { neg = true; continue; }
    if (!t.term) continue;
    const alt = { col: t.col === 'tag_names' ? 'tag_names' : t.col, term: t.term };
    const isNeg = neg || t.neg;
    if (or && !isNeg && !out[out.length - 1].neg) out[out.length - 1].alts.push(alt);
    else out.push({ neg: isNeg, alts: [alt] });
    neg = false; or = false;
  }
  // tag_names is an array: search its text form instead.
  for (const c of out) for (const a of c.alts) if (a.col === 'tag_names') a.col = 'search_text';
  return out.slice(0, 12);
}

/** Escape a value for use inside a PostgREST or=() filter. */
function q(v: string | number): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// PostgREST builders have deeply generic types; a loose alias keeps this readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

/**
 * Apply project scope, screening stage pool and all filters server-side.
 * Stage 2 (full text) only contains records included at title/abstract.
 */
export function applyFilters(query: Query, projectId: string, stage: Stage, f: RefFilters): Query {
  let qb = query.eq('project_id', projectId);
  const dcol = decisionColumn(stage, !!f.dual);
  const fcol = decisionColumn(stage);

  if (f.dup === 'active') qb = qb.not('duplicate_status', 'in', '(duplicate,merged)');
  else if (f.dup !== 'all') qb = qb.eq('duplicate_status', f.dup);

  if (stage === 'full_text') qb = qb.eq('title_abstract_decision', 'include');

  switch (f.status) {
    case 'unscreened': qb = qb.is(dcol, null); break;
    case 'screened': qb = qb.not(dcol, 'is', null); break;
    case 'include': case 'exclude': case 'maybe': qb = qb.eq(dcol, f.status); break;
    case 'conflict': qb = qb.eq(conflictColumn(stage), true); break;
    case 'final_include': qb = qb.eq(fcol, 'include'); break;
    case 'final_exclude': qb = qb.eq(fcol, 'exclude'); break;
  }

  for (const c of parseSearch(f.q)) {
    if (c.alts.length === 1) {
      const { col, term } = c.alts[0];
      qb = c.neg ? qb.not(col, 'ilike', `%${escapeLike(term)}%`) : qb.ilike(col, `%${escapeLike(term)}%`);
    } else {
      qb = qb.or(c.alts.map((a) => `${a.col}.ilike.${q(`*${escapeLike(a.term)}*`)}`).join(','));
    }
  }

  if (f.source) qb = f.source === '__none__' ? qb.is('database_source', null) : qb.eq('database_source', f.source);
  const yf = parseInt(f.yearFrom, 10);
  const yt = parseInt(f.yearTo, 10);
  if (!Number.isNaN(yf)) qb = qb.gte('year', yf);
  if (!Number.isNaN(yt)) qb = qb.lte('year', yt);
  if (f.pubType) qb = qb.eq('publication_type', f.pubType);
  if (f.language) qb = qb.eq('language', f.language);
  if (f.tags.length) qb = qb.contains('tag_names', f.tags);
  if (f.minStars && STAR_FLOOR[f.minStars] != null) qb = qb.gte(relevanceColumn(stage), STAR_FLOOR[f.minStars]);
  if (f.author) qb = qb.ilike('authors', `%${escapeLike(f.author)}%`);
  if (f.journal) qb = qb.eq('journal', f.journal);
  if (f.keyword) qb = qb.ilike('keywords', `%${escapeLike(f.keyword)}%`);
  if (f.ftStatus) qb = qb.eq('full_text_status', f.ftStatus);
  if (f.reason) qb = qb.eq(reasonColumn(stage, !!f.dual), f.reason);
  if (f.kw && f.terms) qb = applyKeywordFilter(qb, f.kw, f.terms);
  if (f.pico && f.terms) qb = applyPicoFilter(qb, f.pico, f.terms);
  if (f.by && f.me) qb = applyReviewerFilter(qb, reviewersColumn(stage), f.by, f.me, f.partners ?? []);
  return qb;
}

const NO_ONE = '00000000-0000-0000-0000-000000000000';

function applyReviewerFilter(qb: Query, col: string, by: string, me: string, partners: string[]): Query {
  const others = partners.length ? partners : [NO_ONE];
  switch (by) {
    case 'me': return qb.contains(col, [me]);
    case 'not_me': return qb.not(col, 'cs', `{${me}}`);
    case 'partner': return qb.overlaps(col, others);
    case 'partner_not_me': return qb.overlaps(col, others).not(col, 'cs', `{${me}}`);
    default: return /^[0-9a-f-]{36}$/i.test(by) ? qb.contains(col, [by]) : qb;
  }
}

/**
 * PostgreSQL regular expression for a criteria term: whole words (\m … \M),
 * phrases match across spaces or hyphens, a trailing * matches any ending.
 * Mirrors termPattern() used for highlighting.
 */
export function termRegexPg(term: string): string {
  const wild = term.endsWith('*');
  const body = (wild ? term.slice(0, -1) : term)
    .replace(/[\\.^$|?*+()[\]{}]/g, '\\$&')
    .trim()
    .replace(/\s+/g, '[[:space:]-]+');
  return `\\m${body}${wild ? '' : '\\M'}`;
}

/** Server-side keyword filter on the searchable text (title, abstract, authors, keywords, notes, tags). */
function applyKeywordFilter(qb: Query, kw: RefFilters['kw'], terms: CriteriaTerms): Query {
  const anyOf = (list: string[]) => list.map((t) => `search_text.imatch.${q(termRegexPg(t))}`).join(',');
  const noneOf = (b: Query, list: string[]) => list.reduce((x, t) => x.not('search_text', 'imatch', termRegexPg(t)), b);
  const nothing = (b: Query) => b.eq('id', '00000000-0000-0000-0000-000000000000');
  const inc = terms.include;
  const exc = terms.exclude;
  switch (kw) {
    case 'inc': return inc.length ? qb.or(anyOf(inc)) : nothing(qb);
    case 'exc': return exc.length ? qb.or(anyOf(exc)) : nothing(qb);
    case 'exc_only': return exc.length ? noneOf(qb.or(anyOf(exc)), inc) : nothing(qb);
    case 'no_inc': return noneOf(qb, inc);
    default: return qb;
  }
}

const matchAny = (list: string[]) => list.map((t) => `search_text.imatch.${q(termRegexPg(t))}`).join(',');
const matchNone = (list: string[]) => list.map((t) => `search_text.not.imatch.${q(termRegexPg(t))}`).join(',');

/** Server-side PICO filter. Elements without keywords are ignored. */
function applyPicoFilter(qb: Query, pico: PicoFilter, terms: CriteriaTerms): Query {
  const keys = activePico(terms);
  const of = (k: PicoKey) => terms.pico?.[k] ?? [];
  const nothing = (b: Query) => b.eq('id', '00000000-0000-0000-0000-000000000000');
  if (!keys.length) return nothing(qb);
  switch (pico) {
    case 'all': return keys.reduce((b, k) => b.or(matchAny(of(k))), qb);
    case 'none': return keys.flatMap(of).reduce((b, t) => b.not('search_text', 'imatch', termRegexPg(t)), qb);
    case 'miss_any': return qb.or(keys.map((k) => `and(${matchNone(of(k))})`).join(','));
    default: {
      const k = pico.slice(5) as PicoKey;
      return keys.includes(k) ? of(k).reduce((b, t) => b.not('search_text', 'imatch', termRegexPg(t)), qb) : nothing(qb);
    }
  }
}

function applyOrder(qb: Query, stage: Stage, sort: RefSort, reverse = false): Query {
  const col = sortColumn(sort.key, stage);
  const asc = (sort.dir === 'asc') !== reverse;
  if (col === 'seq') return qb.order('seq', { ascending: asc });
  // Nulls always sort after values in the forward direction.
  return qb.order(col, { ascending: asc, nullsFirst: reverse }).order('seq', { ascending: asc });
}

/**
 * Keyset condition selecting the rows strictly after (or before) `cur` in the
 * current sort order. Returns a PostgREST or() expression, or a simple filter.
 */
function applyKeyset(qb: Query, stage: Stage, sort: RefSort, cur: Pick<Reference, 'seq'> & Record<string, unknown>, direction: 'next' | 'prev'): Query {
  const col = sortColumn(sort.key, stage);
  const forward = (sort.dir === 'asc') === (direction === 'next');
  const gt = forward ? 'gt' : 'lt';
  const s = cur.seq;
  if (col === 'seq') return qb.filter('seq', gt, s);
  const v = cur[col] as string | number | null | undefined;
  if (direction === 'next') {
    // "after": greater value, or same value and later seq, or null (nulls are last)
    if (v == null) return qb.is(col, null).filter('seq', gt, s);
    return qb.or(`${col}.${gt}.${q(v)},and(${col}.eq.${q(v)},seq.${gt}.${s}),${col}.is.null`);
  }
  // "before": nulls come first when walking backwards
  if (v == null) return qb.or(`${col}.not.is.null,and(${col}.is.null,seq.${gt}.${s})`);
  return qb.or(`${col}.${gt}.${q(v)},and(${col}.eq.${q(v)},seq.${gt}.${s})`);
}

export interface ListPage {
  rows: ReferenceListItem[];
  count: number;
}

export async function listReferences(
  projectId: string, stage: Stage, filters: RefFilters, sort: RefSort, page: number, pageSize: number, extraColumns = '',
): Promise<ListPage> {
  let qb = supabase.from(REFS_VIEW).select(LIST_COLUMNS + extraColumns, { count: 'exact' });
  qb = applyFilters(qb, projectId, stage, filters);
  qb = applyOrder(qb, stage, sort);
  const from = page * pageSize;
  const res = await qb.range(from, from + pageSize - 1);
  if (res.error) throw res.error;
  return { rows: (res.data ?? []) as unknown as ReferenceListItem[], count: res.count ?? 0 };
}

export async function getReference(id: string): Promise<Reference> {
  return must(await supabase.from(REFS_VIEW).select('*').eq('id', id).single()) as Reference;
}

/** Next / previous reference in the current list order (any status). */
export async function neighbor(
  projectId: string, stage: Stage, filters: RefFilters, sort: RefSort, cur: Reference, direction: 'next' | 'prev',
): Promise<Reference | null> {
  let qb = supabase.from(REFS_VIEW).select('*');
  qb = applyFilters(qb, projectId, stage, filters);
  qb = applyKeyset(qb, stage, sort, cur as unknown as Reference & Record<string, unknown>, direction);
  qb = applyOrder(qb, stage, sort, direction === 'prev');
  const rows = must(await qb.limit(1)) as Reference[];
  return rows[0] ?? null;
}

/**
 * The screening queue: unscreened references (in the current filter + sort),
 * starting after `after` and wrapping round to the beginning.
 */
export async function fetchQueue(
  projectId: string, stage: Stage, filters: RefFilters, sort: RefSort, after: Reference | null, limit = 12,
): Promise<Reference[]> {
  const f: RefFilters = { ...filters, status: 'unscreened' };
  let rows: Reference[] = [];
  if (after) {
    let qb = supabase.from(REFS_VIEW).select('*');
    qb = applyFilters(qb, projectId, stage, f);
    qb = applyKeyset(qb, stage, sort, after as unknown as Reference & Record<string, unknown>, 'next');
    qb = applyOrder(qb, stage, sort);
    rows = must(await qb.limit(limit)) as Reference[];
  }
  if (rows.length < limit) {
    let qb = supabase.from(REFS_VIEW).select('*');
    qb = applyFilters(qb, projectId, stage, f);
    qb = applyOrder(qb, stage, sort);
    const more = must(await qb.limit(limit)) as Reference[];
    const seen = new Set(rows.map((r) => r.id));
    if (after) seen.add(after.id);
    for (const r of more) if (!seen.has(r.id) && rows.length < limit) rows.push(r);
  }
  return rows;
}

export async function updateReferenceFields(id: string, patch: Partial<Reference>): Promise<Reference> {
  return must(await supabase.from('study_references').update(patch).eq('id', id).select('*').single()) as Reference;
}

export async function recordDecision(args: {
  referenceId: string; stage: Stage; decision: string | null; reason: string | null; action: 'decide' | 'undo' | 'resolve'; clientTs: string;
}): Promise<Reference> {
  return must(await supabase.rpc('record_decision', {
    p_reference_id: args.referenceId,
    p_stage: args.stage,
    p_decision: args.decision,
    p_reason: args.reason,
    p_action: args.action,
    p_client_ts: args.clientTs,
  })) as Reference;
}

export async function getDecisionHistory(referenceId: string) {
  return must(await supabase.from('screening_decisions').select('*').eq('reference_id', referenceId)
    .order('created_at', { ascending: false }).limit(50));
}

export async function setDuplicateStatus(referenceId: string, status: 'none' | 'duplicate' | 'kept'): Promise<Reference> {
  return must(await supabase.rpc('set_duplicate_status', { p_reference_id: referenceId, p_status: status })) as Reference;
}

/** Fetch every reference of a project in pages (used for export / backup only). */
export async function fetchAllReferences(projectId: string, onProgress?: (n: number) => void): Promise<Reference[]> {
  const out: Reference[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = must(await supabase.from('study_references').select('*').eq('project_id', projectId)
      .order('seq', { ascending: true }).range(from, from + size - 1)) as Reference[];
    out.push(...rows);
    onProgress?.(out.length);
    if (rows.length < size) break;
  }
  return out;
}

/** IDs (with current decision) of every reference matching the view — for "select all matching". */
export async function fetchMatchingIds(
  projectId: string, stage: Stage, filters: RefFilters, sort: RefSort, onProgress?: (n: number) => void,
): Promise<{ id: string; decision: Decision | null; title: string | null }[]> {
  const col = decisionColumn(stage, !!filters.dual);
  const out: { id: string; decision: Decision | null; title: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let qb = supabase.from(REFS_VIEW).select(`id,title,${col}`);
    qb = applyFilters(qb, projectId, stage, filters);
    qb = applyOrder(qb, stage, sort);
    const rows = must(await qb.range(from, from + 999)) as unknown as Record<string, unknown>[];
    for (const r of rows) out.push({ id: r.id as string, decision: (r[col] as Decision | null) ?? null, title: (r.title as string | null) ?? null });
    onProgress?.(out.length);
    if (rows.length < 1000) break;
  }
  return out;
}

export interface BulkItem {
  id: string;
  decision: Decision | null;
  reason: string | null;
}

/**
 * Apply decisions to many references (each one is recorded individually in
 * the audit history). Returns every record's previous decision for undo.
 */
export async function recordDecisionsBulk(
  stage: Stage, items: BulkItem[], action: 'decide' | 'undo' = 'decide', onProgress?: (done: number, total: number) => void,
): Promise<BulkItem[]> {
  const previous: BulkItem[] = [];
  const size = 200;
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const prev = must(await supabase.rpc('record_decisions_bulk', { p_stage: stage, p_items: chunk, p_action: action })) as BulkItem[];
    previous.push(...(prev ?? []));
    onProgress?.(Math.min(i + size, items.length), items.length);
  }
  return previous;
}

export interface ReviewerStats {
  reviewers: { reviewer_id: string; stage: Stage; screened: number; include: number; exclude: number; maybe: number }[];
  /** Two reviewers' decisions on the same record (only pairs the caller may see). */
  pairs: { stage: Stage; a: Decision; b: Decision }[];
  ta_conflicts: number;
  ft_conflicts: number;
}
export async function reviewerStats(projectId: string): Promise<ReviewerStats> {
  return (must(await supabase.rpc('reviewer_stats', { p_project_id: projectId })) ?? { reviewers: [], pairs: [], ta_conflicts: 0, ft_conflicts: 0 }) as ReviewerStats;
}

export type FacetKind = 'author' | 'journal' | 'keyword' | 'year' | 'publication_type' | 'language';
export async function facetCounts(projectId: string, stage: Stage, kind: FacetKind, limit = 50): Promise<{ value: string; n: number }[]> {
  return (must(await supabase.rpc('facet_counts', { p_project_id: projectId, p_stage: stage, p_kind: kind, p_limit: limit })) ?? []) as { value: string; n: number }[];
}

/** Every active record in a stage with its text and final decision, for the relevance model. */
export async function relevanceDocs(projectId: string, stage: Stage): Promise<{ id: string; title: string | null; abstract: string | null; keywords: string | null; decision: Decision | null }[]> {
  const col = decisionColumn(stage);
  const out: { id: string; title: string | null; abstract: string | null; keywords: string | null; decision: Decision | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let qb = supabase.from('study_references').select(`id,title,abstract,keywords,${col}`).eq('project_id', projectId).not('duplicate_status', 'in', '(duplicate,merged)');
    if (stage === 'full_text') qb = qb.eq('title_abstract_decision', 'include');
    const rows = must(await qb.order('seq').range(from, from + 999)) as unknown as Record<string, string | null>[];
    out.push(...rows.map((r) => ({ id: r.id!, title: r.title, abstract: r.abstract, keywords: r.keywords, decision: r[col] as Decision | null })));
    if (rows.length < 1000) return out;
  }
}
export async function saveRelevance(projectId: string, stage: Stage, scores: Map<string, number>): Promise<void> {
  const entries = [...scores].map(([id, p]) => [id, Math.round(p * 10000) / 10000] as const);
  for (let i = 0; i < entries.length; i += 2000) {
    must(await supabase.rpc('set_relevance', { p_project_id: projectId, p_stage: stage, p_scores: Object.fromEntries(entries.slice(i, i + 2000)) }));
  }
}

export interface SimilarRef { id: string; seq: number; title: string | null; authors: string | null; year: number | null; title_abstract_decision: Decision | null; full_text_decision: Decision | null; score: number }
export async function similarReferences(referenceId: string, limit = 8): Promise<SimilarRef[]> {
  return (must(await supabase.rpc('similar_references', { p_reference_id: referenceId, p_limit: limit })) ?? []) as SimilarRef[];
}
