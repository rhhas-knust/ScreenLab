// Offline collection: responses made without internet wait in this device's
// IndexedDB (files included, as Blobs) and are sent when the connection
// returns. Each keeps the client_id it was given, so the server stores it once
// even if a send is retried after the connection dropped mid-way.
import { pingWebhook, submitResponse, uploadFormFile, type AnswerValue, type SubmitMeta } from '../api/research';

export interface OutboxFile { slot: string; blob: Blob; name: string; type: string; size: number }
export interface OutboxItem {
  client_id: string;
  project_id: string;
  answers: Record<string, AnswerValue>;
  meta: SubmitMeta;
  files: Record<string, OutboxFile>;
  created_at: string;
  /** Set when the server refused it (e.g. a quota filled up) — kept so nothing is lost silently. */
  error?: string;
  /** The form sends new responses to a webhook. */
  webhook?: boolean;
}

const DB = 'researchhub', STORE = 'outbox';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'client_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { resolve(r.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

export const putItem = (item: OutboxItem) => tx('readwrite', (s) => s.put(item));
export const deleteItem = (id: string) => tx('readwrite', (s) => s.delete(id));
export async function listItems(projectId?: string): Promise<OutboxItem[]> {
  try {
    const all = await tx<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>);
    return all.filter((x) => !projectId || x.project_id === projectId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

/** A failure that means "no connection", as opposed to the server saying no. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = String((e as { message?: string })?.message ?? e);
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out/i.test(msg);
}

/** Upload the files, then submit. Throws on failure (network or server). Returns the response id. */
export async function sendItem(item: OutboxItem): Promise<string> {
  const answers = { ...item.answers };
  for (const [fid, f] of Object.entries(item.files)) {
    answers[fid] = (await uploadFormFile(item.project_id, f.slot, f)) as unknown as AnswerValue;
  }
  const id = await submitResponse(item.project_id, answers, { ...item.meta, client_id: item.client_id });
  if (item.webhook && id) pingWebhook(id);
  return id;
}

/** Send everything waiting for a form. Returns how many were sent and how many the server refused. */
export async function syncOutbox(projectId?: string): Promise<{ sent: number; refused: number; waiting: number }> {
  let sent = 0, refused = 0, waiting = 0;
  for (const item of await listItems(projectId)) {
    if (item.error) { refused++; continue; }
    try {
      await sendItem(item);
      await deleteItem(item.client_id);
      sent++;
    } catch (e) {
      if (isNetworkError(e)) { waiting++; continue; }
      await putItem({ ...item, error: String((e as { message?: string })?.message ?? e) });
      refused++;
    }
  }
  return { sent, refused, waiting };
}
