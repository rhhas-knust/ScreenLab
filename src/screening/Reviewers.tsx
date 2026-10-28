import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { must } from '../lib/errors';
import type { TeamMember } from '../lib/api/extraction';
import type { Decision, Stage } from '../lib/types';
import { DecisionBadge } from '../components/Decision';
import { Select, cx } from '../components/ui';

// One colour per co-reviewer (by position in the team), so a partner's papers
// are easy to spot in the list. The signed-in user is always dark.
const COLOURS = ['bg-sky-600', 'bg-amber-600', 'bg-fuchsia-600', 'bg-emerald-600', 'bg-rose-600', 'bg-indigo-500'];

export function nameOf(email: string | undefined): string {
  return (email ?? 'Former member').split('@')[0];
}
export function initialsOf(email: string | undefined): string {
  const parts = nameOf(email).split(/[._\-+\s]+/).filter((p) => /[a-z]/i.test(p));
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').replace(/[^a-z]/gi, '').slice(0, 2);
  return (s || '?').toUpperCase();
}

export interface Who { id: string; email?: string; you: boolean; colour: string }

export function people(team: TeamMember[], me: string | undefined): Map<string, Who> {
  const m = new Map<string, Who>();
  let i = 0;
  for (const t of team) {
    const you = t.user_id === me;
    m.set(t.user_id, { id: t.user_id, email: t.email, you, colour: you ? 'bg-ink-900' : COLOURS[i++ % COLOURS.length] });
  }
  return m;
}
function who(map: Map<string, Who>, id: string): Who {
  return map.get(id) ?? { id, you: false, colour: 'bg-slate-400' };
}

/** Small initials circles: who has screened this paper at this stage. */
export function ReviewerChips({ ids, map }: { ids: string[]; map: Map<string, Who> }) {
  if (!ids.length) return null;
  const list = ids.map((id) => who(map, id));
  const label = `Screened by ${list.map((w) => (w.you ? 'you' : nameOf(w.email))).join(' and ')}`;
  return (
    <span className="flex shrink-0 -space-x-1" role="img" aria-label={label} title={label} data-testid="reviewer-chips">
      {list.map((w) => (
        <span key={w.id} className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white ring-1 ring-white', w.colour)}>
          {w.you ? 'You' : initialsOf(w.email)}
        </span>
      ))}
    </span>
  );
}

/** "Screened by" filter shown above the list when the project has co-reviewers. */
export function ReviewedByFilter({ value, onChange, team, me }: {
  value: string; onChange: (v: string) => void; team: TeamMember[]; me: string | undefined;
}) {
  const others = team.filter((t) => t.user_id !== me);
  const one = others.length === 1 ? nameOf(others[0].email) : null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="screen-by" className="shrink-0 text-xs font-medium text-slate-700">Screened by</label>
      <Select id="screen-by" value={value} onChange={(e) => onChange(e.target.value)} className="py-1 text-xs" data-testid="screened-by">
        <option value="">Anyone</option>
        <option value="me">Me</option>
        <option value="partner">{one ? one : 'My co-reviewers'}</option>
        <option value="partner_not_me">{one ? `${one}, not yet me` : 'Co-reviewers, not yet me'}</option>
        <option value="not_me">Not yet by me</option>
        {others.length > 1 && others.map((t) => <option key={t.user_id} value={t.user_id}>{nameOf(t.email)}</option>)}
      </Select>
    </div>
  );
}

interface ReviewerDecisionRow { reviewer_id: string; decision: Decision; exclusion_reason: string | null; updated_at: string }

async function reviewerDecisions(referenceId: string, stage: Stage): Promise<ReviewerDecisionRow[]> {
  return must(await supabase.from('reviewer_decisions').select('reviewer_id,decision,exclusion_reason,updated_at')
    .eq('reference_id', referenceId).eq('stage', stage).order('updated_at')) as ReviewerDecisionRow[];
}

/** Each co-reviewer's own decision on this paper at this stage. */
export function ReviewerDecisions({ referenceId, stage, team, me, version }: {
  referenceId: string; stage: Stage; team: TeamMember[]; me: string | undefined; version: string;
}) {
  const q = useQuery({ queryKey: ['reviewer-decisions', referenceId, stage, version], queryFn: () => reviewerDecisions(referenceId, stage) });
  const map = people(team, me);
  const rows = q.data ?? [];
  const decided = new Set(rows.map((r) => r.reviewer_id));
  const waiting = team.filter((t) => t.role !== 'viewer' && !decided.has(t.user_id));
  const differ = new Set(rows.map((r) => r.decision)).size > 1;
  return (
    <div className="space-y-1 text-sm" data-testid="reviewer-decisions">
      <div className="font-semibold text-ink-900">Reviewers</div>
      {differ && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Reviewers disagree on this paper. Talk it through and agree a final decision.</p>}
      {rows.length === 0 && !q.isLoading && <p className="text-xs text-slate-600">No one has screened this paper yet{stage === 'full_text' ? ' at full text' : ''}.</p>}
      <ul className="space-y-1">
        {rows.map((r) => {
          const w = who(map, r.reviewer_id);
          return (
            <li key={r.reviewer_id} className="flex flex-wrap items-center gap-2">
              <ReviewerChips ids={[r.reviewer_id]} map={map} />
              <span className="text-xs text-slate-700">{w.you ? 'You' : nameOf(w.email)}</span>
              <DecisionBadge decision={r.decision} reason={r.exclusion_reason} />
            </li>
          );
        })}
      </ul>
      {rows.length > 0 && waiting.length > 0 && (
        <p className="text-xs text-slate-500">Not yet screened by {waiting.map((t) => (t.user_id === me ? 'you' : nameOf(t.email))).join(', ')}.</p>
      )}
    </div>
  );
}
