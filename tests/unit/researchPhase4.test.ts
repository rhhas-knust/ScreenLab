import { describe, expect, it } from 'vitest';
import { checkWebhookUrl, hmacHex, sha256Hex, tableRows, toCsv, toJson, webhookPayload } from '../../supabase/functions/rh-api/format.mjs';
import { statTile } from '../../src/lib/research/dashboard';
import { buildDataset } from '../../src/lib/research/studio';
import type { RhField, RhResponse } from '../../src/lib/api/research';

const f = (id: string, type: RhField['type'], options: string[] = [], settings: RhField['settings'] = {}): RhField =>
  ({ id, project_id: 'p', label: `Label ${id}`, help: null, type, options, required: false, field_order: 0, settings });
const fields = [f('lvl', 'radio', ['100', '200']), f('hrs', 'number'), f('g', 'grid', ['Yes', 'No'], { rows: ['A', 'B'] }), f('pic', 'file'), f('score', 'calc', [], { formula: '' }), f('why', 'text')];
const rs: RhResponse[] = [
  { id: 'r1', project_id: 'p', submitted_at: '2026-10-01T09:00:00Z', answers: { lvl: '100', hrs: 7, g: { A: 'Yes', B: 'No' }, pic: { file: 'p/x/a.png', name: 'a.png', type: 'image/png', size: '9' }, why: '=HYPERLINK("http://evil")' } },
  { id: 'r2', project_id: 'p', submitted_at: '2026-10-02T09:00:00Z', answers: { lvl: '200', why: 'Fine, "really"' } },
];

describe('data link formats', () => {
  it('CSV has one column per question part, names files and defuses formulas', () => {
    const rows = tableRows(fields, rs);
    expect(rows[0]).toEqual(['Response', 'Submitted at', 'Q1. Label lvl', 'Q2. Label hrs', 'Q3_1. Label g — A', 'Q3_2. Label g — B', 'Q4. Label pic', 'Q6. Label why']);
    expect(rows[1]).toEqual(['1', '2026-10-01T09:00:00.000Z', '100', '7', 'Yes', 'No', 'a.png', '=HYPERLINK("http://evil")']);
    const csv = toCsv(rows);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Fine, ""really"""');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('JSON keys answers by question number and leaves file paths out', () => {
    const j = toJson({ id: 'p', title: 'T' }, fields, rs);
    expect(j.questions.map((q) => q.key)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q6']);
    expect(j.responses[0].answers).toMatchObject({ Q1: '100', Q2: 7, Q3: { A: 'Yes', B: 'No' }, Q4: { file_name: 'a.png' } });
    expect(JSON.stringify(j)).not.toContain('p/x/a.png');
    expect(j.responses[1].answers.Q2).toBeNull();
    expect(webhookPayload({ id: 'p', title: 'T' }, fields, rs[1], 2)).toMatchObject({ event: 'response.created', response: { number: 2, id: 'r2', answers: { Q1: '200' } } });
  });
  it('webhooks only go to public https addresses', () => {
    expect(checkWebhookUrl('https://hooks.zapier.com/hooks/catch/1/abc')).toBeNull();
    for (const bad of ['http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://172.20.0.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://u:p@example.com/', 'not a url']) {
      expect(checkWebhookUrl(bad), bad).not.toBeNull();
    }
    expect(checkWebhookUrl('http://localhost:5990/x', true)).toBeNull();
  });
  it('signatures and key hashes use standard SHA-256', async () => {
    // RFC 4231, test case 2
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('dashboard tiles', () => {
  const ds = buildDataset(fields, rs);
  it('counts, means and shares', () => {
    expect(statTile({ id: 'a', kind: 'stat', stat: 'responses' }, ds, 80)).toMatchObject({ value: '2', label: 'Responses' });
    expect(statTile({ id: 'b', kind: 'stat', stat: 'completion' }, ds, 80).value).toBe('80%');
    expect(statTile({ id: 'c', kind: 'stat', stat: 'mean', variable: 'Q2' }, ds, 0)).toMatchObject({ value: '7', label: 'Mean Q2' });
    expect(statTile({ id: 'd', kind: 'stat', stat: 'share', variable: 'Q1', value: '200', label: 'Level 200' }, ds, 0)).toMatchObject({ value: '50%', label: 'Level 200' });
  });
  it('uses weights when they are on', () => {
    const w = buildDataset(fields, rs, new Map([['r1', 0.5], ['r2', 1.5]]));
    expect(statTile({ id: 'd', kind: 'stat', stat: 'share', variable: 'Q1', value: '200' }, w, 0).value).toBe('75%');
  });
  it('says when a question has gone', () => {
    expect(statTile({ id: 'e', kind: 'stat', stat: 'mean', variable: 'Q9' }, ds, 0).sub).toMatch(/no longer available/);
  });
});
