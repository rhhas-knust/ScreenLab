-- ResearchHub step B: AI-written findings summaries for a questionnaire.
--
-- The summary is generated server-side by the rh-summary Edge Function (the
-- Anthropic key never reaches the browser) using the owner's own JWT, so RLS
-- decides what it can read. Only the questionnaire's owner can see, add or
-- delete its summaries.

create table if not exists public.rh_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rh_projects(id) on delete cascade,
  model text not null check (char_length(model) <= 200),
  -- { headline, key_findings[], open_text_themes[{theme, detail}], limitations[] }
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 60000),
  response_count integer not null check (response_count >= 0),
  input_tokens integer,
  output_tokens integer,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists rh_ai_summaries_project_idx on public.rh_ai_summaries(project_id, created_at desc);

alter table public.rh_ai_summaries enable row level security;

drop policy if exists rh_ai_summaries_select on public.rh_ai_summaries;
create policy rh_ai_summaries_select on public.rh_ai_summaries for select to authenticated
  using (exists (select 1 from public.rh_projects p where p.id = project_id and p.owner_id = (select auth.uid())));

drop policy if exists rh_ai_summaries_insert on public.rh_ai_summaries;
create policy rh_ai_summaries_insert on public.rh_ai_summaries for insert to authenticated
  with check (created_by = (select auth.uid())
    and exists (select 1 from public.rh_projects p where p.id = project_id and p.owner_id = (select auth.uid())));

drop policy if exists rh_ai_summaries_delete on public.rh_ai_summaries;
create policy rh_ai_summaries_delete on public.rh_ai_summaries for delete to authenticated
  using (exists (select 1 from public.rh_projects p where p.id = project_id and p.owner_id = (select auth.uid())));

revoke all on public.rh_ai_summaries from anon;
grant select, insert, delete on public.rh_ai_summaries to authenticated;
