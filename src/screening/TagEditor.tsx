import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addTagToReference, createTag, removeTagFromReference } from '../lib/api/tags';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import type { Reference, Tag } from '../lib/types';
import { TagChip } from '../components/Decision';
import { Input } from '../components/ui';
import { useToast } from '../components/Toast';

export function TagEditor({ reference, tags, projectId, onChange }: {
  reference: Reference; tags: Tag[]; projectId: string; onChange: (tagNames: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const applied = new Set(reference.tag_names ?? []);
  const byName = new Map(tags.map((t) => [t.name.toLowerCase(), t]));
  const suggestions = tags.filter((t) => !applied.has(t.name) && (!text || t.name.toLowerCase().includes(text.toLowerCase()))).slice(0, 8);

  const apply = async (t: Tag) => {
    const next = [...applied, t.name].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    onChange(next);
    try {
      await addTagToReference(projectId, reference.id, t, reference.title);
      qc.invalidateQueries({ queryKey: qk.refs(projectId) });
    } catch (e) {
      onChange([...applied]);
      toast(`Tag not saved: ${friendlyError(e)}`, { kind: 'error' });
    }
  };

  const remove = async (name: string) => {
    const t = byName.get(name.toLowerCase());
    if (!t) return;
    onChange([...applied].filter((x) => x !== name));
    try {
      await removeTagFromReference(projectId, reference.id, t, reference.title);
      qc.invalidateQueries({ queryKey: qk.refs(projectId) });
    } catch (e) {
      onChange([...applied]);
      toast(`Tag not removed: ${friendlyError(e)}`, { kind: 'error' });
    }
  };

  const submit = async () => {
    const name = text.trim();
    if (!name) return;
    setBusy(true);
    try {
      let t = byName.get(name.toLowerCase());
      if (!t) {
        t = await createTag(projectId, name);
        await qc.invalidateQueries({ queryKey: qk.tags(projectId) });
      }
      if (!applied.has(t.name)) await apply(t);
      setText('');
    } catch (e) {
      toast(`Could not create tag: ${friendlyError(e)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-ink-900" id="tags-label">Tags</div>
      <div className="mb-2 flex min-h-6 flex-wrap gap-1" aria-labelledby="tags-label">
        {[...applied].map((n) => <TagChip key={n} name={n} color={byName.get(n.toLowerCase())?.color} onRemove={() => remove(n)} />)}
        {applied.size === 0 && <span className="text-xs text-slate-500">No tags</span>}
      </div>
      <label htmlFor="tag-input" className="sr-only">Add or create a tag</label>
      <Input id="tag-input" value={text} disabled={busy} placeholder="Add tag… (Enter to create)" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
      {suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button key={t.id} type="button" onClick={() => apply(t)} className="rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
              + {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
