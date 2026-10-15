import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteFinal, getForReference, getProgress, listTeam, saveExtraction, saveFinal, xk, type Extraction,
} from '../lib/api/extraction';
import { getReference } from '../lib/api/references';
import { listFiles, signedPdfUrl } from '../lib/api/fulltext';
import {
  display, isEmpty, mergeForFinal, MODULES, readForm, sameValue, studyLabel, type ExtractionData, type ExtractionForm, type ModuleKind, type Value,
} from '../lib/extraction/form';
import { friendlyError } from '../lib/errors';
import { useSettings } from '../lib/hooks';
import { Alert, Button, Card, cx, EmptyState, PageLoader } from '../components/ui';
import { useToast } from '../components/Toast';
import { FieldInput } from './FieldInput';

function PaperPanel({ referenceId }: { referenceId: string }) {
  const toast = useToast();
  const ref = useQuery({ queryKey: ['reference', referenceId], queryFn: () => getReference(referenceId) });
  const files = useQuery({ queryKey: ['files', referenceId], queryFn: () => listFiles(referenceId) });
  const [showAbstract, setShowAbstract] = useState(false);
  const r = ref.data;
  if (!r) return <Card className="p-4"><span className="text-sm text-slate-500">Loading paper…</span></Card>;
  return (
    <Card className="space-y-2 p-4" as="article">
      <div className="text-xs font-medium text-slate-500">#{r.seq} · {studyLabel(r.authors, r.year)}</div>
      <h2 className="font-semibold text-ink-900" data-testid="extraction-title">{r.title}</h2>
      <p className="text-sm text-slate-600">{r.authors}</p>
      <p className="text-sm text-slate-600">{[r.journal, r.year].filter(Boolean).join(', ')}</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {r.doi && <a className="text-lens-700 underline" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">DOI</a>}
        {r.full_text_url && <a className="text-lens-700 underline" href={r.full_text_url} target="_blank" rel="noreferrer">Full text link</a>}
        {(files.data ?? []).map((f) => (
          <button key={f.id} type="button" className="text-lens-700 underline" onClick={async () => {
            try { window.open(await signedPdfUrl(f), '_blank', 'noopener'); } catch (e) { toast(friendlyError(e), { kind: 'error' }); }
          }}>PDF: {f.file_name}</button>
        ))}
      </div>
      {r.tag_names?.length > 0 && <p className="text-xs text-slate-500">Tags: {r.tag_names.join(', ')}</p>}
      {r.abstract && (
        <div>
          <button type="button" className="text-sm font-medium text-ink-800 underline" onClick={() => setShowAbstract((s) => !s)}>
            {showAbstract ? 'Hide abstract' : 'Show abstract'}
          </button>
          {showAbstract && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.abstract}</p>}
        </div>
      )}
    </Card>
  );
}

