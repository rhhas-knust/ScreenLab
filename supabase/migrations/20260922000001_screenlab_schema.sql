-- ============================================================================
-- ScreenLab — database schema (Version 1)
--
-- Security model:  user → project (via project_members) → everything else.
-- Every table has Row Level Security enabled. Access to any row is granted only
-- when the row's project_id belongs to a project the signed-in user is a member
-- of. Changing an ID in the URL can never reveal another user's data.
--
-- Run this whole file once in Supabase → SQL Editor (or via `supabase db push`).
-- It is safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE
-- where possible.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Normalised title used for duplicate detection: lower-case, alphanumerics only.
create or replace function public.norm_title(t text)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Normalised DOI: lower-case, without resolver prefixes such as https://doi.org/
create or replace function public.norm_doi(d text)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(
    trim(regexp_replace(lower(coalesce(d, '')), '^\s*(https?://)?(dx\.)?(doi\.org/)?(doi:\s*)?', '')),
    '')
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  description text,
  research_question text,
  review_type text not null default 'systematic'
    check (review_type in ('systematic', 'scoping', 'literature', 'other')),
  inclusion_criteria text,
  exclusion_criteria text,
  population text,
  intervention_or_exposure text,
  comparator text,
  outcomes text,
  study_design text,
  date_range text,
  language text,
  start_date date,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects(owner_id);

-- Membership table: V1 only ever contains the owner, but this is what allows
-- additional reviewers (Reviewer A / Reviewer B) to be added later.
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'reviewer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);

-- Projects the current user can access. SECURITY DEFINER so that policies on
-- other tables can use it without recursive RLS evaluation.
create or replace function public.my_project_ids()
returns setof uuid language sql stable security definer
set search_path = ''
as $$
  select m.project_id from public.project_members m where m.user_id = (select auth.uid())
$$;
revoke all on function public.my_project_ids() from public, anon;
grant execute on function public.my_project_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Settings, reasons, tags, imports
-- ---------------------------------------------------------------------------

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  stage2_enabled boolean not null default true,
  keyboard_shortcuts_enabled boolean not null default true,
  -- 'single' in V1. Future: 'dual' (two independent reviewers + consensus).
  screening_mode text not null default 'single' check (screening_mode in ('single', 'dual')),
  -- PRISMA-style manual counts for records that did not enter via import.
  additional_records_other_sources integer not null default 0 check (additional_records_other_sources >= 0),
  prisma_notes text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.exclusion_reasons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  stage text not null default 'both' check (stage in ('both', 'title_abstract', 'full_text')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists exclusion_reasons_label_uq on public.exclusion_reasons(project_id, lower(label));

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'slate',
  created_at timestamptz not null default now()
);
create unique index if not exists tags_name_uq on public.tags(project_id, lower(name));

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_name text,
  file_format text,
  database_source text,
  records_detected integer not null default 0,
  records_imported integer not null default 0,
  imported_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_project_idx on public.import_batches(project_id);

create table if not exists public.duplicate_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  match_type text not null check (match_type in ('doi', 'pmid', 'title_year', 'fuzzy_title', 'manual')),
  match_score real,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('merged', 'kept_all', 'marked_duplicate')),
  primary_reference_id uuid,
  -- Snapshot of every member before resolution (for audit and "reopen").
  resolution_details jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists duplicate_groups_project_idx on public.duplicate_groups(project_id, status);

-- ---------------------------------------------------------------------------
-- References (named study_references because REFERENCES is an SQL keyword)
-- ---------------------------------------------------------------------------

