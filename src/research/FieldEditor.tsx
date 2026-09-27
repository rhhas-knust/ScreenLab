import { useState } from 'react';
import { FIELD_TYPES, hasOptions, type FieldType, type RhField } from '../lib/api/research';
import { Button, Input, Label, Select, Textarea } from '../components/ui';

export function FieldEditor({ field, index, count, onChange, onMove, onRemove, onDuplicate, hasResponses }: {
  field: RhField;
  index: number;
  count: number;
  onChange: (patch: Partial<RhField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  hasResponses: boolean;
}) {
  const id = (s: string) => `q${index}-${s}`;
  const [optText, setOptText] = useState(field.options.join('\n'));
  const [showHelp, setShowHelp] = useState(!!field.help);

  const setType = (type: FieldType) => {
    if (hasResponses && type !== field.type && !window.confirm('This questionnaire already has responses. Changing the question type can make earlier answers inconsistent. Change it anyway?')) return;
    const patch: Partial<RhField> = { type };
    if (hasOptions(type) && !field.options.length) {
      patch.options = ['Option 1', 'Option 2'];
      setOptText('Option 1\nOption 2');
    }
    onChange(patch);
  };

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
          {showHelp ? (
            <div>
              <Label htmlFor={id('help')} hint="(optional)">Description</Label>
              <Input id={id('help')} value={field.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} placeholder="Extra instructions for respondents" maxLength={2000} />
            </div>
          ) : (
            <button type="button" className="text-xs text-slate-600 underline" onClick={() => setShowHelp(true)}>+ Add description</button>
          )}
          {hasOptions(field.type) && (
            <div>
              <Label htmlFor={id('options')} hint="(one per line)">Options</Label>
              <Textarea id={id('options')} rows={Math.min(8, Math.max(3, field.options.length + 1))} value={optText}
                onChange={(e) => {
                  setOptText(e.target.value);
                  onChange({ options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean).filter((o, i, a) => a.indexOf(o) === i).slice(0, 100) });
                }} />
            </div>
          )}
          {field.type === 'scale' && <p className="text-xs text-slate-500">Respondents choose 1, 2, 3, 4 or 5. Explain the ends in the description, e.g. “1 = strongly disagree, 5 = strongly agree”.</p>}
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
