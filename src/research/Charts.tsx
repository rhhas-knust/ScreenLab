import type { Bar } from '../lib/research/analytics';
import { fmtDate } from '../lib/hooks';

/**
 * Horizontal bar list for one question. HTML rather than SVG so long option
 * labels wrap, text stays selectable, and it prints cleanly. Single series:
 * one hue, values printed at the bar end, hover title on each row.
 */
export function BarList({ bars, unit = 'respondents', caption }: { bars: Bar[]; unit?: string; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <figure className="space-y-1.5" aria-label={caption}>
      {bars.map((b) => (
        <div key={b.label} className="grid grid-cols-[minmax(6rem,14rem)_1fr] items-center gap-3 text-sm" title={`${b.label}: ${b.count} ${unit} (${b.pct}%)`}>
          <span className="break-words text-slate-700">{b.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-4 rounded-r bg-ink-500 print:bg-ink-500" style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count ? 4 : 0, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
            <span className="shrink-0 tabular-nums text-slate-700">{b.count}<span className="text-slate-500"> · {b.pct}%</span></span>
          </span>
        </div>
      ))}
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/** Responses submitted per day — columns, one hue, hover title per day. */
export function PerDayChart({ days }: { days: { date: string; count: number }[] }) {
  if (days.length < 2) return null;
  const W = 720, H = 140, left = 28, bottom = 22, y0 = 10;
  const max = Math.max(...days.map((d) => d.count));
  const band = (W - left) / days.length;
  const bw = Math.max(2, Math.min(28, band - 2));
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - y0);
  const labelEvery = Math.ceil(days.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Responses per day, ${days.length} days, peak ${max}`}>
      <line x1={left} x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--color-slate-300)" />
      <text x={left - 6} y={y(max) + 4} textAnchor="end" fontSize="11" fill="var(--color-slate-500)">{max}</text>
      {days.map((d, i) => (
        <g key={d.date}>
          <rect x={left + i * band + (band - bw) / 2} y={y(d.count)} width={bw} height={H - bottom - y(d.count)} rx="2" fill="var(--color-ink-500)">
            <title>{`${fmtDate(`${d.date}T12:00:00`, false)}: ${d.count} response${d.count === 1 ? '' : 's'}`}</title>
          </rect>
          {i % labelEvery === 0 && (
            <text x={left + i * band + band / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-slate-500)">{d.date.slice(5)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
