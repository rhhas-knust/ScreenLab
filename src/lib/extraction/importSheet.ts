// Import extractions (or risk-of-bias appraisals) done outside ScreenLab, from
// a CSV or Excel file. Pure functions: read the file into a grid, work out
// which way round it is, map columns to form fields, match each study to a
// paper in the project and convert values to the form's field types.
// Nothing is saved here; the Import tab shows the result for the reviewer to
// check first.
import Papa from 'papaparse';
import { unzipSync, strFromU8 } from 'fflate';
import { decodeText } from '../import/zip';
import type { ExtractionData, ExtractionForm, FormField, Value } from './form';

export interface Sheet { name: string; rows: string[][] }

// ------------------------------------------------------------------ files --

/** Read a .csv/.tsv/.txt or .xlsx file into one grid per sheet. */
export function readSheetFile(fileName: string, buf: ArrayBuffer): Sheet[] {
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xlsx$|\.xlsm$/i.test(fileName) || isZip) return readXlsx(bytes);
  if (/\.xls$/i.test(fileName)) throw new Error('Old .xls files cannot be read. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV, then import that.');
  const text = decodeText(bytes).replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimiter: /\.tsv$/i.test(fileName) ? '\t' : '' });
  return [{ name: fileName.replace(/\.[^.]+$/, ''), rows: tidy(parsed.data.map((r) => r.map((c) => String(c ?? '')))) }];
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function unxml(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi, (_, n, h, d) => (n ? ENT[n] : String.fromCodePoint(h ? parseInt(h, 16) : Number(d))))
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A small .xlsx reader: shared strings, inline strings, numbers and booleans. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name) });
  } catch {
    throw new Error('The Excel file could not be opened. It may be damaged or password-protected. Try saving it again, or save it as CSV.');
  }
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('This does not look like an Excel workbook (.xlsx).');
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target') ?? '']));
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id')) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = get(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(attr(r[1], 'r') ?? rows.length + 1) - 1;
      const row: string[] = [];
      let next = 0;
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r');
        const col = ref ? colIndex(ref) : next;
        next = col + 1;
        const t = attr(c[1], 't');
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = texts(body);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) {
          val = unxml(v);
          if (t !== 'str' && t !== 'e' && /^-?[\d.]+(e[-+]?\d+)?$/i.test(val)) val = String(Number(Number(val).toPrecision(12)));
        }
        row[col] = val;
      }
      rows[rowNo] = Array.from(row, (x) => x ?? '');
    }
    sheets.push({ name: unxml(attr(m[0], 'name') ?? `Sheet ${sheets.length + 1}`), rows: tidy(Array.from(rows, (x) => x ?? [])) });
  }
  if (!sheets.length) throw new Error('The Excel file has no worksheets with data.');
  return sheets;
}

/** Trim cells, drop empty rows and pad to a rectangle. */
function tidy(rows: string[][]): string[][] {
  const out = rows.map((r) => r.map((c) => (c ?? '').replace(/\r\n?/g, '\n').trim())).filter((r) => r.some(Boolean));
  let width = 0;
  for (const r of out) for (let i = r.length - 1; i >= 0; i--) if (r[i]) { width = Math.max(width, i + 1); break; }
  return out.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

// ---------------------------------------------------------------- columns --

export type Role =
  | { kind: 'ignore' }
  | { kind: 'id' } | { kind: 'doi' } | { kind: 'pmid' } | { kind: 'title' } | { kind: 'study' } | { kind: 'authors' } | { kind: 'year' }
  | { kind: 'field'; key: string }
  | { kind: 'new' };

export const ROLE_LABEL: Record<Exclude<Role['kind'], 'field'>, string> = {
  ignore: 'Ignore this column', id: 'ScreenLab ID (#)', doi: 'DOI', pmid: 'PMID', title: 'Title', study: 'Study (e.g. Smith et al., 2021)',
  authors: 'Authors', year: 'Year', new: 'Add as a new field',
};
export const roleValue = (r: Role) => (r.kind === 'field' ? `field:${r.key}` : r.kind);
export const parseRole = (v: string): Role => (v.startsWith('field:') ? { kind: 'field', key: v.slice(6) } : { kind: v as Exclude<Role['kind'], 'field'> } as Role);

const normLabel = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s: string) => new Set(normLabel(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));
const STOP = new Set(['the', 'of', 'and', 'or', 'a', 'an', 'in', 'to', 'for', 'was', 'were', 'is', 'are', 'e', 'g']);
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / (a.size + b.size - n);
}

