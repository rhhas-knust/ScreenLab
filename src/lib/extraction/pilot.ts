// Pilot report: for the studies both reviewers have done, each reviewer's
// answers side by side with the differences marked, agreement per field, and
// the agreed final answers. Used to refine the form before full extraction.
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
