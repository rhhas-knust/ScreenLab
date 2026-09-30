import { afterEach, describe, expect, it, vi } from 'vitest';
import { europePmcUrl, findOpenAccess, scholarUrl } from '../../src/lib/api/openAccess';

afterEach(() => vi.unstubAllGlobals());

describe('open-access lookup', () => {
  it('returns the best free PDF from OpenAlex', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      open_access: { is_oa: true, oa_url: 'https://x.org/landing' },
      best_oa_location: { pdf_url: 'https://x.org/a.pdf', landing_page_url: 'https://x.org/landing', source: { display_name: 'PLOS ONE' } },
    })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await findOpenAccess('https://doi.org/10.1371/Journal.X.1')).toEqual({ isOa: true, pdfUrl: 'https://x.org/a.pdf', landingUrl: 'https://x.org/landing', host: 'PLOS ONE' });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('works/doi:10.1371/journal.x.1');
  });
  it('handles unknown DOIs and closed articles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await findOpenAccess('10.1/none')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ open_access: { is_oa: false }, best_oa_location: null, locations: [] }))));
    expect(await findOpenAccess('10.1/closed')).toEqual({ isOa: false, pdfUrl: null, landingUrl: null, host: null });
  });
  it('builds search links from the title', () => {
    expect(scholarUrl('Deep learning in ICU')).toBe('https://scholar.google.com/scholar?q=%22Deep%20learning%20in%20ICU%22');
    expect(europePmcUrl('A "quoted" title')).toContain('TITLE%3A%22A%20quoted%20title%22');
  });
});
