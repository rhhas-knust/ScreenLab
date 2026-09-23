import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMatchingIds, listReferences } from '../lib/api/references';
import { useFilterParams } from '../lib/useFilterParams';
import { useSelection } from '../lib/useSelection';
import { fmt, qk, useCriteriaTerms, useFacets, useReasons, useSettings, useTags } from '../lib/hooks';
import { hasTerms, matchTerms, referenceText } from '../lib/criteria';
import { friendlyError } from '../lib/errors';
import { outbox } from '../lib/outbox';
import type { Reference } from '../lib/types';
import { Alert, Button, Card, Input, Spinner } from '../components/ui';
import { DecisionBadge } from '../components/Decision';
import { FiltersForm, SortControl } from '../components/FiltersForm';
import { BulkDecisionBar } from '../components/BulkDecision';
import { Highlight } from '../components/Highlight';

const PAGE = 100;

export function ReferencesPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { filters: urlFilters, sort, stage, setFilters, clearFilters, setSort, update, activeFilterCount } = useFilterParams();
  const criteria = useCriteriaTerms(projectId);
  const filters = useMemo(() => ({ ...urlFilters, terms: criteria }), [urlFilters, criteria]);
  const { data: facets } = useFacets(projectId);
  const { data: tags } = useTags(projectId);
  const { data: reasons = [] } = useReasons(projectId);
  const { data: settings } = useSettings(projectId);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState(urlFilters.q);
  const [showFilters, setShowFilters] = useState(false);
  const [showAbstracts, setShowAbstracts] = useState(() => {
    try { return localStorage.getItem('screenlab:showAbstracts') === '1'; } catch { return false; }
  });
  const viewKey = JSON.stringify([filters, sort, stage]);
  const sel = useSelection(viewKey);
  useEffect(() => setPage(0), [viewKey]);
  useEffect(() => {
    const t = setTimeout(() => { if (search !== urlFilters.q) setFilters({ q: search }); }, 350);
    return () => clearTimeout(t);
  }, [search, urlFilters.q, setFilters]);

  const q = useQuery({
    queryKey: [...qk.refs(projectId), 'table', stage, filters, sort, page],
    queryFn: () => listReferences(projectId, stage, filters, sort, page, PAGE, ',abstract,keywords'),
    placeholderData: keepPreviousData,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.count / PAGE)) : 1;
  const qs = new URLSearchParams(window.location.search);
  const decisionOf = (r: Reference) => (stage === 'title_abstract' ? r.title_abstract_decision : r.full_text_decision);
  const rows = (q.data?.rows ?? []).map((row) => outbox.overlay(row as Reference));
  const pageAll = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const pageSome = rows.some((r) => sel.has(r.id));
  const kwOn = hasTerms(criteria);

  const afterBulk = () => {
    sel.clear();
    qc.invalidateQueries({ queryKey: qk.refs(projectId) });
    qc.invalidateQueries({ queryKey: qk.stats(projectId) });
    qc.invalidateQueries({ queryKey: qk.activity(projectId) });
    qc.invalidateQueries({ queryKey: qk.projects });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">References</h1>
          <p className="text-sm text-slate-600">{q.data ? `${fmt(q.data.count)} references in this view` : ' '}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => nav(`/p/${projectId}/import`)}>Import references</Button>
          <Button variant="primary" onClick={() => nav(`/p/${projectId}/screening?${qs.toString()}`)}>Screen these</Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="min-w-60 flex-1">
          <label htmlFor="ref-search" className="sr-only">Search references</label>
          <Input id="ref-search" type="search" placeholder="Search title, abstract, authors, journal, DOI, PMID, keywords, notes, tags…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {settings?.stage2_enabled && (
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            <button type="button" aria-pressed={stage === 'title_abstract'} onClick={() => update({ stage: null })} className={`rounded-md px-2 py-1.5 ${stage === 'title_abstract' ? 'bg-white shadow-sm' : ''}`}>Title/abstract stage</button>
            <button type="button" aria-pressed={stage === 'full_text'} onClick={() => update({ stage: 'full_text' })} className={`rounded-md px-2 py-1.5 ${stage === 'full_text' ? 'bg-white shadow-sm' : ''}`}>Full-text stage</button>
          </div>
        )}
        <Button variant={activeFilterCount ? 'subtle' : 'secondary'} onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Button>
        <SortControl sort={sort} setSort={setSort} id="ref-sort" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={showAbstracts} onChange={(e) => {
            setShowAbstracts(e.target.checked);
            try { localStorage.setItem('screenlab:showAbstracts', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
          }} />
          Show abstracts
        </label>
      </div>
      {showFilters && (
        <Card className="mt-3 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FiltersForm filters={filters} setFilters={setFilters} clearFilters={clearFilters} facets={facets} tags={tags} stage={stage} idPrefix="rf" criteriaReady={kwOn} />
          </div>
        </Card>
      )}

      <div className="sticky top-0 z-20 mt-3 min-h-10 bg-slate-50/95 py-1 backdrop-blur">
        {sel.active ? (
          <BulkDecisionBar projectId={projectId} stage={stage} count={sel.count(q.data?.count ?? 0)} reasons={reasons}
            getItems={async () => sel.allMatching
              ? (await fetchMatchingIds(projectId, stage, filters, sort)).map((r) => ({ id: r.id, decision: r.decision }))
              : [...sel.picked].map(([id, decision]) => ({ id, decision }))}
            onDone={afterBulk} onClear={sel.clear}
            extra={q.data && !sel.allMatching && pageAll && q.data.count > rows.length ? (
              <button type="button" className="text-ink-800 underline" onClick={sel.selectAllMatching}>Select all {fmt(q.data.count)} matching this view</button>
            ) : sel.allMatching ? <span className="text-ink-800">(all records matching the current search and filters)</span> : null} />
        ) : (
          <p className="px-1 py-2 text-xs text-slate-500">Tick records to include, exclude or mark maybe several at once{kwOn ? '' : '. Tip: add criteria keywords in Settings to highlight and filter by them'}.</p>
        )}
      </div>

      <Card className="mt-1 overflow-x-auto">
        {q.error ? <div className="p-4"><Alert>{friendlyError(q.error)}</Alert></div> : !q.data ? <div className="p-6"><Spinner label="Loading…" /></div> : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-600">No references match.</p>
        ) : (
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" aria-label="Select all on this page" checked={pageAll}
                    ref={(el) => { if (el) el.indeterminate = !pageAll && pageSome; }}
                    onChange={(e) => sel.setMany(rows.map((r) => ({ id: r.id, decision: decisionOf(r) })), e.target.checked)} />
                </th>
                <th className="px-3 py-2">#</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">First author</th><th className="px-3 py-2">Year</th>
                <th className="px-3 py-2">Database</th><th className="px-3 py-2">Title/abstract</th>{settings?.stage2_enabled && <th className="px-3 py-2">Full text</th>}
                {kwOn && <th className="px-3 py-2" title="Criteria keywords found in title, abstract and keywords">Keywords</th>}
                <th className="px-3 py-2">Tags</th>
              </tr>
            </thead>
            <tbody className={q.isFetching ? 'opacity-70' : ''}>
              {rows.map((r) => {
                const text = referenceText(r);
                const inc = kwOn ? matchTerms(text, criteria.include) : [];
                const exc = kwOn ? matchTerms(text, criteria.exclude) : [];
                const checked = sel.has(r.id);
                return (
                  <tr key={r.id} className={`border-b border-slate-100 align-top hover:bg-slate-50 ${checked ? 'bg-ink-50' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select: ${r.title ?? 'untitled'}`} checked={checked} onChange={() => sel.toggle(r.id, decisionOf(r))} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 tabular-nums">{r.seq}</td>
                    <td className="max-w-xl px-3 py-2">
                      <Link className="font-medium text-ink-900 hover:underline" to={`/p/${projectId}/screening?ref=${r.id}${stage === 'full_text' ? '&stage=full_text' : ''}`}>
                        {r.title ? <Highlight text={r.title} terms={criteria} search={filters.q.split(/\s+/).filter((t) => t.length > 1)} /> : '[No title]'}
                      </Link>
                      {r.duplicate_status !== 'none' && r.duplicate_status !== 'kept' && <span className="ml-1 text-xs text-amber-800">({r.duplicate_status === 'possible' ? 'possible duplicate' : r.duplicate_status})</span>}
                      {showAbstracts && (
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                          {r.abstract ? <Highlight text={r.abstract} terms={criteria} search={filters.q.split(/\s+/).filter((t) => t.length > 1)} /> : <em className="text-slate-400">No abstract</em>}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2">{r.authors?.split(';')[0]}</td>
                    <td className="px-3 py-2 tabular-nums">{r.year}</td>
                    <td className="px-3 py-2">{r.database_source}</td>
                    <td className="px-3 py-2"><DecisionBadge decision={r.title_abstract_decision} reason={r.title_abstract_exclusion_reason} /></td>
                    {settings?.stage2_enabled && <td className="px-3 py-2">{r.title_abstract_decision === 'include' ? <DecisionBadge decision={r.full_text_decision} reason={r.full_text_exclusion_reason} /> : <span className="text-xs text-slate-400">—</span>}</td>}
                    {kwOn && (
                      <td className="px-3 py-2 text-xs whitespace-nowrap" title={[inc.length ? `Inclusion: ${inc.join(', ')}` : '', exc.length ? `Exclusion: ${exc.join(', ')}` : ''].filter(Boolean).join('\n') || 'No keywords found'}>
                        <span className={inc.length ? 'font-semibold text-emerald-800' : 'text-slate-400'}>✓{inc.length}</span>{' '}
                        <span className={exc.length ? 'font-semibold text-rose-800' : 'text-slate-400'}>✕{exc.length}</span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs">{(r.tag_names ?? []).map((t) => `#${t}`).join(' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {q.data && q.data.count > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
          <span className="tabular-nums">Page {page + 1} / {pages}</span>
          <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}
