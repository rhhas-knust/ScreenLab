import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAll, getProgress, studyDetails, xk } from '../lib/api/extraction';
import { saveSettingsKey } from '../lib/api/methods';
import { readForm, studyLabel, TIER_KEY, type ExtractionForm, type FormField } from '../lib/extraction/form';
import {
  crossTab, crossTabCsv, evidenceCsv, evidenceWord, fieldsWithRob, groupStudies, wordDoc, type SynthesisStudy,
} from '../lib/synthesis/tables';
import {
  blankRow, calculatedCertainty, certaintyOf, DOMAIN_OPTIONS, DOMAINS, GRADE_HEAD, gradeCsv, gradeTableRows, LEVELS, PUB_OPTIONS, readGrade, type GradeRow, type Level,
} from '../lib/synthesis/grade';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { qk, useProject, useSettings } from '../lib/hooks';
import { Alert, Button, Card, cx, EmptyState, Input, Label, PageLoader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

const TABS = [
  { key: 'evidence', label: 'Evidence table' },
  { key: 'crosstab', label: 'Cross-tabulation' },
  { key: 'grade', label: 'GRADE summary of findings' },
] as const;
const WORD = 'application/msword';

function EvidenceTab({ title, fields, studies }: { title: string; fields: FormField[]; studies: SynthesisStudy[] }) {
  const groupable = fields.filter((f) => f.type === 'choice' || f.type === 'multi');
  const [groupKey, setGroupKey] = useState(groupable.find((f) => f.key === TIER_KEY)?.key ?? groupable[0]?.key ?? '');
  const defaults = fields.filter((f) => f.key !== groupKey && !/notes|limitations/i.test(f.key)).slice(0, 7).map((f) => f.key);
  const [cols, setCols] = useState<string[]>(defaults);
  const groupBy = fields.find((f) => f.key === groupKey);
  if (!groupBy) return <EmptyState title="No field to group by">Add a one-choice field (such as Tier) to the extraction form.</EmptyState>;
  const columns = fields.filter((f) => cols.includes(f.key) && f.key !== groupKey);
  const groups = groupStudies(groupBy, studies);
  const base = `${safeFileName(title)}_evidence_by_${safeFileName(groupBy.label)}`;

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="ev-group">Group studies by</Label>
            <Select id="ev-group" value={groupKey} onChange={(e) => setGroupKey(e.target.value)}>
              {groupable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          </div>
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => downloadText(`${base}.csv`, evidenceCsv(groupBy, columns, groups), 'text/csv')}>CSV</Button>
          <Button variant="primary" onClick={() => downloadText(`${base}.doc`, evidenceWord(`Evidence table by ${groupBy.label.toLowerCase()}`, groupBy, columns, groups), WORD)} data-testid="evidence-word">Word</Button>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink-800">Columns ({columns.length})</summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {fields.filter((f) => f.key !== groupKey).map((f) => (
              <label key={f.key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={cols.includes(f.key)} onChange={(e) => setCols(e.target.checked ? [...cols, f.key] : cols.filter((k) => k !== f.key))} />
                {f.label.length > 40 ? `${f.label.slice(0, 39)}…` : f.label}
              </label>
            ))}
          </div>
        </details>
        {groupBy.type === 'multi' && <p className="text-xs text-slate-500">A study with several answers for “{groupBy.label}” appears in each of its groups.</p>}
      </Card>
      {groups.map((g) => (
        <Card key={g.value} className="overflow-x-auto p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-900" data-testid="evidence-group">{groupBy.label}: {g.value} · {g.studies.length} stud{g.studies.length === 1 ? 'y' : 'ies'}</h3>
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr><th className="border-b border-slate-200 py-1 pr-2">Study</th>{columns.map((c) => <th key={c.key} className="border-b border-slate-200 py-1 pr-2">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {g.studies.map((s) => (
                <tr key={s.seq} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{s.label} <span className="text-slate-400">#{s.seq}</span></td>
                  {columns.map((c) => {
                    const v = c.key === '__rob' ? s.rob : s.data[c.key];
                    return <td key={c.key} className="py-1.5 pr-2">{Array.isArray(v) ? v.join('; ') : v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function CrossTabTab({ title, fields, studies }: { title: string; fields: FormField[]; studies: SynthesisStudy[] }) {
  const choice = fields.filter((f) => f.type === 'choice' || f.type === 'multi');
  const [rowKey, setRowKey] = useState(choice.find((f) => f.key === TIER_KEY)?.key ?? choice[0]?.key ?? '');
  const [colKey, setColKey] = useState(choice.find((f) => f.key !== rowKey && f.type === 'multi')?.key ?? choice[1]?.key ?? '');
  const rowField = choice.find((f) => f.key === rowKey);
  const colField = choice.find((f) => f.key === colKey);
  if (choice.length < 2 || !rowField || !colField) return <EmptyState title="Not enough fields">Cross-tabulation needs two choice fields in the extraction form.</EmptyState>;
  const t = crossTab(rowField, colField, studies);
  const name = `${safeFileName(title)}_${safeFileName(rowField.label)}_by_${safeFileName(colField.label)}`;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="ct-row">Rows</Label>
          <Select id="ct-row" value={rowKey} onChange={(e) => setRowKey(e.target.value)}>{choice.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
        </div>
        <div>
          <Label htmlFor="ct-col">Columns</Label>
          <Select id="ct-col" value={colKey} onChange={(e) => setColKey(e.target.value)}>{choice.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
        </div>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => downloadText(`${name}.csv`, crossTabCsv(rowField, colField, t), 'text/csv')}>CSV</Button>
        <Button variant="primary" onClick={() => downloadText(`${name}.doc`, wordDoc(`${rowField.label} by ${colField.label}`, [{
          heading: `Number of studies (n = ${t.studies})`, head: ['', ...t.cols, 'Total'],
          rows: [...t.rows.map((r, i) => [r, ...t.counts[i].map(String), String(t.rowTotals[i])]), ['Total', ...t.colTotals.map(String), String(t.studies)]],
          note: t.multi ? 'Studies with several answers are counted once for each answer, so totals can exceed the number of studies.' : undefined,
        }]), WORD)}>Word</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-sm tabular-nums" data-testid="crosstab">
          <thead><tr><th className="border border-slate-300 bg-slate-50 p-1.5 text-left">{rowField.label} \ {colField.label}</th>{t.cols.map((c) => <th key={c} className="border border-slate-300 bg-slate-50 p-1.5">{c}</th>)}<th className="border border-slate-300 bg-slate-100 p-1.5">Total</th></tr></thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={r}>
                <th className="border border-slate-300 p-1.5 text-left font-medium">{r}</th>
                {t.counts[i].map((n, j) => <td key={j} className={cx('border border-slate-300 p-1.5 text-center', n === 0 && 'text-slate-300')}>{n}</td>)}
                <td className="border border-slate-300 bg-slate-50 p-1.5 text-center font-semibold">{t.rowTotals[i]}</td>
              </tr>
            ))}
            <tr><th className="border border-slate-300 bg-slate-100 p-1.5 text-left">Total</th>{t.colTotals.map((n, j) => <td key={j} className="border border-slate-300 bg-slate-50 p-1.5 text-center font-semibold">{n}</td>)}<td className="border border-slate-300 bg-slate-100 p-1.5 text-center font-semibold">{t.studies}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Counts are numbers of studies with an agreed extraction.{t.multi ? ' Studies with several answers are counted once for each answer, so totals can exceed the number of studies.' : ''}</p>
    </Card>
  );
}

function GradeTab({ projectId, title, initial }: { projectId: string; title: string; initial: GradeRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<GradeRow[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (id: string, patch: Partial<GradeRow>) => { setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r))); setDirty(true); };
  const save = async () => {
    setBusy(true);
    try {
      await saveSettingsKey(projectId, 'grade', { rows });
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      setDirty(false);
      toast('GRADE table saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const base = `${safeFileName(title)}_GRADE_summary_of_findings`;
  return (
    <div className="space-y-3" data-testid="grade">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-slate-600">
          One row per main outcome. Certainty starts at High (randomised trials) or Low (observational evidence), drops one level per serious concern
          (two if very serious), and can be upgraded for large effects. Override it with your judgement where needed, and say why in the comments.
        </p>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadText(`${base}.csv`, gradeCsv(rows), 'text/csv')}>CSV</Button>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadText(`${base}.doc`, wordDoc('GRADE summary of findings', [{ heading: 'Certainty of evidence', head: GRADE_HEAD, rows: gradeTableRows(rows) }]), WORD)}>Word</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty} data-testid="grade-save">Save</Button>
      </div>
      {rows.length === 0 && <EmptyState title="No outcomes yet">Add one row for each main finding you will rate.</EmptyState>}
      {rows.map((r, i) => {
        const calc = calculatedCertainty(r);
        return (
          <Card key={r.id} className="space-y-3 p-4" >
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <div><Label htmlFor={`g-o-${r.id}`}>Outcome</Label><Input id={`g-o-${r.id}`} value={r.outcome} placeholder="e.g. Disparity in diagnostic accuracy by race/ethnicity" onChange={(e) => set(r.id, { outcome: e.target.value })} /></div>
              <div><Label htmlFor={`g-n-${r.id}`}>Studies</Label><Input id={`g-n-${r.id}`} value={r.studies} placeholder="e.g. 12 studies" onChange={(e) => set(r.id, { studies: e.target.value })} /></div>
              <div><Label htmlFor={`g-d-${r.id}`}>Design</Label><Input id={`g-d-${r.id}`} value={r.design} placeholder="e.g. Evaluation studies" onChange={(e) => set(r.id, { design: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <Label htmlFor={`g-s-${r.id}`}>Starts at</Label>
                <Select id={`g-s-${r.id}`} value={r.start} onChange={(e) => set(r.id, { start: e.target.value as GradeRow['start'] })}><option>High</option><option>Low</option></Select>
              </div>
              {DOMAINS.map((d) => (
                <div key={d.key}>
                  <Label htmlFor={`g-${d.key}-${r.id}`}>{d.label}</Label>
                  <Select id={`g-${d.key}-${r.id}`} value={r[d.key]} onChange={(e) => set(r.id, { [d.key]: e.target.value } as Partial<GradeRow>)}>{DOMAIN_OPTIONS.map((o) => <option key={o}>{o}</option>)}</Select>
                </div>
              ))}
              <div>
                <Label htmlFor={`g-pb-${r.id}`}>Publication bias</Label>
                <Select id={`g-pb-${r.id}`} value={r.publication_bias} onChange={(e) => set(r.id, { publication_bias: e.target.value })}>{PUB_OPTIONS.map((o) => <option key={o}>{o}</option>)}</Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <div><Label htmlFor={`g-e-${r.id}`}>Summary of findings</Label><Textarea id={`g-e-${r.id}`} rows={2} value={r.effect} onChange={(e) => set(r.id, { effect: e.target.value })} /></div>
              <div>
                <Label htmlFor={`g-u-${r.id}`} hint="Large effect, dose–response">Upgrade levels</Label>
                <Select id={`g-u-${r.id}`} value={String(r.upgrade)} onChange={(e) => set(r.id, { upgrade: Number(e.target.value) })}><option value="0">None</option><option value="1">+1</option><option value="2">+2</option></Select>
              </div>
              <div>
                <Label htmlFor={`g-c-${r.id}`} hint={`Calculated: ${calc}`}>Certainty</Label>
                <Select id={`g-c-${r.id}`} value={r.override} onChange={(e) => set(r.id, { override: e.target.value as Level | '' })}>
                  <option value="">{calc} (calculated)</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l} (your judgement)</option>)}
                </Select>
              </div>
            </div>
            <div><Label htmlFor={`g-cm-${r.id}`}>Comments (reasons for downgrading or overriding)</Label><Textarea id={`g-cm-${r.id}`} rows={2} value={r.comments} onChange={(e) => set(r.id, { comments: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">Certainty: <strong data-testid="grade-certainty">{certaintyOf(r)}</strong></span>
              <Button size="sm" variant="ghost" onClick={() => { setRows(rows.filter((x) => x.id !== r.id)); setDirty(true); }}>Remove outcome {i + 1}</Button>
            </div>
          </Card>
        );
      })}
      <Button variant="secondary" onClick={() => { setRows([...rows, blankRow(crypto.randomUUID())]); setDirty(true); }} data-testid="grade-add">+ Add outcome</Button>
    </div>
  );
}

export function SynthesisPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const settings = useSettings(projectId);
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'evidence';
  const progress = useQuery({ queryKey: xk.progress(projectId), queryFn: () => getProgress(projectId) });
  const finals = useQuery({ queryKey: xk.all(projectId), queryFn: () => getAll(projectId) });
  const rob = useQuery({ queryKey: xk.progress(projectId, 'rob'), queryFn: () => getProgress(projectId, 'rob') });
  const ids = (progress.data ?? []).filter((p) => p.has_final).map((p) => p.reference_id);
  const details = useQuery({ queryKey: ['synthesis-details', projectId, ids.join()], queryFn: () => studyDetails(ids), enabled: !!progress.data });
  const form = readForm(settings.data);

  const studies = useMemo<SynthesisStudy[]>(() => {
    if (!progress.data || !finals.data || !details.data) return [];
    const det = new Map(details.data.map((d) => [d.id, d]));
    const robBy = new Map((rob.data ?? []).map((r) => [r.reference_id, r.final_overall]));
    return progress.data.filter((p) => p.has_final).flatMap((p) => {
      const f = finals.data!.finals.find((x) => x.reference_id === p.reference_id);
      const d = det.get(p.reference_id);
      return f ? [{ seq: p.seq, label: studyLabel(d?.authors ?? p.authors, d?.year ?? p.year), title: p.title, data: f.data, rob: robBy.get(p.reference_id) ?? null }] : [];
    });
  }, [progress.data, finals.data, details.data, rob.data]);

  if (!project.data || !settings.data || !progress.data || !finals.data) return <PageLoader />;
  const title = project.data.title;
  const fields = form ? fieldsWithRob(form as ExtractionForm, (rob.data ?? []).some((r) => r.has_final)) : [];
  const needsData = tab !== 'grade' && (!form || studies.length === 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Synthesis</h1>
        <p className="text-sm text-slate-600">Tables for your results chapter, built from the agreed extractions and risk-of-bias judgements. They update as you finalise more studies.</p>
      </div>
      <div role="tablist" aria-label="Synthesis sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams(t.key === 'evidence' ? {} : { tab: t.key }, { replace: true })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.key ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>{t.label}</button>
        ))}
      </div>
      {needsData ? (
        <EmptyState title="No agreed extractions yet" action={<Link className="underline" to={`/p/${projectId}/extraction`}>Go to data extraction</Link>}>
          Tables appear once studies have a final, agreed extraction.
        </EmptyState>
      ) : (
        <>
          {tab !== 'grade' && studies.length < progress.data.length && (
            <Alert kind="info">{studies.length} of {progress.data.length} included studies have an agreed extraction so far; the tables show those {studies.length}.</Alert>
          )}
          {tab === 'evidence' && <EvidenceTab title={title} fields={fields} studies={studies} />}
          {tab === 'crosstab' && <CrossTabTab title={title} fields={fields} studies={studies} />}
          {tab === 'grade' && <GradeTab key={JSON.stringify(readGrade(settings.data))} projectId={projectId} title={title} initial={readGrade(settings.data)} />}
        </>
      )}
    </div>
  );
}
