import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteSource, listSources, mk, saveSource, sourcesToCsv, type SearchSource, type SourceKind } from '../lib/api/methods';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate, qk } from '../lib/hooks';
import { Button, Card, EmptyState, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

const KIND_LABEL: Record<SourceKind, string> = { database: 'Database', register: 'Register', other: 'Other source' };
type Draft = Partial<SearchSource> & { name: string };
const blank = (): Draft => ({ kind: 'database', name: '', searched_on: new Date().toISOString().slice(0, 10), search_string: '', filters: '', results_count: null, notes: '' });

function SourceForm({ initial, onSave, onCancel, busy }: { initial: Draft; onSave: (d: Draft) => void; onCancel: () => void; busy: boolean }) {
  const [d, setD] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const id = initial.id ?? 'new';
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) onSave(d); }} data-testid="source-form">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_9rem]">
        <div>
          <Label htmlFor={`k-${id}`}>Type</Label>
          <Select id={`k-${id}`} value={d.kind} onChange={(e) => set({ kind: e.target.value as SourceKind })}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`n-${id}`}>Name</Label>
          <Input id={`n-${id}`} required placeholder="e.g. PubMed / MEDLINE" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`d-${id}`}>Date searched</Label>
          <Input id={`d-${id}`} type="date" value={d.searched_on ?? ''} onChange={(e) => set({ searched_on: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`r-${id}`}>Records found</Label>
          <Input id={`r-${id}`} inputMode="numeric" value={d.results_count ?? ''} onChange={(e) => set({ results_count: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} />
        </div>
      </div>
      <div>
        <Label htmlFor={`s-${id}`} hint="Paste the exact query, including field tags and Boolean operators.">Search string</Label>
        <Textarea id={`s-${id}`} rows={4} className="font-mono text-xs" value={d.search_string ?? ''} onChange={(e) => set({ search_string: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`f-${id}`}>Filters / limits</Label>
          <Input id={`f-${id}`} placeholder="e.g. 2020–2026, English, title/abstract" value={d.filters ?? ''} onChange={(e) => set({ filters: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`o-${id}`}>Notes</Label>
          <Input id={`o-${id}`} placeholder="e.g. platform, export format" value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>Save source</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function SearchLog({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (d: Draft) => {
    setBusy(true);
    try {
      await saveSource(projectId, { ...d, sort_order: d.sort_order ?? (q.data?.length ?? 0) });
      await qc.invalidateQueries({ queryKey: mk.sources(projectId) });
      qc.invalidateQueries({ queryKey: qk.stats(projectId) });
      setEditing(null);
      toast('Search source saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (s: SearchSource) => {
    if (!window.confirm(`Delete "${s.name}" from the search log?`)) return;
    try {
      await deleteSource(s.id);
      await qc.invalidateQueries({ queryKey: mk.sources(projectId) });
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  if (!q.data) return <div className="p-6"><Spinner /></div>;
  const rows = q.data;
  const total = rows.reduce((a, r) => a + (r.results_count ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <h2 className="font-semibold text-ink-900">Search log</h2>
          <p className="text-sm text-slate-600">One entry per database, register or other source (PRISMA items 6–7). The numbers feed the flow diagram.</p>
        </div>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadText(`${safeFileName(title)}_search_strategy.csv`, sourcesToCsv(rows), 'text/csv')}>Download CSV</Button>
        <Link to={`/p/${projectId}/methods/search-strategy`} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 hover:bg-slate-50" data-testid="search-strategy-pdf">Search strategy PDF</Link>
        <Button variant="primary" onClick={() => setEditing('new')} disabled={editing === 'new'} data-testid="source-add">+ Add source</Button>
      </div>

      {editing === 'new' && <Card className="p-4"><SourceForm initial={blank()} onSave={save} onCancel={() => setEditing(null)} busy={busy} /></Card>}

      {rows.length === 0 && editing !== 'new' ? (
        <EmptyState title="No sources yet">Add each database you searched with its date, exact search string and number of results.</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4" as="article">
              {editing === r.id ? (
                <SourceForm initial={{ ...r }} onSave={save} onCancel={() => setEditing(null)} busy={busy} />
              ) : (
                <div className="space-y-2" data-testid="source-row">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{KIND_LABEL[r.kind]}</span>
                    <h3 className="font-semibold text-ink-900">{r.name}</h3>
                    <span className="text-sm text-slate-600">{r.searched_on ? fmtDate(`${r.searched_on}T12:00:00`, false) : 'date not set'}</span>
                    <span className="flex-1" />
                    <span className="text-sm font-semibold tabular-nums text-ink-900">{r.results_count == null ? '—' : fmt(r.results_count)} records</span>
                  </div>
                  {r.search_string && <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-xs whitespace-pre-wrap text-slate-800">{r.search_string}</pre>}
                  {(r.filters || r.notes) && <p className="text-xs text-slate-600">{[r.filters && `Filters: ${r.filters}`, r.notes].filter(Boolean).join(' · ')}</p>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(r)}>Delete</Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
          {rows.length > 0 && <p className="text-right text-sm text-slate-600">Total records found: <span className="font-semibold tabular-nums text-ink-900">{fmt(total)}</span></p>}
        </div>
      )}
    </div>
  );
}
