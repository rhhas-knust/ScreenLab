import { useEffect, useRef, useState } from 'react';
import { outbox } from '../lib/outbox';
import type { Reference } from '../lib/types';
import { Button, Textarea } from '../components/ui';

/** Notes auto-save (debounced) through the durable outbox. */
export function NotesEditor({ reference, projectId, onLocalChange }: { reference: Reference; projectId: string; onLocalChange: (notes: string | null) => void }) {
  const [value, setValue] = useState(reference.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, ref: reference });
  latest.current = { value, ref: reference };

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { value: v, ref } = latest.current;
    const notes = v.trim() === '' ? null : v;
    if ((ref.notes ?? null) === notes) {
      setDirty(false);
      return;
    }
    outbox.enqueueFields({ projectId, referenceId: ref.id, title: ref.title, patch: { notes } });
    onLocalChange(notes);
    setDirty(false);
  };

  // Reset when switching article (saving any pending edit of the previous one first)
  useEffect(() => {
    setValue(reference.notes ?? '');
    setDirty(false);
    return () => {
      if (timer.current) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference.id]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="notes" className="text-sm font-semibold text-ink-900">Notes</label>
        <span className="text-xs text-slate-500" aria-live="polite">{dirty ? 'Typing…' : value ? 'Saved locally & syncing' : ''}</span>
      </div>
      <Textarea
        id="notes"
        rows={3}
        value={value}
        placeholder="e.g. Potentially relevant but infection definition is unclear."
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 700);
        }}
        onBlur={flush}
      />
      {value && (
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => { setValue(''); latest.current.value = ''; setTimeout(flush, 0); }}>Delete note</Button>
      )}
    </div>
  );
}
