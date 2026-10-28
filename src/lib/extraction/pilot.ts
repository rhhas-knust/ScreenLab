// Pilot report: for the studies both reviewers have done, each reviewer's
// answers side by side with the differences marked, agreement per field, and
// the agreed final answers. Used to refine the form before full extraction.
import Papa from 'papaparse';
import { agreement, display, sameValue, type ExtractionData, type ExtractionForm, type FieldAgreement } from './form';

export interface PilotInput {
  seq: number;
  label: string;
  title: string | null;
  /** Completed extractions, one per reviewer, in the order they were made. */
  entries: { reviewer: string; data: ExtractionData }[];
  final: ExtractionData | null;
}
export interface PilotStudy extends PilotInput {
  rows: { key: string; label: string; values: string[]; final: string; differ: boolean }[];
  differences: number;
}
export interface Pilot {
  studies: PilotStudy[];
  reviewers: string[];
  agreement: ReturnType<typeof agreement>;
  /** Fields with the lowest agreement, worst first: the ones to clarify in the form. */
  hardest: FieldAgreement[];
}

export function buildPilot(form: ExtractionForm, input: PilotInput[]): Pilot {
  const studies = input.filter((s) => s.entries.length > 0).sort((a, b) => a.seq - b.seq).map((s) => {
    const rows = form.fields.map((f) => {
      const values = s.entries.map((e) => display(e.data[f.key]));
      const differ = s.entries.length > 1 && s.entries.some((e) => !sameValue(e.data[f.key], s.entries[0].data[f.key], f.type));
      return { key: f.key, label: f.label, values, final: s.final ? display(s.final[f.key]) : '', differ };
    });
    return { ...s, rows, differences: rows.filter((r) => r.differ).length };
  });
  const pairs = studies.filter((s) => s.entries.length >= 2).map((s) => [s.entries[0].data, s.entries[1].data] as [ExtractionData, ExtractionData]);
  const ag = agreement(form, pairs);
  const hardest = ag.fields.filter((f) => f.compared > 0 && f.agreed < f.compared)
    .sort((a, b) => a.agreed / a.compared - b.agreed / b.compared || b.compared - a.compared);
  return { studies, reviewers: [...new Set(studies.flatMap((s) => s.entries.map((e) => e.reviewer)))], agreement: ag, hardest };
}

/**
 * Every reviewer's answers laid out as in the PDF report: one block per study,
 * fields down the side, a column per reviewer, then the agreed final answer and
 * whether the reviewers differed. A blank row separates the studies.
 */
export function pilotCsv(pilot: Pilot, noun = 'extraction'): string {
  const out: string[][] = [];
  for (const s of pilot.studies) {
    if (out.length) out.push([]);
    out.push([`${s.label} (#${s.seq})`, s.title ?? '']);
    out.push([`${s.differences} ${s.differences === 1 ? 'field differs' : 'fields differ'}`, s.final ? `final ${noun} agreed` : `final ${noun} not yet agreed`]);
    out.push(['Field', ...s.entries.map((e) => e.reviewer), 'Agreed final', 'Differs']);
    for (const r of s.rows) out.push([r.label, ...r.values, r.final || (s.final ? '' : 'Not yet agreed'), r.differ ? 'Yes' : '']);
  }
  return '\ufeff' + Papa.unparse(out);
}
