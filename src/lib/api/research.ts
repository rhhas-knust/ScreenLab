import Papa from 'papaparse';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { must } from '../errors';

export type FieldType = 'text' | 'textarea' | 'number' | 'email' | 'radio' | 'checkbox' | 'scale' | 'date' | 'grid' | 'ranking' | 'calc' | 'file' | 'signature';
export type FormStatus = 'draft' | 'active' | 'closed';
/** string (text, radio, date), number (number, scale, calc), string[] (checkbox, ranking), { row: column } (grid), FileAnswer (file, signature). */
export type AnswerValue = string | number | string[] | Record<string, string>;

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'text', label: 'Short answer', hint: 'One line of text' },
  { type: 'textarea', label: 'Paragraph', hint: 'Longer text' },
  { type: 'number', label: 'Number', hint: 'e.g. age, hours per week' },
  { type: 'radio', label: 'Multiple choice', hint: 'Pick one option' },
  { type: 'checkbox', label: 'Checkboxes', hint: 'Pick any number of options' },
  { type: 'scale', label: 'Scale', hint: 'e.g. 1–5 or 0–10, with labels for the ends' },
  { type: 'grid', label: 'Likert grid', hint: 'Several statements, same answer options' },
  { type: 'ranking', label: 'Ranking', hint: 'Put the options in order' },
  { type: 'date', label: 'Date', hint: 'A calendar date' },
  { type: 'email', label: 'Email', hint: 'Validated email address' },
  { type: 'file', label: 'File upload', hint: 'Photo, PDF or document (up to 10 MB)' },
  { type: 'signature', label: 'Signature', hint: 'Drawn with a finger or mouse' },
  { type: 'calc', label: 'Calculated score', hint: 'Worked out from other answers, e.g. Q2 + Q3' },
];
export const FIELD_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t.label])) as Record<FieldType, string>;
export const hasOptions = (t: FieldType) => t === 'radio' || t === 'checkbox' || t === 'ranking' || t === 'grid';
/** Questions another question can depend on in "show only if". */
export const canBeCondition = (t: FieldType) => t !== 'grid' && t !== 'ranking' && t !== 'calc' && t !== 'file' && t !== 'signature';
/** Questions whose options can be shown in a random order. */
export const canShuffle = (t: FieldType) => t === 'radio' || t === 'checkbox' || t === 'ranking';
export const isUpload = (t: FieldType) => t === 'file' || t === 'signature';

export type ConditionOp = 'equals' | 'not_equals' | 'answered';
export interface ShowIf { field: string; op: ConditionOp; value?: string }
export interface FieldSettings {
  /** scale */
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  /** grid: the statements (rows); the options are the answer columns */
  rows?: string[];
  show_if?: ShowIf | null;
  /** radio/checkbox/ranking: show the options in a random order (keep_last pins e.g. “Other” at the end). */
  shuffle_options?: boolean;
  keep_last?: boolean;
  /** calc: formula with question references stored as @<field id>, e.g. "@id1 + @id2_3". */
  formula?: string;
  decimals?: number;
  /** calc: show the result to the respondent (otherwise only the researcher sees it). */
  show_result?: boolean;
  /** file: which kinds of file to accept. */
  accept?: 'image' | 'document' | 'any';
}

/** An uploaded file or signature: a path in the private rh-uploads bucket. */
export interface FileAnswer { file: string; name: string; type: string; size: string }
export const isFileAnswer = (v: unknown): v is FileAnswer =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as FileAnswer).file === 'string' && typeof (v as FileAnswer).name === 'string';

export interface Quota { field: string; value: string; limit: number; message?: string }
export interface FormOptions { randomize_questions?: boolean; quotas?: Quota[] }
export const scaleRange = (s: FieldSettings | undefined) => {
  const min = s?.min === 0 ? 0 : 1;
  const max = Math.min(10, Math.max(min + 1, s?.max ?? 5));
  return { min, max, points: Array.from({ length: max - min + 1 }, (_, i) => min + i) };
};

/** A translation of the form into another language. Options and rows translate by position. */
export interface FieldTranslation { label?: string; help?: string; options?: string[]; rows?: string[]; min_label?: string; max_label?: string }
export interface Translation {
  code: string;
  name: string;
  title?: string;
  description?: string;
  consent_text?: string;
  thank_you_message?: string;
  fields: Record<string, FieldTranslation>;
}
export interface Translations { base_name?: string; items?: Translation[] }

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
  consent_text: string | null;
  closes_at: string | null;
  max_responses: number | null;
  one_per_device: boolean;
  translations: Translations;
  /** Read-only results link token (null = not shared). */
  results_token?: string | null;
  results_include_text?: boolean;
  form_options?: FormOptions;
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
  settings: FieldSettings;
}

