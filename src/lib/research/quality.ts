// Data-quality checks for survey responses: people who rushed, gave the same
// answer to every item, answered twice, or skipped most of the form. These
// are flags for the researcher to review — nothing is excluded automatically.
import { isFileAnswer, type AnswerValue, type RhField, type RhResponse } from '../api/research';
import { isBlank, median } from './analytics';
import { visibleFields } from './logic';

export type FlagKind = 'speeder' | 'straightline' | 'duplicate' | 'incomplete';
export interface QualityFlag { kind: FlagKind; detail: string }
export interface QualityOptions {
  /** A response faster than this share of the median time is flagged (default 0.4 = 40%). */
  speederRatio?: number;
  /** Share of shown questions that must be answered (default 0.5). */
  minCompletion?: number;
}

export const FLAG_LABEL: Record<FlagKind, string> = {
  speeder: 'Very fast', straightline: 'Same answer to everything', duplicate: 'Possible duplicate', incomplete: 'Mostly blank',
};

export function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m < 60 ? `${m} min${r ? ` ${r} s` : ''}` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The answers that matter for "same answers as another response": everything except files and scores. */
function fingerprint(fields: RhField[], a: Record<string, AnswerValue>): { key: string; answered: number } {
  const parts: string[] = [];
  let answered = 0;
  for (const f of fields) {
    if (f.type === 'calc' || f.type === 'file' || f.type === 'signature') continue;
    const v = a[f.id];
    if (isBlank(v) || isFileAnswer(v)) { parts.push(''); continue; }
    answered++;
    const norm = Array.isArray(v) ? [...v].sort() : typeof v === 'object' ? Object.entries(v).sort() : String(v).trim().toLowerCase();
    parts.push(JSON.stringify(norm));
  }
  return { key: parts.join('|'), answered };
}

/**
 * Flags per response id. Response numbers in the messages (#3) are positions in
 * `responses`, which should be in submission order (as listResponses returns them).
 */
export function qualityFlags(fields: RhField[], responses: RhResponse[], opts: QualityOptions = {}): Map<string, QualityFlag[]> {
  const ratio = opts.speederRatio ?? 0.4;
  const minDone = opts.minCompletion ?? 0.5;
  const out = new Map<string, QualityFlag[]>();
  const add = (id: string, f: QualityFlag) => out.set(id, [...(out.get(id) ?? []), f]);
  const num = new Map(responses.map((r, i) => [r.id, i + 1]));

  // Speeders: compared with the typical (median) time of everyone who has a time.
  const times = responses.filter((r) => !r.excluded).map((r) => r.duration_s).filter((d): d is number => typeof d === 'number');
  const med = times.length >= 3 ? median(times) : null;
  if (med && med > 0) {
    for (const r of responses) {
      if (typeof r.duration_s === 'number' && r.duration_s < ratio * med) {
        add(r.id, { kind: 'speeder', detail: `Took ${fmtDuration(r.duration_s)}; the typical time is ${fmtDuration(med)}.` });
      }
    }
  }

  const grids = fields.filter((f) => f.type === 'grid' && (f.settings?.rows?.length ?? 0) >= 3);
  const scales = fields.filter((f) => f.type === 'scale');
  const emails = fields.filter((f) => f.type === 'email');
  const seen = new Map<string, string>();
  const seenEmail = new Map<string, string>();

  for (const r of responses) {
    const a = r.answers;
    // Straight-lining: every statement of a grid, or every scale question (4+), given the same answer.
    for (const g of grids) {
      const v = a[g.id];
      if (!v || typeof v !== 'object' || Array.isArray(v) || isFileAnswer(v)) continue;
      const rows = g.settings!.rows!;
      const picks = rows.map((row) => (v as Record<string, string>)[row]).filter(Boolean);
      if (picks.length === rows.length && new Set(picks).size === 1) {
        add(r.id, { kind: 'straightline', detail: `Chose “${picks[0]}” for all ${rows.length} statements of Q${fields.indexOf(g) + 1}.` });
      }
    }
    const sv = scales.map((f) => a[f.id]).filter((v): v is number => typeof v === 'number');
    if (scales.length >= 4 && sv.length === scales.length && new Set(sv).size === 1) {
      add(r.id, { kind: 'straightline', detail: `Gave ${sv[0]} to all ${sv.length} scale questions.` });
    }

    // Duplicates: identical answers to at least 3 questions, or the same email address.
    const fp = fingerprint(fields, a);
    if (fp.answered >= 3) {
      const first = seen.get(fp.key);
      if (first) add(r.id, { kind: 'duplicate', detail: `Exactly the same answers as response #${num.get(first)}.` });
      else seen.set(fp.key, r.id);
    }
    for (const e of emails) {
      const v = a[e.id];
      if (typeof v !== 'string' || !v.trim()) continue;
      const k = `${e.id}:${v.trim().toLowerCase()}`;
      const first = seenEmail.get(k);
      if (first && !(out.get(r.id) ?? []).some((f) => f.kind === 'duplicate')) add(r.id, { kind: 'duplicate', detail: `Same email address as response #${num.get(first)}.` });
      else if (!first) seenEmail.set(k, r.id);
    }

    // Mostly blank: few of the questions this person was shown were answered.
    const shown = visibleFields(fields.filter((f) => f.type !== 'calc'), a);
    if (shown.length >= 2) {
      const done = shown.filter((f) => !isBlank(a[f.id])).length / shown.length;
      if (done < minDone) add(r.id, { kind: 'incomplete', detail: `Answered ${Math.round(done * 100)}% of the questions shown.` });
    }
  }
  return out;
}

/** Responses to analyse: those not set aside, unless the owner chose to include them. */
export const analysed = <R extends { excluded?: boolean }>(rs: R[], includeExcluded = false) => (includeExcluded ? rs : rs.filter((r) => !r.excluded));
