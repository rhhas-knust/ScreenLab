import Papa from 'papaparse';
import type { BibField, BibRecord } from '../types';
import { clean, cleanMultiline, parseYear } from '../normalize';
import { bibTypeLabel, headerRank, isPageEnd, isPageStart, mapHeader, risTypeLabel } from './fieldMap';

export type ImportFormat = 'csv' | 'ris' | 'bibtex' | 'medline';

export interface ParsedRecord extends BibRecord {
  /** Original fields exactly as found in the file. */
  original: Record<string, unknown>;
  /** Position in the file (1-based record number). */
  recordNo: number;
  /** Non-fatal problems (e.g. "year not recognised"). */
  warnings: string[];
}

export interface ParseIssue {
  recordNo: number | null;
  line: number | null;
  message: string;
}

export interface ParseResult {
  format: ImportFormat;
  records: ParsedRecord[];
  /** Records / rows that could not be parsed at all (never silently dropped). */
  malformed: ParseIssue[];
  /** ScreenLab fields for which at least one record had a value. */
  fieldsDetected: BibField[];
  /** Original column / tag names found in the file. */
  sourceFields: string[];
  /** Columns / tags that were not mapped to a ScreenLab field (kept in original_record). */
  unmappedFields: string[];
}

const EMPTY: BibRecord = {
  title: null, authors: null, abstract: null, year: null, journal: null, volume: null, issue: null,
  pages: null, doi: null, pmid: null, url: null, keywords: null, publication_type: null,
  database_source: null, language: null,
};

