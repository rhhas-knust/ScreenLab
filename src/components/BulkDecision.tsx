import { useState } from 'react';
import { recordDecisionsBulk, type BulkItem } from '../lib/api/references';
import { createReason } from '../lib/api/tags';
import { friendlyError, isNetworkError } from '../lib/errors';
import { fmt } from '../lib/hooks';
import { outbox } from '../lib/outbox';
import type { Decision, ExclusionReason, Stage } from '../lib/types';
import { DECISION_META } from './Decision';
import { Alert, Button, Input, Label, Modal, ProgressBar, Select, cx } from './ui';
import { useToast } from './Toast';

export interface SelectedItem {
  id: string;
  decision: Decision | null;
}

type Choice = Decision | 'clear';

const CHOICE_LABEL: Record<Choice, string> = { include: 'Include', exclude: 'Exclude', maybe: 'Maybe', clear: 'Reset to unscreened' };

/**
 * Action bar for a multi-selection: apply one decision to every selected
 * record after an explicit confirmation. Each record is still recorded
 * individually in the audit history, and the whole batch can be undone.
 */
export function BulkDecisionBar({
  projectId, stage, count, reasons, getItems, onDone, onClear, compact = false, extra,
}: {
  projectId: string;
  stage: Stage;
  /** Number of selected records (for labels). */
  count: number;
  reasons: ExclusionReason[];
  /** Resolves the selected records (may fetch "all matching" from the server). */
  getItems: () => Promise<SelectedItem[]>;
  onDone: () => void;
  onClear: () => void;
  compact?: boolean;
  extra?: React.ReactNode;
}) {
  const toast = useToast();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [items, setItems] = useState<SelectedItem[] | null>(null);
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applicable = reasons.filter((r) => r.is_active && (r.stage === 'both' || r.stage === stage));
  const options: Choice[] = stage === 'title_abstract' ? ['include', 'exclude', 'maybe', 'clear'] : ['include', 'exclude', 'clear'];

  const start = async (c: Choice) => {
    if (outbox.getState().pending.length) {
      toast('Some changes are still being saved — please wait until the status shows “Saved”, then try again.', { kind: 'error' });
      return;
    }
    setChoice(c);
    setItems(null);
    setError(null);
    setReason('');
    setCustom('');
    setLoading(true);
    try {
      setItems(await getItems());
    } catch (e) {
      setError(friendlyError(e, 'Could not load the selected records.'));
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (progress) return;
    setChoice(null);
    setItems(null);
  };

  const finalReason = choice === 'exclude' ? (reason === '__custom__' ? custom.trim() : reason) || null : null;
  const decision: Decision | null = choice === 'clear' || choice === null ? null : choice;
  const changes = items ? items.filter((i) => i.decision !== null && i.decision !== decision).length : 0;
  const unchanged = items ? items.filter((i) => i.decision === decision && decision !== 'exclude').length : 0;
  const needsReason = choice === 'exclude' && stage === 'full_text' && !finalReason;

  const apply = async () => {
    if (!items || !choice) return;
    setError(null);
    setProgress({ done: 0, total: items.length });
    try {
      if (reason === '__custom__' && finalReason && !applicable.some((r) => r.label.toLowerCase() === finalReason.toLowerCase())) {
        await createReason(projectId, finalReason, (reasons.at(-1)?.sort_order ?? 0) + 1).catch(() => {});
      }
      const payload: BulkItem[] = items.map((i) => ({ id: i.id, decision, reason: finalReason }));
      const previous = await recordDecisionsBulk(stage, payload, 'decide', (done, total) => setProgress({ done, total }));
      const m = decision ? DECISION_META[decision] : DECISION_META.unscreened;
      toast(`${m.icon} ${fmt(previous.length)} record${previous.length === 1 ? '' : 's'} → ${m.label}${finalReason ? ` — ${finalReason}` : ''}`, {
        duration: 12000,
        action: {
          label: 'Undo',
          onClick: () => {
            void recordDecisionsBulk(stage, previous, 'undo')
              .then(() => { toast(`Undone — ${fmt(previous.length)} records restored`); onDone(); })
              .catch((e) => toast(`Undo failed: ${friendlyError(e)}`, { kind: 'error' }));
          },
        },
      });
      setProgress(null);
      setChoice(null);
      setItems(null);
      onDone();
    } catch (e) {
      setProgress(null);
      setError(isNetworkError(e)
        ? 'Network problem — bulk decisions need a connection. Nothing after the last completed batch was changed; please try again.'
        : friendlyError(e, 'The bulk decision could not be saved.'));
      onDone();
    }
  };

  return (
    <>
      <div className={cx('flex flex-wrap items-center gap-2 rounded-lg border border-ink-300 bg-ink-50 px-3 py-2 text-sm', compact && 'px-2 py-1.5')} role="region" aria-label="Bulk actions" data-testid="bulk-bar">
        <span className="font-semibold text-ink-900">{fmt(count)} selected</span>
        {extra}
        <span className="mx-1 hidden h-5 w-px bg-ink-200 sm:block" aria-hidden="true" />
        {options.map((c) => (
          <Button key={c} size="sm" variant={c === 'clear' ? 'ghost' : 'secondary'} onClick={() => start(c)} data-testid={`bulk-${c}`}
            className={cx(c === 'include' && 'border-emerald-600 text-emerald-800', c === 'exclude' && 'border-rose-600 text-rose-800', c === 'maybe' && 'border-amber-500 text-amber-900')}>
            {c !== 'clear' && <span aria-hidden="true">{DECISION_META[c].icon}</span>} {compact && c === 'clear' ? 'Reset' : CHOICE_LABEL[c]}{c === 'exclude' ? '…' : ''}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button>
      </div>

      <Modal open={!!choice} onClose={close} dismissable={!progress}
        title={choice ? `${CHOICE_LABEL[choice]} ${fmt(items?.length ?? count)} records` : ''}
        footer={
          <>
            <Button onClick={close} disabled={!!progress}>Cancel</Button>
            <Button variant={choice === 'exclude' ? 'danger' : 'primary'} onClick={apply} loading={!!progress}
              disabled={!items || !items.length || needsReason || (reason === '__custom__' && !custom.trim())} data-testid="bulk-apply">
              Apply to {fmt(items?.length ?? 0)} records
            </Button>
          </>
        }>
        <div className="space-y-4 text-sm">
          {loading && <p role="status">Collecting the selected records…</p>}
          {error && <Alert>{error}</Alert>}
          {choice === 'exclude' && (
            <div>
              <Label htmlFor="bulk-reason" hint={stage === 'full_text' ? '(required)' : '(recommended)'}>Exclusion reason</Label>
              <Select id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">{stage === 'full_text' ? 'Choose a reason…' : 'No reason'}</option>
                {applicable.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                <option value="__custom__">Other (type a reason)…</option>
              </Select>
              {reason === '__custom__' && (
                <Input className="mt-2" aria-label="Custom exclusion reason" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type the reason" />
              )}
            </div>
          )}
          {items && (
            <div className="space-y-2">
              <p>
                <strong>{fmt(items.length)}</strong> record{items.length === 1 ? '' : 's'} will be marked{' '}
                <strong>{decision ? `${DECISION_META[decision].icon} ${DECISION_META[decision].label}` : '○ Unscreened'}{finalReason ? ` — ${finalReason}` : ''}</strong>{' '}
                at the {stage === 'full_text' ? 'full-text' : 'title/abstract'} stage.
              </p>
              {changes > 0 && <Alert kind="warning">{fmt(changes)} of them already have a different decision, which will be changed (the previous decision stays in each record’s history).</Alert>}
              {unchanged > 0 && <p className="text-slate-600">{fmt(unchanged)} already have this decision and will not change.</p>}
              {items.length > 25 && decision !== null && (
                <Alert kind="info">
                  Bulk decisions are recorded as your decision for every record. Make sure you have checked these records (titles and, where
                  needed, abstracts) — for a systematic review each record should be assessed against your criteria.
                </Alert>
              )}
              <p className="text-xs text-slate-500">Each record gets its own entry in the audit history. You can undo the whole batch from the confirmation message.</p>
            </div>
          )}
          {progress && (
            <div aria-live="polite">
              <p className="tabular-nums">Saving {fmt(progress.done)} / {fmt(progress.total)}…</p>
              <ProgressBar value={progress.done} max={progress.total} label="Bulk decision progress" />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
