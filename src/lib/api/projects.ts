import { supabase } from '../supabase';
import { must } from '../errors';
import type { Facets, Project, ProjectOverview, ProjectSettings, ProjectStats } from '../types';

export type ProjectInput = Partial<Omit<Project, 'id' | 'owner_id' | 'created_at' | 'updated_at'>> & { title: string };

export async function listProjectsOverview(): Promise<ProjectOverview[]> {
  const data = must(await supabase.rpc('my_projects_overview'));
  return (data ?? []) as ProjectOverview[];
}

export async function getProject(id: string): Promise<Project> {
  return must(await supabase.from('projects').select('*').eq('id', id).single()) as Project;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const project = must(await supabase.from('projects').insert(input).select('*').single()) as Project;
  await logActivity(project.id, 'project', `Created review "${project.title}"`);
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const project = must(await supabase.from('projects').update(patch).eq('id', id).select('*').single()) as Project;
  await logActivity(id, 'project', 'Updated review details');
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  // Remove stored PDFs first (storage objects are not deleted by the database cascade).
  const { data: files } = await supabase.from('full_text_files').select('storage_path').eq('project_id', id);
  if (files && files.length) {
    const paths = files.map((f) => f.storage_path as string);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from('full-texts').remove(paths.slice(i, i + 100));
    }
  }
  const res = await supabase.from('projects').delete().eq('id', id).select('id');
  const rows = must(res);
  if (!rows || rows.length === 0) throw { code: '42501', message: 'Project not found or not yours' };
}

export async function getSettings(projectId: string): Promise<ProjectSettings> {
  return must(await supabase.from('project_settings').select('*').eq('project_id', projectId).single()) as ProjectSettings;
}

export async function updateSettings(projectId: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings> {
  return must(await supabase.from('project_settings').update(patch).eq('project_id', projectId).select('*').single()) as ProjectSettings;
}

export async function getStats(projectId: string): Promise<ProjectStats> {
  return must(await supabase.rpc('project_stats', { p_project_id: projectId })) as ProjectStats;
}

export async function getFacets(projectId: string): Promise<Facets> {
  return must(await supabase.rpc('project_facets', { p_project_id: projectId })) as Facets;
}

export async function logActivity(
  projectId: string,
  action: string,
  message: string,
  details?: Record<string, unknown>,
  referenceId?: string | null,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  // Activity logging must never block the user's work; failures are reported in the console only.
  const { error } = await supabase.from('activity_logs').insert({
    project_id: projectId,
    action,
    message,
    details: details ?? null,
    reference_id: referenceId ?? null,
    user_id: u.user?.id,
  });
  if (error) console.warn('Activity log failed', error);
}
