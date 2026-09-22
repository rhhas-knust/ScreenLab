import { supabase } from '../supabase';
import { must } from '../errors';
import type { Project } from '../types';
import { createProject, logActivity } from './projects';
import { detectAllDuplicates } from './duplicates';

/**
 * DEMO DATA — every reference below is invented. Titles are prefixed with
 * "[DEMO]", journals are clearly fictional, and DOIs use the 10.5555 test
 * prefix, so none of them can be mistaken for a real publication.
 */
const J1 = 'Demo Journal of Imaginary Infection Control (fictional)';
const J2 = 'ScreenLab Practice Letters (fictional)';
const J3 = 'Fictional Proceedings on Pretend Biosensors';

type DemoRef = {
  title: string; authors: string; year: number; journal: string; abstract: string; keywords: string;
  database_source: string; publication_type: string; doi?: string; pmid?: string; language?: string;
};

const REFS: DemoRef[] = [
  { title: '[DEMO] A pretend machine-learning model for spotting imaginary hospital infections', authors: 'Example, Alice; Sample, Bob', year: 2022, journal: J1, database_source: 'PubMed', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-01', pmid: 'DEMO-0001', keywords: 'machine learning; hospital-acquired infection; demo',
    abstract: 'DEMO DATA — this abstract is fictional. Background: invented hospitals report invented infections. Methods: a pretend gradient-boosting model was trained on 1,000 imaginary patient records. Results: the fictional model achieved an invented AUROC of 0.87. Conclusion: this record exists only to practise screening in ScreenLab.' },
  { title: '[DEMO] Deep learning on made-up ward data to predict fictional bloodstream infections', authors: 'Placeholder, Carol; Mock, Dan', year: 2023, journal: J1, database_source: 'Scopus', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-02', keywords: 'deep learning; bloodstream infection; demo',
    abstract: 'DEMO DATA — fictional. A pretend convolutional network analysed imaginary vital signs from 12 invented wards. The made-up sensitivity was 0.81. Use this record to practise an Include decision.' },
  { title: '[DEMO] Imaginary electrochemical biosensor for detecting a pretend pathogen', authors: 'Fictitious, Erin', year: 2021, journal: J3, database_source: 'Web of Science', publication_type: 'Conference Paper', doi: '10.5555/screenlab-demo-03', keywords: 'biosensor; electrochemical; pathogen detection; demo',
    abstract: 'DEMO DATA — fictional. We describe a biosensor that does not exist, tested on a pathogen that does not exist, with invented detection limits. Useful for practising the Wrong population / Wrong intervention exclusion reasons.' },
  { title: '[DEMO] Hand hygiene posters in a fictional paediatric unit: an invented before-and-after study', authors: 'Sample, Bob; Dummy, Frank', year: 2019, journal: J2, database_source: 'CINAHL', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-04', keywords: 'hand hygiene; paediatrics; demo',
    abstract: 'DEMO DATA — fictional. Pretend posters were placed in an imaginary unit. Invented compliance rose from 40% to 55%. This is not a machine-learning study, so it is a good practice record to Exclude (wrong intervention).' },
  { title: '[DEMO] A pretend machine-learning model for spotting imaginary hospital infections', authors: 'Example, A.; Sample, B.', year: 2022, journal: J1, database_source: 'Scopus', publication_type: 'Journal Article', doi: 'https://doi.org/10.5555/SCREENLAB-DEMO-01', keywords: 'machine learning; demo',
    abstract: 'DEMO DATA — duplicate of the first demo record (same DOI, imported from a second database). Use it to practise duplicate detection and merging.' },
  { title: '[DEMO] Random forests for fictional surgical-site infection surveillance', authors: 'Mock, Dan; Template, Grace', year: 2020, journal: J1, database_source: 'Embase', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-06', keywords: 'random forest; surgical site infection; surveillance; demo',
    abstract: 'DEMO DATA — fictional. An invented random-forest model flagged imaginary surgical-site infections in 3 pretend hospitals. Invented PPV 0.64. Candidate for Maybe while you check the (fictional) infection definition.' },
  { title: '[DEMO] Opinion: should imaginary hospitals trust pretend algorithms?', authors: 'Opinionated, Hal', year: 2021, journal: J2, database_source: 'Google Scholar', publication_type: 'Editorial', keywords: 'editorial; demo',
    abstract: 'DEMO DATA — fictional editorial with no primary data. Practise excluding for "Wrong publication type".' },
  { title: '[DEMO] Natural language processing of invented clinical notes to detect fictional pneumonia', authors: 'Placeholder, Carol; Example, Alice; Stub, Ivy', year: 2024, journal: J1, database_source: 'PubMed', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-08', pmid: 'DEMO-0008', keywords: 'NLP; ventilator-associated pneumonia; demo',
    abstract: 'DEMO DATA — fictional. Pretend NLP rules scanned 50,000 imaginary notes. Invented F1 score 0.79. A plausible Include for practice.' },
  { title: '[DEMO] A fictional survey of pretend nurses about imaginary infection dashboards', authors: 'Survey, Jack', year: 2018, journal: J2, database_source: 'CINAHL', publication_type: 'Journal Article', keywords: 'survey; nurses; demo',
    abstract: 'DEMO DATA — fictional cross-sectional survey. No predictive model was developed. Practise excluding for "Wrong study design".' },
  { title: '[DEMO] Invented biosensor array for pretend urinary tract infection screening at the bedside', authors: 'Fictitious, Erin; Stub, Ivy', year: 2023, journal: J3, database_source: 'IEEE Xplore', publication_type: 'Conference Paper', doi: '10.5555/screenlab-demo-10', keywords: 'biosensor; UTI; point-of-care; demo',
    abstract: 'DEMO DATA — fictional. An imaginary sensor array detected invented bacteria in pretend urine samples within 20 minutes.' },
  { title: '[DEMO] Machine learning for imaginary Clostridioides infection risk in a fictional ICU', authors: 'Template, Grace; Mock, Dan', year: 2021, journal: J1, database_source: 'Web of Science', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-11', keywords: 'machine learning; ICU; demo',
    abstract: 'DEMO DATA — fictional retrospective cohort of 8,000 invented ICU admissions. A pretend logistic-regression and XGBoost comparison. Tag this one "Needs Full Text" to practise tags.' },
  { title: '[DEMO] Un modèle fictif pour détecter des infections imaginaires', authors: 'Exemple, Claire', year: 2020, journal: J2, database_source: 'Embase', publication_type: 'Journal Article', language: 'French', keywords: 'demo; language',
    abstract: 'DEMO DATA — résumé fictif en français. Practise the "Wrong language" exclusion reason and the Language filter.' },
  { title: '[DEMO] Pretend conference abstract on imaginary sepsis alerts', authors: 'Brief, Kim', year: 2022, journal: J3, database_source: 'Scopus', publication_type: 'Conference Abstract', keywords: 'sepsis; alerts; demo',
    abstract: 'DEMO DATA — a short fictional conference abstract. Practise the "Conference abstract" exclusion reason.' },
  { title: '[DEMO] Natural-language processing of invented clinical notes to detect fictional pneumonia', authors: 'Placeholder, C.; Example, A.', year: 2024, journal: J1, database_source: 'Embase', publication_type: 'Journal Article', keywords: 'NLP; demo',
    abstract: 'DEMO DATA — near-identical title to another demo record (differs only by a hyphen) and no DOI. Shows title + year duplicate matching.' },
  { title: '[DEMO] A 1998 fictional study of pretend infection counting by hand', authors: 'Oldtimer, Lee', year: 1998, journal: J2, database_source: 'PubMed', publication_type: 'Journal Article', pmid: 'DEMO-0015', keywords: 'surveillance; demo',
    abstract: 'DEMO DATA — fictional and deliberately old. Practise the "Outside date range" exclusion reason and the Year filter.' },
  { title: '[DEMO] Transfer learning across imaginary hospitals for fictional catheter infections', authors: 'Stub, Ivy; Template, Grace', year: 2025, journal: J1, database_source: 'Scopus', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-16', keywords: 'transfer learning; CLABSI; demo',
    abstract: 'DEMO DATA — fictional. A pretend model trained in one invented hospital was tested in two others. Invented AUROC dropped from 0.90 to 0.74.' },
  { title: '[DEMO] Invented systematic review of pretend infection prediction tools', authors: 'Reviewer, Max; Example, Alice', year: 2024, journal: J2, database_source: 'Google Scholar', publication_type: 'Review', doi: '10.5555/screenlab-demo-17', keywords: 'systematic review; demo',
    abstract: 'DEMO DATA — a fictional review. Reviews are often excluded from a systematic review but checked for extra references: try tagging it "Check Later".' },
  { title: '[DEMO] Graphene-free imaginary sensor for detecting fictional MRSA on pretend surfaces', authors: 'Fictitious, Erin; Surface, Nia', year: 2022, journal: J3, database_source: 'IEEE Xplore', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-18', keywords: 'biosensor; MRSA; environment; demo',
    abstract: 'DEMO DATA — fictional environmental swab sensor. Invented sensitivity 92%.' },
  { title: '[DEMO] Federated learning for fictional antimicrobial resistance prediction in a pretend network of clinics', authors: 'Network, Omar; Mock, Dan', year: 2025, journal: J1, database_source: 'PubMed', publication_type: 'Journal Article', doi: '10.5555/screenlab-demo-19', pmid: 'DEMO-0019', keywords: 'federated learning; antimicrobial resistance; Ghana; demo',
    abstract: 'DEMO DATA — fictional. Five imaginary clinics trained a shared model without sharing invented data.' },
  { title: '[DEMO] Record with no abstract (fictional)', authors: 'Missing, Pat', year: 2023, journal: J2, database_source: 'Other', publication_type: 'Journal Article', keywords: 'demo',
    abstract: '' },
];

