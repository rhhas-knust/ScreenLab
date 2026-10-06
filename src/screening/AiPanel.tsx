import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AiError, aiKey, aiSuggestedIds, askAi, latestSuggestion, type AiSuggestion } from '../lib/api/ai';
import { DEFAULT_FILTERS, DEFAULT_SORT, fetchMatchingIds } from '../lib/api/references';
import type { Decision, Reference, Stage } from '../lib/types';
import { Button, ProgressBar, Spinner, cx } from '../components/ui';

const REC: Record<AiSuggestion['recommendation'], { label: string; cls: string }> = {
  include: { label: '✓ Include', cls: 'border-emerald-600 bg-emerald-50 text-emerald-900' },
  exclude: { label: '✕ Exclude', cls: 'border-rose-600 bg-rose-50 text-rose-900' },
  unsure: { label: '? Unsure', cls: 'border-amber-500 bg-amber-50 text-amber-950' },
};
const MARK = { met: { icon: '✓', cls: 'text-emerald-700' }, not_met: { icon: '✕', cls: 'text-rose-700' }, unclear: { icon: '?', cls: 'text-amber-700' } };
const SOURCE = { abstract: 'title & abstract only', attached_pdf: 'your attached PDF', open_access_pdf: 'the free open-access PDF' };
const AUTO_KEY = 'screenlab.ai.auto';

function readAuto() {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}

