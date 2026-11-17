import { describe, expect, it } from 'vitest';
import { auc, predictRelevance, stars, tokens, type Doc } from '../../src/lib/relevance';

// Includes are about LLM bias in clinical triage; excludes are about crop yields.
const topicA = ['large language model bias in emergency triage', 'racial disparities in chatbot clinical advice', 'language model fairness for patient triage decisions'];
const topicB = ['soil nitrogen and wheat crop yield', 'irrigation schedules for maize farms', 'fertiliser effects on rice harvest'];
const docs: Doc[] = [];
for (let i = 0; i < 30; i++) {
  docs.push({ id: `a${i}`, title: `${topicA[i % 3]} ${i}`, abstract: 'We evaluate a model on clinical vignettes for bias and safety.', keywords: 'LLM; triage', label: i < 20 ? 1 : null });
  docs.push({ id: `b${i}`, title: `${topicB[i % 3]} ${i}`, abstract: 'Field trial of agricultural practice across seasons.', keywords: 'agronomy', label: i < 20 ? 0 : null });
}

describe('predicted relevance', () => {
  it('learns from decisions and ranks unscreened look-alikes of the includes higher', () => {
    const r = predictRelevance(docs);
    expect(r.includes).toBe(20);
    expect(r.excludes).toBe(20);
    expect(r.auc).toBeGreaterThan(0.9);
    for (let i = 20; i < 30; i++) expect(r.scores.get(`a${i}`)!).toBeGreaterThan(r.scores.get(`b${i}`)!);
    expect(stars(r.scores.get('a25'))).toBeGreaterThanOrEqual(4);
    expect(stars(r.scores.get('b25'))).toBeLessThanOrEqual(2);
  });
  it('needs a few of each decision first', () => {
    expect(() => predictRelevance(docs.slice(0, 6))).toThrow(/at least 5 included and 5 excluded/);
  });
  it('helpers', () => {
    expect(tokens('The LLMs, in 2024: bias!')).toEqual(['llms', 'bias']);
    expect(auc([0.9, 0.8, 0.1], [1, 0, 0])).toBe(1);
    expect(auc([0.1], [1])).toBeNull();
    expect([0.95, 0.65, 0.5, 0.3, 0.05].map(stars)).toEqual([5, 4, 3, 2, 1]);
  });
});
