-- ResearchHub: read-only results link for a supervisor or co-author.
--
-- The owner turns sharing on, which stores a random token. Anyone holding
-- /r/<token> can read the questions and answers through rh_shared_results()
-- (SECURITY DEFINER); the tables stay owner-only. Email-address answers are
-- never shared, open-text answers only when the owner ticks that box, and no
-- device tokens, consent times or theme codes leave the database. Turning
-- sharing off (or making a new link) clears the old token at once.

alter table public.rh_projects
  add column if not exists results_token uuid unique,
  add column if not exists results_include_text boolean not null default false;

create or replace function public.rh_shared_results(p_token uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  with p as (
    select * from public.rh_projects where p_token is not null and results_token = p_token
  ), f as (
    select fl.* from public.rh_fields fl, p
     where fl.project_id = p.id and fl.type <> 'email'
       and (p.results_include_text or fl.type not in ('text', 'textarea'))
  ), ids as (
    select coalesce(array_agg(id::text), '{}') as ids from f
  )
  select jsonb_build_object(
    'title', p.title, 'description', p.description, 'university', p.university, 'department', p.department, 'year', p.year,
    'status', p.status, 'include_text', p.results_include_text,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'project_id', f.project_id, 'label', f.label, 'help', f.help, 'type', f.type,
                                          'options', f.options, 'required', f.required, 'field_order', f.field_order, 'settings', f.settings)
                       order by f.field_order, f.created_at) from f), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'submitted_at', r.submitted_at,
               'answers', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(r.answers) e, ids where e.key = any (ids.ids)), '{}'::jsonb))
             order by r.submitted_at, r.id)
        from public.rh_responses r where r.project_id = p.id), '[]'::jsonb))
    from p
$$;

revoke all on function public.rh_shared_results(uuid) from public;
grant execute on function public.rh_shared_results(uuid) to anon, authenticated;
