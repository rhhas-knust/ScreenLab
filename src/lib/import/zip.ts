import { unzipSync } from 'fflate';

/** Reference-file extensions ScreenLab can read from inside a .zip (e.g. a Rayyan export). */
const SUPPORTED = /\.(csv|tsv|txt|ris|bib|bibtex|nbib)$/i;

export interface ZipEntry {
  name: string;
  size: number;
}

/** Decode bytes as UTF-8, falling back to Windows-1252 for older exports. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Order of preference when a zip holds several reference files (Rayyan: articles.csv). */
function rank(name: string): number {
  const base = name.split('/').pop()!.toLowerCase();
  if (base === 'articles.csv') return 0;
  if (/\.csv$/.test(base)) return 1;
  if (/\.ris$/.test(base)) return 2;
  if (/\.(bib|bibtex)$/.test(base)) return 3;
  if (/\.nbib$/.test(base)) return 4;
  return 5;
}

export function readZip(buf: ArrayBuffer, wanted?: string): { entries: ZipEntry[]; name: string; text: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf), {
      filter: (f) => SUPPORTED.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name),
    });
  } catch {
    throw new Error('The .zip file could not be opened — it may be damaged or password-protected.');
  }
  const entries = Object.entries(files)
    .map(([name, data]) => ({ name, size: data.length }))
    .filter((e) => e.size > 0)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  if (!entries.length) {
    throw new Error('The .zip file does not contain a reference file (CSV, RIS, BibTeX or PubMed). Please check the export.');
  }
  const name = wanted && files[wanted] ? wanted : entries[0].name;
  return { entries, name, text: decodeText(files[name]) };
}
