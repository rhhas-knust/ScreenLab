-- Records similar to one record (as Rayyan's "similar articles"): ranked by
-- full-text match on the words of its title and keywords.
create or replace function public.similar_references(p_reference_id uuid, p_limit int default 8)
returns table (id uuid, seq bigint, title text, authors text, year int,
               title_abstract_decision text, full_text_decision text, score real)
language sql stable
set search_path = ''
as $$
  with me as (
    select r.project_id, r.title, r.keywords from public.study_references r where r.id = p_reference_id
  ), q as (
    select to_tsquery('simple', string_agg(quote_literal(l), ' | ')) as tsq
      from me, unnest(tsvector_to_array(to_tsvector('english', coalesce(me.title, '') || ' ' || coalesce(me.keywords, '')))) l
     where char_length(l) > 2
  ), cand as (
    select r.*, to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.keywords, '') || ' ' || coalesce(left(r.abstract, 3000), '')) as tv
      from public.study_references r, me
     where r.project_id = me.project_id and r.id <> p_reference_id and r.duplicate_status not in ('duplicate', 'merged')
  )
  select c.id, c.seq, c.title, c.authors, c.year, c.title_abstract_decision, c.full_text_decision, ts_rank_cd(c.tv, q.tsq, 32)::real
    from cand c, q
   where q.tsq is not null and c.tv @@ q.tsq
   order by 8 desc, c.seq
   limit least(greatest(coalesce(p_limit, 8), 1), 50)
$$;
revoke all on function public.similar_references(uuid, int) from public, anon;
grant execute on function public.similar_references(uuid, int) to authenticated;