export function detectFormat(fileName: string, text: string): ImportFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const head = text.slice(0, 5000);
  if (ext === 'ris') return 'ris';
  if (ext === 'bib' || ext === 'bibtex') return 'bibtex';
  if (ext === 'nbib') return 'medline';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  // Content sniffing for .txt and unknown extensions
  if (/^\s*TY {2}- /m.test(head)) return 'ris';
  if (/^\s*PMID- /m.test(head)) return 'medline';
  if (/@\w+\s*[{(]/.test(head)) return 'bibtex';
  if (ext === 'txt' && /\t/.test(head.split('\n')[0] ?? '')) return 'csv';
  if (/,|\t|;/.test(head.split('\n')[0] ?? '')) return 'csv';
  return null;
}

// ---------------------------------------------------------------------------
// Field assembly shared by all formats
// ---------------------------------------------------------------------------

type Collected = Partial<Record<BibField, string[]>> & { pageStart?: string; pageEnd?: string };

function push(c: Collected, f: BibField, v: string | null | undefined) {
  if (v == null) return;
  const s = String(v).trim();
  if (!s) return;
  (c[f] ??= []).push(s);
}

function finalize(c: Collected, original: Record<string, unknown>, recordNo: number): ParsedRecord {
  const warnings: string[] = [];
  const first = (f: BibField) => (c[f] && c[f]!.length ? c[f]![0] : null);
  const joinAll = (f: BibField, sep: string) => (c[f] && c[f]!.length ? c[f]!.join(sep) : null);

  const rec: ParsedRecord = { ...EMPTY, original, recordNo, warnings };
  rec.title = clean(first('title'));
  rec.authors = clean(joinAll('authors', '; '));
  rec.abstract = cleanMultiline(c.abstract && c.abstract.length ? c.abstract.join('\n\n') : null);
  const rawYear = first('year');
  rec.year = parseYear(rawYear);
  if (rawYear && rec.year == null) warnings.push(`Year not recognised: "${rawYear}"`);
  rec.journal = clean(first('journal'));
  rec.volume = clean(first('volume'));
  rec.issue = clean(first('issue'));
  rec.pages = clean(first('pages'));
  if (!rec.pages && (c.pageStart || c.pageEnd)) {
    rec.pages = clean([c.pageStart, c.pageEnd].filter(Boolean).join('-'));
  }
  rec.doi = clean(first('doi'));
  const pmid = clean(first('pmid'));
  rec.pmid = pmid ? pmid.replace(/^pmid:\s*/i, '') : null;
  rec.url = clean(first('url'));
  rec.keywords = clean(joinAll('keywords', '; '));
  rec.publication_type = clean(first('publication_type'));
  rec.database_source = clean(first('database_source'));
  rec.language = clean(first('language'));
  return rec;
}

function summarise(format: ImportFormat, records: ParsedRecord[], malformed: ParseIssue[],
                   sourceFields: Set<string>, unmapped: Set<string>): ParseResult {
  const detected = new Set<BibField>();
  for (const r of records) {
    for (const k of Object.keys(EMPTY) as BibField[]) if (r[k] != null && r[k] !== '') detected.add(k);
  }
  return {
    format, records, malformed,
    fieldsDetected: [...detected],
    sourceFields: [...sourceFields],
    unmappedFields: [...unmapped],
  };
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

export function parseCsv(text: string): ParseResult {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  });
  const headers = (res.meta.fields ?? []).filter((h) => h !== '');
  const malformed: ParseIssue[] = [];
  const sourceFields = new Set(headers);
  const unmapped = new Set<string>();
  const mapping = new Map<string, BibField | 'pageStart' | 'pageEnd' | null>();
  const best = new Map<BibField, string>();
  for (const h of headers) {
    const f = isPageStart(h) || isPageEnd(h) ? null : mapHeader(h);
    if (f && (!best.has(f) || headerRank(h) < headerRank(best.get(f)!))) best.set(f, h);
  }
  for (const h of headers) {
    const f = mapHeader(h);
    const m = isPageStart(h) ? 'pageStart' : isPageEnd(h) ? 'pageEnd' : f && best.get(f) === h ? f : null;
    mapping.set(h, m);
    if (!m) unmapped.add(h);
  }

  if (!headers.some((h) => mapping.get(h) === 'title')) {
    malformed.push({ recordNo: null, line: 1, message: 'No title column was found. Expected a header such as "Title", "Article Title" or "TI".' });
  }

  const rowErrors = new Map<number, string>();
  for (const e of res.errors) {
    if (e.row != null && e.code !== 'UndetectableDelimiter') {
      rowErrors.set(e.row, e.message);
    }
  }

  const records: ParsedRecord[] = [];
  res.data.forEach((row, i) => {
    const values = Object.values(row).filter((v) => v != null && String(v).trim() !== '');
    if (values.length === 0) return;
    const err = rowErrors.get(i);
    const c: Collected = {};
    const original: Record<string, unknown> = {};
    for (const h of headers) {
      const v = row[h];
      if (v == null || String(v).trim() === '') continue;
      original[h] = v;
      const m = mapping.get(h);
      if (m === 'pageStart') c.pageStart = String(v).trim();
      else if (m === 'pageEnd') c.pageEnd = String(v).trim();
      else if (m === 'authors') String(v).split(/;\s*|\s*\|\s*/).forEach((a) => push(c, 'authors', a));
      else if (m) push(c, m, v);
    }
    const extra = (row as Record<string, unknown>)['__parsed_extra'];
    if (extra) original['__extra_columns'] = extra;
    const rec = finalize(c, original, i + 1);
    if (err) {
      rec.warnings.push(`Row ${i + 2}: ${err}`);
      malformed.push({ recordNo: i + 1, line: i + 2, message: `${err} (imported with the fields that could be read)` });
    }
    records.push(rec);
  });
  return summarise('csv', records, malformed, sourceFields, unmapped);
}

// ---------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------

const RIS_MAP: Record<string, BibField | 'pageStart' | 'pageEnd' | 'type'> = {
  TI: 'title', T1: 'title', CT: 'title', BT: 'title',
  AU: 'authors', A1: 'authors',
  AB: 'abstract', N2: 'abstract',
  PY: 'year', Y1: 'year', DA: 'year',
  T2: 'journal', JO: 'journal', JF: 'journal', JA: 'journal', J2: 'journal', J1: 'journal',
  VL: 'volume', IS: 'issue', SP: 'pageStart', EP: 'pageEnd',
  DO: 'doi', UR: 'url', L1: 'url', L2: 'url', KW: 'keywords',
  TY: 'type', M3: 'publication_type', LA: 'language', DB: 'database_source', DP: 'database_source',
};

