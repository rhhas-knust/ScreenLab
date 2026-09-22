import { supabase } from '../supabase';
import { must } from '../errors';
import { normDoi, normTitle } from '../normalize';
import type { ParsedRecord } from '../import/parsers';
import { rayyanNotesText } from '../import/rayyan';
import type { ExclusionReason, Tag } from '../types';
import { logActivity } from './projects';

export const IMPORT_CHUNK = 500;

/** Import preview: which records (by index) already exist in the project. */
export async function checkExistingMatches(projectId: string, records: ParsedRecord[], onProgress?: (d: number, t: number) => void) {
  const matches = new Map<number, string>();
  const size = 1000;
  for (let i = 0; i < records.length; i += size) {
    const items = records.slice(i, i + size).map((r, k) => ({
      i: i + k,
      doi: normDoi(r.doi) ?? '',
      pmid: r.pmid?.trim() ?? '',
      title_norm: (normTitle(r.title)?.length ?? 0) >= 10 ? normTitle(r.title) : '',
      year: r.year ?? '',
    }));
    const rows = must(await supabase.rpc('preview_existing_matches', { p_project_id: projectId, p_items: items })) as { idx: number; match_type: string }[];
    for (const r of rows ?? []) matches.set(r.idx, r.match_type);
    onProgress?.(Math.min(i + size, records.length), records.length);
  }
  return matches;
}

export interface ImportOptions {
  projectId: string;
  fileName: string;
  format: string;
  databaseSource: string;
  /** If true, the chosen source overrides any source found in the file. */
  overrideSource: boolean;
  records: ParsedRecord[];
  /** Carry over screening decisions, exclusion reasons, labels (as tags) and notes exported by Rayyan. */
  importRayyan?: boolean;
  /** Continue a previously interrupted import */
  resume?: { batchId: string; startIndex: number; insertedIds: string[] };
  onProgress?: (done: number, total: number) => void;
}

export interface ImportOutcome {
  batchId: string;
  insertedIds: string[];
  /** Index of the first record NOT imported (== records.length when complete) */
  nextIndex: number;
  error: unknown | null;
}

/**
 * Make sure every Rayyan label exists as a tag and every Rayyan exclusion
 * reason exists in the project's reason list (matched case-insensitively).
 */
async function prepareRayyan(projectId: string, records: ParsedRecord[]) {
  const labels = new Map<string, string>();
  const reasons = new Map<string, string>();
  for (const r of records) {
    for (const l of r.rayyan?.labels ?? []) labels.set(l.toLowerCase(), l);
    for (const x of r.rayyan?.reasons ?? []) reasons.set(x.toLowerCase(), x);
  }
  const tags = must(await supabase.from('tags').select('*').eq('project_id', projectId)) as Tag[];
  const tagIds = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const newTags = [...labels].filter(([k]) => !tagIds.has(k)).map(([, name]) => ({ project_id: projectId, name: name.slice(0, 80) }));
  if (newTags.length) {
    const created = must(await supabase.from('tags').insert(newTags).select('*')) as Tag[];
    for (const t of created) tagIds.set(t.name.toLowerCase(), t.id);
  }
  const existing = must(await supabase.from('exclusion_reasons').select('*').eq('project_id', projectId)) as ExclusionReason[];
  const reasonLabel = new Map(existing.map((r) => [r.label.toLowerCase(), r.label]));
  let order = Math.max(0, ...existing.map((r) => r.sort_order));
  const newReasons = [...reasons].filter(([k]) => !reasonLabel.has(k)).map(([, label]) => {
    const pretty = label.charAt(0).toUpperCase() + label.slice(1);
    reasonLabel.set(label.toLowerCase(), pretty);
    return { project_id: projectId, label: pretty.slice(0, 200), sort_order: ++order };
  });
  if (newReasons.length) must(await supabase.from('exclusion_reasons').insert(newReasons));
  return { tagIds, reasonLabel };
}

