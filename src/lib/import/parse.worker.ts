/// <reference lib="webworker" />
import { detectFormat, parseByFormat, type ImportFormat, type ParseResult } from './parsers';
import { findWithinFileDuplicates } from './dedupe';
import { isValidDoi } from '../normalize';

export interface ParseRequest {
  text: string;
  fileName: string;
  format?: ImportFormat;
}

export interface ParseStats {
  total: number;
  withTitle: number;
  withoutTitle: number;
  withAbstract: number;
  invalidDoi: number;
  withinFileDuplicateGroups: number[][];
  withinFileDuplicates: number;
}

export type ParseResponse =
  | { ok: true; result: ParseResult; stats: ParseStats }
  | { ok: false; error: string };

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  try {
    const { text, fileName } = ev.data;
    const format = ev.data.format ?? detectFormat(fileName, text);
    if (!format) {
      const resp: ParseResponse = {
        ok: false,
        error: 'Unsupported or unrecognised file. Please upload a CSV, RIS, BibTeX (.bib) or PubMed (.nbib) file.',
      };
      self.postMessage(resp);
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
    };
    const resp: ParseResponse = { ok: true, result, stats };
    self.postMessage(resp);
  } catch (e) {
    const resp: ParseResponse = { ok: false, error: `The file could not be read: ${(e as Error).message}` };
    self.postMessage(resp);
  }
};