export function parseRis(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const tagRe = /^([A-Z][A-Z0-9])  -(?: (.*))?$/;
  const records: ParsedRecord[] = [];
  const malformed: ParseIssue[] = [];
  const sourceFields = new Set<string>();
  const unmapped = new Set<string>();

  let cur: { tags: [string, string][]; startLine: number } | null = null;
  let lastTag: [string, string] | null = null;

  const flush = (endLine: number, closed: boolean) => {
    if (!cur) return;
    const recordNo = records.length + 1;
    if (cur.tags.length === 0) {
      cur = null;
      return;
    }
    const c: Collected = {};
    const original: Record<string, unknown> = {};
    let journalPriority = 99;
    const journalRank: Record<string, number> = { T2: 1, JF: 2, JO: 3, JA: 4, J2: 5, J1: 6 };
    let type: string | null = null;
    let an: string | null = null;
    for (const [tag, value] of cur.tags) {
      const prev = original[tag];
      original[tag] = prev == null ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
      const m = RIS_MAP[tag];
      if (tag === 'AN') an = value;
      if (!m) {
        unmapped.add(tag);
        continue;
      }
      if (m === 'type') type = value;
      else if (m === 'pageStart') c.pageStart = value;
      else if (m === 'pageEnd') c.pageEnd = value;
      else if (m === 'journal') {
        const rank = journalRank[tag] ?? 9;
        if (rank < journalPriority) {
          journalPriority = rank;
          c.journal = [value];
        }
      } else if (m === 'keywords') value.split(/;\s*/).forEach((k) => push(c, 'keywords', k));
      else push(c, m, value);
    }
    if (type && !c.publication_type) push(c, 'publication_type', risTypeLabel(type));
    // EndNote/Ovid put the PubMed ID in AN for MEDLINE records
    const db = (c.database_source?.[0] ?? '').toLowerCase();
    if (an && /^\d{5,9}$/.test(an.trim()) && (db.includes('pubmed') || db.includes('medline'))) push(c, 'pmid', an.trim());
    const rec = finalize(c, original, recordNo);
    if (!closed) {
      rec.warnings.push('Record was not terminated with "ER  -"');
      malformed.push({ recordNo, line: cur.startLine, message: `Record ${recordNo} (line ${cur.startLine}) has no end tag "ER  -"; imported with the fields that could be read.` });
    }
    records.push(rec);
    cur = null;
    void endLine;
  };

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.replace(/\s+$/, '');
    const m = line.match(tagRe);
    if (m) {
      const tag = m[1];
      const value = (m[2] ?? '').trim();
      sourceFields.add(tag);
      if (tag === 'TY') {
        if (cur) flush(lineNo - 1, false);
        cur = { tags: [], startLine: lineNo };
      }
      if (tag === 'ER') {
        if (cur) flush(lineNo, true);
        else malformed.push({ recordNo: null, line: lineNo, message: `Line ${lineNo}: "ER" without a matching "TY" start tag was ignored.` });
        lastTag = null;
        return;
      }
      if (!cur) {
        // Data before any TY: start an implicit record so nothing is lost.
        cur = { tags: [], startLine: lineNo };
        malformed.push({ recordNo: null, line: lineNo, message: `Line ${lineNo}: record does not start with "TY  -"; imported anyway.` });
      }
      lastTag = [tag, value];
      cur.tags.push(lastTag);
    } else if (line.trim() !== '') {
      if (cur && lastTag) {
        // Continuation of the previous tag's value (wrapped lines)
        lastTag[1] = `${lastTag[1]} ${line.trim()}`.trim();
      } else {
        malformed.push({ recordNo: null, line: lineNo, message: `Line ${lineNo}: unrecognised text outside a record: "${line.slice(0, 80)}"` });
      }
    }
  });
  if (cur) flush(lines.length, false);
  return summarise('ris', records, malformed, sourceFields, unmapped);
}

// ---------------------------------------------------------------------------
// PubMed / MEDLINE (.nbib, "PubMed format" .txt)
// ---------------------------------------------------------------------------

const MEDLINE_MAP: Record<string, BibField | 'aid' | 'pageStart'> = {
  PMID: 'pmid', TI: 'title', AB: 'abstract', FAU: 'authors', DP: 'year', JT: 'journal', VI: 'volume',
  IP: 'issue', PG: 'pages', LA: 'language', PT: 'publication_type', OT: 'keywords', MH: 'keywords',
  LID: 'aid', AID: 'aid',
};

