/**
 * Criteria keywords — a reading and filtering aid.
 *
 * The researcher lists words/phrases that signal inclusion or exclusion.
 * ScreenLab highlights them and can filter by them. It never makes a decision.
 * Terms are case-insensitive; a trailing * matches any ending (child* → children).
 */
export interface CriteriaTerms {
  include: string[];
  exclude: string[];
}

export const EMPTY_TERMS: CriteriaTerms = { include: [], exclude: [] };

/** Parse a textarea (one term per line, or separated by commas / semicolons). */
export function parseTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.replace(/\s+/g, ' ').replace(/["%_]/g, '').trim().toLowerCase();
    if (t.length >= 2 && t.length <= 80 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 60);
}

export function termsFromSettings(settings: Record<string, unknown> | null | undefined): CriteriaTerms {
  const c = (settings?.criteria_terms ?? {}) as Partial<CriteriaTerms>;
  return {
    include: Array.isArray(c.include) ? c.include.filter((x) => typeof x === 'string') : [],
    exclude: Array.isArray(c.exclude) ? c.exclude.filter((x) => typeof x === 'string') : [],
  };
}

export const hasTerms = (t: CriteriaTerms) => t.include.length > 0 || t.exclude.length > 0;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex source for one term: word start, optional trailing wildcard. */
export function termPattern(term: string): string {
  const wild = term.endsWith('*');
  const body = escapeRe(wild ? term.slice(0, -1) : term).replace(/\s+/g, '[\\s-]+');
  return `\\b${body}${wild ? '\\w*' : '\\b'}`;
}

/** Terms (as written) that occur in the text. */
export function matchTerms(text: string | null | undefined, terms: string[]): string[] {
  if (!text || !terms.length) return [];
  return terms.filter((t) => new RegExp(termPattern(t), 'i').test(text));
}

export function referenceText(r: { title?: string | null; abstract?: string | null; keywords?: string | null }): string {
  return [r.title, r.abstract, r.keywords].filter(Boolean).join(' \n ');
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'without', 'by', 'at', 'from', 'as', 'be', 'is', 'are',
  'that', 'which', 'who', 'their', 'its', 'any', 'all', 'only', 'not', 'no', 'studies', 'study', 'articles', 'article', 'papers',
  'paper', 'records', 'include', 'included', 'including', 'exclude', 'excluded', 'excluding', 'using', 'use', 'used', 'based',
  'reporting', 'report', 'reports', 'published', 'must', 'should', 'will', 'were', 'was', 'e.g', 'eg', 'i.e', 'ie', 'etc', 'other',
  'than', 'such', 'where', 'into', 'about', 'between', 'within', 'more', 'less', 'least', 'one', 'two', 'three',
  'developing', 'developed', 'develop', 'evaluating', 'evaluated', 'assessing', 'assessed', 'describing', 'described',
  'investigating', 'examining', 'later', 'earlier', 'after', 'before', 'since', 'year', 'years', 'if', 'do', 'does', 'have', 'has',
]);

/**
 * Suggest candidate terms from free-text criteria (the researcher reviews and
 * edits them before saving). Splits on lines, bullets and punctuation, drops
 * filler words, and keeps short phrases.
 */
export function suggestTerms(criteria: string | null | undefined): string[] {
  if (!criteria) return [];
  const out: string[] = [];
  const chunks = criteria
    .split(/\n|[•·;:,()/]|\s-\s|\.\s|\band\b|\bor\b/i)
    .map((c) => c.replace(/^\s*([-*•\d.)]+\s*)/, '').trim().toLowerCase())
    .filter(Boolean);
  const add = (t: string) => {
    if (t.length >= 3 && !/^\d+$/.test(t) && !out.includes(t)) out.push(t);
  };
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter(Boolean);
    // Runs of content words between filler words become candidate phrases
    let run: string[] = [];
    const flush = () => {
      if (run.length && run.length <= 4) add(run.join(' '));
      else for (const w of run) if (w.length > 3) add(w);
      run = [];
    };
    for (const w of words) {
      if (STOP.has(w) || /^\d+$/.test(w)) flush();
      else run.push(w);
    }
    flush();
  }
  return out.slice(0, 30);
}
