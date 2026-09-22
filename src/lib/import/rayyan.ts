/**
 * Rayyan stores each record's screening work inside its "notes" field
 * (CSV "notes" column, RIS "N1", BibTeX "note"), for example:
 *
 *   RAYYAN-INCLUSION: {"Kofi"=>"Included", "Ama"=>"Maybe"} | RAYYAN-LABELS: ML,Hospital |
 *   RAYYAN-EXCLUSION-REASONS: wrong population,foreign language | USER-NOTES: {"Kofi"=>["check later"]}
 *
 * These are decisions a human already made in Rayyan, so they can be carried
 * over when a review is moved to ScreenLab.
 */
import type { Decision } from '../types';

export interface RayyanInfo {
  /** Agreed decision, or null when undecided / reviewers disagree. */
  decision: Decision | null;
  /** Reviewer name → decision as written by Rayyan. */
  reviewers: Record<string, string>;
  /** Reviewers disagree (decision left empty so it can be screened again). */
  conflict: boolean;
  reasons: string[];
  labels: string[];
  notes: string[];
}

const MARKER = /RAYYAN-(INCLUSION|LABELS|EXCLUSION-REASONS)|USER-NOTES/i;

export function hasRayyanMarkers(text: string | null | undefined): boolean {
  return !!text && MARKER.test(text);
}

function mapDecision(v: string): Decision | null {
  const s = v.trim().toLowerCase();
  if (s.startsWith('include')) return 'include';
  if (s.startsWith('exclude')) return 'exclude';
  if (s.startsWith('maybe')) return 'maybe';
  return null;
}

/** Split "a,b , c" into trimmed, de-duplicated items. */
function list(v: string | undefined): string[] {
  if (!v) return [];
  const out: string[] = [];
  for (const p of v.split(/\s*,\s*/)) {
    const t = p.trim().replace(/^"|"$/g, '');
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Split the notes into its "KEY: value" sections (sections are separated by " | "). */
function sections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(RAYYAN-INCLUSION|RAYYAN-LABELS|RAYYAN-EXCLUSION-REASONS|USER-NOTES)\s*:\s*/gi;
  const hits: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) hits.push({ key: m[1].toUpperCase(), start: m.index, end: re.lastIndex });
  hits.forEach((h, i) => {
    const stop = i + 1 < hits.length ? hits[i + 1].start : text.length;
    out[h.key] = text.slice(h.end, stop).replace(/\s*\|\s*$/, '').trim();
  });
  return out;
}

export function parseRayyanNotes(text: string | null | undefined): RayyanInfo | null {
  if (!text || !hasRayyanMarkers(text)) return null;
  const s = sections(text);
  const reviewers: Record<string, string> = {};
  const inc = s['RAYYAN-INCLUSION'] ?? '';
  // {"Name"=>"Included", "Other"=>"Excluded"}  (also tolerates JSON-style "Name": "Included")
  const pairRe = /"((?:[^"\\]|\\.)*)"\s*(?:=>|:)\s*"((?:[^"\\]|\\.)*)"/g;
  let p: RegExpExecArray | null;
  while ((p = pairRe.exec(inc))) reviewers[p[1]] = p[2];
  if (!Object.keys(reviewers).length && inc) {
    // Single value without reviewer names, e.g. "RAYYAN-INCLUSION: Included"
    const d = mapDecision(inc.replace(/[{}"]/g, ''));
    if (d) reviewers.Rayyan = inc.replace(/[{}"]/g, '').trim();
  }
  const decided = [...new Set(Object.values(reviewers).map(mapDecision).filter((d): d is Decision => d !== null))];
  const conflict = decided.length > 1;
  const notes: string[] = [];
  const un = s['USER-NOTES'];
  if (un) {
    // {"Name"=>["note 1", "note 2"]}
    const noteRe = /"((?:[^"\\]|\\.)*)"/g;
    const inner = un.replace(/"((?:[^"\\]|\\.)*)"\s*=>/g, '');
    let n: RegExpExecArray | null;
    while ((n = noteRe.exec(inner))) {
      const t = n[1].replace(/\\"/g, '"').trim();
      if (t) notes.push(t);
    }
    if (!notes.length && un.replace(/[{}[\]"]/g, '').trim()) notes.push(un.replace(/[{}[\]]/g, '').trim());
  }
  return {
    decision: conflict ? null : decided[0] ?? null,
    reviewers,
    conflict,
    reasons: list(s['RAYYAN-EXCLUSION-REASONS']),
    labels: list(s['RAYYAN-LABELS']),
    notes,
  };
}

/** Text written to the ScreenLab notes field for an imported Rayyan record. */
export function rayyanNotesText(r: RayyanInfo): string | null {
  const parts: string[] = [];
  if (r.notes.length) parts.push(r.notes.join('\n'));
  if (r.conflict) {
    parts.push(`[Imported from Rayyan] Reviewers disagreed: ${Object.entries(r.reviewers).map(([k, v]) => `${k}: ${v}`).join('; ')} — left unscreened.`);
  }
  return parts.length ? parts.join('\n\n') : null;
}