create table if not exists public.study_references (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  seq bigint generated by default as identity,           -- import order
  import_batch_id uuid references public.import_batches(id) on delete set null,

  -- Bibliographic metadata (as imported; never silently rewritten)
  title text,
  authors text,
  abstract text,
  year integer,
  journal text,
  volume text,
  issue text,
  pages text,
  doi text,
  pmid text,
  url text,
  keywords text,
  publication_type text,
  database_source text,
  language text,
  original_record jsonb,          -- the raw imported fields, preserved verbatim
  imported_at timestamptz not null default now(),

  -- Derived (maintained by trigger)
  title_norm text,
  doi_norm text,
  search_text text,

  -- Stage 1: title / abstract screening (final decision)
  title_abstract_decision text check (title_abstract_decision in ('include', 'exclude', 'maybe')),
  title_abstract_screened_at timestamptz,
  title_abstract_exclusion_reason text,

  -- Stage 2: full-text screening (final decision)
  full_text_decision text check (full_text_decision in ('include', 'exclude')),
  full_text_screened_at timestamptz,
  full_text_exclusion_reason text,

  notes text,
  tag_names text[] not null default '{}',
  full_text_url text,
  full_text_status text not null default 'not_available'
    check (full_text_status in ('not_available', 'available', 'reviewed')),

  -- Duplicates: none | possible | duplicate (removed) | kept (reviewed, not a duplicate) | merged (removed)
  duplicate_status text not null default 'none'
    check (duplicate_status in ('none', 'possible', 'duplicate', 'kept', 'merged')),
  duplicate_group_id uuid references public.duplicate_groups(id) on delete set null,
  merged_into_id uuid references public.study_references(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refs_project_seq_idx on public.study_references(project_id, seq);
create index if not exists refs_project_ta_idx on public.study_references(project_id, title_abstract_decision);
create index if not exists refs_project_ft_idx on public.study_references(project_id, full_text_decision);
create index if not exists refs_project_doi_idx on public.study_references(project_id, doi_norm);
create index if not exists refs_project_pmid_idx on public.study_references(project_id, pmid);
create index if not exists refs_project_year_idx on public.study_references(project_id, year);
create index if not exists refs_project_source_idx on public.study_references(project_id, database_source);
create index if not exists refs_project_titlenorm_idx on public.study_references(project_id, title_norm);
create index if not exists refs_project_dup_idx on public.study_references(project_id, duplicate_status);
create index if not exists refs_project_created_idx on public.study_references(project_id, created_at);
create index if not exists refs_dupgroup_idx on public.study_references(duplicate_group_id);
create index if not exists refs_search_trgm_idx on public.study_references using gin (search_text extensions.gin_trgm_ops);
create index if not exists refs_title_trgm_idx on public.study_references using gin (title_norm extensions.gin_trgm_ops);
create index if not exists refs_tags_idx on public.study_references using gin (tag_names);

create or replace function public.refs_derive_fields()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.title_norm := public.norm_title(new.title);
  new.doi_norm := public.norm_doi(new.doi);
  new.search_text := lower(concat_ws(' ',
    new.title, new.abstract, new.authors, new.journal, new.doi, new.pmid,
    new.keywords, new.notes, array_to_string(new.tag_names, ' ')));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists refs_derive_fields_trg on public.study_references;
create trigger refs_derive_fields_trg
  before insert or update on public.study_references
  for each row execute function public.refs_derive_fields();

-- ---------------------------------------------------------------------------
-- Screening decisions (audit trail + per-reviewer current decision)
-- ---------------------------------------------------------------------------

-- Append-only history of every decision change. Never updated or deleted by
-- the application (no UPDATE/DELETE policies exist).
create table if not exists public.screening_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reference_id uuid not null references public.study_references(id) on delete cascade,
  reviewer_id uuid default auth.uid() references auth.users(id) on delete set null,
  stage text not null check (stage in ('title_abstract', 'full_text')),
  decision text check (decision in ('include', 'exclude', 'maybe')),   -- null = decision cleared
  exclusion_reason text,
  previous_decision text,
  previous_exclusion_reason text,
  action text not null default 'decide' check (action in ('decide', 'change', 'undo', 'clear', 'restore')),
  client_created_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists screening_decisions_ref_idx on public.screening_decisions(reference_id, created_at);
create index if not exists screening_decisions_project_idx on public.screening_decisions(project_id, created_at);

-- Current decision of each reviewer. In single-reviewer mode this mirrors the
-- final decision stored on study_references. In a future dual-reviewer mode,
-- conflicts are rows for the same (reference, stage) that disagree, and the
-- consensus is written to study_references.
create table if not exists public.reviewer_decisions (
  reference_id uuid not null references public.study_references(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  stage text not null check (stage in ('title_abstract', 'full_text')),
  project_id uuid not null references public.projects(id) on delete cascade,
  decision text not null check (decision in ('include', 'exclude', 'maybe')),
  exclusion_reason text,
  updated_at timestamptz not null default now(),
  primary key (reference_id, reviewer_id, stage)
);
create index if not exists reviewer_decisions_project_idx on public.reviewer_decisions(project_id, stage);

-- ---------------------------------------------------------------------------
-- Tags on references, full-text files, activity log
-- ---------------------------------------------------------------------------

create table if not exists public.reference_tags (
  reference_id uuid not null references public.study_references(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reference_id, tag_id)
);
create index if not exists reference_tags_tag_idx on public.reference_tags(tag_id);
create index if not exists reference_tags_project_idx on public.reference_tags(project_id);

create table if not exists public.full_text_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reference_id uuid not null references public.study_references(id) on delete cascade,
  storage_path text not null,
  file_name text,
  file_size bigint,
  content_type text,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists full_text_files_ref_idx on public.full_text_files(reference_id);
create index if not exists full_text_files_project_idx on public.full_text_files(project_id);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  user_email text default (auth.jwt() ->> 'email'),
  reference_id uuid references public.study_references(id) on delete set null,
  action text not null,
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_project_idx on public.activity_logs(project_id, created_at desc);
create index if not exists activity_logs_ref_idx on public.activity_logs(reference_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists project_settings_touch on public.project_settings;
create trigger project_settings_touch before update on public.project_settings
  for each row execute function public.touch_updated_at();

-- When a project is created: add the owner as a member, create settings and
-- the default exclusion reasons.
create or replace function public.on_project_created()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.project_members(project_id, user_id, role)
    values (new.id, new.owner_id, 'owner') on conflict do nothing;
  insert into public.project_settings(project_id) values (new.id) on conflict do nothing;
  insert into public.exclusion_reasons(project_id, label, sort_order)
  select new.id, r.label, r.ord
  from unnest(array[
    'Wrong population', 'Wrong intervention', 'Wrong exposure', 'Wrong outcome',
    'Wrong study design', 'Wrong publication type', 'Wrong language',
    'Outside date range', 'Not relevant', 'Duplicate', 'Conference abstract',
    'Full text unavailable', 'Other'
  ]) with ordinality as r(label, ord)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists projects_after_insert on public.projects;
create trigger projects_after_insert after insert on public.projects
  for each row execute function public.on_project_created();

-- Keep study_references.tag_names in sync with reference_tags (used for fast
-- filtering and search). Skipped during cascading deletes.
create or replace function public.sync_reference_tag_names()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.reference_id, old.reference_id);
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.study_references r
     set tag_names = coalesce((
       select array_agg(t.name order by lower(t.name))
         from public.reference_tags rt join public.tags t on t.id = rt.tag_id
        where rt.reference_id = rid), '{}')
   where r.id = rid;
  return null;
end $$;

drop trigger if exists reference_tags_sync on public.reference_tags;
create trigger reference_tags_sync after insert or delete on public.reference_tags
  for each row execute function public.sync_reference_tag_names();

create or replace function public.on_tag_changed()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    update public.study_references
       set tag_names = array_remove(tag_names, old.name)
     where project_id = old.project_id and old.name = any(tag_names);
    return old;
  elsif tg_op = 'UPDATE' and new.name is distinct from old.name then
    update public.study_references
       set tag_names = array_replace(tag_names, old.name, new.name)
     where project_id = old.project_id and old.name = any(tag_names);
  end if;
  return new;
end $$;

drop trigger if exists tags_changed on public.tags;
create trigger tags_changed before update or delete on public.tags
  for each row execute function public.on_tag_changed();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_settings enable row level security;
alter table public.exclusion_reasons enable row level security;
alter table public.tags enable row level security;
alter table public.import_batches enable row level security;
alter table public.duplicate_groups enable row level security;
alter table public.study_references enable row level security;
alter table public.screening_decisions enable row level security;
alter table public.reviewer_decisions enable row level security;
alter table public.reference_tags enable row level security;
alter table public.full_text_files enable row level security;
alter table public.activity_logs enable row level security;

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) or id in (select public.my_project_ids()));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using (owner_id = (select auth.uid()));

-- project_members: members can see the membership of their projects; only the
-- project owner can change membership.
drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists members_write on public.project_members;
create policy members_write on public.project_members for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- Generic "member of the project" policies for child tables.
do $$
declare
  t text;
begin
  foreach t in array array['project_settings', 'exclusion_reasons', 'tags', 'import_batches',
                           'duplicate_groups', 'study_references', 'reviewer_decisions',
                           'reference_tags', 'full_text_files']
  loop
    execute format('drop policy if exists %1$s_member_all on public.%1$I', t);
    execute format(
      'create policy %1$s_member_all on public.%1$I for all to authenticated
         using (project_id in (select public.my_project_ids()))
         with check (project_id in (select public.my_project_ids()))', t);
  end loop;
end $$;

-- Audit tables are append-only: select + insert, no update, no delete.
drop policy if exists screening_decisions_select on public.screening_decisions;
create policy screening_decisions_select on public.screening_decisions for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists screening_decisions_insert on public.screening_decisions;
create policy screening_decisions_insert on public.screening_decisions for insert to authenticated
  with check (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));

drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert on public.activity_logs for insert to authenticated
  with check (project_id in (select public.my_project_ids()) and user_id = (select auth.uid()));

-- The anonymous role gets nothing.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Consistency: a child row's project_id must match its parent reference.
-- (Prevents attaching a tag/decision to a reference in another project.)
-- ---------------------------------------------------------------------------

create or replace function public.check_reference_project()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.study_references r
                  where r.id = new.reference_id and r.project_id = new.project_id) then
    raise exception 'Reference does not belong to this project' using errcode = '42501';
  end if;
  -- to_jsonb() because only reference_tags has a tag_id column
  if tg_table_name = 'reference_tags' and not exists (
       select 1 from public.tags t
        where t.id = (to_jsonb(new) ->> 'tag_id')::uuid and t.project_id = new.project_id) then
    raise exception 'Tag does not belong to this project' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['reference_tags', 'screening_decisions', 'reviewer_decisions', 'full_text_files']
  loop
    execute format('drop trigger if exists %1$s_check_project on public.%1$I', t);
    execute format('create trigger %1$s_check_project before insert or update on public.%1$I
                    for each row execute function public.check_reference_project()', t);
  end loop;
end $$;

-- ============================================================================
-- Functions called by the app (all SECURITY INVOKER → RLS still applies)
-- ============================================================================

-- Record a screening decision atomically: updates the final decision, writes
-- the audit history row, the reviewer's current decision and the activity log.
-- Idempotent: repeating the same decision (e.g. a network retry) is a no-op.
create or replace function public.record_decision(
  p_reference_id uuid,
  p_stage text,
  p_decision text,
  p_reason text default null,
  p_action text default 'decide',
  p_client_ts timestamptz default null
)
returns public.study_references
language plpgsql
set search_path = ''
as $$
declare
  r public.study_references;
  prev_d text;
  prev_r text;
  v_action text := coalesce(p_action, 'decide');
  v_msg text;
  label_new text;
  label_old text;
begin
  if p_stage not in ('title_abstract', 'full_text') then
    raise exception 'Invalid screening stage' using errcode = '22023';
  end if;
  if p_decision is not null and p_decision not in ('include', 'exclude', 'maybe') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if p_stage = 'full_text' and p_decision = 'maybe' then
    raise exception 'Full-text screening only allows Include or Exclude' using errcode = '22023';
  end if;
  if p_decision is distinct from 'exclude' then
    p_reason := null;
  end if;
  p_reason := nullif(trim(p_reason), '');

  select * into r from public.study_references where id = p_reference_id for update;
  if not found then
    raise exception 'Reference not found' using errcode = 'P0002';
  end if;

  if p_stage = 'title_abstract' then
    prev_d := r.title_abstract_decision; prev_r := r.title_abstract_exclusion_reason;
  else
    prev_d := r.full_text_decision; prev_r := r.full_text_exclusion_reason;
  end if;

  if prev_d is not distinct from p_decision and prev_r is not distinct from p_reason then
    return r;  -- nothing changed (idempotent retry)
  end if;

  if p_stage = 'title_abstract' then
    update public.study_references
       set title_abstract_decision = p_decision,
           title_abstract_exclusion_reason = p_reason,
           title_abstract_screened_at = case when p_decision is null then null else now() end
     where id = p_reference_id
     returning * into r;
  else
    update public.study_references
       set full_text_decision = p_decision,
           full_text_exclusion_reason = p_reason,
           full_text_screened_at = case when p_decision is null then null else now() end,
           full_text_status = case when p_decision is not null and full_text_status = 'available'
                                   then 'reviewed' else full_text_status end
     where id = p_reference_id
     returning * into r;
  end if;

  if v_action = 'decide' and prev_d is not null then
    v_action := case when p_decision is null then 'clear' else 'change' end;
  end if;

  insert into public.screening_decisions(project_id, reference_id, reviewer_id, stage, decision,
      exclusion_reason, previous_decision, previous_exclusion_reason, action, client_created_at)
  values (r.project_id, r.id, auth.uid(), p_stage, p_decision, p_reason, prev_d, prev_r, v_action, p_client_ts);

  if p_decision is null then
    delete from public.reviewer_decisions
     where reference_id = r.id and reviewer_id = auth.uid() and stage = p_stage;
  else
    insert into public.reviewer_decisions(reference_id, reviewer_id, stage, project_id, decision, exclusion_reason, updated_at)
    values (r.id, auth.uid(), p_stage, r.project_id, p_decision, p_reason, now())
    on conflict (reference_id, reviewer_id, stage)
    do update set decision = excluded.decision, exclusion_reason = excluded.exclusion_reason, updated_at = now();
  end if;

  label_new := case p_decision when 'include' then 'Included' when 'exclude' then 'Excluded'
                               when 'maybe' then 'Maybe' else 'Unscreened' end;
  label_old := case prev_d when 'include' then 'Included' when 'exclude' then 'Excluded'
                           when 'maybe' then 'Maybe' else 'Unscreened' end;
  v_msg := case
    when v_action = 'undo' then 'Undo: restored ' || label_new || ' (was ' || label_old || ')'
    when prev_d is null then 'Screened as ' || label_new
    else 'Changed decision from ' || label_old || ' to ' || label_new
  end;
  if p_reason is not null then v_msg := v_msg || ' — ' || p_reason; end if;
  v_msg := v_msg || case when p_stage = 'full_text' then ' (full text)' else ' (title/abstract)' end;

  insert into public.activity_logs(project_id, reference_id, action, message, details)
  values (r.project_id, r.id, 'screening', v_msg,
          jsonb_build_object('stage', p_stage, 'decision', p_decision, 'reason', p_reason,
                             'previous_decision', prev_d, 'previous_reason', prev_r,
                             'action', v_action, 'title', left(r.title, 300)));
  return r;
end $$;

-- Screening statistics, computed from actual data (nothing is estimated).
create or replace function public.project_stats(p_project_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with r as (
    select * from public.study_references where project_id = p_project_id
  ), pool as (
    select * from r where duplicate_status not in ('duplicate', 'merged')
  ), s as (
    select * from public.project_settings where project_id = p_project_id
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'duplicates_removed', (select count(*) from r where duplicate_status in ('duplicate', 'merged')),
    'possible_duplicates', (select count(*) from r where duplicate_status = 'possible'),
    'after_dedup', (select count(*) from pool),
    'ta_screened', (select count(*) from pool where title_abstract_decision is not null),
    'ta_unscreened', (select count(*) from pool where title_abstract_decision is null),
    'ta_include', (select count(*) from pool where title_abstract_decision = 'include'),
    'ta_exclude', (select count(*) from pool where title_abstract_decision = 'exclude'),
    'ta_maybe', (select count(*) from pool where title_abstract_decision = 'maybe'),
    'ft_pool', (select count(*) from pool where title_abstract_decision = 'include'),
    'ft_screened', (select count(*) from pool where title_abstract_decision = 'include' and full_text_decision is not null),
    'ft_include', (select count(*) from pool where title_abstract_decision = 'include' and full_text_decision = 'include'),
    'ft_exclude', (select count(*) from pool where title_abstract_decision = 'include' and full_text_decision = 'exclude'),
    'ft_unscreened', (select count(*) from pool where title_abstract_decision = 'include' and full_text_decision is null),
    'ft_not_available', (select count(*) from pool where title_abstract_decision = 'include' and full_text_status = 'not_available'),
    'stage2_enabled', coalesce((select stage2_enabled from s), true),
    'additional_records_other_sources', coalesce((select additional_records_other_sources from s), 0),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', src, 'count', n) order by n desc)
                    from (select coalesce(nullif(database_source, ''), 'Not specified') src, count(*) n from r group by 1) x), '[]'::jsonb),
    'ta_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc)
                    from (select coalesce(title_abstract_exclusion_reason, 'No reason given') reason, count(*) n
                            from pool where title_abstract_decision = 'exclude' group by 1) x), '[]'::jsonb),
    'ft_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc)
                    from (select coalesce(full_text_exclusion_reason, 'No reason given') reason, count(*) n
                            from pool where title_abstract_decision = 'include' and full_text_decision = 'exclude' group by 1) x), '[]'::jsonb),
    'by_year', coalesce((select jsonb_agg(jsonb_build_object('year', year, 'count', n) order by year)
                    from (select year, count(*) n from pool where year is not null group by 1) x), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('file_name', file_name, 'database_source', database_source,
                          'records_imported', records_imported, 'created_at', created_at) order by created_at)
                    from public.import_batches where project_id = p_project_id), '[]'::jsonb)
  )