export interface RhResponse {
  id: string;
  project_id: string;
  answers: Record<string, AnswerValue>;
  submitted_at: string;
  consent_at?: string | null;
  language?: string | null;
  codes?: Record<string, string[]>;
}

export type ClosedReason = 'closed' | 'deadline' | 'full' | null;

export interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  status: FormStatus;
  university: string | null;
  department: string | null;
  thank_you_message: string | null;
  consent_text?: string | null;
  closes_at?: string | null;
  one_per_device?: boolean;
  translations?: Translations;
  /** Why the form is not taking responses (null = open). Missing on servers before v2. */
  closed_reason?: ClosedReason;
  randomize_questions?: boolean;
  /** Quota groups that are already full (v3). */
  full_quotas?: { field: string; value: string; message?: string | null }[];
  has_uploads?: boolean;
  fields: Omit<RhField, 'project_id' | 'field_order'>[];
}

export const rk = {
  list: ['rh', 'list'] as const,
  project: (id: string) => ['rh', 'project', id] as const,
  fields: (id: string) => ['rh', 'fields', id] as const,
  responses: (id: string) => ['rh', 'responses', id] as const,
  summary: (id: string) => ['rh', 'summary', id] as const,
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
  const res = await supabase.from('rh_projects').update(patch).eq('id', id).select('*').single();
  // A database not yet upgraded to ResearchHub v3 has no form_options column: save everything else.
  if ((res.error as { code?: string } | null)?.code === 'PGRST204' && 'form_options' in patch) {
    const { form_options: _skip, ...rest } = patch;
    void _skip;
    return must(await supabase.from('rh_projects').update(rest).eq('id', id).select('*').single()) as RhProject;
  }
  return must(res) as RhProject;
}

export async function deleteRhProject(id: string): Promise<void> {
  const rows = must(await supabase.from('rh_projects').delete().eq('id', id).select('id'));
  if (!rows?.length) throw { code: '42501', message: 'Form not found or not yours' };
}

export async function listFields(projectId: string): Promise<RhField[]> {
  const rows = must(await supabase.from('rh_fields').select('*').eq('project_id', projectId)
    .order('field_order').order('created_at')) as RhField[];
  return rows.map((f) => ({ ...f, settings: f.settings ?? {} }));
}

/** Settings worth storing for a question of this type (drops leftovers from an earlier type). */
export function cleanSettings(f: Pick<RhField, 'type' | 'settings'>): FieldSettings {
  const s = f.settings ?? {};
  const out: FieldSettings = {};
  if (f.type === 'scale') {
    const r = scaleRange(s);
    out.min = r.min;
    out.max = r.max;
    if (s.min_label?.trim()) out.min_label = s.min_label.trim();
    if (s.max_label?.trim()) out.max_label = s.max_label.trim();
  }
  if (f.type === 'grid') out.rows = (s.rows ?? []).map((r) => r.trim()).filter(Boolean).filter((r, i, a) => a.indexOf(r) === i).slice(0, 50);
  if (canShuffle(f.type) && s.shuffle_options) { out.shuffle_options = true; if (s.keep_last) out.keep_last = true; }
  if (f.type === 'calc') {
    out.formula = (s.formula ?? '').slice(0, 2000);
    out.decimals = Math.max(0, Math.min(6, Math.round(s.decimals ?? 2)));
    if (s.show_result) out.show_result = true;
  }
  if (f.type === 'file') out.accept = s.accept ?? 'any';
  if (s.show_if?.field) out.show_if = { field: s.show_if.field, op: s.show_if.op, ...(s.show_if.op === 'answered' ? {} : { value: s.show_if.value ?? '' }) };
  return out;
}

