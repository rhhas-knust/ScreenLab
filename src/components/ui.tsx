import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-300',
  secondary: 'bg-white text-ink-900 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-ink-800 hover:bg-ink-50 disabled:text-slate-400',
  danger: 'bg-rose-700 text-white hover:bg-rose-800 disabled:bg-rose-300',
  subtle: 'bg-ink-50 text-ink-900 hover:bg-ink-100 disabled:text-slate-400',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }>(
  function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
          size === 'sm' && 'px-2.5 py-1.5 text-sm',
          size === 'md' && 'px-3.5 py-2 text-sm',
          size === 'lg' && 'px-5 py-3 text-base',
          VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading && <Spinner className="h-4 w-4" />}
        {children}
      </button>
    );
  },
);

export function Spinner({ className = 'h-5 w-5', label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <svg className={cx('animate-spin text-current', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className={label ? 'text-sm text-slate-600' : 'sr-only'}>{label ?? 'Loading'}</span>
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-ink-700">
      <Spinner label={label} />
    </div>
  );
}

export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</As>;
}

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-800">
      {children}
      {hint && <span className="ml-1 font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

const inputBase = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-lens-600 focus:outline-none focus:ring-2 focus:ring-lens-500/40 disabled:bg-slate-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputBase, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, children, id }: { label: string; hint?: string; id: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>{label}</Label>
      {children}
    </div>
  );
}

export function Alert({ kind = 'error', children, className }: { kind?: 'error' | 'info' | 'warning' | 'success'; children: ReactNode; className?: string }) {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    info: 'border-ink-200 bg-ink-50 text-ink-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-950',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[kind];
  const icon = { error: '⚠', info: 'ℹ', warning: '⚠', success: '✓' }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex gap-2 rounded-lg border px-3 py-2 text-sm', styles, className)}>
      <span aria-hidden="true" className="font-bold">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label ?? 'Progress'}
      >
        <div className="h-full rounded-full bg-lens-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Accessible modal dialog based on the native <dialog> element. */
export function Modal({
  open, onClose, title, children, footer, size = 'md', dismissable = true,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => {
        if (dismissable && e.target === ref.current) onClose();
      }}
      className={cx(
        'm-auto w-[calc(100%-1.5rem)] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40',
        size === 'sm' && 'max-w-md', size === 'md' && 'max-w-lg', size === 'lg' && 'max-w-2xl', size === 'xl' && 'max-w-5xl',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
            <h2 id={titleId} className="text-lg font-semibold text-ink-900">{title}</h2>
            {dismissable && (
              <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close dialog">✕</button>
            )}
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      {children && <div className="max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700 shadow-[0_1px_0_#cbd5e1]">{children}</kbd>;
}

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'include' | 'exclude' | 'maybe' | 'muted' }) {
  const toneCls = {
    default: 'text-ink-900', include: 'text-emerald-800', exclude: 'text-rose-800', maybe: 'text-amber-800', muted: 'text-slate-600',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
