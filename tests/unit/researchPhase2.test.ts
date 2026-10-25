import { describe, expect, it } from 'vitest';
import { evaluate, formulaProblem, numericValue, optionOrder, pipe, randomOrder, refsToDisplay, refsToStored, scoreResponses, withScores } from '../../src/lib/research/formula';
import { buildPayload, quotaMessage } from '../../src/lib/research/logic';
import { fieldStats } from '../../src/lib/research/analytics';
import { parseInvitees, type RhField, type RhResponse } from '../../src/lib/api/research';
import { buildEmail } from '../../supabase/functions/rh-invite/email';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const f = (n: number, type: RhField['type'], options: string[] = [], settings: RhField['settings'] = {}): RhField =>
  ({ id: id(n), project_id: 'p', label: `Question ${n}`, help: null, type, options, required: false, field_order: n, settings });
const fields = [
  f(1, 'radio', ['Never', 'Sometimes', 'Often']),
  f(2, 'number'),
  f(3, 'scale', [], { min: 1, max: 5 }),
  f(4, 'grid', ['Disagree', 'Neutral', 'Agree'], { rows: ['A', 'B'] }),
  f(5, 'checkbox', ['x', 'y', 'z']),
  f(6, 'calc', [], { formula: `@${id(2)} + @${id(3)}`, decimals: 1 }),
  f(7, 'calc', [], { formula: `mean(@${id(4)}_1, @${id(4)}_2) * 2 + @${id(6)}` }),
];

describe('question references', () => {
  it('formulas and labels are stored with ids and shown with numbers', () => {
    const stored = refsToStored('Q2 + Q3_1 * 2', fields, true);
    expect(stored).toBe(`@${id(2)} + @${id(3)}_1 * 2`);
    expect(refsToDisplay(stored, fields)).toBe('Q2 + Q3_1 * 2');
    expect(refsToStored('You said {Q1}. Why Q1?', fields)).toBe(`You said {@${id(1)}}. Why Q1?`);
    expect(refsToDisplay(`{@${id(99)}}`, fields)).toBe('{deleted question}');
    // Moving a question changes the number shown, not what it points to.
    expect(refsToDisplay(stored, [fields[2], fields[1], fields[0]])).toBe('Q2 + Q1_1 * 2');
  });
});

describe('calculated scores', () => {
  const a = { [id(1)]: 'Often', [id(2)]: 4, [id(3)]: 5, [id(4)]: { A: 'Agree', B: 'Neutral' }, [id(5)]: ['x', 'z'] };
  it('choices count by position, grids by column, checkboxes by how many', () => {
    expect(numericValue(fields[0], 'Often')).toBe(3);
    expect(numericValue(f(9, 'radio', ['0', '1', '5']), '5')).toBe(5);
    expect(numericValue(fields[3], a[id(4)], 1)).toBe(3);
    expect(numericValue(fields[3], a[id(4)])).toBe(5);
    expect(numericValue(fields[4], ['x', 'z'])).toBe(2);
  });
  it('evaluates arithmetic, functions and scores of scores', () => {
    const s = withScores(fields, a);
    expect(s[id(6)]).toBe(9);
    expect(s[id(7)]).toBe(14);
    expect(evaluate(`if(@${id(2)} > 3, 10, 0) + round(7 / 2) + count(@${id(1)}, @${id(9)})`, fields, a)).toBe(15);
    expect(evaluate('2 ^ 3 ^ 2', fields, a)).toBe(512);
  });
  it('a blank answer makes arithmetic blank but is skipped by sum/mean', () => {
    const b = { [id(2)]: 4 };
    expect(withScores(fields, b)[id(6)]).toBeUndefined();
    expect(evaluate(`sum(@${id(2)}, @${id(3)})`, fields, b)).toBe(4);
    expect(evaluate(`@${id(2)} / 0`, fields, b)).toBeNull();
  });
  it('builder explains formula problems', () => {
    expect(formulaProblem(`@${id(2)} +`, fields, 5)).toMatch(/ends too early/);
    expect(formulaProblem(`@${id(2)} + Q9`, fields, 5)).toMatch(/Q9 is not a question/);
    expect(formulaProblem(`@${id(7)} + 1`, fields, 5)).toMatch(/comes after it/);
    expect(formulaProblem('system(1)', fields, 5)).toMatch(/Unknown word/);
    expect(formulaProblem(`@${id(2)} * 2`, fields, 5)).toBeNull();
  });
  it('scores appear in statistics like a number question', () => {
    const rs: RhResponse[] = [{ id: 'r1', project_id: 'p', submitted_at: '2026-10-01T00:00:00Z', answers: a }, { id: 'r2', project_id: 'p', submitted_at: '2026-10-01T00:00:00Z', answers: { [id(2)]: 1, [id(3)]: 2 } }];
    const st = fieldStats(fields[5], scoreResponses(fields, rs));
    expect(st.kind === 'numeric' && st.mean).toBe(6);
  });
  it('scores and files are never sent with the answers', () => {
    const p = buildPayload([...fields, f(8, 'file')], { ...a, [id(6)]: 99, [id(8)]: 'photo.jpg' });
    expect(Object.keys(p)).not.toContain(id(6));
    expect(Object.keys(p)).not.toContain(id(8));
    expect(p[id(2)]).toBe(4);
  });
});

