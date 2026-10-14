// Review team and data extraction (blinded double extraction + final consensus).
import { supabase } from '../supabase';
import { must } from '../errors';
import { saveSettingsKey } from './methods';
import type { ExtractionData, ExtractionForm } from '../extraction/form';

export interface TeamMember { user_id: string; email: string; role: 'owner' | 'reviewer' | 'viewer'; added_at: string }
export interface ProgressRow {
  reference_id: string; seq: number; title: string | null; authors: string | null; year: number | null; journal: string | null;
  my_status: 'draft' | 'complete' | null; complete_count: number; started_count: number; has_final: boolean; final_tier: string | null;
}
export interface Extraction {
  id: string; project_id: string; reference_id: string; reviewer_id: string;
  data: ExtractionData; status: 'draft' | 'complete'; created_at: string; updated_at: string;
}
export interface FinalExtraction { reference_id: string; project_id: string; data: ExtractionData; finalised_by: string | null; updated_at: string }

export const xk = {
  team: (id: string) => ['team', id] as const,
  progress: (id: string) => ['extraction', 'progress', id] as const,
  reference: (refId: string) => ['extraction', 'ref', refId] as const,
  all: (id: string) => ['extraction', 'all', id] as const,
};

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

export async function listTeam(projectId: string): Promise<TeamMember[]> {
  return (must(await supabase.rpc('project_team', { p_project_id: projectId })) ?? []) as TeamMember[];
}
export async function addMember(projectId: string, email: string): Promise<void> {
  must(await supabase.rpc('add_project_member', { p_project_id: projectId, p_email: email.trim(), p_role: 'reviewer' }));
}
export async function removeMember(projectId: string, userId: string): Promise<void> {
  must(await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId));
}

export const saveForm = (projectId: string, form: ExtractionForm) => saveSettingsKey(projectId, 'extraction_form', form);

export async function getProgress(projectId: string): Promise<ProgressRow[]> {
  return (must(await supabase.rpc('extraction_progress', { p_project_id: projectId })) ?? []) as ProgressRow[];
}

/** Extractions of one study that the caller may see (blinding is enforced by the database). */
export async function getForReference(referenceId: string): Promise<{ mine: Extraction | null; others: Extraction[]; final: FinalExtraction | null; me: string }> {
  const me = await myId();
  const rows = must(await supabase.from('extractions').select('*').eq('reference_id', referenceId).order('created_at')) as Extraction[];
  const final = must(await supabase.from('extraction_final').select('*').eq('reference_id', referenceId).maybeSingle()) as FinalExtraction | null;
  return { mine: rows.find((r) => r.reviewer_id === me) ?? null, others: rows.filter((r) => r.reviewer_id !== me), final, me };
}

export async function saveExtraction(projectId: string, referenceId: string, data: ExtractionData, status: 'draft' | 'complete'): Promise<Extraction> {
  const reviewer_id = await myId();
  return must(await supabase.from('extractions')
    .upsert({ project_id: projectId, reference_id: referenceId, reviewer_id, data, status }, { onConflict: 'reference_id,reviewer_id' })
    .select('*').single()) as Extraction;
}

export async function saveFinal(projectId: string, referenceId: string, data: ExtractionData): Promise<void> {
  const finalised_by = await myId();
  must(await supabase.from('extraction_final')
    .upsert({ project_id: projectId, reference_id: referenceId, data, finalised_by }, { onConflict: 'reference_id' }).select('reference_id'));
}
export async function deleteFinal(referenceId: string): Promise<void> {
  must(await supabase.from('extraction_final').delete().eq('reference_id', referenceId));
}

/** Everything the caller may see in the project: visible extractions, finals and study details. */
export async function getAll(projectId: string) {
  const extractions = must(await supabase.from('extractions').select('*').eq('project_id', projectId).order('created_at')) as Extraction[];
  const finals = must(await supabase.from('extraction_final').select('*').eq('project_id', projectId)) as FinalExtraction[];
  return { extractions, finals };
}

export async function studyDetails(ids: string[]) {
  const out: { id: string; seq: number; title: string | null; authors: string | null; year: number | null; journal: string | null; doi: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(must(await supabase.from('study_references').select('id, seq, title, authors, year, journal, doi')
      .in('id', ids.slice(i, i + 200))) as typeof out));
  }
  return out;
}
