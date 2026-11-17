import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

export interface ToastOptions {
  kind?: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
  duration?: number;
}
interface ToastItem extends ToastOptions { id: number; message: string }

const Ctx = createContext<(message: string, opts?: ToastOptions) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, message, ...opts }]);
    const duration = opts.duration ?? (opts.kind === 'error' ? 8000 : opts.action ? 6000 : 3500);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-3 lg:inset-x-auto lg:right-4 lg:bottom-4 lg:items-end lg:px-0">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-sm shadow-lg lg:w-96',
              t.kind === 'error' ? 'border-rose-400 bg-rose-900 text-white' : 'border-lens-400 bg-ink-950 text-white',
            )}
          >
            <span aria-hidden="true" className={cx('font-bold', t.kind === 'error' ? 'text-rose-200' : 'text-lens-300')}>{t.kind === 'error' ? '!' : '✓'}</span>
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="rounded bg-white/15 px-2 py-1 font-semibold text-lens-300 hover:bg-white/25"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="rounded px-1 text-white/70 hover:text-white" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
