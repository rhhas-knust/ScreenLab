-- Risk of bias appraisal reuses the blinded double-extraction tables: each row
-- now has a kind ('extraction' or 'rob'), so the same blinding, comparison and
-- agreed-final workflow covers both. Existing rows become kind 'extraction'.

alter table public.extractions add column if not exists kind text not null default 'extraction';
alter table public.extraction_final add column if not exists kind text not null default 'extraction';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'extractions_kind_check') then
    alter table public.extractions add constraint extractions_kind_check check (kind in ('extraction', 'rob'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'extraction_final_kind_check') then
    alter table public.extraction_final add constraint extraction_final_kind_check check (kind in ('extraction', 'rob'));
  end if;
  -- one extraction per reviewer, study and kind
  if exists (select 1 from pg_constraint where conname = 'extractions_reference_id_reviewer_id_key') then
    alter table public.extractions drop constraint extractions_reference_id_reviewer_id_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'extractions_ref_reviewer_kind_key') then
    alter table public.extractions add constraint extractions_ref_reviewer_kind_key unique (reference_id, reviewer_id, kind);
  end if;
  -- one agreed final per study and kind
  if exists (select 1 from pg_constraint where conname = 'extraction_final_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (reference_id)') then
    alter table public.extraction_final drop constraint extraction_final_pkey;
    alter table public.extraction_final add constraint extraction_final_pkey primary key (reference_id, kind);
  end if;
end $$;

-- Blinding now applies per kind: completing your extraction does not reveal the
-- other reviewer's risk-of-bias answers, and vice versa.
create or replace function public.can_see_extraction(p_reference_id uuid, p_reviewer_id uuid, p_kind text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_reviewer_id = (select auth.uid())
      or exists (select 1 from public.extractions e
                  where e.reference_id = p_reference_id and e.kind = p_kind
                    and e.reviewer_id = (select auth.uid()) and e.status = 'complete')
      or (not exists (select 1 from public.extractions e
                       where e.reference_id = p_reference_id and e.kind = p_kind and e.reviewer_id = (select auth.uid()))
          and (select count(*) from public.extractions e
                where e.reference_id = p_reference_id and e.kind = p_kind and e.status = 'complete') >= 2)
$$;
revoke all on function public.can_see_extraction(uuid, uuid, text) from public, anon;
grant execute on function public.can_see_extraction(uuid, uuid, text) to authenticated;

drop policy if exists extractions_select on public.extractions;
create policy extractions_select on public.extractions for select to authenticated
  using (project_id in (select public.my_project_ids()) and public.can_see_extraction(reference_id, reviewer_id, kind));
drop function if exists public.can_see_extraction(uuid, uuid);

drop function if exists public.extraction_progress(uuid);
create or replace function public.extraction_progress(p_project_id uuid, p_kind text default 'extraction')
returns table (
  reference_id uuid, seq bigint, title text, authors text, year integer, journal text,
  my_status text, complete_count integer, started_count integer, has_final boolean, final_tier text, final_overall text
)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.seq, r.title, r.authors, r.year, r.journal,
    (select e.status from public.extractions e where e.reference_id = r.id and e.kind = p_kind and e.reviewer_id = (select auth.uid())),
    (select count(*)::int from public.extractions e where e.reference_id = r.id and e.kind = p_kind and e.status = 'complete'),
    (select count(*)::int from public.extractions e where e.reference_id = r.id and e.kind = p_kind),
    f.reference_id is not null,
    f.data->>'tier',
    f.data->>'overall'
  from public.study_references r
  join public.project_settings s on s.project_id = r.project_id
  left join public.extraction_final f on f.reference_id = r.id and f.kind = p_kind
  where r.project_id = p_project_id
    and p_project_id in (select public.my_project_ids())
    and r.duplicate_status not in ('duplicate', 'merged')
    and (case when s.stage2_enabled then r.full_text_decision = 'include' else r.title_abstract_decision = 'include' end)
  order by r.seq
$$;
revoke all on function public.extraction_progress(uuid, text) from public, anon;
grant execute on function public.extraction_progress(uuid, text) to authenticated;
