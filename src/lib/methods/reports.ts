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
  | { kind: 'text'; text: string; label?: string }
  | { kind: 'fields'; rows: { label: string; text: string }[] }
  | { kind: 'list'; title: string; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; title: string; text: string };
export interface ProtocolItem { num: string; heading: string; blocks: Block[] }
export interface ProtocolDoc {
  title: string;
  registration: string;
  parts: { heading: string; items: ProtocolItem[] }[];
  missing: string[];
}

/** PRISMA-P 2015 checklist (Moher et al., Syst Rev 2015;4:1): item, topic, where it is reported. */
export const PRISMA_P: [string, string, string][] = [
  ['Administrative information', '1a / 1b', 'Title: identification; update'],
  ['Administrative information', '2', 'Registration'],
  ['Administrative information', '3a / 3b', 'Authors: contact; contributions'],
  ['Administrative information', '4', 'Amendments'],
  ['Administrative information', '5a–5c', 'Support: sources; sponsor; role of sponsor or funder'],
  ['Introduction', '6', 'Rationale'],
  ['Introduction', '7', 'Objectives'],
  ['Methods', '8', 'Eligibility criteria'],
  ['Methods', '9', 'Information sources'],
  ['Methods', '10', 'Search strategy'],
  ['Methods', '11a–11c', 'Study records: data management; selection process; data collection process'],
  ['Methods', '12', 'Data items'],
  ['Methods', '13', 'Outcomes and prioritisation'],
  ['Methods', '14', 'Risk of bias in individual studies'],
  ['Methods', '15a–15d', 'Data synthesis'],
  ['Methods', '16', 'Meta-bias(es)'],
  ['Methods', '17', 'Confidence in cumulative evidence'],
];

