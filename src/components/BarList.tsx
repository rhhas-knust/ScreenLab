import { useState } from 'react';
import { fmt } from '../lib/hooks';

/**
 * Single-series horizontal bar chart (magnitude). One hue, values labelled
 * directly in text ink, per-bar hover tooltip, and a table view toggle.
 */
export function BarList({ title, rows, empty = 'No data yet.' }: { title: string; rows: { label: string; value: number }[]; empty?: string }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">{title}</span>
        {rows.length > 0 && (
          <button type="button" className="text-xs text-ink-700 underline" onClick={() => setTable((t) => !t)}>
            {table ? 'Show chart' : 'Show table'}
          </button>
        )}
      </figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Category</th><th className="py-1 text-right">Records</th><th className="py-1 text-right">Share</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{fmt(r.value)}</td>
                <td className="py-1 text-right tabular-nums text-slate-600">{((r.value / total) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="space-y-0.5" role="list">
          {rows.map((r, i) => (
            <li key={r.label} className="relative grid grid-cols-[minmax(6rem,11rem)_1fr_3.5rem] items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className="truncate text-slate-800" title={r.label}>{r.label}</span>
              <span className="h-3 rounded-r bg-slate-100" aria-hidden="true">
                <span className="block h-3 rounded-r-[4px] bg-ink-600" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums text-slate-700">{fmt(r.value)}</span>
              {hover === i && (
                <span role="tooltip" className="pointer-events-none absolute -top-8 left-1/3 z-10 rounded bg-ink-950 px-2 py-1 text-xs whitespace-nowrap text-white shadow">
                  {r.label}: {fmt(r.value)} ({((r.value / total) * 100).toFixed(1)}%)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