$$;

-- Overview of all my projects (for the projects list).
create or replace function public.my_projects_overview()
returns table (
  id uuid, title text, research_question text, review_type text, is_demo boolean,
  created_at timestamptz, updated_at timestamptz,
  total bigint, duplicates bigint, screened bigint, unscreened bigint, included bigint, excluded bigint, maybe bigint,
  last_activity timestamptz
)
language sql stable
set search_path = ''
as $$
  select p.id, p.title, p.research_question, p.review_type, p.is_demo, p.created_at, p.updated_at,
    count(r.id),
    count(r.id) filter (where r.duplicate_status in ('duplicate', 'merged')),
    count(r.id) filter (where r.duplicate_status not in ('duplicate', 'merged') and r.title_abstract_decision is not null),
    count(r.id) filter (where r.duplicate_status not in ('duplicate', 'merged') and r.title_abstract_decision is null),
    count(r.id) filter (where r.duplicate_status not in ('duplicate', 'merged') and r.title_abstract_decision = 'include'),
    count(r.id) filter (where r.duplicate_status not in ('duplicate', 'merged') and r.title_abstract_decision = 'exclude'),
    count(r.id) filter (where r.duplicate_status not in ('duplicate', 'merged') and r.title_abstract_decision = 'maybe'),
    (select max(a.created_at) from public.activity_logs a where a.project_id = p.id)
  from public.projects p
  left join public.study_references r on r.project_id = p.id
  group by p.id
  order by coalesce((select max(a.created_at) from public.activity_logs a where a.project_id = p.id), p.created_at) desc
