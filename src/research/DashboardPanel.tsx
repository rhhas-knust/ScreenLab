import { useState } from 'react';
import { type DashboardItem } from '../lib/api/research';
import { buildChart, isCat, isNum, type Dataset } from '../lib/research/studio';
import { newItemId, statTile } from '../lib/research/dashboard';
import { Button, Card, EmptyState, Input, Select, cx } from '../components/ui';
import { StudioFigure } from './StudioFigure';

/**
 * The questionnaire's dashboard: headline numbers and pinned charts that
 * update as responses arrive. Editable by the owner; read-only on a results link.
 */
export function DashboardPanel({ items, ds, completion, editable = false, onChange, onOpenStudio }: {
  items: DashboardItem[];
  ds: Dataset;
  completion: number;
  editable?: boolean;
  onChange?: (items: DashboardItem[]) => void;
  /** Takes the owner to Chart studio to pin a chart. */
  onOpenStudio?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const stats = items.filter((i): i is Extract<DashboardItem, { kind: 'stat' }> => i.kind === 'stat');
  const charts = items.filter((i): i is Extract<DashboardItem, { kind: 'chart' }> => i.kind === 'chart');
  // Numbers and charts are ordered separately; moving one never disturbs the other kind.
  const move = (id: string, d: -1 | 1) => {
    const kind = items.find((i) => i.id === id)!.kind;
    const same = items.filter((i) => i.kind === kind), other = items.filter((i) => i.kind !== kind);
    const k = same.findIndex((i) => i.id === id), j = k + d;
    if (j < 0 || j >= same.length) return;
    [same[k], same[j]] = [same[j], same[k]];
    onChange?.(kind === 'stat' ? [...same, ...other] : [...other, ...same]);
  };
  const remove = (id: string) => onChange?.(items.filter((i) => i.id !== id));
  const tools = (id: string, extra?: React.ReactNode) => editable && (
    <div className="flex flex-wrap items-center gap-1 print:hidden">
      <Button size="sm" variant="ghost" onClick={() => move(id, -1)} aria-label="Move earlier">←</Button>
      <Button size="sm" variant="ghost" onClick={() => move(id, 1)} aria-label="Move later">→</Button>
      {extra}
      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(id)}>Remove</Button>
    </div>
  );

  if (!items.length && !editable) return <EmptyState title="No dashboard yet" />;
  return (
    <div className="space-y-4" data-testid="rh-dashboard">
      {editable && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <p className="flex-1 text-sm text-slate-600">Pin charts from <button type="button" className="underline" onClick={onOpenStudio}>Chart studio</button> (“Pin to dashboard”) and add headline numbers. Everything updates as responses arrive, and the dashboard also appears on your results link.</p>
          <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)} data-testid="rh-add-tile">{adding ? 'Close' : '+ Add a number'}</Button>
        </div>
      )}
      {adding && <AddTile ds={ds} onAdd={(t) => { onChange?.([...items, t]); setAdding(false); }} />}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((t) => {
            const v = statTile(t, ds, completion);
            return (
              <Card key={t.id} className="flex flex-col justify-between gap-2 p-4" as="article">
                <div data-testid="rh-tile">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{v.label}</p>
                  <p className="mt-1 text-3xl font-semibold text-ink-900 tabular-nums">{v.value}</p>
                  {v.sub && <p className="mt-1 text-xs text-slate-500">{v.sub}</p>}
                </div>
                {tools(t.id)}
              </Card>
            );
          })}
        </div>
      )}
      {charts.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <Card key={c.id} className={cx('space-y-2 p-3 break-inside-avoid', c.size === 'full' && 'lg:col-span-2')} as="article">
              <StudioFigure chart={buildChart(c.spec, ds)} />
              {tools(c.id, <Button size="sm" variant="ghost" onClick={() => onChange?.(items.map((i) => (i.id === c.id && i.kind === 'chart' ? { ...i, size: i.size === 'full' ? 'half' : 'full' } : i)))}>{c.size === 'full' ? 'Half width' : 'Full width'}</Button>)}
            </Card>
          ))}
        </div>
      ) : editable && (
        <EmptyState title="No charts pinned yet">Open Chart studio, make a chart, and press “Pin to dashboard”.</EmptyState>
      )}
    </div>
  );
}

function AddTile({ ds, onAdd }: { ds: Dataset; onAdd: (t: DashboardItem) => void }) {
  const nums = ds.vars.filter(isNum), cats = ds.vars.filter((v) => isCat(v));
  const [stat, setStat] = useState<'responses' | 'completion' | 'mean' | 'share'>('responses');
  const [variable, setVariable] = useState('');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const v = ds.vars.find((x) => x.name === variable);
  const ready = stat === 'responses' || stat === 'completion' || (stat === 'mean' && v) || (stat === 'share' && v && value);
  return (
    <Card className="grid gap-2 p-3 sm:grid-cols-[12rem_1fr_10rem_1fr_auto] sm:items-end print:hidden">
      <label className="text-sm">Show
        <Select aria-label="Tile type" value={stat} onChange={(e) => { setStat(e.target.value as typeof stat); setVariable(''); setValue(''); }}>
          <option value="responses">Number of responses</option>
          <option value="completion">Average completion</option>
          {nums.length > 0 && <option value="mean">Average of a number</option>}
          {cats.length > 0 && <option value="share">% who gave an answer</option>}
        </Select>
      </label>
      {(stat === 'mean' || stat === 'share') ? (
        <label className="text-sm">Question
          <Select aria-label="Tile question" value={variable} onChange={(e) => { setVariable(e.target.value); setValue(''); }}>
            <option value="">(choose)</option>
            {(stat === 'mean' ? nums : cats).map((x) => <option key={x.name} value={x.name}>{x.name}. {x.label.slice(0, 50)}</option>)}
          </Select>
        </label>
      ) : <span />}
      {stat === 'share' ? (
        <label className="text-sm">Answer
          <Select aria-label="Tile answer" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">(choose)</option>
            {(v?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </label>
      ) : <span />}
      <label className="text-sm">Title (optional)
        <Input aria-label="Tile title" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </label>
      <Button disabled={!ready} data-testid="rh-tile-add" onClick={() => onAdd({ id: newItemId(), kind: 'stat', stat, ...(variable ? { variable } : {}), ...(value ? { value } : {}), ...(label.trim() ? { label: label.trim() } : {}) })}>Add</Button>
    </Card>
  );
}
