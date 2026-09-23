import { supabase } from '../supabase';
import { must } from '../errors';
import type { Decision, Reference, ReferenceListItem, Stage } from '../types';
import { PICO_KEYS, PICO_LABELS, activePico, type CriteriaTerms, type PicoKey } from '../criteria';

export type StatusFilter = 'all' | 'unscreened' | 'screened' | 'include' | 'exclude' | 'maybe';
export type DupFilter = 'active' | 'all' | 'none' | 'possible' | 'duplicate' | 'kept' | 'merged';
export type SortKey = 'seq' | 'title' | 'year' | 'authors' | 'status' | 'screened_at' | 'database_source';

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
  /** The project's criteria keywords (not stored in the URL; supplied by the page). */
  terms?: CriteriaTerms;
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
  dup: 'active', ftStatus: '', reason: '', kw: '', pico: '',
};
export const DEFAULT_SORT: RefSort = { key: 'seq', dir: 'asc' };

export const SORT_LABELS: Record<SortKey, string> = {
  seq: 'Import order', title: 'Title', year: 'Year', authors: 'Author', status: 'Screening status',
  screened_at: 'Date screened', database_source: 'Database',
};

export const LIST_COLUMNS =
  'id,seq,title,authors,year,journal,database_source,title_abstract_decision,title_abstract_exclusion_reason,' +
  'title_abstract_screened_at,full_text_decision,full_text_exclusion_reason,full_text_screened_at,duplicate_status,tag_names,full_text_status';

export function decisionColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_decision' : 'full_text_decision';
}
export function reasonColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_exclusion_reason' : 'full_text_exclusion_reason';
}
export function screenedAtColumn(stage: Stage) {
  return stage === 'title_abstract' ? 'title_abstract_screened_at' : 'full_text_screened_at';
}

export function sortColumn(key: SortKey, stage: Stage): string {
  switch (key) {
    case 'status': return decisionColumn(stage);
    case 'screened_at': return screenedAtColumn(stage);
    default: return key;
  }
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
  const dcol = decisionColumn(stage);

  if (f.dup === 'active') qb = qb.not('duplicate_status', 'in', '(duplicate,merged)');
  else if (f.dup !== 'all') qb = qb.eq('duplicate_status', f.dup);

  if (stage === 'full_text') qb = qb.eq('title_abstract_decision', 'include');

  switch (f.status) {
    case 'unscreened': qb = qb.is(dcol, null); break;
    case 'screened': qb = qb.not(dcol, 'is', null); break;
    case 'include': case 'exclude': case 'maybe': qb = qb.eq(dcol, f.status); break;
  }

  const terms = f.q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
  for (const t of terms) qb = qb.ilike('search_text', `%${escapeLike(t)}%`);

  if (f.source) qb = f.source === '__none__' ? qb.is('database_source', null) : qb.eq('database_source', f.source);
  const yf = parseInt(f.yearFrom, 10);
  const yt = parseInt(f.yearTo, 10);
  if (!Number.isNaN(yf)) qb = qb.gte('year', yf);
  if (!Number.isNaN(yt)) qb = qb.lte('year', yt);
  if (f.pubType) qb = qb.eq('publication_type', f.pubType);
  if (f.language) qb = qb.eq('language', f.language);
  if (f.tags.length) qb = qb.contains('tag_names', f.tags);
  if (f.ftStatus) qb = qb.eq('full_text_status', f.ftStatus);
  if (f.reason) qb = qb.eq(reasonColumn(stage), f.reason);
  if (f.kw && f.terms) qb = applyKeywordFilter(qb, f.kw, f.terms);
  if (f.pico && f.terms) qb = applyPicoFilter(qb, f.pico, f.terms);
  return qb;
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
  let qb = supabase.from('study_references').select(LIST_COLUMNS + extraColumns, { count: 'exact' });
  qb = applyFilters(qb, projectId, stage, filters);
  qb = applyOrder(qb, stage, sort);
  const from = page * pageSize;
  const res = await qb.range(from, from + pageSize - 1);
  if (res.error) throw res.error;
  return { rows: (res.data ?? []) as unknown as ReferenceListItem[], count: res.count ?? 0 };
}

export async function getReference(id: string): Promise<Reference> {
  return must(await supabase.from('study_references').select('*').eq('id', id).single()) as Reference;
}

/** Next / previous reference in the current list order (any status). */
export async function neighbor(
  projectId: string, stage: Stage, filters: RefFilters, sort: RefSort, cur: Reference, direction: 'next' | 'prev',
): Promise<Reference | null> {
  let qb = supabase.from('study_references').select('*');
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
    let qb = supabase.from('study_references').select('*');
    qb = applyFilters(qb, projectId, stage, f);
    qb = applyKeyset(qb, stage, sort, after as unknown as Reference & Record<string, unknown>, 'next');
    qb = applyOrder(qb, stage, sort);
    rows = must(await qb.limit(limit)) as Reference[];
  }
  if (rows.length < limit) {
    let qb = supabase.from('study_references').select('*');
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
  referenceId: string; stage: Stage; decision: string | null; reason: string | null; action: 'decide' | 'undo'; clientTs: string;
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
  const col = decisionColumn(stage);
  const out: { id: string; decision: Decision | null; title: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let qb = supabase.from('study_references').select(`id,title,${col}`);
    qb = applyFilters(qb, projectId, stage, filters);
    qb = applyOrder(qb, stage, sort);
    const rows = must(await qb.range(from, from + 999)) as Record<string, unknown>[];
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
