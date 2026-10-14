import type { FormField, Value } from '../lib/extraction/form';
import { Input, Select, Textarea } from '../components/ui';

/** One extraction field, as an accessible input of the right kind. */
export function FieldInput({ field, value, onChange, idPrefix }: {
  field: FormField; value: Value | undefined; onChange: (v: Value) => void; idPrefix: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  const str = typeof value === 'string' ? value : Array.isArray(value) ? value.join('; ') : '';
  switch (field.type) {
    case 'long':
      return <Textarea id={id} aria-label={field.label} rows={3} value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input id={id} aria-label={field.label} inputMode="decimal" className="max-w-40" value={str}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))} />;
    case 'choice':
      return (
        <Select id={id} aria-label={field.label} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not filled in</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          {str && !(field.options ?? []).includes(str) && <option value={str}>{str}</option>}
        </Select>
      );
    case 'multi': {
      const set = new Set(Array.isArray(value) ? value : value ? [value] : []);
      return (
        <fieldset aria-label={field.label} className="flex flex-wrap gap-x-4 gap-y-1">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={set.has(o)} onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(o); else next.delete(o);
                onChange((field.options ?? []).filter((x) => next.has(x)).concat([...next].filter((x) => !(field.options ?? []).includes(x))));
              }} />
              {o}
            </label>
          ))}
        </fieldset>
      );
    }
    default:
      return <Input id={id} aria-label={field.label} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}
