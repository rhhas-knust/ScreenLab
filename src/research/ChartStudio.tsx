import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Papa from 'papaparse';
import type { RhField, RhResponse } from '../lib/api/research';
import { buildChart, buildDataset, CHART_TYPES, defaultSpec, findVar, isCat, isNum, type ChartSpec, type ChartType, type Dataset, type StudioVar } from '../lib/research/studio';
import { HELP, runCommand } from '../lib/research/commands';
import { exportPack, script, SCRIPT_FILE, SCRIPT_NAME, type ScriptLang } from '../lib/research/exportPack';
import { downloadBlob, downloadText, safeFileName } from '../lib/export/formats';
import { Button, Card, Input, Label, Select, cx } from '../components/ui';
import { useToast } from '../components/Toast';
import { StudioFigure, svgMarkup, svgToPng } from './StudioFigure';

interface LogLine { kind: 'in' | 'out' | 'err'; text: string }

/** Which variable fills which role, per chart type (box/means keep "values" in y and "split by" in x). */
function roles(spec: ChartSpec, ds: Dataset) {
  if (spec.type === 'box' || spec.type === 'means') {
    const x = findVar(ds, spec.x);
    return { value: spec.y ?? (x && isNum(x) ? spec.x : ''), by: spec.y ? spec.x : spec.group ?? '' };
  }
  return { value: '', by: '' };
}

/**
 * MATLAB-style figures and tests in the browser: pick a chart, or type a
 * command such as bar(Q1) or ttest2(Q2, Q1), then download the picture, the
 * numbers, or a ready-to-run MATLAB / R / SPSS / Stata script.
 */