/** AI suggestion beside the decision buttons. Advisory only: the reviewer decides. */
export function AiPanel({ reference, stage, projectId, onAccept }: {
  reference: Reference; stage: Stage; projectId: string;
  onAccept: (decision: Decision, reason: string | null) => void;
}) {
  const qc = useQueryClient();
  const key = aiKey(reference.id, stage);
  const q = useQuery({ queryKey: key, queryFn: () => latestSuggestion(reference.id, stage), staleTime: 60_000 });
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const [auto, setAuto] = useState(readAuto);
  const autoTried = useRef<string | null>(null);

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      const s = await askAi(reference.id, stage);
      qc.setQueryData(key, s);
    } catch (e) {
      setError(e instanceof AiError ? e : new AiError('The AI request failed.'));
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    if (auto && q.isSuccess && !q.data && !asking && autoTried.current !== reference.id) {
      autoTried.current = reference.id;
      void ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, q.isSuccess, q.data, reference.id]);

  const s = q.data;
  const decided = stage === 'title_abstract' ? reference.title_abstract_decision : reference.full_text_decision;
  const acceptable = s && s.recommendation !== 'unsure' && !(stage === 'full_text' && s.recommendation === 'exclude' && !s.exclusion_reason);

  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50/60 p-2.5 text-xs" data-testid="ai-panel">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-semibold text-ink-900">✨ AI assistant</span>
        <label className="ml-auto flex items-center gap-1 text-slate-600" title="Ask the AI automatically when an article opens">
          <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
          Auto
        </label>
      </div>

      {q.isLoading || asking ? (
        <p className="flex items-center gap-2 text-slate-700" role="status">
          <Spinner className="h-4 w-4" /> {asking ? (stage === 'full_text' ? 'Reading the full text… (up to a minute)' : 'Reading the abstract…') : 'Loading…'}
        </p>
      ) : s ? (
        <div className="space-y-2" data-testid="ai-suggestion">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-600">AI suggests</span>
            <span className={cx('rounded-full border px-2 py-0.5 font-semibold', REC[s.recommendation].cls)}>{REC[s.recommendation].label}</span>
            {s.exclusion_reason && <span className="font-medium text-rose-900">— {s.exclusion_reason}</span>}
            <span className="text-slate-500">({s.confidence} confidence)</span>
          </div>
          <p className="text-[13px] leading-snug text-slate-800">{s.summary}</p>
          {s.criteria.length > 0 && (
            <ul className="space-y-1">
              {s.criteria.map((c, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className={cx('w-3 shrink-0 font-bold', MARK[c.assessment].cls)} aria-label={c.assessment.replace('_', ' ')}>{MARK[c.assessment].icon}</span>
                  <span><span className="font-medium">{c.criterion}</span>{c.evidence && <span className="text-slate-600"> — “{c.evidence}”</span>}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-slate-500">Based on {SOURCE[s.source]} · check before deciding.</p>
          <div className="flex flex-wrap gap-1.5">
            {acceptable && (
              <Button size="sm" variant="secondary" onClick={() => onAccept(s.recommendation as Decision, s.exclusion_reason)} data-testid="ai-accept"
                className={s.recommendation === 'include' ? 'border-emerald-600 text-emerald-800' : 'border-rose-600 text-rose-800'}>
                {decided ? 'Change to' : 'I agree:'} {s.recommendation === 'include' ? 'Include' : `Exclude${s.exclusion_reason ? ` — ${s.exclusion_reason}` : ''}`}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={ask}>Ask again</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-slate-700">Get a suggestion with the evidence for each criterion{stage === 'full_text' ? ' — reads the attached or free PDF when available' : ''}.</p>
          <Button size="sm" variant="secondary" onClick={ask} data-testid="ai-ask">✨ Ask AI</Button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-rose-800" role="alert">
          {error.message}
          {error.code === 'not_configured' && <> See README → “AI assistant” for the 2-minute setup.</>}
        </p>
      )}
      <BatchPrecheck projectId={projectId} stage={stage} />
    </div>
  );
}

/** Pre-check the next N unscreened records in the background so suggestions are ready when they open. */
function BatchPrecheck({ projectId, stage }: { projectId: string; stage: Stage }) {
  const qc = useQueryClient();
  const [n, setN] = useState(20);
  const [run, setRun] = useState<{ done: number; total: number; failed: number; note?: string } | null>(null);
  const stop = useRef(false);

  const start = async () => {
    stop.current = false;
    setRun({ done: 0, total: 0, failed: 0 });
    try {
      const [queue, have] = await Promise.all([
        fetchMatchingIds(projectId, stage, { ...DEFAULT_FILTERS, status: 'unscreened' }, DEFAULT_SORT),
        aiSuggestedIds(projectId, stage),
      ]);
      const todo = queue.filter((r) => !have.has(r.id)).slice(0, n);
      let done = 0, failed = 0, i = 0;
      setRun({ done, total: todo.length, failed });
      const worker = async () => {
        while (!stop.current && i < todo.length) {
          const item = todo[i++];
          try {
            const sug = await askAi(item.id, stage);
            qc.setQueryData(aiKey(item.id, stage), sug);
          } catch (e) {
            failed++;
            if (e instanceof AiError && (e.code === 'not_configured' || e.code === 'bad_key' || e.code === 'bad_request')) {
              stop.current = true;
              setRun({ done, total: todo.length, failed, note: e.message });
              return;
            }
          }
          done++;
          setRun((r) => ({ ...(r ?? { total: todo.length }), done, total: todo.length, failed }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setRun((r) => r && { ...r, note: r.note ?? (stop.current ? 'Stopped.' : todo.length ? 'Done — suggestions are ready as you screen.' : 'Every unscreened record already has a suggestion.') });
    } catch {
      setRun((r) => ({ ...(r ?? { done: 0, total: 0, failed: 0 }), note: 'Could not load the queue — check your connection.' }));
    }
  };

  const busy = !!run && !run.note;
  return (
    <div className="mt-2 border-t border-violet-200 pt-2">
      {busy ? (
        <div className="space-y-1" aria-live="polite">
          <p className="tabular-nums text-slate-700">Pre-checking {run.done} / {run.total}{run.failed ? ` (${run.failed} failed)` : ''}…</p>
          <ProgressBar value={run.done} max={Math.max(1, run.total)} label="AI pre-check progress" />
          <Button size="sm" variant="ghost" onClick={() => { stop.current = true; }}>Stop</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor="ai-batch-n" className="text-slate-600">Pre-check next</label>
          <select id="ai-batch-n" value={n} onChange={(e) => setN(Number(e.target.value))} className="rounded border border-slate-300 bg-white px-1 py-0.5">
            {[10, 20, 50, 100, 300].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={start} data-testid="ai-batch">Run in background</Button>
          {run?.note && <p className="w-full text-slate-600" role="status">{run.note}{run.failed ? ` ${run.failed} could not be checked.` : ''}</p>}
        </div>
      )}
    </div>
  );
}
