#!/usr/bin/env node
/**
 * Generates a large, clearly FICTIONAL reference file for performance testing.
 * Usage: node scripts/generate-test-data.mjs [count] [out.csv]
 * Every title starts with "[SYNTHETIC TEST RECORD]" and uses invented words,
 * so nothing can be mistaken for a real publication. ~2% of records are
 * deliberate duplicates (same DOI or same title) to exercise de-duplication.
 */
import fs from 'node:fs';

const count = Number(process.argv[2] ?? 5000);
const out = process.argv[3] ?? 'tests/fixtures/large-5000.csv';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

const ADJ = ['Imaginary', 'Pretend', 'Synthetic', 'Fictional', 'Invented', 'Hypothetical', 'Simulated', 'Placeholder'];
const METHOD = ['gradient-boosted', 'deep', 'random-forest', 'transformer', 'logistic', 'federated', 'Bayesian', 'rule-based'];
const TOPIC = ['wardborne fever', 'glimmer sepsis', 'phantom pneumonia', 'mock catheter infection', 'dummy wound infection', 'zorbic bacteraemia', 'quibble colitis', 'faux urinary infection'];
const SETTING = ['pretend hospitals', 'imaginary ICUs', 'fictional clinics', 'invented wards', 'simulated care homes'];
const DESIGN = ['a retrospective cohort', 'a diagnostic accuracy study', 'a case-control study', 'a prospective validation', 'a narrative review', 'an editorial'];
const SOURCES = ['PubMed', 'Scopus', 'Web of Science', 'Embase', 'CINAHL', 'IEEE Xplore'];
const SURN = ['Placeholder', 'Example', 'Sample', 'Mock', 'Dummy', 'Fictitious', 'Stub', 'Template', 'Pretend', 'Invented'];

const SYL = ['ka', 'lo', 'mi', 'ven', 'dra', 'shu', 'tor', 'pel', 'qui', 'zan', 'rob', 'fey', 'nix', 'gal', 'dor', 'wim'];
// A unique invented word per record so titles are genuinely different
const word = (n) => { let w = ''; do { w += SYL[n % SYL.length]; n = Math.floor(n / SYL.length); } while (n > 0); return w; };
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const rows = ['Title,Authors,Abstract,Year,Journal,Volume,Issue,Pages,DOI,PMID,Keywords,Document Type,Language,Database'];
const made = [];
for (let i = 1; i <= count; i++) {
  let r;
  if (i > 50 && rand() < 0.02) {
    const src = made[Math.floor(rand() * made.length)];
    r = { ...src, database: pick(SOURCES), doi: rand() < 0.5 ? src.doi : '', abstract: `${src.abstract} (duplicate export)` };
  } else {
    const topic = pick(TOPIC);
    const method = pick(METHOD);
    const title = `[SYNTHETIC TEST RECORD ${i}] ${pick(ADJ)} ${word(i * 7919)}-${word(i * 104729)} ${method} model for ${topic} in ${pick(SETTING)}: ${pick(DESIGN)}`;
    r = {
      title,
      authors: `${pick(SURN)}, ${String.fromCharCode(65 + (i % 26))}.; ${pick(SURN)}, ${String.fromCharCode(66 + (i % 25))}.`,
      abstract: `SYNTHETIC TEST DATA — not a real study. Background: ${topic} is an invented condition. Methods: a ${method} approach was applied to ${Math.floor(rand() * 20000) + 100} fictional records from ${pick(SETTING)}. Results: an invented AUROC of ${(0.6 + rand() * 0.35).toFixed(2)} was reported. Conclusion: this abstract exists only for performance testing of ScreenLab.`,
      year: 2005 + Math.floor(rand() * 21),
      journal: `Journal of ${pick(ADJ)} Studies (fictional)`,
      volume: 1 + Math.floor(rand() * 40), issue: 1 + Math.floor(rand() * 12), pages: `${i}-${i + 9}`,
      doi: `10.5555/sl-perf.${i}`, pmid: rand() < 0.4 ? `9${String(i).padStart(7, '0')}` : '',
      keywords: `${method}; ${topic}; synthetic`, type: pick(['Article', 'Article', 'Article', 'Review', 'Editorial', 'Conference Paper']),
      language: rand() < 0.95 ? 'English' : pick(['French', 'Spanish', 'Portuguese']), database: pick(SOURCES),
    };
    made.push(r);
  }
  rows.push([r.title, r.authors, r.abstract, r.year, r.journal, r.volume, r.issue, r.pages, r.doi, r.pmid, r.keywords, r.type, r.language, r.database].map(q).join(','));
}
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log(`Wrote ${count} fictional records to ${out}`);
