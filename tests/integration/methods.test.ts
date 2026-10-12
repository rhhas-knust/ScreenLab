/** Methods reporting: search log, decision log, PRISMA manual numbers, AI disclosure (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabase } from '../../src/lib/supabase';
import { createProject, deleteProject, getSettings, getStats, updateSettings } from '../../src/lib/api/projects';
import { importRecords } from '../../src/lib/api/importer';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchMatchingIds, recordDecision } from '../../src/lib/api/references';
import { askAi } from '../../src/lib/api/ai';
import {
  deleteSource, getAiDisclosure, listDecisions, listSources, prismaManual, saveDecision, savePrismaManual, saveProspero, saveSource,
} from '../../src/lib/api/methods';
import { prismaCounts } from '../../src/lib/methods/prisma';
import { prosperoSaved } from '../../src/lib/methods/prospero';
import { parseCsv } from '../../src/lib/import/parsers';
import type { Project } from '../../src/lib/types';

const PW = process.env.E2E_PASSWORD ?? 'E2e-test-password-1';
const A = process.env.E2E_EMAIL_A ?? 'e2e-a@screenlab.test';
const B = process.env.E2E_EMAIL_B ?? 'e2e-b@screenlab.test';
const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
async function signIn(email: string) {
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
}
let project: Project;

beforeAll(async () => {
  await signIn(A);
  project = await createProject({ title: `Methods test ${Date.now()}` });
  await importRecords({ projectId: project.id, fileName: 'x', format: 'csv', databaseSource: 'Test', overrideSource: false, records: parseCsv(fx('sample.csv')).records });
});
afterAll(async () => {
  await signIn(A);
  if (project) await deleteProject(project.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('methods reporting', () => {
  it('search log and decision log are saved, listed in order and editable', async () => {
    const pub = await saveSource(project.id, { name: 'PubMed', results_count: 40, searched_on: '2026-09-01', search_string: '("large language model"[tiab]) AND bias' });
    await saveSource(project.id, { name: 'Scopus', results_count: 25, sort_order: 1 });
    await saveSource(project.id, { ...pub, results_count: 41 });
    expect((await listSources(project.id)).map((s) => [s.name, s.results_count])).toEqual([['PubMed', 41], ['Scopus', 25]]);

    await saveDecision(project.id, { title: 'Tier 2 in scope', decided_on: '2026-10-09', category: 'classification', rationale: 'Baseline studies answer the question' });
    await saveDecision(project.id, { title: 'Protocol registered', decided_on: '2026-09-01', category: 'registration' });
    expect((await listDecisions(project.id)).map((d) => d.title)).toEqual(['Protocol registered', 'Tier 2 in scope']);
  });

  it('PRISMA manual numbers are stored without wiping other settings', async () => {
    await updateSettings(project.id, { settings: { criteria_terms: { include: ['x'] } } });
    await savePrismaManual(project.id, { duplicates_before_import: 7, automation_excluded: 0, other_removed: 0, reports_not_retrieved_extra: 0, reports_of_included: null });
    const s = await getSettings(project.id);
    expect(s.settings.criteria_terms).toEqual({ include: ['x'] });
    expect(prismaManual(s).duplicates_before_import).toBe(7);
    const c = prismaCounts(await getStats(project.id), await listSources(project.id), prismaManual(s));
    expect(c.identified).toBe(66);
    expect(c.fromSearchLog).toBe(true);
  });

  it('PROSPERO answers are saved alongside the PRISMA numbers', async () => {
    await saveProspero(project.id, { registration_id: 'CRD420260000001', registered_on: '2026-09-05', answers: { country: 'Ghana' } });
    const s = await getSettings(project.id);
    expect(prosperoSaved(s)).toEqual({ registration_id: 'CRD420260000001', registered_on: '2026-09-05', answers: { country: 'Ghana' } });
    expect(prismaManual(s).duplicates_before_import).toBe(7);
    expect(s.settings.criteria_terms).toEqual({ include: ['x'] });
  });

  it('AI disclosure compares the latest suggestion with the human decision', async () => {
    const ids = (await fetchMatchingIds(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT)).map((r) => r.id);
    await askAi(ids[0], 'title_abstract');
    await askAi(ids[1], 'title_abstract');
    await recordDecision({ referenceId: ids[0], stage: 'title_abstract', decision: 'include', reason: null, action: 'decide', clientTs: new Date().toISOString() });
    const d = await getAiDisclosure(project.id);
    expect(d.records).toBe(2);
    const ta = d.agreement.find((a) => a.stage === 'title_abstract')!;
    expect([ta.records, ta.decided]).toEqual([2, 1]);
    expect(ta.compared).toBeLessThanOrEqual(1);
    expect(d.human_decisions).toBeGreaterThanOrEqual(1);
    expect(d.reviewers).toBe(1);
  });

  it('another user cannot read or change the logs, and sees no AI disclosure', async () => {
    const sources = await listSources(project.id);
    await signIn(B);
    expect(await listSources(project.id)).toEqual([]);
    expect(await listDecisions(project.id)).toEqual([]);
    const forged = await supabase.from('search_sources').insert({ project_id: project.id, name: 'fake' });
    expect(forged.error).toBeTruthy();
    const upd = await supabase.from('protocol_decisions').update({ title: 'hacked' }).eq('project_id', project.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    await deleteSource(sources[0].id);
    const d = await getAiDisclosure(project.id);
    expect(d.suggestions).toBe(0);
    await signIn(A);
    expect(await listSources(project.id)).toHaveLength(2);
  });
});
