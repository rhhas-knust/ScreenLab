import type { Quota, RhField, RhResponse } from '../lib/api/research';
import { answerCategories, categories, isCategorical } from '../lib/research/analytics';
import { Button, Input, Select } from '../components/ui';

/** How many responses already fall in a quota group. */
export const quotaCount = (q: Quota, responses: RhResponse[]) => responses.filter((r) => answerCategories(r.answers[q.field]).includes(q.value)).length;

/** Quotas: "stop accepting people who answer X once N have". Checked again on the server. */
export function QuotasEditor({ fields, quotas, responses, onChange }: { fields: RhField[]; quotas: Quota[]; responses: RhResponse[]; onChange: (q: Quota[]) => void }) {
  const usable = fields.filter((f) => isCategorical(f.type) && f.label.trim());
  const set = (i: number, patch: Partial<Quota>) => onChange(quotas.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <div className="space-y-2" data-testid="rh-quotas">
      <p className="text-sm font-medium text-slate-800">Quotas</p>
      <p className="text-xs text-slate-500">Stop taking people from a group once you have enough of them, e.g. at most 50 respondents from Level 100. People in a full group are thanked and their answers are not saved.</p>
      {quotas.map((q, i) => {
        const f = fields.find((x) => x.id === q.field);
        const n = quotaCount(q, responses);
        return (
          <div key={i} className="grid items-end gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[1fr_10rem_6rem_auto]" data-testid="rh-quota">
            <Select aria-label={`Quota ${i + 1} question`} value={q.field} onChange={(e) => set(i, { field: e.target.value, value: '' })}>
              {!f && <option value={q.field}>(choose a question)</option>}
              {usable.map((x) => <option key={x.id} value={x.id}>Q{fields.indexOf(x) + 1}. {x.label.slice(0, 60)}</option>)}
            </Select>
            <Select aria-label={`Quota ${i + 1} answer`} value={q.value} onChange={(e) => set(i, { value: e.target.value })}>
              <option value="">(answer)</option>
              {f && categories(f).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input aria-label={`Quota ${i + 1} limit`} type="number" min={1} inputMode="numeric" value={q.limit || ''} onChange={(e) => set(i, { limit: Number(e.target.value) })} placeholder="Limit" />
            <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => onChange(quotas.filter((_, j) => j !== i))}>Remove</Button>
            <Input aria-label={`Quota ${i + 1} message`} className="sm:col-span-3" value={q.message ?? ''} onChange={(e) => set(i, { message: e.target.value || undefined })}
              placeholder="Message when full (optional) — e.g. Thank you, we have enough Level 100 students." maxLength={500} />
            <span className="text-xs text-slate-600 tabular-nums" data-testid="rh-quota-progress">{q.value && q.limit ? `${n} / ${q.limit}${n >= q.limit ? ' · full' : ''}` : ''}</span>
          </div>
        );
      })}
      {usable.length > 0
        ? <Button size="sm" variant="secondary" onClick={() => onChange([...quotas, { field: usable[0].id, value: '', limit: 50 }])} data-testid="rh-add-quota">+ Add a quota</Button>
        : <p className="text-xs text-slate-500">Add a multiple-choice, checkbox or scale question to set quotas.</p>}
    </div>
  );
}
