-- Who screened each reference at each stage, so co-reviewers can find the
-- papers a partner has (or hasn't) reviewed. Kept in sync with
-- reviewer_decisions (written by record_decision) like tag_names is with
-- reference_tags; used for fast list filtering and the reviewer chips.

alter table public.study_references
  add column if not exists title_abstract_reviewers uuid[] not null default '{}',
  add column if not exists full_text_reviewers uuid[] not null default '{}';
create index if not exists refs_ta_reviewers_idx on public.study_references using gin (title_abstract_reviewers);
create index if not exists refs_ft_reviewers_idx on public.study_references using gin (full_text_reviewers);

create or replace function public.sync_reference_reviewers()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.reference_id, old.reference_id);
begin
  -- Skipped during cascading deletes of the reference itself.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.study_references r
     set title_abstract_reviewers = coalesce((select array_agg(d.reviewer_id order by d.updated_at)
                                                from public.reviewer_decisions d
                                               where d.reference_id = rid and d.stage = 'title_abstract'), '{}'),
         full_text_reviewers = coalesce((select array_agg(d.reviewer_id order by d.updated_at)
                                           from public.reviewer_decisions d
                                          where d.reference_id = rid and d.stage = 'full_text'), '{}')
   where r.id = rid;
  return null;
end $$;

drop trigger if exists reviewer_decisions_sync on public.reviewer_decisions;
create trigger reviewer_decisions_sync after insert or update or delete on public.reviewer_decisions
  for each row execute function public.sync_reference_reviewers();

-- Backfill from decisions already made.
update public.study_references r
   set title_abstract_reviewers = coalesce(x.ta, '{}'), full_text_reviewers = coalesce(x.ft, '{}')
  from (select d.reference_id,
               array_agg(d.reviewer_id order by d.updated_at) filter (where d.stage = 'title_abstract') ta,
               array_agg(d.reviewer_id order by d.updated_at) filter (where d.stage = 'full_text') ft
          from public.reviewer_decisions d group by d.reference_id) x
 where x.reference_id = r.id;
