/**
 * Browser end-to-end test of the complete ScreenLab workflow.
 *
 * Runs the real app (Vite dev server) in headless Chromium against the local
 * test stack (tests/e2e/localstack). Usage:
 *   tests/e2e/localstack/stack.sh reset
 *   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=$(cat /tmp/sl-anon-key.txt) npx vite --port 5173 &
 *   node tests/e2e/browser.e2e.mjs
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const STACK = 'http://localhost:54321';
const ART = path.resolve('tests/e2e/.artifacts');
const FX = path.resolve('tests/fixtures');
fs.mkdirSync(ART, { recursive: true });
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PW = 'Correct-horse-9';
const EMAIL = `researcher+${Date.now()}@screenlab.test`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function sql(q) {
  return execSync(`psql -h /tmp/sl-pg -p 54329 -U postgres -d screenlab -At -c ${JSON.stringify(q)}`).toString().trim();
}
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitSaved(page, timeout = 15000) {
  await page.getByTestId('sync-status').filter({ hasText: 'Saved' }).waitFor({ timeout });
}
const currentRef = (page) => new URL(page.url()).searchParams.get('ref');
const visible = (loc, timeout = 8000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
async function currentTitle(page) {
  return (await page.locator('#article-title').textContent())?.trim();
}

const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  // ---------------------------------------------------------------- TEST 1–2
  await page.goto(`${APP}/`);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  check('Unauthenticated users are redirected to sign in', page.url().includes('/login'));
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.locator('#password').fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  check('Sign-up validates password length', await page.getByText('at least 8 characters').first().isVisible());
  await page.locator('#password').fill(PW);
  await page.getByLabel('Confirm password').fill(PW);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Welcome to ScreenLab' }).waitFor();
  check('TEST 1: Create account → first-login welcome screen', true);
  await shot(page, '01-welcome');

  await page.getByRole('button', { name: 'Account and navigation menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  check('Wrong password shows a clear error', await visible(page.getByText('Incorrect email or password')));
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Welcome to ScreenLab' }).waitFor();
  check('TEST 2: Log in', true);

  // ---------------------------------------------------------------- TEST 3
  await page.getByRole('button', { name: 'Create review' }).first().click();
  await page.getByLabel('Review title').fill('Machine Learning for Hospital-Acquired Infection Detection (E2E)');
  await page.getByLabel('Research question').fill('How accurate are ML models for detecting HAIs?');
  await page.getByLabel('Inclusion criteria').fill('Primary ML studies\nHospital setting');
  await page.getByLabel('Exclusion criteria').fill('Editorials\nNo model');
  await page.getByRole('button', { name: 'Create review' }).click();
  await page.getByRole('heading', { name: /Machine Learning for Hospital-Acquired/ }).waitFor();
  const projectUrl = page.url();
  const projectId = projectUrl.split('/p/')[1].split('/')[0];
  check('TEST 3: Create review', /\/p\/[0-9a-f-]{36}$/.test(projectUrl));
  await shot(page, '03-dashboard-empty');

  // ---------------------------------------------------------------- TEST 4–6
  async function importFile(file, source, expectRecords) {
    await page.goto(`${APP}/p/${projectId}/import`);
    await page.getByLabel('Reference file').setInputFiles(path.join(FX, file));
    await page.getByLabel(/Database source/).selectOption(source);
    await page.getByRole('button', { name: 'Preview import' }).click();
    await page.getByRole('heading', { name: 'Import preview' }).waitFor({ timeout: 60000 });
    const detected = await page.locator('dt:has-text("Records detected") + dd').textContent();
    await shot(page, `04-preview-${file}`);
    await page.getByRole('button', { name: /^Import [\d,]+ references$/ }).click();
    await page.getByRole('heading', { name: '✓ Import complete' }).waitFor({ timeout: 180000 });
    return Number(detected.replace(/,/g, '')) === expectRecords;
  }
  check('TEST 4: Import CSV (preview + import)', await importFile('sample.csv', 'Scopus', 4));
  const missingTitle = sql(`select count(*) from study_references where project_id='${projectId}' and title is null`);
  check('Records with missing titles are imported, not discarded', missingTitle === '1');
  check('TEST 5: Import RIS', await importFile('sample.ris', 'Web of Science', 3));
  check('TEST 6: Import BibTeX', await importFile('sample.bib', 'Google Scholar', 3));
  check('PubMed .nbib import', await importFile('sample.nbib', 'PubMed', 2));
  const total = sql(`select count(*) from study_references where project_id='${projectId}'`);
  check('All 12 records stored in the database', total === '12', total);
  const dupPossible = sql(`select count(*) from study_references where project_id='${projectId}' and duplicate_status='possible'`);
  check('TEST 24a: Duplicate detection flags the duplicate DOI pair (not deleted)', Number(dupPossible) >= 2, `possible=${dupPossible}`);

  // Unsupported file type
  await page.goto(`${APP}/p/${projectId}/import`);
  fs.writeFileSync(path.join(ART, 'paper.pdf'), '%PDF-1.4 not a reference file');
  await page.getByLabel('Reference file').setInputFiles(path.join(ART, 'paper.pdf'));
  await page.getByRole('button', { name: 'Preview import' }).click();
  check('Unsupported file type is rejected with a clear message', await visible(page.getByText('Unsupported file type')));
  fs.writeFileSync(path.join(ART, 'broken.bib'), '@article{x, title={Broken entry without closing');
  await page.getByLabel('Reference file').setInputFiles(path.join(ART, 'broken.bib'));
  await page.getByRole('button', { name: 'Preview import' }).click();
  check('Malformed BibTeX reports a problem instead of failing silently', await visible(page.getByText(/unbalanced braces|No references were found/)));

  // ---------------------------------------------------------------- Dashboard
  await page.goto(`${APP}/p/${projectId}`);
  await page.getByText('Title / abstract screening').first().waitFor();
  check('Dashboard shows progress + Continue screening', await page.getByRole('button', { name: /Continue screening/ }).isVisible());
  await shot(page, '05-dashboard');

  // ---------------------------------------------------------------- TEST 9–15
  await page.getByRole('button', { name: /Continue screening/ }).click();
  await page.locator('#article-title').waitFor();
  const t1 = await currentTitle(page);
  check('TEST 9: Open article (title + abstract visible without extra clicks)', !!t1 && await page.getByRole('heading', { name: 'Abstract' }).isVisible());
  await shot(page, '06-screening-desktop');

  await page.keyboard.press('i');
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t, t1);
  const t2 = await currentTitle(page);
  check('TEST 10: Include (keyboard I)', true);
  check('TEST 14: Automatically moves to the next article', t2 !== t1, `${t1?.slice(0, 40)} → ${t2?.slice(0, 40)}`);
  check('Toast confirms the decision', await page.getByText('✓ Included').first().isVisible());

  await page.keyboard.press('e');
  await page.getByTestId('reason-picker').first().waitFor();
  check('TEST 11: Exclude opens the exclusion-reason panel', true);
  await shot(page, '07-reason-picker');
  await page.keyboard.press('1');
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t, t2);
  check('TEST 12: Exclusion reason chosen with key 1 → "Excluded — Wrong population"', await page.getByText('✕ Excluded — Wrong population').first().isVisible());
  const t3 = await currentTitle(page);
  const r3 = currentRef(page);

  await page.getByTestId('decide-maybe').first().click();
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t, t3);
  check('TEST 13: Maybe (button click)', true);
  await waitSaved(page);
  const decided = sql(`select title_abstract_decision || coalesce(':' || title_abstract_exclusion_reason, '') from study_references where project_id='${projectId}' and title_abstract_decision is not null order by title_abstract_screened_at`);
  check('Decisions saved to the database', decided === 'include\nexclude:Wrong population\nmaybe', decided.replace(/\n/g, ' | '));

  await page.keyboard.press('u');
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() === t, t3);
  await waitSaved(page);
  const afterUndo = sql(`select coalesce(title_abstract_decision, 'unscreened') from study_references where id = '${r3}'`);
  check('TEST 15: Undo restores the previous decision and reopens the article', afterUndo === 'unscreened', afterUndo);
  const hist = sql(`select string_agg(coalesce(previous_decision,'-')||'>'||coalesce(decision,'-')||':'||action, ', ' order by sd.created_at) from screening_decisions sd where sd.reference_id = '${r3}'`);
  check('Audit trail keeps the undone decision', hist === '->maybe:decide, maybe>-:undo', hist);

  // Changing an existing decision asks for a lightweight confirmation
  await page.locator('aside[aria-label="Article list"] button', { hasText: t1.slice(0, 30) }).first().click();
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() === t, t1);
  await page.keyboard.press('e');
  await page.keyboard.press('2');
  check('Changing Included → Excluded asks for confirmation', await page.getByRole('alertdialog', { name: 'Confirm decision change' }).first().isVisible());
  await page.keyboard.press('Escape');
  check('Esc cancels the change', !(await page.getByRole('alertdialog').first().isVisible()));

  // ---------------------------------------------------------------- TEST 16–17
  await page.keyboard.press('n');
  await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t, t1);
  const noteTitle = await currentTitle(page);
  const noteRef = currentRef(page);
  await page.locator('aside[aria-label="Screening controls"] #notes').fill('Potentially relevant but infection definition is unclear.');
  await sleep(1200);
  await waitSaved(page);
  const note = sql(`select notes from study_references where id = '${noteRef}'`);
  check('TEST 16: Add note (auto-saved)', note === 'Potentially relevant but infection definition is unclear.', note);
  await page.locator('aside[aria-label="Screening controls"] #tag-input').fill('Needs Full Text');
  await page.keyboard.press('Enter');
  await page.locator('aside[aria-label="Screening controls"]').getByText('#Needs Full Text').waitFor();
  await sleep(500);
  const tags = sql(`select array_to_string(tag_names, ',') from study_references where id = '${noteRef}'`);
  check('TEST 17: Add tag', tags === 'Needs Full Text', tags);
  await shot(page, '08-notes-tags');

  // ---------------------------------------------------------------- TEST 18
  await page.reload();
  await page.locator('#article-title').waitFor();
  check('TEST 18: Reload keeps the same article open (URL state)', (await currentTitle(page)) === noteTitle);
  await page.getByText('3 / 11 screened').first().waitFor({ timeout: 10000 }).catch(() => {});
  const progressText = await page.locator('section[aria-label="Article details"] .sticky').textContent();
  check('TEST 18: Decisions still present after reload', /2 \/ 12 screened/.test(progressText), progressText.trim().slice(0, 80));
  check('Note still present after reload', (await page.locator('aside[aria-label="Screening controls"] #notes').inputValue()).includes('infection definition'));

  // ---------------------------------------------------------------- TEST 7–8
  await page.keyboard.press('/');
  await page.locator('#screen-search').fill('lovelace');
  await sleep(900);
  const listCount = await page.locator('aside[aria-label="Article list"] ul[aria-label="Articles"] > li').count();
  check('TEST 7: Search (author "lovelace") narrows the list server-side', listCount === 1, `rows=${listCount}`);
  await page.locator('#screen-search').fill('definition unclear');
  await sleep(900);
  check('Search covers notes', (await page.locator('aside[aria-label="Article list"] ul[aria-label="Articles"] > li').count()) === 1);
  await page.locator('#screen-search').fill('');
  await sleep(900);
  await page.locator('aside[aria-label="Article list"]').getByRole('button', { name: /Filters/ }).click();
  await page.locator('#sf-status').selectOption('exclude');
  await sleep(900);
  const exCount = await page.locator('aside[aria-label="Article list"] ul[aria-label="Articles"] > li').count();
  await page.locator('#sf-source').selectOption('Scopus');
  await sleep(900);
  check('TEST 8: Filter by status (+ database)', exCount === 1, `excluded rows=${exCount}`);
  await shot(page, '09-filters');
  await page.getByRole('button', { name: 'Clear all filters' }).first().click();
  await sleep(700);

  // Keyboard shortcut help
  await page.keyboard.press('?');
  check('Keyboard shortcuts help panel opens with ?', await page.getByRole('heading', { name: 'Keyboard shortcuts' }).isVisible());
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  check('Review criteria panel opens with C', await page.getByRole('heading', { name: 'Review criteria' }).isVisible());
  await page.keyboard.press('Escape');

  // Screen all remaining records at title/abstract quickly, then full text
  for (let i = 0; i < 20; i++) {
    if (await page.getByRole('heading', { name: 'All caught up' }).isVisible()) break;
    const before = await currentTitle(page);
    await page.keyboard.press(i % 3 === 0 ? 'i' : 'm');
    await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t || !!document.evaluate("//h1[text()='All caught up']", document, null, 9, null).singleNodeValue, before).catch(() => {});
  }
  check('Reaching the end shows "All caught up" (never wanders into screened records)', await page.getByRole('heading', { name: 'All caught up' }).isVisible());
  await waitSaved(page);
  await page.getByRole('button', { name: /Go to full-text screening/ }).click();
  await page.locator('#article-title').waitFor();
  check('Stage 2 full-text screening only offers Include / Exclude', (await page.getByTestId('decide-maybe').count()) === 0);
  await page.keyboard.press('e');
  check('Full-text exclusion does not offer "Exclude without a reason"', !(await page.getByText('Exclude without a reason').first().isVisible()));
  await page.getByTestId('reason-picker').first().getByRole('button', { name: /Full text unavailable/ }).click();
  await waitSaved(page);
  const ft = sql(`select count(*) from study_references where project_id='${projectId}' and full_text_decision='exclude' and full_text_exclusion_reason='Full text unavailable'`);
  check('Full-text decision + reason recorded', ft === '1');
  await shot(page, '10-fulltext');

  // PDF upload / view
  const pdfPath = path.join(ART, 'fictional.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  await page.locator('aside[aria-label="Screening controls"] input[type=file]').setInputFiles(pdfPath);
  await page.locator('aside[aria-label="Screening controls"]').getByText('fictional.pdf').waitFor({ timeout: 10000 });
  check('Upload PDF (stored privately, status → available)', sql(`select count(*) from full_text_files where project_id='${projectId}'`) === '1');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('aside[aria-label="Screening controls"]').getByRole('button', { name: 'View PDF' }).click()]);
  await popup.waitForURL(/storage\/v1\/object\/sign/, { timeout: 10000 }).catch(() => {});
  check('View PDF opens a signed link', popup.url().includes('/storage/v1/object/sign/'), popup.url().slice(0, 80));
  await popup.close();
  check('Full-text finder: attach option (untitled record hides title-search links)', await visible(page.getByTestId('ft-finder').getByText('Attach another PDF'))
    && (await page.getByTestId('ft-finder').getByRole('link', { name: /Google Scholar/ }).count()) === 0);
  check('Full-text finder: the attached PDF opens inside the screening page', await visible(page.locator('[data-testid="ft-finder"] iframe[src*="/storage/v1/object/sign/"]')));
  check('Full-text header shows progress to halfway', /halfway/.test(await page.getByTestId('halfway').textContent()));
  await shot(page, '10b-fulltext-pdf-inline');

  // ---------------------------------------------------------------- TEST 24
  await page.goto(`${APP}/p/${projectId}/duplicates`);
  await page.getByRole('heading', { name: 'Duplicates' }).waitFor();
  await page.getByText('Same DOI').first().waitFor();
  await page.getByRole('button', { name: 'Merge…' }).first().click();
  await page.getByRole('heading', { name: 'Merge duplicate records' }).waitFor();
  await shot(page, '11-merge');
  await page.getByRole('button', { name: 'Merge records' }).click();
  await page.getByText('Records merged').waitFor();
  const merged = sql(`select count(*) from study_references where project_id='${projectId}' and duplicate_status='merged'`);
  check('TEST 24: Compare + merge duplicates (secondary kept as "merged", not deleted)', merged === '1', `merged=${merged}`);
  check('Merge is recorded with a snapshot for audit', sql(`select count(*) from duplicate_groups where project_id='${projectId}' and resolution='merged' and resolution_details ? 'before'`) === '1');

  // ---------------------------------------------------------------- Stats
  await page.goto(`${APP}/p/${projectId}/statistics`);
  await page.getByRole('heading', { name: 'Screening statistics' }).waitFor();
  await shot(page, '12-statistics');
  check('Statistics page renders derived counts', await page.getByText('Records identified from databases (imported)').isVisible());
  await page.goto(`${APP}/p/${projectId}/activity`);
  await page.getByRole('heading', { name: 'Activity log' }).waitFor();
  check('Activity log lists screening + import events', (await visible(page.getByText(/Screened as Excluded — Wrong population/))) && (await visible(page.getByText(/Imported 4 references from sample.csv/))));

  // ---------------------------------------------------------------- TEST 21–23
  await page.goto(`${APP}/p/${projectId}/settings#export`);
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv = fs.readFileSync(await csvDl.path(), 'utf8');
  check('TEST 21: Export CSV (decisions, reasons, notes, tags, timestamps)',
    csv.includes('Title/Abstract exclusion reason') && csv.includes('Wrong population') && csv.includes('infection definition is unclear') && csv.includes('Needs Full Text'));
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  check('TEST 22: Export JSON', JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8')).references.length === 12);
  const [risDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export RIS' }).click()]);
  check('Export RIS', (fs.readFileSync(await risDl.path(), 'utf8').match(/^TY {2}- /gm) ?? []).length === 12);
  const [bkDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export project backup' }).click()]);
  const backupPath = path.join(ART, 'backup.json');
  fs.copyFileSync(await bkDl.path(), backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check('Complete project backup contains history, tags, notes, duplicates, settings',
    backup.format === 'screenlab-backup' && backup.references.length === 12 && backup.screening_decisions.length > 5 && backup.tags.length === 1 && backup.duplicate_groups.length >= 1 && !!backup.settings);

  // Corrupted backup
  fs.writeFileSync(path.join(ART, 'corrupt.json'), '{"format":"screenlab-backup","version":1,"project":{"title":"x"},"references":[{');
  await page.goto(`${APP}/projects`);
  await page.getByRole('button', { name: 'Import project' }).click();
  await page.getByLabel('Project file').setInputFiles(path.join(ART, 'corrupt.json'));
  check('Corrupted backup is rejected with a clear message', await visible(page.getByText(/not valid JSON/)));
  await page.getByLabel('Project file').setInputFiles(backupPath);
  await page.getByLabel('Name for the restored project').fill('Restored E2E project');
  await page.getByRole('button', { name: 'Restore as new project' }).click();
  await page.getByRole('heading', { name: 'Restored E2E project' }).waitFor({ timeout: 60000 });
  const restoredId = page.url().split('/p/')[1];
  const cmp = (q) => [sql(q.replace('$P', projectId)), sql(q.replace('$P', restoredId))];
  const [a1, b1] = cmp(`select string_agg(coalesce(title,'') || ':' || coalesce(title_abstract_decision,'-') || ':' || coalesce(title_abstract_exclusion_reason,'-') || ':' || coalesce(full_text_decision,'-') || ':' || coalesce(notes,'') || ':' || array_to_string(tag_names, ',') || ':' || duplicate_status, '|' order by seq) from study_references where project_id='$P'`);
  const [a2, b2] = cmp(`select count(*) from screening_decisions where project_id='$P'`);
  check('TEST 23: Restore backup into a new project (identical references, decisions, notes, tags)', a1 === b1 && a1.length > 100);
  check('Restored project keeps the full screening history', a2 === b2, `${a2} vs ${b2}`);
  await shot(page, '13-restored');

  // ---------------------------------------------------------------- TEST 26
  await page.goto(`${APP}/p/${projectId}/screening?status=maybe`);
  await page.locator('#article-title').waitFor();
  const offRef = currentRef(page);
  await context.setOffline(true);
  await page.keyboard.press('i');
  await page.keyboard.press('i'); // confirm change Maybe → Included
  await page.getByTestId('sync-status').filter({ hasText: /Offline/ }).waitFor({ timeout: 10000 });
  const statusText = await page.getByTestId('sync-status').textContent();
  check('TEST 26: Offline decision shows "Offline — changes will sync", never "Saved"', /Offline — 1 change will sync/.test(statusText), statusText);
  await shot(page, '14-offline');
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('screenlab:outbox:')).map((k) => localStorage.getItem(k)).join(''));
  check('Unsynced change is preserved locally', stored.includes('"decision":"include"'));
  check('Server not yet updated while offline', sql(`select title_abstract_decision from study_references where id='${offRef}'`) === 'maybe');
  await context.setOffline(false);
  await waitSaved(page, 30000);
  check('Change syncs automatically when the connection returns',
    sql(`select title_abstract_decision from study_references where id='${offRef}'`) === 'include');

  // Server outage (network reachable but API failing) → retry
  await page.goto(`${APP}/p/${projectId}/screening?status=maybe`);
  await page.locator('#article-title').waitFor();
  await fetch(`${STACK}/__control/offline?v=1`);
  const r5 = currentRef(page);
  await shot(page, '14b-before-outage-decision');
  const dbg = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 120), dialogs: document.querySelectorAll('dialog[open]').length }));
  console.log('debug', JSON.stringify(dbg));
  await page.keyboard.press('i');
  const confirm = await visible(page.getByRole('alertdialog', { name: 'Confirm decision change' }), 3000);
  console.log('debug confirm visible', confirm);
  if (confirm) await page.keyboard.press('i');
  await page.getByTestId('sync-status').filter({ hasText: /Connection problem|Offline/ }).waitFor({ timeout: 10000 });
  check('Server outage shows a retrying status (not "Saved")', true, await page.getByTestId('sync-status').textContent());
  await fetch(`${STACK}/__control/offline?v=0`);
  await waitSaved(page, 40000);
  check('Queued change is retried and saved after the outage', sql(`select title_abstract_decision from study_references where id='${r5}'`) === 'include');

  // ---------------------------------------------------------------- TEST 19–20
  await page.goto(`${APP}/projects`);
  await page.getByRole('button', { name: 'Account and navigation menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  check('TEST 19: Sign out', true);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'My Systematic Reviews' }).waitFor();
  check('TEST 20: Sign back in — projects remain', await page.getByRole('link', { name: /Machine Learning for Hospital-Acquired/ }).isVisible());
  await shot(page, '15-projects');

  // ---------------------------------------------------------------- TEST 27
  const ctxB = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pb = await ctxB.newPage();
  await pb.goto(`${APP}/login`);
  await pb.getByLabel('Email').fill('e2e-b@screenlab.test');
  await pb.getByLabel('Password').fill('E2e-test-password-1');
  await pb.getByRole('button', { name: 'Sign in' }).click();
  await pb.getByRole('heading', { name: 'Welcome to ScreenLab' }).waitFor();
  await pb.goto(`${APP}/p/${projectId}`);
  check('TEST 27: Another user opening the project URL sees "Project not found"', await visible(pb.getByRole('heading', { name: 'Project not found' })));
  await pb.goto(`${APP}/p/${projectId}/screening?ref=${sql(`select id from study_references where project_id='${projectId}' limit 1`)}`);
  check('TEST 27: …including direct article URLs', await visible(pb.getByRole('heading', { name: 'Project not found' })));

  // Demo project (user B)
  await pb.goto(`${APP}/projects`);
  await pb.getByRole('button', { name: 'Try demo' }).first().click();
  await pb.getByText('DEMO DATA').first().waitFor({ timeout: 30000 });
  const demoId = pb.url().split('/p/')[1];
  check('Demo project: 20 fictional references, clearly labelled', sql(`select count(*) from study_references where project_id='${demoId}' and title like '[DEMO]%'`) === '20');
  check('Demo project: duplicates detected', Number(sql(`select count(*) from study_references where project_id='${demoId}' and duplicate_status='possible'`)) >= 4);
  await pb.screenshot({ path: path.join(ART, '16-demo-dashboard.png') });

  // ---------------------------------------------------------------- TEST 28–29
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pm = await mobile.newPage();
  await pm.goto(`${APP}/login`);
  await pm.getByLabel('Email').fill('e2e-b@screenlab.test');
  await pm.getByLabel('Password').fill('E2e-test-password-1');
  await pm.getByRole('button', { name: 'Sign in' }).click();
  await pm.getByRole('heading', { name: 'My Systematic Reviews' }).waitFor();
  await pm.goto(`${APP}/p/${demoId}/screening`);
  await pm.locator('#article-title').waitFor();
  const btn = await pm.getByTestId('decide-include').last().boundingBox();
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('TEST 28: Mobile — large tap targets in a bottom decision bar', btn && btn.height >= 44 && btn.y > 600, JSON.stringify(btn));
  check('TEST 28: Mobile — no horizontal page scroll', !overflow);
  await pm.screenshot({ path: path.join(ART, '17-mobile-screening.png') });
  await pm.getByTestId('decide-exclude').last().tap();
  await pm.getByTestId('reason-picker').last().getByRole('button', { name: /Wrong population/ }).tap();
  await pm.getByText('✕ Excluded — Wrong population').first().waitFor();
  check('TEST 28: Mobile — exclude with reason by tapping', true);
  await pm.getByRole('button', { name: /Show article list/ }).first().tap();
  check('Mobile — article list opens as a drawer', await pm.getByRole('dialog', { name: 'Article list' }).isVisible());
  await pm.screenshot({ path: path.join(ART, '18-mobile-list.png') });
  await mobile.close();

  const cb = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pc = await cb.newPage();
  await pc.goto(`${APP}/login`);
  await pc.getByLabel('Email').fill('e2e-b@screenlab.test');
  await pc.getByLabel('Password').fill('E2e-test-password-1');
  await pc.getByRole('button', { name: 'Sign in' }).click();
  await pc.getByRole('heading', { name: 'My Systematic Reviews' }).waitFor();
  await pc.goto(`${APP}/p/${demoId}/screening`);
  await pc.locator('#article-title').waitFor();
  const three = await pc.evaluate(() => ['Article list', 'Article details', 'Screening controls'].map((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    return el ? el.getBoundingClientRect().width : 0;
  }));
  check('TEST 29: Chromebook 1280×720 — three-column layout (list | article | controls)', three.every((w) => w > 250), three.map(Math.round).join(' | '));
  await pc.screenshot({ path: path.join(ART, '19-chromebook-1280.png') });
  await cb.close();
  await ctxB.close();

  // ---------------------------------------------------------------- Rayyan .zip
  await page.goto(`${APP}/projects/new`);
  await page.getByLabel('Review title').fill('Continued from Rayyan');
  await page.getByRole('button', { name: 'Create review' }).click();
  await page.getByRole('heading', { name: 'Continued from Rayyan' }).waitFor();
  const rayId = page.url().split('/p/')[1];
  await page.goto(`${APP}/p/${rayId}/import`);
  await page.getByLabel('Reference file').setInputFiles(path.join(FX, 'rayyan-export.zip'));
  await page.getByLabel(/Database source/).selectOption('Other');
  await page.getByLabel('Custom source name').fill('Rayyan');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await page.getByRole('heading', { name: 'Import preview' }).waitFor({ timeout: 30000 });
  check('Rayyan .zip export accepted — reads articles.csv inside', await visible(page.getByText('articles.csv')));
  const panel = page.getByTestId('rayyan-panel');
  check('Preview shows Rayyan decisions found', /1 included.*1 excluded.*1 maybe/s.test(await panel.textContent()), (await panel.textContent()).slice(0, 160));
  await shot(page, '23-rayyan-preview');
  await page.getByRole('button', { name: /^Import 5 references$/ }).click();
  await page.getByRole('heading', { name: '✓ Import complete' }).waitFor({ timeout: 60000 });
  check('Rayyan decisions carried over (include / exclude + reasons / maybe)',
    sql(`select string_agg(coalesce(title_abstract_decision,'-') || ':' || coalesce(title_abstract_exclusion_reason,'-'), ',' order by seq) from study_references where project_id='${rayId}'`)
      === 'include:-,exclude:Wrong study design; Wrong population,maybe:-,-:-,-:-');
  check('Rayyan labels became tags', sql(`select string_agg(name, ',' order by name) from tags where project_id='${rayId}'`) === 'Check Later,Hospital,ML');
  await page.getByRole('button', { name: 'Start screening' }).click();
  await page.locator('#article-title').waitFor();
  check('Screening continues at the first record still unscreened', (await currentTitle(page)) === 'Fictional editorial D');
  await page.locator('aside[aria-label="Screening controls"] details summary').click();
  check('Conflict from Rayyan is explained in the notes', (await page.locator('aside[aria-label="Screening controls"] #notes').inputValue()).includes('Reviewers disagreed'));

  // Rayyan .zip through Projects → "Import project"
  await page.goto(`${APP}/projects`);
  await page.getByRole('button', { name: 'Import project' }).click();
  await page.getByLabel('Project file').setInputFiles(path.join(FX, 'rayyan-export.zip'));
  await page.getByLabel('Name for the new review').fill('My Rayyan review');
  await page.getByRole('button', { name: 'Create project and continue' }).click();
  await page.getByRole('heading', { name: 'Import preview' }).waitFor({ timeout: 30000 });
  check('"Import project" accepts a Rayyan .zip and opens the preview in a new project', await visible(page.getByTestId('rayyan-panel')));
  await shot(page, '24-import-project-rayyan');
  await page.getByRole('button', { name: /^Import 5 references$/ }).click();
  await page.getByRole('heading', { name: '✓ Import complete' }).waitFor({ timeout: 60000 });
  const viaId = page.url().split('/p/')[1].split('/')[0];
  check('…project created with Rayyan decisions and source "Rayyan"',
    sql(`select p.title || ':' || count(r.*) filter (where r.title_abstract_decision is not null) || ':' || min(r.database_source) from projects p join study_references r on r.project_id = p.id where p.id='${viaId}' group by p.title`) === 'My Rayyan review:3:Rayyan');

  // ---------------------------------------------------------------- Criteria keywords + multi-select
  await page.goto(`${APP}/projects/new`);
  await page.getByLabel('Review title').fill('Bulk and keywords');
  await page.getByLabel('Inclusion criteria').fill('• Studies of imaginary sensors\n• Widget therapy');
  await page.getByLabel('Exclusion criteria').fill('Conference papers; synthetic data');
  await page.getByRole('button', { name: 'Create review' }).click();
  await page.getByRole('heading', { name: 'Bulk and keywords' }).waitFor();
  const bkId = page.url().split('/p/')[1];
  for (const [f, src] of [['sample.csv', 'Scopus'], ['sample.ris', 'Web of Science']]) {
    await page.goto(`${APP}/p/${bkId}/import`);
    await page.getByLabel('Reference file').setInputFiles(path.join(FX, f));
    await page.getByLabel(/Database source/).selectOption(src);
    await page.getByRole('button', { name: 'Preview import' }).click();
    await page.getByRole('button', { name: /^Import \d+ references$/ }).click();
    await page.getByRole('heading', { name: '✓ Import complete' }).waitFor({ timeout: 60000 });
  }
  await page.goto(`${APP}/p/${bkId}/settings#criteria`);
  await page.getByRole('button', { name: 'Suggest from my inclusion criteria' }).click();
  await page.getByRole('button', { name: 'Suggest from my exclusion criteria' }).click();
  const sugInc = await page.getByLabel('✓ Inclusion keywords').inputValue();
  const sugExc = await page.getByLabel('✕ Exclusion keywords').inputValue();
  check('Keyword suggestions are drawn from the written criteria (editable)', /imaginary sensors/.test(sugInc) && /widget therapy/.test(sugInc) && /^conference$/m.test(sugExc) && /synthetic data/.test(sugExc), `${sugInc.replace(/\n/g, ', ')} | ${sugExc.replace(/\n/g, ', ')}`);
  await page.getByLabel('✓ Inclusion keywords').fill('sensor*\nwidget therapy');
  await page.getByLabel('✕ Exclusion keywords').fill('conference\nsynthetic data');
  await page.getByRole('button', { name: 'Save keywords' }).click();
  await page.getByText('Criteria keywords saved').waitFor();
  await page.goto(`${APP}/p/${bkId}/screening?q=sensors`);
  await page.locator('#article-title').waitFor();
  check('Screening highlights inclusion keywords in the article', await visible(page.locator('#article-title mark[title^="Inclusion keyword"]')));
  check('Keyword check panel lists matches (reading aid)', /Inclusion\s*sensor\*/.test(await page.getByTestId('keyword-check').textContent()));
  await shot(page, '25-keywords-screening');

  // PICO keywords: per-element check beside the decision buttons, highlights and filters
  await page.goto(`${APP}/p/${bkId}/settings#pico`);
  await page.getByLabel(/^P Population keywords/).fill('imaginary patients\nhospital');
  await page.getByLabel(/^I Intervention \/ exposure keywords/).fill('sensor*\nwidget therapy');
  await page.getByLabel(/^O Outcomes keywords/).fill('pathogen*');
  await page.getByRole('button', { name: 'Save PICO keywords' }).click();
  await page.getByText('PICO keywords saved').waitFor();
  await page.goto(`${APP}/p/${bkId}/screening?q=sensors`);
  await page.getByTestId('pico-check').waitFor();
  check('PICO check shows which elements each article mentions', /3 of 3 elements found/.test(await page.getByTestId('pico-summary').textContent()));
  check('PICO elements are highlighted in the article', await visible(page.locator('#article-title mark[title^="Population keyword"]')));
  check('Saving PICO keywords keeps the criteria keywords', /Inclusion\s*sensor\*/.test(await page.getByTestId('keyword-check').textContent()));
  await shot(page, '25b-pico-screening');
  // AI assistant (local stand-in for the Edge Function; advisory only)
  await page.goto(`${APP}/p/${bkId}/screening?q=conference`);
  await page.getByTestId('ai-ask').click();
  await page.getByTestId('ai-suggestion').waitFor();
  const aiText = await page.getByTestId('ai-suggestion').textContent();
  check('AI assistant shows a suggestion with reason and evidence', /Exclude/.test(aiText) && /Wrong publication type/.test(aiText) && /conference paper/.test(aiText));
  check('AI suggestion does not change the decision by itself', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision is not null`) === '0');
  await shot(page, '25c-ai-suggestion');
  await page.locator('#article-title').click();
  await page.keyboard.press('a');
  await waitSaved(page);
  check('"I agree" (A key) records the reviewer\'s decision with the suggested reason', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision='exclude' and title_abstract_exclusion_reason='Wrong publication type'`) === '1');
  await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => {});
  await page.keyboard.press('u');
  await waitSaved(page);
  check('Undo works after accepting an AI suggestion', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision is not null`) === '0');
  await page.goto(`${APP}/p/${bkId}/screening`);
  await page.getByTestId('ai-batch').click();
  await page.getByText(/Done — suggestions are ready/).waitFor({ timeout: 20000 });
  check('AI pre-check runs over the unscreened queue', Number(sql(`select count(distinct reference_id) from ai_suggestions where project_id='${bkId}'`)) >= 6);
  check('AI suggestions are kept for the audit trail (model, source)', sql(`select count(*) from ai_suggestions where project_id='${bkId}' and model='test-model' and source='abstract'`) !== '0');

  await page.goto(`${APP}/p/${bkId}/references?pico=miss_O`);
  await page.getByText('6 references in this view').waitFor({ timeout: 10000 });
  check('Filter: a PICO element missing', (await page.locator('tbody tr').count()) === 6);
  check('References list shows PICO letters per record', await visible(page.locator('th', { hasText: 'PICO' })));

  await page.goto(`${APP}/p/${bkId}/references?kw=exc_only`);
  await page.getByText('1 references in this view').waitFor({ timeout: 10000 });
  check('Filter: exclusion keywords but no inclusion keywords', (await page.locator('tbody tr').count()) === 1);
  await page.goto(`${APP}/p/${bkId}/references`);
  await page.locator('tbody tr').first().waitFor();
  const boxes = page.locator('tbody input[type=checkbox]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByTestId('bulk-bar').waitFor();
  check('Bulk bar shows the selection count', /2 selected/.test(await page.getByTestId('bulk-bar').textContent()));
  await page.getByTestId('bulk-exclude').click();
  await page.getByLabel(/Exclusion reason/).selectOption('Wrong population');
  await shot(page, '26-bulk-confirm');
  await page.getByTestId('bulk-apply').click();
  await page.getByText(/2 records → Excluded — Wrong population/).waitFor();
  check('Bulk exclude with reason saved for each record (with audit rows)',
    sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision='exclude' and title_abstract_exclusion_reason='Wrong population'`) === '2'
    && sql(`select count(*) from screening_decisions where project_id='${bkId}' and exclusion_reason='Wrong population'`) === '2');
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await page.getByText(/Undone — 2 records restored/).waitFor();
  check('Bulk undo restores every record', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision is not null`) === '0');
  await page.locator('thead input[type=checkbox]').check();
  await page.getByTestId('bulk-include').click();
  await page.getByTestId('bulk-apply').click();
  await page.getByText(/7 records → Included/).waitFor();
  check('Select page → bulk include', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision='include'`) === '7');

  await page.goto(`${APP}/p/${bkId}/screening?status=include`);
  await page.locator('#article-title').waitFor();
  await page.getByTestId('select-mode').click();
  await page.locator('aside[aria-label="Article list"] ul input[type=checkbox]').first().check();
  await page.getByTestId('bulk-maybe').click();
  await page.getByTestId('bulk-apply').click();
  await page.getByText(/1 record → Maybe/).waitFor();
  check('Screening list: Select mode → bulk Maybe', sql(`select count(*) from study_references where project_id='${bkId}' and title_abstract_decision='maybe'`) === '1');
  await shot(page, '27-screening-select');

  // ---------------------------------------------------------------- ResearchHub questionnaire
  await page.goto(`${APP}/research`);
  await page.getByLabel('New questionnaire').fill('Study habits survey');
  await page.getByRole('button', { name: 'Create questionnaire' }).click();
  await page.getByRole('heading', { name: 'Study habits survey' }).waitFor();
  const rhId = page.url().split('/research/')[1];
  await page.getByLabel('Introduction').fill('Takes 2 minutes. Answers are anonymous.');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 1', { exact: true }).fill('Which level are you in?');
  await page.getByLabel('Answer type').nth(0).selectOption('radio');
  await page.getByLabel('Options').fill('300\n400');
  await page.getByText('Required').nth(0).click();
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 2', { exact: true }).fill('Hours of study per week');
  await page.getByLabel('Answer type').nth(1).selectOption('number');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 3', { exact: true }).fill('My workload is manageable');
  await page.getByLabel('Answer type').nth(2).selectOption('scale');
  await page.getByRole('button', { name: 'Preview' }).click();
  check('ResearchHub: preview shows the questions', (await page.getByTestId('rh-form-question').count()) === 3);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByTestId('rh-share-url').waitFor();
  const shareUrl = await page.getByTestId('rh-share-url').inputValue();
  check('ResearchHub: publishing gives a public link', shareUrl.endsWith(`/f/${rhId}`), shareUrl);
  await shot(page, '28-rh-builder');

  const pub = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await pub.newPage();
  await pp.goto(shareUrl.replace(/^https?:\/\/[^/]+/, APP));
  await pp.getByRole('heading', { name: 'Study habits survey' }).waitFor();
  await pp.getByRole('button', { name: 'Submit' }).click();
  check('ResearchHub: required questions are enforced (no account needed)', await visible(pp.getByText('This question is required.')));
  await pp.getByLabel('400').check();
  await pp.getByRole('textbox', { name: /Hours of study per week/ }).fill('lots');
  await pp.getByRole('button', { name: 'Submit' }).click();
  check('ResearchHub: numbers are validated', await visible(pp.getByText('Please enter a number.')));
  await pp.getByRole('textbox', { name: /Hours of study per week/ }).fill('12');
  await pp.getByText('4', { exact: true }).click();
  await shot(pp, '29-rh-public-form-mobile');
  await pp.getByRole('button', { name: 'Submit' }).click();
  check('ResearchHub: respondent sees the thank-you screen', await visible(pp.getByRole('heading', { name: 'Thank you!' })));
  await pub.close();
  check('ResearchHub: answer stored', sql(`select answers::text from rh_responses where project_id='${rhId}'`).includes('"400"'));

  await page.goto(`${APP}/research/${rhId}/responses`);
  await page.getByTestId('rh-response-count').waitFor();
  check('ResearchHub: owner sees the response', /^1 response$/.test(await page.getByTestId('rh-response-count').textContent()));
  const [rhDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV/ }).click()]);
  const rhCsv = fs.readFileSync(await rhDl.path(), 'utf8');
  check('ResearchHub: CSV export has one column per question', /Which level are you in\?/.test(rhCsv) && /,400,12,4/.test(rhCsv), rhCsv.split('\n')[1]);
  await shot(page, '30-rh-responses');

  // ResearchHub step B: statistics, AI summary, printable report
  const rhFields = Object.fromEntries(sql(`select string_agg(type || '=' || id::text, ',' order by field_order) from rh_fields where project_id='${rhId}'`).split(',').map((kv) => kv.split('=')));
  for (const [lvl, hrs, sc] of [['300', 8, 2], ['400', 20, 5], ['400', 10, 4]]) {
    sql(`insert into rh_responses(project_id, answers) values ('${rhId}', '${JSON.stringify({ [rhFields.radio]: lvl, [rhFields.number]: hrs, [rhFields.scale]: sc })}'::jsonb)`);
  }
  await page.reload();
  await page.getByTestId('rh-question-stats').first().waitFor();
  check('ResearchHub: summary shows one card per question', (await page.getByTestId('rh-question-stats').count()) === 3);
  const numText = await page.getByTestId('rh-numeric-stats').first().textContent();
  check('ResearchHub: numeric question shows mean and median', /Mean12\.5/.test(numText) && /Median11/.test(numText), numText);
  check('ResearchHub: choice question shows counts and percentages', await visible(page.getByText('3 · 75%')));
  await page.getByTestId('rh-ai-write').click();
  await page.getByTestId('rh-ai-summary').waitFor();
  check('ResearchHub: AI summary is written server-side and shown', /Test summary of 4 responses/.test(await page.getByTestId('rh-ai-summary').textContent()));
  check('ResearchHub: AI summary is saved for the owner', sql(`select count(*) from rh_ai_summaries where project_id='${rhId}'`) === '1');
  await shot(page, '31-rh-summary');
  await page.getByRole('tab', { name: 'Individual responses' }).click();
  await page.locator('table tbody tr').nth(3).waitFor({ timeout: 8000 }).catch(() => {});
  const rhRows = await page.locator('table tbody tr').count();
  check('ResearchHub: individual responses tab keeps the table', rhRows === 4, `${rhRows} rows`);
  await page.goto(`${APP}/research/${rhId}/report`);
  await page.getByTestId('rh-report').waitFor();
  const rep = await page.getByTestId('rh-report').textContent();
  check('ResearchHub: report has findings, statistics and the AI summary', /Survey findings report/.test(rep) && /4 responses/.test(rep) && /Test summary of 4 responses/.test(rep) && (await page.getByTestId('rh-question-stats').count()) === 3);
  check('ResearchHub: report offers Save as PDF', await visible(page.getByTestId('rh-print')));
  await page.emulateMedia({ media: 'print' });
  check('ResearchHub: print view hides the toolbar', !(await page.getByTestId('rh-print').isVisible()));
  await page.emulateMedia({ media: 'screen' });
  await shot(page, '32-rh-report');

  // ResearchHub v2: consent, skip logic, Likert grid, languages, one response per device, cross-tab, coding
  await page.goto(`${APP}/research/${rhId}`);
  await page.getByLabel('Participant information').fill('This study is about study habits. Taking part is voluntary.');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 4', { exact: true }).fill('Do you use a study group?');
  page.once('dialog', (d) => d.accept());
  await page.getByLabel('Answer type').nth(3).selectOption('radio');
  await page.getByLabel('Options').nth(1).fill('Yes\nNo');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 5', { exact: true }).fill('Which study group?');
  await page.getByTestId('rh-add-condition').last().click();
  await page.getByLabel('Answer', { exact: true }).selectOption('Yes');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByLabel('Question 6', { exact: true }).fill('How do you feel about your course?');
  page.once('dialog', (d) => d.accept());
  await page.getByLabel('Answer type').nth(5).selectOption('grid');
  await page.getByLabel('Statements').fill('Lectures are clear\nAssessments are fair');
  await page.getByLabel('Add a language').fill('Twi');
  await page.getByTestId('rh-languages').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('rh-languages').getByLabel('Title').fill('Adesua ho nhwehwɛmu');
  await page.getByRole('checkbox', { name: /One response per device/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('All changes saved').waitFor();
  check('ResearchHub v2: skip logic, grid, consent and language saved', sql(`select settings->'show_if'->>'value' from rh_fields where project_id='${rhId}' and label='Which study group?'`) === 'Yes'
    && sql(`select jsonb_array_length(settings->'rows') from rh_fields where project_id='${rhId}' and type='grid'`) === '2'
    && sql(`select (consent_text is not null and one_per_device and translations->'items'->0->>'name' = 'Twi')::text from rh_projects where id='${rhId}'`) === 'true');
  await shot(page, '32b-rh-builder-v2');

  const pub2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await pub2.newPage();
  await p2.goto(`${APP}/f/${rhId}`);
  await p2.getByTestId('rh-consent').waitFor();
  check('ResearchHub v2: respondents see the information sheet before the questions', (await p2.getByTestId('rh-form-question').count()) === 0);
  await shot(p2, '32c-rh-consent-mobile');
  await p2.getByRole('button', { name: 'I agree, continue' }).click();
  await p2.getByRole('button', { name: 'Twi' }).click();
  check('ResearchHub v2: language picker shows the translation', await visible(p2.getByRole('heading', { name: 'Adesua ho nhwehwɛmu' })));
  await p2.getByRole('button', { name: 'English' }).click();
  check('ResearchHub v2: conditional question hidden until its answer is chosen', (await p2.getByTestId('rh-form-question').count()) === 5);
  await p2.getByLabel('400').check();
  await p2.getByRole('textbox', { name: /Hours of study per week/ }).fill('15');
  await p2.getByText('3', { exact: true }).click();
  await p2.getByLabel('Yes', { exact: true }).check();
  check('ResearchHub v2: conditional question appears', (await p2.getByTestId('rh-form-question').count()) === 6);
  await p2.getByRole('textbox', { name: /Which study group/ }).fill('Group A');
  await p2.getByTestId('rh-grid').getByText('Agree', { exact: true }).nth(0).click();
  await p2.getByTestId('rh-grid').getByText('Strongly agree', { exact: true }).nth(1).click();
  await shot(p2, '32d-rh-skip-grid-mobile');
  await p2.getByRole('button', { name: 'Submit' }).click();
  await p2.getByRole('heading', { name: 'Thank you!' }).waitFor();
  check('ResearchHub v2: one-per-device form offers no second response', !(await visible(p2.getByRole('button', { name: 'Submit another response' }))));
  await p2.reload();
  check('ResearchHub v2: the same device is told it already responded', await visible(p2.getByText('A response has already been submitted from this device.')));
  await pub2.close();
  const v2row = sql(`select answers::text || '|' || (consent_at is not null)::text from rh_responses where project_id='${rhId}' and answers::text like '%Group A%'`);
  check('ResearchHub v2: response stored with grid answers and consent time', /"Lectures are clear": "Agree"/.test(v2row) && /"Assessments are fair": "Strongly agree"/.test(v2row) && v2row.endsWith('|true'), v2row);

  await page.goto(`${APP}/research/${rhId}/responses`);
  await page.getByTestId('rh-filters').waitFor();
  await page.getByLabel('Filter question').selectOption({ label: 'Q1. Which level are you in?' });
  await page.getByLabel('Filter answer').selectOption('400');
  check('ResearchHub v2: filters narrow the results', /4 of 5 responses/.test(await page.getByTestId('rh-filter-count').textContent()));
  await page.getByRole('tab', { name: 'Cross-tab' }).click();
  await page.getByTestId('rh-crosstab').waitFor();
  check('ResearchHub v2: cross-tab with chi-square', /answered both questions/.test(await page.getByTestId('rh-chi').textContent()));
  await shot(page, '32e-rh-crosstab');
  await page.getByRole('tab', { name: 'Code open answers' }).click();
  await page.getByTestId('rh-code-item').first().waitFor();
  await page.getByLabel(/Add a code to response/).first().fill('peer support');
  await page.getByLabel(/Add a code to response/).first().press('Enter');
  await page.getByText('peer support', { exact: true }).waitFor();
  check('ResearchHub v2: open answers can be coded into themes', sql(`select codes::text from rh_responses where project_id='${rhId}' and answers::text like '%Group A%'`).includes('peer support'));
  await shot(page, '32f-rh-coding');

  // ResearchHub Chart Studio: MATLAB-style charts, tests and command window in the browser, plus downloads
  await page.goto(`${APP}/research/${rhId}/responses`);
  await page.getByTestId('rh-chart-this').nth(1).click();
  await page.getByTestId('rh-studio').waitFor();
  check('Chart studio: "Chart this" opens the question as a histogram', (await page.getByTestId('rh-studio-type').inputValue()) === 'histogram' && /n = 5, mean 13/.test(await page.getByTestId('rh-studio-stats').textContent()));
  await page.getByTestId('rh-studio-cmd').fill('scatter(Q2, Q3)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  await page.getByText(/Pearson correlation: r = /).waitFor();
  check('Chart studio: scatter command draws the figure with Pearson r', (await page.getByTestId('rh-studio-type').inputValue()) === 'scatter' && (await page.getByTestId('rh-studio-figure').locator('circle').count()) >= 4);
  await page.getByTestId('rh-studio-cmd').fill('mean(Q2)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  await page.getByTestId('rh-studio-cmd').fill('bar(Q1, Q3)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  await page.getByTestId('rh-studio-cmd').fill('histogram(Q9)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  const studioLog = await page.getByTestId('rh-studio-log').textContent();
  check('Chart studio: command window prints results and explains mistakes', /ans = 13/.test(studioLog) && /Undefined variable “Q9”/.test(studioLog), studioLog.slice(-300));
  check('Chart studio: grouped bars show a legend and a chi-square test', /Chi-square test of independence/.test(await page.getByTestId('rh-studio-stats').textContent()));
  await page.mouse.move(0, 0);
  await shot(page, '32g-rh-chart-studio');
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rh-studio-png').click()]);
  const pngBytes = fs.readFileSync(await pngDl.path());
  check('Chart studio: figure downloads as a PNG image', pngBytes.subarray(1, 4).toString() === 'PNG' && pngBytes.length > 5000, `${pngBytes.length} bytes`);
  const [packDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rh-studio-pack').click()]);
  const pack = unzipSync(fs.readFileSync(await packDl.path()));
  check('Chart studio: analysis pack has data, codebook and MATLAB/R/SPSS/Stata scripts',
    ['data.csv', 'codebook.csv', 'chart.m', 'chart.R', 'chart.sps', 'chart.do', 'README.txt'].every((f) => pack[f])
    && /^Response,Q1,Q2,Q3,Q4,Q5,Q6_1,Q6_2,Submitted/.test(Buffer.from(pack['data.csv']).toString()) && /readtable\("data\.csv"/.test(Buffer.from(pack['chart.m']).toString()),
    Object.keys(pack).join(','));
  const [mDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rh-studio-script-matlab').click()]);
  check('Chart studio: MATLAB script alone downloads as chart.m', mDl.suggestedFilename() === 'chart.m' && /bar\(categorical\(xCats, xCats\), values\);/.test(fs.readFileSync(await mDl.path(), 'utf8')));

  // Read-only results link for a supervisor
  await page.getByTestId('rh-share-results').click();
  await page.getByTestId('rh-results-on').click();
  await page.getByTestId('rh-results-url').waitFor();
  const resultsUrl = (await page.getByTestId('rh-results-url').inputValue()).replace(/^https?:\/\/[^/]+/, APP);
  const sup = await browser.newContext();
  const sp = await sup.newPage();
  await sp.goto(resultsUrl);
  await sp.getByTestId('rh-shared-results').waitFor();
  const shared = await sp.getByTestId('rh-shared-results').textContent();
  check('Results link: a supervisor sees the statistics without an account', /Survey results · read-only/.test(shared) && (await sp.getByTestId('rh-question-stats').count()) === 5);
  check('Results link: open-text answers are hidden by default', !shared.includes('Group A') && !/Which study group/.test(shared));
  const leak = await sp.evaluate(async ([u, k, tok]) => (await fetch(`${u}/rest/v1/rh_responses?select=*`, { headers: { apikey: k, Authorization: `Bearer ${k}` } })).text(), [STACK, fs.readFileSync('/tmp/sl-anon-key.txt', 'utf8').trim(), '']);
  check('Results link: the responses table itself stays closed to the public', leak.trim() === '[]', leak.slice(0, 120));
  await sp.getByRole('tab', { name: 'Chart studio' }).click();
  await sp.getByTestId('rh-studio-figure').waitFor();
  check('Results link: the supervisor can use the Chart studio', await visible(sp.getByTestId('rh-studio-pack')));
  await shot(sp, '32h-rh-shared-results');
  await page.getByTestId('rh-results-off').click();
  await page.getByTestId('rh-results-on').waitFor();
  await sp.reload();
  check('Results link: turning it off stops the link at once', await visible(sp.getByText(/This results link is not valid/)));
  await sup.close();
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- ResearchHub Phase 2
  // Scores, piping, random order, quotas, file + signature questions, offline collection, invitations.
  fs.rmSync('/tmp/sl-outbox.jsonl', { force: true });
  await page.goto(`${APP}/research`);
  await page.getByLabel('New questionnaire').fill('Wellbeing check');
  await page.getByRole('button', { name: 'Create questionnaire' }).click();
  await page.getByRole('heading', { name: 'Wellbeing check' }).waitFor();
  const wbId = page.url().split('/research/')[1];
  const addQ = async (n, label, type) => {
    await page.getByRole('button', { name: '+ Add question' }).click();
    await page.getByLabel(`Question ${n}`, { exact: true }).fill(label);
    if (type) await page.getByLabel('Answer type').nth(n - 1).selectOption(type);
  };
  await addQ(1, 'Which level are you in?', 'radio');
  await page.getByLabel('Options').fill('100\n200');
  await page.getByText('Required').nth(0).click();
  await addQ(2, 'Hours of sleep last night', 'number');
  await addQ(3, 'You sleep {Q2} hours. How rested do you feel?', 'scale');
  await addQ(4, 'Wellbeing score', 'calc');
  await page.getByLabel('Formula').fill('Q2 + Q3');
  await page.getByLabel('Show the score to the respondent').check();
  await addQ(5, 'Photo of your timetable', 'file');
  await addQ(6, 'Sign to confirm', 'signature');
  await page.getByTestId('rh-randomize').check();
  await page.getByTestId('rh-add-quota').click();
  await page.getByLabel('Quota 1 answer').selectOption('100');
  await page.getByLabel('Quota 1 limit').fill('1');
  check('Phase 2: formula is shown with question numbers', (await page.getByLabel('Formula').inputValue()) === 'Q2 + Q3');
  await shot(page, '35a-rh-phase2-builder');
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByTestId('rh-share-url').waitFor();
  const wbFields = Object.fromEntries(sql(`select string_agg(field_order || '=' || id::text, ',') from rh_fields where project_id='${wbId}'`).split(',').map((kv) => kv.split('=')));
  check('Phase 2: formula and piping are stored with question ids, not numbers',
    sql(`select settings->>'formula' from rh_fields where id='${wbFields[3]}'`) === `@${wbFields[1]} + @${wbFields[2]}`
    && sql(`select label from rh_fields where id='${wbFields[2]}'`).includes(`{@${wbFields[1]}}`));
  check('Phase 2: random order and quota saved', sql(`select (form_options->>'randomize_questions') || ',' || (form_options->'quotas'->0->>'limit') from rh_projects where id='${wbId}'`) === 'true,1');

  // Respondent 1: piping, live score, file and signature
  const r1c = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const r1 = await r1c.newPage();
  await r1.goto(`${APP}/f/${wbId}`);
  await r1.getByRole('heading', { name: 'Wellbeing check' }).waitFor();
  check('Phase 2: score question is not asked, the other five are', (await r1.getByTestId('rh-form-question').count()) === 5);
  await r1.getByLabel('100').check();
  await r1.getByRole('textbox', { name: /Hours of sleep/ }).fill('7');
  check('Phase 2: piping puts the earlier answer into the question', await visible(r1.getByText('You sleep 7 hours. How rested do you feel?')));
  await r1.getByTestId('rh-form-question').filter({ hasText: 'How rested' }).getByText('4', { exact: true }).click();
  check('Phase 2: the score updates as people answer', /11/.test(await r1.getByTestId('rh-score').textContent()));
  await r1.locator('input[type=file]').setInputFiles({ name: 'timetable.png', mimeType: 'image/png', buffer: fs.readFileSync('public/icon-192.png') });
  const pad = await r1.getByTestId('rh-signature').locator('canvas').boundingBox();
  await r1.mouse.move(pad.x + 20, pad.y + 40); await r1.mouse.down();
  await r1.mouse.move(pad.x + 120, pad.y + 90, { steps: 8 }); await r1.mouse.move(pad.x + 220, pad.y + 30, { steps: 8 }); await r1.mouse.up();
  await r1.getByText('Signed.').waitFor();
  await shot(r1, '35b-rh-phase2-form');
  await r1.getByRole('button', { name: 'Submit' }).click();
  await r1.getByRole('heading', { name: 'Thank you!' }).waitFor();
  check('Phase 2: respondent sees their score at the end', /Wellbeing score\s*11/.test(await r1.getByTestId('rh-final-scores').textContent()));
  await r1c.close();
  const wbRow = sql(`select answers::text from rh_responses where project_id='${wbId}'`);
  check('Phase 2: file and signature are stored privately and linked to the answer',
    sql(`select count(*) from storage.objects where bucket_id='rh-uploads' and name like '${wbId}/%'`) === '2' && /timetable\.png/.test(wbRow) && /signature\.png/.test(wbRow));
  check('Phase 2: the score itself is not stored (it is worked out from the answers)', !wbRow.includes(wbFields[3]));
  const anonList = await page.evaluate(async ([u, k, pfx]) => (await fetch(`${u}/storage/v1/object/sign/rh-uploads/${pfx}`, { method: 'POST', headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: '{"expiresIn":60}' })).status,
    [STACK, fs.readFileSync('/tmp/sl-anon-key.txt', 'utf8').trim(), sql(`select name from storage.objects where bucket_id='rh-uploads' and name like '${wbId}/%' limit 1`)]);
  check('Phase 2: the public cannot open uploaded files', anonList >= 400, String(anonList));

  // Respondent 2: the "100" group is full
  const r2c = await browser.newContext();
  const r2 = await r2c.newPage();
  await r2.goto(`${APP}/f/${wbId}`);
  await r2.getByLabel('100').check();
  check('Phase 2: a full quota group is thanked straight away', await visible(r2.getByText(/already have all the responses we need from people who answered “100”/)));
  const quotaRpc = await r2.evaluate(async ([u, k, id, fid]) => (await (await fetch(`${u}/rest/v1/rpc/rh_submit_response`, { method: 'POST', headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_project_id: id, p_answers: { [fid]: '100' }, p_meta: {} }) })).text()),
    [STACK, fs.readFileSync('/tmp/sl-anon-key.txt', 'utf8').trim(), wbId, wbFields[0]]);
  check('Phase 2: the server enforces the quota too', /already have all the responses/.test(quotaRpc), quotaRpc.slice(0, 120));

  // Respondent 2 continues offline (fieldwork): the answer waits on the device, then syncs
  await r2.getByLabel('200').check();
  await r2.getByRole('textbox', { name: /Hours of sleep/ }).fill('6');
  await r2c.setOffline(true);
  await r2.getByRole('button', { name: 'Submit' }).click();
  await r2.getByText(/Your answers are saved on this device/).waitFor();
  check('Phase 2: offline, the response is kept on the device', /1 response saved on this device/.test(await r2.getByTestId('rh-outbox').textContent()) && sql(`select count(*) from rh_responses where project_id='${wbId}'`) === '1');
  await shot(r2, '35c-rh-offline');
  await r2c.setOffline(false);
  await r2.getByText(/1 saved response sent/).waitFor({ timeout: 15000 }).catch(() => {});
  check('Phase 2: back online, it is sent automatically (once, with the time it was filled in)',
    sql(`select count(*) || ',' || count(collected_at) from rh_responses where project_id='${wbId}'`) === '2,1');
  await r2c.close();

  // Owner: scores in the statistics, files open privately, quota status
  await page.goto(`${APP}/research/${wbId}/responses`);
  await page.getByTestId('rh-question-stats').first().waitFor();
  const scoreCard = await page.getByTestId('rh-question-stats').filter({ hasText: 'Wellbeing score' }).textContent();
  check('Phase 2: the score has statistics like a number question', /Mean11/.test(scoreCard), scoreCard.slice(0, 120));
  check('Phase 2: quota progress is shown', /1 \/ 1/.test(await page.getByTestId('rh-quota-status').textContent()));
  await page.getByRole('tab', { name: 'Individual responses' }).click();
  const [filePopup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('rh-file-link').first().click()]);
  await filePopup.waitForLoadState().catch(() => {});
  check('Phase 2: the owner opens an uploaded file through a private link', /\/object\/sign\/rh-uploads\//.test(filePopup.url()), filePopup.url().slice(0, 100));
  await filePopup.close();

  // Invitations and reminders
  await page.goto(`${APP}/research/${wbId}`);
  await page.getByTestId('rh-invites-toggle').click();
  await page.getByLabel(/Add people/).fill('Ama Mensah, ama@example.com\nkofi@example.com');
  await page.getByTestId('rh-inv-add').click();
  await page.getByTestId('rh-invite-row').nth(1).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('rh-inv-send').click();
  await page.getByText(/2 invitations sent/).waitFor();
  const outbox = () => fs.readFileSync('/tmp/sl-outbox.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('Phase 2: invitations are emailed with personal links', outbox().length === 2 && outbox().every((m) => /\/f\/.+\?i=[0-9a-f-]{36}$/.test(m.link)));
  const amaLink = outbox().find((m) => m.to === 'ama@example.com').link.replace(/^https?:\/\/[^/]+/, APP);
  const ic = await browser.newContext();
  const ip = await ic.newPage();
  await ip.goto(amaLink);
  await ip.getByLabel('200').check();
  await ip.getByRole('button', { name: 'Submit' }).click();
  await ip.getByRole('heading', { name: 'Thank you!' }).waitFor();
  check('Phase 2: responding through a personal link marks the person as responded (answers stay anonymous)',
    sql(`select responded_on is not null from rh_invites where email='ama@example.com'`) === 't' && sql(`select count(*) from information_schema.columns where table_name='rh_responses' and column_name like '%invite%'`) === '0');
  await ip.goto(amaLink);
  await ip.getByLabel('200').check();
  await ip.getByRole('button', { name: 'Submit' }).click();
  check('Phase 2: a personal link can only be used once', await visible(ip.getByText(/personal link has already been used/)));
  await ic.close();
  await page.reload();
  await page.getByTestId('rh-invites-toggle').click();
  check('Phase 2: the list shows who has responded', /2 on the list · 1 responded/.test(await page.getByTestId('rh-invite-stats').textContent()));
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('rh-inv-remind').click();
  await page.getByText(/1 reminder sent/).waitFor();
  check('Phase 2: reminders go only to people who have not responded', outbox().length === 3 && outbox()[2].to === 'kofi@example.com' && outbox()[2].kind === 'reminder');
  await shot(page, '35d-rh-invitations');

  // ---------------------------------------------------------------- ResearchHub Phase 3
  // Data quality (time taken, flags, set aside), weighting and regression.
  check('Phase 3: time taken is recorded for new responses', Number(sql(`select count(duration_s) from rh_responses where project_id='${wbId}'`)) >= 1);
  const seedRows = [['200', 6, 4, 300], ['100', 7, 2, 280], ['200', 9, 5, 320], ['100', 6, 4, 310], ['200', 10, 3, 290], ['100', 4, 1, 330], ['200', 8, 3, 305], ['100', 10, 5, 20], ['200', 9, 5, 295]];
  for (const [lvl, hrs, sc, dur] of seedRows) {
    sql(`insert into rh_responses(project_id, answers, duration_s) values ('${wbId}', '${JSON.stringify({ [wbFields[0]]: lvl, [wbFields[1]]: hrs, [wbFields[2]]: sc })}'::jsonb, ${dur})`);
  }
  await page.goto(`${APP}/research/${wbId}/responses?view=clean`);
  await page.getByTestId('rh-clean').waitFor();
  const cleanText = await page.getByTestId('rh-clean').textContent();
  check('Phase 3: a response much faster than usual is flagged', /Took 20 s; the typical time is/.test(cleanText));
  check('Phase 3: identical answers are flagged as a possible duplicate', /Exactly the same answers as response #\d+/.test(cleanText));
  await page.getByTestId('rh-flag-speeder').click();
  const speeders = await page.getByTestId('rh-flag-row').count();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('rh-exclude-all').click();
  await page.getByTestId('rh-setaside-count').waitFor();
  check('Phase 3: flagged responses can be set aside (not deleted)',
    sql(`select count(*) filter (where excluded) || ',' || count(*) from rh_responses where project_id='${wbId}'`) === `${speeders},12`, `${speeders} speeders`);
  await shot(page, '36a-rh-data-quality');

  // Weighting: the level mix in the sample is not the population's
  await page.getByTestId('rh-add-weight').click();
  await page.getByLabel('Population % for 100').fill('30');
  await page.getByLabel('Population % for 200').fill('70');
  await page.getByTestId('rh-weight-summary').waitFor();
  check('Phase 3: weighting shows its design effect before it is applied', /Design effect [\d.]+/.test(await page.getByTestId('rh-weight-summary').textContent()));
  await page.getByTestId('rh-weight-save').click();
  await page.getByTestId('rh-weighting-on').waitFor();
  check('Phase 3: weighting targets are saved with the questionnaire', sql(`select analysis->'weighting'->'targets'->0->'targets'->>'200' from rh_projects where id='${wbId}'`) === '70');
  await shot(page, '36b-rh-weighting');
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByTestId('rh-weighted-status').waitFor();
  const levelCard = await page.getByTestId('rh-question-stats').filter({ hasText: 'Which level are you in?' }).textContent();
  check('Phase 3: the summary shows weighted percentages that hit the targets', /Weighted %/.test(levelCard) && /30%/.test(levelCard) && /70%/.test(levelCard), levelCard.slice(0, 160));

  // Regression
  await page.getByRole('tab', { name: 'Regression' }).click();
  await page.getByTestId('rh-regression').waitFor();
  await page.getByLabel('Outcome (what you want to explain)').selectOption({ label: 'Q4. Wellbeing score' });
  await page.getByTestId('rh-regression-summary').waitFor();
  const regText = await page.getByTestId('rh-regression-summary').textContent();
  check('Phase 3: linear regression explains the score in plain words', /Linear regression of Q4/.test(regText) && /R² =/.test(regText) && /weighted/.test(regText), regText.slice(0, 200));
  check('Phase 3: the regression table compares levels with the reference group', /Q1: “200” vs “100”/.test(await page.getByTestId('rh-regression-table').textContent()));
  const [rDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rh-regression-r').click()]);
  check('Phase 3: the model downloads as an R script with the same weights', /lm\(Q4 ~ .*weights = weight\)/.test(fs.readFileSync(await rDl.path(), 'utf8')));
  await page.getByLabel('Outcome (what you want to explain)').selectOption({ label: 'Q1. Which level are you in?' });
  await page.getByText(/Logistic regression: the chance that Q1 is “200”/).waitFor();
  check('Phase 3: a two-answer outcome gives logistic regression with odds ratios', /Odds ratio/.test(await page.getByTestId('rh-regression-table').textContent()));
  await shot(page, '36c-rh-regression');
  await page.getByRole('tab', { name: 'Chart studio' }).click();
  await page.getByTestId('rh-studio-cmd').fill('fitlm(Q1, Q3, Q4)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  check('Phase 3: regression from the command window', /Linear regression of Q4/.test(await page.getByTestId('rh-studio-log').textContent()));

  // ---------------------------------------------------------------- ResearchHub Phase 4
  // Dashboard, Word report, data link (API) and webhooks.
  await page.getByTestId('rh-studio-cmd').fill('bar(Q1)');
  await page.getByTestId('rh-studio-cmd').press('Enter');
  await page.getByTestId('rh-studio-pin').click();
  await page.getByText('Pinned to the dashboard').waitFor();
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await page.getByTestId('rh-dashboard').waitFor();
  await page.getByTestId('rh-add-tile').click();
  await page.getByLabel('Tile type').selectOption('share');
  await page.getByLabel('Tile question').selectOption('Q1');
  await page.getByLabel('Tile answer').selectOption('200');
  await page.getByLabel('Tile title').fill('Level 200');
  await page.getByTestId('rh-tile-add').click();
  await page.getByTestId('rh-tile').first().waitFor();
  check('Phase 4: a pinned chart and a headline number make the dashboard', (await page.getByTestId('rh-dashboard').locator('svg[data-testid="rh-studio-figure"]').count()) === 1
    && /Level 200\s*70%/.test(await page.getByTestId('rh-tile').first().textContent()));
  check('Phase 4: the dashboard is saved with the questionnaire', sql(`select jsonb_array_length(analysis->'dashboard') from rh_projects where id='${wbId}'`) === '2');
  await shot(page, '37a-rh-dashboard');
  const wbToken = sql(`update rh_projects set results_token = gen_random_uuid() where id='${wbId}' returning results_token`).split('\n')[0];
  const supc = await browser.newContext();
  const supp = await supc.newPage();
  await supp.goto(`${APP}/r/${wbToken}`);
  await supp.getByTestId('rh-dashboard').waitFor();
  check('Phase 4: a supervisor opening the results link lands on the dashboard', /Level 200\s*70%/.test(await supp.getByTestId('rh-dashboard').textContent()) && !(await visible(supp.getByTestId('rh-add-tile'), 1000)));
  await supc.close();

  const [docDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('rh-word-report').click()]);
  const docx = unzipSync(fs.readFileSync(await docDl.path()));
  const docXml = Buffer.from(docx['word/document.xml']).toString();
  check('Phase 4: the Word report has the results, charts and a methods note',
    docDl.suggestedFilename().endsWith('.docx') && /Results by question/.test(docXml) && /Methods note/.test(docXml) && /Which level are you in\?/.test(docXml)
    && /set aside before analysis/.test(docXml) && /weighted to known population proportions/.test(docXml)
    && Object.keys(docx).filter((n) => n.startsWith('word/media/')).length >= 3, `${Object.keys(docx).filter((n) => n.startsWith('word/media/')).length} images`);

  // Data link
  await page.getByRole('tab', { name: 'Connect' }).click();
  await page.getByLabel('Key name').fill('Sheet for supervisor');
  await page.getByTestId('rh-create-key').click();
  await page.getByTestId('rh-key-value').waitFor();
  const apiKey = await page.getByTestId('rh-key-value').inputValue();
  check('Phase 4: the key is shown once and only its hash is stored', /^rh_[0-9a-f]{64}$/.test(apiKey) && sql(`select count(*) from rh_api_keys where key_hash = encode(sha256(convert_to('${apiKey}', 'UTF8')), 'hex')`) === '1'
    && !sql(`select string_agg(prefix || key_hash, ',') from rh_api_keys`).includes(apiKey));
  check('Phase 4: a ready-made Google Sheets formula is offered', /^=IMPORTDATA\(".*\/functions\/v1\/rh-api\?key=rh_[0-9a-f]{64}&format=csv"\)$/.test(await page.getByTestId('rh-sheets-formula').textContent()));
  const apiJson = await (await fetch(`${STACK}/functions/v1/rh-api?key=${apiKey}`)).json();
  const apiCsv = await (await fetch(`${STACK}/functions/v1/rh-api?key=${apiKey}&format=csv`)).text();
  check('Phase 4: the data link returns the analysed responses as JSON and CSV',
    apiJson.responses?.length === Number(sql(`select count(*) from rh_responses where project_id='${wbId}' and not excluded`)) && apiJson.questions?.[0]?.key === 'Q1'
    && apiCsv.split('\r\n')[0].includes('Q1. Which level are you in?'), `${apiJson.responses?.length} responses`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await page.getByText('Key revoked').waitFor();
  check('Phase 4: a revoked key stops working at once', (await fetch(`${STACK}/functions/v1/rh-api?key=${apiKey}`)).status === 401);

  // Webhook: a little receiver stands in for Zapier
  const hooks = [];
  const receiver = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hooks.push({ headers: req.headers, body: b }); res.end('ok'); }); });
  await new Promise((r) => receiver.listen(5990, '127.0.0.1', r));
  await page.getByTestId('rh-hook-url').fill('http://example.com/x');
  check('Phase 4: webhook addresses must be https', await visible(page.getByText('The address must start with https://')));
  await page.getByTestId('rh-hook-url').fill('https://hook.test/catch');
  await page.getByTestId('rh-hook-save').click();
  await page.getByTestId('rh-hook-state').waitFor();
  await page.getByTestId('rh-hook-test').click();
  await page.getByText(/Test sent/).waitFor();
  const secret = sql(`select secret from rh_webhooks where project_id='${wbId}'`);
  const ping = hooks.find((h) => h.headers['x-researchhub-event'] === 'ping');
  check('Phase 4: the test ping arrives signed with the secret', !!ping && ping.headers['x-researchhub-signature'] === `sha256=${crypto.createHmac('sha256', secret).update(ping.body).digest('hex')}`);
  const wc = await browser.newContext();
  const wp = await wc.newPage();
  await wp.goto(`${APP}/f/${wbId}`);
  await wp.getByLabel('200').check();
  await wp.getByRole('textbox', { name: /Hours of sleep/ }).fill('8');
  await wp.getByRole('button', { name: 'Submit' }).click();
  await wp.getByRole('heading', { name: 'Thank you!' }).waitFor();
  await wc.close();
  for (let k = 0; k < 40 && !hooks.some((h) => h.headers['x-researchhub-event'] === 'response.created'); k++) await sleep(250);
  const created = hooks.find((h) => h.headers['x-researchhub-event'] === 'response.created');
  const payload = created ? JSON.parse(created.body) : null;
  check('Phase 4: a new response is sent to the webhook with its answers', payload?.event === 'response.created' && payload.response.answers.Q1 === '200' && payload.response.answers.Q2 === 8,
    created?.body.slice(0, 160));
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByRole('tab', { name: 'Connect' }).click();
  await page.getByTestId('rh-hook-log').waitFor();
  check('Phase 4: deliveries are logged', /Delivered \(HTTP 200\)/.test(await page.getByTestId('rh-hook-log').textContent()));
  await page.getByTestId('rh-hook-retry').click();
  await page.getByText(/^\d+ sent|^Nothing waiting/).first().waitFor();
  check('Phase 4: undelivered responses can be re-sent (older ones went out now)', hooks.filter((h) => h.headers['x-researchhub-event'] === 'response.created').length >= 2);
  await shot(page, '37b-rh-connect');
  receiver.close();

  // ---------------------------------------------------------------- Methods: PRISMA, search log, decisions, AI use
  await page.goto(`${APP}/p/${projectId}/methods`);
  await page.getByTestId('prisma-diagram').locator('svg').waitFor();
  check('Methods: PRISMA 2020 diagram is drawn from the project', /Records screened/.test(await page.getByTestId('prisma-diagram').textContent()));
  check('Methods: asks for the databases searched', /Search log/.test(await page.getByTestId('prisma-warnings').textContent()));
  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('prisma-svg').click()]);
  check('Methods: diagram downloads as SVG', fs.readFileSync(await svgDl.path(), 'utf8').includes('<svg'));
  await page.getByRole('tab', { name: 'Search log' }).click();
  await page.getByTestId('source-add').click();
  await page.getByRole('textbox', { name: 'Name' }).fill('PubMed');
  await page.getByRole('textbox', { name: 'Records found' }).fill('120');
  await page.getByRole('textbox', { name: /Search string/ }).fill('("large language model"[tiab]) AND (bias OR fairness)');
  await page.getByRole('button', { name: 'Save source' }).click();
  await page.getByTestId('source-row').first().waitFor();
  check('Methods: search source saved with its query', /PubMed/.test(await page.getByTestId('source-row').first().textContent()) && sql(`select results_count from search_sources where project_id='${projectId}'`) === '120');
  await page.getByRole('tab', { name: 'PRISMA diagram' }).click();
  await page.getByTestId('prisma-diagram').locator('svg').waitFor();
  await page.getByTestId('prisma-diagram').screenshot({ path: path.join(ART, '34-prisma.png') });
  check('Methods: diagram lists the database with its count', /PubMed \(n\s=\s120\)/.test(await page.getByTestId('prisma-diagram').textContent()));
  await page.getByRole('tab', { name: 'Decision log' }).click();
  await page.getByTestId('decision-add').click();
  await page.getByRole('textbox', { name: 'Decision' }).fill('Tier 2 studies are in scope');
  await page.getByRole('textbox', { name: 'Why' }).fill('Baseline disparity studies answer the review question.');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await page.getByTestId('decision-row').first().waitFor();
  check('Methods: protocol decision recorded with its reason', /Tier 2 studies are in scope/.test(await page.getByTestId('decision-row').first().textContent()));
  await page.getByRole('tab', { name: 'AI use' }).click();
  check('Methods: a project without AI says there is nothing to disclose', await visible(page.getByText('No AI suggestions in this project')));
  await page.goto(`${APP}/p/${bkId}/methods?tab=ai`);
  const aiUse = await visible(page.getByTestId('ai-disclosure-text'));
  check('Methods: AI use shows a disclosure paragraph', aiUse && /every inclusion and exclusion decision was made and recorded by a human reviewer/.test(await page.getByTestId('ai-disclosure-text').textContent()));
  await shot(page, '33-methods-ai');
  await page.goto(`${APP}/p/${projectId}/methods?tab=prospero`);
  await page.getByTestId('prospero').waitFor();
  const fieldText = async (key) => page.locator(`[data-testid="prospero-field"][data-key="${key}"]`).textContent();
  check('PROSPERO: searches drafted from the search log', /PubMed \(searched/.test(await page.getByRole('textbox', { name: 'Searches' }).inputValue()));
  check('PROSPERO: unknown fields are marked as needing the reviewer', /Needs you/.test(await fieldText('funding')));
  check('PROSPERO: protocol decisions listed as possible amendments', /Tier 2 studies are in scope/.test(await page.getByTestId('prospero-amendments').textContent()));
  await page.getByRole('textbox', { name: 'Country' }).fill('Ghana');
  await page.getByLabel('PROSPERO ID').fill('CRD420260000001');
  await page.getByTestId('prospero-save').click();
  await page.getByText('Saved').first().waitFor();
  check('PROSPERO: answers saved to the project', sql(`select settings->'prospero'->'answers'->>'country' from project_settings where project_id='${projectId}'`) === 'Ghana');
  await page.reload();
  await page.getByTestId('prospero').waitFor();
  check('PROSPERO: saved answers come back as the reviewer\'s text', await page.getByRole('textbox', { name: 'Country' }).inputValue() === 'Ghana' && /Your text/.test(await fieldText('country')));
  const [prDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('prospero-download').click()]);
  check('PROSPERO: full draft downloads as text', /Country\nGhana/.test(fs.readFileSync(await prDl.path(), 'utf8')));
  await shot(page, '35-prospero');
  await page.getByTestId('search-strategy-pdf').click();
  await page.getByTestId('search-strategy-doc').waitFor();
  check('Search strategy document shows each source with its full query', /\("large language model"\[tiab\]\) AND \(bias OR fairness\)/.test(await page.getByTestId('strategy-string').first().textContent()) && /Total records identified\s*120/.test(await page.getByTestId('search-strategy-doc').textContent()));
  const stratPdf = await page.pdf({ format: 'A4' });
  check('Search strategy prints to a PDF', stratPdf.subarray(0, 4).toString() === '%PDF' && stratPdf.length > 5000, `${stratPdf.length} bytes`);
  await shot(page, '37-search-strategy');
  await page.goto(`${APP}/p/${projectId}/methods/protocol`);
  await page.getByTestId('protocol-doc').waitFor();
  const protoText = await page.getByTestId('protocol-doc').textContent();
  check('Protocol document uses saved PROSPERO answers and the eligibility criteria', /Ghana/.test(protoText) && /Eligibility criteria/.test(protoText) && /CRD420260000001/.test(protoText));
  check('Protocol lists what still needs completing', /Named contact/.test(await page.getByTestId('report-missing').textContent()));
  await shot(page, '38-protocol');

  // ---------------------------------------------------------------- Team + data extraction
  const exSeq = sql(`update study_references set title_abstract_decision='include', full_text_decision='include' where id=(select id from study_references where project_id='${projectId}' and duplicate_status not in ('duplicate','merged') order by seq limit 1) returning seq`).split('\n')[0].trim();
  await page.goto(`${APP}/p/${projectId}/settings#team`);
  await page.getByLabel(/Add a co-reviewer by email/).fill('nobody@screenlab.test');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('Team: adding an email without an account explains what to do', await visible(page.getByText(/Ask them to sign up first/)));
  await page.getByLabel(/Add a co-reviewer by email/).fill('e2e-b@screenlab.test');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('team-member').nth(1).waitFor();
  check('Team: owner adds a co-reviewer by email', /e2e-b@screenlab\.test/.test(await page.getByTestId('team').textContent()));
  await page.goto(`${APP}/p/${projectId}/extraction`);
  await page.getByTestId('preset-llm-equity').click();
  await page.getByText('Extraction form ready').first().waitFor();
  await page.getByRole('tab', { name: 'Studies' }).click();
  await page.getByTestId('extraction-row').filter({ hasText: `#${exSeq}` }).click();
  await page.getByTestId('extraction-title').waitFor();
  await page.getByRole('combobox', { name: 'Tier', exact: true }).selectOption('Tier 1');
  await page.getByRole('textbox', { name: 'LLMs tested' }).fill('GPT-4o (May 2024)');
  await page.getByRole('checkbox', { name: 'Language' }).check();
  await page.getByTestId('extraction-complete').click();
  await page.getByTestId('finalise').waitFor();
  check('Extraction: own answers saved as complete', sql(`select status || ':' || (data->>'tier') || ':' || (data->'factors'->>0) from extractions where project_id='${projectId}'`) === 'complete:Tier 1:Language');
  check('Extraction: offers to finalise from a single extraction', /Only one completed extraction/.test(await page.getByTestId('finalise').textContent()));
  await page.getByTestId('final-save').click();
  await page.getByText('Final extraction saved').first().waitFor();
  check('Extraction: final version stored with its tier', sql(`select data->>'tier' from extraction_final where project_id='${projectId}'`) === 'Tier 1');
  await shot(page, '36-extraction');
  await page.goto(`${APP}/p/${projectId}/extraction?tab=agreement`);
  await page.getByTestId('agreement').waitFor();
  const [t1Dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('table1-download').click()]);
  check('Extraction: characteristics table downloads with the final answers', /Tier 1/.test(fs.readFileSync(await t1Dl.path(), 'utf8')) && /GPT-4o \(May 2024\)/.test(fs.readFileSync(await t1Dl.path(), 'utf8')));
  check('Extraction: table lists only studies with an agreed extraction by default', fs.readFileSync(await t1Dl.path(), 'utf8').trim().split('\n').length === 2);
  await page.getByTestId('pilot-report-link').click();
  await page.getByTestId('pilot-report').waitFor();
  check('Pilot report: lists each piloted study with the reviewers and agreed answers', (await page.getByTestId('pilot-study').count()) === 1 && /GPT-4o \(May 2024\)/.test(await page.getByTestId('pilot-report').textContent()));
  const [pilotDoc] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pilot-word').click()]);
  const pilotText = fs.readFileSync(await pilotDoc.path(), 'utf8');
  check('Pilot report: downloads for Word', /Studies piloted/.test(pilotText) && /GPT-4o \(May 2024\)/.test(pilotText));
  check('Pilot report: no agreement figures when no study was done by both reviewers', !/Agreement by field/.test(pilotText) && /agreement between reviewers is not calculated/.test(await page.getByTestId('pilot-summary').textContent()));
  await page.getByRole('textbox', { name: 'Pilot notes' }).fill('Clarified the LLM version field.');
  await page.getByTestId('pilot-notes-save').click();
  await page.getByText('Notes saved').first().waitFor();
  check('Pilot report: notes saved', sql(`select settings->'pilot_notes'->>'extraction' from project_settings where project_id='${projectId}'`) === 'Clarified the LLM version field.');
  await shot(page, '42-pilot-report');
  await page.goto(`${APP}/p/${projectId}/methods`);
  await page.getByTestId('prisma-diagram').locator('svg').waitFor();
  check('PRISMA: included studies split by agreed tier', /Tier 1 \(n\s=\s1\)/.test(await page.getByTestId('prisma-diagram').textContent()));

  // ---------------------------------------------------------------- Risk of bias, synthesis, GRADE, methods draft, PRISMA 2020
  await page.goto(`${APP}/p/${projectId}/risk-of-bias`);
  await page.getByTestId('preset-jbi-llm').click();
  await page.getByText('Risk of bias form ready').first().waitFor();
  await page.getByRole('tab', { name: 'Studies' }).click();
  await page.getByTestId('extraction-row').filter({ hasText: `#${exSeq}` }).click();
  await page.getByTestId('extraction-title').waitFor();
  check('Risk of bias: own extraction does not count as an appraisal', /Not started/.test(await page.getByTestId('my-status').textContent()));
  sql(`update project_settings set settings = settings || jsonb_build_object('ai_rob_drafts', jsonb_build_object((select id::text from study_references where project_id='${projectId}' and seq=${exSeq}), '{"source":"test draft","data":{"q2":"No","overall":"High"}}'::jsonb)) where project_id='${projectId}'`);
  await page.reload();
  await page.getByTestId('ai-draft-rob').waitFor();
  await page.getByTestId('ai-draft-rob').getByRole('button', { name: 'Fill empty fields from AI draft' }).click();
  check('Risk of bias: AI draft fills only empty answers and saves nothing by itself',
    await page.getByRole('combobox', { name: /^Q2\./ }).inputValue() === 'No'
    && sql(`select count(*) from extractions where project_id='${projectId}' and kind='rob'`) === '0');
  {
    const ctxCo = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const pco = await ctxCo.newPage();
    await pco.goto(`${APP}/login`);
    await pco.getByLabel('Email').fill('e2e-b@screenlab.test');
    await pco.getByLabel('Password').fill('E2e-test-password-1');
    await pco.getByRole('button', { name: 'Sign in' }).click();
    await pco.waitForURL((u) => !u.pathname.startsWith('/login'));
    await pco.goto(`${APP}/p/${projectId}/risk-of-bias/${sql(`select id from study_references where project_id='${projectId}' and seq=${exSeq}`)}`);
    await pco.getByTestId('extraction-title').waitFor();
    await pco.getByTestId('rob-form').or(pco.getByTestId('extraction-form')).first().waitFor();
    check('Risk of bias: a co-reviewer never sees the AI draft, so their appraisal stays independent', (await pco.getByTestId('ai-draft-rob').count()) === 0);
    await ctxCo.close();
  }
  await page.getByRole('combobox', { name: /^Q1\./ }).selectOption('Yes');
  await page.getByRole('combobox', { name: /^Q7\./ }).selectOption('Unclear');
  await page.getByRole('combobox', { name: 'Overall risk of bias' }).selectOption('Low');
  await page.getByTestId('extraction-complete').click();
  await page.getByTestId('finalise').waitFor();
  await page.getByTestId('final-save').click();
  await page.getByText('Final appraisal saved').first().waitFor();
  check('Risk of bias: agreed appraisal stored separately from the extraction',
    sql(`select data->>'overall' from extraction_final where project_id='${projectId}' and kind='rob'`) === 'Low'
    && sql(`select data->>'tier' from extraction_final where project_id='${projectId}' and kind='extraction'`) === 'Tier 1');
  await page.goto(`${APP}/p/${projectId}/extraction`);
  await page.getByRole('tab', { name: 'Studies' }).click();
  await page.getByTestId('extraction-row').filter({ hasText: `#${exSeq}` }).click();
  await page.getByTestId('rob-embedded').waitFor();
  check('Extraction page: shows the same study’s risk-of-bias appraisal under the extraction form',
    /Complete/.test(await page.getByTestId('rob-status').textContent())
    && await page.locator('#mine-rob-overall').inputValue() === 'Low');
  await shot(page, '36b-extraction-with-rob');
  await page.goto(`${APP}/p/${projectId}/risk-of-bias?tab=plot`);
  await page.getByTestId('rob-plot').waitFor();
  check('Risk of bias: traffic-light plot draws one dot per item and the overall judgement', (await page.getByTestId('rob-plot').locator('svg').first().locator('circle').count()) >= 10);
  const [robSvg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rob-svg').click()]);
  check('Risk of bias: plot downloads as SVG', fs.readFileSync(await robSvg.path(), 'utf8').includes('<svg'));
  await shot(page, '39-rob-plot');

  await page.goto(`${APP}/p/${projectId}/synthesis`);
  await page.getByTestId('evidence-group').first().waitFor();
  check('Synthesis: evidence table grouped by tier', /Tier: Tier 1 · 1 study/.test(await page.getByTestId('evidence-group').first().textContent()));
  const [evDoc] = await Promise.all([page.waitForEvent('download'), page.getByTestId('evidence-word').click()]);
  check('Synthesis: evidence table downloads for Word', /GPT-4o \(May 2024\)/.test(fs.readFileSync(await evDoc.path(), 'utf8')));
  await page.getByRole('tab', { name: 'Cross-tabulation' }).click();
  check('Synthesis: cross-tabulation of two fields', await visible(page.getByTestId('crosstab')));
  await page.getByRole('tab', { name: 'GRADE summary of findings' }).click();
  await page.getByTestId('grade-add').click();
  await page.getByRole('textbox', { name: 'Outcome' }).fill('Disparity in output by language');
  await page.getByRole('combobox', { name: 'Imprecision' }).selectOption('Serious');
  check('GRADE: certainty drops one level per serious concern', (await page.getByTestId('grade-certainty').textContent()) === 'Very low');
  await page.getByTestId('grade-save').click();
  await page.getByText('GRADE table saved').first().waitFor();
  check('GRADE: outcome saved', sql(`select settings->'grade'->'rows'->0->>'imprecision' from project_settings where project_id='${projectId}'`) === 'Serious');
  await shot(page, '40-grade');

  await page.goto(`${APP}/p/${projectId}/methods?tab=draft`);
  await page.getByTestId('methods-draft').waitFor();
  const draft = await page.getByRole('textbox', { name: 'Methods draft' }).inputValue();
  check('Methods draft: written from the project (search, risk-of-bias tool, GRADE)', /PubMed/.test(draft) && /adapted JBI checklist/.test(draft) && /1 main outcome was assessed with the GRADE approach/.test(draft));
  await page.getByTestId('methods-save').click();
  await page.getByText('Draft saved').first().waitFor();
  check('Methods draft: edits saved', sql(`select (settings->'methods_draft'->>'text') is not null from project_settings where project_id='${projectId}'`) === 't');
  await page.getByRole('tab', { name: 'PRISMA 2020 checklist' }).click();
  await page.getByLabel('Where item 1 is reported').fill('Title page');
  await page.getByTestId('prisma2020-save').click();
  await page.getByText('Checklist saved').first().waitFor();
  check('PRISMA 2020 checklist: locations saved', sql(`select settings->'prisma2020'->>'1' from project_settings where project_id='${projectId}'`) === 'Title page');
  await shot(page, '41-prisma2020');

  // ---------------------------------------------------------------- Delete
  await page.goto(`${APP}/p/${restoredId}/settings#delete`);
  await page.getByRole('button', { name: 'Delete this project…' }).click();
  const del = page.getByRole('button', { name: 'Permanently delete' });
  check('Delete requires typing the project title', await del.isDisabled());
  await page.getByLabel('Project title').fill('Restored E2E project');
  await del.click();
  await page.getByRole('heading', { name: 'My Systematic Reviews' }).waitFor();
  check('Project deletion removes all its data', sql(`select count(*) from study_references where project_id='${restoredId}'`) === '0');

  // ---------------------------------------------------------------- TEST 25
  if (!process.env.SKIP_LARGE) {
    await page.goto(`${APP}/projects/new`);
    await page.getByLabel('Review title').fill('Performance test — 5,000 synthetic records');
    await page.getByRole('button', { name: 'Create review' }).click();
    await page.getByRole('heading', { name: /Performance test/ }).waitFor();
    const perfId = page.url().split('/p/')[1];
    await page.goto(`${APP}/p/${perfId}/import`);
    await page.getByLabel('Reference file').setInputFiles(path.join(FX, 'large-5000.csv'));
    const tParse = Date.now();
    await page.getByRole('button', { name: 'Preview import' }).click();
    // UI must remain responsive while parsing: measure a main-thread round trip
    const lag = await page.evaluate(() => new Promise((r) => { const s = performance.now(); setTimeout(() => r(performance.now() - s), 0); }));
    await page.getByRole('heading', { name: 'Import preview' }).waitFor({ timeout: 120000 });
    const parseMs = Date.now() - tParse;
    const dupPreview = await page.locator('dt:has-text("Possible duplicates") + dd').first().textContent();
    const tImp = Date.now();
    await page.getByRole('button', { name: /^Import 5,000 references$/ }).click();
    await page.getByText(/Importing…|Detecting duplicates…/).first().waitFor();
    await shot(page, '20-large-import-progress');
    await page.getByRole('heading', { name: '✓ Import complete' }).waitFor({ timeout: 300000 });
    const impMs = Date.now() - tImp;
    check('TEST 25: Large import (5,000 records) — preview, chunked import with progress', sql(`select count(*) from study_references where project_id='${perfId}'`) === '5000',
      `parse+preview ${parseMs} ms, import+dedupe ${impMs} ms, main-thread lag ${Math.round(lag)} ms, preview duplicates ${dupPreview}`);
    check('TEST 25: Browser stays responsive during parsing (web worker)', lag < 200, `${Math.round(lag)} ms`);
    const flagged = sql(`select count(*) from study_references where project_id='${perfId}' and duplicate_status='possible'`);
    check('Performance dataset: duplicates flagged', Number(flagged) > 50, flagged);
    await shot(page, '21-large-import-done');

    await page.goto(`${APP}/p/${perfId}/screening`);
    await page.locator('#article-title').waitFor();
    let t0 = Date.now();
    await page.locator('#screen-search').fill('glimmer sepsis federated');
    await page.waitForFunction(() => /match/.test(document.querySelector('aside[aria-label="Article list"]')?.textContent ?? ''));
    await sleep(400);
    await page.locator('aside[aria-label="Article list"] [aria-busy="false"]').waitFor();
    const searchMs = Date.now() - t0 - 350;
    const matchText = await page.locator('aside[aria-label="Article list"]').getByText(/match/).first().textContent();
    check('Performance: search over 5,000 records', true, `${matchText.trim()} in ~${searchMs} ms (incl. 350 ms debounce excluded)`);
    await page.locator('#screen-search').fill('');
    await sleep(800);
    await page.keyboard.press('Escape'); // leave the search box so shortcuts apply
    const times = [];
    for (let i = 0; i < 10; i++) {
      const before = await currentTitle(page);
      t0 = Date.now();
      await page.keyboard.press(i % 2 ? 'i' : 'm');
      await page.waitForFunction((t) => document.querySelector('#article-title')?.textContent?.trim() !== t, before);
      times.push(Date.now() - t0);
    }
    await waitSaved(page);
    const saved = sql(`select count(*) from study_references where project_id='${perfId}' and title_abstract_decision is not null`);
    check('Performance: next-article time after a decision (10 decisions)', saved === '10', `median ${times.sort((a, b) => a - b)[5]} ms, max ${Math.max(...times)} ms; saved=${saved}`);
    t0 = Date.now();
    await page.locator('aside[aria-label="Article list"]').getByRole('button', { name: /Filters/ }).click();
    await page.locator('#sf-source').selectOption('PubMed');
    await page.locator('#sf-yf').fill('2020');
    await sleep(800);
    await page.locator('aside[aria-label="Article list"] [aria-busy="false"]').waitFor();
    const fText = await page.locator('aside[aria-label="Article list"]').getByText(/match/).first().textContent();
    check('Performance: filtering 5,000 records', true, `${fText.trim()} in ~${Date.now() - t0 - 350} ms`);
    await shot(page, '22-large-screening');
  }

  const relevantErrors = consoleErrors.filter((e) => !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to fetch/.test(e));
  check('No unexpected browser console errors', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' || '));
} catch (e) {
  check('Unexpected failure', false, e.stack?.split('\n').slice(0, 4).join(' / '));
  await shot(page, 'zz-failure').catch(() => {});
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

function sqlQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
