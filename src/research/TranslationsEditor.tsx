import { useState } from 'react';
import type { FieldTranslation, RhField, Translation, Translations } from '../lib/api/research';
import { Button, Card, Input, Label, Textarea, cx } from '../components/ui';

interface BaseText { title: string; description: string | null; consent_text: string | null; thank_you_message: string | null }

const toLines = (t: string) => t.split('\n').map((x) => x.trim());
const trimEnd = (xs: string[]) => { const out = [...xs]; while (out.length && !out[out.length - 1]) out.pop(); return out; };

/**
 * Translations of the questionnaire. Anything left blank shows the original
 * text. Options and statements translate line by line, in the same order, and
 * answers are always stored in the original language so the results combine.
 */
export function TranslationsEditor({ value, onChange, base, fields }: {
  value: Translations;
  onChange: (t: Translations) => void;
  base: BaseText;
  fields: RhField[];
}) {
  const items = value.items ?? [];
  const [sel, setSel] = useState<string | null>(items[0]?.code ?? null);
  const [newName, setNewName] = useState('');
  const cur = items.find((t) => t.code === sel) ?? null;

  const setItem = (patch: Partial<Translation>) => onChange({ ...value, items: items.map((t) => (t.code === sel ? { ...t, ...patch } : t)) });
  const setField = (fid: string, patch: Partial<FieldTranslation>) => cur && setItem({ fields: { ...cur.fields, [fid]: { ...cur.fields[fid], ...patch } } });
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const code = crypto.randomUUID().slice(0, 8);
    onChange({ ...value, base_name: value.base_name || 'English', items: [...items, { code, name, fields: {} }] });
    setSel(code);
    setNewName('');
  };
  const remove = () => {
    if (!cur || !window.confirm(`Remove the ${cur.name} translation?`)) return;
    const rest = items.filter((t) => t.code !== cur.code);
    onChange({ ...value, items: rest });
    setSel(rest[0]?.code ?? null);
  };

  return (
    <div data-testid="rh-languages"><Card className="space-y-3 p-4">
      <div>
        <h2 className="font-semibold text-ink-900">Languages</h2>
        <p className="text-sm text-slate-600">Offer the questionnaire in more than one language. Respondents pick a language at the top; all answers are combined in your results.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[14rem_1fr]">
        <div>
          <Label htmlFor="rh-base-lang">Language of your questions</Label>
          <Input id="rh-base-lang" value={value.base_name ?? ''} placeholder="English" maxLength={40} onChange={(e) => onChange({ ...value, base_name: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="rh-new-lang">Add a language</Label>
          <div className="flex gap-2">
            <Input id="rh-new-lang" value={newName} placeholder="e.g. Twi, French, Ewe" maxLength={40} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <Button onClick={add} disabled={!newName.trim()}>Add</Button>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Translations">
          {items.map((t) => (
            <button key={t.code} type="button" role="tab" aria-selected={t.code === sel} onClick={() => setSel(t.code)}
              className={cx('rounded-full border px-3 py-1 text-sm', t.code === sel ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-slate-700')}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {cur && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="text-xs text-slate-500">Leave a box empty to show the original text. Grey text is the original.</p>
          <TField label="Title" base={base.title} value={cur.title} onChange={(v) => setItem({ title: v })} />
          {base.description && <TField label="Introduction" base={base.description} value={cur.description} onChange={(v) => setItem({ description: v })} long />}
          {base.consent_text && <TField label="Information sheet and consent" base={base.consent_text} value={cur.consent_text} onChange={(v) => setItem({ consent_text: v })} long />}
          {base.thank_you_message && <TField label="Thank-you message" base={base.thank_you_message} value={cur.thank_you_message} onChange={(v) => setItem({ thank_you_message: v })} />}
          {fields.filter((f) => f.label.trim()).map((f, i) => {
            const ft = cur.fields[f.id] ?? {};
            return (
              <fieldset key={f.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-xs font-semibold text-slate-600">Question {i + 1}</legend>
                <TField label="Question" base={f.label} value={ft.label} onChange={(v) => setField(f.id, { label: v })} />
                {f.help && <TField label="Description" base={f.help} value={ft.help} onChange={(v) => setField(f.id, { help: v })} />}
                {f.type === 'grid' && (
                  <TList label="Statements (same order, one per line)" base={f.settings?.rows ?? []} value={ft.rows} onChange={(v) => setField(f.id, { rows: v })} />
                )}
                {f.options.length > 0 && (f.type === 'radio' || f.type === 'checkbox' || f.type === 'ranking' || f.type === 'grid') && (
                  <TList label={`${f.type === 'grid' ? 'Answer columns' : 'Options'} (same order, one per line)`} base={f.options} value={ft.options} onChange={(v) => setField(f.id, { options: v })} />
                )}
                {f.type === 'scale' && (f.settings?.min_label || f.settings?.max_label) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {f.settings?.min_label && <TField label="Low-end label" base={f.settings.min_label} value={ft.min_label} onChange={(v) => setField(f.id, { min_label: v })} />}
                    {f.settings?.max_label && <TField label="High-end label" base={f.settings.max_label} value={ft.max_label} onChange={(v) => setField(f.id, { max_label: v })} />}
                  </div>
                )}
              </fieldset>
            );
          })}
          <Button variant="ghost" className="text-rose-700" onClick={remove}>Remove {cur.name}</Button>
        </div>
      )}
    </Card></div>
  );
}

function TField({ label, base, value, onChange, long }: { label: string; base: string; value?: string; onChange: (v: string) => void; long?: boolean }) {
  const [id] = useState(() => `t-${crypto.randomUUID().slice(0, 8)}`);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {long
        ? <Textarea id={id} rows={3} value={value ?? ''} placeholder={base} onChange={(e) => onChange(e.target.value)} maxLength={20000} />
        : <Input id={id} value={value ?? ''} placeholder={base} onChange={(e) => onChange(e.target.value)} maxLength={1000} />}
    </div>
  );
}

function TList({ label, base, value, onChange }: { label: string; base: string[]; value?: string[]; onChange: (v: string[]) => void }) {
  const [id] = useState(() => `t-${crypto.randomUUID().slice(0, 8)}`);
  const [text, setText] = useState((value ?? []).join('\n'));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={Math.min(8, base.length + 1)} value={text} placeholder={base.join('\n')}
        onChange={(e) => { setText(e.target.value); onChange(trimEnd(toLines(e.target.value)).slice(0, base.length)); }} />
    </div>
  );
}
