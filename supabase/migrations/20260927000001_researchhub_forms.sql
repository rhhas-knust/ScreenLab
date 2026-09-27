-- ResearchHub: questionnaires with a public link, responses collected securely.
--
-- Security model
--  * Forms, questions and responses are private to the form's owner (RLS).
--  * Respondents never touch the tables: they read a published form through
--    rh_public_form() and submit through rh_submit_response(), both SECURITY
--    DEFINER, which only work for published ('active') forms and validate every
--    answer against the question type, options and "required" flag.

create table if not exists public.rh_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  university text check (char_length(university) <= 200),
  department text check (char_length(department) <= 200),
  year text check (char_length(year) <= 50),
  thank_you_message text check (char_length(thank_you_message) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rh_projects_owner_idx on public.rh_projects(owner_id);

create table if not exists public.rh_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 1000),
  help text check (char_length(help) <= 2000),
  type text not null check (type in ('text', 'textarea', 'number', 'email', 'radio', 'checkbox', 'scale')),
  -- radio / checkbox: array of option strings
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 100),
  required boolean not null default false,
  field_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists rh_fields_project_idx on public.rh_fields(project_id, field_order);

create table if not exists public.rh_responses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  -- { "<field id>": value } — string, number, or array of strings (checkbox)
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);
create index if not exists rh_responses_project_idx on public.rh_responses(project_id, submitted_at);

drop trigger if exists rh_projects_touch on public.rh_projects;
create trigger rh_projects_touch before update on public.rh_projects
  for each row execute function public.touch_updated_at();

alter table public.rh_projects enable row level security;
alter table public.rh_fields enable row level security;
alter table public.rh_responses enable row level security;

-- Owner-only access
create policy rh_projects_select on public.rh_projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy rh_projects_insert on public.rh_projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy rh_projects_update on public.rh_projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy rh_projects_delete on public.rh_projects for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy rh_fields_all on public.rh_fields for all to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())))
  with check (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));

-- Responses: the owner can read and delete; nobody inserts directly (only via rh_submit_response).
create policy rh_responses_select on public.rh_responses for select to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));
create policy rh_responses_delete on public.rh_responses for delete to authenticated
  using (project_id in (select id from public.rh_projects where owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Public form (no sign-in): published or closed forms only; drafts look missing.
-- ---------------------------------------------------------------------------
create or replace function public.rh_public_form(p_project_id uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'status', p.status,
    'university', p.university, 'department', p.department, 'thank_you_message', p.thank_you_message,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required)
                       order by f.field_order, f.created_at)
        from public.rh_fields f where f.project_id = p.id), '[]'::jsonb))
    from public.rh_projects p
   where p.id = p_project_id and p.status in ('active', 'closed')
$$;

create or replace function public.rh_submit_response(p_project_id uuid, p_answers jsonb)
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
begin
  select * into proj from public.rh_projects where id = p_project_id;
  if not found or proj.status = 'draft' then
    raise exception 'This form was not found.' using errcode = 'P0002';
  end if;
  if proj.status <> 'active' then
    raise exception 'This form is closed and no longer accepts responses.' using errcode = 'P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 200000 then
    raise exception 'Invalid answers.' using errcode = '22023';
  end if;
  -- Simple flood protection per form
  select count(*) into recent from public.rh_responses
   where project_id = p_project_id and submitted_at > now() - interval '1 minute';
  if recent >= 60 then
    raise exception 'This form is receiving too many responses right now. Please try again in a minute.' using errcode = 'P0001';
  end if;

  for f in select * from public.rh_fields where project_id = p_project_id order by field_order, created_at loop
    v := p_answers -> (f.id::text);
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb
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
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
          raise exception 'Please choose 1–5 for: %', f.label using errcode = '22023';
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
      else
        continue;
    end case;
    clean := clean || jsonb_build_object(f.id::text, v);
  end loop;

  insert into public.rh_responses(project_id, answers) values (p_project_id, clean) returning id into rid;
  return rid;
end $$;

revoke all on function public.rh_public_form(uuid) from public;
revoke all on function public.rh_submit_response(uuid, jsonb) from public;
grant execute on function public.rh_public_form(uuid) to anon, authenticated;
grant execute on function public.rh_submit_response(uuid, jsonb) to anon, authenticated;

-- Dashboard list with response counts
create or replace function public.rh_my_projects()
returns table (id uuid, title text, status text, created_at timestamptz, updated_at timestamptz,
               field_count bigint, response_count bigint, last_response_at timestamptz)
language sql stable security invoker
set search_path = ''
as $$
  select p.id, p.title, p.status, p.created_at, p.updated_at,
         (select count(*) from public.rh_fields f where f.project_id = p.id),
         (select count(*) from public.rh_responses r where r.project_id = p.id),
         (select max(r.submitted_at) from public.rh_responses r where r.project_id = p.id)
    from public.rh_projects p
   where p.owner_id = (select auth.uid())
   order by p.updated_at desc
$$;
revoke all on function public.rh_my_projects() from public, anon;
grant execute on function public.rh_my_projects() to authenticated;
