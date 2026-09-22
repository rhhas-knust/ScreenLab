import { supabase } from '../supabase';
import { must } from '../errors';
import type { ActivityLog } from '../types';

export async function listActivity(projectId: string, page = 0, pageSize = 50, action?: string): Promise<{ rows: ActivityLog[]; count: number }> {
  let q = supabase.from('activity_logs').select('*', { count: 'exact' }).eq('project_id', projectId);
  if (action) q = q.eq('action', action);
  const res = await q.order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
  if (res.error) throw res.error;
  return { rows: (res.data ?? []) as ActivityLog[], count: res.count ?? 0 };
}

export async function listReferenceActivity(referenceId: string): Promise<ActivityLog[]> {
  return must(await supabase.from('activity_logs').select('*').eq('reference_id', referenceId)
    .order('created_at', { ascending: false }).limit(50)) as ActivityLog[];
}
