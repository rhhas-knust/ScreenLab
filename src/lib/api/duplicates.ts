import { supabase } from '../supabase';
import { must } from '../errors';
import { UnionFind } from '../import/dedupe';
import { BIB_FIELDS, type BibField, type DuplicateGroup, type Reference } from '../types';

interface Pair { a: string; b: string; match_type: string; score: number }

const MATCH_PRIORITY: Record<string, number> = { doi: 1, pmid: 2, title_year: 3, fuzzy_title: 4, manual: 5 };

/**
 * Run duplicate detection for the given references (checked against the whole
 * project) in batches, then group connected pairs. Nothing is deleted: records
 * are only flagged "possible duplicate" for the researcher to review.
 */
export async function detectDuplicates(
  projectId: string, referenceIds: string[], onProgress?: (done: number, total: number) => void, batchSize = 250,
): Promise<{ groups: number; records: number }> {
  const pairs: Pair[] = [];
  for (let i = 0; i < referenceIds.length; i += batchSize) {
    const batch = referenceIds.slice(i, i + batchSize);
    const rows = must(await supabase.rpc('find_duplicate_pairs', { p_project_id: projectId, p_reference_ids: batch, p_threshold: 0.85 })) as Pair[];
    pairs.push(...(rows ?? []));
    onProgress?.(Math.min(i + batchSize, referenceIds.length), referenceIds.length);
  }
  if (!pairs.length) return { groups: 0, records: 0 };
  const uf = new UnionFind<string>();
  const bestType = new Map<string, { type: string; score: number }>();
  for (const p of pairs) uf.union(p.a, p.b);
  for (const p of pairs) {
    const root = uf.find(p.a);
    const cur = bestType.get(root);
    if (!cur || MATCH_PRIORITY[p.match_type] < MATCH_PRIORITY[cur.type]) bestType.set(root, { type: p.match_type, score: p.score });
  }
  const groups = uf.groups().map((ids) => {
    const b = bestType.get(uf.find(ids[0]))!;
    return { ids, match_type: b.type, score: b.score };
  });
  for (let i = 0; i < groups.length; i += 200) {
    must(await supabase.rpc('apply_duplicate_groups', { p_project_id: projectId, p_groups: groups.slice(i, i + 200) }));
  }
  return { groups: groups.length, records: groups.reduce((n, g) => n + g.ids.length, 0) };
}

/** Run detection across the entire project. */
export async function detectAllDuplicates(projectId: string, onProgress?: (done: number, total: number) => void) {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await supabase.from('study_references').select('id').eq('project_id', projectId)
      .not('duplicate_status', 'in', '(duplicate,merged)').order('seq').range(from, from + 999)) as { id: string }[];
    ids.push(...rows.map((r) => r.id));
    if (rows.length < 1000) break;
  }
  return detectDuplicates(projectId, ids, onProgress);
}

export interface GroupWithMembers extends DuplicateGroup {
  members: Reference[];
}

export async function listGroups(projectId: string, status: 'open' | 'resolved', page: number, pageSize: number) {
  const res = await supabase.from('duplicate_groups').select('*', { count: 'exact' }).eq('project_id', projectId)
    .eq('status', status).order(status === 'open' ? 'created_at' : 'resolved_at', { ascending: status === 'open' })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (res.error) throw res.error;
  const groups = (res.data ?? []) as DuplicateGroup[];
  if (!groups.length) return { groups: [] as GroupWithMembers[], count: res.count ?? 0 };
  const members = must(await supabase.from('study_references').select('*').in('duplicate_group_id', groups.map((g) => g.id))
    .order('seq')) as Reference[];
  return {
    groups: groups.map((g) => ({ ...g, members: members.filter((m) => m.duplicate_group_id === g.id) })),
    count: res.count ?? 0,
  };
}

/** Pick the most complete value for each field (longest non-empty text; first non-null year). */
export function mergeMetadata(primary: Reference, others: Reference[]): Partial<Record<BibField, string | number | null>> {
  const merged: Partial<Record<BibField, string | number | null>> = {};
  for (const f of BIB_FIELDS) {
    const pv = primary[f];
    if (f === 'year') {
      if (pv == null) {
        const o = others.find((x) => x.year != null);
        if (o) merged.year = o.year;
      }
      continue;
    }
    const candidates = [pv, ...others.map((o) => o[f])].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (!candidates.length) continue;
    if (f === 'abstract' || f === 'keywords' || f === 'authors') {
      const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a));
      if (longest !== pv) merged[f] = longest;
    } else if (!pv || !String(pv).trim()) {
      merged[f] = candidates[0];
    }
  }
  return merged;
}

/** A reference's metadata completeness score (used to suggest the primary record). */
export function completeness(r: Reference): number {
  let n = 0;
  for (const f of BIB_FIELDS) if (r[f] != null && String(r[f]).trim() !== '') n++;
  return n + (r.abstract ? Math.min(r.abstract.length / 500, 3) : 0);
}

export async function resolveGroup(groupId: string, action: 'keep_all' | 'mark' | 'merge', primaryId?: string, merged?: Record<string, unknown>) {
  must(await supabase.rpc('resolve_duplicate_group', {
    p_group_id: groupId, p_action: action, p_primary_id: primaryId ?? null, p_merged: merged ?? null,
  }));
}

export async function reopenGroup(groupId: string) {
  must(await supabase.rpc('reopen_duplicate_group', { p_group_id: groupId }));
}
