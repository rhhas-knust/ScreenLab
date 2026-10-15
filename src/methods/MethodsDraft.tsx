import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAiDisclosure, listDecisions, listSources, mk, prismaManual, saveSettingsKey } from '../lib/api/methods';
import { getAll, listTeam, xk } from '../lib/api/extraction';
import { agreement, readForm, type ExtractionData, type ExtractionForm } from '../lib/extraction/form';
import { methodsDraft, methodsText, type AgreementSummary } from '../lib/methods/methodsDraft';
import { answerFor, prosperoFields, prosperoSaved } from '../lib/methods/prospero';
import { readGrade } from '../lib/synthesis/grade';
import { wordDoc } from '../lib/synthesis/tables';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmtDate, qk, useProject, useSettings, useStats } from '../lib/hooks';
import { Alert, Button, Card, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { disclosureText } from './AiUse';

function summarise(form: ExtractionForm | null, rows: { reference_id: string; status: string; data: ExtractionData }[] | undefined): AgreementSummary | null {
  if (!form || !rows) return null;
  const byRef = new Map<string, ExtractionData[]>();
  for (const e of rows) if (e.status === 'complete') byRef.set(e.reference_id, [...(byRef.get(e.reference_id) ?? []), e.data]);
  const pairs = [...byRef.values()].filter((x) => x.length >= 2).map((x) => [x[0], x[1]] as [ExtractionData, ExtractionData]);
  const a = agreement(form, pairs);
  return { studies: a.studies, cells: a.cells, agreedCells: a.agreedCells };
}

export function MethodsDraft({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(projectId);
  const stats = useStats(projectId);
  const settings = useSettings(projectId);
  const sources = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  const decisions = useQuery({ queryKey: mk.decisions(projectId), queryFn: () => listDecisions(projectId) });
  const ai = useQuery({ queryKey: mk.ai(projectId), queryFn: () => getAiDisclosure(projectId) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const ext = useQuery({ queryKey: xk.all(projectId), queryFn: () => getAll(projectId) });
  const rob = useQuery({ queryKey: xk.all(projectId, 'rob'), queryFn: () => getAll(projectId, 'rob') });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saved = (settings.data?.settings?.methods_draft ?? null) as { text?: string; saved_at?: string } | null;
  const generated = useMemo(() => {
    if (!project.data || !stats.data || !settings.data || !sources.data || !decisions.data || !ext.data || !rob.data || ai.isLoading) return null;
    const exForm = readForm(settings.data);
    const robForm = readForm(settings.data, 'rob');
    const pros = prosperoSaved(settings.data);
    const fields = prosperoFields({ project: project.data, stats: stats.data, sources: sources.data, decisions: decisions.data, ai: ai.data ?? null, screeningMode: settings.data.screening_mode });
    const synth = fields.find((f) => f.key === 'synthesis');
    return methodsText(methodsDraft({
      project: project.data, stats: stats.data, sources: sources.data,
      duplicatesBeforeImport: prismaManual(settings.data).duplicates_before_import,
      decisions: decisions.data, reviewers: (team.data ?? []).filter((m) => m.role !== 'viewer').length,
      screeningMode: settings.data.screening_mode, registrationId: pros.registration_id,
      aiText: ai.data && ai.data.suggestions > 0 ? disclosureText(ai.data) : null,
      extractionForm: exForm, extractionAgreement: summarise(exForm, ext.data.extractions),
      robForm, robAgreement: summarise(robForm, rob.data.extractions),
      synthesisPlan: synth && pros.answers.synthesis !== undefined ? answerFor(synth, pros) : '',
      gradeOutcomes: readGrade(settings.data).length,
    }));
  }, [project.data, stats.data, settings.data, sources.data, decisions.data, ai.data, ai.isLoading, team.data, ext.data, rob.data]);

  useEffect(() => { if (text === null && generated !== null) setText(saved?.text ?? generated); }, [generated, saved, text]);
  if (generated === null || text === null) return <div className="p-6"><Spinner /></div>;

  const save = async () => {
    setBusy(true);
    try {
      await saveSettingsKey(projectId, 'methods_draft', { text, saved_at: new Date().toISOString() });
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      toast('Draft saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const base = `${safeFileName(title)}_methods_draft`;
  const paras = text.split(/\n{2,}/).map((block) => { const [h, ...rest] = block.split('\n'); return { h, body: rest.join(' ') }; });
  const placeholders = (text.match(/\[[^\]]{3,}\]/g) ?? []).length;

  return (
    <div className="space-y-3" data-testid="methods-draft">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink-900">Draft methods section</h2>
          <p className="text-sm text-slate-600">
            Written from your search log, screening numbers, AI use, extraction, risk of bias, PROSPERO answers and GRADE table, in PRISMA 2020 order.
            Edit freely; [bracketed] text marks what ScreenLab cannot know.
          </p>
        </div>
        <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it manually', { kind: 'error' }); } }}>Copy</Button>
        <Button variant="secondary" onClick={() => downloadText(`${base}.doc`, wordDoc('Methods', []).replace('</body>', paras.map((p) => `<h2 style="font-size:12pt">${p.h.replace(/</g, '&lt;')}</h2><p>${p.body.replace(/</g, '&lt;')}</p>`).join('') + '</body>'), 'application/msword')} data-testid="methods-word">Word</Button>
        <Button variant="primary" onClick={save} loading={busy} data-testid="methods-save">Save</Button>
      </div>
      {saved?.text && saved.text !== generated && (
        <Alert kind="info">
          Showing your saved draft ({fmtDate(saved.saved_at ?? null)}). The project data may have changed since.{' '}
          <button type="button" className="font-medium underline" onClick={() => { if (window.confirm('Replace your edited text with a fresh draft from the current data?')) setText(generated); }}>Rebuild from current data</button>
        </Alert>
      )}
      {placeholders > 0 && <p className="text-sm text-amber-800">{placeholders} [bracketed] gap{placeholders === 1 ? '' : 's'} to fill in.</p>}
      <Card className="p-3">
        <Textarea aria-label="Methods draft" rows={Math.min(40, text.split('\n').length + 6)} value={text} onChange={(e) => setText(e.target.value)} className="font-serif text-[0.95rem] leading-relaxed" />
      </Card>
    </div>
  );
}
