-- ============================================================================
-- Bulk screening decisions (multi-select → Include / Exclude / Maybe / clear)
--
-- Applies record_decision() to each selected reference, so every record gets
-- its own audit-history row, reviewer decision and activity-log entry exactly
-- as if it had been screened one by one. Returns each record's previous
-- decision so the whole batch can be undone.
--
-- p_items: [{"id": uuid, "decision": "include"|"exclude"|"maybe"|null, "reason": text|null}, ...]
-- Records the caller cannot see (Row Level Security) are skipped.
-- ============================================================================

create or replace function public.record_decisions_bulk(
  p_stage text,
  p_items jsonb,
  p_action text default 'decide'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  it jsonb;
  prev jsonb := '[]'::jsonb;
  pd text;
  pr text;
  pid uuid;
  n integer := 0;
  first_decision text;
  first_reason text;
begin
  if p_stage not in ('title_abstract', 'full_text') then
    raise exception 'Invalid screening stage' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'Too many records in one request (maximum 1000)' using errcode = '22023';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select case when p_stage = 'title_abstract' then r.title_abstract_decision else r.full_text_decision end,
           case when p_stage = 'title_abstract' then r.title_abstract_exclusion_reason else r.full_text_exclusion_reason end,
           r.project_id
      into pd, pr, pid
      from public.study_references r
     where r.id = (it ->> 'id')::uuid;
    if not found then
      continue;
    end if;
    prev := prev || jsonb_build_object('id', it ->> 'id', 'decision', pd, 'reason', pr);
    perform public.record_decision((it ->> 'id')::uuid, p_stage, it ->> 'decision', it ->> 'reason', p_action, null);
    n := n + 1;
    first_decision := coalesce(first_decision, it ->> 'decision', 'unscreened');
    first_reason := coalesce(first_reason, it ->> 'reason');
  end loop;

  if n > 0 then
    insert into public.activity_logs(project_id, action, message, details)
    values (pid, 'screening',
            case when p_action = 'undo' then 'Undo of a bulk decision: ' || n || ' records restored'
                 else 'Bulk decision: ' || n || ' records → ' ||
                      case first_decision when 'include' then 'Included' when 'exclude' then 'Excluded'
                                          when 'maybe' then 'Maybe' else 'Unscreened' end ||
                      coalesce(' — ' || first_reason, '') end ||
            case when p_stage = 'full_text' then ' (full text)' else ' (title/abstract)' end,
            jsonb_build_object('bulk', true, 'count', n, 'stage', p_stage, 'action', p_action));
  end if;
  return prev;
end $$;

revoke execute on function public.record_decisions_bulk(text, jsonb, text) from public, anon;
grant execute on function public.record_decisions_bulk(text, jsonb, text) to authenticated;
