import { useQuery } from '@tanstack/react-query';
import { getDecisionHistory } from '../lib/api/references';
import { fmtDate } from '../lib/hooks';
import type { ScreeningDecisionRow } from '../lib/types';
import { DECISION_META } from '../components/Decision';

function label(d: string | null) {
  return d ? `${DECISION_META[d as 'include'].icon} ${DECISION_META[d as 'include'].label}` : '○ Unscreened';
}

/** Audit trail for one reference (from the append-only screening_decisions table). */
export function HistoryPanel({ referenceId, version }: { referenceId: string; version: string }) {
  const q = useQuery({ queryKey: ['history', referenceId, version], queryFn: () => getDecisionHistory(referenceId) });
  const rows = (q.data ?? []) as ScreeningDecisionRow[];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-ink-900">Decision history {rows.length ? `(${rows.length})` : ''}</summary>
      {q.isLoading ? <p className="mt-1 text-xs text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No decisions recorded yet.</p>
      ) : (
        <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 text-xs">
          {rows.map((r) => (
            <li key={r.id}>
              <time className="text-slate-500" dateTime={r.created_at}>{fmtDate(r.created_at)}</time>{' '}
              <span className="text-slate-500">{r.stage === 'full_text' ? '[full text]' : '[title/abstract]'}</span>{' '}
              {r.action === 'undo' && <strong>Undo: </strong>}
              {r.previous_decision !== undefined && r.action !== 'decide' ? <>{label(r.previous_decision)} → </> : null}
              <strong>{label(r.decision)}</strong>
              {r.exclusion_reason && <> — {r.exclusion_reason}</>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
