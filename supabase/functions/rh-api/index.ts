// rh-api: ResearchHub data for other tools.
//
//   GET  /functions/v1/rh-api?key=<api key>&format=json|csv
//        A questionnaire's responses (set-aside ones left out). The key (made in
//        ResearchHub → Connect) is the only credential, so Google Sheets'
//        IMPORTDATA and Excel's "From Web" can read it. Only its hash is stored.
//   POST { action: "deliver", response_id }
//        Called by the respondent's page after a submission: sends the signed
//        webhook once (deliveries are logged and never repeated).
//   POST { action: "test" | "retry", project_id }   (owner's login required)
//        Send a test ping, or re-send responses that were never delivered.
//
// Deployed with verify_jwt = false; every route checks its own credential.
// Uses the service role, so every query below is scoped by hand.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkWebhookUrl, hmacHex, sha256Hex, tableRows, toCsv, toJson, webhookPayload } from './format.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const UUID = /^[0-9a-f-]{36}$/i;

async function formData(projectId: string) {
  const [{ data: form }, { data: fields }] = await Promise.all([
    admin.from('rh_projects').select('id,title,owner_id').eq('id', projectId).maybeSingle(),
    admin.from('rh_fields').select('id,label,type,options,settings,field_order,created_at').eq('project_id', projectId).order('field_order').order('created_at'),
  ]);
  return { form, fields: fields ?? [] };
}

async function deliver(projectId: string, responseId: string | null, test = false, force = false): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { data: hook } = await admin.from('rh_webhooks').select('url,secret,enabled').eq('project_id', projectId).maybeSingle();
  if (!hook || (!hook.enabled && !test)) return { ok: false, error: 'No webhook is switched on.' };
  const bad = checkWebhookUrl(hook.url);
  if (bad) return { ok: false, error: bad };
  const { form, fields } = await formData(projectId);
  if (!form) return { ok: false, error: 'Questionnaire not found' };

  let logId: string | null = null, body: string;
  if (test) {
    body = JSON.stringify({ event: 'ping', form: { id: form.id, title: form.title }, sent_at: new Date().toISOString() });
    const { data } = await admin.from('rh_webhook_log').insert({ project_id: projectId, event: 'ping', attempts: 1 }).select('id').single();
    logId = data?.id ?? null;
  } else {
    const { data: r } = await admin.from('rh_responses').select('id,submitted_at,answers,excluded').eq('id', responseId!).eq('project_id', projectId).maybeSingle();
    if (!r) return { ok: false, error: 'Response not found' };
    // One log row per response: a second call for an already-delivered response does nothing.
    const { data: existing } = await admin.from('rh_webhook_log').select('id,delivered_at,attempts').eq('response_id', r.id).maybeSingle();
    if (existing?.delivered_at) return { ok: true };
    if (existing && existing.attempts >= 5 && !force) return { ok: false, error: 'Gave up after 5 attempts' };
    const { count } = await admin.from('rh_responses').select('id', { count: 'exact', head: true }).eq('project_id', projectId).lte('submitted_at', r.submitted_at);
    body = JSON.stringify(webhookPayload(form, fields, r, count ?? 0));
    if (existing) {
      logId = existing.id;
      await admin.from('rh_webhook_log').update({ attempts: existing.attempts + 1 }).eq('id', existing.id);
    } else {
      const { data, error } = await admin.from('rh_webhook_log').insert({ project_id: projectId, response_id: r.id, attempts: 1 }).select('id').single();
      if (error) return { ok: true }; // another call is delivering it right now
      logId = data.id;
    }
  }

  const sig = await hmacHex(hook.secret, body);
  let status = 0, error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ResearchHub-Webhook/1', 'X-ResearchHub-Event': test ? 'ping' : 'response.created', 'X-ResearchHub-Signature': `sha256=${sig}` },
      body,
    });
    status = res.status;
    if (!res.ok) error = `The endpoint answered HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error)?.name === 'TimeoutError' ? 'No answer within 10 seconds' : 'Could not connect to the address';
  }
  if (logId) await admin.from('rh_webhook_log').update({ status: status || null, error, delivered_at: error ? null : new Date().toISOString() }).eq('id', logId);
  return { ok: !error, status, error: error ?? undefined };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const key = url.searchParams.get('key') ?? req.headers.get('x-api-key') ?? '';
    if (!/^rh_[0-9a-f]{64}$/.test(key)) return json(401, { error: 'Add ?key=<your API key> (made in ResearchHub → Connect).' });
    const { data: k } = await admin.from('rh_api_keys').select('id,project_id').eq('key_hash', await sha256Hex(key)).is('revoked_at', null).maybeSingle();
    if (!k) return json(401, { error: 'This API key is not valid or has been revoked.' });
    await admin.from('rh_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id);
    const { form, fields } = await formData(k.project_id);
    if (!form) return json(404, { error: 'Questionnaire not found' });
    const responses: { id: string; submitted_at: string; answers: Record<string, unknown> }[] = [];
    for (let from = 0; from < 100_000; from += 1000) {
      const { data } = await admin.from('rh_responses').select('id,submitted_at,answers').eq('project_id', form.id).eq('excluded', false)
        .order('submitted_at').order('id').range(from, from + 999);
      responses.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (url.searchParams.get('format') === 'csv') {
      return new Response(toCsv(tableRows(fields, responses)), { headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return json(200, toJson(form, fields, responses));
  }

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  let body: { action?: string; response_id?: string; project_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }

  if (body.action === 'deliver') {
    if (!body.response_id || !UUID.test(body.response_id)) return json(400, { error: 'Invalid response' });
    const { data: r } = await admin.from('rh_responses').select('project_id').eq('id', body.response_id).maybeSingle();
    if (!r) return json(404, { error: 'Response not found' });
    return json(200, await deliver(r.project_id, body.response_id));
  }

  if (body.action === 'test' || body.action === 'retry') {
    if (!body.project_id || !UUID.test(body.project_id)) return json(400, { error: 'Invalid questionnaire' });
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const { data: p } = await admin.from('rh_projects').select('owner_id').eq('id', body.project_id).maybeSingle();
    if (!u?.user || !p || p.owner_id !== u.user.id) return json(403, { error: 'Only the questionnaire’s owner can do this.' });
    if (body.action === 'test') return json(200, await deliver(body.project_id, null, true));
    // Re-send responses from the last 30 days that never got through (at most 200 per click); set-aside ones stay out.
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [{ data: rs }, { data: done }] = await Promise.all([
      admin.from('rh_responses').select('id').eq('project_id', body.project_id).eq('excluded', false).gte('submitted_at', since).order('submitted_at').limit(2000),
      admin.from('rh_webhook_log').select('response_id').eq('project_id', body.project_id).not('delivered_at', 'is', null).not('response_id', 'is', null),
    ]);
    const delivered = new Set((done ?? []).map((d) => d.response_id));
    const todo = (rs ?? []).filter((r) => !delivered.has(r.id)).slice(0, 200);
    let sent = 0, failed = 0;
    for (const r of todo) { const out = await deliver(body.project_id, r.id, false, true); if (out.ok) sent++; else failed++; }
    return json(200, { sent, failed, remaining: Math.max(0, (rs ?? []).filter((r) => !delivered.has(r.id)).length - todo.length) });
  }
  return json(400, { error: 'Unknown action' });
});
