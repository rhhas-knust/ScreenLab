-- Review team and data extraction.
--
-- Team: the project owner adds co-reviewers by the email they signed up with.
-- Extraction: every reviewer fills in their own form per included study. Forms
-- are blinded: a reviewer sees another reviewer's extraction only after
-- completing their own for that study (or, as a third-person arbiter with no
-- extraction of their own, once two are complete). Agreed values are saved as
-- the final extraction, which is what tables and the PRISMA tier counts use.

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------

-- Members of a project the caller belongs to, with their email addresses.
create or replace function public.project_team(p_project_id uuid)
returns table (user_id uuid, email text, role text, added_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at
    from public.project_members m join auth.users u on u.id = m.user_id
   where m.project_id = p_project_id
     and p_project_id in (select public.my_project_ids())
   order by (m.role = 'owner') desc, m.created_at
$$;
revoke all on function public.project_team(uuid) from public, anon;
grant execute on function public.project_team(uuid) to authenticated;

-- Owner adds a co-reviewer who already has a ScreenLab account.
create or replace function public.add_project_member(p_project_id uuid, p_email text, p_role text default 'reviewer')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = (select auth.uid())) then
    raise exception 'Only the project owner can add team members' using errcode = '42501';
  end if;
  if p_role not in ('reviewer', 'viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'No ScreenLab account uses that email. Ask them to sign up first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = v_user and m.role = 'owner') then
    return v_user;
  end if;
  insert into public.project_members(project_id, user_id, role) values (p_project_id, v_user, p_role)
    on conflict (project_id, user_id) do update set role = excluded.role;
  insert into public.activity_logs(project_id, user_id, action, message)
    values (p_project_id, (select auth.uid()), 'team', 'Added a team member (' || p_role || ')');
  return v_user;
end $$;
revoke all on function public.add_project_member(uuid, text, text) from public, anon;
grant execute on function public.add_project_member(uuid, text, text) to authenticated;

-- The owner can never be removed through the members table.
drop policy if exists members_write on public.project_members;
create policy members_write on public.project_members for all to authenticated
  using (role <> 'owner' and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (role <> 'owner' and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Extraction
-- ---------------------------------------------------------------------------

create table if not exists public.extractions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reference_id uuid not null references public.study_references(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 200000),
  status text not null default 'draft' check (status in ('draft', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference_id, reviewer_id)
);
create index if not exists extractions_project_idx on public.extractions(project_id);

create table if not exists public.extraction_final (
  reference_id uuid primary key references public.study_references(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 200000),
  finalised_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists extraction_final_project_idx on public.extraction_final(project_id);

drop trigger if exists extractions_touch on public.extractions;
create trigger extractions_touch before update on public.extractions for each row execute function public.touch_updated_at();
drop trigger if exists extraction_final_touch on public.extraction_final;
create trigger extraction_final_touch before update on public.extraction_final for each row execute function public.touch_updated_at();
drop trigger if exists extractions_ref_project on public.extractions;
create trigger extractions_ref_project before insert or update on public.extractions for each row execute function public.check_reference_project();
drop trigger if exists extraction_final_ref_project on public.extraction_final;
create trigger extraction_final_ref_project before insert or update on public.extraction_final for each row execute function public.check_reference_project();

-- Blinding rule (SECURITY DEFINER so the policy can look at other rows of the same table).
create or replace function public.can_see_extraction(p_reference_id uuid, p_reviewer_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_reviewer_id = (select auth.uid())
      or exists (select 1 from public.extractions e
                  where e.reference_id = p_reference_id and e.reviewer_id = (select auth.uid()) and e.status = 'complete')
      or (not exists (select 1 from public.extractions e where e.reference_id = p_reference_id and e.reviewer_id = (select auth.uid()))
          and (select count(*) from public.extractions e where e.reference_id = p_reference_id and e.status = 'complete') >= 2)
$$;
revoke all on function public.can_see_extraction(uuid, uuid) from public, anon;
grant execute on function public.can_see_extraction(uuid, uuid) to authenticated;

alter table public.extractions enable row level security;
alter table public.extraction_final enable row level security;

drop policy if exists extractions_select on public.extractions;
create policy extractions_select on public.extractions for select to authenticated
  using (project_id in (select public.my_project_ids()) and public.can_see_extraction(reference_id, reviewer_id));
drop policy if exists extractions_insert on public.extractions;
create policy extractions_insert on public.extractions for insert to authenticated
  with check (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));
drop policy if exists extractions_update on public.extractions;
create policy extractions_update on public.extractions for update to authenticated
  using (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()))
  with check (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));
drop policy if exists extractions_delete on public.extractions;
create policy extractions_delete on public.extractions for delete to authenticated
  using (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));

drop policy if exists extraction_final_all on public.extraction_final;
create policy extraction_final_all on public.extraction_final for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

revoke all on public.extractions, public.extraction_final from anon;
grant select, insert, update, delete on public.extractions, public.extraction_final to authenticated;

-- Progress per included study: who has extracted (status only, never the data),
-- and the final tier. Included = full-text include, or title/abstract include
-- when full-text screening is switched off.
create or replace function public.extraction_progress(p_project_id uuid)
returns table (
  reference_id uuid, seq bigint, title text, authors text, year integer, journal text,
  my_status text, complete_count integer, started_count integer, has_final boolean, final_tier text
)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.seq, r.title, r.authors, r.year, r.journal,
    (select e.status from public.extractions e where e.reference_id = r.id and e.reviewer_id = (select auth.uid())),
    (select count(*)::int from public.extractions e where e.reference_id = r.id and e.status = 'complete'),
    (select count(*)::int from public.extractions e where e.reference_id = r.id),
    f.reference_id is not null,
    f.data->>'tier'
  from public.study_references r
  join public.project_settings s on s.project_id = r.project_id
  left join public.extraction_final f on f.reference_id = r.id
  where r.project_id = p_project_id
    and p_project_id in (select public.my_project_ids())
    and r.duplicate_status not in ('duplicate', 'merged')
    and (case when s.stage2_enabled then r.full_text_decision = 'include' else r.title_abstract_decision = 'include' end)
  order by r.seq
$$;
revoke all on function public.extraction_progress(uuid) from public, anon;
grant execute on function public.extraction_progress(uuid) to authenticated;
