import { describe, expect, it } from 'vitest';
import { buildUserText, isPdf, parseResult, resultSchema } from '../../supabase/functions/ai-screen/prompt';

const reasons = ['Wrong population', 'Wrong study design'];

describe('AI screening prompt', () => {
  it('includes criteria, allowed reasons, article and stage', () => {
    const t = buildUserText({ inclusion_criteria: 'Adults in ICU', population: 'Adults' }, { title: 'A trial', abstract: 'We studied adults.' }, reasons, 'full_text', 'attached_pdf');
    expect(t).toContain('Inclusion criteria: Adults in ICU');
    expect(t).toContain('- Wrong population');
    expect(t).toContain('Title: A trial');
    expect(t).toContain('FULL-TEXT stage - the full article PDF is attached');
    expect(buildUserText({}, { title: 'x' }, reasons, 'full_text', 'abstract')).toContain('NOT available');
    expect(buildUserText({}, { title: 'x' }, reasons, 'title_abstract', 'abstract')).toContain('(no abstract available)');
  });
  it('schema restricts the exclusion reason to the project list', () => {
    const s = resultSchema(reasons) as { properties: { exclusion_reason: { enum: string[] } } };
    expect(s.properties.exclusion_reason.enum).toEqual(['', ...reasons]);
  });
  it('normalises the model output defensively', () => {
    const r = parseResult(JSON.stringify({ recommendation: 'exclude', exclusion_reason: 'Made up', confidence: 'high', summary: 'No adults.', criteria: [{ criterion: 'Adults', assessment: 'not_met', evidence: 'children aged 5' }] }), reasons);
    expect(r).toMatchObject({ recommendation: 'exclude', exclusion_reason: '', confidence: 'high' });
    expect(parseResult('{"recommendation":"maybe"}', reasons)).toMatchObject({ recommendation: 'unsure', confidence: 'medium', criteria: [] });
    expect(parseResult(JSON.stringify({ recommendation: 'include', exclusion_reason: 'Wrong population' }), reasons).exclusion_reason).toBe('');
  });
  it('detects PDFs by their signature', () => {
    expect(isPdf(new TextEncoder().encode('%PDF-1.7 ...'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('<html>'))).toBe(false);
  });
});