export function parseMedline(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const records: ParsedRecord[] = [];
  const malformed: ParseIssue[] = [];
  const sourceFields = new Set<string>();
  const unmapped = new Set<string>();
  let tags: [string, string][] = [];
  let last: [string, string] | null = null;

  const flush = () => {
    if (!tags.length) return;
    const c: Collected = {};
    const original: Record<string, unknown> = {};
    const hasFau = tags.some(([t]) => t === 'FAU');
    let firstPt = true;
    for (const [tag, value] of tags) {
      const prev = original[tag];
      original[tag] = prev == null ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
      if (tag === 'AU' && !hasFau) {
        push(c, 'authors', value);
        continue;
      }
      const m = MEDLINE_MAP[tag];
      if (!m) {
        if (tag !== 'AU') unmapped.add(tag);
        continue;
      }
      if (m === 'aid') {
        const dm = value.match(/^(\S+)\s*\[doi\]/i);
        if (dm && !c.doi) push(c, 'doi', dm[1]);
      } else if (m === 'publication_type') {
        if (firstPt) push(c, 'publication_type', value);
        firstPt = false;
      } else if (m !== 'pageStart') push(c, m, value);
    }
    if (!c.journal) {
      const ta = tags.find(([t]) => t === 'TA');
      if (ta) push(c, 'journal', ta[1]);
    }
    push(c, 'database_source', 'PubMed');
    records.push(finalize(c, original, records.length + 1));
    tags = [];
    last = null;
  };

  lines.forEach((raw, idx) => {
    const m = raw.match(/^([A-Z]{2,4})\s*- (.*)$/);
    if (m) {
      const tag = m[1];
      if (tag === 'PMID' && tags.length) flush();
      sourceFields.add(tag);
      last = [tag, m[2].trim()];
      tags.push(last);
    } else if (/^\s{2,}\S/.test(raw) && last) {
      last[1] = `${last[1]} ${raw.trim()}`;
    } else if (raw.trim() === '') {
      // blank line separates records
    } else {
      malformed.push({ recordNo: null, line: idx + 1, message: `Line ${idx + 1}: unrecognised text "${raw.slice(0, 80)}"` });
    }
  });
  flush();
  return summarise('medline', records, malformed, sourceFields, unmapped);
}

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

const LATEX_ACCENTS: Record<string, Record<string, string>> = {
  '"': { a: 'ä', o: 'ö', u: 'ü', e: 'ë', i: 'ï', A: 'Ä', O: 'Ö', U: 'Ü', E: 'Ë', I: 'Ï', y: 'ÿ' },
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', c: 'ć', n: 'ń', y: 'ý' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç' },
};