/**
 * The protocol in PRISMA-P 2015 order (items 1–17), from the PROSPERO answers (or their
 * drafts), the protocol-only answers, the project record, the search log and the decision log.
 */
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
  const label = (key: string) => fields.find((x) => x.key === key)?.label.replace(/ \(item [^)]*\)$/, '') ?? key;
  const row = (key: string, as?: string) => ({ label: as ?? label(key), text: val(key) });
  const text = (key: string, as?: string): Block => ({ kind: 'text', label: as, text: val(key) });
  const strategy = buildSearchStrategy(sources, 0);
  const logged = decisions.filter((d) => d.category !== 'registration');

  const admin: ProtocolItem[] = [
    { num: '1', heading: 'Title', blocks: [
      { kind: 'text', label: '1a Identification', text: `${val('title')}: protocol` },
      { kind: 'text', label: '1b Update', text: 'This is a new review, not an update of a previous review.' },
    ] },
    { num: '2', heading: 'Registration', blocks: [{ kind: 'text', text: saved.registration_id ? `Registered with PROSPERO: ${saved.registration_id}.` : 'To be registered with PROSPERO; registration number to be added once assigned.' }] },
    { num: '3', heading: 'Authors', blocks: [
      { kind: 'fields', rows: [row('contact', '3a Contact'), row('team', 'Review team'), row('start_date', 'Start date'), row('end_date', 'Anticipated completion'), row('country', 'Country')] },
      text('contributions', '3b Contributions'),
    ] },
    { num: '4', heading: 'Amendments', blocks: [
      { kind: 'text', text: 'Important amendments will be recorded with the date, a description and the reason in the decision log, reported to PROSPERO, and listed in the final review.' },
      ...(logged.length ? [{
        kind: 'table' as const, head: ['Date', 'Type', 'Decision', 'Reason'],
        rows: logged.map((d) => [day(d.decided_on), CATEGORY_LABEL[d.category], [d.title, d.detail?.trim()].filter(Boolean).join('. '), d.rationale?.trim() ?? '']),
      }] : []),
    ] },
    { num: '5', heading: 'Support', blocks: [{ kind: 'fields', rows: [row('funding', '5a Sources'), row('sponsor', '5b Sponsor'), row('funder_role', '5c Role of sponsor or funder'), row('conflicts', 'Conflicts of interest')] }] },
  ];

  const intro: ProtocolItem[] = [
    { num: '6', heading: 'Rationale', blocks: [text('rationale')] },
    { num: '7', heading: 'Objectives', blocks: [
      text('question', 'Review question'),
      { kind: 'fields', rows: [row('population', 'Population'), row('intervention', 'Intervention / exposure'), row('comparator', 'Comparator'), row('main_outcomes', 'Outcomes')] },
    ] },
  ];

  const methods: ProtocolItem[] = [
    { num: '8', heading: 'Eligibility criteria', blocks: [
      { kind: 'fields', rows: [row('study_types', 'Study designs'), ...(optional('context') ? [row('context', 'Context')] : []), row('language', 'Language'), ...(project.date_range ? [{ label: 'Publication dates', text: project.date_range }] : [])] },
      ...(lines(project.inclusion_criteria).length ? [{ kind: 'list' as const, title: 'Inclusion criteria', items: lines(project.inclusion_criteria) }] : []),
      ...(lines(project.exclusion_criteria).length ? [{ kind: 'list' as const, title: 'Exclusion criteria', items: lines(project.exclusion_criteria) }] : []),
    ] },
    { num: '9', heading: 'Information sources', blocks: [
      text('searches'),
      ...(sources.length ? [{
        kind: 'table' as const, head: ['Source', 'Date searched', 'Limits', 'Records'],
        rows: [...strategy.rows.map((r) => [r.name, r.date, r.limits, r.records]), ...(strategy.total != null ? [['Total', '', '', num(strategy.total)]] : [])],
      }] : []),
    ] },
    { num: '10', heading: 'Search strategy', blocks: strategy.details.length
      ? strategy.details.map((d) => ({ kind: 'code' as const, title: `${d.name} (searched ${d.date}; limits: ${d.limits})`, text: d.strategy }))
      : [{ kind: 'text', text: TO_COMPLETE }] },
    { num: '11', heading: 'Study records', blocks: [
      text('data_management', '11a Data management'),
      text('extraction', '11b–11c Selection and data collection process'),
    ] },
    { num: '12', heading: 'Data items', blocks: [text('data_items')] },
    { num: '13', heading: 'Outcomes and prioritisation', blocks: [
      { kind: 'fields', rows: [row('main_outcomes', 'Main outcome(s)'), row('other_outcomes', 'Additional outcome(s)'), row('outcome_priority', 'Prioritisation')] },
    ] },
    { num: '14', heading: 'Risk of bias in individual studies', blocks: [text('risk_of_bias')] },
    { num: '15', heading: 'Data synthesis', blocks: [text('synthesis'), { kind: 'fields', rows: [row('subgroups', 'Additional analyses (subgroups, sensitivity)')] }] },
    { num: '16', heading: 'Meta-bias(es)', blocks: [text('meta_bias')] },
    { num: '17', heading: 'Confidence in cumulative evidence', blocks: [text('confidence')] },
  ];

  const extra: ProtocolItem[] = [
    { num: '', heading: 'Stage of review, dissemination and keywords', blocks: [{ kind: 'fields', rows: [row('stage', 'Stage of review'), row('dissemination', 'Dissemination'), row('keywords', 'Keywords')] }] },
    { num: '', heading: 'PRISMA-P 2015 checklist', blocks: [
      { kind: 'text', text: 'Each item is reported under the heading with the same number. Moher D, Shamseer L, Clarke M, et al. Preferred reporting items for systematic review and meta-analysis protocols (PRISMA-P) 2015 statement. Syst Rev. 2015;4:1.' },
      { kind: 'table', head: ['Section', 'Item', 'Topic'], rows: PRISMA_P.map(([a, b, c]) => [a, b, c]) },
    ] },
  ];

  return {
    title: val('title'),
    registration: saved.registration_id ? `PROSPERO ${saved.registration_id}` : '',
    parts: [
      { heading: 'Administrative information', items: admin },
      { heading: 'Introduction', items: intro },
      { heading: 'Methods', items: methods },
      { heading: 'Additional information', items: extra },
    ],
    missing: [...new Set([...missing, ...strategy.missing])],
  };
}
