-- ResearchHub v2: consent, skip logic, more question types, closing rules,
-- several languages, one response per device, and coding of open-text answers.
--
-- Security model is unchanged: respondents only use rh_public_form() and
-- rh_submit_response() (SECURITY DEFINER), the tables stay owner-only.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.rh_projects
  add column if not exists consent_text text check (char_length(consent_text) <= 20000),
  add column if not exists closes_at timestamptz,
  add column if not exists max_responses integer check (max_responses between 1 and 1000000),
  add column if not exists one_per_device boolean not null default false,
  -- { "base_name": "English", "items": [{ "code", "name", "title", "description", "consent_text",
  --   "thank_you_message", "fields": { "<field id>": { "label", "help", "options", "rows", "min_label", "max_label" } } }] }
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(translations) = 'object' and octet_length(translations::text) <= 500000);

alter table public.rh_fields drop constraint if exists rh_fields_type_check;
alter table public.rh_fields add constraint rh_fields_type_check
  check (type in ('text', 'textarea', 'number', 'email', 'radio', 'checkbox', 'scale', 'date', 'grid', 'ranking'));
-- scale: { min, max, min_label, max_label }; grid: { rows: [...] } (options are the columns);
-- any type: { show_if: { field, op: equals | not_equals | answered, value } }
alter table public.rh_fields
  add column if not exists settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 20000);

alter table public.rh_responses
  add column if not exists consent_at timestamptz,
  add column if not exists language text check (char_length(language) <= 40),
  add column if not exists device_token text check (char_length(device_token) <= 100),
  -- Owner's theme codes for open-text answers: { "<field id>": ["code", ...] }
  add column if not exists codes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(codes) = 'object' and octet_length(codes::text) <= 50000);
create unique index if not exists rh_responses_device_idx on public.rh_responses(project_id, device_token)
  where device_token is not null;

-- The owner may edit the theme codes on their responses, and nothing else.
revoke update on public.rh_responses from anon, authenticated;
grant update (codes) on public.rh_responses to authenticated;
drop policy if exists rh_responses_update on public.rh_responses;
create policy rh_responses_update on public.rh_responses for update to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())))
  with check (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Is the form taking responses? null = yes; otherwise the reason it is not.
-- ---------------------------------------------------------------------------
create or replace function public.rh_closed_reason(p public.rh_projects)
returns text language sql stable security definer
set search_path = ''
as $$
  select case
    when p.status = 'draft' then 'draft'
    when p.status = 'closed' then 'closed'
    when p.closes_at is not null and now() >= p.closes_at then 'deadline'
    when p.max_responses is not null
      and (select count(*) from public.rh_responses r where r.project_id = p.id) >= p.max_responses then 'full'
    else null end
$$;
revoke all on function public.rh_closed_reason(public.rh_projects) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public form
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
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required, 'settings', f.settings)
                       order by f.field_order, f.created_at)
        from public.rh_fields f where f.project_id = p.id), '[]'::jsonb))
    from public.rh_projects p
   where p.id = p_project_id and p.status in ('active', 'closed')
$$;

-- ---------------------------------------------------------------------------
-- Submit. p_meta: { consent: bool, language: code, device: token }
-- ---------------------------------------------------------------------------
drop function if exists public.rh_submit_response(uuid, jsonb);
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
   where project_id = p_project_id and submitted_at > now() - interval '1 minute';
  if recent >= 60 then
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
      else
        continue;
    end case;
    clean := clean || jsonb_build_object(f.id::text, v);
  end loop;

  insert into public.rh_responses(project_id, answers, consent_at, language, device_token)
  values (p_project_id, clean,
          case when coalesce(btrim(proj.consent_text), '') <> '' then now() end,
          lang, device)
  returning id into rid;
  return rid;
end $$;

revoke all on function public.rh_public_form(uuid) from public;
revoke all on function public.rh_submit_response(uuid, jsonb, jsonb) from public;
grant execute on function public.rh_public_form(uuid) to anon, authenticated;
grant execute on function public.rh_submit_response(uuid, jsonb, jsonb) to anon, authenticated;