describe('piping', () => {
  it('replaces references with the answer, or a blank line', () => {
    const label = (_: string, v: unknown) => String(v);
    expect(pipe(`Why “{@${id(1)}}”?`, { [id(1)]: 'Often' }, fields, label)).toBe('Why “Often”?');
    expect(pipe('You are {Q2} years old', {}, fields, label)).toBe('You are ___ years old');
  });
});

describe('randomisation', () => {
  const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
  it('keeps a follow-up right after its question and scores at the end', () => {
    const qs = [f(1, 'radio', ['Yes', 'No']), f(2, 'text', [], { show_if: { field: id(1), op: 'equals', value: 'Yes' } }), f(3, 'number'), f(4, 'calc'), f(5, 'number')];
    for (let k = 0; k < 20; k++) {
      const o = randomOrder(qs).map((x) => x.id);
      expect(o.indexOf(id(2))).toBe(o.indexOf(id(1)) + 1);
      expect(o.at(-1)).toBe(id(4));
    }
    expect(randomOrder(qs, seq([0, 0, 0, 0])).map((x) => x.id)).not.toEqual(qs.map((x) => x.id));
  });
  it('can keep “Other” last', () => {
    for (let k = 0; k < 20; k++) expect(optionOrder(['a', 'b', 'c', 'Other'], true).at(-1)).toBe('Other');
    expect(optionOrder(['a', 'b', 'c'], false).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('quotas and invitations', () => {
  it('a full quota group gets the goodbye message', () => {
    const full = [{ field: id(1), value: 'Often', message: null }];
    expect(quotaMessage(fields[0], 'Often', full)).toMatch(/already have all the responses we need from people who answered “Often”/);
    expect(quotaMessage(fields[0], 'Never', full)).toBeNull();
    expect(quotaMessage(fields[4], ['x'], [{ field: id(5), value: 'x', message: 'Group x is full.' }])).toBe('Group x is full.');
  });
  it('reads pasted lists in common shapes', () => {
    const { people, bad } = parseInvitees('Name,Email\nAma Mensah, AMA@example.com\nKofi Boateng <kofi@example.org>\nyaw@ex.com; efua@ex.com\nama@example.com\nnot an email');
    expect(people).toEqual([
      { email: 'ama@example.com', name: 'Ama Mensah' },
      { email: 'kofi@example.org', name: 'Kofi Boateng' },
      { email: 'yaw@ex.com', name: null },
      { email: 'efua@ex.com', name: null },
    ]);
    expect(bad).toEqual(['not an email']);
  });
  it('emails greet by name, carry the personal link and escape HTML', () => {
    const e = buildEmail('reminder', { id: 'f', title: 'Sleep <study>', university: 'KNUST', department: null, closes_at: null },
      { email: 'a@b.c', name: 'Ama', token: 't' }, 'https://x.test/f/f?i=t', '');
    expect(e.text).toMatch(/^Dear Ama,/);
    expect(e.text).toMatch(/friendly reminder/);
    expect(e.html).toContain('href="https://x.test/f/f?i=t"');
    expect(e.html).toContain('Sleep &lt;study&gt;');
  });
});
