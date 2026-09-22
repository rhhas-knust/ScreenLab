import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listActivity } from '../lib/api/activity';
import { fmt, fmtDate, qk } from '../lib/hooks';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Card, Select, Spinner } from '../components/ui';

const ACTIONS: Record<string, string> = {
  '': 'All activity', screening: 'Screening decisions', import: 'Imports', duplicates: 'Duplicates', tags: 'Tags',
  full_text: 'Full texts', export: 'Exports', backup: 'Backups', project: 'Project', settings: 'Settings', statistics: 'Statistics',
};

export function ActivityPage() {
  const { projectId = '' } = useParams();
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const q = useQuery({
    queryKey: [...qk.activity(projectId), 'page', page, action],
    queryFn: () => listActivity(projectId, page, 50, action || undefined),
    placeholderData: keepPreviousData,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.count / 50)) : 1;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Activity log</h1>
          <p className="text-sm text-slate-600">An append-only record of what happened in this project. Screening changes also keep the previous decision.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="act-filter" className="text-sm">Show</label>
          <Select id="act-filter" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} className="w-52">
            {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
      </div>
      <Card className="mt-4">
        {q.error ? <div className="p-4"><Alert>{friendlyError(q.error)}</Alert></div> : !q.data ? <div className="p-4"><Spinner /></div> : q.data.rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No activity recorded.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {q.data.rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:gap-4">
                <time className="w-40 shrink-0 text-xs text-slate-500 tabular-nums" dateTime={a.created_at}>{fmtDate(a.created_at)}</time>
                <div className="min-w-0 flex-1">
                  <div>{a.message}</div>
                  {typeof a.details?.title === 'string' && (
                    <div className="truncate text-xs text-slate-500">
                      {a.reference_id ? <Link className="underline" to={`/p/${projectId}/screening?ref=${a.reference_id}${a.details?.stage === 'full_text' ? '&stage=full_text' : ''}`}>{a.details.title as string}</Link> : (a.details.title as string)}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-500">{a.user_email ?? ''}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {q.data && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-600">{fmt(q.data.count)} entries</span>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
            <span className="tabular-nums">{page + 1} / {pages}</span>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Older →</Button>
          </div>
        </div>
      )}
    </div>
  );
}
