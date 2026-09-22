import type { Decision } from '../lib/types';
import { cx } from './ui';

export const DECISION_META: Record<Decision | 'unscreened', { label: string; icon: string; cls: string; solid: string }> = {
  include: { label: 'Included', icon: '✓', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300', solid: 'bg-emerald-700 hover:bg-emerald-800 text-white' },
  exclude: { label: 'Excluded', icon: '✕', cls: 'bg-rose-50 text-rose-800 border-rose-300', solid: 'bg-rose-700 hover:bg-rose-800 text-white' },
  maybe: { label: 'Maybe', icon: '?', cls: 'bg-amber-50 text-amber-900 border-amber-300', solid: 'bg-amber-500 hover:bg-amber-600 text-amber-950' },
  unscreened: { label: 'Unscreened', icon: '○', cls: 'bg-slate-50 text-slate-600 border-slate-300', solid: 'bg-slate-600 text-white' },
};

/** Decision shown with icon AND text (never colour alone). */
export function DecisionBadge({ decision, reason, compact }: { decision: Decision | null | undefined; reason?: string | null; compact?: boolean }) {
  const m = DECISION_META[decision ?? 'unscreened'];
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', m.cls)}>
      <span aria-hidden="true" className="font-bold">{m.icon}</span>
      <span className="truncate">{m.label}{!compact && reason ? ` — ${reason}` : ''}</span>
    </span>
  );
}

export function DecisionIcon({ decision }: { decision: Decision | null | undefined }) {
  const m = DECISION_META[decision ?? 'unscreened'];
  return (
    <span
      className={cx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold', m.cls)}
      title={m.label}
    >
      <span aria-hidden="true">{m.icon}</span>
      <span className="sr-only">{m.label}</span>
    </span>
  );
}

export const TAG_STYLES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-800 border-slate-300',
  blue: 'bg-blue-50 text-blue-900 border-blue-300',
  teal: 'bg-teal-50 text-teal-900 border-teal-300',
  green: 'bg-green-50 text-green-900 border-green-300',
  amber: 'bg-amber-50 text-amber-900 border-amber-300',
  orange: 'bg-orange-50 text-orange-900 border-orange-300',
  rose: 'bg-rose-50 text-rose-900 border-rose-300',
  violet: 'bg-violet-50 text-violet-900 border-violet-300',
};

export function TagChip({ name, color = 'slate', onRemove }: { name: string; color?: string; onRemove?: () => void }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium', TAG_STYLES[color] ?? TAG_STYLES.slate)}>
      <span aria-hidden="true">#</span>{name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 rounded px-0.5 hover:bg-black/10" aria-label={`Remove tag ${name}`}>✕</button>
      )}
    </span>
  );
}
