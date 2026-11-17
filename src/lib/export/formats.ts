import Papa from 'papaparse';
import type { Reference } from '../types';

const DECISION_LABEL: Record<string, string> = { include: 'Included', exclude: 'Excluded', maybe: 'Maybe' };
const DUP_LABEL: Record<string, string> = {
  none: 'Not a duplicate', possible: 'Possible duplicate', duplicate: 'Duplicate (removed)', kept: 'Reviewed — kept',
  merged: 'Merged into another record',
};
const FT_LABEL: Record<string, string> = { not_available: 'Not available', available: 'Available', reviewed: 'Reviewed' };

/** Each reviewer's own decisions, for the per-reviewer columns of the CSV export. */
export interface ReviewerVotes {
  reviewers: { id: string; name: string }[];
  /** key `${referenceId}:${stage}:${reviewerId}` */
  votes: Map<string, { decision: string; reason: string | null }>;
}

export function referencesToCsv(refs: Reference[], rv?: ReviewerVotes): string {
  const vote = (r: Reference, stage: string, id: string) => {
    const v = rv?.votes.get(`${r.id}:${stage}:${id}`);
    return v ? `${DECISION_LABEL[v.decision] ?? v.decision}${v.reason ? ` (${v.reason})` : ''}` : '';
  };
  const rows = refs.map((r) => ({
    'ScreenLab ID': r.id,
    'Import order': r.seq,
    Title: r.title ?? '',
    Authors: r.authors ?? '',
    Year: r.year ?? '',
    Journal: r.journal ?? '',
    Volume: r.volume ?? '',
    Issue: r.issue ?? '',
    Pages: r.pages ?? '',
    DOI: r.doi ?? '',
    PMID: r.pmid ?? '',
    URL: r.url ?? '',
    Abstract: r.abstract ?? '',
    Keywords: r.keywords ?? '',
    'Publication type': r.publication_type ?? '',
    Language: r.language ?? '',
    'Database source': r.database_source ?? '',
    'Title/Abstract decision': r.title_abstract_decision ? DECISION_LABEL[r.title_abstract_decision] : 'Unscreened',
    'Title/Abstract exclusion reason': r.title_abstract_exclusion_reason ?? '',
    'Title/Abstract screened at': r.title_abstract_screened_at ?? '',
    'Full-text decision': r.full_text_decision ? DECISION_LABEL[r.full_text_decision] : r.title_abstract_decision === 'include' ? 'Unscreened' : '',
    'Full-text exclusion reason': r.full_text_exclusion_reason ?? '',
    'Full-text screened at': r.full_text_screened_at ?? '',
    Notes: r.notes ?? '',
    Tags: (r.tag_names ?? []).join('; '),
    'Duplicate status': DUP_LABEL[r.duplicate_status] ?? r.duplicate_status,
    'Full-text status': FT_LABEL[r.full_text_status] ?? r.full_text_status,
    'Full-text URL': r.full_text_url ?? '',
    'Imported at': r.imported_at,
    ...(rv && rv.reviewers.length ? {
      'Title/Abstract conflict': r.title_abstract_conflict ? 'Yes' : '',
      'Full-text conflict': r.full_text_conflict ? 'Yes' : '',
      ...Object.fromEntries(rv.reviewers.flatMap((p) => [
        [`Title/Abstract — ${p.name}`, vote(r, 'title_abstract', p.id)],
        [`Full text — ${p.name}`, vote(r, 'full_text', p.id)],
      ])),
    } : {}),
  }));
  // BOM so Excel opens UTF-8 correctly
  return '﻿' + Papa.unparse(rows, { quotes: true });
}

const RIS_TYPE: Record<string, string> = {
  'journal article': 'JOUR', article: 'JOUR', review: 'JOUR', book: 'BOOK', 'book chapter': 'CHAP',
  'conference paper': 'CPAPER', 'conference proceeding': 'CONF', thesis: 'THES', report: 'RPRT', 'web page': 'ELEC',
};

export function referencesToRis(refs: Reference[]): string {
  const out: string[] = [];
  const line = (tag: string, v: unknown) => {
    if (v == null || v === '') return;
    out.push(`${tag}  - ${String(v).replace(/\r?\n+/g, ' ')}`);
  };
  for (const r of refs) {
    line('TY', RIS_TYPE[(r.publication_type ?? '').toLowerCase()] ?? 'JOUR');
    line('TI', r.title);
    for (const a of (r.authors ?? '').split(/;\s*/).filter(Boolean)) line('AU', a);
    line('PY', r.year);
    line('T2', r.journal);
    line('VL', r.volume);
    line('IS', r.issue);
    if (r.pages) {
      const [sp, ep] = r.pages.split(/[-–]/);
      line('SP', sp?.trim());
      line('EP', ep?.trim());
    }
    line('DO', r.doi);
    line('UR', r.url);
    line('AB', r.abstract);
    for (const k of (r.keywords ?? '').split(/;\s*/).filter(Boolean)) line('KW', k);
    line('LA', r.language);
    line('DB', r.database_source);
    if (r.pmid) line('AN', r.pmid);
    line('M3', r.publication_type);
    const decision = [
      `ScreenLab title/abstract: ${r.title_abstract_decision ? DECISION_LABEL[r.title_abstract_decision] : 'Unscreened'}`,
      r.title_abstract_exclusion_reason ? `(${r.title_abstract_exclusion_reason})` : '',
      r.full_text_decision ? `; full text: ${DECISION_LABEL[r.full_text_decision]}` : '',
      r.full_text_exclusion_reason ? `(${r.full_text_exclusion_reason})` : '',
    ].join(' ');
    line('N1', decision.trim());
    if (r.notes) line('N1', `Notes: ${r.notes}`);
    for (const t of r.tag_names ?? []) line('KW', `screenlab-tag:${t}`);
    out.push('ER  - ', '');
  }
  return out.join('\r\n');
}