$$;

-- Distinct values for filter dropdowns.
create or replace function public.project_facets(p_project_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'sources', coalesce((select jsonb_agg(v order by v) from (select distinct database_source v from public.study_references
                where project_id = p_project_id and database_source is not null and database_source <> '') x), '[]'::jsonb),
    'publication_types', coalesce((select jsonb_agg(v order by v) from (select distinct publication_type v from public.study_references
                where project_id = p_project_id and publication_type is not null and publication_type <> '') x), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(v order by v) from (select distinct language v from public.study_references
                where project_id = p_project_id and language is not null and language <> '') x), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(v order by v) from (
                select title_abstract_exclusion_reason v from public.study_references
                 where project_id = p_project_id and title_abstract_exclusion_reason is not null
                union
                select full_text_exclusion_reason from public.study_references
                 where project_id = p_project_id and full_text_exclusion_reason is not null) x), '[]'::jsonb),
    'min_year', (select min(year) from public.study_references where project_id = p_project_id),
    'max_year', (select max(year) from public.study_references where project_id = p_project_id)
  )
$$;

-- Import preview: which of the candidate records already exist in the project
-- (exact DOI, PMID, or normalised title + year). Returns the matching indexes.
create or replace function public.preview_existing_matches(p_project_id uuid, p_items jsonb)
returns table (idx integer, match_type text)
language sql stable
set search_path = ''
as $$
  with items as (
    select (e->>'i')::int i, nullif(e->>'doi', '') doi, nullif(e->>'pmid', '') pmid,
           nullif(e->>'title_norm', '') tn, nullif(e->>'year', '')::int yr
      from jsonb_array_elements(p_items) e
  )
  select i.i,
    case
      when i.doi is not null and exists (select 1 from public.study_references r
            where r.project_id = p_project_id and r.doi_norm = i.doi) then 'doi'
      when i.pmid is not null and exists (select 1 from public.study_references r
            where r.project_id = p_project_id and r.pmid = i.pmid) then 'pmid'
      when i.tn is not null and exists (select 1 from public.study_references r
            where r.project_id = p_project_id and r.title_norm = i.tn
              and (r.year is not distinct from i.yr or r.year is null or i.yr is null)) then 'title_year'
    end
  from items i
  where (i.doi is not null and exists (select 1 from public.study_references r where r.project_id = p_project_id and r.doi_norm = i.doi))
     or (i.pmid is not null and exists (select 1 from public.study_references r where r.project_id = p_project_id and r.pmid = i.pmid))
     or (i.tn is not null and exists (select 1 from public.study_references r where r.project_id = p_project_id and r.title_norm = i.tn
              and (r.year is not distinct from i.yr or r.year is null or i.yr is null)))
