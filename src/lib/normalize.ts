/** Normalisation helpers. These mirror the SQL functions norm_title / norm_doi. */

export function normTitle(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return s || null;
}

export function normDoi(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d
    .toLowerCase()
    .replace(/^\s*(https?:\/\/)?(dx\.)?(doi\.org\/)?(doi:\s*)?/, '')
    .trim();
  return s || null;
}

/** A DOI is valid if it looks like 10.<registrant>/<suffix>. */
export function isValidDoi(d: string | null | undefined): boolean {
  const n = normDoi(d);
  return !!n && /^10\.\d{4,9}\/\S+$/.test(n);
}

/** Extract a plausible 4-digit publication year. */
export function parseYear(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/\b(1[5-9]\d\d|20\d\d|21\d\d)\b/);
  return m ? Number(m[1]) : null;
}

export function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

/** Clean but keep paragraph breaks (for abstracts). */
export function cleanMultiline(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return s || null;
}

export function doiUrl(doi: string | null | undefined): string | null {
  const n = normDoi(doi);
  return n ? `https://doi.org/${n}` : null;
}

export function pubmedUrl(pmid: string | null | undefined): string | null {
  return pmid && /^\d+$/.test(pmid.trim()) ? `https://pubmed.ncbi.nlm.nih.gov/${pmid.trim()}/` : null;
}
