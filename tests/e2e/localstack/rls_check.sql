-- RLS + RPC verification, executed as two different users. Rolled back at the end.
-- Usage: psql ... -v a=<uuid of user A> -v b=<uuid of user B> -f rls_check.sql
begin;
create temp table results(test text, ok boolean, detail text);
grant all on results to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'a', 'role', 'authenticated', 'email', 'a@test')::text, true);
set local role authenticated;
insert into projects(title) values ('RLS check A');
insert into results select 'A sees own project + 13 default reasons', (select count(*) from exclusion_reasons) = 13, null;
insert into study_references(project_id, title, doi, year) select id, 'A fictional title for RLS testing purposes', '10.5555/rls.1', 2020 from projects;
insert into study_references(project_id, title, doi, year) select id, 'A fictional title for RLS testing purposes!', 'https://doi.org/10.5555/RLS.1', 2020 from projects;
insert into results select 'derived fields (doi_norm)', (select count(*) from study_references where doi_norm = '10.5555/rls.1') = 2, null;
insert into results select 'duplicate pair found', (select count(*) from find_duplicate_pairs((select id from projects), (select array_agg(id) from study_references), 0.85)) = 1, null;
select (record_decision((select id from study_references order by seq limit 1), 'title_abstract', 'exclude', 'Wrong population')).id is not null;
select (record_decision((select id from study_references order by seq limit 1), 'title_abstract', 'exclude', 'Wrong population')).id is not null;
select (record_decision((select id from study_references order by seq limit 1), 'title_abstract', 'include', null)).id is not null;
insert into results select 'history + idempotent retry', (select count(*) from screening_decisions) = 2,
  (select string_agg(coalesce(previous_decision, '-') || '>' || decision || ':' || action, ', ' order by created_at) from screening_decisions);
insert into results select 'stats ta_include = 1', (project_stats((select id from projects)) ->> 'ta_include')::int = 1, null;
with d as (delete from screening_decisions returning 1) insert into results select 'history rows cannot be deleted', (select count(*) from d) = 0, null;
insert into tags(project_id, name) select id, 'ML' from projects;
insert into reference_tags(project_id, reference_id, tag_id) select p.id, (select id from study_references order by seq limit 1), t.id from projects p, tags t;
insert into results select 'tag_names synced', (select tag_names from study_references order by seq limit 1) = '{ML}', null;
update tags set name = 'Machine learning';
insert into results select 'tag rename synced', (select tag_names from study_references order by seq limit 1) = '{"Machine learning"}', null;
delete from tags;
insert into results select 'tag delete synced', (select tag_names from study_references order by seq limit 1) = '{}', null;
select set_config('request.jwt.claims', json_build_object('sub', :'b', 'role', 'authenticated', 'email', 'b@test')::text, true);
insert into results select 'B cannot see A project', (select count(*) from projects) = 0, null;
insert into results select 'B cannot see A refs', (select count(*) from study_references) = 0, null;
insert into results select 'B cannot see A history/logs', (select count(*) from screening_decisions) + (select count(*) from activity_logs) = 0, null;
with u as (update study_references set title = 'hacked' returning 1) insert into results select 'B cannot update A refs', (select count(*) from u) = 0, null;
insert into results select 'B gets empty stats for A project', (project_stats('00000000-0000-0000-0000-000000000000') ->> 'total')::int = 0, null;
savepoint s1;
do $$ begin
  perform public.record_decision('00000000-0000-0000-0000-000000000000', 'title_abstract', 'exclude', 'x');
  raise exception 'no error';
exception when others then
  if sqlerrm = 'no error' then raise; end if;
end $$;
rollback to savepoint s1;
insert into results select 'B cannot insert into A project', false, null where exists (select 1 from project_members);
select set_config('request.jwt.claims', json_build_object('sub', :'a', 'role', 'authenticated', 'email', 'a@test')::text, true);
insert into results select 'A data unchanged', (select count(*) from study_references where title = 'hacked') = 0, null;
delete from projects;
insert into results select 'A can delete own project (cascade)', (select count(*) from study_references) = 0, null;
reset role;
select test, ok, detail from results;
rollback;