/** Insert records in chunks. On failure, returns how far it got so the rest can be retried. */
export async function importRecords(opts: ImportOptions): Promise<ImportOutcome> {
  const { projectId, records } = opts;
  let batchId = opts.resume?.batchId;
  if (!batchId) {
    const batch = must(await supabase.from('import_batches').insert({
      project_id: projectId,
      file_name: opts.fileName,
      file_format: opts.format,
      database_source: opts.databaseSource || null,
      records_detected: records.length,
      records_imported: 0,
    }).select('id').single()) as { id: string };
    batchId = batch.id;
  }
  const inserted = [...(opts.resume?.insertedIds ?? [])];
  const hasRayyan = !!opts.importRayyan && records.some((r) => r.rayyan);
  const rayyan = hasRayyan ? await prepareRayyan(projectId, records) : null;
  const me = hasRayyan ? (await supabase.auth.getUser()).data.user?.id ?? null : null;
  let i = opts.resume?.startIndex ?? 0;
  let error: unknown = null;
  for (; i < records.length; i += IMPORT_CHUNK) {
    const slice = records.slice(i, i + IMPORT_CHUNK);
    const now = new Date().toISOString();
    const rows = slice.map((r) => {
      const ry = opts.importRayyan && r.rayyan ? r.rayyan : null;
      const decision = ry?.decision ?? null;
      const reason = decision === 'exclude' && ry!.reasons.length
        ? ry!.reasons.map((x) => rayyan!.reasonLabel.get(x.toLowerCase()) ?? x).join('; ')
        : null;
      return {
        id: crypto.randomUUID(),
        project_id: projectId,
        import_batch_id: batchId,
        title: r.title, authors: r.authors, abstract: r.abstract, year: r.year, journal: r.journal,
        volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, pmid: r.pmid, url: r.url,
        keywords: r.keywords, publication_type: r.publication_type,
        database_source: opts.overrideSource || !r.database_source ? (opts.databaseSource || r.database_source) : r.database_source,
        language: r.language,
        original_record: { ...r.original, __file: opts.fileName, __record_no: r.recordNo },
        ...(ry ? {
          title_abstract_decision: decision,
          title_abstract_exclusion_reason: reason,
          title_abstract_screened_at: decision ? now : null,
          notes: rayyanNotesText(ry),
        } : {}),
      };
    });
    const chunk = rows;
    const res = await supabase.from('study_references').insert(chunk).select('id');
    if (res.error) {
      error = res.error;
      break;
    }
    inserted.push(...(res.data as { id: string }[]).map((x) => x.id));
    if (rayyan) {
      const err = await writeRayyanExtras(projectId, slice, rows, rayyan.tagIds, me);
      if (err) {
        error = err;
        i += IMPORT_CHUNK;
        break;
      }
    }
    opts.onProgress?.(Math.min(i + IMPORT_CHUNK, records.length), records.length);
    // Yield to keep the UI responsive
    await new Promise((r) => setTimeout(r, 0));
  }
  await supabase.from('import_batches').update({ records_imported: inserted.length }).eq('id', batchId);
  if (!error || inserted.length > (opts.resume?.insertedIds.length ?? 0)) {
    await logActivity(projectId, 'import',
      `Imported ${inserted.length.toLocaleString()} references from ${opts.fileName}${opts.databaseSource ? ` (${opts.databaseSource})` : ''}${rayyan ? ' with Rayyan screening decisions' : ''}`,
      { batch_id: batchId, file: opts.fileName, format: opts.format, detected: records.length, imported: inserted.length, complete: !error });
  }
  return { batchId, insertedIds: inserted, nextIndex: Math.min(i, records.length), error };
}

/**
 * For a chunk of just-inserted Rayyan records: write the audit-history rows
 * (action "restore" = decision carried over from another tool), the
 * reviewer's current decision, and the label tags.
 */
async function writeRayyanExtras(
  projectId: string,
  slice: ParsedRecord[],
  rows: { id: string; title_abstract_decision?: string | null; title_abstract_exclusion_reason?: string | null }[],
  tagIds: Map<string, string>,
  me: string | null,
): Promise<unknown | null> {
  const decided = rows.filter((r) => r.title_abstract_decision);
  if (decided.length && me) {
    const h = await supabase.from('screening_decisions').insert(decided.map((r) => ({
      project_id: projectId, reference_id: r.id, reviewer_id: me, stage: 'title_abstract',
      decision: r.title_abstract_decision, exclusion_reason: r.title_abstract_exclusion_reason ?? null,
      previous_decision: null, action: 'restore',
    })));
    if (h.error) return h.error;
    const rd = await supabase.from('reviewer_decisions').insert(decided.map((r) => ({
      project_id: projectId, reference_id: r.id, reviewer_id: me, stage: 'title_abstract',
      decision: r.title_abstract_decision, exclusion_reason: r.title_abstract_exclusion_reason ?? null,
    })));
    if (rd.error) return rd.error;
  }
  const links: { project_id: string; reference_id: string; tag_id: string }[] = [];
  slice.forEach((rec, k) => {
    for (const l of rec.rayyan?.labels ?? []) {
      const tagId = tagIds.get(l.toLowerCase());
      if (tagId) links.push({ project_id: projectId, reference_id: rows[k].id, tag_id: tagId });
    }
  });
  if (links.length) {
    const t = await supabase.from('reference_tags').insert(links);
    if (t.error) return t.error;
  }
  return null;
}
