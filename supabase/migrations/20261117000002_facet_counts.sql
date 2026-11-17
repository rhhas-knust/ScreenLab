-- Facet counts for the screening sidebar (as in Rayyan): the most common
-- authors, journals, keywords, years, publication types and languages among
-- the records in a screening stage, for browsing and filtering.
create or replace function public.facet_counts(p_project_id uuid, p_stage text, p_kind text, p_limit int default 50)
returns table (value text, n bigint)
language sql stable
set search_path = ''
as $$
  with pool as (
    select id, authors, journal, keywords, year, publication_type, language
      from public.study_references
     where project_id = p_project_id and duplicate_status not in ('duplicate', 'merged')
       and (p_stage <> 'full_text' or title_abstract_decision = 'include')
  ), vals as (
    select case p_kind when 'journal' then nullif(btrim(journal), '') when 'year' then year::text
                       when 'publication_type' then nullif(btrim(publication_type), '') when 'language' then nullif(btrim(language), '') end as v
      from pool where p_kind in ('journal', 'year', 'publication_type', 'language')
    union all
    select distinct on (p.id, btrim(a)) nullif(btrim(a), '')
      from pool p, regexp_split_to_table(coalesce(p.authors, ''), '\s*;\s*|\n') a where p_kind = 'author'
    union all
    select distinct on (p.id, lower(btrim(k))) nullif(lower(btrim(k)), '')
      from pool p, regexp_split_to_table(coalesce(p.keywords, ''), '\s*[;,]\s*|\n') k where p_kind = 'keyword'
  )
  select v, count(*) from vals where v is not null and char_length(v) <= 300
   group by v order by count(*) desc, v limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke all on function public.facet_counts(uuid, text, text, int) from public, anon;
grant execute on function public.facet_counts(uuid, text, text, int) to authenticated;
