import { useEffect, useRef, useState } from 'react';
import type { Decision, ExclusionReason, Stage } from '../lib/types';
import { DECISION_META } from '../components/Decision';
import { Button, Input, Kbd, cx } from '../components/ui';

export interface PendingChange {
  decision: Decision;
  reason?: string | null;
}

export function DecisionButtons({
  stage, current, onDecide, disabled, size = 'lg',
}: {
  stage: Stage; current: Decision | null; onDecide: (d: Decision) => void; disabled?: boolean; size?: 'lg' | 'md';
}) {
  const options: Decision[] = stage === 'title_abstract' ? ['include', 'exclude', 'maybe'] : ['include', 'exclude'];
  const keys: Record<Decision, string> = { include: 'I', exclude: 'E', maybe: 'M' };
  return (
    <div className={cx('grid gap-2', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')} role="group" aria-label="Screening decision">
      {options.map((d) => {
        const m = DECISION_META[d];
        const active = current === d;
        return (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => onDecide(d)}
            aria-pressed={active}
            aria-keyshortcuts={keys[d]}
            data-testid={`decide-${d}`}
            className={cx(
              'flex flex-col items-center justify-center rounded-xl border-2 font-bold tracking-wide uppercase transition-colors disabled:opacity-50',
              size === 'lg' ? 'min-h-16 px-2 py-2 text-sm' : 'min-h-12 px-2 py-1.5 text-xs',
              active ? cx(m.solid, 'border-transparent ring-2 ring-offset-2 ring-ink-900') : cx('bg-white', d === 'include' ? 'border-emerald-600 text-emerald-800 hover:bg-emerald-50' : d === 'exclude' ? 'border-rose-600 text-rose-800 hover:bg-rose-50' : 'border-amber-500 text-amber-900 hover:bg-amber-50'),
            )}
          >
            <span aria-hidden="true" className="text-lg leading-none">{m.icon}</span>
            <span>{d === 'include' ? 'Include' : d === 'exclude' ? 'Exclude' : 'Maybe'}</span>
            <span className="text-[10px] font-normal opacity-70">key {keys[d]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ConfirmChangeBar({ from, to, onConfirm, onCancel }: { from: Decision; to: PendingChange; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alertdialog" aria-label="Confirm decision change" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <p>
        Change <strong>{DECISION_META[from].icon} {DECISION_META[from].label}</strong> → <strong>{DECISION_META[to.decision].icon} {DECISION_META[to.decision].label}{to.reason ? ` — ${to.reason}` : ''}</strong>?
      </p>
      <p className="mt-1 text-xs">Press the same key again or Enter to confirm, Esc to cancel. The previous decision stays in the audit history.</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" onClick={onConfirm} autoFocus>Confirm change</Button>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function ReasonPicker({
  reasons, stage, onPick, onCancel, onAddReason, currentReason,
}: {
  reasons: ExclusionReason[]; stage: Stage; currentReason?: string | null;
  onPick: (reason: string | null) => void; onCancel: () => void;
  onAddReason: (label: string) => Promise<void>;
}) {
  const [custom, setCustom] = useState('');
  const [save, setSave] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const applicable = reasons.filter((r) => r.is_active && (r.stage === 'both' || r.stage === stage));
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  const submitCustom = async () => {
    const label = custom.trim();
    if (!label) return;
    if (save && !applicable.some((r) => r.label.toLowerCase() === label.toLowerCase())) {
      try {
        await onAddReason(label);
      } catch {
        /* reason list update is optional; the decision is still recorded */
      }
    }
    onPick(label);
  };
  return (
    <div className="rounded-xl border-2 border-rose-300 bg-rose-50/60 p-3" role="dialog" aria-label="Choose an exclusion reason" data-testid="reason-picker">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rose-900">✕ Exclusion reason</h3>
        <button type="button" className="rounded px-1 text-xs text-slate-600 hover:bg-white" onClick={onCancel}>Cancel (Esc)</button>
      </div>
      <div ref={listRef} className="grid gap-1">
        {applicable.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.label)}
            className={cx('flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-sm hover:border-rose-500 hover:bg-rose-50',
              currentReason === r.label ? 'border-rose-600 font-semibold' : 'border-slate-200')}
          >
            {i < 9 ? <Kbd>{i + 1}</Kbd> : <span className="w-5" />}
            <span>{r.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 border-t border-rose-200 pt-3">
        <label htmlFor={`custom-reason-${stage}`} className="text-xs font-medium text-slate-700">Other / custom reason</label>
        <div className="mt-1 flex gap-1">
          <Input id={`custom-reason-${stage}`} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type a reason…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitCustom(); } }} />
          <Button size="sm" variant="danger" onClick={() => void submitCustom()} disabled={!custom.trim()}>Exclude</Button>
        </div>
        <label className="mt-1 flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Add to this project’s reason list
        </label>
      </div>
      {stage === 'title_abstract' ? (
        <button type="button" className="mt-2 text-xs text-slate-600 underline" onClick={() => onPick(null)}>Exclude without a reason</button>
      ) : (
        <p className="mt-2 text-xs text-slate-600">A reason is required for full-text exclusions.</p>
      )}
    </div>
  );
}
