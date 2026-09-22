import { supabase } from '../supabase';
import { must } from '../errors';
import type { ExclusionReason, Tag } from '../types';
import { logActivity } from './projects';

export const TAG_COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'violet'] as const;

export async function listTags(projectId: string): Promise<Tag[]> {
  return must(await supabase.from('tags').select('*').eq('project_id', projectId).order('name')) as Tag[];
}

export async function createTag(projectId: string, name: string, color = 'slate'): Promise<Tag> {
  const tag = must(await supabase.from('tags').insert({ project_id: projectId, name: name.trim(), color }).select('*').single()) as Tag;
  await logActivity(projectId, 'tags', `Created tag "${tag.name}"`);
  return tag;
}

export async function updateTag(tag: Tag, patch: Partial<Pick<Tag, 'name' | 'color'>>): Promise<Tag> {
  const t = must(await supabase.from('tags').update(patch).eq('id', tag.id).select('*').single()) as Tag;
  if (patch.name && patch.name !== tag.name) await logActivity(tag.project_id, 'tags', `Renamed tag "${tag.name}" to "${t.name}"`);
  return t;
}

export async function deleteTag(tag: Tag): Promise<void> {
  must(await supabase.from('tags').delete().eq('id', tag.id));
  await logActivity(tag.project_id, 'tags', `Deleted tag "${tag.name}"`);
}

export async function addTagToReference(projectId: string, referenceId: string, tag: Tag, refTitle?: string | null) {
  const { error } = await supabase.from('reference_tags').insert({ project_id: projectId, reference_id: referenceId, tag_id: tag.id });
  if (error && error.code !== '23505') throw error;
  await logActivity(projectId, 'tags', `Added tag "${tag.name}"`, { title: refTitle ?? null }, referenceId);
}

export async function removeTagFromReference(projectId: string, referenceId: string, tag: Tag, refTitle?: string | null) {
  must(await supabase.from('reference_tags').delete().eq('reference_id', referenceId).eq('tag_id', tag.id));
  await logActivity(projectId, 'tags', `Removed tag "${tag.name}"`, { title: refTitle ?? null }, referenceId);
}

export async function listReasons(projectId: string): Promise<ExclusionReason[]> {
  return must(await supabase.from('exclusion_reasons').select('*').eq('project_id', projectId)
    .order('sort_order').order('created_at')) as ExclusionReason[];
}

export async function createReason(projectId: string, label: string, sortOrder: number): Promise<ExclusionReason> {
  const r = must(await supabase.from('exclusion_reasons').insert({ project_id: projectId, label: label.trim(), sort_order: sortOrder })
    .select('*').single()) as ExclusionReason;
  await logActivity(projectId, 'settings', `Added exclusion reason "${r.label}"`);
  return r;
}

export async function updateReason(id: string, patch: Partial<ExclusionReason>): Promise<ExclusionReason> {
  return must(await supabase.from('exclusion_reasons').update(patch).eq('id', id).select('*').single()) as ExclusionReason;
}

export async function deleteReason(r: ExclusionReason): Promise<void> {
  must(await supabase.from('exclusion_reasons').delete().eq('id', r.id));
  await logActivity(r.project_id, 'settings', `Deleted exclusion reason "${r.label}" (existing decisions keep their reason text)`);
}
