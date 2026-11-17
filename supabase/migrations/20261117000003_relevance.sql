-- Predicted relevance (0–1) per record and stage, computed in the browser
-- from the team's decisions (as in Rayyan's 5-star ratings). Advisory only:
-- used to order and filter the screening list, never to decide.
alter table public.study_references
  add column if not exists title_abstract_relevance real check (title_abstract_relevance between 0 and 1),
  add column if not exists full_text_relevance real check (full_text_relevance between 0 and 1);

-- Replace a stage's ratings for a project: {"<reference id>": 0.83, ...}.
create or replace function public.set_relevance(p_project_id uuid, p_stage text, p_scores jsonb)
returns int language plpgsql
set search_path = ''
as $$
declare n int;
begin
  if p_stage not in ('title_abstract', 'full_text') then
    raise exception 'Invalid screening stage' using errcode = '22023';
  end if;
  if p_project_id not in (select public.my_project_ids()) then
    raise exception 'Project not found' using errcode = '42501';
  end if;
  if p_stage = 'title_abstract' then
    update public.study_references r set title_abstract_relevance = least(1, greatest(0, (s.value)::real))
      from jsonb_each_text(p_scores) s where r.project_id = p_project_id and r.id = s.key::uuid;
  else
    update public.study_references r set full_text_relevance = least(1, greatest(0, (s.value)::real))
      from jsonb_each_text(p_scores) s where r.project_id = p_project_id and r.id = s.key::uuid;
  end if;
  get diagnostics n = row_count;
  insert into public.activity_logs(project_id, action, message, details)
  values (p_project_id, 'relevance', 'Updated predicted relevance ratings (' || n || ' records, ' ||
          case when p_stage = 'full_text' then 'full text' else 'title/abstract' end || ')', jsonb_build_object('stage', p_stage, 'records', n));
  return n;
end $$;
revoke all on function public.set_relevance(uuid, text, jsonb) from public, anon;
grant execute on function public.set_relevance(uuid, text, jsonb) to authenticated;

-- The screening view lists the table's columns as they were when it was made: recreate it.
drop view if exists public.screening_refs;
create view public.screening_refs with (security_invoker = true) as
  select r.*,
         ta.decision as my_title_abstract_decision, ta.exclusion_reason as my_title_abstract_exclusion_reason,
         ft.decision as my_full_text_decision, ft.exclusion_reason as my_full_text_exclusion_reason
    from public.study_references r
    left join public.reviewer_decisions ta on ta.reference_id = r.id and ta.stage = 'title_abstract' and ta.reviewer_id = (select auth.uid())
    left join public.reviewer_decisions ft on ft.reference_id = r.id and ft.stage = 'full_text' and ft.reviewer_id = (select auth.uid());
grant select on public.screening_refs to authenticated;
