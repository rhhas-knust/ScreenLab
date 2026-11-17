import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { relevanceDocs, saveRelevance, type RefFilters, type RefSort } from '../lib/api/references';
import { predictRelevance, MIN_EACH } from '../lib/relevance';
import { qk } from '../lib/hooks';
import { friendlyError } from '../lib/errors';
import type { Stage } from '../lib/types';
import { Button, cx } from '../components/ui';

/** "★★★★☆" with an accessible label. */
export function Stars({ n, className }: { n: number | null; className?: string }) {
  if (!n) return null;
  return (
    <span className={cx('whitespace-nowrap text-[11px] tracking-tight text-amber-600', className)} role="img" aria-label={`Predicted relevance ${n} of 5`} title={`Predicted relevance ${n} of 5 (a guide, not a decision)`}>
      {'★'.repeat(n)}<span className="text-slate-300">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

/** Rate every record from the team's decisions, then sort or filter by the rating. */
export function RelevancePanel({ projectId, stage, filters, setFilters, sort, setSort }: {
  projectId: string; stage: Stage; filters: RefFilters; setFilters: (f: Partial<RefFilters>) => void; sort: RefSort; setSort: (s: RefSort) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const docs = await relevanceDocs(projectId, stage);
      const r = predictRelevance(docs.map((d) => ({ ...d, label: d.decision === 'include' ? 1 : d.decision === 'exclude' ? 0 : null })));
      await saveRelevance(projectId, stage, r.scores);
      await qc.invalidateQueries({ queryKey: qk.refs(projectId) });
      if (sort.key !== 'relevance') setSort({ key: 'relevance', dir: 'desc' });
      setNote({ ok: true, text: `Rated ${r.scores.size} records from ${r.includes} included and ${r.excludes} excluded.${r.auc != null ? ` On decisions held back to check it, an included record scored above an excluded one ${Math.round(r.auc * 100)}% of the time.` : ''}` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error && /at least/.test(e.message) ? e.message : friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 border-b border-slate-200 pb-2" data-testid="relevance-panel">
      <div className="text-xs font-semibold text-ink-900">Predicted relevance</div>
      <p className="text-xs text-slate-600">
        Learns from the included and excluded records at this stage (at least {MIN_EACH} of each) and rates the rest 1–5 stars, so likely includes come first.
        A guide for ordering only: every decision is still yours. Update it as you screen.
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="secondary" onClick={() => void run()} loading={busy} data-testid="relevance-run">★ Rate records</Button>
        {[5, 4, 3].map((n) => (
          <button key={n} type="button" aria-pressed={filters.minStars === n} onClick={() => setFilters({ minStars: filters.minStars === n ? 0 : n })}
            className={cx('rounded-full px-2 py-0.5 text-xs', filters.minStars === n ? 'bg-ink-900 text-white' : 'bg-white text-ink-800 ring-1 ring-slate-200 hover:bg-ink-50')}
            data-testid={`stars-${n}`}>
            {n === 5 ? '★5' : `★${n}+`}
          </button>
        ))}
      </div>
      {note && <p className={cx('text-xs', note.ok ? 'text-emerald-800' : 'text-amber-900')} role="status" data-testid="relevance-note">{note.text}</p>}
    </div>
  );
}
