import { forwardRef, useState, type ReactNode } from 'react';
import { round } from '../lib/research/analytics';
import { OTHER, SERIES, type ChartResult } from '../lib/research/studio';

/**
 * The Chart Studio figure. Plain SVG with hex colours and inline fonts so the
 * same element downloads as SVG or PNG exactly as it looks. Hover shows a
 * tooltip (HTML, outside the SVG, so it never ends up in the download).
 */
export const W = 760, H = 440;
const INK = '#16325c', TEXT2 = '#475569', MUTED = '#64748b', GRID = '#e2e8f0', AXIS = '#94a3b8', BAR = '#476ba3', BG = '#ffffff';
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
/** Sequential blue ramp (light → dark) for heatmap cells. */
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

export const seriesColor = (i: number, name?: string) => (name === 'Other' || i < 0 ? OTHER : SERIES[i % SERIES.length]);

/** Round axis ticks; `integer` keeps counts on whole numbers (no "0.5 respondents"). */
function niceTicks(lo: number, hi: number, count = 5, integer = false): number[] {
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  if (integer) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(round(v, 10));
  if (out[out.length - 1] < hi) out.push(round(out[out.length - 1] + step, 10));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : String(round(v, 2)));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A bar with its data end rounded (4px) and the baseline end square. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean, round_ = true): string {
  if (w <= 0 || h <= 0) return '';
  const r = round_ ? Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h) : 0;
  if (horizontal) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface Tip { x: number; y: number; lines: string[] }

