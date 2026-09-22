import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchQueue, getReference, listReferences, neighbor, setDuplicateStatus, type ListPage,
} from '../lib/api/references';
import { createReason } from '../lib/api/tags';
import { updateSettings } from '../lib/api/projects';
import { friendlyError } from '../lib/errors';
import { fmt, pct, qk, useFacets, useProject, useReasons, useSettings, useStats, useTags } from '../lib/hooks';
import { outbox } from '../lib/outbox';
import { useFilterParams } from '../lib/useFilterParams';
import type { Decision, Reference, ReferenceListItem, Stage } from '../lib/types';
import { DECISION_META, DecisionBadge, DecisionIcon } from '../components/Decision';
import { FiltersForm, SortControl } from '../components/FiltersForm';
import { CriteriaView } from '../components/CriteriaView';
import { Alert, Button, Input, Kbd, Modal, PageLoader, ProgressBar, Spinner, cx } from '../components/ui';
import { useToast } from '../components/Toast';
import { ArticleView } from './ArticleView';
import { ConfirmChangeBar, DecisionButtons, ReasonPicker, type PendingChange } from './DecisionPanel';
import { NotesEditor } from './NotesEditor';
import { TagEditor } from './TagEditor';
import { FullTextPanel } from './FullTextPanel';
import { HistoryPanel } from './HistoryPanel';
import { ShortcutsHelp } from './ShortcutsHelp';

const PAGE_SIZE = 50;

interface UndoEntry {
  refId: string;
  stage: Stage;
  title: string | null;
  prevDecision: Decision | null;
  prevReason: string | null;
  newDecision: Decision;
  newReason: string | null;
}

function decisionOf(r: Pick<Reference, 'title_abstract_decision' | 'full_text_decision'>, stage: Stage): Decision | null {
  return stage === 'title_abstract' ? r.title_abstract_decision : r.full_text_decision;
}
function reasonOf(r: Pick<Reference, 'title_abstract_exclusion_reason' | 'full_text_exclusion_reason'>, stage: Stage): string | null {
  return stage === 'title_abstract' ? r.title_abstract_exclusion_reason : r.full_text_exclusion_reason;
}
function decisionText(d: Decision | null, reason: string | null) {
  const m = DECISION_META[d ?? 'unscreened'];
  return `${m.icon} ${m.label}${reason ? ` — ${reason}` : ''}`;
}

