import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAiDisclosure, listDecisions, listSources, mk, saveProspero, CATEGORY_LABEL } from '../lib/api/methods';
import {
  amendments, amendmentText, answerFor, day, prosperoFields, prosperoSaved, prosperoToText,
  type ProsperoField, type ProsperoSaved,
} from '../lib/methods/prospero';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { qk, useProject, useSettings, useStats } from '../lib/hooks';
import { Alert, Button, Card, cx, Input, Label, Spinner, Stat, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

const BADGE: Record<string, { text: string; cls: string }> = {
  auto: { text: 'From your project', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  check: { text: 'Check this', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  missing: { text: 'Needs you', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  edited: { text: 'Your text', cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
};

async function copyText(text: string, toast: ReturnType<typeof useToast>) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it manually', { kind: 'error' }); }
}

function FieldCard({ f, value, status, edited, onChange, onReset }: {
  f: ProsperoField; value: string; status: string; edited: boolean; onChange: (v: string) => void; onReset: () => void;
}) {
  const toast = useToast();
  const b = BADGE[status];
  return (
    <Card className="space-y-2 p-4" as="div">
      <div className="flex flex-wrap items-start gap-2" data-testid="prospero-field" data-key={f.key}>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-ink-900">{f.label}</h4>
          <p className="text-xs text-slate-500">{f.asks}</p>
        </div>
        <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1', b.cls)} data-testid="prospero-status">{b.text}</span>
      </div>
      {!edited && f.note && <p className="text-xs text-slate-600">{f.note}</p>}
      <Textarea aria-label={f.label} rows={Math.min(12, Math.max(3, value.split('\n').length + 1))} value={value}
        placeholder="Write your answer here" onChange={(e) => onChange(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={!value.trim()} onClick={() => copyText(value, toast)}>Copy</Button>
        {edited && f.draft && <Button size="sm" variant="ghost" onClick={onReset}>Use ScreenLab’s draft</Button>}
      </div>
    </Card>
  );
}

export function ProsperoTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(projectId);
  const stats = useStats(projectId);
  const settings = useSettings(projectId);
  const sources = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  const decisions = useQuery({ queryKey: mk.decisions(projectId), queryFn: () => listDecisions(projectId) });
  const ai = useQuery({ queryKey: mk.ai(projectId), queryFn: () => getAiDisclosure(projectId) });
  const [saved, setSaved] = useState<ProsperoSaved | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<Set<string> | null>(null);

  useEffect(() => { if (settings.data && !saved) setSaved(prosperoSaved(settings.data)); }, [settings.data, saved]);

  const fields = useMemo(() => (project.data && stats.data && sources.data && decisions.data && settings.data
    ? prosperoFields({
      project: project.data, stats: stats.data, sources: sources.data, decisions: decisions.data,
      ai: ai.data ?? null, screeningMode: settings.data.screening_mode,
    })
    : null), [project.data, stats.data, sources.data, decisions.data, settings.data, ai.data]);

  const changes = useMemo(() => (decisions.data && saved ? amendments(decisions.data, saved.registered_on) : []), [decisions.data, saved]);
  // Screening-process notes (e.g. re-checks) are rarely protocol changes, so they start unticked.
  useEffect(() => { if (decisions.data && !skip) setSkip(new Set(decisions.data.filter((d) => d.category === 'process').map((d) => d.id))); }, [decisions.data, skip]);

  if (!fields || !saved || !skip || !project.data) return <div className="p-6"><Spinner /></div>;

  const isEdited = (f: ProsperoField) => f.key in saved.answers;
  const status = (f: ProsperoField) => (isEdited(f) ? (saved.answers[f.key].trim() ? 'edited' : 'missing') : f.status);
  const counts = { ready: 0, check: 0, missing: 0 };
  for (const f of fields) {
    const s = status(f);
    if (s === 'missing') counts.missing++; else if (s === 'check') counts.check++; else counts.ready++;
  }
  const update = (patch: Partial<ProsperoSaved>) => { setSaved({ ...saved, ...patch }); setDirty(true); };
  const setAnswer = (f: ProsperoField, v: string) => {
    const answers = { ...saved.answers };
    if (v === f.draft) delete answers[f.key]; else answers[f.key] = v;
    update({ answers });
  };
  const save = async () => {
    setBusy(true);
    try {
      await saveProspero(projectId, saved);
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      setDirty(false);
      toast('Saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const title = project.data.title;
  const selected = changes.filter((d) => !skip.has(d.id));
  const sections = [...new Set(fields.map((f) => f.section))];

  return (
    <div className="space-y-4" data-testid="prospero">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink-900">PROSPERO registration helper</h2>
          <p className="text-sm text-slate-600">
            A draft answer for each field of the PROSPERO form, built from your protocol, search log and decision log.
            Edit anything, then copy each answer into PROSPERO. ScreenLab does not submit anything for you.
          </p>
        </div>
        <Button variant="secondary" onClick={() => downloadText(`${safeFileName(title)}_PROSPERO_draft.txt`, prosperoToText(title, fields, saved), 'text/plain')}
          data-testid="prospero-download">Download all</Button>
        <Link to={`/p/${projectId}/methods/search-strategy`} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 hover:bg-slate-50" data-testid="search-strategy-pdf">Search strategy PDF</Link>
        <Link to={`/p/${projectId}/methods/protocol`} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-900 hover:bg-slate-50" data-testid="protocol-pdf">Protocol PDF</Link>
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty} data-testid="prospero-save">Save</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Ready" value={counts.ready} tone="include" />
        <Stat label="Check" value={counts.check} tone="maybe" />
        <Stat label="Need you" value={counts.missing} tone="exclude" />
      </div>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink-900">Registration</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pr-id" hint="e.g. CRD420261234567">PROSPERO ID</Label>
            <Input id="pr-id" value={saved.registration_id} onChange={(e) => update({ registration_id: e.target.value.trim() })} />
          </div>
          <div>
            <Label htmlFor="pr-date" hint="Decisions from this date on are listed as possible amendments">Date submitted or registered</Label>
            <Input id="pr-date" type="date" value={saved.registered_on ?? ''} onChange={(e) => update({ registered_on: e.target.value || null })} />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4" >
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-ink-900">Changes since registration</h3>
          <Button size="sm" variant="secondary" disabled={!selected.length} onClick={() => copyText(amendmentText(selected), toast)}>Copy amendment text</Button>
        </div>
        {!saved.registered_on && (
          <Alert kind="info">Add the date you submitted to PROSPERO above. Until then every decision in your log is listed.</Alert>
        )}
        {changes.length === 0 ? (
          <p className="text-sm text-slate-600">No decisions in your log{saved.registered_on ? ` since ${day(saved.registered_on)}` : ''}.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              PROSPERO expects the record to be amended when eligibility criteria or methods change. Tick the decisions that changed your protocol.
            </p>
            <ul className="space-y-2" data-testid="prospero-amendments">
              {changes.map((d) => (
                <li key={d.id} className="flex gap-2 text-sm">
                  <input type="checkbox" className="mt-1" id={`am-${d.id}`} checked={!skip.has(d.id)}
                    onChange={(e) => { const s = new Set(skip); if (e.target.checked) s.delete(d.id); else s.add(d.id); setSkip(s); }} />
                  <label htmlFor={`am-${d.id}`} className="min-w-0">
                    <span className="font-medium text-ink-900">{day(d.decided_on)}: {d.title}</span>
                    <span className="text-slate-500"> · {CATEGORY_LABEL[d.category]}</span>
                    {d.detail && <span className="block text-slate-600">{d.detail}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {sections.map((s) => (
        <section key={s} className="space-y-3">
          <h3 className="pt-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{s}</h3>
          {fields.filter((f) => f.section === s).map((f) => (
            <FieldCard key={f.key} f={f} value={answerFor(f, saved)} status={status(f)} edited={isEdited(f)}
              onChange={(v) => setAnswer(f, v)}
              onReset={() => { const answers = { ...saved.answers }; delete answers[f.key]; update({ answers }); }} />
          ))}
        </section>
      ))}

      {dirty && (
        <div className="sticky bottom-3 flex justify-end">
          <Button variant="primary" onClick={save} loading={busy} className="shadow-lg">Save changes</Button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Field names follow the PROSPERO form and may be worded slightly differently there. Drafts are suggestions:
        check every answer against your actual protocol before submitting.
      </p>
    </div>
  );
}