/** The form field a heading names, if any: exact label or key, "Q3" for "Q3. …", or most words in common. */
export function matchField(header: string, form: ExtractionForm | null): string | null {
  if (!form) return null;
  const h = normLabel(header);
  if (!h) return null;
  for (const f of form.fields) if (normLabel(f.label) === h || normLabel(f.key) === h) return f.key;
  const q = h.match(/^q ?(\d+)\b/);
  if (q) {
    const hit = form.fields.find((f) => normLabel(f.label).match(/^q ?(\d+)\b/)?.[1] === q[1]);
    if (hit) return hit.key;
  }
  const ht = tokens(header);
  let best: { key: string; score: number } | null = null;
  for (const f of form.fields) {
    const score = Math.max(jaccard(ht, tokens(f.label)), jaccard(ht, tokens(f.key)));
    if (score >= 0.6 && (!best || score > best.score)) best = { key: f.key, score };
  }
  return best?.key ?? null;
}

/** First guess at what a column holds; the reviewer can change it. */
export function guessRole(header: string, form: ExtractionForm | null): Role {
  const h = normLabel(header);
  if (/^(id|screenlab id|ref id|reference id|record id|record number|record|no|number|ref)$/.test(h) || header.trim() === '#') return { kind: 'id' };
  if (/^(doi|doi link|doi url)$/.test(h)) return { kind: 'doi' };
  if (/^(pmid|pubmed id|pubmed)$/.test(h)) return { kind: 'pmid' };
  if (/^(title|article title|study title|paper title)$/.test(h)) return { kind: 'title' };
  if (/^(study|field|study id|citation|reference|author year|first author year|study label)$/.test(h)) return { kind: 'study' };
  if (/^(author|authors|first author|author s)$/.test(h)) return { kind: 'authors' };
  if (/^(year|publication year|pub year|year of publication)$/.test(h)) return { kind: 'year' };
  if (/^(journal|source|reviewer|status|differs|agreed final|timestamp)$/.test(h)) return { kind: 'ignore' };
  const key = matchField(header, form);
  return key ? { kind: 'field', key } : { kind: 'new' };
}

// ----------------------------------------------------------------- layout --

export type Layout = 'studies' | 'fields';
export interface Table { headers: string[]; records: string[][] }

/**
 * Studies as rows (one study per row, headings across the top) or studies as
 * columns (fields down the side, as in ScreenLab's PDF-style CSV). Decided by
 * which of the first row and the first column names more of the form's fields
 * and study details.
 */
export function detectLayout(rows: string[][], form: ExtractionForm | null): Layout {
  if (!rows.length) return 'studies';
  const score = (cells: string[]) => cells.filter((c) => c && guessRole(c, form).kind !== 'new').length;
  const top = score(rows[0]);
  const side = score(rows.map((r) => r[0] ?? ''));
  if (normLabel(rows[0][0] ?? '') === 'field') return 'fields';
  return side > top ? 'fields' : 'studies';
}

export function toTable(rows: string[][], layout: Layout): Table {
  if (!rows.length) return { headers: [], records: [] };
  if (layout === 'studies') return { headers: rows[0], records: rows.slice(1) };
  const width = rows[0].length;
  return { headers: rows.map((r) => r[0]), records: Array.from({ length: width - 1 }, (_, i) => rows.map((r) => r[i + 1] ?? '')).filter((c) => c.some(Boolean)) };
}

