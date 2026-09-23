import type { Project } from '../lib/types';
import { PICO_KEYS, PICO_LABELS, activePico, type CriteriaTerms } from '../lib/criteria';
import { PICO_MARK } from './Pico';
import { EXC_MARK, INC_MARK } from './CriteriaKeywords';

export function CriteriaView({ project, compact, terms }: { project: Project; compact?: boolean; terms?: CriteriaTerms }) {
  const rows: [string, string | null][] = [
    ['Population', project.population],
    ['Intervention / Exposure', project.intervention_or_exposure],
    ['Comparator', project.comparator],
    ['Outcomes', project.outcomes],
    ['Study designs', project.study_design],
    ['Date range', project.date_range],
    ['Language', project.language],
  ];
  const anyPico = rows.some(([, v]) => v);
  if (!project.inclusion_criteria && !project.exclusion_criteria && !anyPico) {
    return <p className="text-sm text-slate-500">No criteria recorded yet. Add them in Settings → Project settings.</p>;
  }
  return (
    <div className="space-y-4 text-sm">
      {project.research_question && !compact && (
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Research question</h3>
          <p className="mt-1 whitespace-pre-wrap">{project.research_question}</p>
        </div>
      )}
      <div>
        <h3 className="text-xs font-bold tracking-wide text-emerald-800 uppercase">✓ Inclusion criteria</h3>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{project.inclusion_criteria || '—'}</p>
      </div>
      <div>
        <h3 className="text-xs font-bold tracking-wide text-rose-800 uppercase">✕ Exclusion criteria</h3>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{project.exclusion_criteria || '—'}</p>
      </div>
      {terms && (terms.include.length > 0 || terms.exclude.length > 0) && (
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Criteria keywords (highlighted in abstracts)</h3>
          <p className="mt-1 flex flex-wrap gap-1">{terms.include.map((t) => <span key={t} className={INC_MARK}>{t}</span>)}</p>
          <p className="mt-1 flex flex-wrap gap-1">{terms.exclude.map((t) => <span key={t} className={EXC_MARK}>{t}</span>)}</p>
        </div>
      )}
      {terms && activePico(terms).length > 0 && (
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">PICO keywords (highlighted in abstracts)</h3>
          {PICO_KEYS.filter((k) => terms.pico?.[k]?.length).map((k) => (
            <p key={k} className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-xs font-medium text-slate-600">{PICO_LABELS[k]}:</span>
              {terms.pico![k].map((t) => <span key={t} className={PICO_MARK[k]}>{t}</span>)}
            </p>
          ))}
        </div>
      )}
      {anyPico && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-slate-600">{k}</dt>
              <dd className="whitespace-pre-wrap text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
