-- Independent (dual) screening with blinding and conflicts, as in Rayyan.
--
-- project_settings.screening_mode:
--   'single'  every reviewer edits one shared decision per record (as before).
--   'dual'    each reviewer records their own decision; the record's final
--             decision is set only when at least two reviewers agree. When they
--             disagree the record is a conflict until someone resolves it.
-- project_settings.blind (dual only): a reviewer cannot see a co-reviewer's
-- decision on a record until they have recorded their own (enforced by RLS on
-- reviewer_decisions). With blind off, everyone sees every decision.
--
-- Reads go through the screening_refs view, which adds the caller's own
-- decision on each record (my_title_abstract_decision, …) for filtering.

alter table public.project_settings add column if not exists blind boolean not null default true;

alter table public.study_references
  add column if not exists title_abstract_conflict boolean not null default false,
  add column if not exists full_text_conflict boolean not null default false,
  add column if not exists title_abstract_resolved boolean not null default false,
  add column if not exists full_text_resolved boolean not null default false;
create index if not exists refs_ta_conflict_idx on public.study_references(project_id) where title_abstract_conflict;
create index if not exists refs_ft_conflict_idx on public.study_references(project_id) where full_text_conflict;

alter table public.screening_decisions drop constraint if exists screening_decisions_action_check;
alter table public.screening_decisions add constraint screening_decisions_action_check
  check (action in ('decide', 'change', 'undo', 'clear', 'restore', 'resolve'));

-- ---------------------------------------------------------------------------
-- Who may see a reviewer's decision.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_vote(p_project_id uuid, p_reference_id uuid, p_stage text, p_reviewer_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select p_reviewer_id = (select auth.uid())
      or coalesce((select not (s.screening_mode = 'dual' and s.blind) from public.project_settings s where s.project_id = p_project_id), true)
      or exists (select 1 from public.reviewer_decisions d
                  where d.reference_id = p_reference_id and d.stage = p_stage and d.reviewer_id = (select auth.uid()))
$$;
revoke all on function public.can_see_vote(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.can_see_vote(uuid, uuid, text, uuid) to authenticated;

drop policy if exists reviewer_decisions_member_all on public.reviewer_decisions;
drop policy if exists reviewer_decisions_select on public.reviewer_decisions;
drop policy if exists reviewer_decisions_own_write on public.reviewer_decisions;
drop policy if exists reviewer_decisions_own_update on public.reviewer_decisions;
drop policy if exists reviewer_decisions_own_delete on public.reviewer_decisions;
create policy reviewer_decisions_select on public.reviewer_decisions for select to authenticated
  using (project_id in (select public.my_project_ids()) and public.can_see_vote(project_id, reference_id, stage, reviewer_id));
create policy reviewer_decisions_own_write on public.reviewer_decisions for insert to authenticated
  with check (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));
create policy reviewer_decisions_own_update on public.reviewer_decisions for update to authenticated
  using (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()))
  with check (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));
create policy reviewer_decisions_own_delete on public.reviewer_decisions for delete to authenticated
  using (project_id in (select public.my_project_ids()) and reviewer_id = (select auth.uid()));

-- The decision history follows the same rule; resolutions are visible to all.
drop policy if exists screening_decisions_select on public.screening_decisions;
create policy screening_decisions_select on public.screening_decisions for select to authenticated
  using (project_id in (select public.my_project_ids())
         and (action = 'resolve' or reviewer_id is null or public.can_see_vote(project_id, reference_id, stage, reviewer_id)));

-- ---------------------------------------------------------------------------
-- Final decision of a record in dual mode, from the reviewers' decisions.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_final(p_reference_id uuid, p_stage text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
  kinds int;
  d text;
  why text;
  resolved boolean;
begin
  select case when p_stage = 'title_abstract' then title_abstract_resolved else full_text_resolved end
    into resolved from public.study_references
   where id = p_reference_id and project_id in (select public.my_project_ids());
  if resolved is null or resolved then
    return;  -- a resolution stands until someone resolves it again
  end if;
  select count(*), count(distinct decision) into n, kinds
    from public.reviewer_decisions where reference_id = p_reference_id and stage = p_stage;
  if n >= 2 and kinds = 1 then
    select decision, exclusion_reason into d, why
      from public.reviewer_decisions where reference_id = p_reference_id and stage = p_stage
     order by updated_at limit 1;
  else
    d := null; why := null;
  end if;
  if p_stage = 'title_abstract' then
    update public.study_references
       set title_abstract_decision = d, title_abstract_exclusion_reason = why,
           title_abstract_screened_at = case when d is null then null else coalesce(title_abstract_screened_at, now()) end,
           title_abstract_conflict = (n >= 2 and kinds > 1)
     where id = p_reference_id;
  else
    update public.study_references
       set full_text_decision = d, full_text_exclusion_reason = why,
           full_text_screened_at = case when d is null then null else coalesce(full_text_screened_at, now()) end,
           full_text_conflict = (n >= 2 and kinds > 1),
           full_text_status = case when d is not null and full_text_status = 'available' then 'reviewed' else full_text_status end
     where id = p_reference_id;
  end if;
