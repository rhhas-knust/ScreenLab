import { useState } from 'react';
import { fetchAllReferences } from '../lib/api/references';
import { buildBackup } from '../lib/api/backup';
import { logActivity } from '../lib/api/projects';
import { dateStamp, downloadText, referencesToCsv, referencesToJson, referencesToRis, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import type { Project, Reference } from '../lib/types';
import { Alert, Button, Field, Select } from './ui';

type Scope = 'all' | 'active' | 'ta_include' | 'final_include' | 'excluded' | 'unscreened';
const SCOPES: Record<Scope, string> = {
  all: 'All records (including duplicates)',
  active: 'All records after de-duplication',
  ta_include: 'Included at title/abstract',
  final_include: 'Final included studies (after full text)',
  excluded: 'Excluded records',
  unscreened: 'Unscreened records',
};

function applyScope(refs: Reference[], scope: Scope, stage2: boolean): Reference[] {
  const active = refs.filter((r) => r.duplicate_status !== 'duplicate' && r.duplicate_status !== 'merged');
  switch (scope) {
    case 'all': return refs;
    case 'active': return active;
    case 'ta_include': return active.filter((r) => r.title_abstract_decision === 'include');
    case 'final_include': return active.filter((r) => r.title_abstract_decision === 'include' && (!stage2 || r.full_text_decision === 'include'));
    case 'excluded': return active.filter((r) => r.title_abstract_decision === 'exclude' || r.full_text_decision === 'exclude');
    case 'unscreened': return active.filter((r) => !r.title_abstract_decision);
  }
}

export function ExportPanel({ project, stage2Enabled }: { project: Project; stage2Enabled: boolean }) {
  const [scope, setScope] = useState<Scope>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `${safeFileName(project.title)}_${dateStamp()}`;

  const exportRefs = async (fmt: 'csv' | 'json' | 'ris') => {
    setBusy(fmt);
    setError(null);
    setMsg('Fetching references…');
    try {
      const all = await fetchAllReferences(project.id, (n) => setMsg(`Fetching references… ${n.toLocaleString()}`));
      const refs = applyScope(all, scope, stage2Enabled);
      if (fmt === 'csv') downloadText(`${base}_${scope}.csv`, referencesToCsv(refs), 'text/csv');
      if (fmt === 'json') downloadText(`${base}_${scope}.json`, referencesToJson(refs), 'application/json');
      if (fmt === 'ris') downloadText(`${base}_${scope}.ris`, referencesToRis(refs), 'application/x-research-info-systems');
      await logActivity(project.id, 'export', `Exported ${refs.length.toLocaleString()} references as ${fmt.toUpperCase()} (${SCOPES[scope]})`);
      setMsg(`Downloaded ${refs.length.toLocaleString()} references as ${fmt.toUpperCase()}.`);
    } catch (e) {
      setError(friendlyError(e, 'Export failed.'));
      setMsg(null);
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    setBusy('backup');
    setError(null);
    try {
      const b = await buildBackup(project.id, setMsg);
      downloadText(`${base}_screenlab-backup.json`, JSON.stringify(b), 'application/json');
      setMsg(`Backup downloaded: ${b.references.length.toLocaleString()} references, ${b.screening_decisions.length.toLocaleString()} history entries.`);
    } catch (e) {
      setError(friendlyError(e, 'Backup failed.'));
      setMsg(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-ink-900">Export screening data</h3>
        <p className="mt-1 text-sm text-slate-600">
          CSV includes metadata, both screening decisions, exclusion reasons, notes, tags, duplicate and full-text status, and timestamps.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="export-scope" label="Records to export">
            <Select id="export-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {Object.entries(SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportRefs('csv')} loading={busy === 'csv'} disabled={!!busy}>Export CSV</Button>
            <Button onClick={() => exportRefs('json')} loading={busy === 'json'} disabled={!!busy}>Export JSON</Button>
            <Button onClick={() => exportRefs('ris')} loading={busy === 'ris'} disabled={!!busy}>Export RIS</Button>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-200 pt-4">
        <h3 className="font-semibold text-ink-900">Complete project backup</h3>
        <p className="mt-1 text-sm text-slate-600">
          One JSON file with everything: project details and criteria, settings, references, decisions, exclusion reasons, notes, tags,
          duplicate information, full screening history and the activity log. Restore it from <em>Projects → Import project</em>.
        </p>
        <Button className="mt-3" variant="primary" onClick={backup} loading={busy === 'backup'} disabled={!!busy}>Export project backup</Button>
      </div>
      {msg && <p role="status" className="text-sm text-ink-800">{msg}</p>}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
