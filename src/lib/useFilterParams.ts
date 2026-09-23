import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DEFAULT_FILTERS, DEFAULT_SORT, type RefFilters, type RefSort, type SortKey, type StatusFilter, type DupFilter } from './api/references';
import type { Stage } from './types';

/** Filters, sort and stage are kept in the URL so a reload or shared link restores the same view. */
export function useFilterParams() {
  const [params, setParams] = useSearchParams();

  const filters: RefFilters = useMemo(() => ({
    q: params.get('q') ?? '',
    status: (params.get('status') as StatusFilter) || DEFAULT_FILTERS.status,
    source: params.get('source') ?? '',
    yearFrom: params.get('yf') ?? '',
    yearTo: params.get('yt') ?? '',
    pubType: params.get('pt') ?? '',
    language: params.get('lang') ?? '',
    tags: (params.get('tags') ?? '').split('|').filter(Boolean),
    dup: (params.get('dup') as DupFilter) || DEFAULT_FILTERS.dup,
    ftStatus: (params.get('fts') as RefFilters['ftStatus']) || '',
    reason: params.get('reason') ?? '',
    kw: (params.get('kw') as RefFilters['kw']) || '',
    pico: (params.get('pico') as RefFilters['pico']) || '',
  }), [params]);

  const sort: RefSort = useMemo(() => ({
    key: (params.get('sort') as SortKey) || DEFAULT_SORT.key,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  }), [params]);

  const stage: Stage = params.get('stage') === 'full_text' ? 'full_text' : 'title_abstract';
  const refId = params.get('ref');

  const update = useCallback((patch: Record<string, string | null | undefined>, replace = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace });
  }, [setParams]);

  const setFilters = useCallback((f: Partial<RefFilters>) => {
    const patch: Record<string, string | null> = {};
    if ('q' in f) patch.q = f.q ?? null;
    if ('status' in f) patch.status = f.status === 'all' ? null : f.status ?? null;
    if ('source' in f) patch.source = f.source ?? null;
    if ('yearFrom' in f) patch.yf = f.yearFrom ?? null;
    if ('yearTo' in f) patch.yt = f.yearTo ?? null;
    if ('pubType' in f) patch.pt = f.pubType ?? null;
    if ('language' in f) patch.lang = f.language ?? null;
    if ('tags' in f) patch.tags = f.tags?.length ? f.tags.join('|') : null;
    if ('dup' in f) patch.dup = f.dup === 'active' ? null : f.dup ?? null;
    if ('ftStatus' in f) patch.fts = f.ftStatus ?? null;
    if ('reason' in f) patch.reason = f.reason ?? null;
    if ('kw' in f) patch.kw = f.kw || null;
    if ('pico' in f) patch.pico = f.pico || null;
    update(patch);
  }, [update]);

  const clearFilters = useCallback(() => {
    update({ q: null, status: null, source: null, yf: null, yt: null, pt: null, lang: null, tags: null, dup: null, fts: null, reason: null, kw: null, pico: null });
  }, [update]);

  const setSort = useCallback((s: RefSort) => update({ sort: s.key === 'seq' ? null : s.key, dir: s.dir === 'asc' ? null : 'desc' }), [update]);

  const activeFilterCount = [
    filters.status !== 'all', filters.source, filters.yearFrom, filters.yearTo, filters.pubType, filters.language,
    filters.tags.length, filters.dup !== 'active', filters.ftStatus, filters.reason, filters.kw, filters.pico,
  ].filter(Boolean).length;

  return { filters, sort, stage, refId, update, setFilters, clearFilters, setSort, activeFilterCount };
}
