import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { facetCounts, type FacetKind, type RefFilters, type RefSort } from '../lib/api/references';
import { RelevancePanel } from './RelevancePanel';
import type { Stage } from '../lib/types';
import { Spinner, cx } from '../components/ui';

const GROUPS: { kind: FacetKind; label: string }[] = [
  { kind: 'keyword', label: 'Keywords' },
  { kind: 'author', label: 'Authors' },
  { kind: 'journal', label: 'Journals' },
  { kind: 'year', label: 'Years' },
  { kind: 'publication_type', label: 'Publication types' },
  { kind: 'language', label: 'Languages' },
];

/** The filter a facet value sets, and whether it is the one in force. */
function facetFilter(kind: FacetKind, value: string): Partial<RefFilters> {
  switch (kind) {
    case 'author': return { author: value };
    case 'journal': return { journal: value };
    case 'keyword': return { keyword: value };
    case 'year': return { yearFrom: value, yearTo: value };
    case 'publication_type': return { pubType: value };
    case 'language': return { language: value };
  }
}
function isOn(kind: FacetKind, value: string, f: RefFilters): boolean {
  switch (kind) {
    case 'author': return f.author === value;
    case 'journal': return f.journal === value;
    case 'keyword': return f.keyword === value;
    case 'year': return f.yearFrom === value && f.yearTo === value;
    case 'publication_type': return f.pubType === value;
    case 'language': return f.language === value;
  }
}
const clearOf = (kind: FacetKind): Partial<RefFilters> =>
  kind === 'year' ? { yearFrom: '', yearTo: '' } : kind === 'publication_type' ? { pubType: '' } : { [kind]: '' };

function Group({ projectId, stage, kind, label, filters, setFilters }: {
  projectId: string; stage: Stage; kind: FacetKind; label: string; filters: RefFilters; setFilters: (f: Partial<RefFilters>) => void;
}) {
  const [open, setOpen] = useState(kind === 'keyword');
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const data = useQuery({ queryKey: ['facets', projectId, stage, kind], queryFn: () => facetCounts(projectId, stage, kind, 300), enabled: open, staleTime: 60_000 });
  const rows = (data.data ?? []).filter((r) => !q || r.value.toLowerCase().includes(q.toLowerCase()));
  const shown = all || q ? rows : rows.slice(0, 8);
  return (
    <div className="border-b border-slate-100 py-1.5" data-testid={`facet-${kind}`}>
      <button type="button" className="flex w-full items-center justify-between text-left text-xs font-semibold text-ink-900" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {label} <span aria-hidden="true" className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {(data.data?.length ?? 0) > 8 && (
            <input type="search" aria-label={`Find in ${label.toLowerCase()}`} placeholder={`Find ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-0.5 text-xs" />
          )}
          {data.isLoading ? <Spinner className="h-4 w-4" label="Loading…" /> : rows.length === 0 ? <p className="text-xs text-slate-500">None recorded.</p> : (
            <ul className="space-y-0.5">
              {shown.map((r) => {
                const on = isOn(kind, r.value, filters);
                return (
                  <li key={r.value}>
                    <button type="button" aria-pressed={on} onClick={() => setFilters(on ? clearOf(kind) : facetFilter(kind, r.value))}
                      className={cx('flex w-full items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-xs', on ? 'bg-ink-900 text-white' : 'text-slate-700 hover:bg-ink-50')}>
                      <span className="min-w-0 flex-1 truncate" title={r.value}>{r.value}</span>
                      <span className={cx('tabular-nums', on ? 'text-white' : 'text-slate-500')}>{r.n}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!q && rows.length > 8 && (
            <button type="button" className="text-xs text-ink-800 underline" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Browse the records in this stage by keyword, author, journal, year, type and language, with counts. */
export function FacetsPanel({ projectId, stage, filters, setFilters, sort, setSort }: {
  projectId: string; stage: Stage; filters: RefFilters; setFilters: (f: Partial<RefFilters>) => void; sort: RefSort; setSort: (s: RefSort) => void;
}) {
  return (
    <div data-testid="facets" className="space-y-2">
      <RelevancePanel projectId={projectId} stage={stage} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />
      <p className="mb-1 text-xs text-slate-600">Counts are for all records {stage === 'full_text' ? 'at full text' : 'in this review'}. Click one to filter; click again to clear.</p>
      {GROUPS.map((g) => <Group key={g.kind} projectId={projectId} stage={stage} filters={filters} setFilters={setFilters} {...g} />)}
    </div>
  );
}
