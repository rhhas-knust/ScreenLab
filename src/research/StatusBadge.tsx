import type { FormStatus } from '../lib/api/research';
import { cx } from '../components/ui';

const META: Record<FormStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  active: { label: '● Accepting responses', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  closed: { label: 'Closed', cls: 'bg-amber-50 text-amber-900 border-amber-300' },
};

export function StatusBadge({ status }: { status: FormStatus }) {
  const m = META[status];
  return <span className={cx('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', m.cls)} data-testid="rh-status">{m.label}</span>;
}
