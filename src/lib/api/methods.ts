// Methods reporting: search log, protocol decisions, AI-use disclosure, PRISMA manual counts.
import Papa from 'papaparse';
import { supabase } from '../supabase';
import { must } from '../errors';
import type { ProjectSettings } from '../types';

export type SourceKind = 'database' | 'register' | 'other';
export interface SearchSource {
  id: string;
  project_id: string;
  kind: SourceKind;
  name: string;
  searched_on: string | null;
  search_string: string | null;
  filters: string | null;
  results_count: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export type DecisionCategory = 'registration' | 'eligibility' | 'classification' | 'process' | 'deviation' | 'other';
export const DECISION_CATEGORIES: { value: DecisionCategory; label: string }[] = [
  { value: 'registration', label: 'Registration / protocol' },
  { value: 'eligibility', label: 'Eligibility rule' },
  { value: 'classification', label: 'Tiering / classification' },
  { value: 'process', label: 'Screening process' },
  { value: 'deviation', label: 'Deviation from protocol' },
  { value: 'other', label: 'Other' },
];
export const CATEGORY_LABEL = Object.fromEntries(DECISION_CATEGORIES.map((c) => [c.value, c.label])) as Record<DecisionCategory, string>;

export interface ProtocolDecision {
  id: string;
  project_id: string;
  decided_on: string;
  category: DecisionCategory;
  title: string;
  detail: string | null;
  rationale: string | null;
  created_at: string;
}

export interface AiDisclosure {
  suggestions: number;
  records: number;
  first_at: string | null;
  last_at: string | null;
  by_model: { model: string; stage: 'title_abstract' | 'full_text'; source: string; count: number }[];
  agreement: {
    stage: 'title_abstract' | 'full_text';
    records: number;
    decided: number;
    compared: number;
    agreed: number;
    ai_include_human_exclude: number;
    ai_exclude_human_include: number;
    ai_unsure: number;
    decided_before_suggestion: number;
  }[];
  human_decisions: number;
  imported_decisions: number;
  reviewers: number;
}

/** PRISMA numbers ScreenLab cannot know from its own data. Stored in project_settings.settings.prisma. */
export interface PrismaManual {
  duplicates_before_import: number;
  automation_excluded: number;
  other_removed: number;
  reports_not_retrieved_extra: number;
  reports_of_included: number | null;
}
export const EMPTY_PRISMA: PrismaManual = {
  duplicates_before_import: 0, automation_excluded: 0, other_removed: 0, reports_not_retrieved_extra: 0, reports_of_included: null,
};

export const mk = {
  sources: (id: string) => ['methods', 'sources', id] as const,
  decisions: (id: string) => ['methods', 'decisions', id] as const,
  ai: (id: string) => ['methods', 'ai', id] as const,
};

export function prismaManual(settings: ProjectSettings | undefined): PrismaManual {
  const raw = (settings?.settings?.prisma ?? {}) as Partial<PrismaManual>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  return {
    duplicates_before_import: n(raw.duplicates_before_import),
    automation_excluded: n(raw.automation_excluded),
    other_removed: n(raw.other_removed),
    reports_not_retrieved_extra: n(raw.reports_not_retrieved_extra),
    reports_of_included: raw.reports_of_included == null || raw.reports_of_included === ('' as unknown) ? null : n(raw.reports_of_included),
  };
}

/** Save the manual PRISMA numbers without touching other keys in settings (criteria terms, PICO…). */
export async function savePrismaManual(projectId: string, manual: PrismaManual): Promise<void> {
  const current = must(await supabase.from('project_settings').select('settings').eq('project_id', projectId).single()) as { settings: Record<string, unknown> };
  must(await supabase.from('project_settings').update({ settings: { ...(current.settings ?? {}), prisma: manual } }).eq('project_id', projectId).select('project_id'));
}

export async function listSources(projectId: string): Promise<SearchSource[]> {
  return must(await supabase.from('search_sources').select('*').eq('project_id', projectId)
    .order('sort_order').order('created_at')) as SearchSource[];
}
export async function saveSource(projectId: string, s: Partial<SearchSource> & { name: string }): Promise<SearchSource> {
  const row = {
    project_id: projectId, kind: s.kind ?? 'database', name: s.name.trim(), searched_on: s.searched_on || null,
    search_string: s.search_string?.trim() || null, filters: s.filters?.trim() || null,
    results_count: s.results_count ?? null, notes: s.notes?.trim() || null, sort_order: s.sort_order ?? 0,
  };
  return (s.id
    ? must(await supabase.from('search_sources').update(row).eq('id', s.id).select('*').single())
    : must(await supabase.from('search_sources').insert(row).select('*').single())) as SearchSource;
}
export async function deleteSource(id: string): Promise<void> {
  must(await supabase.from('search_sources').delete().eq('id', id));
}

export async function listDecisions(projectId: string): Promise<ProtocolDecision[]> {
  return must(await supabase.from('protocol_decisions').select('*').eq('project_id', projectId)
    .order('decided_on').order('created_at')) as ProtocolDecision[];
}
export async function saveDecision(projectId: string, d: Partial<ProtocolDecision> & { title: string }): Promise<ProtocolDecision> {
  const row = {
    project_id: projectId, decided_on: d.decided_on || new Date().toISOString().slice(0, 10), category: d.category ?? 'eligibility',
    title: d.title.trim(), detail: d.detail?.trim() || null, rationale: d.rationale?.trim() || null,
  };
  return (d.id
    ? must(await supabase.from('protocol_decisions').update(row).eq('id', d.id).select('*').single())
    : must(await supabase.from('protocol_decisions').insert(row).select('*').single())) as ProtocolDecision;
}
export async function deleteDecision(id: string): Promise<void> {
  must(await supabase.from('protocol_decisions').delete().eq('id', id));
}

export async function getAiDisclosure(projectId: string): Promise<AiDisclosure> {
  return must(await supabase.rpc('ai_disclosure', { p_project_id: projectId })) as AiDisclosure;
}

export function sourcesToCsv(rows: SearchSource[]): string {
  return '﻿' + Papa.unparse([
    ['Type', 'Source', 'Date searched', 'Search string', 'Filters / limits', 'Records found', 'Notes'],
    ...rows.map((r) => [r.kind, r.name, r.searched_on ?? '', r.search_string ?? '', r.filters ?? '', r.results_count ?? '', r.notes ?? '']),
  ]);
}
export function decisionsToCsv(rows: ProtocolDecision[]): string {
  return '﻿' + Papa.unparse([
    ['Date', 'Category', 'Decision', 'Detail', 'Rationale'],
    ...rows.map((r) => [r.decided_on, CATEGORY_LABEL[r.category], r.title, r.detail ?? '', r.rationale ?? '']),
  ]);
}
