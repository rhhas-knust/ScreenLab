import { supabase } from '../supabase';
import { must } from '../errors';
import type { Project, ProjectSettings, Reference } from '../types';
import { fetchAllReferences } from './references';
import { logActivity } from './projects';

export const BACKUP_FORMAT = 'screenlab-backup';
export const BACKUP_VERSION = 1;

type Row = Record<string, unknown>;

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: string;
  exported_at: string;
  notice: string;
  project: Project;
  settings: ProjectSettings | null;
  exclusion_reasons: Row[];
  tags: Row[];
  import_batches: Row[];
  duplicate_groups: Row[];
  references: Row[];
  reference_tags: Row[];
  screening_decisions: Row[];
  reviewer_decisions: Row[];
  activity_logs: Row[];
  full_text_files: Row[];
  counts: Record<string, number>;
}

async function fetchAll(table: string, projectId: string, order: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await supabase.from(table).select('*').eq('project_id', projectId)
      .order(order, { ascending: true }).range(from, from + 999)) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function buildBackup(projectId: string, onProgress?: (msg: string) => void): Promise<ProjectBackup> {
  onProgress?.('Reading project…');
  const project = must(await supabase.from('projects').select('*').eq('id', projectId).single()) as Project;
  const settings = (await supabase.from('project_settings').select('*').eq('project_id', projectId).maybeSingle()).data as ProjectSettings | null;
  onProgress?.('Reading references…');
  const refs = await fetchAllReferences(projectId, (n) => onProgress?.(`Reading references… ${n.toLocaleString()}`));
  const references = refs.map((r) => {
    const { search_text: _a, title_norm: _b, doi_norm: _c, ...rest } = r as Reference & Row;
    void _a; void _b; void _c;
    return rest as Row;
  });
  onProgress?.('Reading screening history…');
  const [exclusion_reasons, tags, import_batches, duplicate_groups, reference_tags, screening_decisions, reviewer_decisions, activity_logs, full_text_files] =
    await Promise.all([
      fetchAll('exclusion_reasons', projectId, 'sort_order'),
      fetchAll('tags', projectId, 'created_at'),
      fetchAll('import_batches', projectId, 'created_at'),
      fetchAll('duplicate_groups', projectId, 'created_at'),
      fetchAll('reference_tags', projectId, 'created_at'),
      fetchAll('screening_decisions', projectId, 'created_at'),
      fetchAll('reviewer_decisions', projectId, 'updated_at'),
      fetchAll('activity_logs', projectId, 'created_at'),
      fetchAll('full_text_files', projectId, 'uploaded_at'),
    ]);
  const backup: ProjectBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'ScreenLab',
    exported_at: new Date().toISOString(),
    notice: 'Complete ScreenLab project backup. Your research data belongs to you. Uploaded PDF files are not included (only their file names).',
    project, settings, exclusion_reasons, tags, import_batches, duplicate_groups, references, reference_tags,
    screening_decisions, reviewer_decisions, activity_logs, full_text_files,
    counts: {
      references: references.length, screening_decisions: screening_decisions.length, tags: tags.length,
      activity_logs: activity_logs.length, duplicate_groups: duplicate_groups.length,
    },
  };
  await logActivity(projectId, 'backup', `Exported complete project backup (${references.length.toLocaleString()} references)`);
  return backup;
}

export class BackupError extends Error {}

/** Validate a parsed backup file and return a list of problems (empty = valid). */
export function validateBackup(data: unknown): { ok: true; backup: ProjectBackup } | { ok: false; error: string } {
  if (!data || typeof data !== 'object') return { ok: false, error: 'This file is not a ScreenLab backup (not a JSON object).' };
  const b = data as Partial<ProjectBackup>;
  if (b.format !== BACKUP_FORMAT) return { ok: false, error: 'This JSON file is not a ScreenLab project backup (missing "format": "screenlab-backup").' };
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) return { ok: false, error: `Unsupported backup version (${String(b.version)}). Please update ScreenLab.` };
  if (!b.project || typeof b.project !== 'object' || !b.project.title) return { ok: false, error: 'The backup is corrupted: project details are missing.' };
  if (!Array.isArray(b.references)) return { ok: false, error: 'The backup is corrupted: the reference list is missing.' };
  for (const [i, r] of b.references.entries()) {
    if (!r || typeof r !== 'object' || typeof (r as Row).id !== 'string') {
      return { ok: false, error: `The backup is corrupted: reference #${i + 1} has no ID.` };
    }
  }
  const arrays: (keyof ProjectBackup)[] = ['exclusion_reasons', 'tags', 'import_batches', 'duplicate_groups', 'reference_tags',
    'screening_decisions', 'reviewer_decisions', 'activity_logs', 'full_text_files'];
  for (const k of arrays) {
    if (b[k] != null && !Array.isArray(b[k])) return { ok: false, error: `The backup is corrupted: "${k}" is not a list.` };
  }
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  return {
    ok: true,
    backup: {
      ...(b as ProjectBackup),
      exclusion_reasons: arr(b.exclusion_reasons), tags: arr(b.tags), import_batches: arr(b.import_batches),
      duplicate_groups: arr(b.duplicate_groups), reference_tags: arr(b.reference_tags),
      screening_decisions: arr(b.screening_decisions), reviewer_decisions: arr(b.reviewer_decisions),
      activity_logs: arr(b.activity_logs), full_text_files: arr(b.full_text_files),
      settings: b.settings ?? null, counts: b.counts ?? {},
    },
  };
}

