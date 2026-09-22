import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseRayyanNotes, rayyanNotesText } from '../../src/lib/import/rayyan';
import { parseCsv, parseRis } from '../../src/lib/import/parsers';
import { readZip } from '../../src/lib/import/zip';

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url));

describe('Rayyan notes', () => {
  it('reads decision, labels, reasons and notes', () => {
    const r = parseRayyanNotes('RAYYAN-INCLUSION: {"Kofi"=>"Excluded"} | RAYYAN-LABELS: ML, Hospital | RAYYAN-EXCLUSION-REASONS: wrong population,foreign language | USER-NOTES: {"Kofi"=>["check the definition", "second note"]}');
    expect(r).toEqual({
      decision: 'exclude', reviewers: { Kofi: 'Excluded' }, conflict: false,
      reasons: ['wrong population', 'foreign language'], labels: ['ML', 'Hospital'], notes: ['check the definition', 'second note'],
    });
  });
  it('flags reviewer disagreement instead of guessing', () => {
    const r = parseRayyanNotes('RAYYAN-INCLUSION: {"A"=>"Included", "B"=>"Excluded"}')!;
    expect(r.decision).toBeNull();
    expect(r.conflict).toBe(true);
    expect(rayyanNotesText(r)).toContain('Reviewers disagreed');
  });
  it('agreeing reviewers give a decision; undecided gives none', () => {
    expect(parseRayyanNotes('RAYYAN-INCLUSION: {"A"=>"Maybe", "B"=>"Maybe"}')!.decision).toBe('maybe');
    expect(parseRayyanNotes('RAYYAN-LABELS: x')!.decision).toBeNull();
    expect(parseRayyanNotes('Some ordinary EndNote note')).toBeNull();
    expect(parseRayyanNotes(null)).toBeNull();
  });
});

describe('Rayyan exports', () => {
  it('parses the Rayyan CSV layout including notes and " and " authors', () => {
    const res = parseCsv(fx('rayyan-articles.csv').toString('utf8'));
    expect(res.records).toHaveLength(5);
    const [a, b, , d, e] = res.records;
    expect(a.authors).toBe('Doe, J.; Roe, R.');
    expect(a.pmid).toBe('90000101');
    expect(a.rayyan?.decision).toBe('include');
    expect(a.rayyan?.labels).toEqual(['ML', 'Hospital']);
    expect(b.rayyan?.decision).toBe('exclude');
    expect(b.rayyan?.reasons).toEqual(['wrong study design', 'wrong population']);
    expect(b.rayyan?.notes).toEqual(['no model developed']);
    expect(d.rayyan?.conflict).toBe(true);
    expect(e.rayyan).toBeNull();
  });
  it('reads Rayyan data from RIS N1 notes', () => {
    const res = parseRis('TY  - JOUR\nTI  - Fictional RIS item\nN1  - RAYYAN-INCLUSION: {"Kofi"=>"Maybe"} | RAYYAN-LABELS: Later\nER  - \n');
    expect(res.records[0].rayyan?.decision).toBe('maybe');
    expect(res.records[0].rayyan?.labels).toEqual(['Later']);
  });
  it('opens the reference file inside a zip (prefers articles.csv)', () => {
    const z = readZip(Uint8Array.from(fx('rayyan-export.zip')).buffer);
    expect(z.name).toBe('articles.csv');
    expect(z.text).toContain('RAYYAN-INCLUSION');
    const multi = zipSync({ 'export/refs.ris': strToU8('TY  - JOUR\nER  - \n'), 'export/articles.csv': strToU8('title\nx\n'), '__MACOSX/._articles.csv': strToU8('junk') });
    const m = readZip(multi.buffer as ArrayBuffer);
    expect(m.name).toBe('export/articles.csv');
    expect(m.entries.map((x) => x.name)).toEqual(['export/articles.csv', 'export/refs.ris']);
    expect(() => readZip(zipSync({ 'readme.pdf': strToU8('x') }).buffer as ArrayBuffer)).toThrow(/does not contain a reference file/);
    expect(() => readZip(new Uint8Array([1, 2, 3]).buffer)).toThrow(/could not be opened/);
  });
});
