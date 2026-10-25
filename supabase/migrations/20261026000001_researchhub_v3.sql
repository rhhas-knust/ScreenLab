-- ResearchHub v3 (Phase 2): calculated scores, piping, randomised order,
-- quotas, file-upload and signature questions, email invitations with
-- reminders, and offline collection.
--
-- Security model is unchanged: respondents only use rh_public_form() and
-- rh_submit_response() (SECURITY DEFINER) plus uploads into their form's
-- folder of the private rh-uploads bucket; everything else is owner-only.

-- ---------------------------------------------------------------------------
-- Columns and types
-- ---------------------------------------------------------------------------
-- { "randomize_questions": bool, "quotas": [{ "field", "value", "limit", "message" }] }
alter table public.rh_projects
  add column if not exists form_options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form_options) = 'object' and octet_length(form_options::text) <= 50000);

alter table public.rh_fields drop constraint if exists rh_fields_type_check;
alter table public.rh_fields add constraint rh_fields_type_check
  check (type in ('text', 'textarea', 'number', 'email', 'radio', 'checkbox', 'scale', 'date', 'grid', 'ranking',
                  'calc', 'file', 'signature'));

-- client_id: the respondent's device makes it, so an offline response retried after a dropped
-- connection is stored once. collected_at: when it was filled in, if that was offline.
alter table public.rh_responses
  add column if not exists client_id uuid,
  add column if not exists collected_at timestamptz;
create unique index if not exists rh_responses_client_idx on public.rh_responses(project_id, client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- Invitations. The token is the personal link; only the day someone responded
-- is kept, never which response is theirs, so answers stay anonymous.
-- ---------------------------------------------------------------------------
create table if not exists public.rh_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  name text check (char_length(name) <= 200),
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  send_count int not null default 0,
  responded_on date,
  unique (project_id, email)
);
create index if not exists rh_invites_project_idx on public.rh_invites(project_id);
alter table public.rh_invites enable row level security;
drop policy if exists rh_invites_owner on public.rh_invites;
create policy rh_invites_owner on public.rh_invites for all to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())))
  with check (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));
grant select, insert, update, delete on public.rh_invites to authenticated;
-- The owner cannot fake a response date or reuse a token for another person.
revoke update on public.rh_invites from authenticated;
grant update (name, last_sent_at, send_count) on public.rh_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Uploads: private bucket, objects at "<project_id>/<uuid>/<file name>".
-- Anyone may upload into a form that is taking responses (like any public
-- form); only the form's owner can see or delete the files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rh-uploads', 'rh-uploads', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav'])
on conflict (id) do nothing;

create or replace function public.rh_accepts_uploads(p_folder text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rh_projects p
     where p.id::text = p_folder and p.status = 'active' and public.rh_closed_reason(p) is null
       and exists (select 1 from public.rh_fields f where f.project_id = p.id and f.type in ('file', 'signature')))
$$;
create or replace function public.rh_owns_form(p_folder text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.rh_projects p where p.id::text = p_folder and p.owner_id = (select auth.uid()))
$$;
revoke all on function public.rh_accepts_uploads(text) from public;
revoke all on function public.rh_owns_form(text) from public;
grant execute on function public.rh_accepts_uploads(text) to anon, authenticated;
grant execute on function public.rh_owns_form(text) to authenticated;

drop policy if exists "researchhub uploads insert" on storage.objects;
create policy "researchhub uploads insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'rh-uploads' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]{1,200}$'
              and public.rh_accepts_uploads((storage.foldername(name))[1]));
drop policy if exists "researchhub uploads select" on storage.objects;
create policy "researchhub uploads select" on storage.objects for select to authenticated
  using (bucket_id = 'rh-uploads' and public.rh_owns_form((storage.foldername(name))[1]));
