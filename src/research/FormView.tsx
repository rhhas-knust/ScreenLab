import { useState } from 'react';
import type { AnswerValue, PublicForm } from '../lib/api/research';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Input, Textarea, cx } from '../components/ui';

type Field = PublicForm['fields'][number];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isEmpty(v: AnswerValue | undefined) {
  return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
}

function validate(f: Field, v: AnswerValue | undefined): string | null {
  if (isEmpty(v)) return f.required ? 'This question is required.' : null;
  if (f.type === 'email' && !EMAIL_RE.test(String(v).trim())) return 'Please enter a valid email address.';
  if (f.type === 'number' && !/^\s*-?\d+(\.\d+)?\s*$/.test(String(v))) return 'Please enter a number.';
  return null;
}

/** Renders a questionnaire for respondents (also used as the builder's preview). */
export function FormView({ form, preview = false, onSubmit }: {
  form: PublicForm;
  preview?: boolean;
  onSubmit?: (answers: Record<string, AnswerValue>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (id: string, v: AnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    if (errors[id]) setErrors((e) => ({ ...e, [id]: '' }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of form.fields) {
      const msg = validate(f, answers[f.id]);
      if (msg) errs[f.id] = msg;
    }
    setErrors(errs);
    const first = form.fields.find((f) => errs[f.id]);
    if (first) {
      document.getElementById(`field-${first.id}`)?.focus();
      return;
    }
    if (preview || !onSubmit) return;
    const payload: Record<string, AnswerValue> = {};
    for (const f of form.fields) {
      const v = answers[f.id];
      if (isEmpty(v)) continue;
      payload[f.id] = f.type === 'number' ? Number(String(v).trim()) : typeof v === 'string' ? v.trim() : v;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit(payload);
      setDone(true);
      window.scrollTo(0, 0);
    } catch (err) {
      setServerError(friendlyError(err, 'Your response could not be submitted. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status">
        <p className="text-3xl" aria-hidden="true">✓</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-900">Thank you!</h2>
        <p className="mt-2 whitespace-pre-wrap text-slate-700">{form.thank_you_message || 'Your response has been recorded.'}</p>
        <Button className="mt-5" onClick={() => { setAnswers({}); setDone(false); }}>Submit another response</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {form.fields.length === 0 && <p className="text-sm text-slate-500">This questionnaire has no questions yet.</p>}
      {form.fields.map((f, i) => {
        const err = errors[f.id];
        const labelId = `label-${f.id}`;
        const describedBy = [f.help ? `help-${f.id}` : '', err ? `err-${f.id}` : ''].filter(Boolean).join(' ') || undefined;
        const v = answers[f.id];
        return (
          <fieldset key={f.id} className={cx('rounded-xl border bg-white p-4 shadow-sm', err ? 'border-rose-400' : 'border-slate-200')} aria-labelledby={labelId} aria-describedby={describedBy} data-testid="rh-form-question">
            <legend className="sr-only">{f.label}</legend>
            <div id={labelId} className="font-medium text-ink-900">
              <span className="text-slate-500 tabular-nums">{i + 1}. </span>{f.label}
              {f.required && <span className="text-rose-700" aria-label="required"> *</span>}
            </div>
            {f.help && <p id={`help-${f.id}`} className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{f.help}</p>}
            <div className="mt-3">
              {(f.type === 'text' || f.type === 'email' || f.type === 'number') && (
                <Input id={`field-${f.id}`} aria-labelledby={labelId} aria-invalid={!!err}
                  type={f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'number' ? 'decimal' : f.type === 'email' ? 'email' : undefined}
                  value={(v as string) ?? ''} onChange={(e) => set(f.id, e.target.value)} maxLength={1000} />
              )}
              {f.type === 'textarea' && (
                <Textarea id={`field-${f.id}`} aria-labelledby={labelId} aria-invalid={!!err} rows={4}
                  value={(v as string) ?? ''} onChange={(e) => set(f.id, e.target.value)} maxLength={10000} />
              )}
              {f.type === 'radio' && (
                <div className="space-y-1.5" role="radiogroup" aria-labelledby={labelId}>
                  {f.options.map((o, oi) => (
                    <label key={o} className="flex cursor-pointer items-center gap-3 rounded-md py-1.5 text-base sm:text-sm">
                      <input id={oi === 0 ? `field-${f.id}` : undefined} type="radio" name={f.id} className="h-5 w-5 shrink-0" checked={v === o} onChange={() => set(f.id, o)} /> {o}
                    </label>
                  ))}
                </div>
              )}
              {f.type === 'checkbox' && (
                <div className="space-y-1.5">
                  {f.options.map((o, oi) => {
                    const list = (v as string[] | undefined) ?? [];
                    return (
                      <label key={o} className="flex cursor-pointer items-center gap-3 rounded-md py-1.5 text-base sm:text-sm">
                        <input id={oi === 0 ? `field-${f.id}` : undefined} type="checkbox" className="h-5 w-5 shrink-0" checked={list.includes(o)}
                          onChange={(e) => set(f.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}
                      </label>
                    );
                  })}
                </div>
              )}
              {f.type === 'scale' && (
                <div className="flex gap-2" role="radiogroup" aria-labelledby={labelId}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className={cx('flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold',
                      v === n ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                      <input id={n === 1 ? `field-${f.id}` : undefined} type="radio" name={f.id} className="sr-only" checked={v === n} onChange={() => set(f.id, n)} />
                      {n}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {err && <p id={`err-${f.id}`} className="mt-2 text-sm text-rose-700" role="alert">{err}</p>}
          </fieldset>
        );
      })}
      {serverError && <Alert>{serverError}</Alert>}
      {form.fields.length > 0 && (
        <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={preview} className="w-full sm:w-auto">
          {preview ? 'Submit (disabled in preview)' : 'Submit'}
        </Button>
      )}
    </form>
  );
}
