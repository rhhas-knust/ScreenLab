import { useQuery } from '@tanstack/react-query';
import { getAiDisclosure, mk, type AiDisclosure } from '../lib/api/methods';
import { fmt, fmtDate } from '../lib/hooks';
import { Button, Card, EmptyState, Spinner, Stat } from '../components/ui';
import { useToast } from '../components/Toast';

const STAGE = { title_abstract: 'title/abstract', full_text: 'full-text' } as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** A neutral methods paragraph built only from the counts. Edit before use. */
export function disclosureText(d: AiDisclosure): string {
  const models = [...new Set(d.by_model.map((m) => m.model))];
  const perStage = d.agreement.map((a) => `${fmt(a.records)} at the ${STAGE[a.stage]} stage`).join(' and ');
  const parts = [
    `A large language model assistant (${models.join('; ')}) was used to suggest eligibility decisions for ${fmt(d.records)} records (${perStage}), between ${fmtDate(d.first_at, false)} and ${fmtDate(d.last_at, false)}.`,
    'Suggestions were advisory and shown with the criteria they were based on; every inclusion and exclusion decision was made and recorded by a human reviewer, and the assistant could not record decisions itself.',
  ];
  for (const a of d.agreement) {
    if (!a.compared) continue;
    parts.push(`At the ${STAGE[a.stage]} stage, the final human decision matched the suggestion for ${fmt(a.agreed)} of ${fmt(a.compared)} records (${pct(a.agreed, a.compared)}%); reviewers excluded ${fmt(a.ai_include_human_exclude)} records the assistant suggested including and included ${fmt(a.ai_exclude_human_include)} it suggested excluding${a.ai_unsure ? `, and decided ${fmt(a.ai_unsure)} records the assistant marked as unsure` : ''}.`);
    if (a.decided_before_suggestion) parts.push(`${fmt(a.decided_before_suggestion)} of these ${STAGE[a.stage]} decisions were made before the suggestion was generated (used as a check of earlier decisions).`);
  }
  return parts.join(' ');
}

export function AiUse({ projectId }: { projectId: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: mk.ai(projectId), queryFn: () => getAiDisclosure(projectId) });
  if (q.isLoading || !q.data) return <div className="p-6"><Spinner /></div>;
  const d = q.data;
  if (!d.suggestions) return <EmptyState title="No AI suggestions in this project">Nothing to disclose: no AI suggestions were used.</EmptyState>;
  const text = disclosureText(d);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it manually', { kind: 'error' }); }
  };
  return (
    <div className="space-y-4" data-testid="ai-use">
      <div>
        <h2 className="font-semibold text-ink-900">AI use</h2>
        <p className="text-sm text-slate-600">Calculated from every AI suggestion stored in this project and the human decisions recorded for the same records.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Records with a suggestion" value={fmt(d.records)} />
        <Stat label="Suggestions stored" value={fmt(d.suggestions)} />
        <Stat label="Human decisions in ScreenLab" value={fmt(d.human_decisions)} sub={`${d.reviewers} reviewer${d.reviewers === 1 ? '' : 's'}`} />
        <Stat label="Decisions imported" value={fmt(d.imported_decisions)} sub="e.g. from Rayyan" tone="muted" />
      </div>

      <Card className="overflow-x-auto p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Agreement between suggestion and final human decision</h3>
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="py-1">Stage</th><th>Records</th><th>Compared</th><th>Agreed</th><th>AI include → human exclude</th><th>AI exclude → human include</th><th>AI unsure</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {d.agreement.map((a) => (
              <tr key={a.stage} className="border-t border-slate-100">
                <td className="py-1.5">{STAGE[a.stage]}</td>
                <td>{fmt(a.records)}</td>
                <td>{fmt(a.compared)}</td>
                <td className="font-semibold">{fmt(a.agreed)} ({pct(a.agreed, a.compared)}%)</td>
                <td>{fmt(a.ai_include_human_exclude)}</td>
                <td>{fmt(a.ai_exclude_human_include)}</td>
                <td>{fmt(a.ai_unsure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Compared = records with an include/exclude suggestion and an include/exclude decision. Latest suggestion per record and stage.</p>
      </Card>

      <Card className="overflow-x-auto p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Models and sources</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1">Model</th><th>Stage</th><th>Read</th><th className="text-right">Suggestions</th></tr></thead>
          <tbody>
            {d.by_model.map((m, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1.5 break-words">{m.model}</td><td>{STAGE[m.stage]}</td>
                <td>{m.source.replace('_', ' ').replace('pdf', 'PDF')}</td><td className="text-right tabular-nums">{fmt(m.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-ink-900">Draft text for your methods section</h3>
          <Button size="sm" variant="secondary" onClick={copy}>Copy</Button>
        </div>
        <p className="text-sm leading-relaxed text-slate-800" data-testid="ai-disclosure-text">{text}</p>
        <p className="text-xs text-slate-500">Built from the counts above. Edit it to match your study, and name the tool and version as your guidelines require.</p>
      </Card>
    </div>
  );
}
