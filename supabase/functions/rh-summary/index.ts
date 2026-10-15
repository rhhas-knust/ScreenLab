// rh-summary: writes an AI findings summary for one ResearchHub questionnaire.
// The Anthropic API key lives only in this function's secrets (ANTHROPIC_API_KEY).
// All database access uses the caller's own JWT, so Row Level Security applies:
// only the questionnaire's owner can summarise it, and only their responses are read.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildUserText, MIN_RESPONSES, parseResult, resultSchema, SYSTEM_PROMPT, type Answers, type Field } from './prompt.ts';

const MODEL = Deno.env.get('AI_MODEL') || 'claude-opus-5-5';
const MAX_RESPONSES = 5000;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'AI is not set up yet: add ANTHROPIC_API_KEY under Supabase → Edge Functions → Secrets.', code: 'not_configured' });

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: userData } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!userData?.user) return json(401, { error: 'Please sign in again.' });

  let body: { project_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  if (!body.project_id || !/^[0-9a-f-]{36}$/i.test(body.project_id)) return json(400, { error: 'Invalid questionnaire' });

  // RLS: returns nothing unless the caller owns the questionnaire.
  const { data: form } = await db.from('rh_projects').select('id,title,description,university,department')
    .eq('id', body.project_id).maybeSingle();
  if (!form) return json(404, { error: 'Questionnaire not found' });
  const [{ data: fields }, { data: rows }] = await Promise.all([
    db.from('rh_fields').select('id,label,type,options,settings').eq('project_id', form.id).order('field_order'),
    db.from('rh_responses').select('answers').eq('project_id', form.id).order('submitted_at').limit(MAX_RESPONSES),
  ]);
  const responses = (rows ?? []).map((r) => r.answers as Answers);
  if (responses.length < MIN_RESPONSES) {
    return json(400, { error: `Collect at least ${MIN_RESPONSES} responses before asking for a summary.`, code: 'too_few' });
  }

  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  let response: Anthropic.Beta.BetaMessage;
  try {
    // Server-side refusal fallback: if the main model declines, the API retries on a fallback model in the same call.
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: resultSchema() } },
      messages: [{ role: 'user', content: buildUserText(form, (fields ?? []) as Field[], responses) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json(503, { error: 'The Anthropic API key is invalid. Check the ANTHROPIC_API_KEY secret.', code: 'bad_key' });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'AI is busy (rate limit). Wait a moment and try again.', code: 'rate_limited' });
    if (e instanceof Anthropic.BadRequestError) return json(400, { error: `AI request rejected: ${e.message}`, code: 'bad_request' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `AI service error (${e.status ?? 'network'}). Try again.`, code: 'upstream' });
    return json(502, { error: 'Could not reach the AI service. Try again.', code: 'upstream' });
  }
  if (response.stop_reason === 'refusal') return json(422, { error: 'The AI declined to summarise these responses.', code: 'refusal' });
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text || response.stop_reason === 'max_tokens') return json(502, { error: 'The AI answer was incomplete. Try again.', code: 'incomplete' });

  let summary;
  try { summary = parseResult(text); } catch { return json(502, { error: 'The AI answer could not be read. Try again.', code: 'parse' }); }

  const { data: saved, error } = await db.from('rh_ai_summaries').insert({
    project_id: form.id, model: response.model, summary, response_count: responses.length,
    input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, created_by: userData.user.id,
  }).select('*').single();
  if (error) return json(500, { error: 'The summary was written but could not be saved. Try again.', code: 'save' });
  return json(200, saved);
});
