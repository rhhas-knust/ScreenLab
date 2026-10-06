-- AI screening suggestions: advisory only. They never change a decision; the
-- reviewer records every decision themselves. Kept for transparency (which
-- model, which source text, when, by whom).
create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reference_id uuid not null references public.study_references(id) on delete cascade,
  stage text not null check (stage in ('title_abstract', 'full_text')),
  model text not null,
  recommendation text not null check (recommendation in ('include', 'exclude', 'unsure')),
  exclusion_reason text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  summary text not null,
  criteria jsonb not null default '[]'::jsonb,
  source text not null check (source in ('abstract', 'attached_pdf', 'open_access_pdf')),
  input_tokens integer,
  output_tokens integer,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_suggestions_ref_idx on public.ai_suggestions(reference_id, stage, created_at desc);
create index if not exists ai_suggestions_project_idx on public.ai_suggestions(project_id, stage);

alter table public.ai_suggestions enable row level security;

create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (project_id in (select public.my_project_ids()));
create policy ai_suggestions_insert on public.ai_suggestions for insert to authenticated
  with check (project_id in (select public.my_project_ids()) and created_by = (select auth.uid()));
create policy ai_suggestions_delete on public.ai_suggestions for delete to authenticated
  using (project_id in (select public.my_project_ids()));

-- Records at a stage that already have a suggestion (for "pre-check next N").
create or replace function public.ai_suggested_ids(p_project_id uuid, p_stage text)
returns setof uuid language sql stable security invoker
set search_path = ''
as $$
  select distinct s.reference_id from public.ai_suggestions s
   where s.project_id = p_project_id and s.stage = p_stage
$$;
revoke all on function public.ai_suggested_ids(uuid, text) from public, anon;
grant execute on function public.ai_suggested_ids(uuid, text) to authenticated;
