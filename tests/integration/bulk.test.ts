/** Multi-select bulk decisions and criteria-keyword filters (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabase } from '../../src/lib/supabase';
import { createProject, deleteProject, getStats } from '../../src/lib/api/projects';
import { importRecords } from '../../src/lib/api/importer';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchMatchingIds, listReferences, recordDecisionsBulk, getDecisionHistory } from '../../src/lib/api/references';
import { parseCsv, parseRis } from '../../src/lib/import/parsers';
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
const terms = { include: ['sensor*', 'widget therapy'], exclude: ['conference', 'synthetic data'] };

beforeAll(async () => {
  await signIn(A);
  project = await createProject({ title: `Bulk test ${Date.now()}` });
  for (const records of [parseCsv(fx('sample.csv')).records, parseRis(fx('sample.ris')).records]) {
    await importRecords({ projectId: project.id, fileName: 'x', format: 'x', databaseSource: 'Test', overrideSource: false, records });
  }
});
afterAll(async () => {
  await signIn(A);
  if (project) await deleteProject(project.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('criteria keyword filter (server side, whole words)', () => {
  const titles = async (kw: typeof DEFAULT_FILTERS.kw) =>
    (await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, kw, terms }, DEFAULT_SORT, 0, 50)).rows.map((r) => r.title).sort();
  it('has inclusion keywords (wildcard + phrase)', async () => {
    expect(await titles('inc')).toEqual([
      'Fictional trial of widget therapy in imaginary patients',
      'Fictional trial of widget therapy in imaginary patients',
      'Imaginary sensors for detecting fictional pathogens in a pretend hospital',
    ]);
  });
  it('has exclusion keywords / exclusion but no inclusion / no inclusion', async () => {
    expect(await titles('exc')).toEqual(['Made-up conference paper on synthetic data']);
    expect(await titles('exc_only')).toEqual(['Made-up conference paper on synthetic data']);
    expect((await titles('no_inc')).length).toBe(4);
  });
  it('matches whole words only', async () => {
    const r = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, kw: 'inc', terms: { include: ['sens'], exclude: [] } }, DEFAULT_SORT, 0, 50);
    expect(r.count).toBe(0);
  });
});

describe('bulk decisions', () => {
  it('applies one decision to many records, each with its own audit entry, and can be undone', async () => {
    const all = await fetchMatchingIds(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT);
    expect(all).toHaveLength(7);
    const pick = all.slice(0, 3);
    const prev = await recordDecisionsBulk('title_abstract', pick.map((p) => ({ id: p.id, decision: 'exclude', reason: 'Wrong population' })));
    expect(prev.map((p) => p.decision)).toEqual([null, null, null]);
    let s = await getStats(project.id);
    expect(s.ta_exclude).toBe(3);
    const h = (await getDecisionHistory(pick[0].id)) as { action: string; decision: string; exclusion_reason: string }[];
    expect(h[0]).toMatchObject({ action: 'decide', decision: 'exclude', exclusion_reason: 'Wrong population' });
    const { data: log } = await supabase.from('activity_logs').select('message').eq('project_id', project.id).ilike('message', 'Bulk decision%');
    expect(log!.map((l) => l.message)).toEqual(['Bulk decision: 3 records → Excluded — Wrong population (title/abstract)']);

    // change some of them again, then undo that batch
    const prev2 = await recordDecisionsBulk('title_abstract', pick.slice(0, 2).map((p) => ({ id: p.id, decision: 'include', reason: null })));
    expect(prev2.map((p) => [p.decision, p.reason])).toEqual([['exclude', 'Wrong population'], ['exclude', 'Wrong population']]);
    s = await getStats(project.id);
    expect([s.ta_include, s.ta_exclude]).toEqual([2, 1]);
    await recordDecisionsBulk('title_abstract', prev2, 'undo');
    s = await getStats(project.id);
    expect([s.ta_include, s.ta_exclude]).toEqual([0, 3]);
    const h2 = (await getDecisionHistory(pick[0].id)) as { action: string }[];
    expect(h2.map((x) => x.action)).toEqual(['undo', 'change', 'decide']);

    // reset to unscreened
    await recordDecisionsBulk('title_abstract', pick.map((p) => ({ id: p.id, decision: null, reason: null })));
    s = await getStats(project.id);
    expect(s.ta_screened).toBe(0);
  });

  it('bulk "select all matching" respects filters', async () => {
    const f = { ...DEFAULT_FILTERS, kw: 'exc_only' as const, terms };
    const ids = await fetchMatchingIds(project.id, 'title_abstract', f, DEFAULT_SORT);
    expect(ids).toHaveLength(1);
  });

  it('another user cannot change records by sending their IDs', async () => {
    const ids = (await fetchMatchingIds(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT)).map((r) => r.id);
    await signIn(B);
    const prev = await recordDecisionsBulk('title_abstract', ids.map((id) => ({ id, decision: 'exclude', reason: 'hack' })));
    expect(prev).toEqual([]);
    await signIn(A);
    const s = await getStats(project.id);
    expect(s.ta_exclude).toBe(0);
  });

  it('rejects oversized requests and invalid decisions', async () => {
    const { error } = await supabase.rpc('record_decisions_bulk', { p_stage: 'full_text', p_items: [{ id: (await fetchMatchingIds(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT))[0].id, decision: 'maybe' }] });
    expect(error).toBeTruthy();
    const big = Array.from({ length: 1001 }, () => ({ id: '00000000-0000-0000-0000-000000000000', decision: 'include' }));
    const r2 = await supabase.rpc('record_decisions_bulk', { p_stage: 'title_abstract', p_items: big });
    expect(r2.error?.message).toMatch(/maximum 1000/);
  });
});
