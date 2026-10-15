import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveForm } from '../lib/api/extraction';
import { FIELD_TYPE_LABEL, MODULES, newKey, OVERALL_KEY, PRESETS, presetsFor, TIER_KEY, type ExtractionForm, type FieldType, type FormField, type ModuleKind } from '../lib/extraction/form';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import { Alert, Button, Card, Input, Label, Select, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

export function FormEditor({ kind = 'extraction', projectId, form, started }: { kind?: ModuleKind; projectId: string; form: ExtractionForm | null; started: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fields, setFields] = useState<FormField[]>(form?.fields ?? []);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const persist = async (next: ExtractionForm, message: string) => {
    setBusy(true);
    try {
      await saveForm(projectId, next, kind);
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      setDirty(false);
      toast(message);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Start from a ready-made form, then change any field. Everyone on the review team uses the same form.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {presetsFor(kind).map((p) => (
            <Card key={p.id} className="flex flex-col gap-2 p-4">
              <h3 className="font-semibold text-ink-900">{p.name}</h3>
              <p className="text-sm text-slate-600">{p.description}</p>
              <p className="text-xs text-slate-500">{p.form.fields.map((x) => x.label).join(' · ')}</p>
              <div className="mt-auto pt-2">
                <Button variant="primary" loading={busy} onClick={() => { setFields(p.form.fields); persist({ ...p.form, name: p.name }, `${MODULES[kind].title} form ready`); }} data-testid={`preset-${p.id}`}>Use this form</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const update = (i: number, patch: Partial<FormField>) => { setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
    setDirty(true);
  };
  const valid = fields.every((x) => x.label.trim() && (x.type !== 'choice' && x.type !== 'multi' || (x.options ?? []).length > 0));

  return (
    <div className="space-y-3">
      {started && (
        <Alert kind="info">
          {MODULES[kind].title} has started. Renaming a field or adding options is safe. Removing a field only hides it: answers already given are kept and come back if you add it again.
        </Alert>
      )}
      {fields.map((x, i) => (
        <Card key={x.key} className="space-y-2 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div>
              <Label htmlFor={`fl-${x.key}`}>Field name</Label>
              <Input id={`fl-${x.key}`} value={x.label} onChange={(e) => update(i, { label: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`ft-${x.key}`}>Answer type</Label>
              <Select id={`ft-${x.key}`} value={x.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </Select>
            </div>
          </div>
          {(x.type === 'choice' || x.type === 'multi') && (
            <div>
              <Label htmlFor={`fo-${x.key}`} hint="One per line">Options</Label>
              <Textarea id={`fo-${x.key}`} rows={3} value={(x.options ?? []).join('\n')}
                onChange={(e) => update(i, { options: e.target.value.split('\n').map((o) => o.trimStart()) })}
                onBlur={() => update(i, { options: (x.options ?? []).map((o) => o.trim()).filter(Boolean) })} />
            </div>
          )}
          <div>
            <Label htmlFor={`fh-${x.key}`}>Guidance for reviewers (optional)</Label>
            <Input id={`fh-${x.key}`} value={x.help ?? ''} onChange={(e) => update(i, { help: e.target.value || undefined })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${x.label} up`}>↑</Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label={`Move ${x.label} down`}>↓</Button>
            <span className="flex-1" />
            {kind === 'extraction' && x.key === TIER_KEY && <span className="text-xs text-slate-500">Used to split included studies in the PRISMA diagram</span>}
            {kind === 'rob' && x.key === OVERALL_KEY && <span className="text-xs text-slate-500">The overall judgement shown in the plot and tables</span>}
            <Button size="sm" variant="ghost" onClick={() => { setFields(fields.filter((_, j) => j !== i)); setDirty(true); }}>Remove</Button>
          </div>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setFields([...fields, { key: newKey('New field', fields.map((x) => x.key)), label: 'New field', type: 'text' }]); setDirty(true); }}>Add field</Button>
        {kind === 'extraction' && !fields.some((x) => x.key === TIER_KEY) && (
          <Button variant="ghost" onClick={() => { setFields([{ ...PRESETS[0].form.fields[0] }, ...fields]); setDirty(true); }}>Add Tier field</Button>
        )}
        <span className="flex-1" />
        <Button variant="primary" loading={busy} disabled={!dirty || !valid} onClick={() => persist({ ...(form?.name ? { name: form.name } : {}), fields: fields.map((x) => ({ ...x, label: x.label.trim() })) }, 'Form saved')} data-testid="form-save">Save form</Button>
      </div>
      {!valid && <p className="text-sm text-rose-700">Every field needs a name, and choice fields need at least one option.</p>}
    </div>
  );
}
