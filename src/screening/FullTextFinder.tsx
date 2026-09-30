import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listFiles, signedPdfUrl, uploadPdf } from '../lib/api/fulltext';
import { europePmcUrl, findOpenAccess, scholarUrl } from '../lib/api/openAccess';
import { doiUrl, isValidDoi } from '../lib/normalize';
import { friendlyError } from '../lib/errors';
import type { Reference } from '../lib/types';
import { Button, Spinner, cx } from '../components/ui';
import { useToast } from '../components/Toast';

const linkCls = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-ink-900 hover:bg-slate-50';

/**
 * Full-text stage helper shown under the abstract: finds a free legal PDF,
 * offers one-click search links, and shows the uploaded PDF inline.
 * A PDF can be dropped anywhere on this box to attach it.
 */
export function FullTextFinder({ reference: r, projectId, onLocalChange }: {
  reference: Reference; projectId: string; onLocalChange: (patch: Partial<Reference>) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPdf, setShowPdf] = useState(true);
  const hasDoi = isValidDoi(r.doi);

  const files = useQuery({ queryKey: ['files', r.id], queryFn: () => listFiles(r.id) });
  const first = files.data?.[0];
  const pdfUrl = useQuery({
    queryKey: ['pdfurl', first?.id], queryFn: () => signedPdfUrl(first!), enabled: !!first, staleTime: 50 * 60_000,
  });
  const oa = useQuery({
    queryKey: ['oa', r.doi], enabled: hasDoi && !first, retry: 0, staleTime: Infinity, gcTime: Infinity,
    queryFn: ({ signal }) => findOpenAccess(r.doi!, signal),
  });

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      toast('Only PDF files can be attached.', { kind: 'error' });
      return;
    }
    setUploading(true);
    try {
      await uploadPdf(projectId, r.id, f);
      await qc.invalidateQueries({ queryKey: ['files', r.id] });
      if (r.full_text_status === 'not_available') onLocalChange({ full_text_status: 'available' });
      setShowPdf(true);
      toast('PDF attached');
    } catch (e) {
      toast(`Upload failed: ${friendlyError(e)}`, { kind: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const title = r.title ?? '';
  const publisher = r.full_text_url || (hasDoi ? doiUrl(r.doi) : r.url);

  return (
    <section
      aria-label="Find and read the full text"
      data-testid="ft-finder"
      className={cx('mt-5 rounded-xl border-2 p-3 transition-colors', dragOver ? 'border-dashed border-ink-600 bg-ink-50' : 'border-slate-200 bg-slate-50')}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files?.[0]); }}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Full text</h2>
        {uploading && <span className="flex items-center gap-1 text-xs text-slate-600"><Spinner className="h-3.5 w-3.5" /> Uploading…</span>}
      </div>

      {first ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-emerald-800">📄 PDF attached</span>
          <Button size="sm" variant="ghost" onClick={() => setShowPdf((s) => !s)}>{showPdf ? 'Hide PDF' : 'Show PDF here'}</Button>
          {pdfUrl.data && <a className={linkCls} href={pdfUrl.data} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>}
        </div>
      ) : hasDoi ? (
        <p className="mb-2 text-sm" role="status" data-testid="oa-status">
          {oa.isLoading ? <span className="text-slate-600">Checking for a free, legal PDF…</span>
            : oa.data?.pdfUrl || oa.data?.landingUrl ? <span className="font-medium text-emerald-800">✓ Free full text found{oa.data.host ? ` (${oa.data.host})` : ''}</span>
            : oa.error ? <span className="text-slate-600">Could not check for a free version right now — use the links below.</span>
            : <span className="text-slate-600">No free version found — try Google Scholar or your university library.</span>}
        </p>
      ) : (
        <p className="mb-2 text-sm text-slate-600">No DOI on this record — search for it with the links below.</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!first && oa.data?.pdfUrl && <a className={cx(linkCls, 'border-emerald-600 text-emerald-900')} href={oa.data.pdfUrl} target="_blank" rel="noopener noreferrer">Open free PDF ↗</a>}
        {!first && !oa.data?.pdfUrl && oa.data?.landingUrl && <a className={cx(linkCls, 'border-emerald-600 text-emerald-900')} href={oa.data.landingUrl} target="_blank" rel="noopener noreferrer">Open free version ↗</a>}
        {publisher && <a className={linkCls} href={publisher} target="_blank" rel="noopener noreferrer">Publisher ↗</a>}
        {title && <a className={linkCls} href={scholarUrl(title)} target="_blank" rel="noopener noreferrer">Google Scholar ↗</a>}
        {title && <a className={linkCls} href={europePmcUrl(title)} target="_blank" rel="noopener noreferrer">Europe PMC ↗</a>}
        <label className={cx(linkCls, 'cursor-pointer')}>
          {first ? 'Attach another PDF' : 'Attach PDF'}
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      {!first && <p className="mt-2 text-xs text-slate-500">Downloaded the PDF? Drag it onto this box to attach it — it then opens here beside your decision buttons.</p>}

      {first && showPdf && (
        pdfUrl.data
          ? <iframe title={`PDF: ${first.file_name ?? 'full text'}`} src={pdfUrl.data} className="mt-3 h-[80vh] w-full rounded-lg border border-slate-300 bg-white" />
          : <div className="mt-3 flex h-40 items-center justify-center text-sm text-slate-600">{pdfUrl.error ? friendlyError(pdfUrl.error, 'Could not open the PDF.') : 'Loading PDF…'}</div>
      )}
    </section>
  );
}
