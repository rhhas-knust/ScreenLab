import type { FieldStats } from '../lib/research/analytics';
import { round } from '../lib/research/analytics';
import { FIELD_LABEL } from '../lib/api/research';
import { BarList } from './Charts';

const n2 = (v: number | null) => (v == null ? '—' : String(round(v, 2)));
const th = 'px-2 py-1 text-left text-xs font-semibold text-slate-600';
const td = 'border-t border-slate-100 px-2 py-1 tabular-nums';

/** One question's statistics: numbers first, then the distribution. Used on screen and in the printed report. */
export function QuestionStats({ s, index, onChart }: { s: FieldStats; index: number; onChart?: (variable: string) => void }) {
  const total = s.answered + s.missing;
  // Chart Studio names: Q1, Q2 …; grids and rankings open on their first part (Q4_1).
  const chartable = s.answered > 0 && s.type !== 'text' && s.type !== 'textarea' && s.type !== 'email';
  const variable = `Q${index + 1}${s.type === 'grid' || s.type === 'ranking' ? '_1' : ''}`;
  return (
    <article className="break-inside-avoid space-y-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="rh-question-stats">
      <header className="relative">
        {onChart && chartable && (
          <button type="button" onClick={() => onChart(variable)} className="absolute top-0 right-0 rounded-md px-2 py-0.5 text-xs font-medium text-ink-700 hover:bg-ink-50 print:hidden" data-testid="rh-chart-this">
            Chart this →
          </button>
        )}
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Q{index + 1} · {FIELD_LABEL[s.type]}</p>
        <h3 className="mt-0.5 pr-20 font-semibold text-ink-900">{s.label}</h3>
        <p className="text-xs text-slate-500">
          {s.answered} of {total} answered{s.missing ? ` · ${s.missing} skipped or not shown` : ''}
        </p>
      </header>

      {s.answered === 0 ? (
        <p className="text-sm text-slate-500">No answers yet.</p>
      ) : s.kind === 'numeric' ? (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6" data-testid="rh-numeric-stats">
            {([['Mean', s.mean], ['Median', s.median], ['SD', s.sd], ['Min', s.min], ['Max', s.max], ['n', s.answered]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-semibold tabular-nums text-ink-900">{n2(v)}</dd>
              </div>
            ))}
          </dl>
          <BarList bars={s.bars} caption={`Distribution of answers to: ${s.label}`} />
        </>
      ) : s.kind === 'choice' || s.kind === 'multi' ? (
        <>
          <BarList bars={s.bars} caption={`Answers to: ${s.label}`} />
          {s.kind === 'multi' && <p className="text-xs text-slate-500">Respondents could tick more than one option, so percentages can add up to more than 100%.</p>}
        </>
      ) : s.kind === 'grid' ? (
        <div className="overflow-x-auto" data-testid="rh-grid-stats">
          <table className="w-full min-w-[28rem] text-sm">
            <thead><tr><th className={th}>Statement</th>{s.columns.map((c) => <th key={c} className={th}>{c}</th>)}<th className={th}>n</th></tr></thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.label} className="break-inside-avoid">
                  <td className="border-t border-slate-100 px-2 py-1 text-slate-800">{r.label}</td>
                  {r.cells.map((c) => <td key={c.label} className={td}>{c.count} <span className="text-slate-500">({c.pct}%)</span></td>)}
                  <td className={td}>{r.answered}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">Percentages are of respondents who answered that statement.</p>
        </div>
      ) : s.kind === 'ranking' ? (
        <div className="overflow-x-auto" data-testid="rh-ranking-stats">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Option (best first)</th><th className={th}>Mean rank</th><th className={th}>Ranked first</th></tr></thead>
            <tbody>
              {s.items.map((it) => (
                <tr key={it.label}><td className="border-t border-slate-100 px-2 py-1 text-slate-800">{it.label}</td><td className={td}>{n2(it.meanRank)}</td><td className={td}>{it.first} <span className="text-slate-500">({it.firstPct}%)</span></td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">Rank 1 is the top choice, so a lower mean rank means the option was preferred.</p>
        </div>
      ) : s.kind === 'date' ? (
        <>
          <p className="text-sm text-slate-700">Earliest {s.earliest} · latest {s.latest}</p>
          <BarList bars={s.bars} caption={`Answers to: ${s.label}, by month`} />
        </>
      ) : s.type === 'email' ? (
        <p className="text-sm text-slate-600">Email addresses are not summarised. Download the CSV to see them.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {s.themes && s.themes.length > 0 && (
            <div data-testid="rh-themes">
              <p className="mb-1 text-xs font-semibold text-slate-600">Themes (from your coding)</p>
              <BarList bars={s.themes.map((t) => ({ label: t.code, count: t.count, pct: t.pct }))} unit="coded answers" caption={`Themes in answers to: ${s.label}`} />
            </div>
          )}
          {s.repeated.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Answers given more than once</p>
              <BarList bars={s.repeated} caption={`Repeated answers to: ${s.label}`} />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Latest answers</p>
            <ul className="space-y-1">
              {s.recent.map((t, i) => <li key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5 break-words text-slate-800">“{t}”</li>)}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}
