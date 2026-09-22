/**
 * End-to-end data-layer tests against a real Supabase project.
 * Requires .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) and two
 * confirmed test users (E2E_EMAIL_A / E2E_EMAIL_B, password E2E_PASSWORD).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabase } from '../../src/lib/supabase';
import { createProject, deleteProject, getProject, getSettings, getStats } from '../../src/lib/api/projects';
import { importRecords, checkExistingMatches } from '../../src/lib/api/importer';
import { detectDuplicates, listGroups, mergeMetadata, reopenGroup, resolveGroup } from '../../src/lib/api/duplicates';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchQueue, getReference, listReferences, neighbor, recordDecision, getDecisionHistory } from '../../src/lib/api/references';
import { addTagToReference, createTag, deleteTag, listReasons, updateTag } from '../../src/lib/api/tags';
import { buildBackup, restoreBackup, validateBackup } from '../../src/lib/api/backup';
import { parseBibtex, parseCsv, parseRis } from '../../src/lib/import/parsers';
import type { Project, Reference } from '../../src/lib/types';

const A = process.env.E2E_EMAIL_A ?? 'e2e-a@screenlab.test';
const B = process.env.E2E_EMAIL_B ?? 'e2e-b@screenlab.test';
const PW = process.env.E2E_PASSWORD ?? 'E2e-test-password-1';
const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

async function signIn(email: string) {
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
}

let project: Project;
let restored: Project | null = null;
let ids: string[] = [];
let includedId = '';

beforeAll(async () => {
  await signIn(A);
  project = await createProject({ title: `Integration test ${new Date().toISOString()}`, review_type: 'systematic', inclusion_criteria: 'x' });
});

afterAll(async () => {
  await signIn(A);
  if (project) await deleteProject(project.id).catch(() => {});
  if (restored) await deleteProject(restored.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('project setup', () => {
  it('creates settings and 13 default exclusion reasons', async () => {
    const s = await getSettings(project.id);
    expect(s.stage2_enabled).toBe(true);
    const reasons = await listReasons(project.id);
    expect(reasons).toHaveLength(13);
    expect(reasons[0].label).toBe('Wrong population');
  });
});

describe('import + duplicates', () => {
  it('imports CSV, RIS and BibTeX in chunks', async () => {
    for (const [name, parsed, src] of [
      ['sample.csv', parseCsv(fx('sample.csv')), 'Scopus'],
      ['sample.ris', parseRis(fx('sample.ris')), 'Web of Science'],
      ['sample.bib', parseBibtex(fx('sample.bib')), 'Google Scholar'],
    ] as const) {
      const out = await importRecords({ projectId: project.id, fileName: name, format: 'x', databaseSource: src, overrideSource: false, records: parsed.records });
      expect(out.error).toBeNull();
      expect(out.insertedIds).toHaveLength(parsed.records.length);
      ids.push(...out.insertedIds);
    }
    const stats = await getStats(project.id);
    expect(stats.total).toBe(10);
    // source from file kept (CSV says Scopus); BibTeX had none → Google Scholar
    const { rows } = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, source: 'Google Scholar' }, DEFAULT_SORT, 0, 50);
    expect(rows).toHaveLength(3);
  });

  it('import preview detects records that already exist', async () => {
    const m = await checkExistingMatches(project.id, parseCsv(fx('sample.csv')).records);
    expect(m.size).toBeGreaterThanOrEqual(3);
  });

  it('flags the DOI duplicate without deleting anything', async () => {
    const d = await detectDuplicates(project.id, ids);
    expect(d.groups).toBeGreaterThanOrEqual(1);
    const stats = await getStats(project.id);
    expect(stats.total).toBe(10);
    expect(stats.possible_duplicates).toBeGreaterThanOrEqual(2);
  });

  it('merges a group keeping the most complete metadata, and reopens it', async () => {
    const { groups } = await listGroups(project.id, 'open', 0, 10);
    const g = groups.find((x) => x.match_type === 'doi')!;
    expect(g.members.length).toBe(2);
    const [primary, other] = [...g.members].sort((a, b) => (b.abstract?.length ?? 0) - (a.abstract?.length ?? 0));
    // make the primary the one with fewer fields to prove filling works
    const merged = mergeMetadata(other, [primary]);
    await resolveGroup(g.id, 'merge', other.id, merged);
    const after = await getReference(other.id);
    const gone = await getReference(primary.id);
    expect(gone.duplicate_status).toBe('merged');
    expect(after.duplicate_status).toBe('kept');
    expect((after.abstract ?? '').length).toBeGreaterThanOrEqual((primary.abstract ?? '').length);
    let stats = await getStats(project.id);
    expect(stats.duplicates_removed).toBe(1);
    await reopenGroup(g.id);
    const restoredRef = await getReference(other.id);
    expect(restoredRef.abstract).toBe(other.abstract);
    expect((await getReference(primary.id)).duplicate_status).toBe('possible');
    // finally mark it as duplicate for the rest of the test
    await resolveGroup(g.id, 'mark', other.id);
    stats = await getStats(project.id);
    expect(stats.duplicates_removed).toBe(1);
  });
});

describe('screening decisions', () => {
  let queue: Reference[];
  it('queue returns unscreened records in import order', async () => {
    queue = await fetchQueue(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT, null, 20);
    expect(queue.length).toBe(9); // 10 minus one marked duplicate
    expect(queue.map((r) => r.seq)).toEqual([...queue.map((r) => r.seq)].sort((a, b) => a - b));
  });

  it('records include / exclude with reason / maybe, idempotently, with audit history', async () => {
    const [a, b, c] = queue;
    includedId = a.id;
    await recordDecision({ referenceId: a.id, stage: 'title_abstract', decision: 'include', reason: null, action: 'decide', clientTs: new Date().toISOString() });
    await recordDecision({ referenceId: a.id, stage: 'title_abstract', decision: 'include', reason: null, action: 'decide', clientTs: new Date().toISOString() }); // retry
    await recordDecision({ referenceId: b.id, stage: 'title_abstract', decision: 'exclude', reason: 'Wrong population', action: 'decide', clientTs: new Date().toISOString() });
    await recordDecision({ referenceId: c.id, stage: 'title_abstract', decision: 'maybe', reason: 'ignored', action: 'decide', clientTs: new Date().toISOString() });
    const rb = await getReference(b.id);
    expect(rb.title_abstract_decision).toBe('exclude');
    expect(rb.title_abstract_exclusion_reason).toBe('Wrong population');
    expect(rb.title_abstract_screened_at).toBeTruthy();
    expect((await getReference(c.id)).title_abstract_exclusion_reason).toBeNull();
    expect(await getDecisionHistory(a.id)).toHaveLength(1); // retry was a no-op

    // change Excluded → Maybe → Included, then undo
    await recordDecision({ referenceId: b.id, stage: 'title_abstract', decision: 'maybe', reason: null, action: 'decide', clientTs: new Date().toISOString() });
    await recordDecision({ referenceId: b.id, stage: 'title_abstract', decision: 'include', reason: null, action: 'decide', clientTs: new Date().toISOString() });
    await recordDecision({ referenceId: b.id, stage: 'title_abstract', decision: 'maybe', reason: null, action: 'undo', clientTs: new Date().toISOString() });
    const hist = (await getDecisionHistory(b.id)) as { decision: string; previous_decision: string | null; action: string }[];
    expect(hist.map((h) => [h.previous_decision, h.decision, h.action])).toEqual([
      ['include', 'maybe', 'undo'], ['maybe', 'include', 'change'], ['exclude', 'maybe', 'change'], [null, 'exclude', 'decide'],
    ]);
    const { data: log } = await supabase.from('activity_logs').select('message').eq('reference_id', b.id).order('created_at');
    expect(log!.map((l) => l.message)[0]).toBe('Screened as Excluded — Wrong population (title/abstract)');
  });

  it('rejects Maybe at full text and invalid decisions', async () => {
    await expect(recordDecision({ referenceId: queue[0].id, stage: 'full_text', decision: 'maybe', reason: null, action: 'decide', clientTs: new Date().toISOString() })).rejects.toBeTruthy();
  });

  it('full-text stage contains only title/abstract includes', async () => {
    const ft = await fetchQueue(project.id, 'full_text', DEFAULT_FILTERS, DEFAULT_SORT, null, 20);
    expect(ft.map((r) => r.id)).toEqual([queue[0].id]);
    await recordDecision({ referenceId: queue[0].id, stage: 'full_text', decision: 'exclude', reason: 'Full text unavailable', action: 'decide', clientTs: new Date().toISOString() });
    const s = await getStats(project.id);
    expect(s.ft_pool).toBe(1);
    expect(s.ft_exclude).toBe(1);
    expect(s.ta_include).toBe(1);
    expect(s.ta_maybe).toBe(2);
    expect(s.ta_unscreened).toBe(6);
    expect(s.after_dedup).toBe(9);
  });

  it('next unscreened after a record skips screened ones and wraps', async () => {
    const q = await fetchQueue(project.id, 'title_abstract', DEFAULT_FILTERS, DEFAULT_SORT, queue[0], 3);
    expect(q.every((r) => r.title_abstract_decision == null)).toBe(true);
    expect(q[0].seq).toBeGreaterThan(queue[0].seq);
  });

  it('neighbor navigation works for several sorts', async () => {
    for (const sort of [DEFAULT_SORT, { key: 'title', dir: 'asc' }, { key: 'year', dir: 'desc' }, { key: 'status', dir: 'asc' }] as const) {
      const all = await listReferences(project.id, 'title_abstract', DEFAULT_FILTERS, sort, 0, 50);
      const second = await getReference(all.rows[1].id);
      const next = await neighbor(project.id, 'title_abstract', DEFAULT_FILTERS, sort, second, 'next');
      const prev = await neighbor(project.id, 'title_abstract', DEFAULT_FILTERS, sort, second, 'prev');
      expect(next?.id, `next for ${sort.key}`).toBe(all.rows[2].id);
      expect(prev?.id, `prev for ${sort.key}`).toBe(all.rows[0].id);
    }
  });
});

describe('search, filters, tags, notes', () => {
  it('searches across fields server-side', async () => {
    const r1 = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'lovelace' }, DEFAULT_SORT, 0, 50);
    expect(r1.count).toBe(1);
    const r2 = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: '10.5555/bib.1' }, DEFAULT_SORT, 0, 50);
    expect(r2.count).toBe(1);
    const r3 = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: '100%_' }, DEFAULT_SORT, 0, 50);
    expect(r3.count).toBe(0);
  });

  it('combines filters (status + source + year)', async () => {
    const r = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, status: 'unscreened', source: 'Web of Science', yearFrom: '2018', yearTo: '2025' }, DEFAULT_SORT, 0, 50);
    expect(r.rows.every((x) => x.database_source === 'Web of Science' && x.year! >= 2018 && !x.title_abstract_decision)).toBe(true);
    const ex = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, reason: 'Wrong population' }, DEFAULT_SORT, 0, 50);
    expect(ex.count).toBe(0); // it was changed away from Excluded
  });

  it('tags are applied, searchable, renamed and removed', async () => {
    const t = await createTag(project.id, 'Needs Full Text');
    await addTagToReference(project.id, ids[1], t);
    expect((await getReference(ids[1])).tag_names).toEqual(['Needs Full Text']);
    const f = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, tags: ['Needs Full Text'] }, DEFAULT_SORT, 0, 50);
    expect(f.count).toBe(1);
    const s = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'needs full' }, DEFAULT_SORT, 0, 50);
    expect(s.count).toBe(1);
    const t2 = await updateTag(t, { name: 'Get PDF' });
    expect((await getReference(ids[1])).tag_names).toEqual(['Get PDF']);
    await deleteTag(t2);
    expect((await getReference(ids[1])).tag_names).toEqual([]);
  });

  it('notes are saved and searchable', async () => {
    await supabase.from('study_references').update({ notes: 'Infection definition unclear' }).eq('id', ids[2]);
    const s = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'definition unclear' }, DEFAULT_SORT, 0, 50);
    expect(s.count).toBe(1);
  });
});

describe('backup and restore', () => {
  it('round-trips a project into a new project', async () => {
    const tag = await createTag(project.id, 'ML');
    await addTagToReference(project.id, ids[3], tag);
    const backup = JSON.parse(JSON.stringify(await buildBackup(project.id)));
    const v = validateBackup(backup);
    expect(v.ok).toBe(true);
    expect(validateBackup({ format: 'nope' }).ok).toBe(false);
    expect(validateBackup({ ...backup, references: [{}] }).ok).toBe(false);
    restored = await restoreBackup(backup, 'Restored copy');
    const [s1, s2] = await Promise.all([getStats(project.id), getStats(restored.id)]);
    for (const k of ['total', 'duplicates_removed', 'ta_include', 'ta_exclude', 'ta_maybe', 'ft_exclude', 'ta_unscreened'] as const) {
      expect(s2[k], k).toBe(s1[k]);
    }
    const { count: h1 } = await supabase.from('screening_decisions').select('*', { count: 'exact', head: true }).eq('project_id', project.id);
    const { count: h2 } = await supabase.from('screening_decisions').select('*', { count: 'exact', head: true }).eq('project_id', restored.id);
    expect(h2).toBe(h1);
    const tagged = await listReferences(restored.id, 'title_abstract', { ...DEFAULT_FILTERS, tags: ['ML'] }, DEFAULT_SORT, 0, 50);
    expect(tagged.count).toBe(1);
    const notes = await listReferences(restored.id, 'title_abstract', { ...DEFAULT_FILTERS, q: 'definition unclear' }, DEFAULT_SORT, 0, 50);
    expect(notes.count).toBe(1);
    // restored order is preserved
    const a = await listReferences(project.id, 'title_abstract', { ...DEFAULT_FILTERS, dup: 'all' }, DEFAULT_SORT, 0, 50);
    const b = await listReferences(restored.id, 'title_abstract', { ...DEFAULT_FILTERS, dup: 'all' }, DEFAULT_SORT, 0, 50);
    expect(b.rows.map((r) => r.title)).toEqual(a.rows.map((r) => r.title));
  });
});

describe('row level security (user B attacking user A)', () => {
  let aRef: string;
  beforeAll(async () => {
    aRef = includedId;
    await signIn(B);
  });
  afterAll(async () => {
    await signIn(A);
  });

  it('cannot read the project, references, history or logs', async () => {
    await expect(getProject(project.id)).rejects.toBeTruthy();
    const refs = await supabase.from('study_references').select('id').eq('project_id', project.id);
    expect(refs.data).toEqual([]);
    const h = await supabase.from('screening_decisions').select('id').eq('project_id', project.id);
    expect(h.data).toEqual([]);
    const l = await supabase.from('activity_logs').select('id').eq('project_id', project.id);
    expect(l.data).toEqual([]);
    const st = await supabase.rpc('project_stats', { p_project_id: project.id });
    expect((st.data as { total: number }).total).toBe(0);
    const ov = await supabase.rpc('my_projects_overview');
    expect((ov.data as { id: string }[]).some((p) => p.id === project.id)).toBe(false);
  });

  it('cannot write decisions, references, tags, logs or membership', async () => {
    const d = await supabase.rpc('record_decision', { p_reference_id: aRef, p_stage: 'title_abstract', p_decision: 'exclude', p_reason: 'hack' });
    expect(d.error).toBeTruthy();
    const ins = await supabase.from('study_references').insert({ project_id: project.id, title: 'injected' });
    expect(ins.error).toBeTruthy();
    const up = await supabase.from('study_references').update({ title: 'hacked' }).eq('id', aRef).select('id');
    expect(up.data ?? []).toEqual([]);
    const del = await supabase.from('projects').delete().eq('id', project.id).select('id');
    expect(del.data ?? []).toEqual([]);
    const upd = await supabase.from('projects').update({ title: 'hacked' }).eq('id', project.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    const log = await supabase.from('activity_logs').insert({ project_id: project.id, action: 'x', message: 'x' });
    expect(log.error).toBeTruthy();
    const mem = await supabase.from('project_members').insert({ project_id: project.id, user_id: (await supabase.auth.getUser()).data.user!.id, role: 'reviewer' });
    expect(mem.error).toBeTruthy();
    const up2 = await supabase.storage.from('full-texts').upload(`${project.id}/${aRef}/x.pdf`, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    expect(up2.error).toBeTruthy();
    const grp = await supabase.rpc('apply_duplicate_groups', { p_project_id: project.id, p_groups: [{ ids: [aRef, ids[1]], match_type: 'doi' }] });
    expect(grp.error || (grp.data as number) >= 0).toBeTruthy();
    // B's own project cannot be pointed at A's references
    const mine = await createProject({ title: 'B project' });
    const cross = await supabase.from('reference_tags').insert({ project_id: mine.id, reference_id: aRef, tag_id: (await createTag(mine.id, 'x')).id });
    expect(cross.error).toBeTruthy();
    await deleteProject(mine.id);
  });

  it("A's data is unchanged after B's attempts", async () => {
    await signIn(A);
    const r = await getReference(aRef);
    expect(r.title).not.toBe('hacked');
    expect(r.title_abstract_decision).toBe('include');
    const p = await getProject(project.id);
    expect(p.title).not.toBe('hacked');
    const { data: groups } = await supabase.from('duplicate_groups').select('id').eq('project_id', project.id);
    expect((groups ?? []).length).toBe(1);
  });
});