// --------------------------------------------------------------- matching --

export interface PoolRef {
  id: string; seq: number; title: string | null; authors: string | null; year: number | null; doi: string | null; pmid: string | null;
  /** Included at full text, so it is on the extraction list. */
  included: boolean;
}
export interface Match { refId: string | null; how: string; candidates?: string[] }

export const normDoi = (s: string | null | undefined) => (s ?? '').toLowerCase().trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[.\s]+$/, '');
const normTitle = (s: string | null | undefined) => normLabel(s ?? '');
/** Surname of the first author: "Smith, J.; …", "Smith J", "John Smith and …" all give "smith". */
export function firstAuthor(authors: string | null | undefined): string {
  const a = (authors ?? '').split(/;|\band\b|\n/)[0]?.trim() ?? '';
  if (a.includes(',')) return normLabel(a.split(',')[0]);
  const words = a.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return normLabel(/^[A-Z]{1,3}\.?$/.test(words[words.length - 1]) ? words[0] : words[words.length - 1]);
}
const lastWord = (s: string) => s.split(' ').pop() ?? '';

/** Find the paper a row describes: DOI, PMID, title, "#ID", then first author and year. */
export function matchStudy(v: { id?: string; doi?: string; pmid?: string; title?: string; study?: string; authors?: string; year?: string }, pool: PoolRef[]): Match {
  const one = (hits: PoolRef[], how: string): Match | null =>
    hits.length === 1 ? { refId: hits[0].id, how } : hits.length > 1 ? { refId: null, how: `${hits.length} papers share this ${how}`, candidates: hits.map((h) => h.id) } : null;
  const doi = normDoi(v.doi);
  if (doi) { const m = one(pool.filter((p) => normDoi(p.doi) === doi), 'DOI'); if (m) return m; }
  const pmid = (v.pmid ?? '').replace(/\D/g, '');
  if (pmid) { const m = one(pool.filter((p) => (p.pmid ?? '').replace(/\D/g, '') === pmid), 'PMID'); if (m) return m; }
  const t = normTitle(v.title);
  if (t.length > 8) {
    const m = one(pool.filter((p) => normTitle(p.title) === t), 'title');
    if (m) return m;
    const tt = tokens(v.title!);
    const near = pool.map((p) => ({ p, s: jaccard(tt, tokens(p.title ?? '')) })).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s);
    if (near.length && (near.length === 1 || near[0].s - near[1].s > 0.1)) return { refId: near[0].p.id, how: 'similar title' };
  }
  const hash = `${v.id ?? ''} ${v.study ?? ''}`.match(/#\s*(\d+)/)?.[1] ?? (/^\d+$/.test((v.id ?? '').trim()) && !v.title ? v.id!.trim() : undefined);
  if (hash) { const m = one(pool.filter((p) => p.seq === Number(hash)), 'ScreenLab ID'); if (m) return m; }
  // "Smith et al., 2021" / "Smith 2021", or separate author and year columns.
  const label = v.study?.replace(/\(#\d+\)/, '') ?? '';
  const author = lastWord(v.authors ? firstAuthor(v.authors) : normLabel(label.split(/,|\bet al\b|\d{4}/)[0] ?? ''));
  const year = Number((v.year ?? label).match(/\b(19|20)\d{2}\b/)?.[0]);
  if (author && year) {
    const m = one(pool.filter((p) => p.year === year && lastWord(firstAuthor(p.authors)) === author), 'first author and year');
    if (m) return m;
  }
  return { refId: null, how: 'No matching paper found' };
}

// ----------------------------------------------------------------- values --

const sameOpt = (a: string, b: string) => normLabel(a) === normLabel(b);

/** Turn a cell into the field's value; a warning when it does not fit the form. */
export function convertValue(raw: string, field: FormField): { value: Value | null; warning?: string } {
  const s = raw.trim();
  if (!s) return { value: null };
  const opts = field.options ?? [];
  switch (field.type) {
    case 'number': {
      const n = s.replace(/,(?=\d{3}\b)/g, '').replace(/\s/g, '');
      return /^-?\d+(\.\d+)?$/.test(n) ? { value: n } : { value: s, warning: `“${s}” is not a number` };
    }
    case 'choice': {
      const hit = opts.find((o) => sameOpt(o, s));
      return hit ? { value: hit } : { value: s, warning: `“${s}” is not one of the options` };
    }
    case 'multi': {
      let parts = s.split(/\s*[;|\n]\s*/).filter(Boolean);
      if (parts.length === 1 && s.includes(',')) {
        const byComma = s.split(/\s*,\s*/).filter(Boolean);
        if (byComma.every((p) => opts.some((o) => sameOpt(o, p)))) parts = byComma;
      }
      const vals = parts.map((p) => opts.find((o) => sameOpt(o, p)) ?? p);
      const odd = vals.filter((x) => !opts.includes(x));
      return { value: vals, ...(odd.length ? { warning: `${odd.map((x) => `“${x}”`).join(', ')} not among the options` } : {}) };
    }
    default:
      return { value: s };
  }
}

// ------------------------------------------------------------------ build --

export interface ImportRow {
  index: number;
  label: string;
  match: Match;
  data: ExtractionData;
  warnings: string[];
}

/** A new text field for each column marked "Add as a new field". */
export function newFields(table: Table, roles: Role[], form: ExtractionForm | null): FormField[] {
  const taken = (form?.fields ?? []).map((f) => f.key);
  const out: FormField[] = [];
  roles.forEach((r, i) => {
    if (r.kind !== 'new' || !table.headers[i]) return;
    const base = normLabel(table.headers[i]).replace(/ /g, '_').slice(0, 40) || 'field';
    let key = base;
    for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
    taken.push(key);
    const long = table.records.some((rec) => (rec[i] ?? '').length > 80 || (rec[i] ?? '').includes('\n'));
    out.push({ key, label: table.headers[i], type: long ? 'long' : 'text' });
  });
  return out;
}

export function buildRows(table: Table, roles: Role[], form: ExtractionForm, pool: PoolRef[], added: FormField[] = []): ImportRow[] {
  const fields = new Map(form.fields.map((f) => [f.key, f]));
  let ni = 0;
  // Same order as newFields(): one added field per "new" column with a heading.
  const colField = roles.map((r, i) => (r.kind === 'field' ? fields.get(r.key) ?? null : r.kind === 'new' && table.headers[i] ? added[ni++] ?? null : null));
  const rows = table.records.map((rec, index) => {
    const ids: Record<string, string> = {};
    roles.forEach((r, i) => { if (r.kind !== 'field' && r.kind !== 'new' && r.kind !== 'ignore' && rec[i]) ids[r.kind] ??= rec[i]; });
    const data: ExtractionData = {};
    const warnings: string[] = [];
    roles.forEach((_, i) => {
      const f = colField[i];
      if (!f || !rec[i]) return;
      const { value, warning } = convertValue(rec[i], f);
      if (value == null || (Array.isArray(value) && !value.length)) return;
      if (data[f.key] != null) { warnings.push(`${f.label}: more than one column; kept the first`); return; }
      data[f.key] = value;
      if (warning) warnings.push(`${f.label}: ${warning}`);
    });
    const label = ids.study || [ids.authors?.split(/[;,]/)[0], ids.year].filter(Boolean).join(' ');
    return { index, label: label || ids.title || ids.doi || `Row ${index + 1}`, match: matchStudy(ids, pool), data, warnings };
  });
  // The same paper twice: keep the first, flag the others.
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.match.refId) continue;
    if (seen.has(r.match.refId)) r.match = { refId: null, how: 'Same paper as an earlier row' };
    else seen.add(r.match.refId);
  }
  return rows;
}
