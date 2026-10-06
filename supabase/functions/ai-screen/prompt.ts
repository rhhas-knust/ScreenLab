// Pure helpers for the ai-screen function (no Deno/Node APIs, unit-tested in tests/unit).

export interface ProjectCriteria {
  research_question?: string | null;
  inclusion_criteria?: string | null;
  exclusion_criteria?: string | null;
  population?: string | null;
  intervention_or_exposure?: string | null;
  comparator?: string | null;
  outcomes?: string | null;
  study_design?: string | null;
  date_range?: string | null;
  language?: string | null;
}

export interface ArticleInfo {
  title?: string | null;
  abstract?: string | null;
  keywords?: string | null;
  year?: number | null;
  journal?: string | null;
  publication_type?: string | null;
  language?: string | null;
}

export type Stage = 'title_abstract' | 'full_text';
export type Source = 'abstract' | 'attached_pdf' | 'open_access_pdf';

export interface AiResult {
  recommendation: 'include' | 'exclude' | 'unsure';
  exclusion_reason: string;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  criteria: { criterion: string; assessment: 'met' | 'not_met' | 'unclear'; evidence: string }[];
}

export const SYSTEM_PROMPT = `You assist a researcher screening studies for a systematic review.
You give a suggestion only; the researcher makes and records every decision.

Assess the article strictly against the review's eligibility criteria:
- Go through each inclusion/exclusion criterion (and each PICO element that is specified) and say whether the article meets it, does not meet it, or whether this is unclear from the text provided.
- Support every assessment with a short verbatim quote from the article (or "not reported").
- Recommend "exclude" only when at least one criterion is clearly not met, and pick the single best matching exclusion reason from the allowed list.
- Recommend "include" only when every criterion is met or plausibly met.
- Otherwise recommend "unsure" and say what the reviewer should check.
- At the title/abstract stage, when in doubt lean towards "include" or "unsure" (full text will be checked later).
- Never invent details that are not in the text. Write plainly and briefly.`;

const line = (label: string, v?: string | number | null) => (v === null || v === undefined || v === '' ? '' : `${label}: ${v}\n`);

export function buildUserText(p: ProjectCriteria, a: ArticleInfo, reasons: string[], stage: Stage, source: Source): string {
  const criteria =
    line('Research question', p.research_question) +
    line('Inclusion criteria', p.inclusion_criteria) +
    line('Exclusion criteria', p.exclusion_criteria) +
    line('Population', p.population) +
    line('Intervention / exposure', p.intervention_or_exposure) +
    line('Comparator', p.comparator) +
    line('Outcomes', p.outcomes) +
    line('Study designs', p.study_design) +
    line('Date range', p.date_range) +
    line('Language', p.language);
  const article =
    line('Title', a.title) + line('Year', a.year) + line('Journal', a.journal) +
    line('Publication type', a.publication_type) + line('Language', a.language) +
    line('Keywords', a.keywords) + line('Abstract', a.abstract || '(no abstract available)');
  const stageText = stage === 'full_text'
    ? source === 'abstract'
      ? 'FULL-TEXT stage, but the full text is NOT available to you - judge from the abstract only and say so in the summary.'
      : 'FULL-TEXT stage - the full article PDF is attached above; base your assessment on it.'
    : 'TITLE/ABSTRACT stage - judge from the title and abstract.';
  return `<review_criteria>\n${criteria || '(no criteria recorded)'}</review_criteria>\n\n` +
    `<allowed_exclusion_reasons>\n${reasons.map((r) => `- ${r}`).join('\n')}\n</allowed_exclusion_reasons>\n\n` +
    `<article>\n${article}</article>\n\n${stageText}`;
}

export function resultSchema(reasons: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['recommendation', 'exclusion_reason', 'confidence', 'summary', 'criteria'],
    properties: {
      recommendation: { type: 'string', enum: ['include', 'exclude', 'unsure'] },
      exclusion_reason: {
        type: 'string', enum: ['', ...reasons],
        description: 'One of the allowed exclusion reasons when recommending exclude; empty string otherwise.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string', description: 'Two or three sentences explaining the suggestion.' },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'assessment', 'evidence'],
          properties: {
            criterion: { type: 'string' },
            assessment: { type: 'string', enum: ['met', 'not_met', 'unclear'] },
            evidence: { type: 'string', description: 'Short verbatim quote, or "not reported".' },
          },
        },
      },
    },
  };
}

/** Validate and normalise the model's JSON (defensive even with structured outputs). */
export function parseResult(text: string, reasons: string[]): AiResult {
  const j = JSON.parse(text) as Partial<AiResult>;
  const rec = j.recommendation === 'include' || j.recommendation === 'exclude' ? j.recommendation : 'unsure';
  const reason = rec === 'exclude' && typeof j.exclusion_reason === 'string' && reasons.includes(j.exclusion_reason) ? j.exclusion_reason : '';
  const conf = j.confidence === 'high' || j.confidence === 'low' ? j.confidence : 'medium';
  const criteria = Array.isArray(j.criteria) ? j.criteria.filter((c) => c && typeof c.criterion === 'string').slice(0, 30).map((c) => ({
    criterion: String(c.criterion).slice(0, 500),
    assessment: c.assessment === 'met' || c.assessment === 'not_met' ? c.assessment : 'unclear' as const,
    evidence: String(c.evidence ?? '').slice(0, 1000),
  })) : [];
  return { recommendation: rec, exclusion_reason: reason, confidence: conf, summary: String(j.summary ?? '').slice(0, 2000), criteria };
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}
