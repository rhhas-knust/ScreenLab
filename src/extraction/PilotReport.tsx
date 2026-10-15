import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAll, getProgress, listTeam, studyDetails, xk } from '../lib/api/extraction';
import { saveSettingsKey } from '../lib/api/methods';
import { MODULES, readForm, studyLabel, type ModuleKind } from '../lib/extraction/form';
import { buildPilot, type PilotInput } from '../lib/extraction/pilot';
import { wordDoc } from '../lib/synthesis/tables';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmtDate, qk, useProject, useSettings } from '../lib/hooks';
import { Alert, Button, cx, PageLoader, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const th = 'border border-slate-400 bg-slate-100 px-2 py-1 text-left align-top font-semibold';
const td = 'border border-slate-400 px-2 py-1 align-top whitespace-pre-line';

/** Printable pilot report (Save as PDF from the browser) with a Word download. */
export function PilotReport() {
  const { projectId = '' } = useParams();
  const [params] = useSearchParams();
  const kind: ModuleKind = params.get('kind') === 'rob' ? 'rob' : 'extraction';
  const M = MODULES[kind];
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(projectId);
  const settings = useSettings(projectId);
  const progress = useQuery({ queryKey: xk.progress(projectId, kind), queryFn: () => getProgress(projectId, kind) });
  const all = useQuery({ queryKey: xk.all(projectId, kind), queryFn: () => getAll(projectId, kind) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const doneIds = [...new Set((all.data?.extractions ?? []).filter((e) => e.status === 'complete').map((e) => e.reference_id))];
  const details = useQuery({ queryKey: ['pilot-details', projectId, kind, doneIds.join()], queryFn: () => studyDetails(doneIds), enabled: !!all.data });
  const savedNotes = ((settings.data?.settings?.pilot_notes ?? {}) as Record<string, string>)[kind] ?? '';
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (settings.data && notes === null) setNotes(savedNotes); }, [settings.data, savedNotes, notes]);
  useEffect(() => {
    if (project.data) document.title = `${project.data.title} — pilot ${M.noun} report`;
    return () => { document.title = 'ScreenLab'; };
  }, [project.data, M.noun]);

  const form = readForm(settings.data, kind);
  if (!project.data || !settings.data || !progress.data || !all.data || !details.data || !team.data || notes === null) return <PageLoader label="Preparing pilot report…" />;
  if (!form) return <div className="p-6"><Alert>No {M.noun} form has been set up yet.</Alert></div>;

  const email = (id: string) => team.data.find((t) => t.user_id === id)?.email ?? 'Former team member';
  const inProject = new Set(progress.data.map((p) => p.reference_id));
  const det = new Map(details.data.map((d) => [d.id, d]));
  const finals = new Map(all.data.finals.map((f) => [f.reference_id, f.data]));
  const input: PilotInput[] = doneIds.filter((id) => inProject.has(id) && det.has(id)).map((id) => {
    const d = det.get(id)!;
    return {
      seq: d.seq, label: studyLabel(d.authors, d.year), title: d.title, final: finals.get(id) ?? null,
      entries: all.data.extractions.filter((e) => e.reference_id === id && e.status === 'complete').map((e) => ({ reviewer: email(e.reviewer_id), data: e.data })),
    };
  });
  const pilot = buildPilot(form, input);
  const ag = pilot.agreement;
  const title = `Pilot ${M.noun} report`;
  const date = fmtDate(new Date().toISOString(), false);

  const saveNotes = async () => {
    setBusy(true);
    try {
      const prev = (settings.data!.settings?.pilot_notes ?? {}) as Record<string, string>;
      await saveSettingsKey(projectId, 'pilot_notes', { ...prev, [kind]: notes });
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      toast('Notes saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const word = () => downloadText(`${safeFileName(project.data!.title)}_pilot_${kind === 'rob' ? 'risk_of_bias' : 'extraction'}_report.doc`, wordDoc(`${title}: ${project.data!.title}`, [
    {
      heading: 'Summary', head: ['Item', 'Result'],
      rows: [
        ['Date', date], ['Reviewers', pilot.reviewers.join('; ')], ['Studies piloted', pilot.studies.map((s) => `${s.label} (#${s.seq})`).join('; ')],
        ['Studies completed by two reviewers', String(ag.studies)], ['Overall agreement', `${pct(ag.agreedCells, ag.cells)} (${ag.agreedCells} of ${ag.cells} answers)`],
        ['Fields with most disagreement', pilot.hardest.slice(0, 5).map((f) => `${f.label} (${pct(f.agreed, f.compared)})`).join('; ') || 'None'],
      ],
    },
    { heading: 'Agreement by field', head: ['Field', 'Compared', 'Agreed', "Cohen's kappa"], rows: ag.fields.map((f) => [f.label, String(f.compared), `${f.agreed} (${pct(f.agreed, f.compared)})`, f.kappa == null ? '–' : f.kappa.toFixed(2)]) },
    ...pilot.studies.map((s) => ({
      heading: `${s.label} (#${s.seq}): ${s.differences} difference${s.differences === 1 ? '' : 's'}`,
      head: ['Field', ...s.entries.map((e) => e.reviewer), 'Agreed final', 'Differs'],
      rows: s.rows.map((r) => [r.label, ...r.values, r.final || (s.final ? '' : 'Not yet agreed'), r.differ ? 'Yes' : '']),
    })),
    { heading: 'Notes and changes to the form', head: ['Notes'], rows: [[notes || '—']] },
  ]), 'application/msword');

  return (
    <div className="min-h-full bg-slate-100 print:bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
        <Link to={`/p/${projectId}/${M.path}?tab=agreement`} className="text-sm text-slate-600 hover:underline">← Back to {M.title}</Link>
        <span className="flex-1" />
        <Button variant="secondary" onClick={word} data-testid="pilot-word">Word</Button>
        <Button variant="primary" onClick={() => window.print()}>Save as PDF</Button>
      </div>
      <main className="mx-auto max-w-4xl space-y-5 bg-white p-6 text-[0.95rem] leading-relaxed text-slate-900 sm:my-4 sm:rounded-xl sm:p-10 print:my-0 print:max-w-none print:p-0" data-testid="pilot-report">
        <header className="space-y-1 border-b border-slate-300 pb-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
          <h1 className="text-2xl font-semibold">{project.data.title}</h1>
          <p className="text-sm text-slate-600">{date} · Reviewers: {pilot.reviewers.join(', ') || '—'}</p>
        </header>

        {pilot.studies.length === 0 ? (
          <Alert kind="info">No completed {M.noun}s yet. The report fills in as reviewers mark studies complete.</Alert>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Summary</h2>
              <ul className="list-disc space-y-0.5 pl-6" data-testid="pilot-summary">
                <li>Studies piloted: {pilot.studies.map((s) => `${s.label} (#${s.seq})`).join('; ')}.</li>
                <li>Completed by two reviewers: {ag.studies} of {pilot.studies.length}.</li>
                <li>Overall agreement before discussion: <strong>{pct(ag.agreedCells, ag.cells)}</strong> ({ag.agreedCells} of {ag.cells} answers).</li>
                <li>Fields with most disagreement: {pilot.hardest.length ? pilot.hardest.slice(0, 5).map((f) => `${f.label} (${pct(f.agreed, f.compared)})`).join('; ') : 'none'}.</li>
              </ul>
              {ag.studies < pilot.studies.length && <p className="text-sm text-amber-800 print:hidden">Some studies have only one reviewer's {M.noun} so far; agreement uses the double-completed ones only.</p>}
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Agreement by field</h2>
              <table className="w-full border-collapse text-sm">
                <thead><tr><th className={th}>Field</th><th className={th}>Compared</th><th className={th}>Agreed</th><th className={th}>Cohen’s κ</th></tr></thead>
                <tbody>{ag.fields.map((f) => (
                  <tr key={f.key} className="break-inside-avoid"><td className={td}>{f.label}</td><td className={td}>{f.compared}</td><td className={td}>{f.agreed} ({pct(f.agreed, f.compared)})</td><td className={td}>{f.kappa == null ? '–' : f.kappa.toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            </section>

            {pilot.studies.map((s) => (
              <section key={s.seq} className="space-y-2" data-testid="pilot-study">
                <h2 className="text-lg font-semibold">{s.label} <span className="font-normal text-slate-500">#{s.seq}</span></h2>
                <p className="text-sm text-slate-600">{s.title} · {s.differences} field{s.differences === 1 ? '' : 's'} differ · {s.final ? 'final version agreed' : 'final version not yet agreed'}</p>
                <table className="w-full border-collapse text-sm">
                  <thead><tr><th className={cx(th, 'w-44')}>Field</th>{s.entries.map((e, i) => <th key={i} className={th}>{e.reviewer}</th>)}<th className={th}>Agreed final</th></tr></thead>
                  <tbody>{s.rows.map((r) => (
                    <tr key={r.key} className={cx('break-inside-avoid', r.differ && 'bg-amber-50')}>
                      <td className={cx(td, 'font-medium')}>{r.label}{r.differ && <span className="ml-1 text-xs font-semibold text-amber-800">differs</span>}</td>
                      {r.values.map((v, i) => <td key={i} className={td}>{v || <span className="text-slate-400">blank</span>}</td>)}
                      <td className={td}>{r.final || <span className="text-slate-400">{s.final ? 'blank' : 'not yet agreed'}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            ))}
          </>
        )}

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Notes and changes to the form</h2>
          <div className="print:hidden">
            <Textarea aria-label="Pilot notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. We clarified 'LLMs tested' to include the version and access date; 'Other factors tested alongside' was often left blank, so we added guidance." />
            <Button className="mt-2" variant="secondary" onClick={saveNotes} loading={busy} disabled={notes === savedNotes} data-testid="pilot-notes-save">Save notes</Button>
          </div>
          <p className="hidden whitespace-pre-line print:block">{notes || '—'}</p>
        </section>
      </main>
    </div>
  );
}