export const StudioFigure = forwardRef<SVGSVGElement, { chart: ChartResult }>(function StudioFigure({ chart }, ref) {
  const [tip, setTip] = useState<Tip | null>(null);
  const m = chart.model;
  // Tooltips are positioned in viewBox units and scaled by the wrapper's CSS width.
  const hover = (lines: string[]) => ({
    onMouseMove: (e: React.MouseEvent<SVGElement>) => {
      const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
      const r = svg.getBoundingClientRect();
      setTip({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, lines });
    },
    onMouseLeave: () => setTip(null),
  });

  let body: ReactNode = null;
  let legend: { name: string; color: string }[] = [];
  let top = 52;
  const titleEl = <text x={16} y={28} fontSize={17} fontWeight={600} fill={INK}>{clip(chart.title, 80)}</text>;

  if (m.kind === 'empty') {
    body = <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill={MUTED}>{m.message}</text>;
  } else if (m.kind === 'bars') {
    if (m.series.length > 1) { legend = m.series.map((s, i) => ({ name: s.name, color: seriesColor(i, s.name) })); top = 76; }
    const cats = m.categories;
    const maxLabel = Math.max(...cats.map((c) => c.length));
    const totals = cats.map((_, i) => m.series.reduce((s, x) => s + x.values[i], 0));
    const vmax = Math.max(1e-9, ...(m.stacked ? totals : m.series.flatMap((s) => s.values)));
    const ticks = niceTicks(0, m.percent && !m.stacked ? Math.min(100, vmax) : vmax, 5, !m.percent);
    const tmax = ticks[ticks.length - 1];
    const single = m.series.length === 1;
    const showValues = single && cats.length <= 15;
    if (m.horizontal) {
      const left = Math.min(250, 40 + Math.min(maxLabel, 32) * 6.6), right = 56, bottom = 52;
      const pw = W - left - right, ph = H - top - bottom;
      const band = ph / cats.length;
      const sx = (v: number) => (v / tmax) * pw;
      const inner = band * 0.72;
      const bw = m.stacked || single ? inner : inner / m.series.length;
      body = (
        <g>
          {ticks.map((t) => <g key={t}><line x1={left + sx(t)} x2={left + sx(t)} y1={top} y2={top + ph} stroke={GRID} /><text x={left + sx(t)} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={MUTED}>{fmt(t)}{m.percent ? '%' : ''}</text></g>)}
          {cats.map((c, i) => {
            const y0 = top + i * band + (band - inner) / 2;
            let acc = 0;
            return (
              <g key={c}>
                <text x={left - 8} y={top + i * band + band / 2 + 4} textAnchor="end" fontSize={12} fill={TEXT2}>{clip(c, 34)}</text>
                {m.series.map((s, k) => {
                  const v = s.values[i];
                  const x = left + (m.stacked ? sx(acc) : 0);
                  const y = m.stacked || single ? y0 : y0 + k * bw;
                  const isTop = !m.stacked || k === m.series.length - 1 || m.series.slice(k + 1).every((z) => !z.values[i]);
                  acc += v;
                  return <path key={k} d={barPath(x, y, sx(v), bw, true, isTop)} fill={single ? BAR : seriesColor(k, s.name)} stroke={m.stacked || !single ? BG : 'none'} strokeWidth={m.stacked ? 2 : 1} {...hover([c, `${single ? '' : `${s.name}: `}${fmt(v)}${m.percent ? '%' : ''}`])} />;
                })}
                {showValues && <text x={left + sx(m.series[0].values[i]) + 6} y={y0 + inner / 2 + 4} fontSize={12} fill={TEXT2}>{fmt(m.series[0].values[i])}{m.percent ? '%' : ''}</text>}
              </g>
            );
          })}
          <line x1={left} x2={left} y1={top} y2={top + ph} stroke={AXIS} />
          <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.ylabel} ylabel={chart.xlabel} bottomPad={40} />
        </g>
      );
    } else {
      const rotate = cats.length > 6 || maxLabel > 14;
      const bottom = rotate ? Math.min(150, 40 + Math.min(maxLabel, 24) * 4.6) : 58;
      const left = 64, right = 20;
      const pw = W - left - right, ph = H - top - bottom;
      const band = pw / cats.length;
      const sy = (v: number) => (v / tmax) * ph;
      const inner = Math.min(band * 0.72, single ? 90 : 160);
      const bw = m.stacked || single ? inner : inner / m.series.length;
      body = (
        <g>
          {ticks.map((t) => <g key={t}><line x1={left} x2={left + pw} y1={top + ph - sy(t)} y2={top + ph - sy(t)} stroke={GRID} /><text x={left - 8} y={top + ph - sy(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{fmt(t)}{m.percent ? '%' : ''}</text></g>)}
          {cats.map((c, i) => {
            const x0 = left + i * band + (band - inner) / 2;
            const cx = left + i * band + band / 2;
            let acc = 0;
            return (
              <g key={c}>
                {m.series.map((s, k) => {
                  const v = s.values[i];
                  acc += v;
                  const x = m.stacked || single ? x0 : x0 + k * bw;
                  const y = top + ph - sy(m.stacked ? acc : v);
                  const isTop = !m.stacked || k === m.series.length - 1 || m.series.slice(k + 1).every((z) => !z.values[i]);
                  return <path key={k} d={barPath(x, y, bw, sy(v), false, isTop)} fill={single ? BAR : seriesColor(k, s.name)} stroke={m.stacked || !single ? BG : 'none'} strokeWidth={m.stacked ? 2 : 1} {...hover([c, `${single ? '' : `${s.name}: `}${fmt(v)}${m.percent ? '%' : ''}`])} />;
                })}
                {showValues && <text x={cx} y={top + ph - sy(m.series[0].values[i]) - 6} textAnchor="middle" fontSize={12} fill={TEXT2}>{fmt(m.series[0].values[i])}{m.percent ? '%' : ''}</text>}
                {rotate
                  ? <text transform={`translate(${cx + 4},${top + ph + 14}) rotate(-35)`} textAnchor="end" fontSize={12} fill={TEXT2}>{clip(c, 24)}</text>
                  : <text x={cx} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={TEXT2}>{clip(c, Math.max(4, Math.floor(band / 7)))}</text>}
              </g>
            );
          })}
          <line x1={left} x2={left + pw} y1={top + ph} y2={top + ph} stroke={AXIS} />
          <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={bottom - 12} />
        </g>
      );
    }
  } else if (m.kind === 'pie') {
    const cx = 250, cy = (H + top) / 2 - 4, r = Math.min(150, (H - top - 30) / 2);
    const total = m.slices.reduce((s, x) => s + x.count, 0);
    let a0 = -Math.PI / 2;
    legend = [];
    body = (
      <g>
        {total === 0 && <circle cx={cx} cy={cy} r={r} fill={GRID} />}
        {m.slices.map((s, i) => {
          if (!s.count) return null;
          const a1 = a0 + (s.count / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = s.count === total
            ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
            : `M${cx},${cy}L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}Z`;
          const mid = (a0 + a1) / 2;
          a0 = a1;
          const pct = (s.count / total) * 100;
          return (
            <g key={s.label}>
              <path d={d} fill={seriesColor(i)} stroke={BG} strokeWidth={2} {...hover([s.label, `${s.count} (${s.pct}%)`])} />
              {pct >= 6 && <text x={cx + r * 0.66 * Math.cos(mid)} y={cy + r * 0.66 * Math.sin(mid) + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff">{Math.round(pct)}%</text>}
            </g>
          );
        })}
        {m.slices.map((s, i) => (
          <g key={s.label} transform={`translate(450,${top + 12 + i * 24})`}>
            <rect width={12} height={12} rx={3} fill={seriesColor(i)} />
            <text x={20} y={11} fontSize={12} fill={TEXT2}>{clip(s.label, 30)} <tspan fill={MUTED}>· {s.count} ({s.pct}%)</tspan></text>
          </g>
        ))}
      </g>
    );
  } else if (m.kind === 'hist') {
    const left = 64, right = 20, bottom = 58;
    const pw = W - left - right, ph = H - top - bottom;
    const lo = m.bins[0].lo, hi = m.bins[m.bins.length - 1].hi;
    const ticks = niceTicks(0, Math.max(...m.bins.map((b) => b.count)), 5, true);
    const tmax = ticks[ticks.length - 1];
    const sx = (v: number) => left + ((v - lo) / (hi - lo)) * pw;
    const sy = (v: number) => (v / tmax) * ph;
    const xt = m.bins.length <= 12 ? [...m.bins.map((b) => b.lo), hi] : niceTicks(lo, hi, 8).filter((t) => t >= lo && t <= hi);
    const integer = m.bins.every((b) => b.hi - b.lo === 1 && Number.isInteger(b.lo + 0.5));
    body = (
      <g>
        {ticks.map((t) => <g key={t}><line x1={left} x2={left + pw} y1={top + ph - sy(t)} y2={top + ph - sy(t)} stroke={GRID} /><text x={left - 8} y={top + ph - sy(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{fmt(t)}</text></g>)}
        {m.bins.map((b, i) => (
          <path key={i} d={barPath(sx(b.lo) + 1, top + ph - sy(b.count), Math.max(1, sx(b.hi) - sx(b.lo) - 2), sy(b.count), false)} fill={BAR}
            {...hover([integer ? `Value ${fmt(b.lo + 0.5)}` : `${fmt(b.lo)} to ${fmt(b.hi)}`, `${b.count} respondent${b.count === 1 ? '' : 's'}`])} />
        ))}
        {(integer ? m.bins.map((b) => b.lo + 0.5) : xt).map((t) => <text key={t} x={sx(t)} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={MUTED}>{fmt(t)}</text>)}
        <line x1={left} x2={left + pw} y1={top + ph} y2={top + ph} stroke={AXIS} />
        <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={46} />
      </g>
    );
  } else if (m.kind === 'box' || m.kind === 'means') {
    const left = 64, right = 20;
    const names = m.groups.map((g) => g.name);
    const rotate = names.length > 6 || Math.max(...names.map((n) => n.length)) > 14;
    const bottom = rotate ? 120 : 58;
    const pw = W - left - right, ph = H - top - bottom;
    const vals = m.kind === 'box' ? m.groups.flatMap((g) => [g.lo, g.hi, ...g.outliers]) : m.groups.flatMap((g) => [g.lo, g.hi]);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const t0 = ticks[0], t1 = ticks[ticks.length - 1];
    const sy = (v: number) => top + ph - ((v - t0) / (t1 - t0)) * ph;
    const band = pw / m.groups.length;
    const bw = Math.min(70, band * 0.5);
    body = (
      <g>
        {ticks.map((t) => <g key={t}><line x1={left} x2={left + pw} y1={sy(t)} y2={sy(t)} stroke={GRID} /><text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{fmt(t)}</text></g>)}
        {m.kind === 'box' ? m.groups.map((g, i) => {
          const cx = left + i * band + band / 2;
          return (
            <g key={g.name} {...hover([g.name, `n ${g.n} · median ${fmt(g.median!)}`, `Q1 ${fmt(g.q1!)} · Q3 ${fmt(g.q3!)}`, `mean ${fmt(g.mean!)} · range ${fmt(g.min!)}–${fmt(g.max!)}`])}>
              <rect x={cx - bw / 2} y={sy(g.hi)} width={bw} height={Math.max(1, sy(g.lo) - sy(g.hi))} fill="transparent" />
              <line x1={cx} x2={cx} y1={sy(g.hi)} y2={sy(g.q3!)} stroke={INK} strokeWidth={1.5} />
              <line x1={cx} x2={cx} y1={sy(g.q1!)} y2={sy(g.lo)} stroke={INK} strokeWidth={1.5} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(g.hi)} y2={sy(g.hi)} stroke={INK} strokeWidth={1.5} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(g.lo)} y2={sy(g.lo)} stroke={INK} strokeWidth={1.5} />
              <rect x={cx - bw / 2} y={sy(g.q3!)} width={bw} height={Math.max(2, sy(g.q1!) - sy(g.q3!))} rx={4} fill="#c7d5ea" stroke={BAR} strokeWidth={1.5} />
              <line x1={cx - bw / 2} x2={cx + bw / 2} y1={sy(g.median!)} y2={sy(g.median!)} stroke={INK} strokeWidth={2.5} />
              {g.outliers.map((o, k) => <circle key={k} cx={cx} cy={sy(o)} r={4} fill={BG} stroke={BAR} strokeWidth={1.5} />)}
            </g>
          );
        }) : m.groups.map((g, i) => {
          const cx = left + i * band + band / 2;
          return (
            <g key={g.name} {...hover([g.name, `mean ${fmt(g.mean)} (n ${g.n})`, `95% CI ${fmt(g.lo)} to ${fmt(g.hi)}`])}>
              <rect x={cx - band / 2} y={top} width={band} height={ph} fill="transparent" />
              <line x1={cx} x2={cx} y1={sy(g.hi)} y2={sy(g.lo)} stroke={INK} strokeWidth={2} />
              <line x1={cx - 8} x2={cx + 8} y1={sy(g.hi)} y2={sy(g.hi)} stroke={INK} strokeWidth={2} />
              <line x1={cx - 8} x2={cx + 8} y1={sy(g.lo)} y2={sy(g.lo)} stroke={INK} strokeWidth={2} />
              <circle cx={cx} cy={sy(g.mean)} r={6} fill={BAR} stroke={BG} strokeWidth={2} />
              <text x={cx + 12} y={sy(g.mean) + 4} fontSize={12} fill={TEXT2}>{fmt(g.mean)}</text>
            </g>
          );
        })}
        {m.groups.map((g, i) => {
          const cx = left + i * band + band / 2;
          return rotate
            ? <text key={g.name} transform={`translate(${cx + 4},${top + ph + 14}) rotate(-35)`} textAnchor="end" fontSize={12} fill={TEXT2}>{clip(g.name, 22)}</text>
            : <text key={g.name} x={cx} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={TEXT2}>{clip(g.name, Math.max(4, Math.floor(band / 7)))}</text>;
        })}
        <line x1={left} x2={left + pw} y1={top + ph} y2={top + ph} stroke={AXIS} />
        <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={bottom - 12} />
      </g>
    );
  } else if (m.kind === 'scatter') {
    if (m.groups.length) { legend = m.groups.map((g, i) => ({ name: g, color: seriesColor(i, g) })); top = 76; }
    const left = 64, right = 20, bottom = 58;
    const pw = W - left - right, ph = H - top - bottom;
    const xt = niceTicks(m.xr[0], m.xr[1]), yt = niceTicks(m.yr[0], m.yr[1]);
    const sx = (v: number) => left + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw;
    const sy = (v: number) => top + ph - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ph;
    // Identical answers (common on scales) are drawn once, sized by how many people gave them.
    const stack = new Map<string, { x: number; y: number; g: number; n: number }>();
    for (const p of m.points) { const k = `${p.x}|${p.y}|${p.g}`; const s = stack.get(k); if (s) s.n++; else stack.set(k, { ...p, n: 1 }); }
    const x0 = xt[0], x1 = xt[xt.length - 1];
    body = (
      <g>
        {yt.map((t) => <g key={`y${t}`}><line x1={left} x2={left + pw} y1={sy(t)} y2={sy(t)} stroke={GRID} /><text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{fmt(t)}</text></g>)}
        {xt.map((t) => <text key={`x${t}`} x={sx(t)} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={MUTED}>{fmt(t)}</text>)}
        <line x1={left} x2={left + pw} y1={top + ph} y2={top + ph} stroke={AXIS} />
        {[...stack.values()].map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={Math.min(14, 4 + Math.sqrt(p.n - 1) * 2.5)} fill={m.groups.length ? seriesColor(p.g, m.groups[p.g]) : BAR} fillOpacity={0.8} stroke={BG} strokeWidth={1.5}
            {...hover([`x ${fmt(p.x)}, y ${fmt(p.y)}`, `${p.n} respondent${p.n === 1 ? '' : 's'}${m.groups.length ? ` · ${m.groups[p.g] ?? 'no answer'}` : ''}`])} />
        ))}
        {m.fit && <line x1={sx(x0)} x2={sx(x1)} y1={sy(m.fit.slope * x0 + m.fit.intercept)} y2={sy(m.fit.slope * x1 + m.fit.intercept)} stroke={INK} strokeWidth={2} strokeDasharray="6 4" clipPath="url(#plot-clip)" />}
        <clipPath id="plot-clip"><rect x={left} y={top} width={pw} height={ph} /></clipPath>
        <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={46} />
      </g>
    );
  } else if (m.kind === 'line') {
    const left = 64, right = 24, bottom = 58;
    const pw = W - left - right, ph = H - top - bottom;
    const yt = niceTicks(0, Math.max(...m.points.map((p) => p.y)), 5, true);
    const ymax = yt[yt.length - 1];
    const n = m.points.length;
    const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
    const d0 = day(m.points[0].x), d1 = day(m.points[n - 1].x);
    const sx = (s: string) => left + (d1 === d0 ? pw / 2 : ((day(s) - d0) / (d1 - d0)) * pw);
    const sy = (v: number) => top + ph - (v / ymax) * ph;
    const every = Math.ceil(n / 8);
    body = (
      <g>
        {yt.map((t) => <g key={t}><line x1={left} x2={left + pw} y1={sy(t)} y2={sy(t)} stroke={GRID} /><text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{fmt(t)}</text></g>)}
        <line x1={left} x2={left + pw} y1={top + ph} y2={top + ph} stroke={AXIS} />
        <polyline points={m.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke={BAR} strokeWidth={2} strokeLinejoin="round" />
        {m.points.map((p, i) => (
          <g key={p.x}>
            {n <= 40 && <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={BAR} stroke={BG} strokeWidth={1.5} />}
            <rect x={sx(p.x) - Math.max(4, pw / n / 2)} y={top} width={Math.max(8, pw / n)} height={ph} fill="transparent" {...hover([p.x, `${p.y} ${m.cumulative ? 'in total' : `response${p.y === 1 ? '' : 's'}`}`])} />
            {i % every === 0 && <text x={sx(p.x)} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={MUTED}>{p.x.slice(5)}</text>}
          </g>
        ))}
        <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={46} />
      </g>
    );
  } else if (m.kind === 'heatmap') {
    const maxRow = Math.max(...m.rows.map((r) => r.length)), maxCol = Math.max(...m.cols.map((c) => c.length));
    const left = Math.min(200, 30 + Math.min(maxRow, 28) * 6.6), right = 20;
    const rotate = m.cols.length > 5 || maxCol > 12;
    const bottom = rotate ? Math.min(140, 40 + Math.min(maxCol, 22) * 4.6) : 58;
    const pw = W - left - right, ph = H - top - bottom;
    const cw = pw / m.cols.length, ch = ph / m.rows.length;
    const vmax = Math.max(1, ...m.counts.flat());
    const color = (v: number) => (v === 0 ? '#f1f5f9' : RAMP[Math.min(RAMP.length - 1, Math.round((v / vmax) * (RAMP.length - 1)))]);
    body = (
      <g>
        {m.rows.map((r, i) => (
          <g key={r}>
            <text x={left - 8} y={top + i * ch + ch / 2 + 4} textAnchor="end" fontSize={12} fill={TEXT2}>{clip(r, 30)}</text>
            {m.cols.map((c, j) => {
              const v = m.counts[i][j];
              const dark = RAMP.indexOf(color(v)) >= 6;
              return (
                <g key={c} {...hover([`${r} × ${c}`, `${v} respondent${v === 1 ? '' : 's'}`])}>
                  <rect x={left + j * cw + 1} y={top + i * ch + 1} width={cw - 2} height={ch - 2} rx={4} fill={color(v)} />
                  {ch > 16 && cw > 24 && <text x={left + j * cw + cw / 2} y={top + i * ch + ch / 2 + 4} textAnchor="middle" fontSize={12} fill={dark ? '#ffffff' : INK}>{v}</text>}
                </g>
              );
            })}
          </g>
        ))}
        {m.cols.map((c, j) => rotate
          ? <text key={c} transform={`translate(${left + j * cw + cw / 2 + 4},${top + ph + 14}) rotate(-35)`} textAnchor="end" fontSize={12} fill={TEXT2}>{clip(c, 22)}</text>
          : <text key={c} x={left + j * cw + cw / 2} y={top + ph + 18} textAnchor="middle" fontSize={12} fill={TEXT2}>{clip(c, Math.max(4, Math.floor(cw / 7)))}</text>)}
        <AxisLabels left={left} top={top} pw={pw} ph={ph} xlabel={chart.xlabel} ylabel={chart.ylabel} bottomPad={bottom - 12} />
      </g>
    );
  }

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="h-auto w-full max-w-full" role="img" aria-label={`${chart.title}. ${chart.stats.join(' ')}`}
        fontFamily={FONT} xmlns="http://www.w3.org/2000/svg" data-testid="rh-studio-figure">
        <rect width={W} height={H} fill={BG} />
        {titleEl}
        {legend.length > 0 && (
          <g transform="translate(16,44)">
            {legend.reduce<{ x: number; els: ReactNode[] }>((acc, l) => {
              const w = 24 + Math.min(l.name.length, 24) * 6.8;
              acc.els.push(<g key={l.name} transform={`translate(${acc.x},0)`}><rect width={12} height={12} rx={3} fill={l.color} /><text x={18} y={11} fontSize={12} fill={TEXT2}>{clip(l.name, 24)}</text></g>);
              acc.x += w;
              return acc;
            }, { x: 0, els: [] }).els}
          </g>
        )}
        {body}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
          style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="tooltip">
          {tip.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : 'text-slate-200'}>{l}</div>)}
        </div>
      )}
    </div>
  );
});

function AxisLabels({ left, top, pw, ph, xlabel, ylabel, bottomPad }: { left: number; top: number; pw: number; ph: number; xlabel: string; ylabel: string; bottomPad: number }) {
  return (
    <g>
      {xlabel && <text x={left + pw / 2} y={Math.min(H - 6, top + ph + bottomPad)} textAnchor="middle" fontSize={12} fontWeight={500} fill={TEXT2}>{clip(xlabel, 90)}</text>}
      {ylabel && <text transform={`translate(16,${top + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fontWeight={500} fill={TEXT2}>{clip(ylabel, 50)}</text>}
    </g>
  );
}

/** Serialise the figure for download. */
export function svgMarkup(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('class');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Render the figure to a PNG at 2× (sharp in Word and PowerPoint). */
export function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  return markupToPng(svgMarkup(svg), scale);
}

/** PNG of a figure given as SVG markup (e.g. rendered off-screen for the Word report). */
export function markupToPng(markup: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * scale; c.height = H * scale;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = BG; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('PNG export failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}