export function ChartStudio({ title, fields, responses, weights, initialVar, includeEmail = true, onPin }: {
  title: string; fields: RhField[]; responses: RhResponse[]; weights?: Map<string, number> | null; initialVar?: string | null; includeEmail?: boolean;
  /** Owner only: add the current chart to the questionnaire's dashboard. */
  onPin?: (spec: ChartSpec) => void;
}) {
  const toast = useToast();
  const ds = useMemo(() => buildDataset(fields, responses, weights), [fields, responses, weights]);
  const [spec, setSpec] = useState<ChartSpec>(() => {
    const v = initialVar ? findVar(ds, initialVar) : undefined;
    if (v) return isCat(v) ? { type: 'bar', x: v.name } : isNum(v) ? { type: 'histogram', x: v.name } : v.kind === 'date' ? { type: 'line', x: v.name } : defaultSpec(ds);
    return defaultSpec(ds);
  });
  const chart = useMemo(() => buildChart(spec, ds), [spec, ds]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [showTable, setShowTable] = useState(false);
  const [log, setLog] = useState<LogLine[]>([{ kind: 'out', text: 'Type a command like bar(Q1), histogram(Q2) or mean(Q2), or help for the full list. who lists the variables.' }]);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const usable = ds.vars.filter((v) => !v.email && v.kind !== 'text');
  const cats = usable.filter(isCat);
  const nums = usable.filter(isNum);
  const dates = usable.filter((v) => v.kind === 'date');
  const opt = (v: StudioVar) => <option key={v.name} value={v.name}>{v.name}. {v.label.slice(0, 70)}</option>;
  const set = (patch: Partial<ChartSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const r = roles(spec, ds);

  const changeType = (type: ChartType) => {
    setSpec((s) => {
      const keep = { title: s.title, xlabel: undefined, ylabel: undefined };
      const cur = findVar(ds, s.x);
      const firstCat = (cur && isCat(cur) ? cur : cats[0])?.name ?? '';
      const firstNum = (cur && isNum(cur) ? cur : nums[0])?.name ?? '';
      switch (type) {
        case 'bar': case 'barh': return { ...keep, type, x: firstCat, group: s.group && s.group !== firstCat ? s.group : undefined, percent: s.percent, stacked: s.stacked };
        case 'pie': return { ...keep, type, x: (cur && isCat(cur) && cur.kind !== 'multi' ? cur : cats.find((v) => v.kind !== 'multi'))?.name ?? '' };
        case 'histogram': return { ...keep, type, x: firstNum };
        case 'box': return { ...keep, type, x: firstNum };
        case 'means': { const by = cats.find((v) => v.kind !== 'multi' && v.name !== firstNum); return by ? { ...keep, type, x: by.name, y: firstNum } : { ...keep, type, x: firstNum }; }
        case 'scatter': return { ...keep, type, x: nums[0]?.name ?? '', y: (nums[1] ?? nums[0])?.name, fit: true };
        case 'line': return { ...keep, type, x: dates.find((d) => d.name === 'Submitted')?.name ?? 'Submitted' };
        case 'heatmap': return { ...keep, type, x: cats[0]?.name ?? '', y: (cats[1] ?? cats[0])?.name };
      }
    });
  };
  const setValue = (v: string) => setSpec((s) => (r.by ? { ...s, x: r.by, y: v, group: undefined } : { ...s, x: v, y: undefined, group: undefined }));
  const setBy = (b: string) => setSpec((s) => (b ? { ...s, x: b, y: r.value, group: undefined } : { ...s, x: r.value, y: undefined, group: undefined }));

  const run = (src: string) => {
    const text = src.trim();
    if (!text) return;
    setHistory((h) => [...h.filter((x) => x !== text), text].slice(-50));
    setHIdx(-1);
    const res = runCommand(text, ds, spec);
    if (res.clear) { setLog([]); return; }
    if (res.spec) setSpec(res.spec);
    const lines: LogLine[] = [{ kind: 'in', text }];
    if (res.output) lines.push({ kind: res.error ? 'err' : 'out', text: res.output });
    setLog((l) => [...l, ...lines].slice(-200));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { run(cmd); setCmd(''); }
    else if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); const i = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1); setHIdx(i); setCmd(history[i]); }
    else if (e.key === 'ArrowDown' && hIdx >= 0) { e.preventDefault(); const i = hIdx + 1; if (i >= history.length) { setHIdx(-1); setCmd(''); } else { setHIdx(i); setCmd(history[i]); } }
  };

  const base = `${safeFileName(title)}_${safeFileName(chart.title).slice(0, 30)}`;
  const empty = chart.model.kind === 'empty';
  const png = async () => {
    if (!svgRef.current) return;
    try { downloadBlob(`${base}.png`, await svgToPng(svgRef.current)); } catch { toast('Could not make the PNG in this browser. Try the SVG.', { kind: 'error' }); }
  };
  const svg = () => svgRef.current && downloadText(`${base}.svg`, svgMarkup(svgRef.current), 'image/svg+xml');
  const csv = () => downloadText(`${base}_data.csv`, '﻿' + Papa.unparse(chart.table.map((row) => row.map(String))), 'text/csv');
  const pack = () => {
    const bytes = exportPack(spec, ds, chart, { includeEmail, title });
    downloadBlob(`${safeFileName(title)}_analysis_pack.zip`, new Blob([bytes as BlobPart], { type: 'application/zip' }));
  };
  const one = (lang: ScriptLang) => downloadText(SCRIPT_FILE[lang], script(lang, spec, ds, chart), 'text/plain');
  const typeInfo = CHART_TYPES.find((t) => t.type === spec.type)!;

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]" data-testid="rh-studio">
      <Card className="space-y-3 p-4">
        <div>
          <Label htmlFor="st-type">Chart</Label>
          <Select id="st-type" value={spec.type} onChange={(e) => changeType(e.target.value as ChartType)} data-testid="rh-studio-type">
            {CHART_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
          <p className="mt-1 text-xs text-slate-500">Needs {typeInfo.needs}. MATLAB: <code>{typeInfo.matlab}</code></p>
        </div>

        {(spec.type === 'bar' || spec.type === 'barh' || spec.type === 'pie') && (
          <>
            <div>
              <Label htmlFor="st-x">Question</Label>
              <Select id="st-x" value={spec.x} onChange={(e) => set({ x: e.target.value, title: undefined })}>
                {(spec.type === 'pie' ? cats.filter((v) => v.kind !== 'multi') : cats).map(opt)}
              </Select>
            </div>
            {spec.type !== 'pie' && (
              <div>
                <Label htmlFor="st-g">Split by (optional)</Label>
                <Select id="st-g" value={spec.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {cats.filter((v) => v.name !== spec.x).map(opt)}
                </Select>
              </div>
            )}
          </>
        )}
        {spec.type === 'histogram' && (
          <>
            <div>
              <Label htmlFor="st-x">Question</Label>
              <Select id="st-x" value={spec.x} onChange={(e) => set({ x: e.target.value, title: undefined })}>{nums.map(opt)}</Select>
            </div>
            {!findVar(ds, spec.x)?.scale && (
              <div>
                <Label htmlFor="st-bins">Number of bins</Label>
                <Input id="st-bins" type="number" min={1} max={50} value={spec.bins ?? ''} placeholder="auto" onChange={(e) => set({ bins: e.target.value ? Number(e.target.value) : undefined })} />
              </div>
            )}
          </>
        )}
        {(spec.type === 'box' || spec.type === 'means') && (
          <>
            <div>
              <Label htmlFor="st-y">Values (number)</Label>
              <Select id="st-y" value={r.value} onChange={(e) => setValue(e.target.value)}>{nums.map(opt)}</Select>
            </div>
            <div>
              <Label htmlFor="st-g">Split by{spec.type === 'box' ? ' (optional)' : ''}</Label>
              <Select id="st-g" value={r.by} onChange={(e) => setBy(e.target.value)}>
                {spec.type === 'box' && <option value="">— none —</option>}
                {cats.filter((v) => v.name !== r.value).map(opt)}
              </Select>
            </div>
          </>
        )}
        {spec.type === 'scatter' && (
          <>
            <div><Label htmlFor="st-x">X axis</Label><Select id="st-x" value={spec.x} onChange={(e) => set({ x: e.target.value })}>{nums.map(opt)}</Select></div>
            <div><Label htmlFor="st-y">Y axis</Label><Select id="st-y" value={spec.y ?? ''} onChange={(e) => set({ y: e.target.value })}>{nums.map(opt)}</Select></div>
            <div>
              <Label htmlFor="st-g">Colour by (optional)</Label>
              <Select id="st-g" value={spec.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })}>
                <option value="">— none —</option>
                {cats.filter((v) => v.kind !== 'multi').map(opt)}
              </Select>
            </div>
          </>
        )}
        {spec.type === 'line' && (
          <div><Label htmlFor="st-x">Date</Label><Select id="st-x" value={spec.x} onChange={(e) => set({ x: e.target.value })}>{dates.map(opt)}</Select></div>
        )}
        {spec.type === 'heatmap' && (
          <>
            <div><Label htmlFor="st-x">Rows</Label><Select id="st-x" value={spec.x} onChange={(e) => set({ x: e.target.value })}>{cats.map(opt)}</Select></div>
            <div><Label htmlFor="st-y">Columns</Label><Select id="st-y" value={spec.y ?? ''} onChange={(e) => set({ y: e.target.value })}>{cats.filter((v) => v.name !== spec.x).map(opt)}</Select></div>
          </>
        )}

        <div className="space-y-1.5 text-sm">
          {(spec.type === 'bar' || spec.type === 'barh') && (
            <>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!spec.percent} onChange={(e) => set({ percent: e.target.checked })} /> Show percentages</label>
              {spec.group ? <label className="flex items-center gap-2"><input type="checkbox" checked={!!spec.stacked} onChange={(e) => set({ stacked: e.target.checked })} /> Stacked</label>
                : <label className="flex items-center gap-2"><input type="checkbox" checked={!!spec.sort} onChange={(e) => set({ sort: e.target.checked })} /> Sort largest first</label>}
            </>
          )}
          {spec.type === 'scatter' && <label className="flex items-center gap-2"><input type="checkbox" checked={spec.fit !== false} onChange={(e) => set({ fit: e.target.checked })} /> Trend line</label>}
          {spec.type === 'line' && <label className="flex items-center gap-2"><input type="checkbox" checked={!!spec.cumulative} onChange={(e) => set({ cumulative: e.target.checked })} /> Cumulative</label>}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Title and axis labels</summary>
          <div className="mt-2 space-y-2">
            <Input aria-label="Chart title" placeholder={chart.title || 'Title'} value={spec.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />
            <Input aria-label="X axis label" placeholder="X axis label" value={spec.xlabel ?? ''} onChange={(e) => set({ xlabel: e.target.value || undefined })} />
            <Input aria-label="Y axis label" placeholder="Y axis label" value={spec.ylabel ?? ''} onChange={(e) => set({ ylabel: e.target.value || undefined })} />
          </div>
        </details>
      </Card>

      <div className="min-w-0 space-y-3">
        <Card className="space-y-3 p-3 sm:p-4">
          <StudioFigure ref={svgRef} chart={chart} />
          {chart.stats.length > 0 && (
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-800" data-testid="rh-studio-stats">
              {chart.stats.map((s, i) => <p key={i}>{s}</p>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={png} disabled={empty} data-testid="rh-studio-png">PNG image</Button>
            <Button size="sm" variant="secondary" onClick={svg} disabled={empty}>SVG</Button>
            <Button size="sm" variant="secondary" onClick={csv} disabled={empty}>Chart data (CSV)</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)} disabled={empty} aria-expanded={showTable}>{showTable ? 'Hide table' : 'Show as table'}</Button>
            <span className="flex-1" />
            {onPin && <Button size="sm" variant="secondary" onClick={() => onPin(spec)} disabled={empty} data-testid="rh-studio-pin">Pin to dashboard</Button>}
            <Button size="sm" onClick={pack} disabled={empty} data-testid="rh-studio-pack">Download for MATLAB / R / SPSS / Stata</Button>
          </div>
          <p className="text-xs text-slate-500">
            The zip holds data.csv, a codebook and a script for each program that redraws this chart. Just the script:{' '}
            {(['matlab', 'r', 'spss', 'stata'] as ScriptLang[]).map((l, i) => (
              <span key={l}>{i > 0 && ' · '}<button type="button" className="underline hover:text-ink-900 disabled:opacity-50" disabled={empty} onClick={() => one(l)} data-testid={`rh-studio-script-${l}`}>{SCRIPT_NAME[l]} ({SCRIPT_FILE[l]})</button></span>
            ))}
          </p>
          {showTable && !empty && (
            <div className="overflow-x-auto" data-testid="rh-studio-table">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-600">{chart.table[0].map((h, i) => <th key={i} className="px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                <tbody className="tabular-nums">{chart.table.slice(1, 201).map((row, i) => <tr key={i} className="border-t border-slate-100">{row.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>)}</tbody>
              </table>
              {chart.table.length > 201 && <p className="px-2 py-1 text-xs text-slate-500">First 200 rows shown; the CSV has them all.</p>}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
            <h2 className="text-sm font-semibold text-ink-900">Command window</h2>
            <span className="text-xs text-slate-500">MATLAB-style · ↑ ↓ for history</span>
            <span className="flex-1" />
            <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => run('help')}>help</button>
            <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => run('who')}>who</button>
            <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => setLog([])}>clc</button>
          </div>
          <pre ref={logRef} className="max-h-72 min-h-24 overflow-auto bg-white px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap" data-testid="rh-studio-log" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className={cx(l.kind === 'in' ? 'text-ink-900' : l.kind === 'err' ? 'text-rose-700' : 'text-slate-700')}>{l.kind === 'in' ? `>> ${l.text}` : l.text}</div>
            ))}
          </pre>
          <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 font-mono text-sm">
            <span className="text-slate-500" aria-hidden>&gt;&gt;</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey} aria-label="Command" placeholder="e.g. bar(Q1, Q3)   ttest2(Q2, Q1)   corr(Q2, Q5)"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" spellCheck={false} autoComplete="off" autoCapitalize="off" data-testid="rh-studio-cmd" />
            <Button size="sm" variant="ghost" onClick={() => { run(cmd); setCmd(''); }}>Run</Button>
          </div>
        </Card>
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Command reference</summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono">{HELP}</pre>
        </details>
      </div>
    </div>
  );
}
