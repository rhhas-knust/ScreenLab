import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ParseRequest, ParseResponse, ParseStats } from '../lib/import/parse.worker';
import type { ParseResult } from '../lib/import/parsers';
import { checkExistingMatches, importRecords, type ImportOutcome } from '../lib/api/importer';
import { detectDuplicates } from '../lib/api/duplicates';
import { friendlyError } from '../lib/errors';
import { fmt } from '../lib/hooks';
import { Alert, Button, Card, Field, Input, ProgressBar, Select, Spinner } from '../components/ui';

const SOURCES = ['PubMed', 'Scopus', 'Web of Science', 'IEEE Xplore', 'Google Scholar', 'Embase', 'CINAHL', 'Cochrane Library', 'PsycINFO', 'Other'];
const MAX_FILE_MB = 100;

const FORMAT_LABEL: Record<string, string> = { csv: 'CSV / TSV', ris: 'RIS', bibtex: 'BibTeX', medline: 'PubMed (MEDLINE / .nbib)' };
const ACCEPT = '.csv,.tsv,.txt,.ris,.bib,.bibtex,.nbib,.zip';
const FIELD_LABEL: Record<string, string> = {
  title: 'Title', authors: 'Authors', abstract: 'Abstract', year: 'Year', journal: 'Journal', volume: 'Volume', issue: 'Issue',
  pages: 'Pages', doi: 'DOI', pmid: 'PMID', url: 'URL', keywords: 'Keywords', publication_type: 'Publication type',
  database_source: 'Database', language: 'Language',
};

type Phase = 'choose' | 'parsing' | 'preview' | 'importing' | 'dedupe' | 'done' | 'failed';

function parseInWorker(req: ParseRequest): Promise<ParseResponse> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('../lib/import/parse.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ParseResponse>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => {
      resolve({ ok: false, error: `The file could not be read (${e.message || 'parser error'}).` });
      w.terminate();
    };
    w.postMessage(req, [req.buffer]);
  });
}

