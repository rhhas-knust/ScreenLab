import { supabase } from '../supabase';
import { must } from '../errors';
import { normDoi, normTitle } from '../normalize';
import type { ParsedRecord } from '../import/parsers';
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
  let i = opts.resume?.startIndex ?? 0;
  let error: unknown = null;
  for (; i < records.length; i += IMPORT_CHUNK) {
    const chunk = records.slice(i, i + IMPORT_CHUNK).map((r) => ({
      project_id: projectId,
      import_batch_id: batchId,
      title: r.title, authors: r.authors, abstract: r.abstract, year: r.year, journal: r.journal,
      volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, pmid: r.pmid, url: r.url,
      keywords: r.keywords, publication_type: r.publication_type,
      database_source: opts.overrideSource || !r.database_source ? (opts.databaseSource || r.database_source) : r.database_source,
      language: r.language,
      original_record: { ...r.original, __file: opts.fileName, __record_no: r.recordNo },
    }));
    const res = await supabase.from('study_references').insert(chunk).select('id');
    if (res.error) {
      error = res.error;
      break;
    }
    inserted.push(...(res.data as { id: string }[]).map((x) => x.id));
    opts.onProgress?.(Math.min(i + IMPORT_CHUNK, records.length), records.length);
    // Yield to keep the UI responsive
    await new Promise((r) => setTimeout(r, 0));
  }
  await supabase.from('import_batches').update({ records_imported: inserted.length }).eq('id', batchId);
  if (!error || inserted.length > (opts.resume?.insertedIds.length ?? 0)) {
    await logActivity(projectId, 'import',
      `Imported ${inserted.length.toLocaleString()} references from ${opts.fileName}${opts.databaseSource ? ` (${opts.databaseSource})` : ''}`,
      { batch_id: batchId, file: opts.fileName, format: opts.format, detected: records.length, imported: inserted.length, complete: !error });
  }
  return { batchId, insertedIds: inserted, nextIndex: Math.min(i, records.length), error };
}
