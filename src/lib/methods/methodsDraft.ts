// A first draft of the review's methods section, written from what ScreenLab
// holds, in PRISMA 2020 order. Anything ScreenLab cannot know is left as a
// [bracketed] gap for the reviewer to fill.
import type { ProtocolDecision, SearchSource } from '../api/methods';
import type { ExtractionForm } from '../extraction/form';
import type { Project, ProjectStats } from '../types';
import { day } from './prospero';

export interface AgreementSummary { studies: number; cells: number; agreedCells: number }

export interface MethodsInput {
  project: Project;
  stats: ProjectStats;
  sources: SearchSource[];
  duplicatesBeforeImport: number;
  decisions: ProtocolDecision[];
  reviewers: number;
  screeningMode: 'single' | 'dual';
  registrationId: string;
  /** The AI-use paragraph from Methods → AI use, if any AI suggestions were used. */
  aiText: string | null;
  extractionForm: ExtractionForm | null;
  extractionAgreement: AgreementSummary | null;
  robForm: ExtractionForm | null;
  robAgreement: AgreementSummary | null;
  /** The reviewer's synthesis plan (PROSPERO answer), if written. */
  synthesisPlan: string;
  gradeOutcomes: number;
}

export interface MethodsSection { heading: string; text: string }

const n = (v: number) => v.toLocaleString('en-US');
const lines = (s: string | null | undefined) => (s ?? '').split('\n').map((l) => l.trim().replace(/[.;]$/, '')).filter(Boolean);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('; ')}; and ${xs[xs.length - 1]}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '');
const agreementText = (a: AgreementSummary | null, what: string) =>
  a && a.studies ? ` Before discussion, the two reviewers agreed on ${pct(a.agreedCells, a.cells)} of ${what} answers across ${n(a.studies)} double-assessed stud${a.studies === 1 ? 'y' : 'ies'}.` : '';
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function methodsDraft(i: MethodsInput): MethodsSection[] {
  const p = i.project;
  const out: MethodsSection[] = [];
  const dual = i.reviewers >= 2;

  out.push({
    heading: 'Protocol and registration',
    text: `This review followed the PRISMA 2020 statement. The protocol was prepared following PRISMA-P 2015 and registered with PROSPERO (${i.registrationId || '[registration number]'}).` +
      (i.decisions.filter((d) => d.category !== 'registration' && d.category !== 'process').length
        ? ' Decisions and changes made during the review were recorded with dates and reasons and are listed in [Supplementary table].'
        : ''),
  });

  const incl = lines(p.inclusion_criteria);
  const excl = lines(p.exclusion_criteria);
  out.push({
    heading: 'Eligibility criteria',
    text: [
      incl.length ? `Studies were eligible if they met all of the following: ${list(incl.map(lc))}.` : '[Describe the inclusion criteria.]',
      excl.length ? `Studies were excluded if they: ${list(excl.map(lc))}.` : '',
    ].filter(Boolean).join(' '),
  });

  const dbs = i.sources.filter((s) => s.kind !== 'other');
  const other = i.sources.filter((s) => s.kind === 'other');
  const limits = [...new Set(i.sources.map((s) => s.filters?.trim()).filter(Boolean))] as string[];
  out.push({
    heading: 'Information sources and search strategy',
    text: dbs.length
      ? `${dbs.map((s) => `${s.name}${s.searched_on ? ` (searched ${day(s.searched_on)})` : ''}`).join(', ').replace(/, ([^,]*)$/, ' and $1')} ${dbs.length === 1 ? 'was' : 'were'} searched${limits.length ? `, limited to ${limits.join('; ')}` : ''}.` +
        (other.length ? ` Other sources: ${other.map((s) => s.name).join(', ')}.` : ' No other sources were searched.') +
        ' The full search strategy for each database is provided in [Supplementary file].'
      : '[List each database and the date it was searched.] The full search strategy for each database is provided in [Supplementary file].',
  });

  const ta = i.stats.ta_screened, ft = i.stats.ft_screened;
  const dupScreenLab = i.stats.duplicates_removed;
  out.push({
    heading: 'Selection process',
    text: [
      `Records were ${i.duplicatesBeforeImport ? `de-duplicated before import (${n(i.duplicatesBeforeImport)} duplicates removed) and ` : ''}managed in ScreenLab${dupScreenLab ? `, where a further ${n(dupScreenLab)} duplicates were identified and resolved` : ''}.`,
      i.screeningMode === 'dual'
        ? `Two reviewers independently screened titles and abstracts (${n(ta)} records)${i.stats.stage2_enabled ? ` and then full texts (${n(ft)} reports)` : ''}, resolving disagreements by discussion.`
        : `One reviewer screened titles and abstracts (${n(ta)} records)${i.stats.stage2_enabled ? ` and then full texts (${n(ft)} reports)` : ''} against the eligibility criteria, recording a reason for each full-text exclusion.`,
      i.aiText ?? '',
    ].filter(Boolean).join(' '),
  });

  const items = i.extractionForm?.fields.map((f) => f.label.replace(/\s*\(.*\)$/, '')) ?? [];
  out.push({
    heading: 'Data collection process',
    text: i.extractionForm
      ? `${dual ? 'Two reviewers independently extracted data from each included study' : 'One reviewer extracted data from each included study'} using a standard form in ScreenLab, piloted on [number] studies.` +
        (dual ? ' Each reviewer\'s answers were hidden from the other until both had completed the same study; the reviewers then compared their extractions and agreed a final version, with [name] resolving remaining disagreements.' : '') +
        agreementText(i.extractionAgreement, 'extraction')
      : '[Describe how data were extracted, by whom, and how disagreements were resolved.]',
  });
  out.push({
    heading: 'Data items',
    text: items.length ? `The following data were extracted: ${list(items.map(lc))}. Data not reported were recorded as not reported.` : '[List the data items extracted.]',
  });

  const rob = i.robForm;
  const tool = rob?.name ?? (rob ? 'a structured checklist' : '');
  out.push({
    heading: 'Study risk of bias assessment',
    text: rob
      ? `Risk of bias was assessed with ${tool.startsWith('Adapted') || tool.startsWith('JBI') ? `the ${lc(tool)}` : tool}${rob.fields.filter((f) => f.type === 'choice' && f.key !== 'overall').length ? `, comprising ${rob.fields.filter((f) => f.type === 'choice' && f.key !== 'overall').length} items` : ''}, with an overall judgement of low, moderate or high risk of bias for each study.` +
        (dual ? ' Two reviewers appraised each study independently and blind to each other\'s answers, then agreed a final judgement by discussion.' : '') +
        agreementText(i.robAgreement, 'appraisal') +
        ' Results are presented in a traffic-light plot and summary plot.'
      : '[Name the risk-of-bias tool and describe how it was applied.]',
  });

  out.push({
    heading: 'Synthesis methods',
    text: i.synthesisPlan.trim() || '[Describe how results were combined: narrative synthesis structure, grouping, and any meta-analysis.]',
  });

  out.push({
    heading: 'Certainty assessment',
    text: i.gradeOutcomes
      ? `The certainty of evidence for ${n(i.gradeOutcomes)} main outcome${i.gradeOutcomes === 1 ? '' : 's'} was assessed with the GRADE approach, considering risk of bias, inconsistency, indirectness, imprecision and publication bias.`
      : '[Describe how certainty of the evidence was assessed, e.g. GRADE.]',
  });
  return out;
}

export const methodsText = (sections: MethodsSection[]) => sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');
