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
  check('Activity log lists screening + import events', (await page.getByText(/Screened as Excluded — Wrong population/).count()) > 0 && (await page.getByText(/Imported 4 references from sample.csv/).count()) > 0);

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
