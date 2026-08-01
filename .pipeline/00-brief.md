# 00 — Brief · Run A: rails + knowledge base

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.
Plan of record: `Ductective-Plan-v3.md` (root). This brief covers P1.1 + P1.2 only.

## Objective

Stand up the app's rails and turn the 25-document HVAC corpus into a queryable,
citable knowledge base. At the end of Run A, a query about a light-commercial
rooftop unit returns the correct manual sections with page-accurate provenance,
and the Expo app can complete a round trip to Claude on a real phone.

## In scope

- Git repo init and the layout in `Ductective-Plan-v3.md` §5.
- Expo / React Native app scaffold (iOS + Android + tablet, one codebase).
- Supabase project with pgvector; schema for KB chunks + provenance.
- Anthropic and Voyage API wiring through a serverless function.
- A hello-world round trip: app → function → Claude → response rendered on device.
- Full ingestion pipeline: manifest reconciliation → parse → chunk → tag → embed
  → store, idempotent and re-runnable.
- A retrieval smoke set proving the right sections come back for real queries.

## Out of scope

- Auth, billing, accounts, onboarding — Phases 2–4.
- The diagnostic reasoning core, nameplate vision, clarifying questions,
  guardrails, ranked steps (Run B).
- The real chat + camera UI, streaming, citation tap-through, history (Run C).
  The hello-world screen is a throwaway; do not invest design effort in it.

## Hard constraints

- **Stack is decided** — Expo + React Native, Supabase (Postgres + pgvector),
  Claude API, Voyage embeddings. Do not re-litigate; if one is genuinely
  unworkable, record it as an `OPEN QUESTION` rather than substituting silently.
- **Budget:** the whole prototype lives inside ~$1,000, essentially all Claude API.
  Report ingestion and embedding cost; a full re-ingest must stay under $20.
- **Solo builder, <10h/week.** Prefer boring, working, few dependencies.
- **No secrets committed.** Keys via environment; `.env` gitignored from commit one.
- **`HVAC Data/` is gitignored** — 215 MB of PDFs must never enter git history.
  The manifest is the tracked, reproducible artifact.
- **Brand assets are source of truth** (`brand/README.txt`, `brand/svg/`,
  `brand/brand-board.html`): **Outfit** (SIL OFL), dark-first, `#5CD0F5` cyan on
  `#0C1826`. Corrected 30 Jul 2026 — this line previously said Inter and pointed
  at the pre-restructure zip paths. `brand/README.txt` is authoritative per
  `CLAUDE.md`; if any other document says Inter, that document is stale.

## Corpus facts the knowledge stage must handle

- 25 PDFs on disk, 27 manifest rows. Missing: Trane `RT-SVX096C-EN_02282025.pdf`
  and EPA `04-3817.pdf`. Re-download or drop those rows — decide and record it.
- On-disk filenames are source names, not the manifest's `FileName` column.
  **Join on `SourceURL` basename.** `1.pdf` is the Mitsubishi City Multi handbook.
- Several 20 MB+ documents are scan-heavy; extraction will partially fail. Measure
  per-document parse quality and handle failures explicitly.
- Phase 1 answer scope is the 18 Trane + Carrier rooftop docs plus the 3 PT charts.
  Ingest the Daikin, Mitsubishi, chiller, and EPA documents but tag them out of
  scope, so retrieval precision is measured against the equipment being tested.

## Acceptance criteria

1. `git log` shows the repo initialized with the §5 layout; `HVAC Data/` and
   `.env` are gitignored and absent from history.
2. `npx expo start` runs; the app loads on a physical iOS or Android device.
3. From the device, submitting text returns a Claude response rendered on screen,
   round trip through the serverless function — no API key present in the client.
4. Supabase has a chunks table with pgvector and, per chunk: source document,
   page number, manufacturer, model/coverage, doc type, and `license_status`.
5. Ingestion runs end to end from a single documented command, and running it
   twice leaves the same chunk count — no duplicates.
6. Every ingested chunk resolves to a manifest row; the artifact lists every file
   excluded and why.
7. A retrieval smoke set of **at least 12 queries** across Trane Precedent and
   Carrier 48/50 faults reports, per query, the documents and pages returned and
   whether they were correct. At least 10 of 12 return the correct document, with
   the page correct on those 10.
8. The artifact states full re-ingest cost and wall-clock runtime.
9. Lint, build, and test commands run and their exact status is reported, with no
   new warnings introduced.

## Verification

Criteria 1, 5, 6, 8, 9 are machine-checkable — Stage 5 checks them with commands
and captures evidence. Criteria 2 and 3 are device-manual: Stage 5 lists them as
human-only steps rather than claiming them. Criteria 4 and 7 are checked against
the live Supabase instance and reported per-query in `025-knowledge.md`.

Stage 5.5 (eval) has **nothing to score in Run A** — there are no answers yet,
only retrieval. It should note "nothing to do" and instead stand up the scenario
set file from the top-15 fault list in `Ductective-Plan-v3.md` §3, ready for Run B.

## Notes for downstream stages

- Frontend: still **"nothing to do"** in Run A — but not because the app is empty.
  A design prototype already exists (`app/`, branch `design/app-prototype`) with a
  working chat/history UI on real Supabase persistence and **mock** answers. It is
  **not** Run C's deliverable and does not discharge any Run C criterion. Do not
  extend it, and do not treat it as Stage 4 output. The one durable piece is
  `app/theme/tokens.ts` (E6.8) — reuse it rather than defining a second palette.
- **The repo is further along than this brief's earlier drafts assume.** Already
  live and verified: the Supabase rail (pgvector 0.8.2), `sql/001_bootstrap.sql`,
  `sql/002_prototype_sessions.sql`, `npm run verify`, and `npm run verify:sessions`.
  Run those before assuming anything about the current state, and trust the working
  tree over any prose here that contradicts it.
- **Anthropic and Voyage keys are deliberately unobtained.** `lib/clients.mjs`
  stubs both, fails closed on a missing key, and records use in `usedMocks()`.
  Criterion 7 (retrieval smoke set) and criterion 8 (real cost) **cannot pass** on
  stub embeddings — do not mark them green. See `SETUP-BLOCKERS.md` H2/H3.
- Backend is thin in Run A — the function, the schema, and key handling. The
  weight of this run is on Knowledge.
- Record any `OPEN QUESTION` with a proposed default and proceed on the default.
