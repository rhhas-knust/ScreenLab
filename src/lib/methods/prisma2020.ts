// PRISMA 2020 checklist for the completed review (Page MJ, McKenzie JE, Bossuyt PM,
// et al. BMJ 2021;372:n71). Item wording is abridged; reviewers record where each
// item is reported. "help" says where ScreenLab already provides the material.
import Papa from 'papaparse';

export interface ChecklistItem { id: string; section: string; topic: string; text: string; help?: string }

export const PRISMA_2020: ChecklistItem[] = [
  { id: '1', section: 'Title', topic: 'Title', text: 'Identify the report as a systematic review.' },
  { id: '2', section: 'Abstract', topic: 'Abstract', text: 'See the PRISMA 2020 for Abstracts checklist.' },
  { id: '3', section: 'Introduction', topic: 'Rationale', text: 'Describe the rationale for the review in the context of existing knowledge.' },
  { id: '4', section: 'Introduction', topic: 'Objectives', text: 'Provide an explicit statement of the objective(s) or question(s) the review addresses.' },
  { id: '5', section: 'Methods', topic: 'Eligibility criteria', text: 'Specify the inclusion and exclusion criteria and how studies were grouped for the syntheses.', help: 'Methods → Draft methods' },
  { id: '6', section: 'Methods', topic: 'Information sources', text: 'Specify all databases, registers and other sources searched, with the date each was last searched.', help: 'Methods → Search log' },
  { id: '7', section: 'Methods', topic: 'Search strategy', text: 'Present the full search strategies for all databases, registers and websites, including filters and limits.', help: 'Search strategy PDF' },
  { id: '8', section: 'Methods', topic: 'Selection process', text: 'Specify the methods used to decide eligibility, including how many reviewers screened and any automation tools used.', help: 'Methods → Draft methods and AI use' },
  { id: '9', section: 'Methods', topic: 'Data collection process', text: 'Specify how data were collected, how many reviewers, whether independently, and any confirmation from investigators.', help: 'Extraction → Agreement' },
  { id: '10a', section: 'Methods', topic: 'Data items', text: 'List and define all outcomes for which data were sought.', help: 'Extraction form' },
  { id: '10b', section: 'Methods', topic: 'Data items', text: 'List and define all other variables sought, and assumptions made about missing or unclear information.', help: 'Extraction form' },
  { id: '11', section: 'Methods', topic: 'Study risk of bias assessment', text: 'Specify the tool(s) used, how many reviewers assessed each study and whether independently.', help: 'Risk of bias' },
  { id: '12', section: 'Methods', topic: 'Effect measures', text: 'Specify the effect measure(s) used for each outcome.' },
  { id: '13a', section: 'Methods', topic: 'Synthesis methods', text: 'Describe how studies were chosen for each synthesis.', help: 'Synthesis → Evidence table' },
  { id: '13b', section: 'Methods', topic: 'Synthesis methods', text: 'Describe any methods required to prepare the data for presentation or synthesis.' },
  { id: '13c', section: 'Methods', topic: 'Synthesis methods', text: 'Describe any methods used to tabulate or visually display results.', help: 'Synthesis tables' },
  { id: '13d', section: 'Methods', topic: 'Synthesis methods', text: 'Describe the methods used to synthesise results and the rationale for the choice.' },
  { id: '13e', section: 'Methods', topic: 'Synthesis methods', text: 'Describe any methods used to explore causes of heterogeneity (e.g. subgroup analysis).' },
  { id: '13f', section: 'Methods', topic: 'Synthesis methods', text: 'Describe any sensitivity analyses conducted.' },
  { id: '14', section: 'Methods', topic: 'Reporting bias assessment', text: 'Describe methods used to assess risk of bias due to missing results.' },
  { id: '15', section: 'Methods', topic: 'Certainty assessment', text: 'Describe methods used to assess certainty in the body of evidence.', help: 'Synthesis → GRADE' },
  { id: '16a', section: 'Results', topic: 'Study selection', text: 'Describe the results of the search and selection process, ideally with a flow diagram.', help: 'PRISMA diagram' },
  { id: '16b', section: 'Results', topic: 'Study selection', text: 'Cite studies that might appear to meet the criteria but were excluded, and explain why.', help: 'References → full-text exclusions' },
  { id: '17', section: 'Results', topic: 'Study characteristics', text: 'Cite each included study and present its characteristics.', help: 'Extraction → characteristics table' },
  { id: '18', section: 'Results', topic: 'Risk of bias in studies', text: 'Present assessments of risk of bias for each included study.', help: 'Risk of bias → traffic-light plot' },
  { id: '19', section: 'Results', topic: 'Results of individual studies', text: 'For all outcomes, present summary statistics for each study and an effect estimate where possible.', help: 'Synthesis → Evidence table' },
  { id: '20a', section: 'Results', topic: 'Results of syntheses', text: 'For each synthesis, briefly summarise the characteristics and risk of bias among contributing studies.', help: 'Synthesis → Cross-tabulation' },
  { id: '20b', section: 'Results', topic: 'Results of syntheses', text: 'Present results of all statistical syntheses conducted, or describe the results if not statistical.' },
  { id: '20c', section: 'Results', topic: 'Results of syntheses', text: 'Present results of all investigations of possible causes of heterogeneity.' },
  { id: '20d', section: 'Results', topic: 'Results of syntheses', text: 'Present results of all sensitivity analyses conducted.' },
  { id: '21', section: 'Results', topic: 'Reporting biases', text: 'Present assessments of risk of bias due to missing results for each synthesis.' },
  { id: '22', section: 'Results', topic: 'Certainty of evidence', text: 'Present assessments of certainty in the body of evidence for each outcome.', help: 'Synthesis → GRADE' },
  { id: '23a', section: 'Discussion', topic: 'Discussion', text: 'Provide a general interpretation of the results in the context of other evidence.' },
  { id: '23b', section: 'Discussion', topic: 'Discussion', text: 'Discuss any limitations of the evidence included in the review.' },
  { id: '23c', section: 'Discussion', topic: 'Discussion', text: 'Discuss any limitations of the review processes used.' },
  { id: '23d', section: 'Discussion', topic: 'Discussion', text: 'Discuss implications of the results for practice, policy and future research.' },
  { id: '24a', section: 'Other information', topic: 'Registration and protocol', text: 'Provide registration information, including register name and number, or state that it was not registered.', help: 'Methods → PROSPERO' },
  { id: '24b', section: 'Other information', topic: 'Registration and protocol', text: 'Indicate where the review protocol can be accessed, or state that a protocol was not prepared.', help: 'Protocol PDF' },
  { id: '24c', section: 'Other information', topic: 'Registration and protocol', text: 'Describe and explain any amendments to information provided at registration or in the protocol.', help: 'Methods → Decision log' },
  { id: '25', section: 'Other information', topic: 'Support', text: 'Describe sources of financial or non-financial support, and the role of the funders or sponsors.' },
  { id: '26', section: 'Other information', topic: 'Competing interests', text: 'Declare any competing interests of review authors.' },
  { id: '27', section: 'Other information', topic: 'Availability of data, code and other materials', text: 'Report which materials are publicly available and where: data collection forms, extracted data, analytic code and other materials.', help: 'Extraction and risk-of-bias CSV exports' },
];

export function readChecklist(settings: { settings?: Record<string, unknown> } | undefined): Record<string, string> {
  const raw = settings?.settings?.prisma2020;
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  return out;
}

export const checklistProgress = (where: Record<string, string>) => PRISMA_2020.filter((i) => where[i.id]?.trim()).length;

export function checklistCsv(where: Record<string, string>): string {
  return '﻿' + Papa.unparse([
    ['Section', 'Topic', 'Item', 'Checklist item', 'Location where item is reported'],
    ...PRISMA_2020.map((i) => [i.section, i.topic, i.id, i.text, where[i.id] ?? '']),
  ]);
}
