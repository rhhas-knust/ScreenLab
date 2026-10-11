import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { latestSummary, rk, RhSummaryError, writeSummary, type RhSummary } from '../lib/api/research';
import { fmtDate } from '../lib/hooks';
import { Button, Spinner } from '../components/ui';

export const MIN_RESPONSES_FOR_SUMMARY = 3;

/** The findings text itself — shared by the card and the printed report. */
export function SummaryBody({ s }: { s: RhSummary }) {
  const b = s.summary;
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-800" data-testid="rh-ai-summary">
      <p className="font-medium text-ink-900">{b.headline}</p>
      {b.key_findings.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Key findings</h4>
          <ul className="list-disc space-y-1 pl-5">{b.key_findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {b.open_text_themes.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Themes in written answers</h4>
          <ul className="list-disc space-y-1 pl-5">{b.open_text_themes.map((t, i) => <li key={i}><span className="font-medium">{t.theme}:</span> {t.detail}</li>)}</ul>
        </div>
      )}
      {b.limitations.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Limitations</h4>
          <ul className="list-disc space-y-1 pl-5">{b.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-slate-500">
        AI-written from {s.response_count} response{s.response_count === 1 ? '' : 's'} on {fmtDate(s.created_at)}. Check every statement against the statistics before using it in your work.
      </p>
    </div>
  );
}

export function AiSummaryCard({ formId, responseCount }: { formId: string; responseCount: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: rk.summary(formId), queryFn: () => latestSummary(formId) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RhSummaryError | null>(null);
  const tooFew = responseCount < MIN_RESPONSES_FOR_SUMMARY;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(rk.summary(formId), await writeSummary(formId));
    } catch (e) {
      setError(e instanceof RhSummaryError ? e : new RhSummaryError('The AI summary failed.'));
    } finally {
      setBusy(false);
    }
  };

  const s = q.data;
  const stale = s && s.response_count !== responseCount;
  return (
    <section className="space-y-3 rounded-xl border border-violet-300 bg-violet-50/60 p-4" data-testid="rh-ai-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-ink-900">✨ AI findings summary</h2>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={run} loading={busy} disabled={tooFew || busy} data-testid="rh-ai-write">
          {s ? 'Write a new summary' : 'Write summary'}
        </Button>
      </div>
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-slate-700" role="status"><Spinner className="h-4 w-4" /> Reading the responses… (up to a minute)</p>
      ) : s ? (
        <>
          {stale && <p className="text-xs text-amber-800">{responseCount - s.response_count > 0 ? `${responseCount - s.response_count} new response(s) since this summary was written.` : 'Responses have changed since this summary was written.'}</p>}
          <SummaryBody s={s} />
        </>
      ) : (
        <p className="text-sm text-slate-700">
          {tooFew
            ? `Collect at least ${MIN_RESPONSES_FOR_SUMMARY} responses to get an AI summary.`
            : 'Get a short write-up of the main findings, the themes in written answers, and the limitations. It runs on the server; respondents\' email addresses are never sent.'}
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-800" role="alert">
          {error.message}{error.code === 'not_configured' && ' See README → “AI assistant” for the 2-minute setup.'}
        </p>
      )}
    </section>
  );
}
