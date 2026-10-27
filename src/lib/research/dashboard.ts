// Headline numbers for dashboard tiles, worked out from the same dataset as
// Chart studio (so set-aside responses, filters and weights all apply).
import type { DashboardItem } from '../api/research';
import { round } from './analytics';
import { catsOf, findVar, numsOf, type Dataset } from './studio';

export interface TileValue { value: string; label: string; sub?: string }

export function statTile(item: Extract<DashboardItem, { kind: 'stat' }>, ds: Dataset, completion: number): TileValue {
  const v = findVar(ds, item.variable);
  const w = (i: number) => ds.weights?.[i] ?? 1;
  const weighted = !!ds.weights;
  switch (item.stat) {
    case 'responses':
      return { value: ds.n.toLocaleString('en-GB'), label: item.label || 'Responses' };
    case 'completion':
      return { value: `${completion}%`, label: item.label || 'Average completion', sub: 'share of questions answered' };
    case 'mean': {
      if (!v || v.kind !== 'numeric') return { value: '—', label: item.label || 'Mean', sub: 'question no longer available' };
      let sw = 0, sx = 0, n = 0;
      numsOf(v).forEach((x, i) => { if (x != null) { sw += w(i); sx += x * w(i); n++; } });
      return { value: sw ? String(round(sx / sw, 2)) : '—', label: item.label || `Mean ${v.name}`, sub: `${v.label.slice(0, 60)} · n = ${n}${weighted ? ' · weighted' : ''}` };
    }
    case 'share': {
      if (!v || !item.value) return { value: '—', label: item.label || 'Share', sub: 'question no longer available' };
      let hit = 0, all = 0, n = 0;
      for (let i = 0; i < ds.n; i++) {
        const c = catsOf(v, i);
        if (!c.length) continue;
        n++; all += w(i);
        if (c.includes(item.value)) hit += w(i);
      }
      return { value: all ? `${round((hit / all) * 100, 1)}%` : '—', label: item.label || `“${item.value}”`, sub: `${v.name}. ${v.label.slice(0, 50)} · of ${n} who answered${weighted ? ' · weighted' : ''}` };
    }
  }
}

export const newItemId = () => Math.random().toString(36).slice(2, 10);