export function ImportPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [sourceChoice, setSourceChoice] = useState('PubMed');
  const [customSource, setCustomSource] = useState('');
  const [overrideSource, setOverrideSource] = useState(false);
  const [includeUntitled, setIncludeUntitled] = useState(true);
  const [importRayyan, setImportRayyan] = useState(true);
  const [zipInfo, setZipInfo] = useState<{ entries: { name: string; size: number }[]; used: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [stats, setStats] = useState<ParseStats | null>(null);
  const [existing, setExisting] = useState<Map<number, string>>(new Map());
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [dupSummary, setDupSummary] = useState<{ groups: number; records: number } | null>(null);
  const [dupError, setDupError] = useState<string | null>(null);

  const databaseSource = sourceChoice === 'Other' ? customSource.trim() || 'Other' : sourceChoice;

  const reset = () => {
    setPhase('choose');
    setFile(null);
    setResult(null);
    setStats(null);
    setExisting(new Map());
    setError(null);
    setOutcome(null);
    setDupSummary(null);
    setDupError(null);
    setZipInfo(null);
    setImportRayyan(true);
    if (fileRef.current) fileRef.current.value = '';
  };

  const analyse = async (zipEntry?: string) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_FILE_MB} MB. Split it into smaller exports and import them one at a time.`);
      return;
    }
    if (/\.(pdf|docx?|xlsx?|rar|7z|png|jpe?g)$/i.test(file.name)) {
      setError('Unsupported file type. Please upload a CSV, RIS, BibTeX (.bib) or PubMed (.nbib / .txt) export, or a .zip export (e.g. from Rayyan). Excel files: use “Save as CSV” first.');
      return;
    }
    setPhase('parsing');
    try {
      const buffer = await file.arrayBuffer();
      if (!buffer.byteLength) throw new Error('The file is empty.');
      const resp = await parseInWorker({ buffer, fileName: file.name, zipEntry });
      if (!resp.ok) {
        setError(resp.error);
        setPhase('choose');
        return;
      }
      if (resp.result.records.length === 0) {
        setError(`No references were found in this ${FORMAT_LABEL[resp.result.format]} file.${resp.result.malformed[0] ? ` ${resp.result.malformed[0].message}` : ''}`);
        setPhase('choose');
        return;
      }
      setResult(resp.result);
      setStats(resp.stats);
      setZipInfo(resp.zip);
      setProgress({ done: 0, total: resp.result.records.length, label: 'Checking for duplicates already in this project…' });
      const m = await checkExistingMatches(projectId, resp.result.records, (d, t) => setProgress({ done: d, total: t, label: 'Checking for duplicates already in this project…' }));
      setExisting(m);
      setPhase('preview');
    } catch (e) {
      setError(friendlyError(e, 'The file could not be read.'));
      setPhase('choose');
    }
  };

  const recordsToImport = () => (result ? result.records.filter((r) => includeUntitled || r.title) : []);

  const runImport = async (resume?: ImportOutcome) => {
    if (!result || !file) return;
    const records = recordsToImport();
    setPhase('importing');
    setError(null);
    const out = await importRecords({
      projectId,
      fileName: file.name,
      format: result.format,
      databaseSource,
      overrideSource,
      records,
      importRayyan: importRayyan && !!stats?.rayyan,
      resume: resume ? { batchId: resume.batchId, startIndex: resume.nextIndex, insertedIds: resume.insertedIds } : undefined,
      onProgress: (done, total) => setProgress({ done, total, label: 'Importing…' }),
    });
    setOutcome(out);
    qc.invalidateQueries({ queryKey: ['stats', projectId] });
    qc.invalidateQueries({ queryKey: ['refs', projectId] });
    qc.invalidateQueries({ queryKey: ['facets', projectId] });
    if (out.error) {
      setError(friendlyError(out.error, 'The import stopped because of an error.'));
      setPhase('failed');
      return;
    }
    await runDedupe(out.insertedIds);
  };

  const runDedupe = async (ids: string[]) => {
    setPhase('dedupe');
    setDupError(null);
    try {
      const d = await detectDuplicates(projectId, ids, (done, total) => setProgress({ done, total, label: 'Detecting duplicates…' }));
      setDupSummary(d);
    } catch (e) {
      setDupError(friendlyError(e, 'Duplicate detection did not finish.'));
    }
    qc.invalidateQueries();
    setPhase('done');
  };

  const untitled = stats?.withoutTitle ?? 0;
  const existingCount = existing.size;
  const withinFile = stats?.withinFileDuplicates ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-ink-900">Import references</h1>
      <p className="mt-1 text-sm text-slate-600">
        Supported: <strong>CSV/TSV</strong>, <strong>RIS</strong>, <strong>BibTeX</strong> and <strong>PubMed (.nbib)</strong> exports from PubMed, Scopus,
        Web of Science, Embase, CINAHL, IEEE Xplore, Google Scholar, Zotero, EndNote, Mendeley and others — and <strong>.zip</strong> exports such as
        Rayyan’s (your Rayyan decisions, exclusion reasons, labels and notes can be carried over). Nothing is imported until you confirm the preview.
      </p>

      {(phase === 'choose' || phase === 'parsing') && (
        <Card className="mt-5 p-5">
          <div className="space-y-4">
            <Field id="file" label="Reference file">
              <input
                id="file" ref={fileRef} type="file" accept={ACCEPT}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-white"
                disabled={phase === 'parsing'}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="source" label="Database source" hint="(recorded on every reference)">
                <Select id="source" value={sourceChoice} onChange={(e) => setSourceChoice(e.target.value)} disabled={phase === 'parsing'}>
                  {SOURCES.map((s) => <option key={s} value={s}>{s === 'Other' ? 'Other (type a name)…' : s}</option>)}
                </Select>
              </Field>
              {sourceChoice === 'Other' && (
                <Field id="custom-source" label="Custom source name">
                  <Input id="custom-source" value={customSource} onChange={(e) => setCustomSource(e.target.value)} placeholder="e.g. Hand search, ProQuest, LILACS" />
                </Field>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={overrideSource} onChange={(e) => setOverrideSource(e.target.checked)} />
              <span>Use “{databaseSource}” for every record, even when the file names a different database. (By default the file’s own value is kept and “{databaseSource}” is used only when the file has none.)</span>
            </label>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => nav(`/p/${projectId}`)}>Cancel</Button>
              <Button variant="primary" onClick={() => analyse()} disabled={!file} loading={phase === 'parsing'}>Preview import</Button>
            </div>
            {phase === 'parsing' && progress.total > 0 && (
              <div className="space-y-1 text-sm text-slate-700">
                <p>{progress.label} {fmt(progress.done)} / {fmt(progress.total)}</p>
                <ProgressBar value={progress.done} max={progress.total} />
              </div>
            )}
          </div>
        </Card>
      )}

      {phase === 'preview' && result && stats && (
        <Card className="mt-5 p-5">
          <h2 className="text-lg font-semibold text-ink-900">Import preview</h2>
          <p className="text-sm text-slate-600">{file?.name} · detected format: <strong>{FORMAT_LABEL[result.format]}</strong> · source: <strong>{databaseSource}</strong></p>
          {zipInfo && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span>Read from the zip file: <strong>{zipInfo.used}</strong></span>
              {zipInfo.entries.length > 1 && (
                <>
                  <label htmlFor="zip-entry" className="sr-only">File inside the zip</label>
                  <Select id="zip-entry" className="w-auto py-1 text-xs" value={zipInfo.used} onChange={(e) => analyse(e.target.value)}>
                    {zipInfo.entries.map((z) => <option key={z.name} value={z.name}>{z.name}</option>)}
                  </Select>
                </>
              )}
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <PreviewStat label="Records detected" value={stats.total} />
            <PreviewStat label="Valid records (with title)" value={stats.withTitle} />
            <PreviewStat label="Missing titles" value={untitled} warn={untitled > 0} />
            <PreviewStat label="Possible duplicates" value={withinFile + existingCount} warn={withinFile + existingCount > 0}
              sub={`${fmt(withinFile)} within this file · ${fmt(existingCount)} already in project`} />
            <PreviewStat label="Malformed / problems" value={result.malformed.length} warn={result.malformed.length > 0} />
            <PreviewStat label="Invalid DOIs" value={stats.invalidDoi} warn={stats.invalidDoi > 0} sub="kept as-is" />
          </dl>
          <div className="mt-4 text-sm">
            <p><strong>Fields detected:</strong> {result.fieldsDetected.map((f) => FIELD_LABEL[f] ?? f).join(', ') || 'none'}</p>
            {!result.fieldsDetected.includes('abstract') && <Alert kind="warning" className="mt-2">No abstracts were found in this file. Title/abstract screening works best when the export includes abstracts — check your database’s export options.</Alert>}
            {result.unmappedFields.length > 0 && (
              <p className="mt-1 text-slate-600">Other columns/tags (kept in the original record, not shown in screening): {result.unmappedFields.slice(0, 25).join(', ')}{result.unmappedFields.length > 25 ? '…' : ''}</p>
            )}
          </div>
          {stats.rayyan && (
            <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm" data-testid="rayyan-panel">
              <h3 className="font-semibold text-ink-900">Rayyan screening data found</h3>
              <p className="mt-1 text-slate-700">
                {fmt(stats.rayyan.records)} records carry Rayyan data
                {stats.rayyan.reviewers.length > 0 && <> from {stats.rayyan.reviewers.join(', ')}</>}:{' '}
                <strong className="text-emerald-800">✓ {fmt(stats.rayyan.include)} included</strong>,{' '}
                <strong className="text-rose-800">✕ {fmt(stats.rayyan.exclude)} excluded</strong>,{' '}
                <strong className="text-amber-900">? {fmt(stats.rayyan.maybe)} maybe</strong>
                {stats.rayyan.conflicts > 0 && <>, <strong>{fmt(stats.rayyan.conflicts)} with disagreeing reviewers</strong> (left unscreened, noted on the record)</>}.
                {stats.rayyan.labels.length > 0 && <> Labels: {stats.rayyan.labels.slice(0, 12).join(', ')}{stats.rayyan.labels.length > 12 ? '…' : ''}.</>}
                {stats.rayyan.reasons.length > 0 && <> Exclusion reasons: {stats.rayyan.reasons.slice(0, 12).join(', ')}{stats.rayyan.reasons.length > 12 ? '…' : ''}.</>}
              </p>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={importRayyan} onChange={(e) => setImportRayyan(e.target.checked)} />
                <span>
                  <strong>Continue my Rayyan screening:</strong> import these as title/abstract decisions (with exclusion reasons), labels as tags and
                  Rayyan notes as notes. Each carried-over decision is recorded in the audit history as “restored from import”.
                  Untick to import the references unscreened.
                </span>
              </label>
            </div>
          )}
          {result.malformed.length > 0 && (
            <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-amber-950">Show {result.malformed.length} problem(s) found while reading the file</summary>
              <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-amber-950">
                {result.malformed.slice(0, 200).map((m, i) => <li key={i}>{m.message}</li>)}
              </ul>
            </details>
          )}
          {existingCount + withinFile > 0 && (
            <Alert kind="info" className="mt-3">
              Possible duplicates are <strong>imported and flagged</strong>, never deleted automatically. You decide what to do with them on the Duplicates page.
            </Alert>
          )}
          {untitled > 0 && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={includeUntitled} onChange={(e) => setIncludeUntitled(e.target.checked)} />
              <span>Import the {fmt(untitled)} record(s) without a title (they will appear as “[No title]”). Unticking skips them — they are not imported.</span>
            </label>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="mb-1 text-left text-sm font-medium text-ink-900">First records in the file</caption>
              <thead className="text-slate-500"><tr><th className="py-1 pr-2">#</th><th className="pr-2">Title</th><th className="pr-2">Authors</th><th className="pr-2">Year</th><th className="pr-2">Journal</th><th>Abstract</th></tr></thead>
              <tbody>
                {result.records.slice(0, 5).map((r) => (
                  <tr key={r.recordNo} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2">{r.recordNo}</td>
                    <td className="max-w-[16rem] pr-2">{r.title ?? <em className="text-rose-700">[No title]</em>}</td>
                    <td className="max-w-[10rem] truncate pr-2">{r.authors}</td>
                    <td className="pr-2">{r.year}</td>
                    <td className="max-w-[10rem] truncate pr-2">{r.journal}</td>
                    <td className="max-w-[14rem] truncate">{r.abstract ? `${r.abstract.slice(0, 80)}…` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={reset}>Cancel</Button>
            <Button variant="primary" onClick={() => runImport()}>Import {fmt(recordsToImport().length)} references</Button>
          </div>
        </Card>
      )}

      {(phase === 'importing' || phase === 'dedupe') && (
        <Card className="mt-5 p-5" >
          <div className="flex items-center gap-3"><Spinner /><h2 className="font-semibold text-ink-900">{progress.label}</h2></div>
          <p className="mt-3 text-sm tabular-nums text-slate-700" aria-live="polite">{fmt(progress.done)} / {fmt(progress.total)}</p>
          <div className="mt-2"><ProgressBar value={progress.done} max={progress.total} label={progress.label} /></div>
          <p className="mt-3 text-xs text-slate-500">Please keep this tab open until the import finishes.</p>
        </Card>
      )}

      {phase === 'failed' && outcome && (
        <Card className="mt-5 p-5">
          <Alert>{error}</Alert>
          <p className="mt-3 text-sm">
            {fmt(outcome.insertedIds.length)} of {fmt(recordsToImport().length)} references were imported before the problem.
            Nothing was lost: you can retry the remaining {fmt(recordsToImport().length - outcome.nextIndex)} references.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => runImport(outcome)}>Retry remaining references</Button>
            <Button onClick={() => runDedupe(outcome.insertedIds)}>Stop here and check duplicates</Button>
          </div>
        </Card>
      )}

      {phase === 'done' && outcome && (
        <Card className="mt-5 p-5">
          <h2 className="text-lg font-semibold text-emerald-800">✓ Import complete</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li><strong>{fmt(outcome.insertedIds.length)}</strong> references imported from {file?.name} ({databaseSource})</li>
            {importRayyan && stats?.rayyan && (
              <li>Rayyan decisions carried over: ✓ {fmt(stats.rayyan.include)} included, ✕ {fmt(stats.rayyan.exclude)} excluded, ? {fmt(stats.rayyan.maybe)} maybe{stats.rayyan.labels.length ? `, ${fmt(stats.rayyan.labels.length)} labels as tags` : ''}</li>
            )}
            {dupSummary && <li><strong>{fmt(dupSummary.records)}</strong> records flagged as possible duplicates in <strong>{fmt(dupSummary.groups)}</strong> group(s)</li>}
            {!includeUntitled && untitled > 0 && <li>{fmt(untitled)} record(s) without a title were skipped at your request</li>}
          </ul>
          {dupError && (
            <Alert kind="warning" className="mt-3">
              {dupError} Your references are imported. Run detection again from the <Link className="underline" to={`/p/${projectId}/duplicates`}>Duplicates page</Link>.
            </Alert>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => nav(`/p/${projectId}/screening`)}>Start screening</Button>
            {dupSummary && dupSummary.groups > 0 && <Button onClick={() => nav(`/p/${projectId}/duplicates`)}>Review duplicates</Button>}
            <Button onClick={reset}>Import another file</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function PreviewStat({ label, value, sub, warn }: { label: string; value: number; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-ink-900">{fmt(value)}</dd>
      {sub && <dd className="text-xs text-slate-600">{sub}</dd>}
    </div>
  );
}
