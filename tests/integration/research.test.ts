/** ResearchHub questionnaires: public link, validated submissions, owner-only access (real database, RLS enforced). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import {
  createRhProject, deleteRhProject, getPublicForm, listFields, listResponses, listRhProjects, responsesToCsv, saveCodes, saveFields,
  latestSummary, submitResponse, updateRhProject, writeSummary, type RhField, type RhProject,
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
  id: crypto.randomUUID(), project_id: '', label, help: null, type, options: [], required: false, field_order: 0, settings: {}, ...extra,
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

  it('AI summaries: need 3 responses, then only the owner can read or add them', async () => {
    await signIn(A);
    await expect(writeSummary(form.id)).rejects.toMatchObject({ code: 'too_few' });
    await anon();
    await submitResponse(form.id, { [qName.id]: 'Kojo', [qLevel.id]: '400' });
    await signIn(A);
    const s = await writeSummary(form.id);
    expect(s.response_count).toBe(3);
    expect((await latestSummary(form.id))?.id).toBe(s.id);

    await signIn(B);
    expect(await latestSummary(form.id)).toBeNull();
    await expect(writeSummary(form.id)).rejects.toMatchObject({ message: 'Questionnaire not found' });
    const forged = await supabase.from('rh_ai_summaries').insert({ project_id: form.id, model: 'x', summary: { headline: 'fake' }, response_count: 0 });
    expect(forged.error).toBeTruthy();
    const del = await supabase.from('rh_ai_summaries').delete().eq('project_id', form.id).select('id');
    expect(del.data ?? []).toEqual([]);
    await anon();
    expect((await supabase.from('rh_ai_summaries').select('id').eq('project_id', form.id)).data ?? []).toEqual([]);
  });

  it('a closed form shows as closed and rejects new responses', async () => {
    await signIn(A);
    await updateRhProject(form.id, { status: 'closed' });
    await anon();
    expect((await getPublicForm(form.id))?.status).toBe('closed');
    await expect(submitResponse(form.id, { [qName.id]: 'x', [qLevel.id]: '300' })).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('ResearchHub v2: consent, skip logic, new types, closing rules, devices, coding', () => {
  let v2: RhProject;
  const smoke = f('Do you smoke?', 'radio', { options: ['Yes', 'No'], required: true });
  const perDay = f('Cigarettes per day', 'number', { required: true, settings: { show_if: { field: smoke.id, op: 'equals', value: 'Yes' } } });
  const scale = f('Stress', 'scale', { settings: { min: 0, max: 10, min_label: 'None' } });
  const grid = f('Views', 'grid', { options: ['Agree', 'Disagree'], required: true, settings: { rows: ['Fair', 'Fast'] } });
  const rank = f('Priorities', 'ranking', { options: ['Cost', 'Speed', 'Trust'] });
  const when = f('Date of visit', 'date');
  const why = f('Why?', 'textarea');
  const base = { [smoke.id]: 'No', [grid.id]: { Fair: 'Agree', Fast: 'Disagree' } };

  beforeAll(async () => {
    await signIn(A);
    v2 = await createRhProject({ title: `RH v2 ${Date.now()}` });
    await saveFields(v2.id, [smoke, perDay, scale, grid, rank, when, why]);
    await updateRhProject(v2.id, {
      status: 'active', consent_text: 'You agree to take part.',
      translations: { base_name: 'English', items: [{ code: 'tw', name: 'Twi', fields: {} }] },
    });
  });
  afterAll(async () => {
    await signIn(A);
    if (v2) await deleteRhProject(v2.id).catch(() => {});
  });

  it('stores settings and serves them, with consent and translations, on the public form', async () => {
    await signIn(A);
    expect((await listFields(v2.id))[2].settings).toEqual({ min: 0, max: 10, min_label: 'None' });
    await anon();
    const pub = await getPublicForm(v2.id);
    expect(pub?.consent_text).toBe('You agree to take part.');
    expect(pub?.closed_reason).toBeNull();
    expect(pub?.translations?.items?.[0].name).toBe('Twi');
    expect(pub?.fields[1].settings?.show_if?.field).toBe(smoke.id);
  });

  it('requires consent, applies skip logic and validates the new types', async () => {
    await anon();
    await expect(submitResponse(v2.id, base)).rejects.toMatchObject({ code: '22023', message: expect.stringContaining('agree') });
    const ok = { consent: true };
    // Hidden question: not required, and its answer is dropped.
    const id1 = await submitResponse(v2.id, { ...base, [perDay.id]: 40, [scale.id]: 0, [rank.id]: ['Trust', 'Cost', 'Speed'], [when.id]: '2026-10-01', [why.id]: 'cost of care' }, { ...ok, language: 'tw' });
    expect(id1).toBeTruthy();
    // Shown question: now required.
    await expect(submitResponse(v2.id, { ...base, [smoke.id]: 'Yes' }, ok)).rejects.toMatchObject({ message: expect.stringContaining('Cigarettes per day') });
    await submitResponse(v2.id, { ...base, [smoke.id]: 'Yes', [perDay.id]: 5, [why.id]: 'slow service and cost' }, { ...ok, language: 'nonsense' });
    await expect(submitResponse(v2.id, { ...base, [scale.id]: 11 }, ok)).rejects.toMatchObject({ message: expect.stringContaining('0 to 10') });
    await expect(submitResponse(v2.id, { ...base, [grid.id]: { Fair: 'Agree' } }, ok)).rejects.toMatchObject({ message: expect.stringContaining('every row') });
    await expect(submitResponse(v2.id, { ...base, [grid.id]: { Fair: 'Agree', Fast: 'Maybe' } }, ok)).rejects.toMatchObject({ code: '22023' });
    await expect(submitResponse(v2.id, { ...base, [rank.id]: ['Trust', 'Trust', 'Speed'] }, ok)).rejects.toMatchObject({ message: expect.stringContaining('order') });
    await expect(submitResponse(v2.id, { ...base, [when.id]: '2026-02-30' }, ok)).rejects.toMatchObject({ message: expect.stringContaining('real date') });

    await signIn(A);
    const rows = await listResponses(v2.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].answers).not.toHaveProperty(perDay.id);
    expect(rows[0].answers[rank.id]).toEqual(['Trust', 'Cost', 'Speed']);
    expect(rows[0].language).toBe('tw');
    expect(rows[0].consent_at).toBeTruthy();
    expect(rows[1].language).toBeNull();
    expect(rows[1].answers[perDay.id]).toBe(5);
  });

  it('the owner can code open answers; nobody else can, and other columns stay read-only', async () => {
    await signIn(A);
    const [r1] = await listResponses(v2.id);
    await saveCodes(r1.id, { [why.id]: ['cost'] });
    expect((await listResponses(v2.id))[0].codes).toEqual({ [why.id]: ['cost'] });
    const tamper = await supabase.from('rh_responses').update({ answers: {} }).eq('id', r1.id).select('id');
    expect(tamper.error).toBeTruthy();
    await signIn(B);
    await expect(saveCodes(r1.id, { [why.id]: ['x'] })).rejects.toBeTruthy();
    await anon();
    await expect(saveCodes(r1.id, { [why.id]: ['x'] })).rejects.toBeTruthy();
    await signIn(A);
    expect((await listResponses(v2.id))[0].codes).toEqual({ [why.id]: ['cost'] });
  });

  it('one response per device', async () => {
    await signIn(A);
    await updateRhProject(v2.id, { one_per_device: true });
    await anon();
    const meta = { consent: true, device: 'device-1' };
    await expect(submitResponse(v2.id, base, { consent: true })).rejects.toMatchObject({ code: '22023' });
    await submitResponse(v2.id, base, meta);
    await expect(submitResponse(v2.id, base, meta)).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('already') });
    await submitResponse(v2.id, base, { consent: true, device: 'device-2' });
  });

  it('closes itself at the response limit and at the deadline', async () => {
    await signIn(A);
    await updateRhProject(v2.id, { one_per_device: false, max_responses: 4 });
    await anon();
    expect((await getPublicForm(v2.id))?.closed_reason).toBe('full');
    await expect(submitResponse(v2.id, base, { consent: true })).rejects.toMatchObject({ message: expect.stringContaining('all the responses') });
    await signIn(A);
    await updateRhProject(v2.id, { max_responses: null, closes_at: new Date(Date.now() - 60_000).toISOString() });
    await anon();
    expect((await getPublicForm(v2.id))?.closed_reason).toBe('deadline');
    await expect(submitResponse(v2.id, base, { consent: true })).rejects.toMatchObject({ message: expect.stringContaining('deadline') });
    await signIn(A);
    await updateRhProject(v2.id, { closes_at: new Date(Date.now() + 3_600_000).toISOString() });
    await anon();
    expect((await getPublicForm(v2.id))?.closed_reason).toBeNull();
    expect(await submitResponse(v2.id, base, { consent: true })).toBeTruthy();
  });
});
