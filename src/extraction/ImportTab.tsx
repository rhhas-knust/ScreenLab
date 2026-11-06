import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAll, importPool, saveExtraction, saveFinal, saveForm, xk, type ProgressRow } from '../lib/api/extraction';
import { fillEmpty, MODULES, studyLabel, type ExtractionData, type ExtractionForm, type ModuleKind } from '../lib/extraction/form';
import {
  buildRows, detectLayout, guessRole, newFields, parseRole, readSheetFile, ROLE_LABEL, roleValue, toTable, type Layout, type Role, type Sheet,
} from '../lib/extraction/importSheet';
import { useAuth } from '../auth/AuthProvider';
import { qk } from '../lib/hooks';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Card, Select, Spinner, cx } from '../components/ui';

type Target = 'complete' | 'draft' | 'final';
type Existing = 'fill' | 'replace';

/** Bring in extractions or appraisals done in Excel or another tool. Shows everything before saving. */
export function ImportTab({ kind = 'extraction', projectId, form, progress }: {
  kind?: ModuleKind; projectId: string; form: ExtractionForm | null; progress: ProgressRow[];
}) {
  const M = MODULES[kind];
  const qc = useQueryClient();
  const { user } = useAuth();
  const [file, setFile] = useState<{ name: string; sheets: Sheet[] } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [layout, setLayout] = useState<Layout>('studies');
  const [roles, setRoles] = useState<Role[]>([]);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [target, setTarget] = useState<Target>('complete');
  const [existing, setExisting] = useState<Existing>('fill');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ saved: number; skipped: number; fields: number } | null>(null);

  const included = useMemo(() => new Set(progress.map((p) => p.reference_id)), [progress]);
  const pool = useQuery({ queryKey: ['import-pool', projectId, [...included].sort().join()], queryFn: () => importPool(projectId, included), enabled: !!file });
  const bySeq = useMemo(() => new Map((pool.data ?? []).map((p) => [p.id, p])), [pool.data]);

  const sheet = file?.sheets[sheetIdx];
  const table = useMemo(() => (sheet ? toTable(sheet.rows, layout) : null), [sheet, layout]);
  const added = useMemo(() => (table ? newFields(table, roles, form) : []), [table, roles, form]);
  const fullForm: ExtractionForm = useMemo(() => ({ ...(form ?? {}), fields: [...(form?.fields ?? []), ...added] }), [form, added]);
  const rows = useMemo(() => (table && pool.data ? buildRows(table, roles, form ?? { fields: [] }, pool.data, added) : []), [table, roles, form, pool.data, added]);

  const choose = (sheets: Sheet[], idx: number, lay?: Layout) => {
    const s = sheets[idx];
    const l = lay ?? detectLayout(s.rows, form);
    setSheetIdx(idx);
    setLayout(l);
    setRoles(toTable(s.rows, l).headers.map((h) => guessRole(h, form)));
    setPicks({});
    setResult(null);
  };
  const onFile = async (f: File | undefined) => {
    setError(null);
    setResult(null);
    if (!f) return;
    try {
      const sheets = readSheetFile(f.name, await f.arrayBuffer()).filter((s) => s.rows.length > 1);
      if (!sheets.length) throw new Error('The file has no rows to import.');
      setFile({ name: f.name, sheets });
      choose(sheets, 0);
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Which paper each row goes to: the reviewer's own pick, else the automatic match.
  const targetOf = (i: number) => (i in picks ? picks[i] || null : rows[i]?.match.refId ?? null);
  const status = (i: number): { ok: boolean; text: string } => {
    const r = rows[i];
    const id = targetOf(i);
    if (!id) return { ok: false, text: i in picks ? 'Skipped' : r.match.how };
    if (!included.has(id)) return { ok: false, text: `Found #${bySeq.get(id)?.seq ?? '?'}, but it is not included at full text, so it is not on the ${M.noun} list` };
    if (!Object.keys(r.data).length) return { ok: false, text: 'No answers in this row' };
    return { ok: true, text: i in picks ? 'Chosen by you' : `Matched by ${r.match.how}` };
  };
  const ready = rows.map((_, i) => i).filter((i) => status(i).ok);
  const dupTargets = new Set(ready.map(targetOf).filter((id, k, a) => a.indexOf(id) !== k));
  const mappedFields = roles.filter((r) => r.kind === 'field' || r.kind === 'new').length;

  const run = async () => {
    if (!user) return;
    setBusy({ done: 0, total: ready.length });
    setError(null);
    try {
      if (added.length) {
        await saveForm(projectId, { ...fullForm, name: form?.name ?? `Imported from ${file!.name}` }, kind);
        await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      }
      const all = await getAll(projectId, kind);
      const mineRows = new Map(all.extractions.filter((e) => e.reviewer_id === user.id).map((e) => [e.reference_id, e]));
      const mine = new Map([...mineRows].map(([k, e]) => [k, e.data]));
      const finals = new Map(all.finals.map((f) => [f.reference_id, f.data]));
      let saved = 0;
      const seen = new Set<string>();
      for (const i of ready) {
        const id = targetOf(i)!;
        if (seen.has(id)) continue;
        seen.add(id);
        const before = (target === 'final' ? finals : mine).get(id);
        const data: ExtractionData = before
          ? existing === 'fill' ? fillEmpty(fullForm, before, rows[i].data).data : { ...before, ...rows[i].data }
          : rows[i].data;
        if (target === 'final') await saveFinal(projectId, id, data, kind);
        // Importing never turns a completed extraction back into a draft.
        else await saveExtraction(projectId, id, data, mineRows.get(id)?.status === 'complete' ? 'complete' : target, kind);
        saved++;
        setBusy({ done: saved, total: ready.length });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: xk.progress(projectId, kind) }), qc.invalidateQueries({ queryKey: xk.all(projectId, kind) }), qc.invalidateQueries({ queryKey: ['extraction', kind, 'ref'] })]);
      setResult({ saved, skipped: rows.length - saved, fields: added.length });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="import-tab">
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Import {M.noun}s from Excel or CSV</h2>
          <p className="text-sm text-slate-600">
            For {M.noun}s done outside ScreenLab. Either layout works: one study per row with headings across the top, or fields down the side with one
            column per study (as in ScreenLab’s own CSV). Studies are matched to your included papers by DOI, PMID, title, ScreenLab ID or first author and year.
            You see every match before anything is saved.
          </p>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">File (.xlsx, .csv or .tsv)</span>
          <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.xls" data-testid="import-file"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink-900 file:px-3 file:py-1.5 file:text-white" />
        </label>
        {error && <Alert>{error}</Alert>}
        {file && (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            {file.sheets.length > 1 && (
              <label>
                <span className="mb-1 block font-medium text-slate-800">Sheet</span>
                <Select value={sheetIdx} onChange={(e) => choose(file.sheets, Number(e.target.value))} data-testid="import-sheet">
                  {file.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </Select>
              </label>
            )}
            <label>
              <span className="mb-1 block font-medium text-slate-800">Layout</span>
              <Select value={layout} onChange={(e) => choose(file.sheets, sheetIdx, e.target.value as Layout)} data-testid="import-layout">
                <option value="studies">One study per row, headings across the top</option>
                <option value="fields">Fields down the side, one column per study</option>
              </Select>
            </label>
          </div>
        )}
      </Card>

      {file && table && (
        <Card className="space-y-2 p-4">
          <h3 className="font-semibold text-ink-900">1. What each {layout === 'studies' ? 'column' : 'row'} holds</h3>
          <p className="text-sm text-slate-600">
            Checked automatically against your form. Change any that are wrong. {layout === 'studies' ? 'Columns' : 'Rows'} that are not in your form can be added to it as new fields, or ignored.
          </p>
          {!form && <Alert kind="info">You have no {M.noun} form yet. The columns you keep become the form; you can change field types later on the Form tab.</Alert>}
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2">In your file</th><th className="px-3 py-2">Example</th><th className="px-3 py-2">Import as</th></tr></thead>
              <tbody>
                {table.headers.map((h, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-ink-900">{h || <span className="text-slate-400">(no heading)</span>}</td>
                    <td className="max-w-56 truncate px-3 py-1.5 text-slate-600" title={table.records.find((r) => r[i])?.[i]}>{table.records.find((r) => r[i])?.[i] ?? ''}</td>
                    <td className="px-3 py-1.5">
                      <Select aria-label={`Import “${h}” as`} className="py-1 text-xs" value={roleValue(roles[i] ?? { kind: 'ignore' })} data-testid={`import-map-${i}`}
                        onChange={(e) => setRoles((rs) => rs.map((r, k) => (k === i ? parseRole(e.target.value) : r)))}>
                        <option value="ignore">{ROLE_LABEL.ignore}</option>
                        <optgroup label="Identifies the study">
                          {(['study', 'id', 'doi', 'pmid', 'title', 'authors', 'year'] as const).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
                        </optgroup>
                        <optgroup label={`Your ${M.noun} form`}>
                          {(form?.fields ?? []).map((f) => <option key={f.key} value={`field:${f.key}`}>{f.label}</option>)}
                          <option value="new">{ROLE_LABEL.new}</option>
                        </optgroup>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {file && table && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold text-ink-900">2. Which paper each study is</h3>
          {pool.isLoading ? <Spinner label="Matching studies…" /> : pool.error ? <Alert>{friendlyError(pool.error)}</Alert> : (
            <>
              <p className="text-sm text-slate-600" data-testid="import-summary">
                {ready.length} of {rows.length} studies ready to import{mappedFields ? `, ${mappedFields} field${mappedFields === 1 ? '' : 's'} each` : ''}.
                {rows.length > ready.length && ' Pick the paper for any that were not matched, or leave them out.'}
              </p>
              {!mappedFields && <Alert kind="warning">No column is set to a form field yet, so there is nothing to import.</Alert>}
              <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
                {rows.map((r, i) => {
                  const st = status(i);
                  const id = targetOf(i);
                  return (
                    <li key={i} className="space-y-1 px-3 py-2 text-sm" data-testid="import-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', st.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>{st.ok ? '✓ Ready' : 'Not imported'}</span>
                        <span className="font-medium text-ink-900">{r.label}</span>
                        <Select aria-label={`Paper for ${r.label}`} className="ml-auto max-w-md py-1 text-xs" value={id ?? ''}
                          onChange={(e) => setPicks((p) => ({ ...p, [i]: e.target.value }))}>
                          <option value="">Leave out</option>
                          {progress.map((p) => <option key={p.reference_id} value={p.reference_id}>#{p.seq} {studyLabel(p.authors, p.year)}: {(p.title ?? '').slice(0, 70)}</option>)}
                        </Select>
                      </div>
                      <p className="text-xs text-slate-600">
                        {st.text}{id && bySeq.get(id) ? ` → #${bySeq.get(id)!.seq} ${bySeq.get(id)!.title ?? ''}` : ''}
                        {id && dupTargets.has(id) && st.ok ? ' · another row also goes to this paper; only the first is imported' : ''}
                      </p>
                      {r.warnings.length > 0 && <p className="text-xs text-amber-800">⚠ {r.warnings.join(' · ')}</p>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      )}

      {file && table && pool.data && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold text-ink-900">3. Save</h3>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <label>
              <span className="mb-1 block font-medium text-slate-800">Save as</span>
              <Select value={target} onChange={(e) => setTarget(e.target.value as Target)} data-testid="import-target">
                <option value="complete">My {M.noun}: complete</option>
                <option value="draft">My {M.noun}: draft, to check each one first</option>
                <option value="final">The agreed final {M.noun}</option>
              </Select>
            </label>
            <label>
              <span className="mb-1 block font-medium text-slate-800">Where there are already answers</span>
              <Select value={existing} onChange={(e) => setExisting(e.target.value as Existing)} data-testid="import-existing">
                <option value="fill">Keep them; only fill empty fields</option>
                <option value="replace">Replace them with the file’s answers</option>
              </Select>
            </label>
          </div>
          <p className="text-xs text-slate-600">
            {target === 'final'
              ? `Use this only if the file holds the version both reviewers agreed. It does not change either reviewer’s own ${M.noun}.`
              : `Saved under your name, as your own ${M.noun}. Import only work you did yourself; a co-reviewer imports theirs from their own account, so the two stay independent for comparison.`}
            {added.length > 0 && ` ${added.length} new field${added.length === 1 ? ' is' : 's are'} added to the form: ${added.map((f) => f.label).join(', ')}.`}
          </p>
          {busy ? (
            <Spinner label={`Saving ${busy.done} of ${busy.total}…`} />
          ) : (
            <Button onClick={() => void run()} disabled={!ready.length || !mappedFields} data-testid="import-go">
              Import {ready.length} {ready.length === 1 ? 'study' : 'studies'}
            </Button>
          )}
          {result && (
            <Alert kind="success">
              <span data-testid="import-done">
                Imported {result.saved} {result.saved === 1 ? 'study' : 'studies'}{result.skipped ? `; ${result.skipped} left out` : ''}
                {result.fields ? `; ${result.fields} field${result.fields === 1 ? '' : 's'} added to the form` : ''}.{' '}
              </span>
              <Link className="underline" to={`/p/${projectId}/${M.path}`}>Open the studies</Link>
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
