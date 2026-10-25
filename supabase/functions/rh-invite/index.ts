// rh-invite: emails ResearchHub invitations and reminders with personal links.
// The email provider key lives only in this function's secrets:
//   RESEND_API_KEY  — an API key from resend.com
//   RH_EMAIL_FROM   — the sender, e.g. "ResearchHub <survey@your-domain.org>" (a domain verified in Resend)
// All database access uses the caller's own JWT, so Row Level Security applies:
// only the questionnaire's owner can email its invitees.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildEmail, defaultSubject, type Invitee } from './email.ts';

const MAX_PER_CALL = 500;
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

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RH_EMAIL_FROM');
  if (!apiKey || !from) {
    return json(503, { error: 'Email sending is not set up yet: add RESEND_API_KEY and RH_EMAIL_FROM under Supabase → Edge Functions → Secrets.', code: 'not_configured' });
  }

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: userData } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!userData?.user) return json(401, { error: 'Please sign in again.' });

  let body: { project_id?: string; invite_ids?: string[]; kind?: string; subject?: string; message?: string; app_url?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const kind = body.kind === 'reminder' ? 'reminder' : 'invite';
  if (!body.project_id || !/^[0-9a-f-]{36}$/i.test(body.project_id)) return json(400, { error: 'Invalid questionnaire' });
  const ids = (body.invite_ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return json(400, { error: 'Choose who to email.' });
  if (ids.length > MAX_PER_CALL) return json(400, { error: `Send to at most ${MAX_PER_CALL} people at a time.` });
  let origin: string;
  try { const u = new URL(body.app_url ?? ''); if (!/^https?:$/.test(u.protocol)) throw new Error(); origin = u.origin; } catch { return json(400, { error: 'Invalid app address' }); }

  // RLS: nothing comes back unless the caller owns the questionnaire.
  const { data: form } = await db.from('rh_projects').select('id,title,university,department,closes_at,status').eq('id', body.project_id).maybeSingle();
  if (!form) return json(404, { error: 'Questionnaire not found' });
  if (form.status !== 'active') return json(400, { error: 'Publish the questionnaire (or reopen it) before sending invitations.', code: 'not_active' });
  const { data: rows } = await db.from('rh_invites').select('id,email,name,token,responded_on,send_count').eq('project_id', form.id).in('id', ids);
  // Reminders never go to people who have already responded.
  const targets = (rows ?? []).filter((r) => kind === 'invite' || !r.responded_on);
  const skipped = ids.length - targets.length;
  const subject = (body.subject?.trim() || defaultSubject(kind, form.title)).slice(0, 200);

  const failed: { email: string; error: string }[] = [];
  const sentIds: string[] = [];
  for (let i = 0; i < targets.length; i += 100) {
    const batch = targets.slice(i, i + 100);
    const emails = batch.map((r) => {
      const { text, html } = buildEmail(kind, form, r as Invitee, `${origin}/f/${form.id}?i=${r.token}`, body.message ?? '');
      return { from, to: [r.email], subject, text, html };
    });
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(emails),
    }).catch(() => null);
    if (!res || !res.ok) {
      const detail = res ? ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}` : 'network';
      if (res?.status === 401 || res?.status === 403) return json(503, { error: 'The email provider rejected the key or sender. Check RESEND_API_KEY and RH_EMAIL_FROM.', code: 'bad_key' });
      for (const r of batch) failed.push({ email: r.email, error: detail });
      continue;
    }
    sentIds.push(...batch.map((r) => r.id));
  }
  const now = new Date().toISOString();
  for (const r of targets.filter((t) => sentIds.includes(t.id))) {
    await db.from('rh_invites').update({ last_sent_at: now, send_count: (r.send_count ?? 0) + 1 }).eq('id', r.id);
  }
  return json(200, { sent: sentIds.length, skipped, failed });
});
