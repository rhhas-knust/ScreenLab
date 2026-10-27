import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { deviceToken, getPublicForm, type PublicForm } from '../lib/api/research';
import { deleteItem, isNetworkError, listItems, putItem, sendItem, syncOutbox, type OutboxItem } from '../lib/research/outbox';
import { friendlyError } from '../lib/errors';
import { Alert, Button, PageLoader } from '../components/ui';
import { FormView } from './FormView';

const doneKey = (id: string) => `rh-done-${id}`;
const formKey = (id: string) => `rh-form-${id}`;
function readDone(id: string) {
  try { return localStorage.getItem(doneKey(id)) === '1'; } catch { return false; }
}

/** Load the form; with no connection, fall back to the copy saved the last time it opened on this device. */
async function loadForm(id: string): Promise<{ form: PublicForm | null; offline: boolean }> {
  try {
    const form = await getPublicForm(id);
    try { if (form) localStorage.setItem(formKey(id), JSON.stringify(form)); else localStorage.removeItem(formKey(id)); } catch { /* storage full or private mode */ }
    return { form, offline: false };
  } catch (e) {
    if (isNetworkError(e)) {
      try {
        const saved = localStorage.getItem(formKey(id));
        if (saved) return { form: JSON.parse(saved) as PublicForm, offline: true };
      } catch { /* fall through */ }
    }
    throw e;
  }
}

/** Respondent-facing questionnaire at /f/:formId — no account needed, and it keeps working offline. */
export function PublicFormPage() {
  const { formId = '' } = useParams();
  const [params] = useSearchParams();
  const invite = /^[0-9a-f-]{36}$/i.test(params.get('i') ?? '') ? params.get('i') : null;
  const valid = /^[0-9a-f-]{36}$/i.test(formId);
  const q = useQuery({ queryKey: ['rh', 'public', formId], queryFn: () => loadForm(formId), enabled: valid, retry: 1, networkMode: 'always' });
  const [already] = useState(() => readDone(formId));
  const [waiting, setWaiting] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const form = q.data?.form ?? null;

  const refresh = useCallback(async () => setWaiting(await listItems(formId)), [formId]);
  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncOutbox(formId);
      if (r.sent) setSyncNote(`${r.sent} saved response${r.sent === 1 ? '' : 's'} sent.`);
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [formId, refresh, syncing]);

  useEffect(() => { if (form?.title) document.title = form.title; }, [form?.title]);
  // Send waiting responses when the page opens, when the connection returns, and every minute.
  useEffect(() => {
    void refresh().then(() => { if (navigator.onLine) void sync(); });
    const on = () => void sync();
    window.addEventListener('online', on);
    const t = setInterval(() => { if (navigator.onLine) void sync(); }, 60_000);
    return () => { window.removeEventListener('online', on); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  let body: React.ReactNode;
  if (!valid || (q.isSuccess && !form)) {
    body = <Alert kind="info">This questionnaire was not found. Check the link you were given.</Alert>;
  } else if (q.isLoading) {
    body = <PageLoader label="Loading questionnaire…" />;
  } else if (q.error) {
    body = (
      <>
        <Alert>{isNetworkError(q.error) ? 'No internet connection. Open this link once while online and it will then work offline on this device.' : friendlyError(q.error, 'Could not load the questionnaire.')}</Alert>
        <Button className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </>
    );
  } else if (form) {
    const f = form;
    body = (
      <FormView form={f} alreadyDone={!!f.one_per_device && already} onSubmit={async (answers, meta, files) => {
        const item: OutboxItem = {
          client_id: crypto.randomUUID(), project_id: formId, answers, created_at: new Date().toISOString(), webhook: !!f.has_webhook,
          meta: { ...meta, device: f.one_per_device ? deviceToken() : null, invite },
          files: Object.fromEntries(Object.entries(files).map(([fid, x]) => [fid, { ...x, slot: crypto.randomUUID() }])),
        };
        const markDone = () => { if (f.one_per_device) try { localStorage.setItem(doneKey(formId), '1'); } catch { /* private mode */ } };
        const keep = async () => {
          await putItem({ ...item, meta: { ...item.meta, collected_at: item.created_at } });
          markDone();
          await refresh();
          return 'queued' as const;
        };
        if (!navigator.onLine) return keep();
        try {
          await sendItem(item);
        } catch (e) {
          if (isNetworkError(e)) return keep();
          throw e;
        }
        markDone();
        return 'sent';
      }} />
    );
  }

  const pending = waiting.filter((w) => !w.error);
  const refused = waiting.filter((w) => w.error);
  return (
    <div className="min-h-full bg-slate-100">
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        {q.data?.offline && <Alert kind="warning" className="mb-4">You are offline. This is the copy of the form saved on this device; answers are kept here and sent when you are back online.</Alert>}
        {(pending.length > 0 || refused.length > 0 || syncNote) && (
          <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="rh-outbox" role="status">
            {pending.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{pending.length} response{pending.length === 1 ? '' : 's'} saved on this device, waiting for internet.</span>
                <Button size="sm" onClick={() => void sync()} loading={syncing}>Send now</Button>
              </div>
            )}
            {refused.map((w) => (
              <div key={w.client_id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">A response saved {new Date(w.created_at).toLocaleString()} was not accepted: {w.error}</span>
                <Button size="sm" variant="ghost" onClick={async () => { if (window.confirm('Discard this saved response?')) { await deleteItem(w.client_id); await refresh(); } }}>Discard</Button>
              </div>
            ))}
            {syncNote && pending.length === 0 && <p>{syncNote}</p>}
          </div>
        )}
        {body}
      </main>
      <footer className="pb-8 text-center text-xs text-slate-500">Powered by ResearchHub · Built by Hastech Solutions</footer>
    </div>
  );
}
