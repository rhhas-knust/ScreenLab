import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { restoreBackup, validateBackup, type ProjectBackup } from '../lib/api/backup';
import { createProject } from '../lib/api/projects';
import { setPendingImport } from '../lib/pendingImport';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate, qk } from '../lib/hooks';
import { Alert, Button, Field, Input, Modal } from './ui';

const REFERENCE_FILE = /\.(zip|csv|tsv|txt|ris|bib|bibtex|nbib)$/i;

/** Suggested review title from an export's file name, e.g. "rayyan-export-2026.zip" → "Rayyan export 2026". */
function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Imported review';
}

/**
 * "Import project" accepts:
 *  - a ScreenLab project backup (.json) → restored as a new project, or
 *  - a reference export such as a Rayyan .zip (or CSV / RIS / BibTeX / .nbib)
 *    → a new project is created and the import preview opens with the file,
 *    where Rayyan decisions, reasons, labels and notes can be carried over.
 */
export function RestoreBackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ProjectBackup | null>(null);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const reset = () => {
    setBackup(null);
    setRefFile(null);
    setError(null);
    setProgress(null);
    setTitle('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onFile = async (f: File | undefined) => {
    reset();
    if (!f) return;
    if (REFERENCE_FILE.test(f.name)) {
      setRefFile(f);
      setTitle(titleFromFileName(f.name));
      return;
    }
    if (!/\.json$/i.test(f.name) && f.type !== 'application/json') {
      setError('Please choose a ScreenLab project backup (.json) or a reference export such as a Rayyan .zip (or CSV, RIS, BibTeX, PubMed .nbib).');
      return;
    }
    try {
      const text = await f.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        setError('This file is not valid JSON — it may be corrupted or incomplete.');
        return;
      }
      const v = validateBackup(data);
      if (!v.ok) {
        setError(v.error);
        return;
      }
      setBackup(v.backup);
      setTitle(`${v.backup.project.title} (restored)`);
    } catch (e) {
      setError(friendlyError(e, 'The file could not be read.'));
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (refFile) {
        const p = await createProject({ title: title.trim() || titleFromFileName(refFile.name), review_type: 'systematic' });
        setPendingImport(p.id, refFile);
        await qc.invalidateQueries({ queryKey: qk.projects });
        onClose();
        reset();
        nav(`/p/${p.id}/import`);
        return;
      }
      if (!backup) return;
      const p = await restoreBackup(backup, title.trim() || backup.project.title, setProgress);
      await qc.invalidateQueries({ queryKey: qk.projects });
      onClose();
      reset();
      nav(`/p/${p.id}`);
    } catch (e) {
      setError(refFile ? `Could not create the project: ${friendlyError(e)}` : `Restore failed and nothing was kept: ${friendlyError(e)}`);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      dismissable={!busy}
      title="Import project"
      footer={
        <>
          <Button onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!backup && !refFile} loading={busy}>
            {refFile ? 'Create project and continue' : 'Restore as new project'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p>Choose one of:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>An export from another screening tool</strong> — e.g. your <strong>Rayyan .zip</strong> (or a CSV, RIS, BibTeX or PubMed file). Your Rayyan decisions, exclusion reasons, labels and notes can be carried over.</li>
          <li><strong>A ScreenLab project backup (.json)</strong>.</li>
        </ul>
        <p className="text-slate-600">Either way a <strong>new project</strong> is created — existing projects are never overwritten.</p>
        <input ref={fileRef} type="file" accept=".zip,.json,application/json,.csv,.tsv,.txt,.ris,.bib,.bibtex,.nbib"
          onChange={(e) => onFile(e.target.files?.[0])} disabled={busy}
          aria-label="Project file" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-white" />
        {error && <Alert>{error}</Alert>}
        {refFile && (
          <>
            <Alert kind="info">
              <strong>{refFile.name}</strong> will be opened in the import preview of a new project. There you can check the records and choose to
              <strong> continue your Rayyan screening</strong> (decisions, reasons, labels and notes) before anything is imported.
            </Alert>
            <Field id="new-project-title" label="Name for the new review">
              <Input id="new-project-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </Field>
            <p className="text-xs text-slate-500">You can add the research question and criteria later in Settings → Project settings.</p>
          </>
        )}
        {backup && (
          <>
            <Alert kind="info">
              <strong>{backup.project.title}</strong><br />
              Exported {fmtDate(backup.exported_at)} · {fmt(backup.references.length)} references · {fmt(backup.screening_decisions.length)} screening history entries · {fmt(backup.tags.length)} tags
              {backup.full_text_files.length > 0 && <><br />Note: {backup.full_text_files.length} uploaded PDF file(s) are not part of backups and will need to be re-uploaded.</>}
            </Alert>
            <Field id="restore-title" label="Name for the restored project">
              <Input id="restore-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </Field>
          </>
        )}
        {progress && <p role="status" className="text-ink-800">{progress}</p>}
      </div>
    </Modal>
  );
}
