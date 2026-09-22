/// <reference lib="webworker" />
import { detectFormat, parseByFormat, type ImportFormat, type ParseResult } from './parsers';
import { findWithinFileDuplicates } from './dedupe';
import { decodeText, readZip, type ZipEntry } from './zip';
import { isValidDoi } from '../normalize';

export interface ParseRequest {
  /** Raw file bytes (text files and .zip archives). */
  buffer: ArrayBuffer;
  fileName: string;
  format?: ImportFormat;
  /** For .zip files: which file inside the archive to read. */
  zipEntry?: string;
}

export interface RayyanStats {
  records: number;
  include: number;
  exclude: number;
  maybe: number;
  conflicts: number;
  withLabels: number;
  withNotes: number;
  reviewers: string[];
  reasons: string[];
  labels: string[];
}

export interface ParseStats {
  total: number;
  withTitle: number;
  withoutTitle: number;
  withAbstract: number;
  invalidDoi: number;
  withinFileDuplicateGroups: number[][];
  withinFileDuplicates: number;
  rayyan: RayyanStats | null;
}

export type ParseResponse =
  | { ok: true; result: ParseResult; stats: ParseStats; zip: { entries: ZipEntry[]; used: string } | null }
  | { ok: false; error: string };

function rayyanStats(result: ParseResult): RayyanStats | null {
  const withData = result.records.filter((r) => r.rayyan);
  if (!withData.length) return null;
  const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()].sort((a, b) => a.localeCompare(b));
  return {
    records: withData.length,
    include: withData.filter((r) => r.rayyan!.decision === 'include').length,
    exclude: withData.filter((r) => r.rayyan!.decision === 'exclude').length,
    maybe: withData.filter((r) => r.rayyan!.decision === 'maybe').length,
    conflicts: withData.filter((r) => r.rayyan!.conflict).length,
    withLabels: withData.filter((r) => r.rayyan!.labels.length).length,
    withNotes: withData.filter((r) => r.rayyan!.notes.length).length,
    reviewers: uniq(withData.flatMap((r) => Object.keys(r.rayyan!.reviewers))),
    reasons: uniq(withData.flatMap((r) => r.rayyan!.reasons)),
    labels: uniq(withData.flatMap((r) => r.rayyan!.labels)),
  };
}

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  try {
    const { buffer, fileName } = ev.data;
    let text: string;
    let innerName = fileName;
    let zip: { entries: ZipEntry[]; used: string } | null = null;
    const bytes = new Uint8Array(buffer);
    const isZip = /\.zip$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
    if (isZip) {
      const z = readZip(buffer, ev.data.zipEntry);
      text = z.text;
      innerName = z.name;
      zip = { entries: z.entries, used: z.name };
    } else {
      text = decodeText(bytes);
    }
    if (!text.trim()) {
      self.postMessage({ ok: false, error: 'The file is empty.' } satisfies ParseResponse);
      return;
    }
    const format = ev.data.format ?? detectFormat(innerName, text);
    if (!format) {
      self.postMessage({
        ok: false,
        error: 'Unsupported or unrecognised file. Please upload a CSV, RIS, BibTeX (.bib), PubMed (.nbib) file, or a .zip export (e.g. from Rayyan) containing one.',
      } satisfies ParseResponse);
      return;
    }
    const result = parseByFormat(format, text);
    const groups = findWithinFileDuplicates(result.records);
    const stats: ParseStats = {
      total: result.records.length,
      withTitle: result.records.filter((r) => r.title).length,
      withoutTitle: result.records.filter((r) => !r.title).length,
      withAbstract: result.records.filter((r) => r.abstract).length,
      invalidDoi: result.records.filter((r) => r.doi && !isValidDoi(r.doi)).length,
      withinFileDuplicateGroups: groups,
      withinFileDuplicates: groups.reduce((n, g) => n + g.length - 1, 0),
      rayyan: rayyanStats(result),
    };
    self.postMessage({ ok: true, result, stats, zip } satisfies ParseResponse);
  } catch (e) {
    self.postMessage({ ok: false, error: (e as Error).message || 'The file could not be read.' } satisfies ParseResponse);
  }
};