function readLocal(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function ScreeningPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: project } = useProject(projectId);
  const { data: settings } = useSettings(projectId);
  const { data: stats } = useStats(projectId);
  const { data: reasons = [] } = useReasons(projectId);
  const { data: tags = [] } = useTags(projectId);
  const { data: facets } = useFacets(projectId);
  const { filters, sort, stage: stageParam, refId, update, setFilters, clearFilters, setSort, activeFilterCount } = useFilterParams();
  const stage: Stage = settings && !settings.stage2_enabled ? 'title_abstract' : stageParam;

  const [current, setCurrent] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState(filters.q);
  const [autoAdvance, setAutoAdvance] = useState(() => readLocal('screenlab:autoAdvance', true));
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoKey = `screenlab:undo:${projectId}`;
  const [undoStack, setUndoStack] = useState<UndoEntry[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(undoKey) ?? '[]') as UndoEntry[];
    } catch {
      return [];
    }
  });

  const queueRef = useRef<Reference[]>([]);
  const decidedRef = useRef<Set<string>>(new Set());
  const recentRef = useRef<Map<string, Reference>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const navSeq = useRef(0);

  const shortcutsEnabled = settings?.keyboard_shortcuts_enabled ?? true;
  const filterKey = JSON.stringify([stage, filters, sort]);
  const terms = useMemo(() => filters.q.toLowerCase().split(/\s+/).filter((t) => t.length > 1), [filters.q]);
  const applicableReasons = useMemo(() => reasons.filter((r) => r.is_active && (r.stage === 'both' || r.stage === stage)), [reasons, stage]);

  useEffect(() => {
    try {
      sessionStorage.setItem(undoKey, JSON.stringify(undoStack.slice(-50)));
    } catch {
      /* ignore */
    }
  }, [undoStack, undoKey]);

  // ---- List (left panel) -------------------------------------------------
  const listQuery = useQuery({
    queryKey: [...qk.refs(projectId), 'list', stage, filters, sort, page],
    queryFn: () => listReferences(projectId, stage, filters, sort, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  // ---- Showing references --------------------------------------------------
  const key = (id: string, s: Stage = stage) => `${s}:${id}`;
  const isUnscreened = useCallback((r: Reference) => {
    const o = outbox.overlay(r);
    return decisionOf(o, stage) == null && !decidedRef.current.has(`${stage}:${r.id}`);
  }, [stage]);

  const show = useCallback((r: Reference) => {
    const o = outbox.overlay(r);
    recentRef.current.set(o.id, o);
    if (recentRef.current.size > 200) recentRef.current.delete(recentRef.current.keys().next().value!);
    setCurrent(o);
    setAllDone(false);
    setLoadError(null);
    setReasonOpen(false);
    setPendingChange(null);
    update({ ref: o.id });
    centerRef.current?.scrollTo({ top: 0 });
  }, [update]);

  const openById = useCallback(async (id: string) => {
    const seq = ++navSeq.current;
    const cached = recentRef.current.get(id);
    if (cached) show(cached);
    else setLoading(true);
    try {
      const r = await getReference(id);
      if (seq !== navSeq.current) return;
      if (r.project_id !== projectId) throw { code: 'PGRST116' };
      show(r);
    } catch (e) {
      if (seq !== navSeq.current) return;
      if (!cached) setLoadError(friendlyError(e, 'Could not open this reference.'));
    } finally {
      if (seq === navSeq.current) setLoading(false);
    }
  }, [projectId, show]);

  const refill = useCallback(async (after: Reference | null) => {
    const rows = await fetchQueue(projectId, stage, filters, sort, after, 15);
    const have = new Set(queueRef.current.map((r) => r.id));
    for (const r of rows) if (!have.has(r.id) && isUnscreened(r)) queueRef.current.push(r);
  }, [projectId, stage, filters, sort, isUnscreened]);

  /** Move to the next UNSCREENED reference (never into screened ones). */
  const goNextUnscreened = useCallback(async (after: Reference | null) => {
    const seq = ++navSeq.current;
    queueRef.current = queueRef.current.filter((r) => r.id !== after?.id && isUnscreened(r));
    if (!queueRef.current.length) {
      setLoading(true);
      try {
        await refill(after);
      } catch (e) {
        if (seq === navSeq.current) {
          setLoading(false);
          toast(`Could not load the next article: ${friendlyError(e)}`, { kind: 'error' });
        }
        return;
      }
      if (seq !== navSeq.current) return;
      queueRef.current = queueRef.current.filter((r) => r.id !== after?.id && isUnscreened(r));
    }
    setLoading(false);
    const next = queueRef.current.shift();
    if (!next) {
      setCurrent(null);
      setAllDone(true);
      update({ ref: null });
      return;
    }
    show(next);
    if (queueRef.current.length < 5) {
      refill(queueRef.current[queueRef.current.length - 1] ?? next).catch(() => { /* prefetch only */ });
    }
  }, [isUnscreened, refill, show, toast, update]);

  // Initial load, and whenever the stage / filters / sort change
  const firstLoad = useRef(true);
  useEffect(() => {
    queueRef.current = [];
    setPage(0);
    if (firstLoad.current && refId) {
      firstLoad.current = false;
      void openById(refId);
      return;
    }
    firstLoad.current = false;
    void goNextUnscreened(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => setSearchText(filters.q), [filters.q]);
  useEffect(() => {
    if (searchText === filters.q) return;
    const t = setTimeout(() => setFilters({ q: searchText }), 350);
    return () => clearTimeout(t);
  }, [searchText, filters.q, setFilters]);

  // Keep the current article in sync when its pending changes reach the server
  useEffect(() => outbox.onSynced((op, result) => {
    if (op.kind === 'decision') setHistoryVersion((v) => v + 1);
    setCurrent((c) => (c && c.id === result.id ? outbox.overlay({ ...result }) : c));
  }), []);

  const patchListCache = useCallback((id: string, patch: Partial<Reference>) => {
    qc.setQueriesData<ListPage>({ queryKey: [...qk.refs(projectId), 'list'] }, (old) =>
      old ? { ...old, rows: old.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : old);
  }, [qc, projectId]);

  const applyLocal = useCallback((patch: Partial<Reference>) => {
    setCurrent((c) => {
      if (!c) return c;
      const n = { ...c, ...patch };
      recentRef.current.set(n.id, n);
      patchListCache(n.id, patch);
      return n;
    });
  }, [patchListCache]);

  // ---- Decisions -----------------------------------------------------------
  const decide = useCallback((decision: Decision, reason?: string | null, confirmed = false) => {
    const cur = current;
    if (!cur) return;
    if (stage === 'full_text' && decision === 'maybe') return;
    const prevD = decisionOf(cur, stage);
    const prevR = reasonOf(cur, stage);

    if (decision === 'exclude' && reason === undefined) {
      setPendingChange(null);
      setReasonOpen(true);
      return;
    }
    if (stage === 'full_text' && decision === 'exclude' && !reason) {
      toast('Please choose an exclusion reason for full-text exclusions.', { kind: 'error' });
      setReasonOpen(true);
      return;
    }
    const newReason = decision === 'exclude' ? reason ?? null : null;
    if (prevD === decision && prevR === newReason) {
      setReasonOpen(false);
      if (autoAdvance) void goNextUnscreened(cur);
      return;
    }
    if (prevD && !confirmed) {
      setReasonOpen(false);
      setPendingChange({ decision, reason: newReason });
      return;
    }

    // 1) durable local write + server sync (outbox), 2) optimistic UI, 3) advance
    outbox.enqueueDecision({
      projectId, referenceId: cur.id, title: cur.title, stage, decision, reason: newReason, action: 'decide',
    });
    decidedRef.current.add(key(cur.id));
    setUndoStack((s) => [...s.slice(-49), { refId: cur.id, stage, title: cur.title, prevDecision: prevD, prevReason: prevR, newDecision: decision, newReason }]);
    const updated = outbox.overlay(cur);
    recentRef.current.set(cur.id, updated);
    patchListCache(cur.id, updated);
    setReasonOpen(false);
    setPendingChange(null);
    toast(`${prevD ? `Changed to ${decisionText(decision, newReason)}` : decisionText(decision, newReason)}`, {
      action: { label: 'Undo', onClick: () => undoRef.current() },
    });
    if (autoAdvance) void goNextUnscreened(cur);
    else setCurrent(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, stage, projectId, autoAdvance, goNextUnscreened, patchListCache, toast]);

  const undo = useCallback(() => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) {
      toast('Nothing to undo in this session.');
      return;
    }
    outbox.enqueueDecision({
      projectId, referenceId: entry.refId, title: entry.title, stage: entry.stage,
      decision: entry.prevDecision, reason: entry.prevReason, action: 'undo',
    });
    if (entry.prevDecision == null) decidedRef.current.delete(key(entry.refId, entry.stage));
    else decidedRef.current.add(key(entry.refId, entry.stage));
    setUndoStack((s) => s.slice(0, -1));
    const cached = recentRef.current.get(entry.refId);
    if (cached) patchListCache(entry.refId, outbox.overlay(cached));
    toast(`Undone — restored ${decisionText(entry.prevDecision, entry.prevReason)}`);
    if (entry.stage === stage) void openById(entry.refId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, projectId, stage, openById, patchListCache, toast]);
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const go = useCallback(async (direction: 'next' | 'prev') => {
    if (!current) {
      if (direction === 'next') void goNextUnscreened(null);
      return;
    }
    const seq = ++navSeq.current;
    try {
      const r = await neighbor(projectId, stage, filters, sort, current, direction);
      if (seq !== navSeq.current) return;
      if (r) show(r);
      else toast(direction === 'next' ? 'This is the last article in the list.' : 'This is the first article in the list.');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  }, [current, projectId, stage, filters, sort, show, goNextUnscreened, toast]);

  const addReason = useCallback(async (label: string) => {
    await createReason(projectId, label, (reasons.at(-1)?.sort_order ?? 0) + 1);
    await qc.invalidateQueries({ queryKey: qk.reasons(projectId) });
  }, [projectId, reasons, qc]);

  const toggleShortcuts = async (v: boolean) => {
    try {
      await updateSettings(projectId, { keyboard_shortcuts_enabled: v });
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  const markDuplicate = async (status: 'duplicate' | 'kept' | 'none') => {
    if (!current) return;
    try {
      const r = await setDuplicateStatus(current.id, status);
      qc.invalidateQueries({ queryKey: qk.stats(projectId) });
      qc.invalidateQueries({ queryKey: qk.refs(projectId) });
      if (status === 'duplicate') {
        toast('Marked as duplicate — removed from screening', { action: { label: 'Undo', onClick: () => { void setDuplicateStatus(r.id, 'none').then((x) => { show(x); qc.invalidateQueries({ queryKey: qk.stats(projectId) }); }); } } });
        void goNextUnscreened(current);
      } else {
        show(r);
      }
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  // ---- Keyboard shortcuts ------------------------------------------------------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (reasonOpen) setReasonOpen(false);
      else if (pendingChange) setPendingChange(null);
      else if (listOpen) setListOpen(false);
      else if (typing) target?.blur();
      return;
    }
    if (typing || document.querySelector('dialog[open]')) return;
    if (!shortcutsEnabled) {
      if (e.key === '?') setHelpOpen(true);
      return;
    }
    const k = e.key.toLowerCase();
    if (pendingChange) {
      const confirmKey = { include: 'i', exclude: 'e', maybe: 'm' }[pendingChange.decision];
      if (e.key === 'Enter' || k === confirmKey) {
        e.preventDefault();
        decide(pendingChange.decision, pendingChange.reason ?? null, true);
        return;
      }
    }
    if (reasonOpen && /^[1-9]$/.test(e.key)) {
      const r = applicableReasons[Number(e.key) - 1];
      if (r) {
        e.preventDefault();
        decide('exclude', r.label);
      }
      return;
    }
    const actions: Record<string, () => void> = {
      i: () => decide('include'),
      e: () => decide('exclude'),
      m: () => decide('maybe'),
      n: () => void go('next'),
      p: () => void go('prev'),
      u: () => undo(),
      '/': () => {
        setListOpen(true);
        setTimeout(() => searchRef.current?.focus(), 30);
      },
      '?': () => setHelpOpen(true),
      c: () => setCriteriaOpen(true),
      l: () => setListOpen((x) => !x),
    };
    const fn = actions[k];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  if (!project || !settings) return <PageLoader />;

  // ---- Progress --------------------------------------------------------------
  const done = stage === 'title_abstract' ? stats?.ta_screened ?? 0 : stats?.ft_screened ?? 0;
  const total = stage === 'title_abstract' ? stats?.after_dedup ?? 0 : stats?.ft_pool ?? 0;
  const curDecision = current ? decisionOf(current, stage) : null;
  const curReason = current ? reasonOf(current, stage) : null;

  const stageTabs = settings.stage2_enabled && (
    <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium" role="tablist" aria-label="Screening stage">
      {(['title_abstract', 'full_text'] as Stage[]).map((s) => (
        <button key={s} role="tab" aria-selected={stage === s} type="button"
          onClick={() => update({ stage: s === 'title_abstract' ? null : s, ref: null, status: null, reason: null })}
          className={cx('flex-1 rounded-md px-2 py-1', stage === s ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-600 hover:text-ink-900')}>
          {s === 'title_abstract' ? 'Title / abstract' : `Full text${stats ? ` (${fmt(stats.ft_pool)})` : ''}`}
        </button>
      ))}
    </div>
  );

  const listPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3">
        {stageTabs}
        <div>
          <label htmlFor="screen-search" className="sr-only">Search articles</label>
          <Input ref={searchRef} id="screen-search" type="search" placeholder="Search articles…  ( / )" value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setFilters({ q: searchText }); }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant={activeFilterCount ? 'subtle' : 'ghost'} onClick={() => setFiltersOpen((x) => !x)} aria-expanded={filtersOpen}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''} {filtersOpen ? '▴' : '▾'}
          </Button>
          <SortControl sort={sort} setSort={setSort} id="screen-sort" />
        </div>
        {filtersOpen && (
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
            <FiltersForm filters={filters} setFilters={setFilters} clearFilters={clearFilters} facets={facets} tags={tags} stage={stage} idPrefix="sf" />
          </div>
        )}
        <div className="text-xs text-slate-600">
          <div className="flex justify-between tabular-nums"><span><strong>{fmt(done)}</strong> / {fmt(total)} screened</span><span>{pct(done, total)}</span></div>
          <div className="mt-1"><ProgressBar value={done} max={total} label="Screening progress" /></div>
          <div className="mt-1">{listQuery.data ? `${fmt(listQuery.data.count)} match${listQuery.data.count === 1 ? 'es' : ''} current view` : ' '}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={listQuery.isFetching}>
        {listQuery.error ? (
          <div className="p-3"><Alert>{friendlyError(listQuery.error)}</Alert></div>
        ) : !listQuery.data ? (
          <div className="p-4"><Spinner label="Loading list…" /></div>
        ) : listQuery.data.rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-600">No articles match. {activeFilterCount || filters.q ? <button className="underline" type="button" onClick={() => { clearFilters(); setSearchText(''); }}>Clear search & filters</button> : null}</p>
        ) : (
          <ul aria-label="Articles">
            {listQuery.data.rows.map((row: ReferenceListItem) => {
              const o = outbox.overlay(row as Reference);
              const d = decisionOf(o, stage);
              const active = current?.id === row.id;
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => { setListOpen(false); void openById(row.id); }}
                    aria-current={active ? 'true' : undefined}
                    className={cx('flex w-full gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-ink-50', active && 'bg-ink-100 hover:bg-ink-100')}>
                    <DecisionIcon decision={d} />
                    <span className="min-w-0 flex-1">
                      <span className={cx('line-clamp-2 text-sm', d ? 'text-slate-600' : 'font-medium text-slate-900')}>{row.title ?? '[No title]'}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {[row.authors?.split(';')[0], row.year, row.database_source].filter(Boolean).join(' · ')}
                        {row.duplicate_status === 'possible' && ' · ⚠ possible duplicate'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {listQuery.data && listQuery.data.count > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
          <span className="tabular-nums">Page {page + 1} / {Math.ceil(listQuery.data.count / PAGE_SIZE)}</span>
          <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE_SIZE >= listQuery.data.count} onClick={() => setPage((p) => p + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );

  const reasonPicker = reasonOpen && current && (
    <ReasonPicker reasons={reasons} stage={stage} currentReason={curReason}
      onPick={(r) => decide('exclude', r)} onCancel={() => setReasonOpen(false)} onAddReason={addReason} />
  );
  const confirmBar = pendingChange && curDecision && (
    <ConfirmChangeBar from={curDecision} to={pendingChange}
      onConfirm={() => decide(pendingChange.decision, pendingChange.reason ?? null, true)} onCancel={() => setPendingChange(null)} />
  );

  const detailPanels = current && (
    <div className="space-y-5">
      <NotesEditor reference={current} projectId={projectId} onLocalChange={(notes) => applyLocal({ notes })} />
      <TagEditor reference={current} tags={tags} projectId={projectId} onChange={(tag_names) => applyLocal({ tag_names })} />
      <FullTextPanel reference={current} projectId={projectId} onLocalChange={applyLocal} />
      <div className="space-y-1 text-sm">
        <div className="font-semibold text-ink-900">Duplicate status</div>
        {current.duplicate_status === 'possible' && <p className="text-xs text-amber-900">Flagged as a possible duplicate. <Link className="underline" to={`/p/${projectId}/duplicates`}>Compare on the Duplicates page</Link></p>}
        <div className="flex flex-wrap gap-1">
          {current.duplicate_status === 'duplicate' || current.duplicate_status === 'merged' ? (
            <Button size="sm" onClick={() => markDuplicate('none')}>Restore to screening</Button>
          ) : (
            <>
              <Button size="sm" onClick={() => markDuplicate('duplicate')}>Mark as duplicate</Button>
              {current.duplicate_status === 'possible' && <Button size="sm" variant="ghost" onClick={() => markDuplicate('kept')}>Not a duplicate</Button>}
            </>
          )}
        </div>
      </div>
      <HistoryPanel referenceId={current.id} version={`${historyVersion}`} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: search, filters, list */}
      <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white xl:block" aria-label="Article list">{listPanel}</aside>
      {listOpen && (
        <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-label="Article list">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setListOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(24rem,90vw)] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="font-semibold text-ink-900">Articles</span>
              <Button size="sm" variant="ghost" onClick={() => setListOpen(false)} aria-label="Close article list">✕</Button>
            </div>
            <div className="min-h-0 flex-1">{listPanel}</div>
          </div>
        </div>
      )}

      {/* CENTRE: article */}
      <section ref={centerRef} className="min-w-0 flex-1 overflow-y-auto bg-white lg:bg-slate-50" aria-label="Article details">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          <Button size="sm" variant="subtle" className="xl:hidden" onClick={() => setListOpen(true)} aria-label="Show article list, search and filters">☰ List</Button>
          <span className="truncate text-xs text-slate-600 sm:text-sm">
            <strong className="text-ink-900">{stage === 'title_abstract' ? 'Title / abstract screening' : 'Full-text screening'}</strong>
            <span className="tabular-nums"> · {fmt(done)} / {fmt(total)} screened</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCriteriaOpen(true)} aria-keyshortcuts="C">Review criteria</Button>
            <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">⌨<span className="hidden sm:inline"> Shortcuts</span></Button>
          </div>
        </div>
        {loading && !current ? (
          <PageLoader label="Loading article…" />
        ) : loadError ? (
          <div className="mx-auto max-w-xl p-6">
            <Alert>{loadError}</Alert>
            <Button className="mt-3" onClick={() => { setLoadError(null); void goNextUnscreened(null); }}>Go to next unscreened article</Button>
          </div>
        ) : allDone || !current ? (
          <div className="mx-auto max-w-xl p-8 text-center">
            <div className="text-4xl" aria-hidden="true">✓</div>
            <h1 className="mt-2 text-xl font-semibold text-ink-900">
              {total === 0 && stage === 'title_abstract' && !activeFilterCount && !filters.q ? 'No references to screen yet' : 'All caught up'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {total === 0 && stage === 'title_abstract' && !activeFilterCount && !filters.q
                ? 'Import references to start screening.'
                : `There are no unscreened articles${activeFilterCount || filters.q ? ' matching the current search and filters' : ` at the ${stage === 'title_abstract' ? 'title/abstract' : 'full-text'} stage`}.`}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {total === 0 && stage === 'title_abstract' && <Button variant="primary" onClick={() => nav(`/p/${projectId}/import`)}>Import references</Button>}
              {(activeFilterCount > 0 || filters.q) && <Button onClick={() => { clearFilters(); setSearchText(''); }}>Clear search & filters</Button>}
              {stage === 'title_abstract' && settings.stage2_enabled && (stats?.ft_unscreened ?? 0) > 0 && (
                <Button variant="primary" onClick={() => update({ stage: 'full_text', ref: null })}>Go to full-text screening ({fmt(stats?.ft_unscreened)})</Button>
              )}
              <Button onClick={() => { setListOpen(true); }} className="xl:hidden">Browse screened articles</Button>
              <Button variant="ghost" onClick={() => nav(`/p/${projectId}`)}>Back to dashboard</Button>
            </div>
          </div>
        ) : (
          <div className={cx(loading && 'opacity-60')}>
            {curDecision && (
              <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
                <p className="text-sm">Current decision: <DecisionBadge decision={curDecision} reason={curReason} /></p>
              </div>
            )}
            <ArticleView reference={current} stage={stage} terms={terms} />
            <div className="mx-auto max-w-3xl border-t border-slate-200 px-4 py-5 sm:px-6 lg:hidden">{detailPanels}</div>
            <div className="h-44 lg:hidden" aria-hidden="true" />
          </div>
        )}
      </section>

      {/* RIGHT: decision controls */}
      <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white lg:flex" aria-label="Screening controls">
        {current && !allDone && (
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Decision</h2>
              <DecisionButtons stage={stage} current={curDecision} onDecide={(d) => decide(d)} />
              {confirmBar}
              {reasonPicker}
              <div className="grid grid-cols-3 gap-1">
                <Button size="sm" onClick={() => void go('prev')} aria-keyshortcuts="P">← Prev <Kbd>P</Kbd></Button>
                <Button size="sm" onClick={() => void go('next')} aria-keyshortcuts="N">Next → <Kbd>N</Kbd></Button>
                <Button size="sm" onClick={undo} disabled={!undoStack.length} aria-keyshortcuts="U">Undo <Kbd>U</Kbd></Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={autoAdvance} onChange={(e) => {
                  setAutoAdvance(e.target.checked);
                  try { localStorage.setItem('screenlab:autoAdvance', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
                }} />
                Automatically open the next unscreened article
              </label>
            </div>
            <div className="border-t border-slate-200 pt-4">{detailPanels}</div>
          </div>
        )}
      </aside>

      {/* MOBILE / TABLET: bottom decision bar */}
      {current && !allDone && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/97 p-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
          <div className="mx-auto max-w-3xl space-y-2">
            {(reasonOpen || pendingChange) && <div className="max-h-[55vh] overflow-y-auto">{confirmBar}{reasonPicker}</div>}
            <DecisionButtons stage={stage} current={curDecision} onDecide={(d) => decide(d)} size="md" />
            <div className="grid grid-cols-3 gap-1">
              <Button size="sm" onClick={() => void go('prev')}>← Prev</Button>
              <Button size="sm" onClick={undo} disabled={!undoStack.length}>Undo</Button>
              <Button size="sm" onClick={() => void go('next')}>Next →</Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={criteriaOpen} onClose={() => setCriteriaOpen(false)} title="Review criteria" size="lg">
        <CriteriaView project={project} />
      </Modal>
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} enabled={shortcutsEnabled} onToggle={toggleShortcuts} />
    </div>
  );
}

