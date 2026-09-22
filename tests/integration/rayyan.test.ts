/** Importing a Rayyan export and continuing the screening (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabase } from '../../src/lib/supabase';
import { createProject, deleteProject, getStats } from '../../src/lib/api/projects';
import { importRecords } from '../../src/lib/api/importer';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchQueue, listReferences } from '../../src/lib/api/references';
import { listReasons, listTags } from '../../src/lib/api/tags';
import { parseCsv } from '../../src/lib/import/parsers';
import type { Project } from '../../src/lib/types';

const csv = readFileSync(new URL('../fixtures/rayyan-articles.csv', import.meta.url), 'utf8');
let project: Project;

beforeAll(async () => {
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL_A ?? 'e2e-a@screenlab.test', password: process.env.E2E_PASSWORD ?? 'E2e-test-password-1' });
  if (error) throw error;
  project = await createProject({ title: `Rayyan import test ${Date.now()}` });
});
afterAll(async () => {
  if (project) await deleteProject(project.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('Rayyan import', () => {
  it('carries over decisions, reasons, labels and notes with an audit trail', async () => {
    const records = parseCsv(csv).records;
    const out = await importRecords({ projectId: project.id, fileName: 'rayyan-export.zip', format: 'csv', databaseSource: 'Rayyan', overrideSource: false, records, importRayyan: true });
    expect(out.error).toBeNull();
    const s = await getStats(project.id);
    expect([s.total, s.ta_include, s.ta_exclude, s.ta_maybe, s.ta_unscreened]).toEqual([5, 1, 1, 1, 2]);

    const excluded = (await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, status: 'exclude' }, DEFAULT_SORT, 0, 10)).rows[0];
    expect(excluded.title_abstract_exclusion_reason).toBe('Wrong study design; Wrong population');

    const { data: hist } = await supabase.from('screening_decisions').select('action, decision, previous_decision').eq('project_id', project.id);
    expect(hist).toHaveLength(3);
    expect(hist!.every((h) => h.action === 'restore' && h.previous_decision === null)).toBe(true);
    const { count: rd } = await supabase.from('reviewer_decisions').select('*', { count: 'exact', head: true }).eq('project_id', project.id);
    expect(rd).toBe(3);

    const tags = (await listTags(project.id)).map((t) => t.name).sort();
    expect(tags).toEqual(['Check Later', 'Hospital', 'ML']);
    const ml = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, tags: ['ML'] }, DEFAULT_SORT, 0, 10);
    expect(ml.count).toBe(1);

    const reasons = (await listReasons(project.id)).map((r) => r.label);
    expect(reasons.filter((r) => /wrong population/i.test(r))).toEqual(['Wrong population']); // matched, not duplicated
    expect(reasons).toContain('Wrong study design');

    const noted = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'no model developed' }, DEFAULT_SORT, 0, 10);
    expect(noted.count).toBe(1);
    const conflict = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'reviewers disagreed' }, DEFAULT_SORT, 0, 10);
    expect(conflict.count).toBe(1);
    expect(conflict.rows[0].title_abstract_decision).toBeNull();

    // Screening continues with only the records still unscreened
    const queue = await fetchQueue(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT, null, 10);
    expect(queue.map((r) => r.title).sort()).toEqual(['Fictional editorial D', 'Fictional unscreened study E']);
  });

  it('can import the same file unscreened instead', async () => {
    const p2 = await createProject({ title: `Rayyan unscreened ${Date.now()}` });
    try {
      await importRecords({ projectId: p2.id, fileName: 'x.csv', format: 'csv', databaseSource: 'Rayyan', overrideSource: false, records: parseCsv(csv).records, importRayyan: false });
      const s = await getStats(p2.id);
      expect([s.total, s.ta_unscreened]).toEqual([5, 5]);
    } finally {
      await deleteProject(p2.id);
    }
  });
});