export async function createDemoProject(): Promise<Project> {
  const project = await createProject({
    title: 'DEMO — Fictional Practice Review (Machine Learning for Imaginary Hospital Infections)',
    description: 'DEMO DATA. Every reference in this project is fictional and exists only to practise using ScreenLab. Delete this project whenever you like.',
    research_question: 'DEMO: How accurate are (fictional) machine-learning models for detecting (imaginary) hospital-acquired infections?',
    review_type: 'systematic',
    inclusion_criteria: '• Primary studies developing or validating a machine-learning / AI model\n• Hospital-acquired infections\n• Published 2015 or later\n• English language',
    exclusion_criteria: '• Editorials, opinion pieces, conference abstracts\n• No predictive model (e.g. surveys, hygiene interventions)\n• Published before 2015\n• Not in English',
    population: 'Hospitalised patients (fictional)',
    intervention_or_exposure: 'Machine-learning detection or prediction models',
    comparator: 'Standard surveillance or clinical judgement',
    outcomes: 'Diagnostic accuracy (AUROC, sensitivity, specificity)',
    study_design: 'Cohort, case-control, diagnostic accuracy studies',
    date_range: '2015 – present',
    language: 'English',
    is_demo: true,
  });
  const batch = must(await supabase.from('import_batches').insert({
    project_id: project.id, file_name: 'demo-data (built in)', file_format: 'demo', database_source: 'Multiple (demo)',
    records_detected: REFS.length, records_imported: REFS.length,
  }).select('id').single()) as { id: string };
  must(await supabase.from('study_references').insert(REFS.map((r) => ({
    project_id: project.id,
    import_batch_id: batch.id,
    title: r.title, authors: r.authors, year: r.year, journal: r.journal, abstract: r.abstract || null,
    keywords: r.keywords, database_source: r.database_source, publication_type: r.publication_type,
    doi: r.doi ?? null, pmid: r.pmid ?? null, language: r.language ?? 'English',
    original_record: { demo: true },
  }))));
  for (const name of ['ML', 'Deep Learning', 'Biosensor', 'Hospital', 'Needs Full Text', 'Check Later']) {
    await supabase.from('tags').insert({ project_id: project.id, name });
  }
  await logActivity(project.id, 'import', `Imported ${REFS.length} fictional DEMO references`);
  await detectAllDuplicates(project.id);
  return project;
}
