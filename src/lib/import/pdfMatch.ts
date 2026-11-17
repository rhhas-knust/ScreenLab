// Match PDF files to references from their file names, for bulk attaching
// full texts (e.g. a folder of PDFs saved from Rayyan, Zotero or EndNote).
// Tries, in order: a DOI in the name, a PubMed ID, a ScreenLab ID (#12),
// the title, then first author + year. Pure functions.

export interface PdfPoolRef { id: string; seq: number; title: string | null; authors: string | null; year: number | null; doi: string | null; pmid: string | null }
export interface PdfMatch { refId: string | null; how: string }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'of', 'and', 'in', 'a', 'an', 'for', 'on', 'to', 'with', 'by', 'from', 'at', 'is', 'are', 'pdf', 'et', 'al', 'full', 'text']);
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const doiKey = (s: string) => s.toLowerCase().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, '').replace(/[^a-z0-9]/g, '');

function surname(authors: string | null): string {
  const a = (authors ?? '').split(/;|\band\b|\n/)[0]?.trim() ?? '';
  if (a.includes(',')) return norm(a.split(',')[0]).split(' ').pop() ?? '';
  const parts = a.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return norm(/^[A-Z]{1,3}\.?$/.test(parts[parts.length - 1]) ? parts[0] : parts[parts.length - 1]).split(' ').pop() ?? '';
}

export function matchPdf(fileName: string, pool: PdfPoolRef[]): PdfMatch {
  const base = decodeURIComponent(fileName.split('/').pop()!.replace(/\.pdf$/i, ''));
  const one = (hits: PdfPoolRef[], how: string): PdfMatch | null =>
    hits.length === 1 ? { refId: hits[0].id, how } : hits.length > 1 ? { refId: null, how: `${hits.length} papers match the ${how}` } : null;

  // DOI: "10.1001_jama.2020.1234.pdf", "10.1001%2Fjama…", "doi 10.1016/j.x".
  const doi = base.match(/10\.\d{4,9}[/_%\s-][^\s]+/i)?.[0];
  if (doi) {
    const key = doiKey(doi.replace(/%2f/i, '/'));
    const m = one(pool.filter((p) => p.doi && doiKey(p.doi) === key), 'DOI');
    if (m) return m;
  }
  // PubMed ID: "PMID 12345678", "12345678.pdf".
  const pmid = base.match(/pmid[\s_-]*(\d{6,9})/i)?.[1] ?? (/^\d{6,9}$/.test(base.trim()) ? base.trim() : undefined);
  if (pmid) { const m = one(pool.filter((p) => (p.pmid ?? '').replace(/\D/g, '') === pmid), 'PubMed ID'); if (m) return m; }
  // ScreenLab ID: "#12 Smith 2020.pdf".
  const seq = base.match(/#\s*(\d+)/)?.[1];
  if (seq) { const m = one(pool.filter((p) => p.seq === Number(seq)), 'ScreenLab ID'); if (m) return m; }

  // Title: most of the file name's words appear in one title (names are often cut short).
  const fw = words(base);
  if (fw.length >= 3) {
    const scored = pool.map((p) => {
      const tw = new Set(words(p.title ?? ''));
      const hit = fw.filter((w) => tw.has(w)).length;
      return { p, s: tw.size ? hit / Math.min(fw.length, tw.size) : 0 };
    }).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s);
    if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s >= 0.15)) return { refId: scored[0].p.id, how: 'title' };
  }
  // First author and year: "Smith 2020", "Smith et al. - 2020 - …".
  const year = Number(base.match(/\b(19|20)\d{2}\b/)?.[0]);
  if (year) {
    const tokens = new Set(norm(base).split(' '));
    const hits = pool.filter((p) => p.year === year && surname(p.authors) && tokens.has(surname(p.authors)));
    const m = one(hits, 'first author and year');
    if (m) return m;
  }
  return { refId: null, how: 'No matching paper found' };
}
