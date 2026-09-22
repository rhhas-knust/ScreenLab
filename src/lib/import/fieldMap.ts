import type { BibField } from '../types';

/**
 * Maps normalised column/tag names (lower-case, alphanumerics only) to
 * ScreenLab fields. Covers PubMed, Scopus, Web of Science, Embase, CINAHL,
 * IEEE Xplore, Zotero / EndNote / Mendeley CSV exports and RIS tag names.
 */
const ALIASES: Record<BibField, string[]> = {
  title: ['title', 'articletitle', 'documenttitle', 'ti', 't1', 'primarytitle', 'papertitle', 'titleofarticle'],
  authors: ['authors', 'author', 'au', 'a1', 'authorfullnames', 'authorfullname', 'creators', 'creator', 'af', 'authornames'],
  abstract: ['abstract', 'ab', 'n2', 'abstractnote', 'summary', 'abstracttext'],
  year: ['year', 'publicationyear', 'py', 'pubyear', 'y1', 'yearpublished', 'publicationdate', 'date', 'da', 'pubdate', 'dp'],
  journal: [
    'journal', 'journalname', 'jo', 't2', 'jf', 'ja', 'j2', 'sourcetitle', 'publicationtitle', 'journaltitle',
    'journalbook', 'so', 'secondarytitle', 'publicationname', 'booktitle', 'ta',
  ],
  volume: ['volume', 'vl', 'vol', 'vi'],
  issue: ['issue', 'is', 'number', 'no', 'ip'],
  pages: ['pages', 'page', 'pg', 'pagination', 'pagerange'],
  doi: ['doi', 'do', 'di', 'digitalobjectidentifier', 'doiurl'],
  pmid: ['pmid', 'pubmedid', 'pubmed', 'pm', 'medlinepmid', 'accessionnumberpmid'],
  url: ['url', 'link', 'ur', 'links', 'weblink', 'pdflink', 'fulltexturl', 'l1', 'l2'],
  keywords: [
    'keywords', 'kw', 'keyword', 'authorkeywords', 'indexkeywords', 'de', 'meshterms', 'mesh', 'mh',
    'subjectheadings', 'ot', 'controlledterms', 'ieeeterms', 'authorsupplied keywords',
  ],
  publication_type: ['publicationtype', 'documenttype', 'type', 'pt', 'ty', 'dt', 'itemtype', 'referencetype', 'reftype'],
  database_source: ['database', 'source', 'databasesource', 'db', 'databaseprovider', 'dbprovider', 'datasource'],
  language: ['language', 'la', 'languageoforiginaldocument', 'lang'],
};

const LOOKUP = new Map<string, { field: BibField; rank: number }>();
for (const [field, aliases] of Object.entries(ALIASES) as [BibField, string[]][]) {
  aliases.forEach((a, rank) => LOOKUP.set(a.replace(/[^a-z0-9]/g, ''), { field, rank }));
}

export function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function mapHeader(header: string): BibField | null {
  return LOOKUP.get(normKey(header))?.field ?? null;
}

/** Lower is better: used to pick one column when several map to the same field. */
export function headerRank(header: string): number {
  return LOOKUP.get(normKey(header))?.rank ?? 999;
}

/** Page start/end columns (Scopus "Page start"/"Page end", WoS BP/EP, RIS SP/EP). */
export function isPageStart(k: string): boolean {
  return ['pagestart', 'startpage', 'bp', 'sp', 'firstpage'].includes(normKey(k));
}
export function isPageEnd(k: string): boolean {
  return ['pageend', 'endpage', 'ep', 'lastpage'].includes(normKey(k));
}

const RIS_TYPES: Record<string, string> = {
  JOUR: 'Journal Article', JFULL: 'Journal Article', EJOUR: 'Journal Article', ABST: 'Abstract',
  BOOK: 'Book', CHAP: 'Book Chapter', EBOOK: 'Book', ECHAP: 'Book Chapter', CONF: 'Conference Proceeding',
  CPAPER: 'Conference Paper', THES: 'Thesis', RPRT: 'Report', GEN: 'Generic', ELEC: 'Web Page',
  NEWS: 'Newspaper Article', MGZN: 'Magazine Article', PAT: 'Patent', STAND: 'Standard', DATA: 'Dataset',
  UNPB: 'Unpublished Work', INPR: 'In Press', SER: 'Serial', COMP: 'Software', BLOG: 'Blog', WEB: 'Web Page',
};
export function risTypeLabel(t: string): string {
  const k = t.trim().toUpperCase();
  return RIS_TYPES[k] ?? t.trim();
}

const BIB_TYPES: Record<string, string> = {
  article: 'Journal Article', book: 'Book', inbook: 'Book Chapter', incollection: 'Book Chapter',
  inproceedings: 'Conference Paper', conference: 'Conference Paper', proceedings: 'Conference Proceeding',
  phdthesis: 'Thesis', mastersthesis: 'Thesis', techreport: 'Report', misc: 'Generic', unpublished: 'Unpublished Work',
  online: 'Web Page', report: 'Report', thesis: 'Thesis', manual: 'Manual', booklet: 'Booklet',
};
export function bibTypeLabel(t: string): string {
  return BIB_TYPES[t.toLowerCase()] ?? t;
}