/** Save the whole question list: upsert current questions (in order), delete removed ones. */
export async function saveFields(projectId: string, fields: RhField[]): Promise<void> {
  const rows = fields.map((f, i) => ({
    id: f.id, project_id: projectId, label: f.label.trim(), help: f.help?.trim() || null, type: f.type,
    options: hasOptions(f.type) ? f.options.map((o) => o.trim()).filter(Boolean) : [],
    required: f.required, field_order: i, settings: cleanSettings(f),
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

export interface SubmitMeta { consent?: boolean; language?: string | null; device?: string | null; invite?: string | null; client_id?: string | null; collected_at?: string | null }

export async function submitResponse(id: string, answers: Record<string, AnswerValue>, meta: SubmitMeta = {}): Promise<string> {
  const res = await supabase.rpc('rh_submit_response', { p_project_id: id, p_answers: answers, p_meta: meta });
  // A database not yet upgraded to ResearchHub v2 only knows the two-argument version.
  if ((res.error as { code?: string } | null)?.code === 'PGRST202') {
    return must(await supabase.rpc('rh_submit_response', { p_project_id: id, p_answers: answers })) as string;
  }
  return must(res) as string;
}

/** Save the owner's theme codes for one response. */
export async function saveCodes(responseId: string, codes: Record<string, string[]>): Promise<void> {
  must(await supabase.from('rh_responses').update({ codes }).eq('id', responseId).select('id').single());
}

/** A random token kept in this browser, used for "one response per device". */
export function deviceToken(): string {
  try {
    let t = localStorage.getItem('rh-device');
    if (!t) { t = crypto.randomUUID(); localStorage.setItem('rh-device', t); }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

export function publicFormUrl(id: string): string {
  return `${window.location.origin}/f/${id}`;
}

export function sharedResultsUrl(token: string): string {
  return `${window.location.origin}/r/${token}`;
}

/** What a read-only results link shows: no email answers, and open text only if the owner allowed it. */
export interface SharedResults {
  title: string;
  description: string | null;
  university: string | null;
  department: string | null;
  year: string | null;
  status: FormStatus;
  include_text: boolean;
  fields: RhField[];
  responses: RhResponse[];
}

export async function getSharedResults(token: string): Promise<SharedResults | null> {
  const r = must(await supabase.rpc('rh_shared_results', { p_token: token })) as SharedResults | null;
  return r && { ...r, fields: r.fields.map((f) => ({ ...f, settings: f.settings ?? {} })) };
}

/** Turn the results link on (a fresh token each time, which retires any old link) or off. */
export async function setResultsSharing(id: string, on: boolean, includeText = false): Promise<RhProject> {
  return updateRhProject(id, { results_token: on ? crypto.randomUUID() : null, results_include_text: on && includeText });
}

export function answerText(v: AnswerValue | FileAnswer | undefined): string {
  if (v == null) return '';
  if (isFileAnswer(v)) return v.name;
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ');
  return String(v);
}

/** CSV columns for one question: grids get a column per statement, rankings a column per option (its rank). */
function csvColumns(f: RhField): { head: string; get: (r: RhResponse) => string }[] {
  if (f.type === 'grid') {
    return (f.settings?.rows ?? []).map((row) => ({
      head: `${f.label} — ${row}`,
      get: (r) => { const v = r.answers[f.id]; return v && typeof v === 'object' && !Array.isArray(v) ? v[row] ?? '' : ''; },
    }));
  }
  if (f.type === 'ranking') {
    return f.options.map((o) => ({
      head: `${f.label} — rank of ${o}`,
      get: (r) => { const v = r.answers[f.id]; const i = Array.isArray(v) ? v.indexOf(o) : -1; return i < 0 ? '' : String(i + 1); },
    }));
  }
  return [{ head: f.label, get: (r) => answerText(r.answers[f.id]) }];
}

/** One row per response, one column per question (Excel-friendly, with BOM). */
export function responsesToCsv(fields: RhField[], responses: RhResponse[], languages: Translations = {}): string {
  const cols = fields.flatMap((f) => {
    const c = csvColumns(f);
    if (responses.some((r) => r.codes?.[f.id]?.length)) c.push({ head: `${f.label} — codes`, get: (r) => (r.codes?.[f.id] ?? []).join('; ') });
    return c;
  });
  const langName = new Map((languages.items ?? []).map((t) => [t.code, t.name]));
  const extra: { head: string; get: (r: RhResponse) => string }[] = [];
  if (responses.some((r) => r.language)) extra.push({ head: 'Language', get: (r) => (r.language ? langName.get(r.language) ?? r.language : languages.base_name || 'Original') });
  if (responses.some((r) => r.consent_at)) extra.push({ head: 'Consent given at', get: (r) => (r.consent_at ? new Date(r.consent_at).toISOString() : '') });
  const header = ['Response #', 'Submitted at', ...cols.map((c) => c.head), ...extra.map((c) => c.head)];
  const rows = responses.map((r, i) => [String(i + 1), new Date(r.submitted_at).toISOString(), ...cols.map((c) => c.get(r)), ...extra.map((c) => c.get(r))]);
  return '\ufeff' + Papa.unparse([header, ...rows]);
}

export interface RhSummaryBody {
  headline: string;
  key_findings: string[];
  open_text_themes: { theme: string; detail: string }[];
  limitations: string[];
}
export interface RhSummary {
  id: string;
  project_id: string;
  model: string;
  summary: RhSummaryBody;
  response_count: number;
  created_at: string;
}

export class RhSummaryError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

export async function latestSummary(projectId: string): Promise<RhSummary | null> {
  const rows = must(await supabase.from('rh_ai_summaries').select('*').eq('project_id', projectId)
    .order('created_at', { ascending: false }).limit(1)) as RhSummary[];
  return rows[0] ?? null;
}

/** Ask the server to write a findings summary. The API key lives only in the Edge Function. */
export async function writeSummary(projectId: string): Promise<RhSummary> {
  const { data, error } = await supabase.functions.invoke('rh-summary', { body: { project_id: projectId } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await (error.context as Response).json().catch(() => null) as { error?: string; code?: string } | null;
      throw new RhSummaryError(body?.error ?? 'The AI summary failed.', body?.code);
    }
    throw new RhSummaryError('Could not reach the AI service. Check your connection.', 'network');
  }
  return data as RhSummary;
}

// ---------------------------------------------------------------------------
// Uploads (file and signature questions)
// ---------------------------------------------------------------------------
export const UPLOAD_BUCKET = 'rh-uploads';

/**
 * Upload one picked file into the form's folder. `slot` is a uuid fixed per
 * file when the response is made, so a retry after a dropped connection
 * reuses the same path instead of leaving a copy behind.
 */
export async function uploadFormFile(projectId: string, slot: string, file: { blob: Blob; name: string; type: string; size: number }): Promise<FileAnswer> {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
  const path = `${projectId}/${slot}/${safe}`;
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file.blob, { contentType: file.type, upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
  return { file: path, name: file.name.slice(0, 200), type: file.type, size: String(file.size) };
}

/** A short-lived link for the owner to open an uploaded file. */
export async function fileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, 60 * 10);
  if (error || !data) throw error ?? new Error('Could not open the file');
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Invitations and reminders
// ---------------------------------------------------------------------------
export interface RhInvite {
  id: string;
  project_id: string;
  email: string;
  name: string | null;
  token: string;
  created_at: string;
  last_sent_at: string | null;
  send_count: number;
  /** The day this person responded (which response is theirs is never recorded). */
  responded_on: string | null;
}

export const inviteKey = (id: string) => ['rh', 'invites', id] as const;

export function inviteUrl(projectId: string, token: string): string {
  return `${publicFormUrl(projectId)}?i=${token}`;
}

export async function listInvites(projectId: string): Promise<RhInvite[]> {
  return must(await supabase.from('rh_invites').select('*').eq('project_id', projectId).order('created_at').order('email')) as RhInvite[];
}

/** Add people; an email already on the list is left as it is. */
export async function addInvites(projectId: string, people: { email: string; name?: string | null }[]): Promise<number> {
  if (!people.length) return 0;
  const rows = must(await supabase.from('rh_invites')
    .upsert(people.map((p) => ({ project_id: projectId, email: p.email, name: p.name || null })), { onConflict: 'project_id,email', ignoreDuplicates: true })
    .select('id')) as { id: string }[] | null;
  return rows?.length ?? 0;
}

export async function deleteInvite(id: string): Promise<void> {
  must(await supabase.from('rh_invites').delete().eq('id', id));
}

export interface SendResult { sent: number; skipped: number; failed: { email: string; error: string }[] }
export class InviteError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

/** Email invitations or reminders through the rh-invite Edge Function (the email key stays on the server). */
export async function sendInvites(projectId: string, ids: string[], kind: 'invite' | 'reminder', subject: string, message: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('rh-invite', {
    body: { project_id: projectId, invite_ids: ids, kind, subject, message, app_url: window.location.origin },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await (error.context as Response).json().catch(() => null) as { error?: string; code?: string } | null;
      throw new InviteError(body?.error ?? 'Sending failed.', body?.code);
    }
    throw new InviteError('Could not reach the email service. Check your connection.', 'network');
  }
  return data as SendResult;
}

/** "Ama Mensah <ama@x.com>", "ama@x.com, Ama Mensah", "Ama Mensah, ama@x.com" or a bare address — one per line or comma/semicolon separated. */
export function parseInvitees(text: string): { people: { email: string; name: string | null }[]; bad: string[] } {
  const EMAIL = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/;
  const people = new Map<string, { email: string; name: string | null }>();
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // A line with several addresses and no names: split it.
    const all = line.match(new RegExp(EMAIL.source, 'g')) ?? [];
    const parts = all.length > 1 ? line.split(/[,;]+/) : [line];
    for (const part of parts) {
      const m = part.match(EMAIL);
      if (!m) { if (part.trim() && !/^(email|e-mail|name)\b/i.test(part.trim())) bad.push(part.trim()); continue; }
      const email = m[0].toLowerCase();
      const name = part.replace(m[0], '').replace(/[<>"',;\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
      if (!people.has(email)) people.set(email, { email, name });
    }
  }
  return { people: [...people.values()], bad };
}
