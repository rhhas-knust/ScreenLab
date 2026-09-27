import Papa from 'papaparse';
import { supabase } from '../supabase';
import { must } from '../errors';

export type FieldType = 'text' | 'textarea' | 'number' | 'email' | 'radio' | 'checkbox' | 'scale';
export type FormStatus = 'draft' | 'active' | 'closed';
export type AnswerValue = string | number | string[];

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'text', label: 'Short answer', hint: 'One line of text' },
  { type: 'textarea', label: 'Paragraph', hint: 'Longer text' },
  { type: 'number', label: 'Number', hint: 'e.g. age, hours per week' },
  { type: 'radio', label: 'Multiple choice', hint: 'Pick one option' },
  { type: 'checkbox', label: 'Checkboxes', hint: 'Pick any number of options' },
  { type: 'scale', label: 'Scale 1–5', hint: 'e.g. strongly disagree → strongly agree' },
  { type: 'email', label: 'Email', hint: 'Validated email address' },
];
export const FIELD_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t.label])) as Record<FieldType, string>;
export const hasOptions = (t: FieldType) => t === 'radio' || t === 'checkbox';

export const UNIVERSITIES = [
  'KNUST', 'University of Ghana', 'University of Cape Coast', 'Ashesi University', 'GIMPA',
  'University for Development Studies', 'Ghana Communication Technology University', 'Central University',
  'Accra Technical University', 'Ho Technical University', 'Other',
];

export interface RhProject {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  university: string | null;
  department: string | null;
  year: string | null;
  thank_you_message: string | null;
  status: FormStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RhProjectSummary {
  id: string;
  title: string;
  status: FormStatus;
  created_at: string;
  updated_at: string;
  field_count: number;
  response_count: number;
  last_response_at: string | null;
}

export interface RhField {
  id: string;
  project_id: string;
  label: string;
  help: string | null;
  type: FieldType;
  options: string[];
  required: boolean;
  field_order: number;
}

export interface RhResponse {
  id: string;
  project_id: string;
  answers: Record<string, AnswerValue>;
  submitted_at: string;
}

export interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  status: FormStatus;
  university: string | null;
  department: string | null;
  thank_you_message: string | null;
  fields: Omit<RhField, 'project_id' | 'field_order'>[];
}

export const rk = {
  list: ['rh', 'list'] as const,
  project: (id: string) => ['rh', 'project', id] as const,
  fields: (id: string) => ['rh', 'fields', id] as const,
  responses: (id: string) => ['rh', 'responses', id] as const,
};

export async function listRhProjects(): Promise<RhProjectSummary[]> {
  const rows = must(await supabase.rpc('rh_my_projects')) as RhProjectSummary[] | null;
  return (rows ?? []).map((r) => ({ ...r, field_count: Number(r.field_count), response_count: Number(r.response_count) }));
}

export async function createRhProject(input: Pick<RhProject, 'title'> & Partial<RhProject>): Promise<RhProject> {
  return must(await supabase.from('rh_projects').insert(input).select('*').single()) as RhProject;
}

export async function getRhProject(id: string): Promise<RhProject> {
  return must(await supabase.from('rh_projects').select('*').eq('id', id).single()) as RhProject;
}

export async function updateRhProject(id: string, patch: Partial<RhProject>): Promise<RhProject> {
  return must(await supabase.from('rh_projects').update(patch).eq('id', id).select('*').single()) as RhProject;
}

export async function deleteRhProject(id: string): Promise<void> {
  const rows = must(await supabase.from('rh_projects').delete().eq('id', id).select('id'));
  if (!rows?.length) throw { code: '42501', message: 'Form not found or not yours' };
}

export async function listFields(projectId: string): Promise<RhField[]> {
  return must(await supabase.from('rh_fields').select('*').eq('project_id', projectId)
    .order('field_order').order('created_at')) as RhField[];
}

/** Save the whole question list: upsert current questions (in order), delete removed ones. */
export async function saveFields(projectId: string, fields: RhField[]): Promise<void> {
  const rows = fields.map((f, i) => ({
    id: f.id, project_id: projectId, label: f.label.trim(), help: f.help?.trim() || null, type: f.type,
    options: hasOptions(f.type) ? f.options.map((o) => o.trim()).filter(Boolean) : [],
    required: f.required, field_order: i,
  }));
  if (rows.length) must(await supabase.from('rh_fields').upsert(rows).select('id'));
  let del = supabase.from('rh_fields').delete().eq('project_id', projectId);
  if (rows.length) del = del.not('id', 'in', `(${rows.map((r) => r.id).join(',')})`);
  must(await del);
}

export async function listResponses(projectId: string): Promise<RhResponse[]> {
  const out: RhResponse[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await supabase.from('rh_responses').select('*').eq('project_id', projectId)
      .order('submitted_at').order('id').range(from, from + 999)) as RhResponse[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function deleteResponse(id: string): Promise<void> {
  must(await supabase.from('rh_responses').delete().eq('id', id));
}

export async function getPublicForm(id: string): Promise<PublicForm | null> {
  return must(await supabase.rpc('rh_public_form', { p_project_id: id })) as PublicForm | null;
}

export async function submitResponse(id: string, answers: Record<string, AnswerValue>): Promise<string> {
  return must(await supabase.rpc('rh_submit_response', { p_project_id: id, p_answers: answers })) as string;
}

export function publicFormUrl(id: string): string {
  return `${window.location.origin}/f/${id}`;
}

export function answerText(v: AnswerValue | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? v.join('; ') : String(v);
}

/** One row per response, one column per question (Excel-friendly, with BOM). */
export function responsesToCsv(fields: RhField[], responses: RhResponse[]): string {
  const header = ['Response #', 'Submitted at', ...fields.map((f) => f.label)];
  const rows = responses.map((r, i) => [String(i + 1), new Date(r.submitted_at).toISOString(), ...fields.map((f) => answerText(r.answers[f.id]))]);
  return '﻿' + Papa.unparse([header, ...rows]);
}
