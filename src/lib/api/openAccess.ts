/**
 * Look up a legal open-access copy of an article by DOI in OpenAlex
 * (free scholarly index, no key needed). Only the DOI is sent.
 */
export interface OpenAccessInfo {
  isOa: boolean;
  pdfUrl: string | null;
  landingUrl: string | null;
  host: string | null;
}

interface OpenAlexLocation { pdf_url?: string | null; landing_page_url?: string | null; source?: { display_name?: string | null } | null }

export async function findOpenAccess(doi: string, signal?: AbortSignal): Promise<OpenAccessInfo | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  signal?.addEventListener('abort', () => ctl.abort());
  let res: Response;
  try {
    res = await fetch(`https://api.openalex.org/works/doi:${clean.split('/').map(encodeURIComponent).join('/')}?select=open_access,best_oa_location,locations`, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const w = await res.json() as { open_access?: { is_oa?: boolean; oa_url?: string | null }; best_oa_location?: OpenAlexLocation | null; locations?: OpenAlexLocation[] };
  const best = w.best_oa_location ?? null;
  const pdf = best?.pdf_url || w.locations?.find((l) => l.pdf_url)?.pdf_url || null;
  return {
    isOa: !!w.open_access?.is_oa,
    pdfUrl: pdf,
    landingUrl: best?.landing_page_url || w.open_access?.oa_url || null,
    host: best?.source?.display_name ?? null,
  };
}

export const scholarUrl = (title: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${title}"`)}`;
export const europePmcUrl = (title: string) => `https://europepmc.org/search?query=${encodeURIComponent(`TITLE:"${title.replace(/"/g, '')}"`)}`;
