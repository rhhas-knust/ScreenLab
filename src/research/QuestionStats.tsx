import type { FieldStats } from '../lib/research/analytics';
import { round } from '../lib/research/analytics';
import { FIELD_LABEL } from '../lib/api/research';
import { BarList } from './Charts';

const n2 = (v: number | null) => (v == null ? '—' : String(round(v, 2)));

/** One question's statistics: numbers first, then the distribution. Used on screen and in the printed report. */
export function QuestionStats({ s, index }: { s: FieldStats; index: number }) {
  const total = s.answered + s.missing;
  return (
    <article className="break-inside-avoid space-y-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="rh-question-stats">
      <header>
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Q{index + 1} · {FIELD_LABEL[s.type]}</p>
        <h3 className="mt-0.5 font-semibold text-ink-900">{s.label}</h3>
        <p className="text-xs text-slate-500">
          {s.answered} of {total} answered{s.missing ? ` · ${s.missing} skipped` : ''}
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
      ) : s.type === 'email' ? (
        <p className="text-sm text-slate-600">Email addresses are not summarised. Download the CSV to see them.</p>
      ) : (
        <div className="space-y-3 text-sm">
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
