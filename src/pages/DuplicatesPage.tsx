import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { completeness, detectAllDuplicates, listGroups, mergeMetadata, reopenGroup, resolveGroup, type GroupWithMembers } from '../lib/api/duplicates';
import { friendlyError } from '../lib/errors';
import { fmt, fmtDate, qk, useStats } from '../lib/hooks';
import { BIB_FIELDS, type BibField, type Reference } from '../lib/types';
import { Alert, Button, Card, Modal, ProgressBar, Spinner, cx } from '../components/ui';
import { DecisionBadge } from '../components/Decision';
import { useToast } from '../components/Toast';

const MATCH_LABEL: Record<string, string> = {
  doi: 'Same DOI', pmid: 'Same PMID', title_year: 'Same title + year', fuzzy_title: 'Similar title', manual: 'Manual',
};
const RES_LABEL: Record<string, string> = { merged: 'Merged', kept_all: 'Kept all (not duplicates)', marked_duplicate: 'Marked duplicate' };
const FIELD_LABEL: Record<BibField, string> = {
  title: 'Title', authors: 'Authors', abstract: 'Abstract', year: 'Year', journal: 'Journal', volume: 'Volume', issue: 'Issue', pages: 'Pages',
  doi: 'DOI', pmid: 'PMID', url: 'URL', keywords: 'Keywords', publication_type: 'Type', database_source: 'Database', language: 'Language',
};