end $$;
revoke all on function public.recompute_final(uuid, text) from public, anon;
grant execute on function public.recompute_final(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_decision: unchanged in single mode; in dual mode it records the
-- caller's own decision, or (p_action = 'resolve') settles the record.
-- ---------------------------------------------------------------------------
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
  v_dual boolean;
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
  select coalesce((select s.screening_mode = 'dual' from public.project_settings s where s.project_id = r.project_id), false) into v_dual;

  if v_dual and v_action = 'resolve' then
    if exists (select 1 from public.project_members m where m.project_id = r.project_id and m.user_id = (select auth.uid()) and m.role = 'viewer') then
      raise exception 'Viewers cannot resolve conflicts' using errcode = '42501';
    end if;
  elsif v_action = 'resolve' then
    v_action := 'decide';  -- single mode: a resolution is just the shared decision
  end if;

  -- Previous value: the record's final decision (single mode, resolve) or the caller's own (dual).
  if v_dual and v_action <> 'resolve' then
    select d.decision, d.exclusion_reason into prev_d, prev_r
      from public.reviewer_decisions d where d.reference_id = r.id and d.stage = p_stage and d.reviewer_id = (select auth.uid());
  elsif p_stage = 'title_abstract' then
    prev_d := r.title_abstract_decision; prev_r := r.title_abstract_exclusion_reason;
  else
    prev_d := r.full_text_decision; prev_r := r.full_text_exclusion_reason;
  end if;

  if v_action <> 'resolve' and prev_d is not distinct from p_decision and prev_r is not distinct from p_reason then
    return r;  -- nothing changed (idempotent retry)
  end if;

  if not v_dual or v_action = 'resolve' then
    if p_stage = 'title_abstract' then
      update public.study_references
         set title_abstract_decision = p_decision,
             title_abstract_exclusion_reason = p_reason,
             title_abstract_screened_at = case when p_decision is null then null else now() end,
             title_abstract_conflict = false,
             title_abstract_resolved = (v_action = 'resolve' and p_decision is not null)
       where id = p_reference_id
       returning * into r;
    else
      update public.study_references
         set full_text_decision = p_decision,
             full_text_exclusion_reason = p_reason,
             full_text_screened_at = case when p_decision is null then null else now() end,
             full_text_status = case when p_decision is not null and full_text_status = 'available'
                                     then 'reviewed' else full_text_status end,
             full_text_conflict = false,
             full_text_resolved = (v_action = 'resolve' and p_decision is not null)
       where id = p_reference_id
       returning * into r;
    end if;
  end if;

  if v_action = 'decide' and prev_d is not null then
    v_action := case when p_decision is null then 'clear' else 'change' end;
  end if;

  insert into public.screening_decisions(project_id, reference_id, reviewer_id, stage, decision,
      exclusion_reason, previous_decision, previous_exclusion_reason, action, client_created_at)
  values (r.project_id, r.id, auth.uid(), p_stage, p_decision, p_reason, prev_d, prev_r, v_action, p_client_ts);

  -- The caller's own decision. A resolution leaves reviewers' decisions as they were.
  if v_action <> 'resolve' then
    if p_decision is null then
      delete from public.reviewer_decisions
       where reference_id = r.id and reviewer_id = auth.uid() and stage = p_stage;
    else
      insert into public.reviewer_decisions(reference_id, reviewer_id, stage, project_id, decision, exclusion_reason, updated_at)
      values (r.id, auth.uid(), p_stage, r.project_id, p_decision, p_reason, now())
      on conflict (reference_id, reviewer_id, stage)
      do update set decision = excluded.decision, exclusion_reason = excluded.exclusion_reason, updated_at = now();
    end if;
    if v_dual then
      perform public.recompute_final(r.id, p_stage);
      select * into r from public.study_references where id = r.id;
    end if;
  end if;

  label_new := case p_decision when 'include' then 'Included' when 'exclude' then 'Excluded'
                               when 'maybe' then 'Maybe' else 'Unscreened' end;
  label_old := case prev_d when 'include' then 'Included' when 'exclude' then 'Excluded'
                           when 'maybe' then 'Maybe' else 'Unscreened' end;
  v_msg := case
    when v_action = 'resolve' then 'Resolved as ' || label_new
    when v_action = 'undo' then 'Undo: restored ' || label_new || ' (was ' || label_old || ')'
    when prev_d is null then 'Screened as ' || label_new
    else 'Changed decision from ' || label_old || ' to ' || label_new
  end;
  if p_reason is not null then v_msg := v_msg || ' — ' || p_reason; end if;
  v_msg := v_msg || case when p_stage = 'full_text' then ' (full text)' else ' (title/abstract)' end;

  -- In blind dual mode the log must not reveal a reviewer's decision to the others.
  insert into public.activity_logs(project_id, reference_id, action, message, details)
  values (r.project_id, r.id, 'screening',
          case when v_dual and v_action <> 'resolve' and coalesce((select blind from public.project_settings where project_id = r.project_id), true)
               then 'Screened independently' || case when p_stage = 'full_text' then ' (full text)' else ' (title/abstract)' end
               else v_msg end,
          case when v_dual and v_action <> 'resolve' and coalesce((select blind from public.project_settings where project_id = r.project_id), true)
               then jsonb_build_object('stage', p_stage, 'action', v_action, 'blind', true, 'title', left(r.title, 300))
               else jsonb_build_object('stage', p_stage, 'decision', p_decision, 'reason', p_reason,
                             'previous_decision', prev_d, 'previous_reason', prev_r,
                             'action', v_action, 'title', left(r.title, 300)) end);
  return r;
end $$;
grant execute on function public.record_decision(uuid, text, text, text, text, timestamptz) to authenticated;
revoke execute on function public.record_decision(uuid, text, text, text, text, timestamptz) from anon, public;

-- Switching to dual mode keeps decisions already made; switching back to
-- single keeps each record's final decision and clears conflict flags.
create or replace function public.on_screening_mode_changed()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.screening_mode = 'single' and old.screening_mode = 'dual' then
    update public.study_references
       set title_abstract_conflict = false, full_text_conflict = false
     where project_id = new.project_id and (title_abstract_conflict or full_text_conflict);
  end if;
  return new;
end $$;
drop trigger if exists project_settings_mode on public.project_settings;
create trigger project_settings_mode after update of screening_mode on public.project_settings
  for each row execute function public.on_screening_mode_changed();

-- ---------------------------------------------------------------------------
-- The screening list: each record with the caller's own decision.
-- ---------------------------------------------------------------------------
create or replace view public.screening_refs with (security_invoker = true) as
  select r.*,
         ta.decision as my_title_abstract_decision, ta.exclusion_reason as my_title_abstract_exclusion_reason,
         ft.decision as my_full_text_decision, ft.exclusion_reason as my_full_text_exclusion_reason
    from public.study_references r
    left join public.reviewer_decisions ta on ta.reference_id = r.id and ta.stage = 'title_abstract' and ta.reviewer_id = (select auth.uid())
    left join public.reviewer_decisions ft on ft.reference_id = r.id and ft.stage = 'full_text' and ft.reviewer_id = (select auth.uid());
grant select on public.screening_refs to authenticated;

-- ---------------------------------------------------------------------------
-- Per-reviewer progress and agreement (only what the caller may see).
-- ---------------------------------------------------------------------------
create or replace function public.reviewer_stats(p_project_id uuid)
returns jsonb language sql stable
set search_path = ''
as $$
  with pool as (
    select id, title_abstract_decision, title_abstract_conflict, full_text_conflict from public.study_references
     where project_id = p_project_id and duplicate_status not in ('duplicate', 'merged')
  ), v as (
    select d.* from public.reviewer_decisions d join pool p on p.id = d.reference_id
  )
  select jsonb_build_object(
    'reviewers', coalesce((select jsonb_agg(jsonb_build_object('reviewer_id', reviewer_id, 'stage', stage,
                  'screened', n, 'include', inc, 'exclude', exc, 'maybe', may) order by stage, n desc)
       from (select reviewer_id, stage, count(*) n, count(*) filter (where decision = 'include') inc,
                    count(*) filter (where decision = 'exclude') exc, count(*) filter (where decision = 'maybe') may
               from v group by reviewer_id, stage) x), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'a', a, 'b', b))
       from (select v1.stage, v1.decision a, v2.decision b
               from v v1 join v v2 on v1.reference_id = v2.reference_id and v1.stage = v2.stage and v1.reviewer_id < v2.reviewer_id) x), '[]'::jsonb),
    'ta_conflicts', (select count(*) from pool where title_abstract_conflict),
    'ft_conflicts', (select count(*) from pool where full_text_conflict and title_abstract_decision = 'include')
  )
  where p_project_id in (select public.my_project_ids())
$$;
revoke all on function public.reviewer_stats(uuid) from public, anon;
grant execute on function public.reviewer_stats(uuid) to authenticated;
