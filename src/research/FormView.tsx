import { useMemo, useState } from 'react';
import { scaleRange, type AnswerValue, type PublicForm, type SubmitMeta } from '../lib/api/research';
import { buildPayload, localize, validate, visibleFields, type LocalField } from '../lib/research/logic';
import { friendlyError } from '../lib/errors';
import { fmtDate } from '../lib/hooks';
import { Alert, Button, Input, Textarea, cx } from '../components/ui';

const CLOSED_TEXT: Record<string, string> = {
  closed: 'This questionnaire is closed and no longer accepts responses. Thank you for your interest.',
  deadline: 'The deadline for this questionnaire has passed, so it no longer accepts responses. Thank you for your interest.',
  full: 'This questionnaire has received all the responses it needs. Thank you for your interest.',
};

/**
 * A questionnaire as respondents see it: header, language choice, information
 * sheet and consent, then the questions (with skip logic). Also the builder's preview.
 */
export function FormView({ form, preview = false, alreadyDone = false, onSubmit }: {
  form: PublicForm;
  preview?: boolean;
  /** This device has already responded to a one-response-per-device form. */
  alreadyDone?: boolean;
  onSubmit?: (answers: Record<string, AnswerValue>, meta: SubmitMeta) => Promise<void>;
}) {
  const langs = form.translations?.items ?? [];
  const [lang, setLang] = useState<string | null>(null);
  const [consent, setConsent] = useState<'pending' | 'agreed' | 'declined'>('pending');
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const local = useMemo(() => localize(form, lang), [form, lang]);
  const shown = visibleFields(local.fields, answers);
  const closed = form.closed_reason ?? (form.status === 'closed' ? 'closed' : null);
  const needsConsent = !!form.consent_text?.trim();

  const set = (id: string, v: AnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    if (errors[id]) setErrors((e) => ({ ...e, [id]: '' }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of shown) {
      const msg = validate(f, answers[f.id]);
      if (msg) errs[f.id] = msg;
    }
    setErrors(errs);
    const first = shown.find((f) => errs[f.id]);
    if (first) {
      document.getElementById(`field-${first.id}`)?.focus();
      return;
    }
    if (preview || !onSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit(buildPayload(form.fields, answers), { consent: needsConsent ? consent === 'agreed' : undefined, language: lang });
      setDone(true);
      window.scrollTo(0, 0);
    } catch (err) {
      setServerError(friendlyError(err, 'Your response could not be submitted. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <header className="mb-5 rounded-xl border-t-8 border-t-ink-800 bg-white p-5 shadow-sm">
      {langs.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Language">
          {[{ code: null as string | null, name: form.translations?.base_name || 'Original' }, ...langs].map((l) => (
            <button key={l.code ?? 'base'} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
              className={cx('rounded-full border px-3 py-1 text-sm', lang === l.code ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {l.name}
            </button>
          ))}
        </div>
      )}
      <h1 className="text-2xl font-semibold text-ink-900">{local.title}</h1>
      {(form.university || form.department) && <p className="mt-1 text-sm text-slate-500">{[form.department, form.university].filter(Boolean).join(' · ')}</p>}
      {local.description && <p className="mt-3 whitespace-pre-wrap text-slate-700">{local.description}</p>}
      {form.closes_at && !closed && <p className="mt-3 text-xs text-slate-500">Open until {fmtDate(form.closes_at)}</p>}
      {!closed && consent !== 'pending' && shown.some((x) => x.required) && <p className="mt-3 text-xs text-rose-700">* Required</p>}
    </header>
  );

  let body: React.ReactNode;
  if (closed && !preview) {
    body = <Alert kind="info">{CLOSED_TEXT[closed] ?? CLOSED_TEXT.closed}</Alert>;
  } else if ((alreadyDone && !preview) || done) {
    body = (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status">
        <p className="text-3xl" aria-hidden="true">✓</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-900">Thank you!</h2>
        <p className="mt-2 whitespace-pre-wrap text-slate-700">
          {done ? local.thank_you_message || 'Your response has been recorded.' : 'A response has already been submitted from this device.'}
        </p>
        {done && !form.one_per_device && <Button className="mt-5" onClick={() => { setAnswers({}); setDone(false); }}>Submit another response</Button>}
      </div>
    );
  } else if (needsConsent && consent === 'declined') {
    body = (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status" data-testid="rh-declined">
        <h2 className="text-lg font-semibold text-ink-900">You have chosen not to take part</h2>
        <p className="mt-2 text-slate-700">No answers have been recorded. You can close this page.</p>
        <Button className="mt-4" variant="ghost" onClick={() => setConsent('pending')}>Go back to the information sheet</Button>
      </div>
    );
  } else if (needsConsent && consent === 'pending') {
    body = (
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="rh-consent-h" data-testid="rh-consent">
        <h2 id="rh-consent-h" className="text-lg font-semibold text-ink-900">Information and consent</h2>
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{local.consent_text}</div>
        <p className="text-sm text-slate-700">Taking part is voluntary. By choosing “I agree” you confirm you have read the information above and agree to take part.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setConsent('agreed')}>I agree, continue</Button>
          <Button variant="secondary" onClick={() => setConsent('declined')}>I do not agree</Button>
        </div>
      </section>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate className="space-y-4">
        {shown.length === 0 && <p className="text-sm text-slate-500">This questionnaire has no questions yet.</p>}
        {shown.map((f, i) => (
          <Question key={f.id} f={f} n={i + 1} value={answers[f.id]} error={errors[f.id]} onChange={(v) => set(f.id, v)} />
        ))}
        {serverError && <Alert>{serverError}</Alert>}
        {shown.length > 0 && (
          <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={preview} className="w-full sm:w-auto">
            {preview ? 'Submit (disabled in preview)' : 'Submit'}
          </Button>
        )}
      </form>
    );
  }

  return <>{header}{body}</>;
}

function Question({ f, n, value: v, error: err, onChange: set }: {
  f: LocalField;
  n: number;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (v: AnswerValue) => void;
}) {
  const labelId = `label-${f.id}`;
  const describedBy = [f.help ? `help-${f.id}` : '', err ? `err-${f.id}` : ''].filter(Boolean).join(' ') || undefined;
  const optionLabel = (o: string) => f.optionLabels[f.options.indexOf(o)] ?? o;
  return (
    <fieldset className={cx('rounded-xl border bg-white p-4 shadow-sm', err ? 'border-rose-400' : 'border-slate-200')} aria-labelledby={labelId} aria-describedby={describedBy} data-testid="rh-form-question">
      <legend className="sr-only">{f.label}</legend>
      <div id={labelId} className="font-medium text-ink-900">
        <span className="text-slate-500 tabular-nums">{n}. </span>{f.label}
        {f.required && <span className="text-rose-700" aria-label="required"> *</span>}
      </div>
      {f.help && <p id={`help-${f.id}`} className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{f.help}</p>}
      <div className="mt-3">
        {(f.type === 'text' || f.type === 'email' || f.type === 'number') && (
          <Input id={`field-${f.id}`} aria-labelledby={labelId} aria-invalid={!!err}
            type={f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'number' ? 'decimal' : f.type === 'email' ? 'email' : undefined}
            value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} maxLength={1000} />
        )}
        {f.type === 'date' && (
          <Input id={`field-${f.id}`} aria-labelledby={labelId} aria-invalid={!!err} type="date" className="w-auto"
            value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} />
        )}
        {f.type === 'textarea' && (
          <Textarea id={`field-${f.id}`} aria-labelledby={labelId} aria-invalid={!!err} rows={4}
            value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} maxLength={10000} />
        )}
        {f.type === 'radio' && (
          <div className="space-y-1.5" role="radiogroup" aria-labelledby={labelId}>
            {f.options.map((o, oi) => (
              <label key={o} className="flex cursor-pointer items-center gap-3 rounded-md py-1.5 text-base sm:text-sm">
                <input id={oi === 0 ? `field-${f.id}` : undefined} type="radio" name={f.id} className="h-5 w-5 shrink-0" checked={v === o} onChange={() => set(o)} /> {optionLabel(o)}
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
                    onChange={(e) => set(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {optionLabel(o)}
                </label>
              );
            })}
          </div>
        )}
        {f.type === 'scale' && <ScaleInput f={f} v={v} set={set} labelId={labelId} />}
        {f.type === 'grid' && (
          <div className="space-y-3" data-testid="rh-grid">
            {(f.settings?.rows ?? []).map((row, ri) => {
              const cur = (v as Record<string, string> | undefined) ?? {};
              const rowId = `${f.id}-r${ri}`;
              return (
                <div key={row} role="radiogroup" aria-labelledby={rowId} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                  <p id={rowId} className="text-sm text-slate-800">{f.rowLabels[ri] ?? row}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {f.options.map((o, oi) => (
                      <label key={o} className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-sm', cur[row] === o ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                        <input id={ri === 0 && oi === 0 ? `field-${f.id}` : undefined} type="radio" name={rowId} className="sr-only" checked={cur[row] === o}
                          onChange={() => set({ ...cur, [row]: o })} />
                        {optionLabel(o)}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {f.type === 'ranking' && <RankingInput f={f} v={v as string[] | undefined} set={set} optionLabel={optionLabel} />}
      </div>
      {err && <p id={`err-${f.id}`} className="mt-2 text-sm text-rose-700" role="alert">{err}</p>}
    </fieldset>
  );
}

function ScaleInput({ f, v, set, labelId }: { f: LocalField; v: AnswerValue | undefined; set: (v: AnswerValue) => void; labelId: string }) {
  const { points } = scaleRange(f.settings);
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 2.75rem))` }} role="radiogroup" aria-labelledby={labelId}>
        {points.map((n, i) => (
          <label key={n} className={cx('flex h-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold',
            v === n ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50')}>
            <input id={i === 0 ? `field-${f.id}` : undefined} type="radio" name={f.id} className="sr-only" checked={v === n} onChange={() => set(n)}
              aria-label={i === 0 && f.minLabel ? `${n} (${f.minLabel})` : i === points.length - 1 && f.maxLabel ? `${n} (${f.maxLabel})` : undefined} />
            {n}
          </label>
        ))}
      </div>
      {(f.minLabel || f.maxLabel) && (
        <div className="mt-1 flex justify-between gap-4 text-xs text-slate-600" style={{ maxWidth: `${points.length * 3.1}rem` }}>
          <span>{f.minLabel}</span><span className="text-right">{f.maxLabel}</span>
        </div>
      )}
    </div>
  );
}

function RankingInput({ f, v, set, optionLabel }: { f: LocalField; v: string[] | undefined; set: (v: AnswerValue) => void; optionLabel: (o: string) => string }) {
  const order = v && v.length === f.options.length ? v : f.options;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };
  return (
    <div data-testid="rh-ranking">
      <p className="mb-2 text-xs text-slate-600">Use the arrows to put the options in order, most important first.</p>
      <ol className="space-y-1.5">
        {order.map((o, i) => (
          <li key={o} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm">
            <span className="w-5 text-right font-semibold text-slate-500 tabular-nums">{i + 1}.</span>
            <span className="flex-1">{optionLabel(o)}</span>
            <Button id={i === 0 ? `field-${f.id}` : undefined} size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${optionLabel(o)} up`}>↑</Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${optionLabel(o)} down`}>↓</Button>
          </li>
        ))}
      </ol>
      {!v && <Button className="mt-2" size="sm" variant="secondary" onClick={() => set([...order])}>This order is right</Button>}
      {v && <p className="mt-2 text-xs text-emerald-700">Order recorded.</p>}
    </div>
  );
}
