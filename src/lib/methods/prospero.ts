// PROSPERO registration helper. Pure: builds a draft answer for each PROSPERO
// field from what the project already holds (protocol fields, search log, decision
// log, screening setup, AI use) and says which fields still need the reviewer.
// Field names follow the PROSPERO form; wording there may differ slightly.
import { REVIEW_TYPE_LABELS, type Project, type ProjectStats } from '../types';
import type { AiDisclosure, ProtocolDecision, SearchSource } from '../api/methods';

export type FieldStatus = 'auto' | 'check' | 'missing' | 'edited';

export interface ProsperoSaved {
  registration_id: string;
  registered_on: string | null;
  /** Reviewer's own text per field key; overrides the generated draft. */
  answers: Record<string, string>;
}
export const EMPTY_PROSPERO: ProsperoSaved = { registration_id: '', registered_on: null, answers: {} };

export interface ProsperoInput {
  project: Project;
  stats: ProjectStats;
  sources: SearchSource[];
  decisions: ProtocolDecision[];
  ai: AiDisclosure | null;
  screeningMode: 'single' | 'dual';
  /** Optional: labels of the extraction form's fields, for the PRISMA-P data items. */
  dataItems?: string[];
  /** Optional: duplicates removed before records reached ScreenLab. */
  duplicatesBeforeImport?: number;
}

/** Fields PRISMA-P asks for that PROSPERO does not; used only for the protocol document. */
export const PROTOCOL_ONLY = 'Protocol only (PRISMA-P items not on the PROSPERO form)';

