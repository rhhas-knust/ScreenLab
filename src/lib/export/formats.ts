import Papa from 'papaparse';
import type { Reference } from '../types';

const DECISION_LABEL: Record<string, string> = { include: 'Included', exclude: 'Excluded', maybe: 'Maybe' };
const DUP_LABEL: Record<string, string> = {
  none: 'Not a duplicate', possible: 'Possible duplicate', duplicate: 'Duplicate (removed)', kept: 'Reviewed — kept',
  merged: 'Merged into another record',
};
const FT_LABEL: Record<string, string> = { not_available: 'Not available', available: 'Available', reviewed: 'Reviewed' };

export function referencesToCsv(refs: Reference[]): string {
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

export function referencesToJson(refs: Reference[]): string {
  const clean = refs.map((r) => {
    const { search_text: _s, title_norm: _t, doi_norm: _d, ...rest } = r as Reference & { search_text?: string; title_norm?: string; doi_norm?: string };
    void _s; void _t; void _d;
    return rest;
  });
  return JSON.stringify({ format: 'screenlab-references', version: 1, exported_at: new Date().toISOString(), references: clean }, null, 2);
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
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
