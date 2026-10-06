// ai-screen: suggests (never records) a screening decision for one reference.
// The Anthropic API key lives only in this function's secrets (ANTHROPIC_API_KEY).
// All database and storage access uses the caller's own JWT, so Row Level
// Security applies exactly as in the app: nobody can assess another user's records.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { SYSTEM_PROMPT, buildUserText, isPdf, parseResult, resultSchema, type Source, type Stage } from './prompt.ts';

const MODEL = Deno.env.get('AI_MODEL') || 'claude-opus-5-5';
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function fetchWithLimit(url: string, ms: number): Promise<Uint8Array | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'ScreenLab/1.0 (systematic review screening)' } });
    if (!res.ok || !res.body) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_PDF_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length <= MAX_PDF_BYTES ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function openAccessPdf(doi: string): Promise<Uint8Array | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  const meta = await fetchWithLimit(`https://api.openalex.org/works/doi:${clean.split('/').map(encodeURIComponent).join('/')}?select=best_oa_location,locations`, 8000);
  if (!meta) return null;
  let w: { best_oa_location?: { pdf_url?: string | null } | null; locations?: { pdf_url?: string | null }[] };
  try { w = JSON.parse(new TextDecoder().decode(meta)); } catch { return null; }
  const urls = [w.best_oa_location?.pdf_url, ...(w.locations ?? []).map((l) => l.pdf_url)].filter((u): u is string => !!u);
  for (const u of [...new Set(urls)].slice(0, 3)) {
    const pdf = await fetchWithLimit(u, 20000);
    if (pdf && isPdf(pdf)) return pdf;
  }
  return null;
}

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

  let body: { reference_id?: string; stage?: Stage; use_full_text?: boolean };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const stage: Stage = body.stage === 'full_text' ? 'full_text' : 'title_abstract';
  if (!body.reference_id || !/^[0-9a-f-]{36}$/i.test(body.reference_id)) return json(400, { error: 'Invalid reference' });

  // RLS: returns nothing unless the caller is a member of the record's project.
  const { data: ref } = await db.from('study_references')
    .select('id,project_id,title,abstract,keywords,year,journal,publication_type,language,doi')
    .eq('id', body.reference_id).maybeSingle();
  if (!ref) return json(404, { error: 'Reference not found' });
  const [{ data: project }, { data: reasonRows }] = await Promise.all([
    db.from('projects').select('research_question,inclusion_criteria,exclusion_criteria,population,intervention_or_exposure,comparator,outcomes,study_design,date_range,language').eq('id', ref.project_id).single(),
    db.from('exclusion_reasons').select('label,stage,is_active,sort_order').eq('project_id', ref.project_id).order('sort_order'),
  ]);
  const reasons = (reasonRows ?? []).filter((r) => r.is_active && (r.stage === 'both' || r.stage === stage)).map((r) => r.label as string);

  // Full text: attached PDF first, then a legal open-access copy, else the abstract.
  let source: Source = 'abstract';
  let pdf: Uint8Array | null = null;
  if (stage === 'full_text' && body.use_full_text !== false) {
    const { data: files } = await db.from('full_text_files').select('storage_path,file_size').eq('reference_id', ref.id)
      .order('uploaded_at', { ascending: false }).limit(1);
    if (files?.[0] && (files[0].file_size ?? 0) <= MAX_PDF_BYTES) {
      const dl = await db.storage.from('full-texts').download(files[0].storage_path);
      if (dl.data) {
        const bytes = new Uint8Array(await dl.data.arrayBuffer());
        if (isPdf(bytes)) { pdf = bytes; source = 'attached_pdf'; }
      }
    }
    if (!pdf && ref.doi) {
      pdf = await openAccessPdf(ref.doi);
      if (pdf) source = 'open_access_pdf';
    }
  }

  const content: Anthropic.ContentBlockParam[] = [];
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(pdf) } });
  content.push({ type: 'text', text: buildUserText(project ?? {}, ref, reasons, stage, source) });

  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { effort: stage === 'full_text' && pdf ? 'medium' : 'low', format: { type: 'json_schema', schema: resultSchema(reasons) } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json(503, { error: 'The Anthropic API key is invalid — check the ANTHROPIC_API_KEY secret.', code: 'bad_key' });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'AI is busy (rate limit). Wait a moment and try again.', code: 'rate_limited' });
    if (e instanceof Anthropic.BadRequestError) return json(400, { error: `AI request rejected: ${e.message}`, code: 'bad_request' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `AI service error (${e.status ?? 'network'}). Try again.`, code: 'upstream' });
    return json(502, { error: 'Could not reach the AI service. Try again.', code: 'upstream' });
  }
  if (response.stop_reason === 'refusal') return json(422, { error: 'The AI declined to assess this article — please screen it yourself.', code: 'refusal' });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text || response.stop_reason === 'max_tokens') return json(502, { error: 'The AI answer was incomplete. Try again.', code: 'incomplete' });

  let result;
  try { result = parseResult(text, reasons); } catch { return json(502, { error: 'The AI answer could not be read. Try again.', code: 'parse' }); }

  const row = {
    project_id: ref.project_id, reference_id: ref.id, stage, model: response.model, source,
    recommendation: result.recommendation, exclusion_reason: result.exclusion_reason || null, confidence: result.confidence,
    summary: result.summary, criteria: result.criteria,
    input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, created_by: userData.user.id,
  };
  const { data: saved, error } = await db.from('ai_suggestions').insert(row).select('*').single();
  if (error) return json(200, { ...row, id: null, created_at: new Date().toISOString(), save_error: error.message });
  return json(200, saved);
});