/** Convert common LaTeX markup to plain text (the raw value stays in original_record). */
export function latexToText(s: string): string {
  let out = s.replace(/\\([`'"^~c])\s*\{?\\?([a-zA-Z])\}?/g, (m, acc: string, ch: string) => LATEX_ACCENTS[acc]?.[ch] ?? m);
  out = out
    .replace(/\\ss\b\{?\}?/g, 'ß')
    .replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\\$/g, '$').replace(/\\_/g, '_').replace(/\\#/g, '#')
    .replace(/\\textendash\b|--/g, '–').replace(/\\textemdash\b|---/g, '—')
    .replace(/\\(emph|textit|textbf|textsc|mathrm|text)\s*\{([^{}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/[{}]/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

interface BibEntry { type: string; key: string; fields: Record<string, string>; line: number }

function readBibEntries(text: string, malformed: ParseIssue[]): BibEntry[] {
  const entries: BibEntry[] = [];
  const strings: Record<string, string> = {};
  let i = 0;
  const n = text.length;
  const lineAt = (pos: number) => text.slice(0, pos).split('\n').length;

  while (i < n) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    const m = /^@\s*([a-zA-Z]+)\s*([{(])/.exec(text.slice(at, at + 60));
    if (!m) {
      i = at + 1;
      continue;
    }
    const type = m[1].toLowerCase();
    const open = m[2];
    const close = open === '{' ? '}' : ')';
    let j = at + m[0].length;
    // Find the matching closing delimiter, respecting nested braces and quotes
    let depth = 1;
    let inQuote = false;
    const bodyStart = j;
    while (j < n && depth > 0) {
      const ch = text[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '"' && depth === 1 && open === '{') inQuote = !inQuote;
      else if (!inQuote) {
        if (ch === '{' || (open === '(' && ch === '(')) depth++;
        else if (ch === '}' || (open === '(' && ch === ')')) depth--;
      }
      j++;
    }
    if (depth !== 0) {
      malformed.push({ recordNo: null, line: lineAt(at), message: `Line ${lineAt(at)}: @${type} entry has unbalanced braces; the rest of the file could not be read.` });
      break;
    }
    const body = text.slice(bodyStart, j - 1);
    i = j;
    void close;
    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      const sm = /^\s*([\w-]+)\s*=\s*[{"]([\s\S]*)[}"]\s*$/.exec(body);
      if (sm) strings[sm[1].toLowerCase()] = sm[2];
      continue;
    }
    const comma = body.indexOf(',');
    const key = comma >= 0 ? body.slice(0, comma).trim() : body.trim();
    const fieldsStr = comma >= 0 ? body.slice(comma + 1) : '';
    const fields = parseBibFields(fieldsStr, strings);
    if (fields == null) {
      malformed.push({ recordNo: null, line: lineAt(at), message: `Line ${lineAt(at)}: could not read the fields of @${type}{${key}}.` });
      entries.push({ type, key, fields: {}, line: lineAt(at) });
      continue;
    }
    entries.push({ type, key, fields, line: lineAt(at) });
  }
  return entries;
}

function parseBibFields(s: string, strings: Record<string, string>): Record<string, string> | null {
  const fields: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(s[i])) i++;
    if (i >= n) break;
    const nm = /^([\w:.-]+)\s*=\s*/.exec(s.slice(i));
    if (!nm) return Object.keys(fields).length ? fields : null;
    const name = nm[1].toLowerCase();
    i += nm[0].length;
    let value = '';
    // Value may be concatenated with #
    for (;;) {
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < n && depth > 0) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '{') depth++;
          else if (s[j] === '}') depth--;
          j++;
        }
        if (depth !== 0) return null;
        value += s.slice(i + 1, j - 1);
        i = j;
      } else if (s[i] === '"') {
        let j = i + 1;
        let depth = 0;
        while (j < n && !(s[j] === '"' && depth === 0)) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '{') depth++;
          else if (s[j] === '}') depth--;
          j++;
        }
        if (j >= n) return null;
        value += s.slice(i + 1, j);
        i = j + 1;
      } else {
        const bm = /^[^,#\s]+/.exec(s.slice(i));
        if (!bm) break;
        const word = bm[0];
        value += strings[word.toLowerCase()] ?? word;
        i += word.length;
      }
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] === '#') { i++; continue; }
      break;
    }
    fields[name] = value;
  }
  return fields;
}

const BIB_MAP: Record<string, BibField> = {
  title: 'title', author: 'authors', abstract: 'abstract', year: 'year', date: 'year',
  journal: 'journal', journaltitle: 'journal', booktitle: 'journal', volume: 'volume', number: 'issue',
  issue: 'issue', pages: 'pages', doi: 'doi', pmid: 'pmid', url: 'url', keywords: 'keywords',
  language: 'language', langid: 'language', type: 'publication_type', database: 'database_source',
  source: 'database_source',
};

export function parseBibtex(text: string): ParseResult {
  const malformed: ParseIssue[] = [];
  const entries = readBibEntries(text.replace(/^﻿/, ''), malformed);
  const sourceFields = new Set<string>();
  const unmapped = new Set<string>();
  const records: ParsedRecord[] = entries.map((e, idx) => {
    const c: Collected = {};
    const original: Record<string, unknown> = { ENTRYTYPE: e.type, ID: e.key, ...e.fields };
    for (const [k, raw] of Object.entries(e.fields)) {
      sourceFields.add(k);
      const f = BIB_MAP[k];
      if (!f) {
        unmapped.add(k);
        continue;
      }
      const v = latexToText(raw);
      if (f === 'authors') v.split(/\s+and\s+/i).forEach((a) => push(c, 'authors', a));
      else if (f === 'keywords') v.split(/[;,]\s*/).forEach((kw) => push(c, 'keywords', kw));
      else if (f === 'pages') push(c, 'pages', v.replace(/\s*[–—-]+\s*/, '-'));
      else push(c, f, v);
    }
    if (!c.publication_type) push(c, 'publication_type', bibTypeLabel(e.type));
    const rec = finalize(c, original, idx + 1);
    if (!Object.keys(e.fields).length) rec.warnings.push('Entry fields could not be read');
    return rec;
  });
  return summarise('bibtex', records, malformed, sourceFields, unmapped);
}

export function parseByFormat(format: ImportFormat, text: string): ParseResult {
  switch (format) {
    case 'csv': return parseCsv(text);
    case 'ris': return parseRis(text);
    case 'bibtex': return parseBibtex(text);
    case 'medline': return parseMedline(text);
  }
}
