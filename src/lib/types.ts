export type ReviewType = 'systematic' | 'scoping' | 'literature' | 'other';
export type Stage = 'title_abstract' | 'full_text';
export type Decision = 'include' | 'exclude' | 'maybe';
export type DuplicateStatus = 'none' | 'possible' | 'duplicate' | 'kept' | 'merged';
export type FullTextStatus = 'not_available' | 'available' | 'reviewed';

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  systematic: 'Systematic Review',
  scoping: 'Scoping Review',
  literature: 'Literature Review',
  other: 'Other',
};

export interface Project {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  research_question: string | null;
  review_type: ReviewType;
  inclusion_criteria: string | null;
  exclusion_criteria: string | null;
  population: string | null;
  intervention_or_exposure: string | null;
  comparator: string | null;
  outcomes: string | null;
  study_design: string | null;
  date_range: string | null;
  language: string | null;
  start_date: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectSettings {
  project_id: string;
  stage2_enabled: boolean;
  keyboard_shortcuts_enabled: boolean;
  screening_mode: 'single' | 'dual';
  additional_records_other_sources: number;
  prisma_notes: string | null;
  settings: Record<string, unknown>;
  updated_at: string;
}

/** Bibliographic fields that can be imported / exported. */
export const BIB_FIELDS = [
  'title', 'authors', 'abstract', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'pmid',
  'url', 'keywords', 'publication_type', 'database_source', 'language',
] as const;
export type BibField = (typeof BIB_FIELDS)[number];

export interface BibRecord {
  title: string | null;
  authors: string | null;
  abstract: string | null;
  year: number | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pmid: string | null;
  url: string | null;
  keywords: string | null;
  publication_type: string | null;
  database_source: string | null;
  language: string | null;
}

export interface Reference extends BibRecord {
  id: string;
  project_id: string;
  seq: number;
  import_batch_id: string | null;
  original_record: Record<string, unknown> | null;
  imported_at: string;
  title_abstract_decision: Decision | null;
  title_abstract_screened_at: string | null;
  title_abstract_exclusion_reason: string | null;
  full_text_decision: 'include' | 'exclude' | null;
  full_text_screened_at: string | null;
  full_text_exclusion_reason: string | null;
  notes: string | null;
  tag_names: string[];
  full_text_url: string | null;
  full_text_status: FullTextStatus;
  duplicate_status: DuplicateStatus;
  duplicate_group_id: string | null;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Light-weight row for lists. */
export type ReferenceListItem = Pick<
  Reference,
  | 'id' | 'seq' | 'title' | 'authors' | 'year' | 'journal' | 'database_source'
  | 'title_abstract_decision' | 'title_abstract_exclusion_reason' | 'title_abstract_screened_at'
  | 'full_text_decision' | 'full_text_exclusion_reason' | 'full_text_screened_at'
  | 'duplicate_status' | 'tag_names' | 'full_text_status'
>;

export interface ExclusionReason {
  id: string;
  project_id: string;
  label: string;
  stage: 'both' | 'title_abstract' | 'full_text';
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  user_id: string | null;
  user_email: string | null;
  reference_id: string | null;
  action: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ScreeningDecisionRow {
  id: string;
  project_id: string;
  reference_id: string;
  reviewer_id: string | null;
  stage: Stage;
  decision: Decision | null;
  exclusion_reason: string | null;
  previous_decision: Decision | null;
  previous_exclusion_reason: string | null;
  action: 'decide' | 'change' | 'undo' | 'clear' | 'restore';
  client_created_at: string | null;
  created_at: string;
}

export interface DuplicateGroup {
  id: string;
  project_id: string;
  match_type: 'doi' | 'pmid' | 'title_year' | 'fuzzy_title' | 'manual';
  match_score: number | null;
  status: 'open' | 'resolved';
  resolution: 'merged' | 'kept_all' | 'marked_duplicate' | null;
  primary_reference_id: string | null;
  resolution_details: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FullTextFile {
  id: string;
  project_id: string;
  reference_id: string;
  storage_path: string;
  file_name: string | null;
  file_size: number | null;
  content_type: string | null;
  uploaded_at: string;
}

export interface ProjectStats {
  total: number;
  duplicates_removed: number;
  possible_duplicates: number;
  after_dedup: number;
  ta_screened: number;
  ta_unscreened: number;
  ta_include: number;
  ta_exclude: number;
  ta_maybe: number;
  ft_pool: number;
  ft_screened: number;
  ft_include: number;
  ft_exclude: number;
  ft_unscreened: number;
  ft_not_available: number;
  stage2_enabled: boolean;
  additional_records_other_sources: number;
  by_source: { source: string; count: number }[];
  ta_reasons: { reason: string; count: number }[];
  ft_reasons: { reason: string; count: number }[];
  by_year: { year: number; count: number }[];
  imports: { file_name: string | null; database_source: string | null; records_imported: number; created_at: string }[];
}

export interface ProjectOverview {
  id: string;
  title: string;
  research_question: string | null;
  review_type: ReviewType;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  total: number;
  duplicates: number;
  screened: number;
  unscreened: number;
  included: number;
  excluded: number;
  maybe: number;
  last_activity: string | null;
}

export interface Facets {
  sources: string[];
  publication_types: string[];
  languages: string[];
  reasons: string[];
  min_year: number | null;
  max_year: number | null;
}
