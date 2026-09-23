import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logActivity, updateSettings } from '../lib/api/projects';
import {
  EMPTY_PICO, PICO_FIELDS, PICO_KEYS, PICO_LABELS, parseTerms, picoCheck, referenceText, suggestTerms,
  type CriteriaTerms, type PicoKey, type PicoTerms,
} from '../lib/criteria';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import type { Project, ProjectSettings, Reference } from '../lib/types';
import { Alert, Button, Label, Textarea, cx } from './ui';
import { useToast } from './Toast';

/** Highlight style per PICO element (colour plus a letter, so it is never colour-only). */
export const PICO_MARK: Record<PicoKey, string> = {
  P: 'rounded bg-blue-100 px-0.5 text-inherit underline decoration-blue-700 decoration-2 underline-offset-2',
  I: 'rounded bg-violet-100 px-0.5 text-inherit underline decoration-violet-700 decoration-2 underline-offset-2',
  C: 'rounded bg-teal-100 px-0.5 text-inherit underline decoration-teal-700 decoration-2 underline-offset-2',
  O: 'rounded bg-orange-100 px-0.5 text-inherit underline decoration-orange-700 decoration-2 underline-offset-2',
  S: 'rounded bg-slate-200 px-0.5 text-inherit underline decoration-slate-700 decoration-2 underline-offset-2',
};

export function PicoLetter({ k }: { k: PicoKey }) {
  return <sup aria-hidden="true" className="ml-px text-[0.65em] font-bold text-slate-700 no-underline">{k}</sup>;
}

/** Per-article PICO checklist shown beside the decision buttons. A reading aid only. */
export function PicoCheck({ reference, terms, projectId }: { reference: Pick<Reference, 'title' | 'abstract' | 'keywords'>; terms: CriteriaTerms; projectId: string }) {
  const results = picoCheck(referenceText(reference), terms);
  if (!results.length) {
    return (
      <p className="text-xs text-slate-500">
        Tip: add <Link className="underline" to={`/p/${projectId}/settings#pico`}>PICO keywords</Link> to see at a glance whether each
        article mentions your population, intervention, comparator, outcomes and study design.
      </p>
    );
  }
  const found = results.filter((r) => r.found.length);
  const missing = results.filter((r) => !r.found.length);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs" data-testid="pico-check">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-semibold text-ink-900">PICO check</span>
        <Link className="text-slate-500 underline" to={`/p/${projectId}/settings#pico`}>Edit</Link>
      </div>
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.key} className="flex gap-2" data-pico={r.key} data-found={r.found.length > 0}>
            <span className={cx('w-5 shrink-0 text-center font-bold', r.found.length ? 'text-emerald-800' : 'text-slate-400')} aria-hidden="true">
              {r.found.length ? '✓' : '–'}
            </span>
            <span className="min-w-0">
              <span className={PICO_MARK[r.key]}>{r.key}</span> <span className="font-medium">{r.label}:</span>{' '}
              {r.found.length ? <strong>{r.found.join(', ')}</strong> : <span className="text-slate-500">not found</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 font-medium text-ink-900" data-testid="pico-summary">
        {found.length} of {results.length} element{results.length === 1 ? '' : 's'} found
        {missing.length > 0 && <span className="font-normal text-slate-600"> — not found: {missing.map((m) => m.label).join(', ')}</span>}
      </p>
      <p className="mt-1 text-slate-500">
        Keyword matches only — an element can be described in other words, so check the abstract. The decision is yours.
      </p>
    </div>
  );
}

/** Compact P I C O S letters for a table row: found elements bold, missing ones faded. */
export function PicoLetters({ reference, terms }: { reference: Pick<Reference, 'title' | 'abstract' | 'keywords'>; terms: CriteriaTerms }) {
  const results = picoCheck(referenceText(reference), terms);
  if (!results.length) return null;
  const title = results.map((r) => `${r.label}: ${r.found.length ? r.found.join(', ') : 'not found'}`).join('\n');
  return (
    <span title={title} aria-label={`PICO: ${results.filter((r) => r.found.length).length} of ${results.length} found`} className="inline-flex gap-0.5">
      {results.map((r) => (
        <span key={r.key} className={r.found.length ? PICO_MARK[r.key] + ' font-bold' : 'px-0.5 text-slate-300 line-through'}>{r.key}</span>
      ))}
    </span>
  );
}

