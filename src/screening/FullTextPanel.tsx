import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deletePdf, listFiles, signedPdfUrl, uploadPdf } from '../lib/api/fulltext';
import { friendlyError } from '../lib/errors';
import { outbox } from '../lib/outbox';
import type { FullTextStatus, Reference } from '../lib/types';
import { Button, Input, Select } from '../components/ui';
import { useToast } from '../components/Toast';
import { doiUrl, isValidDoi } from '../lib/normalize';

export function FullTextPanel({ reference, projectId, onLocalChange }: {
  reference: Reference; projectId: string; onLocalChange: (patch: Partial<Reference>) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState(reference.full_text_url ?? '');
  const [editingUrl, setEditingUrl] = useState(false);
  const files = useQuery({ queryKey: ['files', reference.id], queryFn: () => listFiles(reference.id) });

  const setField = (patch: Partial<Pick<Reference, 'full_text_status' | 'full_text_url'>>) => {
    outbox.enqueueFields({ projectId, referenceId: reference.id, title: reference.title, patch });
    onLocalChange(patch);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      await uploadPdf(projectId, reference.id, f);
      await files.refetch();
      if (reference.full_text_status === 'not_available') onLocalChange({ full_text_status: 'available' });
      toast('PDF uploaded');
    } catch (e) {
      toast(`Upload failed: ${friendlyError(e)}`, { kind: 'error' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const view = async (id: string) => {
    const f = files.data?.find((x) => x.id === id);
    if (!f) return;
    // Open the tab synchronously (avoids pop-up blockers), then point it at the signed URL.
    const w = window.open('', '_blank');
    try {
      const u = await signedPdfUrl(f);
      if (w) w.location.href = u;
      else window.location.href = u;
    } catch (e) {
      w?.close();
      toast(`Could not open PDF: ${friendlyError(e)}`, { kind: 'error' });
    }
  };

  const openLink = reference.full_text_url || reference.url || (isValidDoi(reference.doi) ? doiUrl(reference.doi) : null);

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-ink-900">Full text</div>
      <div>
        <label htmlFor="ft-status" className="mb-1 block text-xs font-medium text-slate-600">Full-text status</label>
        <Select id="ft-status" value={reference.full_text_status}
          onChange={(e) => setField({ full_text_status: e.target.value as FullTextStatus })}>
          <option value="not_available">Not available</option>
          <option value="available">Available</option>
          <option value="reviewed">Reviewed</option>
        </Select>
      </div>
      <div className="flex flex-wrap gap-1">
        {openLink && (
          <a href={openLink} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-ink-900 hover:bg-slate-50">
            Open full text ↗
          </a>
        )}
        <Button size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>Upload PDF</Button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} aria-label="Upload PDF" />
        <Button size="sm" variant="ghost" onClick={() => setEditingUrl((x) => !x)}>{reference.full_text_url ? 'Edit link' : 'Add link'}</Button>
      </div>
      {editingUrl && (
        <div className="flex gap-1">
          <label htmlFor="ft-url" className="sr-only">Full-text URL</label>
          <Input id="ft-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <Button size="sm" onClick={() => { setField({ full_text_url: url.trim() || null }); setEditingUrl(false); }}>Save</Button>
        </div>
      )}
      {files.data && files.data.length > 0 && (
        <ul className="space-y-1 text-sm">
          {files.data.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
              <span aria-hidden="true">📄</span>
              <span className="min-w-0 flex-1 truncate" title={f.file_name ?? ''}>{f.file_name}</span>
              <Button size="sm" variant="ghost" onClick={() => view(f.id)}>View PDF</Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${f.file_name}`} onClick={async () => {
                if (!window.confirm(`Delete the uploaded PDF "${f.file_name}"?`)) return;
                try {
                  await deletePdf(f);
                  await files.refetch();
                  qc.invalidateQueries({ queryKey: ['refs', projectId] });
                } catch (e) {
                  toast(`Could not delete: ${friendlyError(e)}`, { kind: 'error' });
                }
              }}>✕</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