const newId = () => crypto.randomUUID();

async function insertChunks(table: string, rows: Row[], onProgress?: (n: number) => void, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    must(await supabase.from(table).insert(rows.slice(i, i + size)));
    onProgress?.(Math.min(i + size, rows.length));
  }
}

const REF_COLUMNS = [
  'title', 'authors', 'abstract', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url', 'keywords',
  'publication_type', 'database_source', 'language', 'original_record', 'imported_at', 'title_abstract_decision',
  'title_abstract_screened_at', 'title_abstract_exclusion_reason', 'full_text_decision', 'full_text_screened_at',
  'full_text_exclusion_reason', 'notes', 'tag_names', 'full_text_url', 'full_text_status', 'duplicate_status', 'created_at',
];

const PROJECT_COLUMNS: (keyof Project)[] = [
  'description', 'research_question', 'review_type', 'inclusion_criteria', 'exclusion_criteria', 'population',
  'intervention_or_exposure', 'comparator', 'outcomes', 'study_design', 'date_range', 'language', 'start_date', 'is_demo',
];

function pick(r: Row, cols: string[]): Row {
  const o: Row = {};
  for (const c of cols) if (r[c] !== undefined) o[c] = r[c];
  return o;
}

/**
 * Restore a backup into a NEW project (existing projects are never overwritten).
 * All IDs are re-generated. If anything fails, the partially restored project
 * is deleted so no half-restored data is left behind.
 */