function GroupCard({ group, projectId, onChanged }: { group: GroupWithMembers; projectId: string; onChanged: () => void }) {
  const toast = useToast();
  const members = group.members;
  const suggested = [...members].sort((a, b) => completeness(b) - completeness(a))[0]?.id;
  const [primary, setPrimary] = useState<string>(suggested ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const primaryRef = members.find((m) => m.id === primary);
  const others = members.filter((m) => m.id !== primary);
  const merged = primaryRef ? mergeMetadata(primaryRef, others) : {};

  const act = async (action: 'keep_all' | 'mark' | 'merge') => {
    setBusy(action);
    try {
      await resolveGroup(group.id, action, action === 'keep_all' ? undefined : primary, action === 'merge' ? merged : undefined);
      toast(action === 'keep_all' ? 'Kept all records' : action === 'mark' ? 'Marked as duplicates' : 'Records merged', {
        action: { label: 'Undo', onClick: () => { void reopenGroup(group.id).then(onChanged); } },
      });
      setMergeOpen(false);
      onChanged();
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const fields = BIB_FIELDS.filter((f) => members.some((m) => m[f] != null && m[f] !== ''));
  const differs = (f: BibField) => new Set(members.map((m) => String(m[f] ?? '').trim().toLowerCase())).size > 1;

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{MATCH_LABEL[group.match_type]}{group.match_type === 'fuzzy_title' && group.match_score ? ` (${Math.round(group.match_score * 100)}%)` : ''}</span>
        <span className="text-slate-600">{members.length} records</span>
        {group.status === 'resolved' && <span className="text-xs text-slate-600">· {RES_LABEL[group.resolution ?? '']} {fmtDate(group.resolved_at)}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
          <thead>
            <tr>
              <th className="w-24 p-1.5" />
              {members.map((m) => (
                <th key={m.id} className="p-1.5 align-bottom">
                  {group.status === 'open' ? (
                    <label className="flex items-center gap-1 text-sm font-medium">
                      <input type="radio" name={`primary-${group.id}`} checked={primary === m.id} onChange={() => setPrimary(m.id)} />
                      Keep this record{m.id === suggested ? ' (most complete)' : ''}
                    </label>
                  ) : (
                    <span className="text-sm font-medium">{m.duplicate_status === 'kept' ? '✓ Kept' : m.duplicate_status === 'merged' ? '⧉ Merged' : m.duplicate_status === 'duplicate' ? '⧉ Duplicate' : m.duplicate_status}</span>
                  )}
                  <div className="font-normal text-slate-500">#{m.seq} · <Link className="underline" to={`/p/${projectId}/screening?ref=${m.id}&dup=all`}>open</Link></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f} className={cx('border-t border-slate-100 align-top', differs(f) && 'bg-amber-50/60')}>
                <th scope="row" className="p-1.5 font-medium text-slate-600">{FIELD_LABEL[f]}{differs(f) && <span className="sr-only"> (differs)</span>}</th>
                {members.map((m) => (
                  <td key={m.id} className={cx('p-1.5', f === 'abstract' && 'max-w-xs')}>
                    {f === 'abstract' ? <span className="line-clamp-4">{m.abstract ?? '—'}</span> : (m[f] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-slate-100 align-top">
              <th scope="row" className="p-1.5 font-medium text-slate-600">Decision</th>
              {members.map((m) => <td key={m.id} className="p-1.5"><DecisionBadge decision={m.title_abstract_decision} reason={m.title_abstract_exclusion_reason} /></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {group.status === 'open' ? (
          <>
            <Button size="sm" variant="primary" onClick={() => setMergeOpen(true)} disabled={!!busy}>Merge…</Button>
            <Button size="sm" onClick={() => act('mark')} loading={busy === 'mark'} disabled={!!busy}>Mark others as duplicate</Button>
            <Button size="sm" variant="ghost" onClick={() => act('keep_all')} loading={busy === 'keep_all'} disabled={!!busy}>Keep both — not duplicates</Button>
          </>
        ) : (
          <Button size="sm" onClick={async () => { try { await reopenGroup(group.id); onChanged(); } catch (e) { toast(friendlyError(e), { kind: 'error' }); } }}>Reopen (undo resolution)</Button>
        )}
      </div>
      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title="Merge duplicate records" size="lg"
        footer={<><Button onClick={() => setMergeOpen(false)}>Cancel</Button><Button variant="primary" loading={busy === 'merge'} onClick={() => act('merge')}>Merge records</Button></>}>
        <div className="space-y-3 text-sm">
          <p>The kept record (#{primaryRef?.seq}) keeps its screening decisions. Empty fields are filled from the other record(s), and the longest abstract/author list/keywords are used. The other record(s) are marked <em>merged</em> and removed from screening — they are not deleted, and a full snapshot is kept so the merge can be undone.</p>
          {Object.keys(merged).length === 0 ? <Alert kind="info">The kept record is already the most complete — no fields will change.</Alert> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500"><th className="py-1">Field</th><th>Current</th><th>After merge</th></tr></thead>
              <tbody>
                {Object.entries(merged).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2 font-medium">{FIELD_LABEL[k as BibField]}</td>
                    <td className="pr-2 text-slate-500">{String(primaryRef?.[k as keyof Reference] ?? '—').slice(0, 160)}</td>
                    <td>{String(v).slice(0, 160)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>
    </Card>
  );
}

export function DuplicatesPage() {
  const { projectId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: stats } = useStats(projectId);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [page, setPage] = useState(0);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const q = useQuery({
    queryKey: [...qk.dupGroups(projectId), tab, page],
    queryFn: () => listGroups(projectId, tab, page, 10),
    placeholderData: keepPreviousData,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.dupGroups(projectId) });
    qc.invalidateQueries({ queryKey: qk.stats(projectId) });
    qc.invalidateQueries({ queryKey: qk.refs(projectId) });
  };
  const runScan = async () => {
    setScan({ done: 0, total: 0 });
    try {
      const r = await detectAllDuplicates(projectId, (done, total) => setScan({ done, total }));
      toast(r.groups ? `Found ${fmt(r.records)} records in ${fmt(r.groups)} duplicate group(s)` : 'No new duplicates found');
      refresh();
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setScan(null);
    }
  };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.count / 10)) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Duplicates</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Detected by exact DOI, exact PMID, normalised title + year, and fuzzy title similarity. Nothing is deleted automatically — you decide.
            {stats && <> Removed so far: <strong>{fmt(stats.duplicates_removed)}</strong>. Possible duplicates to review: <strong>{fmt(stats.possible_duplicates)}</strong>.</>}
          </p>
        </div>
        <Button onClick={runScan} loading={!!scan} disabled={!!scan}>Scan all records for duplicates</Button>
      </div>
      {scan && scan.total > 0 && (
        <div className="mt-3 max-w-md text-sm"><p className="tabular-nums">Checking {fmt(scan.done)} / {fmt(scan.total)}…</p><ProgressBar value={scan.done} max={scan.total} /></div>
      )}
      <div className="mt-4 flex gap-1" role="tablist">
        {(['open', 'resolved'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => { setTab(t); setPage(0); }}
            className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === t ? 'bg-ink-900 text-white' : 'text-ink-800 hover:bg-ink-50')}>
            {t === 'open' ? 'To review' : 'Resolved'}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-4">
        {q.error ? <Alert>{friendlyError(q.error)}</Alert> : !q.data ? <Spinner /> : q.data.groups.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-600">{tab === 'open' ? 'No possible duplicates to review.' : 'No resolved duplicate groups yet.'}</Card>
        ) : q.data.groups.map((g) => <GroupCard key={g.id} group={g} projectId={projectId} onChanged={refresh} />)}
      </div>
      {q.data && q.data.count > 10 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
          <span className="tabular-nums">{page + 1} / {pages} ({fmt(q.data.count)} groups)</span>
          <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}
