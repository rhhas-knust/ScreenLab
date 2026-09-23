import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logActivity, updateSettings } from '../lib/api/projects';
import { matchTerms, parseTerms, referenceText, suggestTerms, type CriteriaTerms } from '../lib/criteria';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import type { Project, ProjectSettings, Reference } from '../lib/types';
import { Alert, Button, Label, Textarea } from './ui';
import { useToast } from './Toast';

export const INC_MARK = 'rounded bg-emerald-100 px-0.5 text-inherit underline decoration-emerald-700 decoration-2 underline-offset-2';
export const EXC_MARK = 'rounded bg-rose-100 px-0.5 text-inherit underline decoration-rose-700 decoration-wavy decoration-2 underline-offset-2';

/** Compact "keyword check" beside the decision buttons. A reading aid only. */
export function KeywordCheck({ reference, terms, projectId }: { reference: Pick<Reference, 'title' | 'abstract' | 'keywords'>; terms: CriteriaTerms; projectId: string }) {
  if (!terms.include.length && !terms.exclude.length) {
    return (
      <p className="text-xs text-slate-500">
        Tip: add <Link className="underline" to={`/p/${projectId}/settings#criteria`}>criteria keywords</Link> to highlight inclusion and exclusion terms in each abstract.
      </p>
    );
  }
  const text = referenceText(reference);
  const inc = matchTerms(text, terms.include);
  const exc = matchTerms(text, terms.exclude);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs" data-testid="keyword-check">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-ink-900">Criteria keywords</span>
        <Link className="text-slate-500 underline" to={`/p/${projectId}/settings#criteria`}>Edit</Link>
      </div>
      <p><span className={INC_MARK}>✓ Inclusion</span>{' '}
        {inc.length ? <strong>{inc.join(', ')}</strong> : <span className="text-slate-500">none found</span>}</p>
      <p className="mt-1"><span className={EXC_MARK}>✕ Exclusion</span>{' '}
        {exc.length ? <strong>{exc.join(', ')}</strong> : <span className="text-slate-500">none found</span>}</p>
      <p className="mt-1 text-slate-500">Highlights only — the decision is yours.</p>
    </div>
  );
}

/** Settings section: edit inclusion / exclusion keywords, with suggestions from the written criteria. */
export function CriteriaKeywordsEditor({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const current = (settings.settings?.criteria_terms ?? {}) as Partial<CriteriaTerms>;
  const [inc, setInc] = useState((current.include ?? []).join('\n'));
  const [exc, setExc] = useState((current.exclude ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setInc((current.include ?? []).join('\n'));
    setExc((current.exclude ?? []).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updated_at]);

  const suggest = (text: string | null, existing: string, set: (v: string) => void) => {
    const have = parseTerms(existing);
    const add = suggestTerms(text).filter((t) => !have.includes(t));
    if (!add.length) {
      toast(text ? 'No new keywords found in the criteria text.' : 'Write your criteria in “Project settings” first.');
      return;
    }
    set([...have, ...add].join('\n'));
    toast(`${add.length} suggested keyword${add.length === 1 ? '' : 's'} added — please review and edit them before saving.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const terms: CriteriaTerms = { include: parseTerms(inc), exclude: parseTerms(exc) };
      const existing = (settings.settings?.criteria_terms ?? {}) as Record<string, unknown>;
      await updateSettings(project.id, { settings: { ...(settings.settings ?? {}), criteria_terms: { ...existing, ...terms } } });
      await logActivity(project.id, 'settings', `Updated criteria keywords (${terms.include.length} inclusion, ${terms.exclude.length} exclusion)`, { criteria_terms: terms });
      await qc.invalidateQueries({ queryKey: qk.settings(project.id) });
      setInc(terms.include.join('\n'));
      setExc(terms.exclude.join('\n'));
      toast('Criteria keywords saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-700">
        Words or phrases that signal your criteria. They are <span className={INC_MARK}>highlighted in green</span> or{' '}
        <span className={EXC_MARK}>red</span> in titles and abstracts, summarised next to the decision buttons, and available as a
        <strong> filter</strong> (e.g. “exclusion keywords but no inclusion keywords”). They never make a decision.
      </p>
      <p className="text-xs text-slate-500">One per line. Case does not matter; whole words are matched; add * for any ending (child* → children, childhood).</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="kw-inc">✓ Inclusion keywords</Label>
          <Textarea id="kw-inc" rows={8} value={inc} onChange={(e) => setInc(e.target.value)} placeholder={'machine learning\ndeep learning\nhospital-acquired\nsepsis'} />
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => suggest([project.inclusion_criteria, project.population, project.intervention_or_exposure, project.outcomes].filter(Boolean).join('\n'), inc, setInc)}>
            Suggest from my inclusion criteria
          </Button>
        </div>
        <div>
          <Label htmlFor="kw-exc">✕ Exclusion keywords</Label>
          <Textarea id="kw-exc" rows={8} value={exc} onChange={(e) => setExc(e.target.value)} placeholder={'editorial\nprotocol\nanimal\nchild*'} />
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => suggest(project.exclusion_criteria, exc, setExc)}>
            Suggest from my exclusion criteria
          </Button>
        </div>
      </div>
      {(project.inclusion_criteria || project.exclusion_criteria) ? null : (
        <Alert kind="info">Your inclusion/exclusion criteria are empty — fill them in under Project settings to get keyword suggestions.</Alert>
      )}
      <Button variant="primary" onClick={save} loading={saving}>Save keywords</Button>
    </div>
  );
}