/** Side-by-side comparison of completed extractions, and the agreed final version. */
function Finalise({ kind, projectId, referenceId, form, sources, existing, names, onSaved }: {
  kind: ModuleKind; projectId: string; referenceId: string; form: ExtractionForm; sources: Extraction[];
  existing: ExtractionData | null; names: (id: string) => string; onSaved: () => void;
}) {
  const toast = useToast();
  const [a, b] = sources;
  const start = useMemo(() => mergeForFinal(form, a.data, b?.data ?? null), [form, a, b]);
  const [data, setData] = useState<ExtractionData>(existing ?? start.data);
  const [busy, setBusy] = useState(false);
  const conflicts = form.fields.filter((fl) => b && !sameValue(a.data[fl.key], b.data[fl.key], fl.type));
  const set = (k: string, v: Value) => setData((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try { await saveFinal(projectId, referenceId, data, kind); toast(`Final ${MODULES[kind].noun} saved`); onSaved(); } catch (e) { toast(friendlyError(e), { kind: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Card className="space-y-3 p-4">
      <div data-testid="finalise">
        <h3 className="font-semibold text-ink-900">{b ? `Compare and agree the final ${MODULES[kind].noun}` : `Final ${MODULES[kind].noun}`}</h3>
        <p className="text-sm text-slate-600">
          {b
            ? conflicts.length
              ? `${conflicts.length} field${conflicts.length === 1 ? '' : 's'} differ between ${names(a.reviewer_id)} and ${names(b.reviewer_id)}. Agreed values are filled in; discuss the rest and choose.`
              : `Both ${MODULES[kind].noun}s agree on every field.`
            : `Only one completed ${MODULES[kind].noun} so far. You can finalise from it, or wait for your co-reviewer.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="w-48 py-1">Field</th><th>{names(a.reviewer_id)}</th>{b && <th>{names(b.reviewer_id)}</th>}<th className="w-[34%]">Final</th></tr>
          </thead>
          <tbody>
            {form.fields.map((fl) => {
              const differ = b && !sameValue(a.data[fl.key], b.data[fl.key], fl.type);
              return (
                <tr key={fl.key} className={cx('border-t border-slate-100 align-top', differ && 'bg-amber-50')} data-testid={differ ? 'conflict-row' : undefined}>
                  <td className="py-2 pr-2 font-medium text-ink-900">{fl.label}{differ && <span className="ml-1 text-xs font-semibold text-amber-800">differs</span>}</td>
                  <td className="py-2 pr-2">
                    <div className="whitespace-pre-line">{display(a.data[fl.key]) || <span className="text-slate-400">blank</span>}</div>
                    {differ && <Button size="sm" variant="ghost" onClick={() => set(fl.key, a.data[fl.key] ?? '')}>Use this</Button>}
                  </td>
                  {b && (
                    <td className="py-2 pr-2">
                      <div className="whitespace-pre-line">{display(b.data[fl.key]) || <span className="text-slate-400">blank</span>}</div>
                      {differ && <Button size="sm" variant="ghost" onClick={() => set(fl.key, b.data[fl.key] ?? '')}>Use this</Button>}
                    </td>
                  )}
                  <td className="py-2"><FieldInput field={fl} value={data[fl.key]} onChange={(v) => set(fl.key, v)} idPrefix="final" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="primary" onClick={save} loading={busy} data-testid="final-save">Save final {MODULES[kind].noun}</Button>
    </Card>
  );
}

export function StudyExtraction({ kind = 'extraction' }: { kind?: ModuleKind }) {
  const M = MODULES[kind];
  const { projectId = '', refId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useSettings(projectId);
  const form = readForm(settings.data, kind);
  const q = useQuery({ queryKey: xk.reference(refId, kind), queryFn: () => getForReference(refId, kind) });
  const progress = useQuery({ queryKey: xk.progress(projectId, kind), queryFn: () => getProgress(projectId, kind) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const [data, setData] = useState<ExtractionData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'complete' | null>(null);

  useEffect(() => { setData(null); setDirty(false); }, [refId]);
  useEffect(() => { if (q.data && data === null) setData(q.data.mine?.data ?? {}); }, [q.data, data]);

  if (!settings.data || !q.data || data === null) return <PageLoader />;
  if (!form) {
    return <div className="mx-auto max-w-3xl p-6"><EmptyState title={`No ${M.noun} form yet`} action={<Link className="underline" to={`/p/${projectId}/${M.path}?tab=form`}>Set up the form</Link>}>Choose or build the form first.</EmptyState></div>;
  }
  const { mine, others, final, me } = q.data;
  const names = (id: string) => (id === me ? 'You' : team.data?.find((t) => t.user_id === id)?.email ?? 'Co-reviewer');
  const rows = progress.data ?? [];
  const idx = rows.findIndex((r) => r.reference_id === refId);
  const nextTodo = rows.slice(idx + 1).concat(rows.slice(0, Math.max(idx, 0))).find((r) => r.my_status !== 'complete' && !r.has_final);

  const completeOthers = others.filter((o) => o.status === 'complete');
  const iAmComplete = mine?.status === 'complete';
  const sources = iAmComplete ? [mine!, ...completeOthers] : !mine && completeOthers.length >= 2 ? completeOthers : [];
  const filled = form.fields.filter((fl) => !isEmpty(data[fl.key])).length;

  const save = async (status: 'draft' | 'complete') => {
    setBusy(status);
    try {
      await saveExtraction(projectId, refId, data, status, kind);
      setDirty(false);
      await Promise.all([qc.invalidateQueries({ queryKey: xk.reference(refId, kind) }), qc.invalidateQueries({ queryKey: xk.progress(projectId, kind) })]);
      toast(status === 'complete' ? `${M.noun[0].toUpperCase()}${M.noun.slice(1)} marked complete` : 'Draft saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const refreshAll = () => Promise.all([qc.invalidateQueries({ queryKey: xk.reference(refId, kind) }), qc.invalidateQueries({ queryKey: xk.progress(projectId, kind) })]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/p/${projectId}/${M.path}`} className="text-sm text-ink-800 underline">← All included studies</Link>
        <span className="flex-1" />
        {idx >= 0 && <span className="text-sm text-slate-500">Study {idx + 1} of {rows.length}</span>}
        {nextTodo && <Button size="sm" variant="secondary" onClick={() => nav(`/p/${projectId}/${M.path}/${nextTodo.reference_id}`)} disabled={dirty}>Next to do →</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <PaperPanel referenceId={refId} />
          {final && <Alert kind="success">The final {M.noun} for this study has been agreed.</Alert>}
          {!iAmComplete && others.length > 0 && (
            <Alert kind="info">{others.length === 1 ? 'Another reviewer has' : `${others.length} reviewers have`} started this study. Their answers stay hidden until you mark yours complete, so the two {M.noun}s are independent.</Alert>
          )}
        </div>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2" data-testid="extraction-form">
            <h3 className="flex-1 font-semibold text-ink-900">Your {M.noun}</h3>
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', iAmComplete ? 'bg-emerald-50 text-emerald-800' : mine ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')} data-testid="my-status">
              {iAmComplete ? 'Complete' : mine ? 'Draft' : 'Not started'}
            </span>
            <span className="text-xs text-slate-500">{filled}/{form.fields.length} fields</span>
          </div>
          {form.fields.map((fl) => (
            <div key={fl.key}>
              <label htmlFor={`mine-${fl.key}`} className="block text-sm font-medium text-ink-900">{fl.label}</label>
              {fl.help && <p className="mb-1 text-xs text-slate-500">{fl.help}</p>}
              <FieldInput field={fl} value={data[fl.key]} idPrefix="mine" onChange={(v) => { setData({ ...data, [fl.key]: v }); setDirty(true); }} />
            </div>
          ))}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-slate-100 bg-white px-4 pt-3">
            <Button variant="secondary" onClick={() => save('draft')} loading={busy === 'draft'} disabled={!!busy}>Save draft</Button>
            <Button variant="primary" onClick={() => save('complete')} loading={busy === 'complete'} disabled={!!busy} data-testid="extraction-complete">
              {iAmComplete ? 'Save changes' : 'Mark complete'}
            </Button>
          </div>
        </Card>
      </div>

      {sources.length > 0 && (
        <Finalise kind={kind} key={`${final?.updated_at ?? 'new'}-${sources.map((s) => s.updated_at).join()}`} projectId={projectId} referenceId={refId} form={form}
          sources={sources} existing={final?.data ?? null} names={names} onSaved={refreshAll} />
      )}
      {final && (
        <div className="text-right">
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!window.confirm(`Remove the agreed final ${M.noun} for this study? The reviewers’ own answers are kept.`)) return;
            try { await deleteFinal(refId, kind); await refreshAll(); } catch (e) { toast(friendlyError(e), { kind: 'error' }); }
          }}>Remove final {M.noun}</Button>
        </div>
      )}
    </div>
  );
}
