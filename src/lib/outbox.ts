/**
 * Outbox — a durable, ordered queue of screening changes.
 *
 * Every decision / note is first written to localStorage (so it survives a
 * closed tab, a crash or a lost connection) and then sent to Supabase in order.
 * Failed sends are retried with back-off. The UI only says "Saved" once the
 * server has confirmed every queued change.
 */
import { useSyncExternalStore } from 'react';
import { isAuthError, isNetworkError, friendlyError } from './errors';
import { recordDecision, updateReferenceFields } from './api/references';
import type { Decision, Reference, Stage } from './types';

export interface DecisionOp {
  id: string;
  kind: 'decision';
  projectId: string;
  referenceId: string;
  title: string | null;
  stage: Stage;
  decision: Decision | null;
  reason: string | null;
  action: 'decide' | 'undo';
  clientTs: string;
  attempts: number;
  lastError?: string;
}

export interface FieldsOp {
  id: string;
  kind: 'fields';
  projectId: string;
  referenceId: string;
  title: string | null;
  patch: Partial<Pick<Reference, 'notes' | 'full_text_status' | 'full_text_url'>>;
  clientTs: string;
  attempts: number;
  lastError?: string;
}

export type OutboxOp = DecisionOp | FieldsOp;

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'retrying' | 'error';

export interface OutboxState {
  pending: OutboxOp[];
  failed: OutboxOp[];
  status: SyncStatus;
  lastSavedAt: number | null;
  lastError: string | null;
  online: boolean;
}

type Listener = () => void;
type SyncedListener = (op: OutboxOp, result: Reference) => void;

