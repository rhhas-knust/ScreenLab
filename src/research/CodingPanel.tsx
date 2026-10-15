import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rk, saveCodes, type RhField, type RhResponse } from '../lib/api/research';
import { themeCounts } from '../lib/research/analytics';
import { friendlyError } from '../lib/errors';
import { Button, Card, EmptyState, Input, Label, Select } from '../components/ui';
import { useToast } from '../components/Toast';
import { BarList } from './Charts';

/**
 * Qualitative coding of open-text answers: tag each answer with one or more
 * theme codes, then see how often each theme occurs. The codes are the
 * researcher's own; nothing is coded automatically.
 */
export function CodingPanel({ formId, fields, responses, allResponses }: { formId: string; fields: RhField[]; responses: RhResponse[]; allResponses: RhResponse[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const textFields = fields.filter((f) => f.type === 'text' || f.type === 'textarea');
  const [fid, setFid] = useState(textFields[0]?.id ?? '');
  const [uncodedOnly, setUncodedOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!textFields.length) return <EmptyState title="No open-text questions">Coding is for short-answer and paragraph questions.</EmptyState>;

  const f = textFields.find((x) => x.id === fid) ?? textFields[0];
  const answered = responses.filter((r) => typeof r.answers[f.id] === 'string' && String(r.answers[f.id]).trim());
  const shown = uncodedOnly ? answered.filter((r) => !r.codes?.[f.id]?.length) : answered;
  const codebook = [...new Set(allResponses.flatMap((r) => r.codes?.[f.id] ?? []))].sort((a, b) => a.localeCompare(b));
  const themes = themeCounts(f.id, responses);
  const coded = answered.filter((r) => r.codes?.[f.id]?.length).length;
  const num = new Map(allResponses.map((r, i) => [r.id, i + 1]));

  const setCodes = async (r: RhResponse, list: string[]) => {
    const next = { ...(r.codes ?? {}), [f.id]: list };
    if (!list.length) delete next[f.id];
    setBusy(r.id);
    try {
      await saveCodes(r.id, next);
      qc.setQueryData<RhResponse[]>(rk.responses(formId), (old) => old?.map((x) => (x.id === r.id ? { ...x, codes: next } : x)));
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const add = (r: RhResponse) => {
    const code = (drafts[r.id] ?? '').trim().slice(0, 80);
    if (!code) return;
    const cur = r.codes?.[f.id] ?? [];
    if (!cur.includes(code)) void setCodes(r, [...cur, code]);
    setDrafts((d) => ({ ...d, [r.id]: '' }));
  };

  return (
    <div className="space-y-4" data-testid="rh-coding">
      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="code-q">Question</Label>
            <Select id="code-q" value={f.id} onChange={(e) => setFid(e.target.value)}>
              {textFields.map((x) => <option key={x.id} value={x.id}>Q{fields.indexOf(x) + 1}. {x.label.slice(0, 80)}</option>)}
            </Select>
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" checked={uncodedOnly} onChange={(e) => setUncodedOnly(e.target.checked)} /> Only uncoded answers</label>
        </div>
        <p className="text-sm text-slate-600">{coded} of {answered.length} answers coded. Give each answer one or more short theme codes (e.g. “cost”, “access to internet”). Reuse codes so they can be counted.</p>
        {themes.length > 0 && <BarList bars={themes.map((t) => ({ label: t.code, count: t.count, pct: t.pct }))} unit="coded answers" caption={`Themes in answers to ${f.label}`} />}
      </Card>

      <datalist id="rh-codebook">{codebook.map((c) => <option key={c} value={c} />)}</datalist>
      {shown.length === 0 ? (
        <EmptyState title={uncodedOnly ? 'Every answer is coded' : 'No answers yet'}>{uncodedOnly ? 'Untick “Only uncoded answers” to review them.' : 'Answers to this question will appear here.'}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const list = r.codes?.[f.id] ?? [];
            return (
              <li key={r.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid="rh-code-item">
                <p className="text-sm break-words whitespace-pre-wrap text-slate-800"><span className="mr-1 text-xs text-slate-500">#{num.get(r.id)}</span>{String(r.answers[f.id])}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                      {c}
                      <button type="button" aria-label={`Remove code ${c}`} className="text-sky-700 hover:text-sky-950" disabled={busy === r.id} onClick={() => setCodes(r, list.filter((x) => x !== c))}>×</button>
                    </span>
                  ))}
                  <Input aria-label={`Add a code to response ${num.get(r.id)}`} list="rh-codebook" className="h-8 w-44 py-1 text-sm" value={drafts[r.id] ?? ''} maxLength={80}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(r); } }} placeholder="Add code" />
                  <Button size="sm" variant="secondary" onClick={() => add(r)} loading={busy === r.id} disabled={!(drafts[r.id] ?? '').trim()}>Add</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
