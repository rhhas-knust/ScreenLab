-- Methods reporting: search log, protocol/decision log, AI-use disclosure.
-- Supports writing the methods section (PRISMA 2020 items 6, 7, 8, 24) from
-- the project's own data. Access follows project membership (my_project_ids()).

-- One row per database / register / other source searched.
create table if not exists public.search_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'database' check (kind in ('database', 'register', 'other')),
  name text not null check (char_length(name) between 1 and 200),
  searched_on date,
  search_string text check (char_length(search_string) <= 20000),
  filters text check (char_length(filters) <= 2000),
  results_count integer check (results_count >= 0),
  notes text check (char_length(notes) <= 2000),
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists search_sources_project_idx on public.search_sources(project_id, sort_order, created_at);

-- Dated protocol decisions and deviations (eligibility rules, tier rules, process changes).
create table if not exists public.protocol_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  decided_on date not null default current_date,
  category text not null default 'eligibility'
    check (category in ('registration', 'eligibility', 'classification', 'process', 'deviation', 'other')),
  title text not null check (char_length(title) between 1 and 300),
  detail text check (char_length(detail) <= 5000),
  rationale text check (char_length(rationale) <= 5000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists protocol_decisions_project_idx on public.protocol_decisions(project_id, decided_on);

drop trigger if exists search_sources_touch on public.search_sources;
create trigger search_sources_touch before update on public.search_sources
  for each row execute function public.touch_updated_at();
drop trigger if exists protocol_decisions_touch on public.protocol_decisions;
create trigger protocol_decisions_touch before update on public.protocol_decisions
  for each row execute function public.touch_updated_at();

alter table public.search_sources enable row level security;
alter table public.protocol_decisions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['search_sources', 'protocol_decisions'] loop
    execute format('drop policy if exists %1$s_all on public.%1$s', t);
    execute format('create policy %1$s_all on public.%1$s for all to authenticated
         using (project_id in (select public.my_project_ids()))
         with check (project_id in (select public.my_project_ids()))', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- AI-use disclosure for the methods section. SECURITY INVOKER: RLS limits it to
-- projects the caller belongs to. Compares the latest AI suggestion per record and
-- stage with the human decision recorded for that stage.
create or replace function public.ai_disclosure(p_project_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with s as (
    select * from public.ai_suggestions where project_id = p_project_id
  ), latest as (
    select distinct on (reference_id, stage) * from s order by reference_id, stage, created_at desc
  ), cmp as (
    select l.stage, l.recommendation rec,
           case l.stage when 'title_abstract' then r.title_abstract_decision else r.full_text_decision end human,
           case l.stage when 'title_abstract' then r.title_abstract_screened_at else r.full_text_screened_at end decided_at,
           l.created_at suggested_at
      from latest l join public.study_references r on r.id = l.reference_id
  )
  select jsonb_build_object(
    'suggestions', (select count(*) from s),
    'records', (select count(distinct reference_id) from s),
    'first_at', (select min(created_at) from s),
    'last_at', (select max(created_at) from s),
    'by_model', coalesce((select jsonb_agg(jsonb_build_object('model', model, 'stage', stage, 'source', source, 'count', n) order by n desc)
                  from (select model, stage, source, count(*) n from s group by 1, 2, 3) x), '[]'::jsonb),
    'agreement', coalesce((select jsonb_agg(jsonb_build_object(
                    'stage', stage,
                    'records', n,
                    'decided', decided,
                    'compared', compared,
                    'agreed', agreed,
                    'ai_include_human_exclude', ie,
                    'ai_exclude_human_include', ei,
                    'ai_unsure', unsure,
                    'decided_before_suggestion', before) order by stage)
                  from (select stage, count(*) n,
                          count(*) filter (where human is not null) decided,
                          count(*) filter (where human in ('include', 'exclude') and rec in ('include', 'exclude')) compared,
                          count(*) filter (where human = rec) agreed,
                          count(*) filter (where rec = 'include' and human = 'exclude') ie,
                          count(*) filter (where rec = 'exclude' and human = 'include') ei,
                          count(*) filter (where rec = 'unsure' and human is not null) unsure,
                          count(*) filter (where human is not null and decided_at < suggested_at) before
                        from cmp group by stage) x), '[]'::jsonb),
    'human_decisions', (select count(*) from public.screening_decisions d
                         where d.project_id = p_project_id and d.action in ('decide', 'change')),
    'imported_decisions', (select count(*) from public.screening_decisions d
                         where d.project_id = p_project_id and d.action = 'restore'),
    'reviewers', (select count(distinct reviewer_id) from public.screening_decisions d
                   where d.project_id = p_project_id and d.action in ('decide', 'change'))
  )
$$;
revoke all on function public.ai_disclosure(uuid) from public, anon;
grant execute on function public.ai_disclosure(uuid) to authenticated;
