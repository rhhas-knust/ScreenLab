import { useState } from 'react';
import { canBeCondition, FIELD_TYPES, hasOptions, scaleRange, type ConditionOp, type FieldSettings, type FieldType, type RhField } from '../lib/api/research';
import { categories } from '../lib/research/analytics';
import { Button, Input, Label, Select, Textarea } from '../components/ui';

const SCALES: [number, number][] = [[1, 5], [1, 7], [1, 10], [0, 10], [1, 4]];
const lines = (t: string, max: number) => t.split('\n').map((o) => o.trim()).filter(Boolean).filter((o, i, a) => a.indexOf(o) === i).slice(0, max);

export function FieldEditor({ field, index, count, earlier, onChange, onMove, onRemove, onDuplicate, hasResponses }: {
  field: RhField;
  index: number;
  count: number;
  /** Questions before this one (possible conditions). */
  earlier: RhField[];
  onChange: (patch: Partial<RhField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  hasResponses: boolean;
}) {
  const id = (s: string) => `q${index}-${s}`;
  const settings = field.settings ?? {};
  const [optText, setOptText] = useState(field.options.join('\n'));
  const [rowText, setRowText] = useState((settings.rows ?? []).join('\n'));
  const [showHelp, setShowHelp] = useState(!!field.help);
  const setSettings = (patch: Partial<FieldSettings>) => onChange({ settings: { ...settings, ...patch } });

  const setType = (type: FieldType) => {
    if (hasResponses && type !== field.type && !window.confirm('This questionnaire already has responses. Changing the question type can make earlier answers inconsistent. Change it anyway?')) return;
    const patch: Partial<RhField> = { type };
    if (hasOptions(type) && !field.options.length) {
      const defaults = type === 'grid' ? ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'] : ['Option 1', 'Option 2'];
      patch.options = defaults;
      setOptText(defaults.join('\n'));
    }
    if (type === 'grid' && !settings.rows?.length) {
      patch.settings = { ...settings, rows: ['Statement 1', 'Statement 2'] };
      setRowText('Statement 1\nStatement 2');
    }
    onChange(patch);
  };

  const cond = settings.show_if ?? null;
  const condField = cond ? earlier.find((f) => f.id === cond.field) : undefined;
  const condChoices = condField && condField.type !== 'text' && condField.type !== 'textarea' && condField.type !== 'number'
    && condField.type !== 'email' && condField.type !== 'date' ? categories(condField) : null;
  const usable = earlier.filter((f) => canBeCondition(f.type) && f.label.trim());
  const range = scaleRange(settings);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4" data-testid="rh-question">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-6 shrink-0 text-sm font-semibold text-slate-500 tabular-nums" aria-hidden="true">{index + 1}.</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div>
              <Label htmlFor={id('label')}>Question {index + 1}</Label>
              <Input id={id('label')} value={field.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Type your question" maxLength={1000} />
            </div>
            <div>
              <Label htmlFor={id('type')}>Answer type</Label>
              <Select id={id('type')} value={field.type} onChange={(e) => setType(e.target.value as FieldType)}>
                {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </Select>
            </div>
          </div>
          {showHelp && (
            <div>
              <Label htmlFor={id('help')} hint="(optional)">Description</Label>
              <Input id={id('help')} value={field.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} placeholder="Extra instructions for respondents" maxLength={2000} />
            </div>
          )}
          {field.type === 'grid' && (
            <div>
              <Label htmlFor={id('rows')} hint="(one per line)">Statements</Label>
              <Textarea id={id('rows')} rows={Math.min(8, Math.max(3, (settings.rows?.length ?? 0) + 1))} value={rowText}
                onChange={(e) => { setRowText(e.target.value); setSettings({ rows: lines(e.target.value, 50) }); }} />
            </div>
          )}
          {hasOptions(field.type) && (
            <div>
              <Label htmlFor={id('options')} hint="(one per line)">{field.type === 'grid' ? 'Answer columns' : field.type === 'ranking' ? 'Options to rank' : 'Options'}</Label>
              <Textarea id={id('options')} rows={Math.min(8, Math.max(3, field.options.length + 1))} value={optText}
                onChange={(e) => { setOptText(e.target.value); onChange({ options: lines(e.target.value, field.type === 'ranking' ? 20 : 100) }); }} />
            </div>
          )}
          {field.type === 'scale' && (
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
              <div>
                <Label htmlFor={id('range')}>Range</Label>
                <Select id={id('range')} value={`${range.min}-${range.max}`} onChange={(e) => { const [min, max] = e.target.value.split('-').map(Number); setSettings({ min, max }); }}>
                  {SCALES.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>{a}–{b}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor={id('minl')} hint="(optional)">Label for {range.min}</Label>
                <Input id={id('minl')} value={settings.min_label ?? ''} onChange={(e) => setSettings({ min_label: e.target.value })} placeholder="e.g. Strongly disagree" maxLength={100} />
              </div>
              <div>
                <Label htmlFor={id('maxl')} hint="(optional)">Label for {range.max}</Label>
                <Input id={id('maxl')} value={settings.max_label ?? ''} onChange={(e) => setSettings({ max_label: e.target.value })} placeholder="e.g. Strongly agree" maxLength={100} />
              </div>
            </div>
          )}

          {cond ? (
            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5" data-testid="rh-condition">
              <p className="text-xs font-semibold text-sky-900">Show this question only if…</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr]">
                <Select aria-label="Depends on question" value={cond.field} onChange={(e) => setSettings({ show_if: { field: e.target.value, op: cond.op, value: '' } })}>
                  {!condField && <option value={cond.field}>(choose a question)</option>}
                  {usable.map((f) => <option key={f.id} value={f.id}>Q{earlier.indexOf(f) + 1}. {f.label.slice(0, 60)}</option>)}
                </Select>
                <Select aria-label="Condition" value={cond.op} onChange={(e) => setSettings({ show_if: { ...cond, op: e.target.value as ConditionOp } })}>
                  <option value="equals">is</option>
                  <option value="not_equals">is not</option>
                  <option value="answered">is answered</option>
                </Select>
                {cond.op !== 'answered' && (condChoices ? (
                  <Select aria-label="Answer" value={cond.value ?? ''} onChange={(e) => setSettings({ show_if: { ...cond, value: e.target.value } })}>
                    <option value="">(choose an answer)</option>
                    {condChoices.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                ) : (
                  <Input aria-label="Answer" value={cond.value ?? ''} onChange={(e) => setSettings({ show_if: { ...cond, value: e.target.value } })} placeholder="Exact answer" />
                ))}
              </div>
              <button type="button" className="text-xs text-sky-900 underline" onClick={() => setSettings({ show_if: null })}>Remove condition (always show)</button>
            </div>
          ) : null}
          {(!showHelp || (!cond && usable.length > 0)) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {!showHelp && <button type="button" className="text-xs text-slate-600 underline" onClick={() => setShowHelp(true)}>+ Add description</button>}
              {!cond && usable.length > 0 && (
                <button type="button" className="text-xs text-slate-600 underline" data-testid="rh-add-condition"
                  onClick={() => setSettings({ show_if: { field: usable[usable.length - 1].id, op: 'equals', value: '' } })}>
                  + Show only if… (skip logic)
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} /> Required
            </label>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move question ${index + 1} up`}>↑</Button>
            <Button size="sm" variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move question ${index + 1} down`}>↓</Button>
            <Button size="sm" variant="ghost" onClick={onDuplicate}>Duplicate</Button>
            <Button size="sm" variant="ghost" className="text-rose-700" onClick={onRemove}>Delete</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