$$;

-- Duplicate candidate pairs for a batch of references (checked against the
-- whole project). Strategies: exact DOI, exact PMID, normalised title + year,
-- fuzzy title similarity (pg_trgm). Records already resolved as duplicate /
-- merged are ignored. Nothing is changed; the caller groups the pairs.
create or replace function public.find_duplicate_pairs(
  p_project_id uuid,
  p_reference_ids uuid[],
  p_threshold real default 0.85
)
returns table (a uuid, b uuid, match_type text, score real)
language plpgsql stable
-- SECURITY DEFINER: under row-level security Postgres cannot use the trigram
-- index for the (non-leakproof) % operator, which made fuzzy matching ~20x
-- slower. Access is checked explicitly below instead, and every query is
-- restricted to p_project_id. The function only reads data.
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.project_members m
                  where m.project_id = p_project_id and m.user_id = auth.uid()) then
    raise exception 'You do not have access to this project' using errcode = '42501';
  end if;
  perform set_config('pg_trgm.similarity_threshold', p_threshold::text, true);
  -- Note: the other side of each join reads study_references directly (not a
  -- CTE) so that the DOI / PMID / title b-tree indexes and the trigram GIN
  -- index are used. A CTE referenced several times is materialised without
  -- indexes, which turned the fuzzy join into a full cross product.
  return query
  with src as materialized (
    select r.id, r.doi_norm, r.pmid, r.title_norm, r.year from public.study_references r
     where r.project_id = p_project_id and r.id = any(p_reference_ids)
       and r.duplicate_status not in ('duplicate', 'merged')
  ), pairs as (
    select s.id a, o.id b, 'doi'::text mt, 1.0::real sc
      from src s join public.study_references o
        on o.project_id = p_project_id and o.doi_norm = s.doi_norm and o.id <> s.id
       and o.duplicate_status not in ('duplicate', 'merged')
     where s.doi_norm is not null
    union all
    select s.id, o.id, 'pmid', 1.0::real
      from src s join public.study_references o
        on o.project_id = p_project_id and o.pmid = s.pmid and o.id <> s.id
       and o.duplicate_status not in ('duplicate', 'merged')
     where s.pmid is not null and s.pmid <> ''
    union all
    select s.id, o.id, 'title_year', 1.0::real
      from src s join public.study_references o
        on o.project_id = p_project_id and o.title_norm = s.title_norm and o.id <> s.id
       and o.duplicate_status not in ('duplicate', 'merged')
       and (o.year is not distinct from s.year or o.year is null or s.year is null)
     where s.title_norm is not null and length(s.title_norm) >= 10
    union all
    select s.id, o.id, 'fuzzy_title', similarity(s.title_norm, o.title_norm)
      from src s join public.study_references o
        on o.title_norm % s.title_norm and o.project_id = p_project_id and o.id <> s.id
       and o.duplicate_status not in ('duplicate', 'merged')
       and o.title_norm <> s.title_norm
       and (o.year is not distinct from s.year or o.year is null or s.year is null
            or abs(o.year - s.year) <= 1)
       and abs(length(o.title_norm) - length(s.title_norm)) <= greatest(8, length(s.title_norm) / 5)
     where s.title_norm is not null and length(s.title_norm) >= 20
  )
  select distinct on (least(p.a, p.b), greatest(p.a, p.b))
         least(p.a, p.b), greatest(p.a, p.b), p.mt, p.sc
    from pairs p
    -- Pairs where both records were already reviewed as "kept" are not re-flagged.
   where not exists (
       select 1 from public.study_references x, public.study_references y
        where x.id = p.a and y.id = p.b and x.duplicate_status = 'kept' and y.duplicate_status = 'kept'
          and x.duplicate_group_id is not null and x.duplicate_group_id = y.duplicate_group_id)
   order by least(p.a, p.b), greatest(p.a, p.b),
            case p.mt when 'doi' then 1 when 'pmid' then 2 when 'title_year' then 3 else 4 end;