const BIB_TYPE: Record<string, string> = { 'journal article': 'article', article: 'article', review: 'article', book: 'book', 'book chapter': 'incollection', 'conference paper': 'inproceedings', 'conference proceeding': 'proceedings', thesis: 'phdthesis', report: 'techreport' };
const bibEscape = (v: string) => v.replace(/\\/g, '\\textbackslash{}').replace(/([{}%&$#_])/g, '\\$1').replace(/\r?\n+/g, ' ');

/** BibTeX, one entry per record, with the screening decisions in the note field. */
export function referencesToBibtex(refs: Reference[]): string {
  const used = new Set<string>();
  return refs.map((r) => {
    const first = (r.authors ?? '').split(/;\s*/)[0]?.split(/[,\s]/)[0]?.replace(/[^A-Za-z]/g, '') || 'ref';
    let key = `${first}${r.year ?? ''}_${r.seq}`;
    while (used.has(key)) key += 'a';
    used.add(key);
    const fields: [string, unknown][] = [
      ['title', r.title], ['author', (r.authors ?? '').split(/;\s*/).filter(Boolean).join(' and ')], ['year', r.year], ['journal', r.journal],
      ['volume', r.volume], ['number', r.issue], ['pages', r.pages], ['doi', r.doi], ['pmid', r.pmid], ['url', r.url], ['abstract', r.abstract],
      ['keywords', [r.keywords, ...(r.tag_names ?? []).map((t) => `screenlab-tag:${t}`)].filter(Boolean).join('; ')], ['language', r.language],
      ['note', [`ScreenLab title/abstract: ${r.title_abstract_decision ? DECISION_LABEL[r.title_abstract_decision] : 'Unscreened'}${r.title_abstract_exclusion_reason ? ` (${r.title_abstract_exclusion_reason})` : ''}`,
        r.full_text_decision ? `full text: ${DECISION_LABEL[r.full_text_decision]}${r.full_text_exclusion_reason ? ` (${r.full_text_exclusion_reason})` : ''}` : '',
        r.notes ? `Notes: ${r.notes}` : ''].filter(Boolean).join('; ')],
    ];
    const body = fields.filter(([, v]) => v != null && v !== '').map(([k, v]) => `  ${k} = {${bibEscape(String(v))}}`).join(',\n');
    return `@${BIB_TYPE[(r.publication_type ?? '').toLowerCase()] ?? 'article'}{${key},\n${body}\n}`;
  }).join('\n\n') + '\n';
}

const xmlEsc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const st = (v: unknown) => `<style face="normal" font="default" size="100%">${xmlEsc(v)}</style>`;

/** EndNote XML (imports into EndNote, Zotero and Mendeley), decisions in the notes. */
export function referencesToEndnoteXml(refs: Reference[]): string {
  const recs = refs.map((r, i) => {
    const el = (tag: string, v: unknown) => (v == null || v === '' ? '' : `<${tag}>${st(v)}</${tag}>`);
    const authors = (r.authors ?? '').split(/;\s*/).filter(Boolean).map((a) => `<author>${st(a)}</author>`).join('');
    const kws = [...(r.keywords ?? '').split(/;\s*/), ...(r.tag_names ?? []).map((t) => `screenlab-tag:${t}`)].filter(Boolean).map((k) => `<keyword>${st(k)}</keyword>`).join('');
    const notes = [`ScreenLab title/abstract: ${r.title_abstract_decision ? DECISION_LABEL[r.title_abstract_decision] : 'Unscreened'}${r.title_abstract_exclusion_reason ? ` (${r.title_abstract_exclusion_reason})` : ''}`,
      r.full_text_decision ? `full text: ${DECISION_LABEL[r.full_text_decision]}${r.full_text_exclusion_reason ? ` (${r.full_text_exclusion_reason})` : ''}` : '', r.notes ?? ''].filter(Boolean).join('; ');
    return `<record><rec-number>${i + 1}</rec-number><ref-type name="${xmlEsc(r.publication_type || 'Journal Article')}">17</ref-type>` +
      (authors ? `<contributors><authors>${authors}</authors></contributors>` : '') +
      `<titles>${el('title', r.title)}${el('secondary-title', r.journal)}</titles>` +
      `${el('pages', r.pages)}${el('volume', r.volume)}${el('number', r.issue)}${kws ? `<keywords>${kws}</keywords>` : ''}` +
      `${r.year ? `<dates><year>${st(r.year)}</year></dates>` : ''}${el('accession-num', r.pmid)}${el('electronic-resource-num', r.doi)}` +
      `${el('abstract', r.abstract)}${el('notes', notes)}${el('remote-database-name', r.database_source)}${el('language', r.language)}` +
      `${r.url ? `<urls><related-urls><url>${st(r.url)}</url></related-urls></urls>` : ''}</record>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" ?><xml><records>${recs.join('')}</records></xml>\n`;
}

export function referencesToJson(refs: Reference[]): string {
  const clean = refs.map((r) => {
    const { search_text: _s, title_norm: _t, doi_norm: _d, ...rest } = r as Reference & { search_text?: string; title_norm?: string; doi_norm?: string };
    void _s; void _t; void _d;
    return rest;
  });
  return JSON.stringify({ format: 'screenlab-references', version: 1, exported_at: new Date().toISOString(), references: clean }, null, 2);
}

export function downloadText(filename: string, text: string, mime: string) {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(s: string): string {
  return (s || 'screenlab').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 60);
}

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
