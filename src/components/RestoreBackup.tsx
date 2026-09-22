import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { restoreBackup, validateBackup, type ProjectBackup } from '../lib/api/backup';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate, qk } from '../lib/hooks';
import { Alert, Button, Field, Input, Modal } from './ui';

/** Restores a ScreenLab JSON backup into a NEW project. */
export function RestoreBackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ProjectBackup | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const reset = () => {
    setBackup(null);
    setError(null);
    setProgress(null);
    setTitle('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onFile = async (f: File | undefined) => {
    reset();
    if (!f) return;
    if (!/\.json$/i.test(f.name) && f.type !== 'application/json') {
      setError('Please choose a ScreenLab backup file (.json).');
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
    if (!backup) return;
    setBusy(true);
    setError(null);
    try {
      const p = await restoreBackup(backup, title.trim() || backup.project.title, setProgress);
      await qc.invalidateQueries({ queryKey: qk.projects });
      onClose();
      reset();
      nav(`/p/${p.id}`);
    } catch (e) {
      setError(`Restore failed and nothing was kept: ${friendlyError(e)}`);
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
      title="Import project backup"
      footer={
        <>
          <Button onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!backup} loading={busy}>Restore as new project</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p>Choose a <strong>ScreenLab project backup (.json)</strong>. It is restored as a <strong>new project</strong> — your existing projects are never overwritten.</p>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy}
          aria-label="Backup file" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-white" />
        {error && <Alert>{error}</Alert>}
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