end $$;

-- Create/extend duplicate groups from connected components computed by the
-- client. p_groups: [{"ids": [uuid, ...], "match_type": "doi", "score": 1.0}]
create or replace function public.apply_duplicate_groups(p_project_id uuid, p_groups jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  g jsonb;
  ids uuid[];
  existing uuid;
  gid uuid;
  n integer := 0;
begin
  for g in select * from jsonb_array_elements(p_groups) loop
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(g->'ids') x;
    if ids is null or array_length(ids, 1) < 2 then continue; end if;

    -- Reuse an existing open group if any member already belongs to one.
    select r.duplicate_group_id into existing
      from public.study_references r
      join public.duplicate_groups dg on dg.id = r.duplicate_group_id
     where r.project_id = p_project_id and r.id = any(ids) and dg.status = 'open'
     limit 1;

    if existing is null then
      insert into public.duplicate_groups(project_id, match_type, match_score)
      values (p_project_id, coalesce(g->>'match_type', 'fuzzy_title'), (g->>'score')::real)
      returning id into gid;
    else
      gid := existing;
      -- A previously resolved group gets reopened if a new member joins.
    end if;

    update public.study_references
       set duplicate_group_id = gid,
           duplicate_status = case when duplicate_status in ('none', 'kept') then 'possible' else duplicate_status end
     where project_id = p_project_id and id = any(ids)
       and duplicate_status not in ('duplicate', 'merged');

    -- Pull in members of any other open group that overlaps (merge groups).
    update public.study_references
       set duplicate_group_id = gid
     where project_id = p_project_id
       and duplicate_group_id in (
         select distinct r.duplicate_group_id from public.study_references r
          join public.duplicate_groups dg on dg.id = r.duplicate_group_id and dg.status = 'open'
          where r.id = any(ids) and r.duplicate_group_id <> gid);
    n := n + 1;
  end loop;

  delete from public.duplicate_groups dg
   where dg.project_id = p_project_id and dg.status = 'open'
     and not exists (select 1 from public.study_references r where r.duplicate_group_id = dg.id);
  return n;
end $$;

-- Resolve a duplicate group.
--   p_action = 'keep_all'   → all members kept (not duplicates)
--   p_action = 'mark'       → primary kept, the others marked duplicate (removed from screening)
--   p_action = 'merge'      → primary receives p_merged (most complete metadata), others marked merged
-- A snapshot of every member is stored so the resolution is auditable and reversible.
create or replace function public.resolve_duplicate_group(
  p_group_id uuid,
  p_action text,
  p_primary_id uuid default null,
  p_merged jsonb default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  grp public.duplicate_groups;
  snap jsonb;
  cnt integer;
begin
  select * into grp from public.duplicate_groups where id = p_group_id for update;
  if not found then raise exception 'Duplicate group not found' using errcode = 'P0002'; end if;
  if p_action not in ('keep_all', 'mark', 'merge') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  if p_action in ('mark', 'merge') and not exists (
      select 1 from public.study_references where id = p_primary_id and duplicate_group_id = p_group_id) then
    raise exception 'The primary record must belong to the group' using errcode = '22023';
  end if;

  select jsonb_agg(to_jsonb(r) - 'search_text' - 'original_record'), count(*)
    into snap, cnt
    from public.study_references r where r.duplicate_group_id = p_group_id;

  if p_action = 'keep_all' then
    update public.study_references set duplicate_status = 'kept'
     where duplicate_group_id = p_group_id;
  elsif p_action = 'mark' then
    update public.study_references set duplicate_status = 'kept' where id = p_primary_id;
    update public.study_references set duplicate_status = 'duplicate', merged_into_id = p_primary_id
     where duplicate_group_id = p_group_id and id <> p_primary_id;
  else
    update public.study_references set
      title = coalesce(p_merged->>'title', title),
      authors = coalesce(p_merged->>'authors', authors),
      abstract = coalesce(p_merged->>'abstract', abstract),
      year = coalesce((p_merged->>'year')::int, year),
      journal = coalesce(p_merged->>'journal', journal),
      volume = coalesce(p_merged->>'volume', volume),
      issue = coalesce(p_merged->>'issue', issue),
      pages = coalesce(p_merged->>'pages', pages),
      doi = coalesce(p_merged->>'doi', doi),
      pmid = coalesce(p_merged->>'pmid', pmid),
      url = coalesce(p_merged->>'url', url),
      keywords = coalesce(p_merged->>'keywords', keywords),
      publication_type = coalesce(p_merged->>'publication_type', publication_type),
      database_source = coalesce(p_merged->>'database_source', database_source),
      language = coalesce(p_merged->>'language', language),
      duplicate_status = 'kept'
     where id = p_primary_id;
    update public.study_references set duplicate_status = 'merged', merged_into_id = p_primary_id
     where duplicate_group_id = p_group_id and id <> p_primary_id;
  end if;

  update public.duplicate_groups set
    status = 'resolved',
    resolution = case p_action when 'keep_all' then 'kept_all' when 'mark' then 'marked_duplicate' else 'merged' end,
    primary_reference_id = p_primary_id,
    resolution_details = jsonb_build_object('before', snap, 'merged_fields', p_merged),
    resolved_at = now()
   where id = p_group_id;

  insert into public.activity_logs(project_id, reference_id, action, message, details)
  values (grp.project_id, p_primary_id, 'duplicates',
          case p_action
            when 'keep_all' then 'Kept all ' || cnt || ' records (not duplicates)'
            when 'mark' then 'Marked ' || (cnt - 1) || ' record(s) as duplicate'
            else 'Merged ' || cnt || ' duplicate records' end,
          jsonb_build_object('group_id', p_group_id, 'action', p_action, 'primary_id', p_primary_id,
                             'merged_fields', p_merged));
end $$;

-- Reopen a resolved group: restores every member's metadata and status from
-- the snapshot taken at resolution time.
create or replace function public.reopen_duplicate_group(p_group_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  grp public.duplicate_groups;
  m jsonb;
begin
  select * into grp from public.duplicate_groups where id = p_group_id for update;
  if not found then raise exception 'Duplicate group not found' using errcode = 'P0002'; end if;
  if grp.status <> 'resolved' then return; end if;

  for m in select * from jsonb_array_elements(coalesce(grp.resolution_details->'before', '[]'::jsonb)) loop
    update public.study_references set
      title = m->>'title', authors = m->>'authors', abstract = m->>'abstract',
      year = (m->>'year')::int, journal = m->>'journal', volume = m->>'volume', issue = m->>'issue',
      pages = m->>'pages', doi = m->>'doi', pmid = m->>'pmid', url = m->>'url', keywords = m->>'keywords',
      publication_type = m->>'publication_type', database_source = m->>'database_source',
      language = m->>'language',
      duplicate_status = 'possible', merged_into_id = null, duplicate_group_id = p_group_id
     where id = (m->>'id')::uuid and project_id = grp.project_id;
  end loop;

  update public.duplicate_groups
     set status = 'open', resolution = null, resolved_at = null
   where id = p_group_id;

  insert into public.activity_logs(project_id, action, message, details)
  values (grp.project_id, 'duplicates', 'Reopened duplicate group (previous resolution undone)',
          jsonb_build_object('group_id', p_group_id, 'previous', grp.resolution_details));
end $$;

-- Manually mark / unmark a single record as duplicate from the screening page.
create or replace function public.set_duplicate_status(p_reference_id uuid, p_status text)
returns public.study_references
language plpgsql
set search_path = ''
as $$
declare
  r public.study_references;
  prev text;
begin
  if p_status not in ('none', 'duplicate', 'kept') then
    raise exception 'Invalid duplicate status' using errcode = '22023';
  end if;
  select duplicate_status into prev from public.study_references where id = p_reference_id;
  if not found then raise exception 'Reference not found' using errcode = 'P0002'; end if;
  update public.study_references set duplicate_status = p_status,
         merged_into_id = case when p_status = 'duplicate' then merged_into_id else null end
   where id = p_reference_id returning * into r;
  insert into public.activity_logs(project_id, reference_id, action, message, details)
  values (r.project_id, r.id, 'duplicates',
          case p_status when 'duplicate' then 'Marked duplicate' when 'kept' then 'Marked not a duplicate'
                        else 'Cleared duplicate status' end,
          jsonb_build_object('previous', prev, 'new', p_status, 'title', left(r.title, 300)));
  return r;
end $$;

grant execute on function public.record_decision(uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.project_stats(uuid) to authenticated;
grant execute on function public.my_projects_overview() to authenticated;
grant execute on function public.project_facets(uuid) to authenticated;
grant execute on function public.preview_existing_matches(uuid, jsonb) to authenticated;
grant execute on function public.find_duplicate_pairs(uuid, uuid[], real) to authenticated;
grant execute on function public.apply_duplicate_groups(uuid, jsonb) to authenticated;
grant execute on function public.resolve_duplicate_group(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.reopen_duplicate_group(uuid) to authenticated;
grant execute on function public.set_duplicate_status(uuid, text) to authenticated;

revoke execute on function public.record_decision(uuid, text, text, text, text, timestamptz) from anon, public;
revoke execute on function public.project_stats(uuid) from anon, public;
revoke execute on function public.my_projects_overview() from anon, public;
revoke execute on function public.project_facets(uuid) from anon, public;
revoke execute on function public.preview_existing_matches(uuid, jsonb) from anon, public;
revoke execute on function public.find_duplicate_pairs(uuid, uuid[], real) from anon, public;
revoke execute on function public.apply_duplicate_groups(uuid, jsonb) from anon, public;
revoke execute on function public.resolve_duplicate_group(uuid, text, uuid, jsonb) from anon, public;
revoke execute on function public.reopen_duplicate_group(uuid) from anon, public;
revoke execute on function public.set_duplicate_status(uuid, text) from anon, public;

-- ============================================================================
-- Storage: private bucket for uploaded full-text PDFs.
-- Object paths are "<project_id>/<reference_id>/<file name>".
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('full-texts', 'full-texts', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "screenlab full-texts select" on storage.objects;
create policy "screenlab full-texts select" on storage.objects for select to authenticated
  using (bucket_id = 'full-texts'
         and (storage.foldername(name))[1] in (select id::text from public.my_project_ids() as id));
drop policy if exists "screenlab full-texts insert" on storage.objects;
create policy "screenlab full-texts insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'full-texts'
         and (storage.foldername(name))[1] in (select id::text from public.my_project_ids() as id));
drop policy if exists "screenlab full-texts delete" on storage.objects;
create policy "screenlab full-texts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'full-texts'
         and (storage.foldername(name))[1] in (select id::text from public.my_project_ids() as id));

-- Trigger functions are not meant to be called through the API.
revoke execute on function public.on_project_created() from public, anon, authenticated;
revoke execute on function public.sync_reference_tag_names() from public, anon, authenticated;
revoke execute on function public.on_tag_changed() from public, anon, authenticated;
revoke execute on function public.check_reference_project() from public, anon, authenticated;
revoke execute on function public.refs_derive_fields() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
