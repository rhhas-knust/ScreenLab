import { useQuery } from '@tanstack/react-query';
import { reviewerStats } from '../lib/api/references';
import { listTeam, xk } from '../lib/api/extraction';
import { cohensKappa } from '../lib/extraction/form';
import type { Stage } from '../lib/types';
import { Card, Spinner } from './ui';

const STAGES: [Stage, string][] = [['title_abstract', 'Title / abstract'], ['full_text', 'Full text']];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** Kappa in words (Landis & Koch). */
function kappaWords(k: number): string {
  if (k < 0) return 'worse than chance';
  if (k <= 0.2) return 'slight';
  if (k <= 0.4) return 'fair';
  if (k <= 0.6) return 'moderate';
  if (k <= 0.8) return 'substantial';
  return 'almost perfect';
}

/** Each reviewer's progress and decisions, and how often reviewers agree. */
export function ReviewerStatsCard({ projectId, stage2 }: { projectId: string; stage2: boolean }) {
  const stats = useQuery({ queryKey: ['reviewer-stats', projectId], queryFn: () => reviewerStats(projectId) });
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const name = (id: string) => team.data?.find((t) => t.user_id === id)?.email.split('@')[0] ?? 'Former member';
  if (!stats.data) return <Card className="p-5"><Spinner label="Loading reviewer statistics…" /></Card>;
  const d = stats.data;
  return (
    <Card className="p-5">
      <div className="space-y-4" data-testid="reviewer-stats">
      <div>
        <h2 className="font-semibold text-ink-900">Reviewers</h2>
        <p className="text-sm text-slate-600">Decisions each reviewer recorded, and agreement where two reviewers screened the same record (only records whose decisions you can see).</p>
      </div>
      {STAGES.filter(([s]) => s === 'title_abstract' || stage2).map(([s, label]) => {
        const rows = d.reviewers.filter((r) => r.stage === s);
        const pairs = d.pairs.filter((p) => p.stage === s);
        const agreed = pairs.filter((p) => p.a === p.b).length;
        const kappa = cohensKappa(pairs.map((p) => [p.a, p.b]));
        const conflicts = s === 'title_abstract' ? d.ta_conflicts : d.ft_conflicts;
        return (
          <div key={s} className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-900">{label}</h3>
            {rows.length === 0 ? <p className="text-sm text-slate-500">No decisions yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Reviewer</th><th className="text-right">Screened</th><th className="text-right">Include</th><th className="text-right">Exclude</th>{s === 'title_abstract' && <th className="text-right">Maybe</th>}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.reviewer_id} className="border-t border-slate-100" data-testid="reviewer-stats-row">
                        <td className="py-1">{name(r.reviewer_id)}</td>
                        <td className="text-right">{r.screened}</td>
                        <td className="text-right">{r.include}</td>
                        <td className="text-right">{r.exclude}</td>
                        {s === 'title_abstract' && <td className="text-right">{r.maybe}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-sm text-slate-700" data-testid={`agreement-${s}`}>
              {pairs.length
                ? <>Screened by two reviewers: <strong>{pairs.length}</strong>. Agreement <strong>{pct(agreed, pairs.length)}</strong>{kappa != null && <>, Cohen’s κ = <strong>{kappa.toFixed(2)}</strong> ({kappaWords(kappa)})</>}.</>
                : 'No record has been screened by two reviewers yet.'}
              {conflicts > 0 && <> <span className="font-medium text-amber-800">{conflicts} conflict{conflicts === 1 ? '' : 's'} to resolve.</span></>}
            </p>
          </div>
        );
      })}
      </div>
    </Card>
  );
}
