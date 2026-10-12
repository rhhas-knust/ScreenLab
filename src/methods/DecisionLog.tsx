import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_LABEL, DECISION_CATEGORIES, decisionsToCsv, deleteDecision, listDecisions, mk, saveDecision,
  type DecisionCategory, type ProtocolDecision,
} from '../lib/api/methods';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmtDate } from '../lib/hooks';
import { Button, Card, EmptyState, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

type Draft = Partial<ProtocolDecision> & { title: string };
const blank = (): Draft => ({ decided_on: new Date().toISOString().slice(0, 10), category: 'eligibility', title: '', detail: '', rationale: '' });

function DecisionForm({ initial, onSave, onCancel, busy }: { initial: Draft; onSave: (d: Draft) => void; onCancel: () => void; busy: boolean }) {
  const [d, setD] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const id = initial.id ?? 'new';
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (d.title.trim()) onSave(d); }} data-testid="decision-form">
      <div className="grid gap-3 sm:grid-cols-[10rem_14rem_1fr]">
        <div>
          <Label htmlFor={`dd-${id}`}>Date</Label>
          <Input id={`dd-${id}`} type="date" required value={d.decided_on ?? ''} onChange={(e) => set({ decided_on: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`dc-${id}`}>Category</Label>
          <Select id={`dc-${id}`} value={d.category} onChange={(e) => set({ category: e.target.value as DecisionCategory })}>
            {DECISION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`dt-${id}`}>Decision</Label>
          <Input id={`dt-${id}`} required placeholder="e.g. Tier 2 studies are in scope" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`dx-${id}`}>What exactly was decided</Label>
          <Textarea id={`dx-${id}`} rows={3} value={d.detail ?? ''} onChange={(e) => set({ detail: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`dr-${id}`}>Why</Label>
          <Textarea id={`dr-${id}`} rows={3} value={d.rationale ?? ''} onChange={(e) => set({ rationale: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>Save decision</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function DecisionLog({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: mk.decisions(projectId), queryFn: () => listDecisions(projectId) });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (d: Draft) => {
    setBusy(true);
    try {
      await saveDecision(projectId, d);
      await qc.invalidateQueries({ queryKey: mk.decisions(projectId) });
      setEditing(null);
      toast('Decision saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (d: ProtocolDecision) => {
    if (!window.confirm(`Delete the decision "${d.title}"?`)) return;
    try {
      await deleteDecision(d.id);
      await qc.invalidateQueries({ queryKey: mk.decisions(projectId) });
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  if (!q.data) return <div className="p-6"><Spinner /></div>;
  const rows = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <h2 className="font-semibold text-ink-900">Protocol and decision log</h2>
          <p className="text-sm text-slate-600">Dated rules, clarifications and deviations from the protocol, with the reason for each (PRISMA item 24).</p>
        </div>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadText(`${safeFileName(title)}_decision_log.csv`, decisionsToCsv(rows), 'text/csv')}>Download CSV</Button>
        <Button variant="primary" onClick={() => setEditing('new')} disabled={editing === 'new'} data-testid="decision-add">+ Add decision</Button>
      </div>

      {editing === 'new' && <Card className="p-4"><DecisionForm initial={blank()} onSave={save} onCancel={() => setEditing(null)} busy={busy} /></Card>}

      {rows.length === 0 && editing !== 'new' ? (
        <EmptyState title="No decisions recorded">Record each rule you agreed on, for example how tiers are assigned or whether conference papers count.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="p-4" as="article">
                {editing === r.id ? (
                  <DecisionForm initial={{ ...r }} onSave={save} onCancel={() => setEditing(null)} busy={busy} />
                ) : (
                  <div className="space-y-1.5" data-testid="decision-row">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold tabular-nums text-slate-600">{fmtDate(`${r.decided_on}T12:00:00`, false)}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{CATEGORY_LABEL[r.category]}</span>
                    </div>
                    <h3 className="font-semibold text-ink-900">{r.title}</h3>
                    {r.detail && <p className="text-sm whitespace-pre-wrap text-slate-800">{r.detail}</p>}
                    {r.rationale && <p className="text-sm whitespace-pre-wrap text-slate-600"><span className="font-medium">Why: </span>{r.rationale}</p>}
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(r)}>Delete</Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
