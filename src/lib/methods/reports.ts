// Printable methods documents: the search strategy and the review protocol.
// Pure builders: everything comes from the project record, the search log, the
// decision log and the PROSPERO answers, so the documents always match ScreenLab.
import { CATEGORY_LABEL, type ProtocolDecision, type SearchSource } from '../api/methods';
import type { Project } from '../types';
import { answerFor, day, type ProsperoField, type ProsperoSaved } from './prospero';

export const TO_COMPLETE = '[to complete]';
const lines = (s: string | null | undefined) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const num = (n: number) => n.toLocaleString('en-US');

export interface StrategyDoc {
  rows: { name: string; kind: SearchSource['kind']; date: string; limits: string; records: string }[];
  total: number | null;
  details: { name: string; date: string; limits: string; records: string; strategy: string; notes: string }[];
  duplicatesNote: string | null;
  /** Things the reviewer should fill in before submitting. */
  missing: string[];
}

export function buildSearchStrategy(sources: SearchSource[], duplicatesBeforeImport: number): StrategyDoc {
  const missing: string[] = [];
  const counted = sources.filter((s) => s.results_count != null);
  const rows = sources.map((s) => {
    if (!s.searched_on) missing.push(`${s.name}: date searched`);
    if (s.results_count == null) missing.push(`${s.name}: number of records`);
    if (!s.search_string?.trim()) missing.push(`${s.name}: search string`);
    return {
      name: s.name, kind: s.kind,
      date: s.searched_on ? day(s.searched_on) : TO_COMPLETE,
      limits: s.filters?.trim() || 'None',
      records: s.results_count != null ? num(s.results_count) : TO_COMPLETE,
    };
  });
  return {
    rows,
    total: counted.length ? counted.reduce((a, s) => a + s.results_count!, 0) : null,
    details: sources.map((s, i) => ({ ...rows[i], strategy: s.search_string?.trim() || TO_COMPLETE, notes: s.notes?.trim() ?? '' })),
    duplicatesNote: duplicatesBeforeImport > 0
      ? `Records from all sources were combined and ${num(duplicatesBeforeImport)} duplicates were removed before screening.`
      : null,
    missing,
  };
}

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'fields'; rows: { label: string; text: string }[] }
  | { kind: 'list'; title: string; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };
export interface ProtocolDoc {
  title: string;
  registration: string;
  sections: { heading: string; blocks: Block[] }[];
  missing: string[];
}

/** The protocol, section by section, from the PROSPERO answers (or their drafts) and the project record. */
export function buildProtocol(project: Project, fields: ProsperoField[], saved: ProsperoSaved, sources: SearchSource[], decisions: ProtocolDecision[]): ProtocolDoc {
  const missing: string[] = [];
  const val = (key: string) => {
    const f = fields.find((x) => x.key === key);
    if (!f) return '';
    const v = answerFor(f, saved).trim();
    if (!v) missing.push(f.label);
    else if (/\[[^\]]{4,}\]/.test(v)) missing.push(`${f.label} (still has a [placeholder])`);
    return v || TO_COMPLETE;
  };
  const optional = (key: string) => {
    const f = fields.find((x) => x.key === key);
    return f ? answerFor(f, saved).trim() : '';
  };
  const row = (key: string) => ({ label: fields.find((x) => x.key === key)?.label ?? key, text: val(key) });
  const strategy = buildSearchStrategy(sources, 0);

  const sections: ProtocolDoc['sections'] = [
    {
      heading: 'Review details',
      blocks: [{ kind: 'fields', rows: [row('review_type'), row('start_date'), row('end_date'), row('contact'), row('team'), row('funding'), row('conflicts'), row('country')] }],
    },
    { heading: 'Review question', blocks: [{ kind: 'text', text: val('question') }, { kind: 'fields', rows: [row('condition')] }] },
    {
      heading: 'Eligibility criteria',
      blocks: [
        { kind: 'fields', rows: [row('population'), row('intervention'), row('comparator'), row('main_outcomes'), row('other_outcomes'), row('study_types'), ...(optional('context') ? [row('context')] : []), row('language')] },
        ...(lines(project.inclusion_criteria).length ? [{ kind: 'list' as const, title: 'Inclusion criteria', items: lines(project.inclusion_criteria) }] : []),
        ...(lines(project.exclusion_criteria).length ? [{ kind: 'list' as const, title: 'Exclusion criteria', items: lines(project.exclusion_criteria) }] : []),
      ],
    },
    {
      heading: 'Information sources and searches',
      blocks: [
        { kind: 'text', text: val('searches') },
        ...(sources.length ? [{
          kind: 'table' as const,
          head: ['Source', 'Date searched', 'Limits', 'Records'],
          rows: [...strategy.rows.map((r) => [r.name, r.date, r.limits, r.records]), ...(strategy.total != null ? [['Total', '', '', num(strategy.total)]] : [])],
        }] : []),
        { kind: 'text', text: 'The full search strategy for each source is provided in the separate search strategy document.' },
      ],
    },
    { heading: 'Study selection and data extraction', blocks: [{ kind: 'text', text: val('extraction') }] },
    { heading: 'Risk of bias (quality) assessment', blocks: [{ kind: 'text', text: val('risk_of_bias') }] },
    { heading: 'Data synthesis', blocks: [{ kind: 'text', text: val('synthesis') }, { kind: 'fields', rows: [row('subgroups')] }] },
  ];
  const logged = decisions.filter((d) => d.category !== 'registration');
  if (logged.length) {
    sections.push({
      heading: 'Decisions and changes recorded during the review',
      blocks: [{
        kind: 'table', head: ['Date', 'Type', 'Decision', 'Reason'],
        rows: logged.map((d) => [day(d.decided_on), CATEGORY_LABEL[d.category], [d.title, d.detail?.trim()].filter(Boolean).join('. '), d.rationale?.trim() ?? '']),
      }],
    });
  }
  sections.push({ heading: 'Stage of review, dissemination and keywords', blocks: [{ kind: 'fields', rows: [row('stage'), row('dissemination'), row('keywords')] }] });

  return {
    title: val('title'),
    registration: saved.registration_id ? `PROSPERO ${saved.registration_id}` : '',
    sections,
    missing: [...new Set([...missing, ...strategy.missing])],
  };
}
