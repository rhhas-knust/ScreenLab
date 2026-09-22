import { useEffect, useState } from 'react';
import { outbox, useOutbox } from '../lib/outbox';
import { Button, Modal, cx } from './ui';
import { fmtDate } from '../lib/hooks';

/** Honest connection / save status: "Saved" only when the server confirmed every change. */
export function SyncIndicator() {
  const s = useOutbox();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const n = s.pending.length;
  let text: string;
  let cls: string;
  let icon: string;
  if (s.failed.length) {
    icon = '⚠'; cls = 'bg-rose-50 text-rose-900 border-rose-300';
    text = `${s.failed.length} change${s.failed.length > 1 ? 's' : ''} not saved`;
  } else if (!online) {
    icon = '⚠'; cls = 'bg-amber-50 text-amber-950 border-amber-300';
    text = n ? `Offline — ${n} change${n > 1 ? 's' : ''} will sync when connection returns` : 'Offline';
  } else if (s.status === 'offline' || s.status === 'retrying') {
    icon = '⚠'; cls = 'bg-amber-50 text-amber-950 border-amber-300';
    text = `Connection problem — retrying (${n} pending)`;
  } else if (n) {
    icon = '◌'; cls = 'bg-ink-50 text-ink-800 border-ink-200';
    text = 'Saving…';
  } else {
    icon = '●'; cls = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    text = 'Saved';
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx('inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs font-medium', cls)}
        aria-live="polite"
        title="Save status — click for details"
        data-testid="sync-status"
      >
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{text}</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Save status"
        footer={
          <>
            {s.failed.length > 0 && (
              <>
                <Button variant="danger" onClick={() => outbox.discardFailed()}>Discard failed changes</Button>
                <Button variant="primary" onClick={() => outbox.retryFailed()}>Retry failed changes</Button>
              </>
            )}
            {n > 0 && <Button onClick={() => outbox.kick()}>Retry now</Button>}
            <Button onClick={() => setOpen(false)}>Close</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            Every screening decision and note is stored on this device first, then sent to the ScreenLab database.
            “Saved” means the server has confirmed <em>all</em> of your changes.
          </p>
          <ul className="space-y-1">
            <li><strong>Connection:</strong> {online ? 'Online' : 'Offline'}</li>
            <li><strong>Waiting to sync:</strong> {n}</li>
            <li><strong>Failed:</strong> {s.failed.length}</li>
            {s.lastSavedAt && <li><strong>Last confirmed save:</strong> {fmtDate(new Date(s.lastSavedAt).toISOString())}</li>}
            {s.lastError && <li><strong>Last error:</strong> {s.lastError}</li>}
          </ul>
          {(n > 0 || s.failed.length > 0) && (
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded border border-slate-200 p-2 text-xs">
              {[...s.pending.map((p) => ({ p, failed: false })), ...s.failed.map((p) => ({ p, failed: true }))].map(({ p, failed }) => (
                <li key={p.id} className={failed ? 'text-rose-800' : ''}>
                  {failed ? '✕ ' : '◌ '}
                  {p.kind === 'decision' ? `${p.decision ?? 'clear'}${p.reason ? ` (${p.reason})` : ''}` : 'note / field update'} —{' '}
                  {(p.title ?? 'Untitled').slice(0, 70)}
                  {p.lastError ? ` — ${p.lastError}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