export async function restoreBackup(backup: ProjectBackup, title: string, onProgress?: (msg: string) => void): Promise<Project> {
  const { data: u } = await supabase.auth.getUser();
  const me = u.user?.id;
  if (!me) throw new BackupError('You must be signed in to restore a backup.');

  onProgress?.('Creating project…');
  const projectRow: Row = { title, ...pick(backup.project as unknown as Row, PROJECT_COLUMNS as string[]) };
  const project = must(await supabase.from('projects').insert(projectRow).select('*').single()) as Project;
  const pid = project.id;

  try {
    if (backup.settings) {
      must(await supabase.from('project_settings').update(pick(backup.settings as unknown as Row,
        ['stage2_enabled', 'keyboard_shortcuts_enabled', 'screening_mode', 'additional_records_other_sources', 'prisma_notes', 'settings']))
        .eq('project_id', pid));
    }
    if (backup.exclusion_reasons.length) {
      must(await supabase.from('exclusion_reasons').delete().eq('project_id', pid));
      await insertChunks('exclusion_reasons', backup.exclusion_reasons.map((r) => ({
        project_id: pid, ...pick(r, ['label', 'stage', 'sort_order', 'is_active', 'created_at']),
      })));
    }

    const tagMap = new Map<string, string>();
    await insertChunks('tags', backup.tags.map((t) => {
      const id = newId();
      tagMap.set(String(t.id), id);
      return { id, project_id: pid, ...pick(t, ['name', 'color', 'created_at']) };
    }));

    const batchMap = new Map<string, string>();
    await insertChunks('import_batches', backup.import_batches.map((b) => {
      const id = newId();
      batchMap.set(String(b.id), id);
      return { id, project_id: pid, imported_by: me, ...pick(b, ['file_name', 'file_format', 'database_source', 'records_detected', 'records_imported', 'created_at']) };
    }));

    const refMap = new Map<string, string>();
    for (const r of backup.references) refMap.set(String(r.id), newId());
    const groupMap = new Map<string, string>();
    for (const g of backup.duplicate_groups) groupMap.set(String(g.id), newId());

    const remapSnapshot = (details: unknown): unknown => {
      if (!details || typeof details !== 'object') return details ?? null;
      const d = details as { before?: Row[] };
      if (!Array.isArray(d.before)) return details;
      return {
        ...d,
        before: d.before.map((m) => ({
          ...m,
          id: refMap.get(String(m.id)) ?? m.id,
          project_id: pid,
          merged_into_id: m.merged_into_id ? refMap.get(String(m.merged_into_id)) ?? null : null,
          duplicate_group_id: m.duplicate_group_id ? groupMap.get(String(m.duplicate_group_id)) ?? null : null,
        })),
      };
    };

    onProgress?.('Restoring duplicate groups…');
    await insertChunks('duplicate_groups', backup.duplicate_groups.map((g) => ({
      id: groupMap.get(String(g.id)), project_id: pid,
      ...pick(g, ['match_type', 'match_score', 'status', 'resolution', 'created_at', 'resolved_at']),
      resolution_details: remapSnapshot(g.resolution_details),
    })));

    const total = backup.references.length;
    const sorted = [...backup.references].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    await insertChunks('study_references', sorted.map((r) => ({
      id: refMap.get(String(r.id)),
      project_id: pid,
      import_batch_id: r.import_batch_id ? batchMap.get(String(r.import_batch_id)) ?? null : null,
      duplicate_group_id: r.duplicate_group_id ? groupMap.get(String(r.duplicate_group_id)) ?? null : null,
      ...pick(r, REF_COLUMNS),
      tag_names: Array.isArray(r.tag_names) ? r.tag_names : [],
    })), (n) => onProgress?.(`Restoring references… ${n.toLocaleString()} / ${total.toLocaleString()}`));

    // Self-references (merged_into) and group primaries, after all rows exist
    const merged = backup.references.filter((r) => r.merged_into_id && refMap.has(String(r.merged_into_id)));
    for (const r of merged) {
      must(await supabase.from('study_references').update({ merged_into_id: refMap.get(String(r.merged_into_id)) }).eq('id', refMap.get(String(r.id))!));
    }
    for (const g of backup.duplicate_groups) {
      if (g.primary_reference_id && refMap.has(String(g.primary_reference_id))) {
        must(await supabase.from('duplicate_groups').update({ primary_reference_id: refMap.get(String(g.primary_reference_id)) })
          .eq('id', groupMap.get(String(g.id))!));
      }
    }

    onProgress?.('Restoring tags on references…');
    await insertChunks('reference_tags', backup.reference_tags
      .filter((rt) => refMap.has(String(rt.reference_id)) && tagMap.has(String(rt.tag_id)))
      .map((rt) => ({ project_id: pid, reference_id: refMap.get(String(rt.reference_id)), tag_id: tagMap.get(String(rt.tag_id)), created_at: rt.created_at })));

    onProgress?.('Restoring screening history…');
    await insertChunks('screening_decisions', backup.screening_decisions
      .filter((d) => refMap.has(String(d.reference_id)))
      .map((d) => ({
        project_id: pid, reference_id: refMap.get(String(d.reference_id)), reviewer_id: me,
        ...pick(d, ['stage', 'decision', 'exclusion_reason', 'previous_decision', 'previous_exclusion_reason', 'action', 'client_created_at', 'created_at']),
      })));
    await insertChunks('reviewer_decisions', backup.reviewer_decisions
      .filter((d) => refMap.has(String(d.reference_id)))
      // single-reviewer V1: collapse to one row per reference+stage for the restoring user
      .filter((d, i, arr) => arr.findIndex((x) => x.reference_id === d.reference_id && x.stage === d.stage) === i)
      .map((d) => ({
        project_id: pid, reference_id: refMap.get(String(d.reference_id)), reviewer_id: me,
        ...pick(d, ['stage', 'decision', 'exclusion_reason', 'updated_at']),
      })));

    onProgress?.('Restoring activity log…');
    await insertChunks('activity_logs', backup.activity_logs.map((a) => ({
      project_id: pid, user_id: me,
      reference_id: a.reference_id ? refMap.get(String(a.reference_id)) ?? null : null,
      ...pick(a, ['user_email', 'action', 'message', 'details', 'created_at']),
    })));

    await logActivity(pid, 'backup',
      `Restored project from backup "${backup.project.title}" exported ${String(backup.exported_at).slice(0, 10)} (${total.toLocaleString()} references)`,
      { exported_at: backup.exported_at, original_project_id: backup.project.id, pdf_files_not_restored: backup.full_text_files.length });
    return project;
  } catch (e) {
    onProgress?.('Restore failed — removing the partially restored project…');
    await supabase.from('projects').delete().eq('id', pid);
    throw e;
  }
}
