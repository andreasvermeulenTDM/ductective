# 00 — Brief · Run A: rails + knowledge base

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.
Plan of record: `Ductective-Plan-v3.md` (root). This brief covers P1.1 + P1.2 only.

## Objective

Stand up the app's rails and turn the 25-document HVAC corpus into a queryable,
citable knowledge base. At the end of Run A, a query about a light-commercial
rooftop unit returns the correct manual sections with page-accurate provenance,
and the Expo app can complete a round trip to the model on a real phone.

## In scope

- Git repo init and the layout in `Ductective-Plan-v3.md` §5.
- Expo / React Native app scaffold (iOS + Android + tablet, one codebase).
- Supabase project with pgvector; schema for KB chunks + provenance.
- Model and Voyage API wiring through a serverless function.
- A hello-world round trip: app → function → model → response rendered on device.
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
  **Gemini Flash for answer generation** (amended 4 Aug 2026 — see Amendment 1
  below), Voyage embeddings. Do not re-litigate; if one is genuinely unworkable,
  record it as an `OPEN QUESTION` rather than substituting silently.
- **Budget:** the whole prototype lives inside ~$1,000, essentially all model API.
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

- **25 PDFs on disk, 25 manifest rows, zero gaps.** *(Amended 4 Aug 2026 — see
  Amendment 2. This previously read "27 manifest rows … missing RT-SVX096C and
  04-3817", which was wrong twice over: `04-3817.pdf` was never missing, and the
  count is now 25 after the owner's prune.)*
- On-disk filenames are source names, not the manifest's `FileName` column.
  **Join on `SourceURL` basename.** `1.pdf` is the **EPA Section 608 rule**
  (`04-3817.pdf`) — corrected 4 Aug 2026, see A1. It is NOT the Mitsubishi
  handbook, and must not be renamed to one: that would attach VRF metadata to EPA
  regulatory text.
- Several 20 MB+ documents are scan-heavy; extraction will partially fail. Measure
  per-document parse quality and handle failures explicitly.
- Phase 1 answer scope is the 18 Trane + Carrier rooftop docs plus the 3 PT charts.
  Ingest the Daikin, Mitsubishi, chiller, and EPA documents but tag them out of
  scope, so retrieval precision is measured against the equipment being tested.

## Acceptance criteria

1. `git log` shows the repo initialized with the §5 layout; `HVAC Data/` and
   `.env` are gitignored and absent from history.
2. `npx expo start` runs; the app loads on a physical iOS or Android device.
3. From the device, submitting text returns **a model response** rendered on
   screen, round trip through the serverless function — no API key present in the
   client. *(Provider-neutral by amendment: the criterion is the round trip and the
   key staying server-side, neither of which depends on the vendor.)*
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
- **Voyage is live; the model key is not.** Corrected 4 Aug 2026 — an earlier
  draft of this line said both were unobtained and that criteria 7 and 8 could not
  pass. That is no longer true and would stop Knowledge doing its main job.
  - **H3 is cleared.** `embed()` calls Voyage live (`voyage-4-large`, 1024 dims,
    verified). **Criterion 7 (the 12-query retrieval smoke set) and criterion 8
    (real re-ingest cost) are both achievable now** — `embedTokensUsed()` reports
    actual tokens billed. Pass `inputType: 'document'` when ingesting and
    `'query'` when searching; mismatching them costs recall silently.
  - **H2 is open.** `complete()` is still a fail-closed stub, so criteria 2 and 3
    (the device round trip) remain blocked — and they need H7 regardless.
  - Stubs still record use in `usedMocks()`; a scored run must assert it is empty.
- Backend is thin in Run A — the function, the schema, and key handling. The
  weight of this run is on Knowledge.
- Record any `OPEN QUESTION` with a proposed default and proceed on the default.

---

## Amendment 1 — answer generation moves to Gemini Flash

*Dated 4 August 2026. Stage 0 amendment by the project owner. Appended, not edited
in place, so the artifact stays an audit trail.*

**What changes.** Answer generation moves from the Claude API to **Gemini Flash**
via Google AI Studio. **Voyage keeps embeddings. Supabase and pgvector are
unchanged. Retrieval is entirely unaffected** — the model only ever sees chunk
*text*, and vectors never leave Postgres.

**Why this is an amendment and not an `OPEN QUESTION`.** The hard constraint above
prescribes `OPEN QUESTION` for a stack element that is *genuinely unworkable*.
Claude is not unworkable — `docs/retrieval-architecture.md` §3.3 argues it is the
better technical fit, and that argument still stands and is preserved rather than
rewritten. This is an **owner's cost decision taken with the trade understood**, so
it is recorded as a dated amendment. Downstream agents should treat the stack line
above as amended, not contradicted.

**Why it was cheap to do now.** `complete()` in `lib/clients.mjs` was still a stub,
the repo had no `@anthropic-ai/sdk`, and `ANTHROPIC_API_KEY` was never set. **No
Anthropic code was ever written, so none had to be undone.**

**A control regressed, and it is written down rather than assumed.** H2 previously
required an Anthropic account spend limit. Google has no equivalent hard stop —
Cloud Billing budgets alert, they do not cut off. See `SETUP-BLOCKERS.md` H2 for
the per-key quota cap that replaces it and the free-tier ordering question.

**Criterion 3 is now provider-neutral** — "a model response", not a vendor name.
That is the durable fix: the next provider question should cost nothing here.

**Migration stories** are Addendum B of `.pipeline/02-user-stories.md` (M1–M17).
Landed so far: **M1** (secret scanning covers Google credentials) and **M2** (the
atomic key swap). **M3 is human and blocking** — no Google key exists yet, so
`complete()` remains a fail-closed stub and `npm run verify`'s `gemini` probe
correctly reports SKIP rather than a false green.

**Not affected, and should not wait:** S8–S18 and A1–A4 are blocked by none of
this. That is the critical path.

---

## Amendment 2 — the corpus is the files on disk

*Dated 4 August 2026. Owner decision. Appended, not edited in place.*

**Rule:** the PDFs present in `HVAC Data/` are the corpus. A manifest row with no
file on disk is **deleted**, not carried as a permanent unresolved gap.

Two rows were removed under it:

| Row | Why |
|---|---|
| Trane `RT-SVX096C-EN_02282025.pdf` — Foundation rooftop IOM | Source URL is HTTP 404. **In Phase 1 answer scope** — recorded as a coverage gap below. |
| Mitsubishi City Multi service handbook | No file on disk. Out of Phase 1 answer scope. |

**Result: 25 rows, 25 files, zero orphans, zero unattributed.** `npm run ingest:reconcile`
proves it, and E1.1 checks it.

### What reconciliation had to learn along the way

- **`1.pdf` is the EPA Section 608 rule (`04-3817.pdf`), not the Mitsubishi
  handbook.** Earlier drafts of this brief said the opposite and told Knowledge to
  rename it — which would have attached VRF metadata to EPA regulatory text, the
  citation-does-not-support-its-claim defect `CLAUDE.md` calls the worse of the
  two. Corrected here, in plan v3 §2, in the story map, and in the S10 story.
- **Two Daikin rows need a fallback join.** Their `SourceURL` ends in a numeric id
  rather than a filename, so a basename join can never match them, but both files
  are on disk. The fallback matches the `FileName` stem and refuses to guess when
  a stem is ambiguous. Reported explicitly, never silent.
- A3 said three rows were unresolved. It was **four** — A3 missed the second
  Daikin row. Two of the four resolve via the fallback; two were deleted.

### The coverage gap this accepts

Trane **Foundation** rooftop has no IOM in the corpus and is in Phase 1 answer
scope. Questions about that line have no source to cite. If criterion 7's smoke
set shows a Foundation-shaped miss, this is why — re-source the document rather
than tuning retrieval around it.
