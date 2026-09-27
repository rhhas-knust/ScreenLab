/** ResearchHub questionnaires: public link, validated submissions, owner-only access (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import {
  createRhProject, deleteRhProject, getPublicForm, listFields, listResponses, listRhProjects, responsesToCsv, saveFields,
  submitResponse, updateRhProject, type RhField, type RhProject,
} from '../../src/lib/api/research';

const PW = process.env.E2E_PASSWORD ?? 'E2e-test-password-1';
const A = process.env.E2E_EMAIL_A ?? 'e2e-a@screenlab.test';
const B = process.env.E2E_EMAIL_B ?? 'e2e-b@screenlab.test';
async function signIn(email: string) {
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
}
const anon = () => supabase.auth.signOut();

let form: RhProject;
const f = (label: string, type: RhField['type'], extra: Partial<RhField> = {}): RhField => ({
  id: crypto.randomUUID(), project_id: '', label, help: null, type, options: [], required: false, field_order: 0, ...extra,
});
const qName = f('Your name', 'text', { required: true });
const qAge = f('Age', 'number');
const qLevel = f('Level', 'radio', { options: ['300', '400'], required: true });
const qTools = f('Tools used', 'checkbox', { options: ['Excel', 'SPSS', 'R'] });
const qScale = f('Workload is manageable', 'scale');
const qEmail = f('Email', 'email');

beforeAll(async () => {
  await signIn(A);
  form = await createRhProject({ title: `RH test ${Date.now()}` });
  await saveFields(form.id, [qName, qAge, qLevel, qTools, qScale, qEmail]);
});
afterAll(async () => {
  await signIn(A);
  if (form) await deleteRhProject(form.id).catch(() => {});
  await supabase.auth.signOut();
});

describe('ResearchHub questionnaires', () => {
  it('saves questions in order and removes deleted ones', async () => {
    const extra = f('Temporary', 'text');
    await saveFields(form.id, [qName, qAge, qLevel, qTools, qScale, qEmail, extra]);
    expect((await listFields(form.id)).map((x) => x.label)).toContain('Temporary');
    await saveFields(form.id, [qName, qAge, qLevel, qTools, qScale, qEmail]);
    const fields = await listFields(form.id);
    expect(fields.map((x) => x.label)).toEqual(['Your name', 'Age', 'Level', 'Tools used', 'Workload is manageable', 'Email']);
    expect(fields[2].options).toEqual(['300', '400']);
  });

  it('a draft is invisible to the public and rejects submissions', async () => {
    await anon();
    expect(await getPublicForm(form.id)).toBeNull();
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300' })).rejects.toMatchObject({ code: 'P0002' });
  });

  it('a published form can be answered without an account, with validation', async () => {
    await signIn(A);
    await updateRhProject(form.id, { status: 'active' });
    await anon();
    const pub = await getPublicForm(form.id);
    expect(pub?.fields).toHaveLength(6);
    const ok = { [qName.id]: '  Ama  ', [qAge.id]: 22, [qLevel.id]: '400', [qTools.id]: ['Excel', 'R'], [qScale.id]: 4, [qEmail.id]: 'ama@example.com', junk: 'ignored' };
    expect(await submitResponse(form.id, ok)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(submitResponse(form.id, { [qLevel.id]: '300' })).rejects.toMatchObject({ code: '22023', message: expect.stringContaining('Your name') });
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '500' })).rejects.toMatchObject({ code: '22023' });
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300', [qTools.id]: ['Stata'] })).rejects.toMatchObject({ code: '22023' });
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300', [qScale.id]: 6 })).rejects.toMatchObject({ code: '22023' });
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300', [qEmail.id]: 'not-an-email' })).rejects.toMatchObject({ code: '22023' });
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300', [qAge.id]: 'twenty' })).rejects.toMatchObject({ code: '22023' });
    expect(await submitResponse(form.id, { [qName.id]: 'Kofi', [qLevel.id]: '300', [qAge.id]: '23' })).toBeTruthy();
  });

  it('the public cannot read or write the tables directly', async () => {
    await anon();
    expect((await supabase.from('rh_responses').select('*').eq('project_id', form.id)).data ?? []).toEqual([]);
    expect((await supabase.from('rh_projects').select('*').eq('id', form.id)).data ?? []).toEqual([]);
    const ins = await supabase.from('rh_responses').insert({ project_id: form.id, answers: {} });
    expect(ins.error).toBeTruthy();
  });

  it('only the owner sees responses (cleaned answers), and another user cannot touch the form', async () => {
    await signIn(A);
    const rows = await listResponses(form.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].answers[qName.id]).toBe('Ama');
    expect(rows[0].answers).not.toHaveProperty('junk');
    expect(rows[1].answers[qAge.id]).toBe(23);
    const csv = responsesToCsv(await listFields(form.id), rows);
    expect(csv).toContain('Excel; R');
    expect((await listRhProjects()).find((p) => p.id === form.id)?.response_count).toBe(2);

    await signIn(B);
    expect(await listResponses(form.id)).toEqual([]);
    expect((await supabase.from('rh_projects').select('id').eq('id', form.id)).data).toEqual([]);
    const upd = await supabase.from('rh_projects').update({ title: 'hacked' }).eq('id', form.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    const field = await supabase.from('rh_fields').insert({ project_id: form.id, label: 'x', type: 'text' });
    expect(field.error).toBeTruthy();
    const del = await supabase.from('rh_responses').delete().eq('project_id', form.id).select('id');
    expect(del.data ?? []).toEqual([]);
  });

  it('a closed form shows as closed and rejects new responses', async () => {
    await signIn(A);
    await updateRhProject(form.id, { status: 'closed' });
    await anon();
    expect((await getPublicForm(form.id))?.status).toBe('closed');
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300' })).rejects.toMatchObject({ code: 'P0001' });
  });
});