export interface ProsperoField {
  key: string;
  section: string;
  label: string;
  /** What PROSPERO asks for, in short. */
  asks: string;
  /** Generated draft (empty when ScreenLab cannot know it). */
  draft: string;
  status: Exclude<FieldStatus, 'edited'>;
  /** Why the field needs checking, or what to add. */
  note?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-01" → "1 Sep 2026" (no time zone shifts). */
export function day(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
const lines = (s: string | null | undefined) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
const clean = (s: string | null | undefined) => (s ?? '').trim();
const PUB_TYPE_RE = /(review|opinion|editorial|commentary|letter|protocol|case report|conference|proceedings|book|preprint|erratum|retraction)/i;

function stageOfReview(s: ProjectStats): string {
  const searched = s.total > 0;
  const taDone = s.total > 0 && s.ta_unscreened === 0 && s.ta_maybe === 0;
  const ftDone = !s.stage2_enabled || (s.ft_pool > 0 && s.ft_unscreened === 0);
  const screening = taDone && ftDone ? 'Completed' : s.ta_screened > 0 ? 'Started' : 'Not started';
  return [
    `Preliminary searches: ${searched ? 'Completed' : 'Not started'}`,
    `Piloting of the study selection process: ${s.ta_screened > 0 ? 'Completed' : 'Not started'}`,
    `Formal screening of search results against eligibility criteria: ${screening}`,
    'Data extraction: Not started',
    'Risk of bias (quality) assessment: Not started',
    'Data analysis: Not started',
  ].join('\n');
}

function searchesText(i: ProsperoInput): string {
  const dbs = i.sources.filter((x) => x.kind !== 'other');
  const other = i.sources.filter((x) => x.kind === 'other');
  const parts: string[] = [];
  if (dbs.length) {
    parts.push(`The following sources will be searched: ${dbs.map((x) => x.name + (x.searched_on ? ` (searched ${day(x.searched_on)})` : '')).join('; ')}.`);
  }
  if (other.length) parts.push(`Additional sources: ${other.map((x) => x.name).join('; ')}.`);
  const limits = [...new Set(i.sources.map((x) => clean(x.filters)).filter(Boolean))];
  const restrictions = [
    i.project.date_range && `publication date ${i.project.date_range}`,
    i.project.language && `language: ${i.project.language}`,
    ...limits,
  ].filter(Boolean);
  parts.push(restrictions.length ? `Restrictions: ${restrictions.join('; ')}.` : 'No restrictions on publication date or language.');
  return parts.join(' ');
}

function selectionText(i: ProsperoInput): string {
  const who = i.screeningMode === 'dual'
    ? 'two reviewers independently, with disagreements resolved by discussion'
    : 'one reviewer';
  const parts = [
    `Records will be imported into ScreenLab and duplicates removed. Titles and abstracts will be screened against the eligibility criteria by ${who}${i.stats.stage2_enabled ? ', followed by full-text screening of potentially eligible reports' : ''}. Reasons for exclusion at full text will be recorded.`,
  ];
  if (i.ai && i.ai.suggestions > 0) {
    parts.push('A large language model assistant will be used to suggest eligibility decisions. Suggestions are advisory only; every inclusion and exclusion decision will be made and recorded by a human reviewer.');
  }
  parts.push('Data extraction: [describe the extraction form, the items extracted and who extracts them].');
  return parts.join(' ');
}

function synthesisText(i: ProsperoInput): string {
  const groups = i.decisions.filter((d) => d.category === 'classification');
  if (!groups.length) return '';
  return [
    'Included studies will be grouped as follows:',
    bullets(groups.map((d) => [d.title, clean(d.detail)].filter(Boolean).join(': '))),
    '[Describe the synthesis method, e.g. narrative synthesis structured by group, and whether a meta-analysis is planned.]',
  ].join('\n');
}

/** Build the draft for every PROSPERO field. */
export function prosperoFields(i: ProsperoInput): ProsperoField[] {
  const p = i.project;
  const f: ProsperoField[] = [];
  const add = (section: string, key: string, label: string, asks: string, draft: string, opts: { check?: string; missing?: string } = {}) => {
    const d = draft.trim();
    if (!d) f.push({ key, section, label, asks, draft: '', status: 'missing', note: opts.missing });
    else f.push({ key, section, label, asks, draft: d, status: opts.check ? 'check' : 'auto', note: opts.check });
  };

  // Title and timing
  const T = 'Review title and timescale';
  const typed = /(systematic|scoping|rapid|umbrella) review|meta-analysis/i.test(p.title);
  const typeLabel = REVIEW_TYPE_LABELS[p.review_type]?.toLowerCase() ?? 'systematic review';
  add(T, 'title', 'Review title', 'The working title, which should say what type of review it is.',
    typed ? p.title : `${p.title}: a ${typeLabel}`,
    typed ? {} : { check: `PROSPERO asks the title to name the review type, so ": a ${typeLabel}" was added. Check the wording.` });
  add(T, 'start_date', 'Anticipated or actual start date', 'The date the review started.', day(p.start_date), { missing: 'Add a start date in Settings → Protocol.' });
  add(T, 'end_date', 'Anticipated completion date', 'When you expect to finish.', '', { missing: 'ScreenLab doesn’t know this.' });
  add(T, 'stage', 'Stage of review at time of submission', 'Which stages have started or finished.', stageOfReview(i.stats),
    { check: 'Screening status is from ScreenLab. Update extraction, risk of bias and analysis if you have started them.' });

  // Team
  const R = 'Review team details';
  add(R, 'contact', 'Named contact, email and organisation', 'The person PROSPERO will contact.', '', { missing: 'Your name, email and institution.' });
  add(R, 'team', 'Review team members and affiliations', 'Everyone on the review team.', '', { missing: 'Include your supervisor and any second reviewer.' });
  add(R, 'funding', 'Funding sources / sponsors', 'Who funds the review, or "None".', '', { missing: 'Write "None" if unfunded.' });
  add(R, 'conflicts', 'Conflicts of interest', 'Any conflicts of interest, or "None known".', '', { missing: 'Write "None known" if none.' });

  // Methods
  const M = 'Review methods';
  add(M, 'question', 'Review question', 'The question the review answers.', clean(p.research_question), { missing: 'Add the research question in Settings → Protocol.' });
  add(M, 'searches', 'Searches', 'Databases and other sources, dates, and any restrictions.',
    i.sources.length ? searchesText(i) : '',
    { missing: 'Add each database in Methods → Search log, and this fills itself in.' });
  const strings = i.sources.filter((x) => clean(x.search_string));
  add(M, 'search_strategy', 'Search strategy', 'The full search strategy for at least one database (PROSPERO asks for a link or file).',
    strings.map((x) => `${x.name}:\n${clean(x.search_string)}`).join('\n\n'),
    strings.length ? { check: 'PROSPERO asks for a file: download the Search strategy PDF (Methods → Search log) and upload it.' } : { missing: 'Add the search strings in Methods → Search log.' });
  add(M, 'condition', 'Condition or domain being studied', 'The health condition or topic, in a sentence or two.', '', { missing: 'Describe the topic in your own words.' });
  add(M, 'population', 'Participants / population', 'Who or what is studied, with inclusion and exclusion criteria.', clean(p.population));
  add(M, 'intervention', 'Intervention(s) / exposure(s)', 'What is being tested.', clean(p.intervention_or_exposure));
  add(M, 'comparator', 'Comparator(s) / control', 'What it is compared against.', clean(p.comparator));
  const pubExclusions = lines(p.exclusion_criteria).filter((l) => PUB_TYPE_RE.test(l));
  const studyTypes = [clean(p.study_design), pubExclusions.length ? `Excluded:\n${bullets(pubExclusions)}` : ''].filter(Boolean).join('\n\n');
  add(M, 'study_types', 'Types of study to be included', 'Eligible study designs and publication types.', studyTypes);
  add(M, 'context', 'Context', 'The setting, if relevant (e.g. clinical, country, care level).', '', { missing: 'Optional for some reviews. Leave blank if not relevant.' });
  add(M, 'main_outcomes', 'Main outcome(s)', 'The main outcomes and how effects will be measured.', clean(p.outcomes),
    clean(p.outcomes) ? { check: 'PROSPERO also asks for the measures of effect (e.g. differences in accuracy or refusal rate between groups).' } : {});
  add(M, 'other_outcomes', 'Additional outcome(s)', 'Secondary outcomes, or "None".', '', { missing: 'Write "None" if there are none.' });
  add(M, 'extraction', 'Data extraction (selection and coding)', 'How studies are selected and what data are extracted.', selectionText(i),
    { check: 'The selection part comes from your ScreenLab setup. Fill in the data extraction part.' });
  add(M, 'risk_of_bias', 'Risk of bias (quality) assessment', 'The tool and how it is applied.', '', { missing: 'Name the tool you will use and who applies it.' });
  const synth = synthesisText(i);
  add(M, 'synthesis', 'Strategy for data synthesis', 'How results will be combined.', synth,
    synth ? { check: 'The groups come from your decision log. Add the synthesis method.' } : { missing: 'Describe how results will be combined.' });
  add(M, 'subgroups', 'Analysis of subgroups or subsets', 'Planned subgroup analyses, or "None planned".', '', { missing: 'e.g. by language, by race/ethnicity, by model.' });

  // General
  const G = 'General information';
  add(G, 'review_type', 'Type and method of review', 'The review type.', REVIEW_TYPE_LABELS[p.review_type] ?? '');
  const english = lines(p.exclusion_criteria).some((l) => /non-?english/i.test(l));
  add(G, 'language', 'Language', 'Languages of included studies.', clean(p.language) || (english ? 'English' : ''),
    !clean(p.language) && english ? { check: 'Taken from your exclusion criterion on non-English studies.' } : { missing: 'Which languages will you include?' });
  add(G, 'country', 'Country', 'Where the review is carried out.', '', { missing: 'Your country.' });
  add(G, 'keywords', 'Keywords', 'Words to help others find the record.', '', { missing: 'A few keywords, e.g. large language models; bias; health equity.' });
  add(G, 'dissemination', 'Dissemination plans', 'Where you plan to publish or present.', '', { missing: 'e.g. thesis, journal article.' });

  // PRISMA-P only
  const P = PROTOCOL_ONLY;
  add(P, 'rationale', 'Rationale (item 6)', 'Why the review is needed, in the context of what is already known.', '', { missing: 'Two or three short paragraphs with key references.' });
  add(P, 'contributions', 'Contributions of authors (item 3b)', 'What each author does, and the guarantor.', '', { missing: 'e.g. who designed the search, screened, extracts, appraises, and the guarantor.' });
  add(P, 'sponsor', 'Sponsor (item 5b)', 'The sponsor, or "None".', '', { missing: 'Write "None" if there is no sponsor.' });
  add(P, 'funder_role', 'Role of funder or sponsor (item 5c)', 'Their role in developing the protocol, if any.', '', { missing: 'e.g. "The funder had no role in developing this protocol."' });
  const dups = i.duplicatesBeforeImport ?? 0;
  add(P, 'data_management', 'Data management (item 11a)', 'How records and data are managed through the review.',
    `Records will be ${dups ? `combined and de-duplicated before import (${dups.toLocaleString('en-US')} duplicates removed), then ` : ''}managed in ScreenLab, which stores every record, screening decision (with timestamp and change history), exclusion reason, full-text PDF and extraction; project backups can be exported at any time.`,
    { check: 'Name any reference manager you also used (e.g. Rayyan, EndNote, Zotero).' });
  add(P, 'data_items', 'Data items (item 12)', 'The variables extracted, and any assumptions or simplifications.',
    i.dataItems?.length ? `Data to be extracted: ${i.dataItems.join('; ')}. Data not reported will be recorded as "not reported".` : '',
    i.dataItems?.length ? { check: 'Taken from your extraction form.' } : { missing: 'Set up the extraction form (Extraction page) and this fills itself in.' });
  add(P, 'outcome_priority', 'Outcomes and prioritisation (item 13)', 'Which outcome is primary and which are secondary, with their rationale.', '', { missing: 'Name the primary outcome and any secondary outcomes.' });
  add(P, 'meta_bias', 'Meta-bias(es) (item 16)', 'How publication bias and selective reporting will be assessed.', '', { missing: 'e.g. compare reported outcomes with methods; funnel plot only if 10+ studies are pooled.' });
  add(P, 'confidence', 'Confidence in cumulative evidence (item 17)', 'How the certainty of the evidence will be judged.', '', { missing: 'e.g. GRADE, or a narrative assessment.' });
  return f;
}

/** Decisions recorded on or after the registration date that may need a PROSPERO amendment. */
export function amendments(decisions: ProtocolDecision[], registeredOn: string | null): ProtocolDecision[] {
  return decisions.filter((d) => d.category !== 'registration' && (!registeredOn || d.decided_on >= registeredOn));
}

export function amendmentText(decisions: ProtocolDecision[]): string {
  return decisions.map((d) => [
    `${day(d.decided_on)}: ${d.title}.`,
    clean(d.detail),
    clean(d.rationale) && `Reason: ${clean(d.rationale)}`,
  ].filter(Boolean).join(' ')).join('\n\n');
}

export function prosperoSaved(settings: { settings?: Record<string, unknown> } | undefined): ProsperoSaved {
  const raw = (settings?.settings?.prospero ?? {}) as Partial<ProsperoSaved>;
  const answers: Record<string, string> = {};
  if (raw.answers && typeof raw.answers === 'object') {
    for (const [k, v] of Object.entries(raw.answers)) if (typeof v === 'string') answers[k] = v;
  }
  return {
    registration_id: typeof raw.registration_id === 'string' ? raw.registration_id : '',
    registered_on: typeof raw.registered_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.registered_on) ? raw.registered_on : null,
    answers,
  };
}

/** The text to paste for a field: the reviewer's own answer if saved, otherwise the draft. */
export const answerFor = (field: ProsperoField, saved: ProsperoSaved) => saved.answers[field.key] ?? field.draft;

export function prosperoToText(title: string, fields: ProsperoField[], saved: ProsperoSaved): string {
  const out = [`PROSPERO draft: ${title}`, ''];
  let section = '';
  for (const fl of fields.filter((x) => x.section !== PROTOCOL_ONLY)) {
    if (fl.section !== section) { section = fl.section; out.push(`== ${section.toUpperCase()} ==`, ''); }
    out.push(fl.label, answerFor(fl, saved) || '[to complete]', '');
  }
  return out.join('\n');
}
