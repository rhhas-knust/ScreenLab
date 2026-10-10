import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { must } from '../errors';
import type { Stage } from '../types';

export interface AiCriterion { criterion: string; assessment: 'met' | 'not_met' | 'unclear'; evidence: string }
export interface AiSuggestion {
  id: string | null;
  reference_id: string;
  stage: Stage;
  model: string;
  recommendation: 'include' | 'exclude' | 'unsure';
  exclusion_reason: string | null;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  criteria: AiCriterion[];
  source: 'abstract' | 'attached_pdf' | 'open_access_pdf';
  created_at: string;
}

export class AiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

export const aiKey = (refId: string, stage: Stage) => ['ai', refId, stage] as const;

/** Latest suggestion for this stage; falls back to the other stage's so a review done at one stage still shows at the other. */
export async function latestSuggestion(referenceId: string, stage: Stage): Promise<AiSuggestion | null> {
  const rows = must(await supabase.from('ai_suggestions').select('*').eq('reference_id', referenceId)
    .order('created_at', { ascending: false }).limit(20)) as AiSuggestion[];
  return rows.find((r) => r.stage === stage) ?? rows[0] ?? null;
}

/** Ask the server-side AI for a suggestion. Never records a decision. */
export async function askAi(referenceId: string, stage: Stage): Promise<AiSuggestion> {
  const { data, error } = await supabase.functions.invoke('ai-screen', { body: { reference_id: referenceId, stage } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await (error.context as Response).json().catch(() => null) as { error?: string; code?: string } | null;
      throw new AiError(body?.error ?? 'The AI request failed.', body?.code);
    }
    throw new AiError('Could not reach the AI service — check your connection.', 'network');
  }
  return data as AiSuggestion;
}

export async function aiSuggestedIds(projectId: string, stage: Stage): Promise<Set<string>> {
  const rows = must(await supabase.rpc('ai_suggested_ids', { p_project_id: projectId, p_stage: stage })) as (string | Record<string, string>)[] | null;
  // PostgREST returns a plain array for `setof uuid`; accept a column-wrapped shape too.
  return new Set((rows ?? []).map((r) => (typeof r === 'string' ? r : Object.values(r)[0])));
}
