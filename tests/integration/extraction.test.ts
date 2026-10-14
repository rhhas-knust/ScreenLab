/** Review team and blinded double data extraction (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabase } from '../../src/lib/supabase';
import { createProject, deleteProject } from '../../src/lib/api/projects';
import { importRecords } from '../../src/lib/api/importer';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchMatchingIds, recordDecision } from '../../src/lib/api/references';
import {
  addMember, getForReference, getProgress, listTeam, removeMember, saveExtraction, saveFinal, saveForm,
} from '../../src/lib/api/extraction';
import { PRESETS } from '../../src/lib/extraction/form';
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
let ref1: string, ref2: string;

beforeAll(async () => {
  await signIn(A);
  project = await createProject({ title: `Extraction test ${Date.now()}` });
  await importRecords({ projectId: project.id, fileName: 'x', format: 'csv', databaseSource: 'Test', overrideSource: false, records: parseCsv(fx('sample.csv')).records });
  const ids = (await fetchMatchingIds(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT)).map((r) => r.id);
  [ref1, ref2] = ids;
  for (const id of [ref1, ref2]) {
    for (const stage of ['title_abstract', 'full_text'] as const) {
      await recordDecision({ referenceId: id, stage, decision: 'include', reason: null, action: 'decide', clientTs: new Date().toISOString() });
    }
  }
  await saveForm(project.id, PRESETS[0].form);
});
afterAll(async () => {
  await signIn(A);
  if (project) await deleteProject(project.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('review team', () => {
  it('only the owner can add members, and only existing accounts', async () => {
    await signIn(B);
    await expect(addMember(project.id, B)).rejects.toBeTruthy();
    expect(await getProgress(project.id)).toEqual([]);
    expect(await listTeam(project.id)).toEqual([]);
    await signIn(A);
    await expect(addMember(project.id, 'nobody@screenlab.test')).rejects.toMatchObject({ message: expect.stringMatching(/sign up/) });
    await addMember(project.id, B.toUpperCase());
    expect((await listTeam(project.id)).map((m) => [m.email, m.role])).toEqual([[A, 'owner'], [B, 'reviewer']]);
  });

  it('the owner cannot be removed through the members table', async () => {
    const me = (await listTeam(project.id)).find((m) => m.role === 'owner')!;
    await removeMember(project.id, me.user_id);
    expect((await listTeam(project.id)).length).toBe(2);
  });
});

describe('blinded double extraction', () => {
  it('lists only included studies', async () => {
    const p = await getProgress(project.id);
    expect(p.map((r) => r.reference_id).sort()).toEqual([ref1, ref2].sort());
  });

  it('keeps each reviewer’s answers hidden until both have completed the study', async () => {
    await saveExtraction(project.id, ref1, { tier: 'Tier 1', llms: 'GPT-4o' }, 'complete');
    await signIn(B);
    let view = await getForReference(ref1);
    expect(view.mine).toBeNull();
    expect(view.others).toEqual([]);
    const row = (await getProgress(project.id)).find((r) => r.reference_id === ref1)!;
    expect([row.my_status, row.complete_count]).toEqual([null, 1]);
    const direct = await supabase.from('extractions').select('data').eq('reference_id', ref1);
    expect(direct.data).toEqual([]);

    await saveExtraction(project.id, ref1, { tier: 'Tier 2' }, 'draft');
    view = await getForReference(ref1);
    expect(view.others).toEqual([]);

    await saveExtraction(project.id, ref1, { tier: 'Tier 2', llms: 'gpt-4o' }, 'complete');
    view = await getForReference(ref1);
    expect(view.others.map((o) => o.data.tier)).toEqual(['Tier 1']);
  });

  it('a reviewer cannot change someone else’s extraction', async () => {
    const upd = await supabase.from('extractions').update({ data: { tier: 'hacked' } }).eq('reference_id', ref1).neq('data->>tier', 'Tier 2').select('id');
    expect(upd.data ?? []).toEqual([]);
    const forged = await supabase.from('extractions').insert({ project_id: project.id, reference_id: ref2, reviewer_id: (await listTeam(project.id))[0].user_id, data: {} });
    expect(forged.error).toBeTruthy();
  });

  it('the agreed final version sets the study’s tier', async () => {
    await signIn(A);
    const view = await getForReference(ref1);
    expect(view.others.map((o) => o.data.tier)).toEqual(['Tier 2']);
    await saveFinal(project.id, ref1, { tier: 'Tier 1', llms: 'GPT-4o' });
    const row = (await getProgress(project.id)).find((r) => r.reference_id === ref1)!;
    expect([row.has_final, row.final_tier, row.complete_count]).toEqual([true, 'Tier 1', 2]);
  });

  it('a removed reviewer loses access to the project', async () => {
    const b = (await listTeam(project.id)).find((m) => m.role === 'reviewer')!;
    await removeMember(project.id, b.user_id);
    await signIn(B);
    expect(await getProgress(project.id)).toEqual([]);
    expect((await supabase.from('extraction_final').select('reference_id').eq('project_id', project.id)).data).toEqual([]);
  });
});
