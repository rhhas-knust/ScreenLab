import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { unzipSync } from 'fflate';
import { importPool } from '../lib/api/extraction';
import { uploadPdf } from '../lib/api/fulltext';
import { supabase } from '../lib/supabase';
import { must, friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import { matchPdf } from '../lib/import/pdfMatch';
import { Alert, Button, Card, ProgressBar, Select, cx } from './ui';

interface Item { file: File; refId: string | null; how: string; picked: boolean; result?: 'done' | 'skipped' | string }

/** Read PDFs from chosen files, a folder or .zip files. */
function collectPdfs(files: File[]): File[] {
  const out: File[] = [];
  for (const f of files) {
    if (/\.pdf$/i.test(f.name)) out.push(f);
  }
  return out;
}
async function unzipPdfs(f: File): Promise<File[]> {
  const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => /\.pdf$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name) });
  return Object.entries(entries).map(([name, bytes]) => new File([bytes.slice().buffer as ArrayBuffer], name.split('/').pop()!, { type: 'application/pdf' }));
}

/** Attach many PDFs at once, matched to papers from their file names; the reviewer checks every match first. */
export function BulkPdfUpload({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [skipHave, setSkipHave] = useState(true);
  const pool = useQuery({ queryKey: ['pdf-pool', projectId], queryFn: () => importPool(projectId, new Set()), enabled: items.length > 0 });
  const have = useQuery({
    queryKey: ['pdf-have', projectId], enabled: items.length > 0,
    queryFn: async () => new Set((must(await supabase.from('full_text_files').select('reference_id').eq('project_id', projectId)) as { reference_id: string }[]).map((r) => r.reference_id)),
  });
  const byId = useMemo(() => new Map((pool.data ?? []).map((p) => [p.id, p])), [pool.data]);
  const matched = useMemo(() => items.map((it) => (it.picked || !pool.data ? it : { ...it, ...matchPdf(it.file.name, pool.data) })), [items, pool.data]);

  const onFiles = async (list: FileList | null) => {
    setError(null);
    if (!list?.length) return;
    try {
      const files = [...list];
      const pdfs = collectPdfs(files);
      for (const z of files.filter((f) => /\.zip$/i.test(f.name))) pdfs.push(...await unzipPdfs(z));
      if (!pdfs.length) throw new Error('No PDF files found. Choose PDFs, a folder of PDFs, or a .zip of PDFs.');
      setItems(pdfs.map((file) => ({ file, refId: null, how: '', picked: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const ready = matched.filter((it) => it.refId && !(skipHave && have.data?.has(it.refId)) && !it.result);

  const upload = async () => {
    setBusy({ done: 0, total: ready.length });
    const results = new Map<File, string>();
    let done = 0;
    const queue = [...ready];
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try { await uploadPdf(projectId, it.refId!, it.file); results.set(it.file, 'done'); } catch (e) { results.set(it.file, friendlyError(e)); }
        setBusy({ done: ++done, total: ready.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setItems((xs) => matched.map((it, i) => ({ ...xs[i], refId: it.refId, how: it.how, picked: true, result: results.get(it.file) ?? xs[i].result })));
    await Promise.all([qc.invalidateQueries({ queryKey: ['pdf-have', projectId] }), qc.invalidateQueries({ queryKey: qk.refs(projectId) })]);
    setBusy(null);
  };
  const okCount = items.filter((i) => i.result === 'done').length;

  return (
    <Card className="space-y-3 p-4">
      <div data-testid="bulk-pdf" className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Attach PDFs in bulk</h2>
          <p className="text-sm text-slate-600">
            Choose PDF files, a whole folder, or .zip files (for example full texts saved from Rayyan, Zotero or EndNote). Each file is matched to a paper by a DOI,
            PubMed ID or ScreenLab ID (#12) in its name, by its title, or by first author and year. Check the matches, then upload.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-800">PDF or .zip files</span>
            <input type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" data-testid="bulk-pdf-files"
              onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} className="text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-800">or a folder</span>
            <input type="file" multiple {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} className="text-sm" />
          </label>
        </div>
        {error && <Alert>{error}</Alert>}
        {items.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipHave} onChange={(e) => setSkipHave(e.target.checked)} /> Skip papers that already have a PDF
            </label>
            <p className="text-sm text-slate-700" data-testid="bulk-pdf-summary">{ready.length} of {items.length} files ready to attach.</p>
            <ul className="max-h-96 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 text-sm">
              {matched.map((it, i) => {
                const ref = it.refId ? byId.get(it.refId) : null;
                const dup = !!it.refId && skipHave && have.data?.has(it.refId);
                return (
                  <li key={i} className="space-y-1 px-3 py-2" data-testid="bulk-pdf-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium',
                        it.result === 'done' ? 'bg-emerald-50 text-emerald-800' : it.result ? 'bg-red-50 text-red-800' : it.refId && !dup ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-900')}>
                        {it.result === 'done' ? '✓ Attached' : it.result ? 'Failed' : it.refId && !dup ? 'Ready' : dup ? 'Already has a PDF' : 'Not matched'}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink-900" title={it.file.name}>{it.file.name}</span>
                      <Select aria-label={`Paper for ${it.file.name}`} className="max-w-sm py-1 text-xs" value={it.refId ?? ''} disabled={!!it.result}
                        onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, refId: e.target.value || null, how: e.target.value ? 'chosen by you' : 'left out', picked: true } : x)))}>
                        <option value="">Leave out</option>
                        {(pool.data ?? []).map((p) => <option key={p.id} value={p.id}>#{p.seq} {(p.title ?? '').slice(0, 80)}</option>)}
                      </Select>
                    </div>
                    <p className="text-xs text-slate-600">
                      {it.result && it.result !== 'done' ? it.result : ref ? `Matched by ${it.how} → #${ref.seq} ${ref.title ?? ''}` : it.how}
                    </p>
                  </li>
                );
              })}
            </ul>
            {busy ? <ProgressBar value={busy.done} max={busy.total} label="Uploading PDFs" /> : (
              <Button variant="primary" disabled={!ready.length} onClick={() => void upload()} data-testid="bulk-pdf-go">Attach {ready.length} PDF{ready.length === 1 ? '' : 's'}</Button>
            )}
            {okCount > 0 && !busy && <Alert kind="success"><span data-testid="bulk-pdf-done">{okCount} PDF{okCount === 1 ? '' : 's'} attached.</span></Alert>}
          </>
        )}
      </div>
    </Card>
  );
}
