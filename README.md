# ScreenLab

**Systematic Review Screening, Simplified.**

ScreenLab is a web application for screening the literature of a systematic or scoping review.
You import the references exported from your database searches, remove duplicates, screen
titles/abstracts and then full texts, record exclusion reasons, and export everything — from any
browser, including a Chromebook. Nothing needs to be installed.

> **Human decisions only.** ScreenLab never includes or excludes a record by itself. Every
> decision is made by you and stored with a timestamp and a full change history.
>
> **Your research data belongs to you.** Export CSV / JSON / RIS or a complete project backup
> at any time, and restore it later.

- **Live app:** https://screenlab-rhhas.vercel.app
- **Database:** Supabase project `screenlab` (ref `jtkhjakrylczxgrbnhyy`, London region)

---

## Contents

1. [Features](#features)
2. [Technology](#technology)
3. [One-time setup (Supabase + Vercel)](#one-time-setup)
4. [Using ScreenLab](#using-screenlab)
5. [Exporting, backup and restore](#exporting-backup-and-restore)
6. [Developing ScreenLab with Claude Code (browser only)](#developing-screenlab-with-claude-code)
7. [Testing](#testing)
8. [Known limitations](#known-limitations)
9. [Roadmap (Version 2 ideas)](#roadmap)

---

## Features

**Projects** — any number of separate review projects (systematic, scoping, literature, other),
each with its research question, inclusion/exclusion criteria, PICO/PECO fields, date range and
language.

**Import** — CSV/TSV, RIS, BibTeX and PubMed (`.nbib`) files from PubMed, Scopus, Web of
Science, Embase, CINAHL, IEEE Xplore, Google Scholar, Zotero, EndNote, Mendeley, etc., and
**`.zip` exports** (the reference file inside is opened automatically).
Common column/tag variants are recognised (`Title` / `Article Title` / `TI`, `Authors` / `AU`,
`Year` / `Publication Year` / `PY`, `Journal` / `Source title` / `JO` / `T2`, `DOI` / `DO`, …).
Files are read in a background worker (the page never freezes), and you always see a
**preview** first: records detected, records with/without titles, possible duplicates, malformed
records, invalid DOIs and fields detected. Records are never silently dropped. Every reference
keeps its **database source** and its original imported fields.

**Duplicate detection** — exact DOI, exact PMID, normalised title + year, and fuzzy title
similarity. Duplicates are only *flagged*; you decide to **merge** (most complete metadata is
kept, with an audit snapshot), **mark as duplicate**, or **keep both**. Resolutions can be undone.

**Screening** — a three-column screen (list · article · decision) designed for speed:

| Key | Action |
| --- | --- |
| `I` | Include |
| `E` | Exclude (then `1`–`9` picks a reason) |
| `M` | Maybe (title/abstract stage) |
| `N` / `P` | Next / previous article |
| `U` | Undo last decision |
| `/` | Search |
| `C` | Show review criteria |
| `?` | Shortcut help |

After each decision ScreenLab shows e.g. **“✕ Excluded — Wrong population”** with an **Undo**
button and opens the next *unscreened* article automatically. Changing an existing decision
asks for a quick confirmation. Decisions are shown with icons and words, never colour alone.

- Stage 1 — Title/abstract: Include · Exclude · Maybe
- Stage 2 — Full text (can be switched off): Include · Exclude (reason required)
- Editable exclusion-reason list, custom reasons, notes (auto-saved), tags, full-text status,
  full-text link, PDF upload (private storage)
- Filtering by status (e.g. *Maybe*) switches to **review mode**, which steps through that list
- **Multi-select:** tick records on the *References* page (or use *☑ Select* in the screening
  list), or select *all records matching the current view*, then **Include / Exclude (with a
  reason) / Maybe / Reset** them in one go. You confirm first, every record still gets its own
  audit-history entry, and the whole batch can be undone.
- **Criteria keywords** (*Settings → Criteria keywords*): list inclusion and exclusion terms —
  ScreenLab can suggest them from your written criteria for you to edit. Matches are
  highlighted in titles and abstracts (green = inclusion, red wavy = exclusion), summarised next
  to the decision buttons, counted per row on the References page, and usable as a **filter**
  (“has inclusion keywords”, “exclusion keywords but no inclusion keywords”, …). They are a
  reading and filtering aid only — they never make a decision.
- **PICO keywords** (*Settings → PICO keywords*): keywords and synonyms for each element —
  Population, Intervention/exposure, Comparator, Outcomes, Study design (*Suggest from my PICO*
  fills them from your protocol for you to edit). Each article gets a **PICO check** beside the
  decision buttons (“3 of 4 elements found — not found: Outcomes”), each element is highlighted
  in its own colour with its letter, the References page shows P I C O S per row, and the
  **PICO elements** filter finds records with all elements, at least one missing, none, or a
  specific element missing (e.g. *Population missing* → select → bulk exclude “Wrong
  population” after checking them). Empty elements are ignored. Keyword matches only — the
  decision is always yours.
- Server-side search (title, abstract, authors, journal, DOI, PMID, keywords, notes, tags),
  filters (status, database, year range, publication type, language, tags, duplicate status,
  full-text status, exclusion reason) and sorting — fast with 20 000+ records
- Works on phones and tablets: the list becomes a drawer and large decision buttons sit at
  the bottom of the screen

**Safe saving** — every change is written to your device first, then to the database, in order.
The status badge says **● Saved** only when the server has confirmed everything. If the
connection drops you see **⚠ Offline — N changes will sync when connection returns**, and the
changes are sent automatically when you are back online (also after closing the tab).

**Tracking** — dashboard with progress, statistics page with PRISMA-style counts derived from
your data (plus a manual count for records from other sources), charts of exclusion reasons,
databases and years, an append-only activity log, and a per-article decision history
(e.g. *09:42 Excluded → 09:45 Maybe → 09:51 Included*).

**Security** — Supabase Auth (email + password, password reset). Row Level Security in the
database means an account can only ever read its own projects, even if someone edits an ID in
the URL.

---

## Technology

| Part | Choice |
| --- | --- |
| Front end | React 19, TypeScript, Vite, Tailwind CSS |
| Data fetching | TanStack Query, Supabase JS client |
| Back end | Supabase: PostgreSQL (with Row Level Security), Auth, Storage |
| Hosting | Vercel (static site) |

There is no custom server: the browser talks directly to Supabase, and the database enforces
who may see what. The whole database design is in
[`supabase/migrations/`](supabase/migrations/) — run the files in date order.

Main tables: `projects`, `project_members`, `project_settings`, `study_references`
(“references” is a reserved SQL word), `screening_decisions` (append-only history),
`reviewer_decisions` (each reviewer's current decision — ready for dual screening),
`exclusion_reasons`, `tags`, `reference_tags`, `duplicate_groups`, `import_batches`,
`full_text_files`, `activity_logs`.

---

## One-time setup

The live app above is **already set up** — the Supabase database has been created and the
migration applied, and Vercel deploys the app. The steps below are what you need to finish
(steps 2–3) and how to rebuild everything from scratch if you ever need to.

### 1. Create the Supabase project *(done)*

1. Go to <https://supabase.com> → **New project**. Choose a name, a strong database password
   and a region close to you (e.g. London).
2. Wait until the project is ready.

### 2. Configure the database *(done — only needed for a new project)*

1. In Supabase open **SQL Editor → New query**.
2. Paste the entire contents of each file in `supabase/migrations/`, **in date order**
   (`20260922000001_screenlab_schema.sql`, then `20260923000001_bulk_decisions.sql`, …), and
   press **Run** for each. This creates all tables, security rules, functions and the private
   `full-texts` storage bucket. It is safe to run again.

### 3. Configure authentication *(please do this once)*

In Supabase open **Authentication**:

1. **URL Configuration**
   - **Site URL:** `https://screenlab-rhhas.vercel.app`
   - **Redirect URLs:** add `https://screenlab-rhhas.vercel.app/**`

   Without this, links in confirmation and password-reset emails point to `localhost`.
2. **Sign In / Providers → Email**: keep *Email* enabled. Choose one:
   - **Simplest:** turn **off** “Confirm email”. You can sign up and use ScreenLab immediately.
   - **Keep email confirmation on:** Supabase’s built-in email sender only delivers to members
     of your Supabase organisation and a few emails per hour. For anything else, set up
     custom SMTP under **Authentication → Emails → SMTP settings** (e.g. Resend, Brevo).
     Password-reset emails use the same sender.
3. *(Recommended for a personal tool)* After creating your own account, go to
   **Authentication → Sign In / Providers** and switch off **“Allow new users to sign up”** so
   nobody else can create accounts on your ScreenLab.

### 4. Environment variables

ScreenLab needs exactly two values, both from **Supabase → Project Settings → API** (or the
**Connect** button):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **anon / publishable** key |

The anon key is designed to be public — your data is protected by Row Level Security.
**Never** use the `service_role` / secret key in ScreenLab. See `.env.example`.

### 5. Deploy to Vercel *(done)*

1. <https://vercel.com> → **Add New… → Project** → import the GitHub repository
   `rhhas-knust/ScreenLab`. Vercel detects **Vite** automatically
   (build `npm run build`, output `dist`; `vercel.json` also routes every page to the app).
2. Under **Environment Variables** add the two variables from step 4.
3. **Deploy**. Every push to the production branch redeploys automatically.
4. If you change environment variables later, redeploy (Deployments → ⋯ → Redeploy).

### 6. Open the application

Open **https://screenlab-rhhas.vercel.app** in Chrome → **Create an account** → create your
review (or click **Try demo** to practise on 20 clearly fictional references).

---

## Using ScreenLab

1. **Create review** — title, research question, review type, inclusion/exclusion criteria
   (optional: PICO/PECO, study designs, date range, language).
2. **Import references** — Dashboard → *Import references*. Choose the file and the database
   it came from (PubMed, Scopus, … or type your own). Check the preview, then *Import*.
   Import one file per database search so your source counts stay correct.
3. **Review duplicates** — *Duplicates* page: compare records side by side, then *Merge*,
   *Mark others as duplicate* or *Keep both*.
4. **Screen titles/abstracts** — *Continue screening*. Use `I` / `E` / `M` (or the buttons).
   Open **Review criteria** (`C`) at any time. Add notes and tags in the right-hand panel.
   Tip: add **PICO keywords** in Settings first — the PICO check shows at a glance which parts
   of your question each abstract mentions, and the *PICO elements* filter groups similar records.
5. **Resolve “Maybe”s** — set the status filter to *Maybe* to step through them.
6. **Full-text screening** — switch the stage to *Full text*. Open the full-text link or
   upload the PDF, then Include / Exclude (with a reason).
7. **Track progress** — Dashboard, *Statistics* and the *Activity log*.

Tips: the progress bar counts records after duplicates are removed; untick *Automatically open
the next article* in the decision panel if you prefer to stay on an article after deciding.

---

### Moving a review from Rayyan

1. In Rayyan, export your review (CSV is best; RIS and BibTeX also work). Rayyan downloads a
   `.zip` file — you do not need to unzip it.
2. In ScreenLab either
   - go to **Projects → Import project**, choose the `.zip` and name the review — ScreenLab
     creates the project and opens the import preview with your file; or
   - create the review yourself, then **Import references** and choose the `.zip`
     (pick “Other → Rayyan” or the original database as the source).
3. The preview shows **“Rayyan screening data found”**: how many records you had included,
   excluded or marked maybe, your labels and exclusion reasons. Leave **“Continue my Rayyan
   screening”** ticked to carry them over:
   - Include / Exclude / Maybe become title/abstract decisions (history entry: “carried over
     from import”);
   - Rayyan exclusion reasons are matched to your reason list (new ones are added);
   - labels become tags, Rayyan notes become notes;
   - if several Rayyan reviewers disagreed on a record, it is left **unscreened** and the
     disagreement is written in its notes, so you can decide.
4. *Continue screening* then opens the first record you had not screened yet.

Rayyan has no separate full-text stage in its export, so carried-over decisions are placed in
the title/abstract stage; records you included move on to full-text screening as usual.

## Exporting, backup and restore

**Settings → Data export & backup** (also *Export* on the dashboard):

- **CSV** — title, authors, year, journal, DOI, PMID, abstract, database source, both
  decisions and exclusion reasons, notes, tags, duplicate status, full-text status and screening
  timestamps. Opens in Excel / Google Sheets.
- **JSON** — the same data in a machine-readable form.
- **RIS** — for Zotero, EndNote, Mendeley (decisions are added as notes; tags as keywords).
- Choose which records to export (all, after de-duplication, included, excluded, …).

**Complete project backup** — one JSON file containing the project details and criteria,
settings, all references, decisions, exclusion reasons, notes, tags, duplicate information, the
full screening history and the activity log.

**Restore** — *Projects → Import project* → choose the backup file (the same button also
accepts a Rayyan `.zip` to start a new project from it). It is restored as a **new
project** (existing projects are never overwritten). If anything goes wrong during a restore,
the half-restored project is removed automatically. Uploaded PDFs are not inside the backup
file; re-upload them if needed.

Good practice: download a project backup at the end of each screening session.

---

## Developing ScreenLab with Claude Code

Everything can be done from a browser:

1. Open <https://claude.ai/code> and start a session on the `rhhas-knust/ScreenLab` repository.
2. Ask Claude Code for changes. It can run the build and tests in its cloud environment and
   push to GitHub; Vercel then redeploys automatically.
3. Database changes go into a new file in `supabase/migrations/` and must also be run in the
   Supabase SQL editor (or applied through the Supabase connector).

Useful commands (run by Claude Code or any computer with Node.js 20+):

```bash
npm install          # install dependencies
npm run dev          # local development server (needs .env.local, see .env.example)
npm run typecheck    # TypeScript check
npm run build        # production build into dist/
npm test             # unit tests (importers, duplicate grouping)
```

Project layout:

```
src/
  lib/import/        CSV / RIS / BibTeX / MEDLINE parsers + web worker
  lib/api/           all database access (projects, references, importer, duplicates, backup…)
  lib/outbox.ts      durable save queue (offline-safe decisions and notes)
  screening/         the screening interface
  pages/             dashboard, import, references, duplicates, statistics, settings…
supabase/migrations/ database schema, security rules and functions
tests/               unit, integration and browser end-to-end tests
```

AI-ready boundaries: screening decisions only enter the database through
`record_decision()` (tagged by reviewer). A future “machine suggestion” feature should be stored
in its own table and shown separately — never written into the human decision columns.

---

## Testing

| Suite | What it covers | Command |
| --- | --- | --- |
| Unit | Importers (CSV/TSV, RIS, BibTeX, MEDLINE), field mapping, normalisation, duplicate grouping | `npm test` |
| Integration | Real database: import, dedupe, merge/reopen, decisions + audit history, undo, queue, navigation, search, filters, tags, stats, backup → restore, and Row Level Security (a second user attacking the first) | `npm run test:integration` |
| Browser end-to-end | The full workflow in Chromium (100+ checks): sign-up, sign-in/out, create review, import all formats, screening with keyboard and buttons, reasons, auto-advance, undo, notes, tags, reload, search, filters, full text + PDF, duplicates, statistics, activity, exports, backup/restore, offline & server-outage handling, cross-user access, demo, mobile (390 px) and Chromebook (1280×720) layouts, project deletion, 5 000-record import | `npm run test:e2e` |

The integration and browser tests run against a **local test stack**
(`tests/e2e/localstack/`): PostgreSQL 16 with the real migration applied plus a small
Supabase-compatible API shim, so Row Level Security is enforced by the database exactly as in
production. Start it with `npm run stack reset`, then run the Vite dev server with
`VITE_SUPABASE_URL=http://localhost:54321` and `VITE_SUPABASE_ANON_KEY=$(cat /tmp/sl-anon-key.txt)`.
The same RLS checks (`tests/e2e/localstack/rls_check.sql`) were also run against the hosted
Supabase database.

Performance (5 000 fictional records, `npm run generate:testdata`): file parsed and previewed
in < 1 s with the page staying responsive; import + duplicate detection ≈ 80 s with a progress
bar; next article after a decision ≈ 40 ms; search and filters < 0.6 s.

---

## Known limitations

- **Supabase free plan pauses inactive projects** after about a week without use. Your data is
  kept; open the Supabase dashboard and click *Restore project* (or upgrade) if ScreenLab says
  it cannot reach the server after a long break.
- **Emails** (confirmation, password reset) depend on Supabase’s email settings — see setup
  step 3.
- Uploaded **PDFs are not included in backup files**; they stay in Supabase Storage (50 MB per
  file). There is no built-in PDF reader — PDFs open in the browser’s viewer.
- **Single reviewer** in Version 1. The database already stores decisions per reviewer, but
  there is no UI for inviting reviewers, blinding or conflict resolution yet.
- Offline mode covers decisions, notes and full-text status for articles already loaded;
  imports, tags, duplicate resolution and exports need a connection.
- Duplicate detection of very large projects (20 000+ new records at once) takes a few minutes;
  keep the tab open until it finishes. It can be re-run from the Duplicates page.
- Excel `.xlsx` files are not read directly — save them as CSV first. Zip files are read, but
  not other archives (`.rar`, `.7z`).
- The statistics page provides PRISMA-style counts, not a finished PRISMA diagram.

## Roadmap

Ideas for Version 2 (not built yet):

- Dual independent screening with blinding, conflict detection and consensus
- PRISMA 2020 flow-diagram generator (SVG/PNG export) from the tracked counts
- DOI / PubMed metadata lookup to complete missing abstracts
- Zotero / EndNote integration and PubMed search import
- Optional machine suggestions (relevance ranking), shown separately from human decisions
- Built-in PDF viewer with highlights and data-extraction forms
- Automatic scheduled backups to your own storage
