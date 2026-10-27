-- ResearchHub v5 (Phase 4): dashboards, an API for other tools, and webhooks.
--
-- API keys: the owner creates a key for one questionnaire; only its SHA-256
-- hash is stored, so the key is shown once and cannot be read back. The
-- rh-api Edge Function looks keys up by hash with the service role.
-- Webhooks: on each new response the rh-webhook Edge Function POSTs a signed
-- JSON payload to the owner's https URL; deliveries are logged.

-- ---------------------------------------------------------------------------
-- API keys
-- ---------------------------------------------------------------------------
create table if not exists public.rh_api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  name text not null default 'API key' check (char_length(name) between 1 and 100),
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists rh_api_keys_project_idx on public.rh_api_keys(project_id);
alter table public.rh_api_keys enable row level security;
drop policy if exists rh_api_keys_owner_select on public.rh_api_keys;
create policy rh_api_keys_owner_select on public.rh_api_keys for select to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));
-- Keys are created and revoked only through the functions below.
revoke all on public.rh_api_keys from anon, authenticated;
grant select (id, project_id, name, prefix, created_at, last_used_at, revoked_at) on public.rh_api_keys to authenticated;

create or replace function public.rh_create_api_key(p_project_id uuid, p_name text default 'API key')
returns jsonb language plpgsql volatile security definer
set search_path = ''
as $$
declare
  k text;
  rid uuid;
begin
  if not exists (select 1 from public.rh_projects where id = p_project_id and owner_id = (select auth.uid())) then
    raise exception 'Questionnaire not found' using errcode = '42501';
  end if;
  if (select count(*) from public.rh_api_keys where project_id = p_project_id and revoked_at is null) >= 10 then
    raise exception 'A questionnaire can have at most 10 active keys. Revoke one first.' using errcode = 'P0001';
  end if;
  -- 244 random bits from two v4 UUIDs; only the hash is kept.
  k := 'rh_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.rh_api_keys(project_id, name, prefix, key_hash)
  values (p_project_id, left(coalesce(nullif(btrim(p_name), ''), 'API key'), 100), left(k, 10), encode(sha256(convert_to(k, 'UTF8')), 'hex'))
  returning id into rid;
  return jsonb_build_object('id', rid, 'key', k);
end $$;

create or replace function public.rh_revoke_api_key(p_key_id uuid)
returns void language sql volatile security definer
set search_path = ''
as $$
  update public.rh_api_keys k set revoked_at = now()
   where k.id = p_key_id and k.revoked_at is null
     and k.project_id in (select id from public.rh_projects where owner_id = (select auth.uid()))
$$;
revoke all on function public.rh_create_api_key(uuid, text) from public, anon;
revoke all on function public.rh_revoke_api_key(uuid) from public, anon;
grant execute on function public.rh_create_api_key(uuid, text) to authenticated;
grant execute on function public.rh_revoke_api_key(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Webhooks: one endpoint per questionnaire, owner-only.
-- ---------------------------------------------------------------------------
create table if not exists public.rh_webhooks (
  project_id uuid primary key references public.rh_projects(id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rh_webhooks enable row level security;
drop policy if exists rh_webhooks_owner on public.rh_webhooks;
create policy rh_webhooks_owner on public.rh_webhooks for all to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())))
  with check (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));
grant select, insert, update, delete on public.rh_webhooks to authenticated;

create table if not exists public.rh_webhook_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  response_id uuid references public.rh_responses(id) on delete set null,
  event text not null default 'response.created',
  status int,
  error text check (char_length(error) <= 500),
  attempts int not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists rh_webhook_log_response_idx on public.rh_webhook_log(response_id) where response_id is not null;
create index if not exists rh_webhook_log_project_idx on public.rh_webhook_log(project_id, created_at desc);
alter table public.rh_webhook_log enable row level security;
drop policy if exists rh_webhook_log_owner on public.rh_webhook_log;
create policy rh_webhook_log_owner on public.rh_webhook_log for select to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));
revoke all on public.rh_webhook_log from anon, authenticated;
grant select on public.rh_webhook_log to authenticated;

-- ---------------------------------------------------------------------------
-- Public form: tells the respondent's page whether to ping rh-webhook.
-- ---------------------------------------------------------------------------
create or replace function public.rh_public_form(p_project_id uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'status', p.status,
    'university', p.university, 'department', p.department, 'thank_you_message', p.thank_you_message,
    'consent_text', p.consent_text, 'closes_at', p.closes_at, 'one_per_device', p.one_per_device,
    'translations', p.translations, 'closed_reason', public.rh_closed_reason(p),
    'randomize_questions', coalesce((p.form_options ->> 'randomize_questions')::boolean, false),
    'has_webhook', exists (select 1 from public.rh_webhooks w where w.project_id = p.id and w.enabled),
    'has_uploads', exists (select 1 from public.rh_fields f where f.project_id = p.id and f.type in ('file', 'signature')),
    'full_quotas', coalesce((
      select jsonb_agg(jsonb_build_object('field', q ->> 'field', 'value', q ->> 'value', 'message', q ->> 'message'))
        from jsonb_array_elements(case when jsonb_typeof(p.form_options -> 'quotas') = 'array' then p.form_options -> 'quotas' else '[]'::jsonb end) q
       where public.rh_quota_count(p.id, q ->> 'field', q ->> 'value') >= coalesce((q ->> 'limit')::int, 2147483647)), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required, 'settings', f.settings)
                       order by f.field_order, f.created_at)
        from public.rh_fields f where f.project_id = p.id), '[]'::jsonb))
    from public.rh_projects p
   where p.id = p_project_id and p.status in ('active', 'closed')
$$;


-- ---------------------------------------------------------------------------
-- Results link: carries the owner's dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.rh_shared_results(p_token uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  with p as (
    select * from public.rh_projects where p_token is not null and results_token = p_token
  ), f as (
    select fl.* from public.rh_fields fl, p
     where fl.project_id = p.id and fl.type not in ('email', 'file', 'signature')
       and (p.results_include_text or fl.type not in ('text', 'textarea'))
  ), ids as (
    select coalesce(array_agg(id::text), '{}') as ids from f
  )
  select jsonb_build_object(
    'title', p.title, 'description', p.description, 'university', p.university, 'department', p.department, 'year', p.year,
    'status', p.status, 'include_text', p.results_include_text,
    'dashboard', coalesce(p.analysis -> 'dashboard', '[]'::jsonb),
    'weighting', case when coalesce((p.analysis -> 'weighting' ->> 'enabled')::boolean, false) then p.analysis -> 'weighting' end,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'project_id', f.project_id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required, 'field_order', f.field_order, 'settings', f.settings)
                       order by f.field_order, f.created_at) from f), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'submitted_at', r.submitted_at,
               'answers', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(r.answers) e, ids where e.key = any (ids.ids)), '{}'::jsonb))
             order by r.submitted_at, r.id)
        from public.rh_responses r where r.project_id = p.id and not r.excluded), '[]'::jsonb))
    from p
$$;

revoke all on function public.rh_shared_results(uuid) from public;
grant execute on function public.rh_shared_results(uuid) to anon, authenticated;

revoke all on function public.rh_public_form(uuid) from public;
grant execute on function public.rh_public_form(uuid) to anon, authenticated;
