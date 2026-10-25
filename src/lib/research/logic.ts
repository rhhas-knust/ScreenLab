// Respondent-side rules for a ResearchHub form: validation, skip logic and
// translations. Pure functions so the builder preview, the public form and the
// tests all behave the same. The server (rh_submit_response) applies the same
// rules again, so nothing here is trusted on its own.
import { isUpload, scaleRange, type AnswerValue, type PublicForm, type RhField, type ShowIf, type Translation } from '../api/research';

export type FormField = PublicForm['fields'][number];
/** A question ready to display: option/row text in the chosen language, values always in the original language. */
export interface LocalField extends FormField {
  optionLabels: string[];
  rowLabels: string[];
  minLabel: string;
  maxLabel: string;
}
export interface LocalForm extends Omit<PublicForm, 'fields'> {
  fields: LocalField[];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmpty(v: AnswerValue | undefined): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '1900-01-01' && s <= '2200-12-31';
}

/** Error message for one answer, or null when it is acceptable. */
export function validate(f: FormField, v: AnswerValue | undefined): string | null {
  const rows = f.settings?.rows ?? [];
  if (f.type === 'grid' && f.required && !isEmpty(v)) {
    const got = v as Record<string, string>;
    if (rows.some((r) => !got[r])) return 'Please answer every row.';
  }
  if (isEmpty(v)) return f.required ? (f.type === 'grid' ? 'Please answer every row.' : f.type === 'ranking' ? 'Please put the options in order.' : 'This question is required.') : null;
  if (f.type === 'email' && !EMAIL_RE.test(String(v).trim())) return 'Please enter a valid email address.';
  if (f.type === 'number' && !/^\s*-?\d+(\.\d+)?\s*$/.test(String(v))) return 'Please enter a number.';
  if (f.type === 'date' && !isRealDate(String(v))) return 'Please enter a real date.';
  if (f.type === 'scale') {
    const { min, max } = scaleRange(f.settings);
    if (typeof v !== 'number' || v < min || v > max) return `Please choose ${min} to ${max}.`;
  }
  return null;
}

export function conditionMet(c: ShowIf | null | undefined, answers: Record<string, AnswerValue>): boolean {
  if (!c?.field) return true;
  const dep = answers[c.field];
  if (isEmpty(dep)) return false;
  if (c.op === 'answered') return true;
  const hit = Array.isArray(dep) ? dep.includes(c.value ?? '') : typeof dep === 'object' ? false : String(dep) === (c.value ?? '');
  return c.op === 'not_equals' ? !hit : hit;
}

/**
 * The questions to show, in order. A question depending on a hidden question
 * is hidden too, because a hidden question's answer does not count.
 */
export function visibleFields<F extends FormField>(fields: F[], answers: Record<string, AnswerValue>): F[] {
  const counted: Record<string, AnswerValue> = {};
  const out: F[] = [];
  for (const f of fields) {
    if (!conditionMet(f.settings?.show_if, counted)) continue;
    out.push(f);
    if (answers[f.id] !== undefined) counted[f.id] = answers[f.id];
  }
  return out;
}

/**
 * Answers to send: only visible questions, trimmed, numbers as numbers.
 * Scores are never sent (they are worked out from the answers), and files are
 * added by the page once uploaded.
 */
export function buildPayload(fields: FormField[], answers: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const payload: Record<string, AnswerValue> = {};
  for (const f of visibleFields(fields, answers)) {
    const v = answers[f.id];
    if (isEmpty(v) || f.type === 'calc' || isUpload(f.type)) continue;
    payload[f.id] = f.type === 'number' ? Number(String(v).trim()) : typeof v === 'string' ? v.trim() : v;
  }
  return payload;
}

const pick = (t: string | undefined, base: string) => (t && t.trim() ? t : base);
const pickList = (t: string[] | undefined, base: string[]) => base.map((b, i) => pick(t?.[i], b));

/** The form in another language. Unknown or missing language → the original. */
export function localize(form: PublicForm, code: string | null): LocalForm {
  const t: Translation | undefined = code ? form.translations?.items?.find((x) => x.code === code) : undefined;
  return {
    ...form,
    title: pick(t?.title, form.title),
    description: form.description ? pick(t?.description, form.description) : form.description,
    consent_text: form.consent_text ? pick(t?.consent_text, form.consent_text) : form.consent_text,
    thank_you_message: form.thank_you_message ? pick(t?.thank_you_message, form.thank_you_message) : form.thank_you_message,
    fields: form.fields.map((f) => {
      const ft = t?.fields?.[f.id];
      return {
        ...f,
        settings: f.settings ?? {},
        label: pick(ft?.label, f.label),
        help: f.help ? pick(ft?.help, f.help) : f.help,
        optionLabels: pickList(ft?.options, f.options),
        rowLabels: pickList(ft?.rows, f.settings?.rows ?? []),
        minLabel: pick(ft?.min_label, f.settings?.min_label ?? ''),
        maxLabel: pick(ft?.max_label, f.settings?.max_label ?? ''),
      };
    }),
  };
}

/** Builder checks for skip logic: each condition must point at an earlier, usable question. */
export function conditionProblems(fields: RhField[]): string[] {
  const out: string[] = [];
  fields.forEach((f, i) => {
    const c = f.settings?.show_if;
    if (!c?.field) return;
    const j = fields.findIndex((x) => x.id === c.field);
    if (j < 0) out.push(`Question ${i + 1} depends on a question that was deleted. Change or remove its condition.`);
    else if (j >= i) out.push(`Question ${i + 1} depends on question ${j + 1}, which comes after it. Move it, or change the condition.`);
    else if (c.op !== 'answered' && !c.value?.trim()) out.push(`Question ${i + 1}: choose the answer its condition looks for.`);
  });
  return out;
}

/** "Shown only if Q2 is “Yes”" — plain-language description of a condition. */
export function describeCondition(c: ShowIf, fields: Pick<RhField, 'id' | 'label'>[]): string {
  const j = fields.findIndex((x) => x.id === c.field);
  const q = j < 0 ? 'a deleted question' : `Q${j + 1}`;
  if (c.op === 'answered') return `Shown only if ${q} is answered`;
  return `Shown only if ${q} ${c.op === 'not_equals' ? 'is not' : 'is'} “${c.value ?? ''}”`;
}

/** The thank-you-and-goodbye message when this answer falls in a quota group that is already full. */
export function quotaMessage(f: FormField, v: AnswerValue | undefined, full: PublicForm['full_quotas']): string | null {
  if (!full?.length || isEmpty(v)) return null;
  const hit = full.find((q) => q.field === f.id && (Array.isArray(v) ? v.includes(q.value) : typeof v !== 'object' && String(v) === q.value));
  if (!hit) return null;
  return hit.message?.trim() || `Thank you for your interest. We already have all the responses we need from people who answered “${hit.value}”.`;
}
