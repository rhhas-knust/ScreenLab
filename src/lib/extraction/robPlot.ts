// Risk-of-bias visuals: traffic-light plot (study × item) and summary plot
// (share of each answer per item), built from the agreed appraisals.
import { OVERALL_KEY, type ExtractionData, type ExtractionForm } from './form';

export type Tone = 'good' | 'some' | 'bad' | 'unclear' | 'na' | 'blank';

/** Colour family for an answer: works for JBI answers and Low/Moderate/High judgements. */
export function robTone(answer: string | undefined | null): Tone {
  const a = (answer ?? '').trim().toLowerCase();
  if (!a) return 'blank';
  if (a === 'yes' || a === 'low' || a.startsWith('low')) return 'good';
  if (a === 'no' || a === 'high' || a.startsWith('high') || a.startsWith('serious')) return 'bad';
  if (a === 'moderate' || a.startsWith('some') || a.startsWith('moderate')) return 'some';
  if (a === 'unclear' || a.startsWith('unclear') || a === 'no information') return 'unclear';
  if (a.startsWith('not applicable') || a === 'n/a' || a === 'na') return 'na';
  return 'unclear';
}
export const TONE_COLOR: Record<Tone, string> = {
  good: '#15803d', some: '#d97706', bad: '#b91c1c', unclear: '#ca8a04', na: '#94a3b8', blank: '#e2e8f0',
};
/** Symbol inside each dot, so the plot also reads without colour. */
export const TONE_SYMBOL: Record<Tone, string> = { good: '+', some: '!', bad: '−', unclear: '?', na: '·', blank: '' };

export interface PlotColumn { key: string; short: string; label: string }
export interface TrafficLight {
  columns: PlotColumn[];
  rows: { label: string; cells: string[] }[];
}

/** Columns = the form's one-choice questions, overall judgement last. */
export function plotColumns(form: ExtractionForm): PlotColumn[] {
  const items = form.fields.filter((f) => f.type === 'choice' && f.key !== OVERALL_KEY);
  const cols = items.map((f, i) => ({ key: f.key, short: /^(Q\d+|D\d+)\b/i.exec(f.label)?.[1].toUpperCase() ?? `D${i + 1}`, label: f.label.replace(/^(Q\d+|D\d+)[.:)]\s*/i, '') }));
  if (form.fields.some((f) => f.key === OVERALL_KEY)) cols.push({ key: OVERALL_KEY, short: 'Overall', label: 'Overall risk of bias' });
  return cols;
}

export function trafficLight(form: ExtractionForm, studies: { label: string; data: ExtractionData }[]): TrafficLight {
  const columns = plotColumns(form);
  return {
    columns,
    rows: studies.map((s) => ({ label: s.label, cells: columns.map((c) => { const v = s.data[c.key]; return typeof v === 'string' ? v : ''; }) })),
  };
}

/** Per column: how many studies gave each answer (in the field's option order). */
export function robSummary(form: ExtractionForm, tl: TrafficLight): { column: PlotColumn; parts: { answer: string; n: number; tone: Tone }[]; total: number }[] {
  return tl.columns.map((c, ci) => {
    const field = form.fields.find((f) => f.key === c.key);
    const answers = [...(field?.options ?? [])];
    for (const r of tl.rows) if (r.cells[ci] && !answers.includes(r.cells[ci])) answers.push(r.cells[ci]);
    const parts = answers.map((a) => ({ answer: a, n: tl.rows.filter((r) => r.cells[ci] === a).length, tone: robTone(a) })).filter((p) => p.n > 0);
    const blank = tl.rows.filter((r) => !r.cells[ci]).length;
    if (blank) parts.push({ answer: 'Not answered', n: blank, tone: 'blank' });
    return { column: c, parts, total: tl.rows.length };
  });
}
