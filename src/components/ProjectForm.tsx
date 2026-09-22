import { useState, type FormEvent } from 'react';
import type { Project, ReviewType } from '../lib/types';
import { REVIEW_TYPE_LABELS } from '../lib/types';
import { Alert, Button, Field, Input, Select, Textarea } from './ui';
import type { ProjectInput } from '../lib/api/projects';

type FormState = Record<
  'title' | 'description' | 'research_question' | 'review_type' | 'inclusion_criteria' | 'exclusion_criteria' | 'population'
  | 'intervention_or_exposure' | 'comparator' | 'outcomes' | 'study_design' | 'date_range' | 'language' | 'start_date', string
>;

export function ProjectForm({
  initial, submitLabel, onSubmit, onCancel,
}: {
  initial?: Partial<Project>; submitLabel: string; onSubmit: (v: ProjectInput) => Promise<void>; onCancel?: () => void;
}) {
  const [v, setV] = useState<FormState>({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    research_question: initial?.research_question ?? '',
    review_type: initial?.review_type ?? 'systematic',
    inclusion_criteria: initial?.inclusion_criteria ?? '',
    exclusion_criteria: initial?.exclusion_criteria ?? '',
    population: initial?.population ?? '',
    intervention_or_exposure: initial?.intervention_or_exposure ?? '',
    comparator: initial?.comparator ?? '',
    outcomes: initial?.outcomes ?? '',
    study_design: initial?.study_design ?? '',
    date_range: initial?.date_range ?? '',
    language: initial?.language ?? '',
    start_date: initial?.start_date ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return setError('Please give the review a title.');
    setBusy(true);
    setError(null);
    try {
      const out: ProjectInput = { title: v.title.trim() };
      for (const [k, val] of Object.entries(v)) {
        if (k === 'title') continue;
        (out as Record<string, unknown>)[k] = val.trim() === '' ? null : val.trim();
      }
      out.review_type = v.review_type as ReviewType;
      await onSubmit(out);
    } catch (err) {
      setError((err as Error).message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <Field id="title" label="Review title">
        <Input id="title" required maxLength={500} value={v.title} onChange={set('title')} placeholder="e.g. Machine Learning for Hospital-Acquired Infection Detection" />
      </Field>
      <Field id="rq" label="Research question">
        <Textarea id="rq" rows={2} value={v.research_question} onChange={set('research_question')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="type" label="Review type">
          <Select id="type" value={v.review_type} onChange={set('review_type')}>
            {Object.entries(REVIEW_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field id="start" label="Start date" hint="(optional)">
          <Input id="start" type="date" value={v.start_date} onChange={set('start_date')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="inc" label="Inclusion criteria">
          <Textarea id="inc" rows={5} value={v.inclusion_criteria} onChange={set('inclusion_criteria')} placeholder="One criterion per line" />
        </Field>
        <Field id="exc" label="Exclusion criteria">
          <Textarea id="exc" rows={5} value={v.exclusion_criteria} onChange={set('exclusion_criteria')} placeholder="One criterion per line" />
        </Field>
      </div>
      <details className="rounded-lg border border-slate-200 p-3" open={Boolean(initial?.population || initial?.outcomes)}>
        <summary className="cursor-pointer text-sm font-medium text-ink-900">Optional: PICO / PECO, study designs, date range, language, description</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="pop" label="Population"><Textarea id="pop" rows={2} value={v.population} onChange={set('population')} /></Field>
          <Field id="int" label="Intervention / Exposure"><Textarea id="int" rows={2} value={v.intervention_or_exposure} onChange={set('intervention_or_exposure')} /></Field>
          <Field id="comp" label="Comparator"><Textarea id="comp" rows={2} value={v.comparator} onChange={set('comparator')} /></Field>
          <Field id="out" label="Outcomes"><Textarea id="out" rows={2} value={v.outcomes} onChange={set('outcomes')} /></Field>
          <Field id="sd" label="Study designs"><Textarea id="sd" rows={2} value={v.study_design} onChange={set('study_design')} /></Field>
          <div className="space-y-4">
            <Field id="dr" label="Date range"><Input id="dr" value={v.date_range} onChange={set('date_range')} placeholder="e.g. 2015 – 2025" /></Field>
            <Field id="lang" label="Language"><Input id="lang" value={v.language} onChange={set('language')} placeholder="e.g. English" /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="desc" label="Description / notes"><Textarea id="desc" rows={2} value={v.description} onChange={set('description')} /></Field>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