drop policy if exists "researchhub uploads delete" on storage.objects;
create policy "researchhub uploads delete" on storage.objects for delete to authenticated
  using (bucket_id = 'rh-uploads' and public.rh_owns_form((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
create or replace function public.rh_answer_matches(a jsonb, val text)
returns boolean language sql immutable
set search_path = ''
as $$
  select case when a is null or val is null then false
              when jsonb_typeof(a) = 'array' then a ? val
              else (a #>> '{}') = val end
$$;
create or replace function public.rh_quota_count(p_project_id uuid, p_field text, p_value text)
returns int language sql stable security definer
set search_path = ''
as $$
  select count(*)::int from public.rh_responses r
   where r.project_id = p_project_id and public.rh_answer_matches(r.answers -> p_field, p_value)
$$;
revoke all on function public.rh_quota_count(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public form: adds the randomisation switch and which quota groups are full
-- (never the limits or counts themselves).
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
-- Submit. p_meta: { consent, language, device, invite, client_id, collected_at }
-- ---------------------------------------------------------------------------
create or replace function public.rh_submit_response(p_project_id uuid, p_answers jsonb, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer
set search_path = ''
as $$
declare
  proj public.rh_projects;
  f public.rh_fields;
  v jsonb;
  clean jsonb := '{}'::jsonb;
  recent int;
  rid uuid;
  num numeric;
  reason text;
  cond jsonb;
  dep jsonb;
  shown boolean;
  lo int;
  hi int;
  grid_rows jsonb;
  lang text;
  device text;
  d date;
  q jsonb;
  qn int;
  inv_token uuid;
  inv public.rh_invites;
  client uuid;
  collected timestamptz;
begin
  -- Lock the form row so the response limit cannot be overshot by simultaneous submissions.
  select * into proj from public.rh_projects where id = p_project_id for update;
  if not found or proj.status = 'draft' then
    raise exception 'This form was not found.' using errcode = 'P0002';
  end if;
  reason := public.rh_closed_reason(proj);
  if reason = 'deadline' then
    raise exception 'The deadline for this questionnaire has passed.' using errcode = 'P0001';
  elsif reason = 'full' then
    raise exception 'This questionnaire has received all the responses it needs.' using errcode = 'P0001';
  elsif reason is not null then
    raise exception 'This form is closed and no longer accepts responses.' using errcode = 'P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 200000 then
    raise exception 'Invalid answers.' using errcode = '22023';
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    p_meta := '{}'::jsonb;
  end if;
  -- Offline sync: the same client_id never makes two responses (a retried upload returns the first one).
  if (p_meta ->> 'client_id') ~ '^[0-9a-fA-F-]{36}$' then
    client := (p_meta ->> 'client_id')::uuid;
    select id into rid from public.rh_responses where project_id = p_project_id and client_id = client;
    if found then
      return rid;
    end if;
  end if;
  begin
    collected := (p_meta ->> 'collected_at')::timestamptz;
  exception when others then
    collected := null;
  end;
  if collected is not null and (collected > now() + interval '1 day' or collected < now() - interval '1 year') then
    collected := null;
  end if;
  if coalesce(btrim(proj.consent_text), '') <> '' and coalesce(p_meta -> 'consent', 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'Please read the information sheet and agree to take part before answering.' using errcode = '22023';
  end if;
  device := nullif(left(p_meta ->> 'device', 100), '');
  if proj.one_per_device then
    if device is null then
      raise exception 'Invalid answers.' using errcode = '22023';
    end if;
    if exists (select 1 from public.rh_responses where project_id = p_project_id and device_token = device) then
      raise exception 'A response has already been submitted from this device. Thank you for taking part.' using errcode = 'P0001';
    end if;
  else
    device := null;
  end if;
  lang := p_meta ->> 'language';
  if lang is not null and not exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(proj.translations -> 'items') = 'array' then proj.translations -> 'items' else '[]'::jsonb end) t
     where t ->> 'code' = lang) then
    lang := null;
  end if;
  -- Simple flood protection per form
  select count(*) into recent from public.rh_responses
   where project_id = p_project_id and submitted_at > now() - interval '1 minute' and collected_at is null;
  if recent >= 60 and collected is null then
    raise exception 'This form is receiving too many responses right now. Please try again in a minute.' using errcode = 'P0001';
  end if;

  for f in select * from public.rh_fields where project_id = p_project_id order by field_order, created_at loop
    -- Skip logic: a question whose condition is not met is hidden, never required, and its answer is dropped.
    cond := f.settings -> 'show_if';
    if cond is not null and jsonb_typeof(cond) = 'object' and cond ? 'field' then
      dep := clean -> (cond ->> 'field');
      shown := case cond ->> 'op'
        when 'answered' then dep is not null
        when 'not_equals' then dep is not null and not (
          case when jsonb_typeof(dep) = 'array' then dep ? (cond ->> 'value') else (dep #>> '{}') = (cond ->> 'value') end)
        else dep is not null and (
          case when jsonb_typeof(dep) = 'array' then dep ? (cond ->> 'value') else (dep #>> '{}') = (cond ->> 'value') end)
      end;
      if not shown then
        continue;
      end if;
    end if;

    v := p_answers -> (f.id::text);
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb or v = '{}'::jsonb
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if f.required then
        raise exception 'Please answer: %', f.label using errcode = '22023';
      end if;
      continue;
    end if;
    case f.type
      when 'text', 'textarea', 'email' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > (case f.type when 'textarea' then 10000 else 1000 end) then
          raise exception 'Invalid answer for: %', f.label using errcode = '22023';
        end if;
        if f.type = 'email' and (v #>> '{}') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          raise exception 'Please enter a valid email address for: %', f.label using errcode = '22023';
        end if;
        v := to_jsonb(btrim(v #>> '{}'));
      when 'number' then
        if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then
          v := to_jsonb((v #>> '{}')::numeric);
        end if;
        if jsonb_typeof(v) <> 'number' then
          raise exception 'Please enter a number for: %', f.label using errcode = '22023';
        end if;
        num := (v #>> '{}')::numeric;
        if abs(num) > 1e12 then
          raise exception 'Number out of range for: %', f.label using errcode = '22023';
        end if;
      when 'scale' then
        lo := coalesce((f.settings ->> 'min')::int, 1);
        hi := coalesce((f.settings ->> 'max')::int, 5);
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
           or (v #>> '{}')::numeric < lo or (v #>> '{}')::numeric > hi then
          raise exception 'Please choose % to % for: %', lo, hi, f.label using errcode = '22023';
        end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Please enter a date for: %', f.label using errcode = '22023';
        end if;
        begin
          d := (v #>> '{}')::date;
        exception when others then
          raise exception 'Please enter a real date for: %', f.label using errcode = '22023';
        end;
        if to_char(d, 'YYYY-MM-DD') <> (v #>> '{}') or d < date '1900-01-01' or d > date '2200-12-31' then
          raise exception 'Please enter a real date for: %', f.label using errcode = '22023';
        end if;
      when 'radio' then
        if jsonb_typeof(v) <> 'string' or not (f.options @> jsonb_build_array(v)) then
          raise exception 'Please choose one of the options for: %', f.label using errcode = '22023';
        end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'array' or not (f.options @> v)
           or (select count(*) from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') > 0 then
          raise exception 'Please choose from the options for: %', f.label using errcode = '22023';
        end if;
      when 'ranking' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> jsonb_array_length(f.options)
           or not (f.options @> v) or not (v @> f.options) then
          raise exception 'Please put every option in order for: %', f.label using errcode = '22023';
        end if;
      when 'grid' then
        grid_rows := case when jsonb_typeof(f.settings -> 'rows') = 'array' then f.settings -> 'rows' else '[]'::jsonb end;
        if jsonb_typeof(v) <> 'object'
           or exists (select 1 from jsonb_each(v) e
                       where not (grid_rows @> jsonb_build_array(e.key))
                          or jsonb_typeof(e.value) <> 'string'
                          or not (f.options @> jsonb_build_array(e.value))) then
          raise exception 'Please choose one answer per row for: %', f.label using errcode = '22023';
        end if;
        if f.required and exists (select 1 from jsonb_array_elements_text(grid_rows) r where not (v ? r)) then
          raise exception 'Please answer every row of: %', f.label using errcode = '22023';
        end if;
      when 'file', 'signature' then
        -- An uploaded file: { file: "<project>/<uuid>/<name>", name, type, size }, already in the rh-uploads bucket.
        if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'file') <> 'string'
           or (v ->> 'file') !~ ('^' || p_project_id::text || '/[0-9a-f-]{36}/[^/]{1,200}$')
           or not exists (select 1 from storage.objects o where o.bucket_id = 'rh-uploads' and o.name = v ->> 'file') then
          raise exception 'The file for “%” did not upload. Please attach it again.', f.label using errcode = '22023';
        end if;
        v := jsonb_build_object('file', v ->> 'file', 'name', left(coalesce(v ->> 'name', 'file'), 200),
                                'type', left(coalesce(v ->> 'type', ''), 100), 'size', left(coalesce(v ->> 'size', ''), 20));
      else
        -- Calculated scores are worked out from the other answers, never stored.
        continue;
    end case;
    clean := clean || jsonb_build_object(f.id::text, v);
  end loop;

  -- Quotas: once a group is full, people in it are thanked and turned away.
  for q in select * from jsonb_array_elements(case when jsonb_typeof(proj.form_options -> 'quotas') = 'array' then proj.form_options -> 'quotas' else '[]'::jsonb end) loop
    if public.rh_answer_matches(clean -> (q ->> 'field'), q ->> 'value') then
      qn := public.rh_quota_count(p_project_id, q ->> 'field', q ->> 'value');
      if qn >= coalesce((q ->> 'limit')::int, 2147483647) then
        raise exception '%', coalesce(nullif(btrim(q ->> 'message'), ''), 'Thank you for your interest. We already have all the responses we need from people who answered “' || (q ->> 'value') || '”.')
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- Personal invitation link: record that this person responded (not which response is theirs).
  if (p_meta ->> 'invite') ~ '^[0-9a-fA-F-]{36}$' then
    inv_token := (p_meta ->> 'invite')::uuid;
    select * into inv from public.rh_invites where project_id = p_project_id and token = inv_token for update;
    if found then
      if inv.responded_on is not null then
        raise exception 'This personal link has already been used to respond. Thank you for taking part.' using errcode = 'P0001';
      end if;
      update public.rh_invites set responded_on = current_date where id = inv.id;
    end if;
  end if;

  insert into public.rh_responses(project_id, answers, consent_at, language, device_token, client_id, collected_at)
  values (p_project_id, clean,
          case when coalesce(btrim(proj.consent_text), '') <> '' then now() end,
          lang, device, client, collected)
  returning id into rid;
  return rid;
end $$;

revoke all on function public.rh_public_form(uuid) from public;
revoke all on function public.rh_submit_response(uuid, jsonb, jsonb) from public;
grant execute on function public.rh_public_form(uuid) to anon, authenticated;
grant execute on function public.rh_submit_response(uuid, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Results link: uploaded files and signatures are never shared (like emails).
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
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'project_id', f.project_id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required, 'field_order', f.field_order, 'settings', f.settings)
                       order by f.field_order, f.created_at) from f), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'submitted_at', r.submitted_at,
               'answers', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(r.answers) e, ids where e.key = any (ids.ids)), '{}'::jsonb))
             order by r.submitted_at, r.id)
        from public.rh_responses r where r.project_id = p.id), '[]'::jsonb))
    from p
$$;

revoke all on function public.rh_shared_results(uuid) from public;
grant execute on function public.rh_shared_results(uuid) to anon, authenticated;
