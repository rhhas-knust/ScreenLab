import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rk, setResultsSharing, sharedResultsUrl, updateRhProject, type RhProject } from '../lib/api/research';
import { friendlyError } from '../lib/errors';
import { Button, Input, Modal } from '../components/ui';
import { useToast } from '../components/Toast';

/** Owner-only: turn the read-only results link (for a supervisor or co-author) on or off. */
export function ShareResultsButton({ project }: { project: RhProject }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = project.results_token;
  const url = token ? sharedResultsUrl(token) : '';

  const save = async (fn: () => Promise<RhProject>, done: string) => {
    setBusy(true);
    try {
      qc.setQueryData(rk.project(project.id), await fn());
      toast(done);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Select the link and copy it.', { kind: 'error' }); }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="rh-share-results">{token ? 'Results link · on' : 'Share results'}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Share results (read-only)">
        <div className="space-y-3 text-sm text-slate-700">
          <p>Give a supervisor or co-author a link to see the statistics and use the Chart studio, without an account and without being able to change or delete anything.</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
            <li>Email-address answers are never shown.</li>
            <li>Open-text answers are hidden unless you tick the box below.</li>
            <li>Anyone who has the link can see the results, so send it only to people you trust.</li>
          </ul>
          {token ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={url} aria-label="Results link" onFocus={(e) => e.currentTarget.select()} data-testid="rh-results-url" />
                <Button onClick={copy}>Copy</Button>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!project.results_include_text} disabled={busy}
                  onChange={(e) => save(() => updateRhProject(project.id, { results_include_text: e.target.checked }), e.target.checked ? 'Open-text answers are now shared' : 'Open-text answers are now hidden')} />
                Include open-text answers
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" size="sm" loading={busy} onClick={() => save(() => setResultsSharing(project.id, true, !!project.results_include_text), 'New link made. The old link no longer works.')}>Make a new link</Button>
                <Button variant="ghost" size="sm" className="text-rose-700" loading={busy} onClick={() => save(() => setResultsSharing(project.id, false), 'Results link turned off')} data-testid="rh-results-off">Turn off</Button>
              </div>
            </>
          ) : (
            <Button loading={busy} onClick={() => save(() => setResultsSharing(project.id, true), 'Results link created')} data-testid="rh-results-on">Create a results link</Button>
          )}
        </div>
      </Modal>
    </>
  );
}
