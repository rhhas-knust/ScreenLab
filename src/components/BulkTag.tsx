import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bulkTag, createTag } from '../lib/api/tags';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import type { Tag } from '../lib/types';
import { Button, Select } from './ui';
import { useToast } from './Toast';

/** Add or remove a tag on every selected record. */
export function BulkTag({ projectId, tags, getIds, onDone }: {
  projectId: string; tags: Tag[]; getIds: () => Promise<string[]>; onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tagId, setTagId] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (add: boolean) => {
    setBusy(true);
    try {
      let tag = tags.find((t) => t.id === tagId);
      if (!tag && tagId === '__new') {
        const name = window.prompt('Name of the new tag')?.trim();
        if (!name) return;
        tag = await createTag(projectId, name);
        await qc.invalidateQueries({ queryKey: qk.tags(projectId) });
      }
      if (!tag) return;
      const ids = await getIds();
      await bulkTag(projectId, tag, ids, add);
      await qc.invalidateQueries({ queryKey: qk.refs(projectId) });
      toast(`${add ? 'Added' : 'Removed'} “${tag.name}” ${add ? 'to' : 'from'} ${ids.length} record${ids.length === 1 ? '' : 's'}`);
      onDone();
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="bulk-tag">
      <label htmlFor="bulk-tag" className="font-medium text-slate-700">Tag</label>
      <Select id="bulk-tag" value={tagId} onChange={(e) => setTagId(e.target.value)} className="max-w-40 py-1 text-xs">
        <option value="">Choose a tag…</option>
        {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        <option value="__new">+ New tag…</option>
      </Select>
      <Button size="sm" variant="secondary" disabled={!tagId || busy} onClick={() => void apply(true)} data-testid="bulk-tag-add">Add</Button>
      <Button size="sm" variant="ghost" disabled={!tagId || tagId === '__new' || busy} onClick={() => void apply(false)} data-testid="bulk-tag-remove">Remove</Button>
    </div>
  );
}