const MAX_PERMANENT_ATTEMPTS = 4;

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class Outbox {
  private userId: string | null = null;
  private state: OutboxState = {
    pending: [], failed: [], status: 'saved', lastSavedAt: null, lastError: null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  };
  private listeners = new Set<Listener>();
  private syncedListeners = new Set<SyncedListener>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.set({ online: true });
        this.backoff = 1000;
        this.kick();
      });
      window.addEventListener('offline', () => this.set({ online: false, status: this.state.pending.length ? 'offline' : this.state.status }));
      window.addEventListener('beforeunload', (e) => {
        if (this.state.pending.length) {
          e.preventDefault();
        }
      });
    }
  }

  private key() {
    return `screenlab:outbox:${this.userId}`;
  }

  /** Called when the signed-in user changes. Loads any unsynced changes left from a previous session. */
  setUser(userId: string | null) {
    if (userId === this.userId) return;
    this.userId = userId;
    let pending: OutboxOp[] = [];
    let failed: OutboxOp[] = [];
    if (userId) {
      try {
        const raw = localStorage.getItem(this.key());
        if (raw) {
          const parsed = JSON.parse(raw) as { pending?: OutboxOp[]; failed?: OutboxOp[] };
          pending = parsed.pending ?? [];
          failed = parsed.failed ?? [];
        }
      } catch {
        /* storage unavailable: queue works in memory only */
      }
    }
    this.state = { ...this.state, pending, failed, status: pending.length ? 'saving' : 'saved' };
    this.emit();
    if (pending.length) this.kick();
  }

  private persist() {
    if (!this.userId) return;
    try {
      localStorage.setItem(this.key(), JSON.stringify({ pending: this.state.pending, failed: this.state.failed }));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }

  private set(patch: Partial<OutboxState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  onSynced(l: SyncedListener): () => void {
    this.syncedListeners.add(l);
    return () => {
      this.syncedListeners.delete(l);
    };
  }

  getState = () => this.state;

  enqueueDecision(op: Omit<DecisionOp, 'id' | 'kind' | 'attempts' | 'clientTs'>) {
    const full: DecisionOp = { ...op, id: uid(), kind: 'decision', attempts: 0, clientTs: new Date().toISOString() };
    this.state = { ...this.state, pending: [...this.state.pending, full], status: 'saving' };
    this.persist();
    this.emit();
    this.kick();
    return full;
  }

  enqueueFields(op: Omit<FieldsOp, 'id' | 'kind' | 'attempts' | 'clientTs'>) {
    // Coalesce with a not-yet-sent change to the same reference (e.g. typing notes).
    const pending = [...this.state.pending];
    const idx = pending.findIndex((p, i) => p.kind === 'fields' && p.referenceId === op.referenceId && !(i === 0 && this.running));
    if (idx >= 0) {
      const existing = pending[idx] as FieldsOp;
      pending[idx] = { ...existing, patch: { ...existing.patch, ...op.patch }, clientTs: new Date().toISOString() };
    } else {
      pending.push({ ...op, id: uid(), kind: 'fields', attempts: 0, clientTs: new Date().toISOString() });
    }
    this.state = { ...this.state, pending, status: 'saving' };
    this.persist();
    this.emit();
    this.kick();
  }

  /** Pending (unsynced) changes applied on top of a server copy of a reference. */
  overlay<T extends Partial<Reference> & { id: string }>(ref: T): T {
    let out = ref;
    for (const op of this.state.pending) {
      if (op.referenceId !== ref.id) continue;
      out = applyOp(out, op);
    }
    return out;
  }

  retryFailed() {
    const failed = this.state.failed.map((f) => ({ ...f, attempts: 0, lastError: undefined }));
    this.state = { ...this.state, failed: [], pending: [...this.state.pending, ...failed], lastError: null };
    this.persist();
    this.emit();
    this.backoff = 1000;
    this.kick();
  }

  discardFailed() {
    this.state = { ...this.state, failed: [], lastError: null };
    this.persist();
    this.emit();
  }

  kick() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.state.pending.length) {
        const op = this.state.pending[0];
        this.set({ status: this.state.online ? 'saving' : 'offline' });
        try {
          const result = await send(op);
          // Remove the op (it may have been coalesced with newer edits meanwhile: keep those)
          const head = this.state.pending[0];
          const rest = this.state.pending.slice(1);
          const stillSame = head && head.id === op.id && head.clientTs === op.clientTs;
          this.state = {
            ...this.state,
            pending: stillSame ? rest : this.state.pending,
            lastSavedAt: Date.now(),
            lastError: null,
          };
          this.persist();
          this.backoff = 1000;
          this.emit();
          for (const l of this.syncedListeners) l(op, result);
        } catch (e) {
          const transient = isNetworkError(e) || isAuthError(e) || isServerHiccup(e);
          const attempts = op.attempts + 1;
          const message = friendlyError(e);
          if (!transient && attempts >= MAX_PERMANENT_ATTEMPTS) {
            // Give up on this op and surface it; never pretend it was saved.
            this.state = {
              ...this.state,
              pending: this.state.pending.slice(1),
              failed: [...this.state.failed, { ...op, attempts, lastError: message }],
              lastError: message,
              status: 'error',
            };
            this.persist();
            this.emit();
            continue;
          }
          const pending = [...this.state.pending];
          pending[0] = { ...op, ...(pending[0].id === op.id ? pending[0] : {}), attempts, lastError: message } as OutboxOp;
          this.state = {
            ...this.state,
            pending,
            lastError: message,
            status: !this.state.online || isNetworkError(e) ? 'offline' : 'retrying',
          };
          this.persist();
          this.emit();
          const delay = this.backoff;
          this.backoff = Math.min(this.backoff * 2, 30000);
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.run();
          }, delay);
          return;
        }
      }
      this.set({ status: this.state.failed.length ? 'error' : 'saved' });
    } finally {
      this.running = false;
    }
  }
}

function isServerHiccup(e: unknown): boolean {
  const err = e as { status?: number; code?: string; message?: string };
  return (err?.status != null && err.status >= 500) || err?.code === '57014' || /502|503|504|timeout/i.test(String(err?.message ?? ''));
}

function applyOp<T extends Partial<Reference>>(ref: T, op: OutboxOp): T {
  if (op.kind === 'fields') return { ...ref, ...op.patch };
  const now = op.clientTs;
  if (op.stage === 'title_abstract') {
    return {
      ...ref,
      title_abstract_decision: op.decision,
      title_abstract_exclusion_reason: op.decision === 'exclude' ? op.reason : null,
      title_abstract_screened_at: op.decision ? now : null,
    };
  }
  return {
    ...ref,
    full_text_decision: op.decision as 'include' | 'exclude' | null,
    full_text_exclusion_reason: op.decision === 'exclude' ? op.reason : null,
    full_text_screened_at: op.decision ? now : null,
  };
}

async function send(op: OutboxOp): Promise<Reference> {
  if (op.kind === 'decision') {
    return recordDecision({
      referenceId: op.referenceId,
      stage: op.stage,
      decision: op.decision,
      reason: op.reason,
      action: op.action,
      clientTs: op.clientTs,
    });
  }
  return updateReferenceFields(op.referenceId, op.patch);
}

export const outbox = new Outbox();

export function useOutbox(): OutboxState {
  return useSyncExternalStore(outbox.subscribe, outbox.getState, outbox.getState);
}
