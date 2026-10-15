import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UNIVERSITIES, deleteRhProject, getRhProject, hasOptions, listFields, listResponses, rk, saveFields, updateRhProject,
  type RhField, type RhProject,
} from '../lib/api/research';
import { conditionProblems } from '../lib/research/logic';
import { fmtDate } from '../lib/hooks';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Card, Input, Label, PageLoader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { FieldEditor } from './FieldEditor';
import { FormView } from './FormView';
import { SharePanel } from './SharePanel';
import { StatusBadge } from './StatusBadge';
import { TranslationsEditor } from './TranslationsEditor';

type Details = Pick<RhProject, 'title' | 'description' | 'university' | 'department' | 'year' | 'thank_you_message'
  | 'consent_text' | 'closes_at' | 'max_responses' | 'one_per_device' | 'translations'>;

const newField = (projectId: string): RhField => ({
  id: crypto.randomUUID(), project_id: projectId, label: '', help: null, type: 'text', options: [], required: false, field_order: 0, settings: {},
});

/** ISO timestamp <-> the value of an <input type="datetime-local"> (local time). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function problems(d: Details, fields: RhField[]): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push('The questionnaire needs a title.');
  fields.forEach((f, i) => {
    if (!f.label.trim()) out.push(`Question ${i + 1} has no text.`);
    if (hasOptions(f.type) && f.options.length < (f.type === 'ranking' ? 2 : 1)) out.push(`Question ${i + 1} needs at least ${f.type === 'ranking' ? 'two options' : 'one option'}.`);
    if (f.type === 'grid' && !(f.settings?.rows ?? []).some((r) => r.trim())) out.push(`Question ${i + 1} needs at least one statement.`);
  });
  out.push(...conditionProblems(fields));
  if (d.max_responses != null && (!Number.isInteger(d.max_responses) || d.max_responses < 1)) out.push('The response limit must be a whole number of 1 or more.');
  return out;
}

export function FormBuilderPage() {
  const { formId = '' } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const pq = useQuery({ queryKey: rk.project(formId), queryFn: () => getRhProject(formId), retry: 1 });
  const fq = useQuery({ queryKey: rk.fields(formId), queryFn: () => listFields(formId) });
  const rq = useQuery({ queryKey: rk.responses(formId), queryFn: () => listResponses(formId) });
  const [details, setDetails] = useState<Details | null>(null);
  const [fields, setFields] = useState<RhField[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (pq.data && !dirty) {
      const p = pq.data;
      setDetails({
        title: p.title, description: p.description, university: p.university, department: p.department, year: p.year, thank_you_message: p.thank_you_message,
        consent_text: p.consent_text ?? null, closes_at: p.closes_at ?? null, max_responses: p.max_responses ?? null,
        one_per_device: p.one_per_device ?? false, translations: p.translations ?? {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pq.data]);
  useEffect(() => {
    if (fq.data && !dirty) setFields(fq.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fq.data]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (pq.error) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-xl font-semibold text-ink-900">Questionnaire not found</h1>
        <p className="mt-2 text-sm text-slate-600">It does not exist, was deleted, or belongs to another account.</p>
        <Link to="/research" className="mt-4 inline-block font-medium underline">Back to ResearchHub</Link>
      </div>
    );
  }
  if (!pq.data || !details || !fields) return <PageLoader />;
  const project = pq.data;
  const responseCount = rq.data?.length ?? 0;
  const autoClosed = project.status === 'active' && !dirty
    ? (project.closes_at && new Date(project.closes_at) <= new Date() ? `The deadline (${fmtDate(project.closes_at)}) has passed` : null)
      ?? (project.max_responses && responseCount >= project.max_responses ? `The response limit (${project.max_responses}) has been reached` : null)
    : null;

  const editDetails = (patch: Partial<Details>) => { setDetails({ ...details, ...patch }); setDirty(true); };
  const editFields = (next: RhField[]) => { setFields(next); setDirty(true); };
  const patchField = (i: number, patch: Partial<RhField>) => editFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    editFields(next);
  };

  const save = async (status?: RhProject['status']): Promise<boolean> => {
    const errs = problems(details, fields);
    if (status === 'active' && !fields.length) errs.push('Add at least one question before publishing.');
    setErrors(errs);
    if (errs.length) return false;
    setSaving(true);
    try {
      const patch: Partial<RhProject> = {
        title: details.title.trim(), description: details.description?.trim() || null, university: details.university || null,
        department: details.department?.trim() || null, year: details.year?.trim() || null, thank_you_message: details.thank_you_message?.trim() || null,
        consent_text: details.consent_text?.trim() || null, closes_at: details.closes_at, max_responses: details.max_responses,
        one_per_device: details.one_per_device, translations: details.translations,
      };
      if (status) patch.status = status;
      if (status === 'active' && !project.published_at) patch.published_at = new Date().toISOString();
      await saveFields(formId, fields);
      await updateRhProject(formId, patch);
      setDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: rk.project(formId) }),
        qc.invalidateQueries({ queryKey: rk.fields(formId) }),
        qc.invalidateQueries({ queryKey: rk.list }),
      ]);
      toast(status === 'active' ? 'Published — share the link below' : status === 'closed' ? 'Questionnaire closed' : 'Saved');
      return true;
    } catch (e) {
      setErrors([friendlyError(e, 'Could not save.')]);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const extra = responseCount ? ` and its ${responseCount} response${responseCount === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete “${project.title}”${extra}? This cannot be undone.`)) return;
    try {
      await deleteRhProject(formId);
      setDirty(false);
      await qc.invalidateQueries({ queryKey: rk.list });
      nav('/research');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/research" className="text-sm text-slate-600 hover:underline">← ResearchHub</Link>
        <span className="flex-1" />
        <StatusBadge status={project.status} />
        <Link to={`/research/${formId}/responses`} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          Responses ({responseCount})
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-ink-900">{project.title}</h1>

      {project.status !== 'draft' && <SharePanel project={project} />}
      {autoClosed && <Alert kind="info">{autoClosed}, so the form is no longer taking responses. Change the closing rules below and save to reopen it.</Alert>}
      {responseCount > 0 && <Alert kind="info">This questionnaire has {responseCount} response{responseCount === 1 ? '' : 's'}. Editing questions now may make earlier and later answers inconsistent.</Alert>}

      <div className="flex gap-2" role="tablist">
        <Button variant={preview ? 'secondary' : 'primary'} size="sm" onClick={() => setPreview(false)} aria-pressed={!preview}>Edit</Button>
        <Button variant={preview ? 'primary' : 'secondary'} size="sm" onClick={() => setPreview(true)} aria-pressed={preview}>Preview</Button>
      </div>

      {preview ? (
        <div className="rounded-xl bg-slate-50 p-3 sm:p-6">
          <FormView preview form={{
            id: formId, status: project.status, university: details.university, department: details.department, thank_you_message: details.thank_you_message,
            title: details.title, description: details.description, consent_text: details.consent_text, closes_at: details.closes_at,
            one_per_device: details.one_per_device, translations: details.translations, closed_reason: null, fields: fields.filter((f) => f.label.trim()),
          }} />
        </div>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">Details</h2>
            <div>
              <Label htmlFor="rh-title">Title</Label>
              <Input id="rh-title" value={details.title} onChange={(e) => editDetails({ title: e.target.value })} maxLength={300} />
            </div>
            <div>
              <Label htmlFor="rh-desc" hint="(shown at the top of the form — purpose, consent, time needed)">Introduction</Label>
              <Textarea id="rh-desc" rows={3} value={details.description ?? ''} onChange={(e) => editDetails({ description: e.target.value })} maxLength={5000} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="rh-uni">University</Label>
                <Select id="rh-uni" value={details.university ?? ''} onChange={(e) => editDetails({ university: e.target.value })}>
                  <option value="">—</option>
                  {UNIVERSITIES.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="rh-dept">Department</Label>
                <Input id="rh-dept" value={details.department ?? ''} onChange={(e) => editDetails({ department: e.target.value })} maxLength={200} />
              </div>
              <div>
                <Label htmlFor="rh-year">Year</Label>
                <Input id="rh-year" value={details.year ?? ''} onChange={(e) => editDetails({ year: e.target.value })} placeholder="e.g. 2026" maxLength={50} />
              </div>
            </div>
            <div>
              <Label htmlFor="rh-thanks" hint="(optional)">Thank-you message</Label>
              <Input id="rh-thanks" value={details.thank_you_message ?? ''} onChange={(e) => editDetails({ thank_you_message: e.target.value })} placeholder="Your response has been recorded." maxLength={2000} />
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">Information sheet and consent</h2>
            <div>
              <Label htmlFor="rh-consent" hint="(optional — when filled in, respondents must agree before they see the questions)">Participant information</Label>
              <Textarea id="rh-consent" rows={5} value={details.consent_text ?? ''} onChange={(e) => editDetails({ consent_text: e.target.value })} maxLength={20000}
                placeholder={'Purpose of the study, what taking part involves, how long it takes, risks and benefits, how answers are kept confidential, that taking part is voluntary and they can stop at any time, and who to contact (researcher and ethics committee).'} />
            </div>
            <p className="text-xs text-slate-500">Respondents see this text with “I agree, continue” and “I do not agree”. The time they agreed is saved with each response.</p>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">Closing rules</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rh-closes" hint="(optional)">Stop taking responses at</Label>
                <Input id="rh-closes" type="datetime-local" value={toLocalInput(details.closes_at)} onChange={(e) => editDetails({ closes_at: fromLocalInput(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="rh-max" hint="(optional)">Stop after this many responses</Label>
                <Input id="rh-max" type="number" min={1} inputMode="numeric" value={details.max_responses ?? ''}
                  onChange={(e) => editDetails({ max_responses: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 200" />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={details.one_per_device} onChange={(e) => editDetails({ one_per_device: e.target.checked })} />
              <span>
                One response per device
                <span className="block text-xs text-slate-500">Stops the same phone or browser from submitting twice. Someone could still answer again from another device or a private window, so treat it as a deterrent, not proof of identity.</span>
              </span>
            </label>
          </Card>

          <TranslationsEditor value={details.translations} onChange={(t) => editDetails({ translations: t })} fields={fields}
            base={{ title: details.title, description: details.description, consent_text: details.consent_text, thank_you_message: details.thank_you_message }} />

          <section className="space-y-3" aria-label="Questions">
            <h2 className="font-semibold text-ink-900">Questions ({fields.length})</h2>
            {fields.length === 0 && <p className="text-sm text-slate-500">No questions yet — add your first question below.</p>}
            {fields.map((f, i) => (
              <FieldEditor key={f.id} field={f} index={i} count={fields.length} earlier={fields.slice(0, i)} hasResponses={responseCount > 0}
                onChange={(p) => patchField(i, p)} onMove={(d) => move(i, d)}
                onRemove={() => editFields(fields.filter((_, j) => j !== i))}
                onDuplicate={() => editFields([...fields.slice(0, i + 1), { ...f, id: crypto.randomUUID(), settings: { ...f.settings } }, ...fields.slice(i + 1)])} />
            ))}
            <Button onClick={() => editFields([...fields, newField(formId)])}>+ Add question</Button>
          </section>

          <div className="border-t border-slate-200 pt-4">
            <Button variant="ghost" className="text-rose-700" onClick={remove}>Delete questionnaire</Button>
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          {errors.length > 0 && <Alert className="w-full">{errors.map((e) => <div key={e}>{e}</div>)}</Alert>}
          <span className="text-sm text-slate-600" role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <span className="flex-1" />
          <Button onClick={() => save()} loading={saving} disabled={!dirty}>Save</Button>
          {project.status === 'draft' && <Button variant="primary" onClick={() => save('active')} loading={saving}>Publish</Button>}
          {project.status === 'active' && <Button onClick={() => save('closed')} loading={saving}>Close responses</Button>}
          {project.status === 'closed' && <Button variant="primary" onClick={() => save('active')} loading={saving}>Reopen</Button>}
        </div>
      </div>
    </div>
  );
}