const PLACEHOLDER: Record<PicoKey, string> = {
  P: 'adult*\nintensive care\nICU\ncritically ill',
  I: 'machine learning\ndeep learning\nprediction model*',
  C: 'standard care\nusual care\nplacebo',
  O: 'mortality\nsepsis\nlength of stay',
  S: 'cohort\nrandomi*\ncase-control',
};

/** Settings section: keywords per PICO element, with suggestions from the project's written PICO. */
export function PicoKeywordsEditor({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const saved = ((settings.settings?.criteria_terms as { pico?: Partial<PicoTerms> } | undefined)?.pico ?? {}) as Partial<PicoTerms>;
  const toText = (p: Partial<PicoTerms>) => Object.fromEntries(PICO_KEYS.map((k) => [k, (p[k] ?? []).join('\n')])) as Record<PicoKey, string>;
  const [text, setText] = useState(() => toText(saved));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setText(toText(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updated_at]);

  const written = (k: PicoKey) => (project[PICO_FIELDS[k]] as string | null) ?? '';
  const anyWritten = PICO_KEYS.some((k) => written(k).trim());

  const suggestAll = () => {
    let added = 0;
    const next = { ...text };
    for (const k of PICO_KEYS) {
      const have = parseTerms(next[k]);
      const add = suggestTerms(written(k)).filter((t) => !have.includes(t));
      if (add.length) {
        next[k] = [...have, ...add].join('\n');
        added += add.length;
      }
    }
    setText(next);
    toast(added
      ? `${added} suggested keyword${added === 1 ? '' : 's'} added — please review them and add synonyms before saving.`
      : anyWritten ? 'No new keywords found in your PICO.' : 'Write your PICO under “Project settings” first.');
  };

  const save = async () => {
    setSaving(true);
    try {
      const pico: PicoTerms = { ...EMPTY_PICO };
      for (const k of PICO_KEYS) pico[k] = parseTerms(text[k]);
      const current = (settings.settings?.criteria_terms ?? {}) as Record<string, unknown>;
      await updateSettings(project.id, { settings: { ...(settings.settings ?? {}), criteria_terms: { ...current, pico } } });
      const summary = PICO_KEYS.filter((k) => pico[k].length).map((k) => `${k} ${pico[k].length}`).join(', ') || 'none';
      await logActivity(project.id, 'settings', `Updated PICO keywords (${summary})`, { pico });
      await qc.invalidateQueries({ queryKey: qk.settings(project.id) });
      setText(toText(pico));
      toast('PICO keywords saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-700">
        List the words an abstract would use for each part of your PICO. While screening, ScreenLab shows a <strong>PICO check</strong>{' '}
        for every article (which elements it mentions and which are not found), highlights each element in the text, and lets you{' '}
        <strong>filter</strong> — for example “Population missing” — to review similar records together. It never makes a decision.
      </p>
      <p className="text-xs text-slate-500">
        One per line; add synonyms and spellings (adult*, elderly, older people). * matches any ending. Leave an element empty to ignore it
        — Comparator is often not mentioned in abstracts.
      </p>
      <Button size="sm" onClick={suggestAll}>Suggest from my PICO</Button>
      {!anyWritten && (
        <Alert kind="info">Your PICO is empty — fill in Population, Intervention, etc. under Project settings to get suggestions, or type keywords directly.</Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {PICO_KEYS.map((k) => (
          <div key={k}>
            <Label htmlFor={`pico-${k}`}><span className={PICO_MARK[k]}>{k}</span> {PICO_LABELS[k]} keywords</Label>
            {written(k) && <p className="mb-1 line-clamp-2 text-xs text-slate-500" title={written(k)}>Your protocol: {written(k)}</p>}
            <Textarea id={`pico-${k}`} rows={4} value={text[k]} onChange={(e) => setText({ ...text, [k]: e.target.value })} placeholder={PLACEHOLDER[k]} />
          </div>
        ))}
      </div>
      <Button variant="primary" onClick={save} loading={saving}>Save PICO keywords</Button>
    </div>
  );
}
