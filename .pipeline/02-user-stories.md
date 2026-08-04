# 02 — User stories · Run A: rails + knowledge base

Stage 2 artifact for `.pipeline/00-brief.md` (Run A, P1.1 + P1.2). Scoped to Run A
only. Runs B and C have their own briefs and get their own Stage 2 passes; the
forward map for their stories lives in `docs/phase1-story-map.md`.

## Precondition — read this before starting a stage

**`.pipeline/01-research.md` does not exist.** Stage 1 has not run. These stories
are derived from `.pipeline/00-brief.md`, `Ductective-Plan-v3.md`, and the repo as
it actually stands at `4505c06` — not from a research artifact.

Recorded as `OPEN QUESTION 0` with the default: **proceed without Stage 1.** Run A's
surface area is small and now largely visible in committed code (`lib/clients.mjs`,
`sql/`, `scripts/`, `app/`), so the reconnaissance Stage 1 would produce is mostly
already on disk. Any agent that hits something these stories get wrong should
correct the story in its own artifact and say so, rather than working around it
silently.

## Current state — verified, not assumed

| Blocker | State |
|---|---|
| H1 Supabase | ✅ Live. Postgres 17.6, pgvector 0.8.2, anon key correctly refused on `ductective_health()` with 42501 |
| H2 Anthropic | ❌ **Open.** `ANTHROPIC_API_KEY` exists in `.env` but is **empty**; `lib/clients.mjs:172` throws `TODO(Stage 3)` |
| H3 Voyage | ✅ **Cleared** (894132f). Real client, `voyage-4-large`, `EMBED_DIM` 1024, live embed reported by `npm run verify` |
| H7 device | ❌ Open. Gates AC 2 and AC 3 |
| H8 corpus gaps | ❌ Open. 27 manifest rows, 25 PDFs — see S9 |

Already landed out-of-band, before any stage ran: the repo and layout (d4df171),
the Supabase rail (47ec84e), a design prototype rendering **mock** answers
(fe4b2e8), and a mockup design pass (ed6e0e7). `.pipeline/04-frontend-design-pass.md`
states in its own header that it discharges no acceptance criterion. Treat all of it
as **verify, don't redo**.

---

## Owners

| Owner | Stage | Scope |
|---|---|---|
| **Knowledge** | 2.5 | Everything between a source document and a retrievable, cited chunk — **including the chunks schema** |
| **Backend** | 3 | Non-ingestion server-side work: the function, key handling, toolchain, cost tracking |
| **Frontend** | 4 | Presentation only. Run A: the throwaway hello-world screen, nothing more |
| **Test** | 5 | Verification and the human-only step list |
| **Eval** | 5.5 | Nothing to score in Run A — stands up the scenario set instead |
| **Human** | — | H2, H7, H8 decisions, device verification |

`(machine)` = a command or test proves it · `(human)` = a person must observe it.

---

## Sequencing — what starts now

**Stage 2.5 (Knowledge) is the critical path and is now unblocked.** H3 clearing
was the gate on S13 and S16; nothing else stands between Knowledge and a full
ingest.

**Backend can start immediately on S1–S3**, none of which need a key:

| Order | Stage | Stories | Gated by |
|---|---|---|---|
| now | Backend | S1 toolchain · S2 secrets verification · S3 cost tracking | nothing |
| now | Knowledge | S8 → S9 → S10 → S11 → S12 → S13 → S14 → S15 → S16 → S17 → S18 | nothing (H3 cleared) |
| now | Eval | S20 scenario set | nothing |
| on H2 | Backend | S4 function → S5 round trip | **H2 — 5 minutes at console.anthropic.com** |
| after S12 | Backend | S6 chunks migration applied | Knowledge's schema design |
| after S5 | Frontend | S7 hello-world screen | S4 |

Backend and Knowledge run **in parallel** — they share no files. Knowledge owns
`ingest/` and the chunks schema; Backend owns the function, `scripts/`, and
`package.json`. The only handoff is S12 → S6.

**H2 is the one thing worth doing before reading further.** It is a Human task
measured in minutes, and it gates the entire Backend round-trip thread plus brief
criteria 2 and 3.

---

# Backend — startable now

### S1 — Lint, build, and test commands exist
**As a** pipeline agent, **I want** one known command per check, **so that** every
stage reports status the same way and "no new warnings" means something.
- Root `package.json` documents a lint, a build, and a test command. *(machine)*
- All three run from a clean clone and their exit status is reported. *(machine)*
- The **baseline warning count is recorded** so later stages can prove they added none. *(machine)*
- `app/` is covered too — it currently has only `start`/`android`/`ios`/`web`. *(machine)*

**Owner:** Backend · **Depends on:** — · **Priority:** Critical
**DoD:** Brief AC 9 is checkable at all. Today it is not — no lint, test, or build
command exists anywhere in the repo, so every later stage's "no new warnings" claim
would be unfalsifiable.

> Do this first. It is unblocked, it is small, and every other story's handoff
> report depends on it.

---

### S2 — Secrets stay out of the repo and the client bundle
**As a** solo builder, **I want** keys supplied by environment only, **so that** a
public mistake can't leak my Anthropic billing.
- `.env.example` lists every required variable name with no values. *(machine)* — **believed done**, verify
- No Anthropic, Voyage, or service-role key appears in any tracked file or in git history. *(machine)*
- The Expo app reads no API key at runtime; all model calls route through the serverless function. *(machine)*
- The service-role key is never exposed to the client; the anon-key privilege split proven in 47ec84e still holds after S4 lands. *(machine)*

**Owner:** Backend · **Depends on:** — · **Priority:** Critical
**DoD:** Brief AC 3's "no API key present in the client" half is provable by grep of
the built bundle, not by inspection.

---

### S3 — Ingestion and answer cost are tracked against the budget
**As a** builder on ~$1,000, **I want** spend visible as it happens, **so that** I
find out before the money is gone.
- `embedTokensUsed()` (already in `lib/clients.mjs`) is surfaced in the ingest run's output. *(machine)*
- Cumulative spend is recorded in one place, against the ~$1,000 ceiling. *(machine)*

**Owner:** Backend · **Depends on:** — · **Priority:** Medium
**DoD:** Feeds S18's cost reporting rather than duplicating it.

---

# Backend — gated on H2

### S4 — Serverless function proxies Claude
**As a** developer, **I want** one server-side entry point to the Claude API,
**so that** keys stay off the device and Runs B and C have a place to add logic.
- The `complete()` seam at `lib/clients.mjs:170` is implemented against the real API — Stage 3 replaces the function body, it does not rewire callers. *(machine)*
- A deployed function accepts a text prompt and returns a Claude completion. *(machine)*
- A missing or empty key fails with a clear error, not a stack trace — note the current `TODO` message claims "key is set but unused", which is **false today** and should be corrected. *(machine)*
- Errors return a documented shape (status + message), not a raw provider error. *(machine)*
- The request/response contract is documented in `03-backend.md` for Runs B and C. *(machine)*
- The fail-closed stub discipline survives: `ALLOW_STUBS`, the banner, and `usedMocks()` still work, so Stages 5 and 5.5 can assert no scored run touched a stub. *(machine)*

**Owner:** Backend · **Depends on:** **H2** · **Priority:** Critical
**DoD:** `npm run verify`'s `anthropic` probe passes live.

> **OPEN QUESTION 1 — where the function runs.** The brief says "serverless
> function" without naming a host. *Default:* **Supabase Edge Functions** — Supabase
> is already a hard-constraint dependency, so this adds no vendor. Note H5/H6 (Deno,
> Docker) are deferred, which affects local dev but not a hosted deploy.

---

### S5 — Hello-world round trip from a real device
**As a** builder, **I want** the whole path proven end to end, **so that** Run B
starts on rails that are known good.
- Submitting text on a physical device renders a Claude response on screen. *(human)*
- The round trip goes device → function → Claude; no direct client-to-Anthropic call appears in network logs. *(human)*
- A function failure renders a readable error state, not a blank screen. *(machine)*

**Owner:** Backend (wiring), Frontend (screen) · **Depends on:** S4, H7 · **Priority:** Critical
**DoD:** Brief AC 3. Stage 5 lists this as human-only with exact reproduction steps —
it must not claim it.

---

### S6 — The chunks migration is applied and enforced
**As the** retrieval layer, **I want** the schema Knowledge designed actually
applied, **so that** provenance is enforced at write time.
- The migration from S12 is committed under `sql/` and re-runnable from clean. *(machine)*
- `page_number` and `source_document` are `NOT NULL` — a page-less chunk is rejected by the database, not by convention. *(machine)*
- A vector index exists and a similarity query returns in reasonable time over the full corpus. *(machine)*
- Verified by attempting a page-less insert and observing the rejection. *(machine)*

**Owner:** Backend · **Depends on:** S12 · **Priority:** Critical
**DoD:** Brief AC 4's storage half.

> **Ownership correction.** `docs/phase1-story-map.md` E0.6 assigned the whole
> chunks schema to Backend. Commit 47ec84e deliberately stopped `sql/001_bootstrap.sql`
> at pgvector plus a health probe, on the reasoning that the provenance columns are
> **Stage 2.5's to design** under brief criterion 4 — pre-empting that would hand
> Knowledge someone else's guess to work around. That reasoning is right and this
> artifact follows it: **Knowledge designs (S12), Backend applies (S6).**

---

# Frontend — Run A

### S7 — Expo scaffold and the throwaway hello-world screen
**As a** technician, **I want** the app to run on my phone, **so that** the round
trip is provable on real hardware.
- `npx expo start` runs from a clean install. *(machine)* — **believed done**, verify
- The app loads on a physical iOS or Android device. *(human)*
- Outfit is loaded and rendering; tokens come from `app/theme/tokens.ts`, not per-screen hex. *(machine)* — **believed done**, verify
- Layout does not break at tablet width. *(human)*

**Owner:** Frontend · **Depends on:** S5 · **Priority:** Critical
**DoD:** Brief AC 2.

> **This is the only Frontend story in Run A.** The brief calls the hello-world
> screen a throwaway — do not invest design effort. The design prototype and mockup
> pass already on disk are Run C's concern and discharge nothing here.

---

# Knowledge — the critical path, unblocked

### S8 — Manifest reconciled against disk by source URL
**As the** knowledge base, **I want** every file provably attributed to a manifest
row, **so that** no chunk can cite a document we can't identify.
- Reconciliation joins on `SourceURL` **basename**, not the `FileName` column. *(machine)*
- Every manifest row with no file and every file with no row is reported — neither silently skipped. *(machine)*
- Against today's corpus: 27 rows, 25 PDFs, naming Trane `RT-SVX096C-EN_02282025.pdf` and EPA `04-3817.pdf` as the gaps. *(machine)*
- An unattributable file is excluded and listed with a reason. *(machine)*

**Owner:** Knowledge · **Depends on:** — · **Priority:** Critical
**DoD:** Brief AC 6's attribution half.

---

### S9 — The two orphan manifest rows are resolved
**As a** builder, **I want** an explicit decision on the missing files, **so that**
the manifest stays truthful.
- Each row is re-downloaded from its `SourceURL` or removed from `data/manifest.csv`. *(machine)*
- The decision and its reason are recorded. *(machine)*
- Reconciliation then reports zero unexplained rows. *(machine)*

**Owner:** Knowledge · **Depends on:** S8 · **Priority:** High

> **OPEN QUESTION 2.** *Default:* attempt one re-download; drop the row if the URL
> is dead. Neither document is in Phase 1 answer scope, so dropping costs nothing.

---

### S10 — Stable document identity, independent of filename
**As the** citation layer, **I want** documents keyed durably, **so that** a rename
can never produce a mis-citation.
- Each document gets a stable ID from its manifest row, not its filename. *(machine)*
- `1.pdf` resolves to the Mitsubishi City Multi handbook and is renamed. *(machine)*
- Chunks reference the ID; the title is looked up, not stored as free text per chunk. *(machine)*

**Owner:** Knowledge · **Depends on:** S8 · **Priority:** High
**DoD:** Renaming a file on disk changes no chunk's citation.

---

### S11 — Parse quality measured per document
**As a** builder, **I want** to know which documents extracted badly, **so that**
scanned pages fail loudly instead of embedding as garbage.
- An extraction-quality signal is recorded per document and per page. *(machine)*
- Documents below the bar are flagged with their score. *(machine)*
- The report identifies which 20 MB+ scan-heavy documents degraded. *(machine)*
- Nothing below the bar is silently embedded. *(machine)*

**Owner:** Knowledge · **Depends on:** S8 · **Priority:** Critical

---

### S12 — Chunking and schema design, with provenance intact
**As a** technician, **I want** citations that land on the right page, **so that** I
can verify guidance against the manual in my hand.
- The chunks schema is **designed here**: source document, page number, manufacturer, model/coverage, doc type, `license_status`, embedding (1024-dim, matching `EMBED_DIM`), and text. *(machine)*
- Every chunk carries its source document and page through chunking. *(machine)*
- A chunk spanning a page break records the page its cited text begins on. *(machine)*
- Chunk size and overlap are chosen for dense IOM text, and the choice is justified. *(machine)*
- 10 random chunks spot-checked against the PDF confirm the recorded page. *(machine)*

**Owner:** Knowledge · **Depends on:** S11 · **Priority:** Critical
**DoD:** Schema handed to Backend for S6. Zero page-less chunks possible.

> **OPEN QUESTION 3 — chunk strategy.** *Default:* Stage 2.5 picks and justifies it
> against the smoke set. Fault tables and wiring diagrams argue for structure-aware
> chunking over fixed windows.

---

### S13 — Failed extractions get an explicit disposition
**As a** builder, **I want** each parse failure resolved one way, **so that** coverage
gaps are known rather than discovered during eval.
- Every flagged document gets exactly one disposition: OCR fallback, manual exclusion, or explicit deferral with a reason. *(machine)*
- Excluded documents appear in S8's exclusion list. *(machine)*
- OCR cost and runtime, if used, fold into S18's totals. *(machine)*

**Owner:** Knowledge · **Depends on:** S11 · **Priority:** High

> **OPEN QUESTION 4 — OCR or exclude.** *Default:* exclude scan-blocked documents
> from Phase 1, **unless** the blocked set includes any of the 18 rooftop docs or 3
> PT charts — in which case OCR becomes Critical, because AC 7's 10-of-12 bar depends
> on exactly those documents. Decide this **after S11 reports**, not before.

---

### S14 — Metadata tagging, including Phase 1 answer scope
**As the** retrieval layer, **I want** scope encoded per chunk, **so that** precision
is measured against the equipment actually being tested.
- Every chunk tagged with manufacturer, model/coverage, doc type, and `license_status` from its manifest row. *(machine)*
- The 18 Trane + Carrier rooftop docs and 3 PT charts are tagged **in** Phase 1 answer scope. *(machine)*
- Daikin, Mitsubishi, chiller, and EPA documents are ingested but tagged **out** of scope. *(machine)*
- A query can filter to in-scope chunks only. *(machine)*

**Owner:** Knowledge · **Depends on:** S12 · **Priority:** Critical
**DoD:** Brief AC 4's metadata half. Tag distribution matches plan §2's grouping.

---

### S15 — Embedding with the real Voyage client
**As a** builder, **I want** embedding cost known and bounded, **so that** re-ingesting
doesn't become something I avoid doing.
- Chunks embed via the `embed()` client at `lib/clients.mjs:102`, model `voyage-4-large`, 1024 dims. *(machine)*
- Requests batch within `MAX_BATCH`; a transient failure retries rather than aborting the run. *(machine)*
- Total tokens and cost are reported from `embedTokensUsed()`. *(machine)*
- **No stub embeddings in a scored run** — `usedMocks()` is empty for any run that feeds S17. *(machine)*

**Owner:** Knowledge · **Depends on:** S14 · **Priority:** Critical
**DoD:** Full-corpus embed completes against the <$20 target.

> Unblocked by H3. Stub embeddings are deterministic — good enough for S16's
> idempotency test — but carry **no semantics**, so S17 cannot pass on them. Any
> smoke-set run must be on live embeddings.

---

### S16 — Ingestion is idempotent
**As a** builder who will re-ingest many times, **I want** re-runs to replace rather
than duplicate, **so that** the KB never quietly doubles.
- Running ingestion twice with no source change leaves the chunk count identical. *(machine)*
- Re-ingesting one document replaces exactly that document's chunks. *(machine)*
- An interrupted run re-runs to completion without manual cleanup. *(machine)*

**Owner:** Knowledge · **Depends on:** S15 · **Priority:** Critical
**DoD:** Brief AC 5, recorded with before/after counts.

---

### S17 — Retrieval contract and smoke set
**As the** Backend agent in Run B, **I want** a written query interface and measured
retrieval quality, **so that** I build against a document and not against ingestion code.
- The contract specifies query interface, returned chunk shape, every metadata field, result ordering, top-k default, scope filtering, and how a citation renders from a chunk. *(machine)*
- At least **12 queries** across Trane Precedent and Carrier 48/50 faults, drawn from the top-15 fault list. *(machine)*
- Per query: documents and pages returned, expected document, correct/incorrect verdict. *(machine)*
- At least **10 of 12** return the correct document, with the page correct on those 10. *(machine)*
- The query set is version-controlled and only grows. *(machine)*
- Out-of-scope equipment returns results flagged out of scope, or none — and the contract states how Run B should read an empty result set. *(machine)*

**Owner:** Knowledge · **Depends on:** S16 · **Priority:** Critical
**DoD:** Brief AC 7. This is the artifact's most important section — retrieval that
returns plausible-looking wrong sections is the failure mode that survives every
other check.

---

### S18 — One documented command, with cost and runtime
**As a** solo builder, **I want** ingestion to be a single command, **so that** it
stays reproducible six weekends from now.
- One documented command runs reconcile → parse → chunk → tag → embed → store. *(machine)*
- The run prints, and the artifact states, full re-ingest **cost** and **wall-clock runtime**. *(machine)*
- Full re-ingest costs under $20. *(machine)*

**Owner:** Knowledge · **Depends on:** S17 · **Priority:** Critical
**DoD:** Brief ACs 5 and 8. Command documented in the README.

---

# Test and Eval — Run A

### S19 — Human-only steps are enumerated
**As a** solo builder, **I want** every step an agent can't do in one list, **so that**
I'm never the silent blocker.
- `SETUP-BLOCKERS.md` stays current — H2 and H7 open, H1/H3/H4 cleared. *(machine)*
- Each entry states what it unblocks and what it blocks. *(machine)*
- Stage 5 appends any human-only verification it finds, and lists ACs 2 and 3 as human-only rather than claiming them. *(machine)*

**Owner:** Test · **Depends on:** — · **Priority:** High
**DoD:** Largely done already — this story is maintenance plus Stage 5's additions.

---

### S20 — Scenario set stood up from the top-15 faults
**As the** Eval agent, **I want** the scenario set to exist before the reasoning core
does, **so that** Run B is measured rather than self-assessed.
- A version-controlled scenario file covers all 15 faults from `Ductective-Plan-v3.md` §3. *(machine)*
- Each scenario records the input, what a competent tech would do, and the supporting source. *(machine)*
- The three advise-only faults are marked as hard-refusal scenarios. *(machine)*
- The set only ever grows. *(machine)*

**Owner:** Eval · **Depends on:** — · **Priority:** High
**DoD:** The brief's §Verification instruction — Stage 5.5 has nothing to score in
Run A and does this instead.

> **Unblocked, and the only open story with no key, device, or upstream dependency.**
> It has not started. It also feeds S17's query set, so doing it early pays twice.

---

# Coverage map

Every acceptance criterion in `.pipeline/00-brief.md` maps to at least one story.

| Brief AC | Stories | Verification |
|---|---|---|
| 1 — repo, §5 layout, gitignore, clean history | *(done — d4df171)*, S2 | machine |
| 2 — `npx expo start`, loads on device | S7 | machine + human |
| 3 — device round trip, no key in client | S2, S4, S5 | human |
| 4 — chunks table, pgvector, full provenance | S12, S14, S6 | machine |
| 5 — single command, idempotent | S16, S18 | machine |
| 6 — every chunk resolves to a manifest row; exclusions listed | S8, S9, S10, S13 | machine |
| 7 — ≥12 queries, ≥10 correct doc + page | S17 | machine |
| 8 — re-ingest cost and runtime stated | S15, S18, S3 | machine |
| 9 — lint/build/test status, no new warnings | S1 | machine |
| §Verification — Stage 5.5 stands up the scenario set | S20 | machine |

Reverse: every story serves a criterion except S3 and S19, which serve the budget
constraint and the human critical path. Both are cheap and named here rather than
smuggled in.

---

# Open questions

0. **Proceeding without `01-research.md`.** *Default:* proceed. Run A's surface is
   small and mostly visible in committed code. → this document
1. **Serverless function host.** *Default:* Supabase Edge Functions — no new vendor.
   H5/H6 deferred affects local dev, not a hosted deploy. → S4
2. **The two orphan manifest rows.** *Default:* one re-download attempt, then drop. → S9
3. **Chunk strategy for dense IOM text.** *Default:* Stage 2.5 decides and justifies
   against the smoke set. → S12
4. **OCR or exclude.** *Default:* exclude — **unless** the blocked set includes any
   of the 18 rooftop docs or 3 PT charts, which flips it to Critical. Decide after
   S11. → S13

---

# Flagged risk to a brief criterion

**AC 7's 10-of-12 bar is not independent of OPEN QUESTION 4.** It depends entirely
on S11's outcome. If the scan-heavy documents turn out to include Precedent or
48/50 IOMs, the bar and the OCR decision have to be revisited **together** — the
failure mode to avoid is quietly missing the bar and reporting it as a near-miss.
Raise it as a blocking question rather than absorbing it.

> **Superseded by A2 below.** Stage 1 measured the corpus: 24 of 25 documents have
> clean text layers and Trane Precedent (`RT-SVX23R`) is the cleanest document in the
> corpus at 0% low-text. AC 7 is **not** at risk from parse quality. The live risk is
> sibling-manual confusion between `48-50FC` and `48-50FE`.

---
---

# ADDENDUM A — corrections from Stage 1 research

*Dated 4 Aug 2026. Source: `.pipeline/01-research.md`. These amend stories already
written above; they are not new scope. Stage 2.5 must read these before starting.*

### A1 — `1.pdf` is the EPA Section 608 rule, not the Mitsubishi handbook
**Amends S10 (Critical), and corrects four other files.**

Stage 1 proved it five ways: `/Title` is literally `04-3817.pdf`, `/Producer` is
`Microsoft: Print To PDF`, zero `/Font` objects, US Letter geometry, and 43 pages
exactly matching the govinfo original.

- **S10's instruction to rename `1.pdf` to the Mitsubishi City Multi handbook must not be executed.** Doing so attaches Mitsubishi VRF metadata to EPA regulatory text — a citation that does not support its claim, which `CLAUDE.md:57-59` names as the worse of the two citation defects. *(machine)*
- The same error is corrected in `.pipeline/00-brief.md:54`, `Ductective-Plan-v3.md:57`, `SETUP-BLOCKERS.md:143`, and `tests/suites/e1-ingestion.mjs:17`. *(machine)*
- `1.pdf` is either replaced with the text-native EPA original (HTTP 200, verified) or excluded and listed in S8's exclusion report. *(machine)*
- The Mitsubishi City Multi handbook is confirmed present or recorded as absent — it is out of Phase 1 answer scope either way. *(machine)*

**Owner:** Knowledge · **Depends on:** — · **Priority:** Critical
**DoD:** No file in the repo still claims `1.pdf` is Mitsubishi.

### A2 — Drop the OCR branch; the real risk is column splicing
**Amends S11, S13, and OPEN QUESTION 4.**

A full `pdftotext` pass — 25 PDFs, 2,223 pages, ~1.36M tokens, 46.5s — found 24 with
clean text layers. The "low-text" Carrier pages are **vector dimensional drawings**
with nothing to OCR, not scan failures.

- OQ4's OCR branch is closed as **not needed**; S13's disposition list no longer includes an OCR fallback. *(machine)*
- S11's quality signal is repointed at the real failure: `pdftotext -layout` merges the two IOM columns onto one line, producing fluent nonsense that embeds confidently and that no flag fixes. *(machine)*
- Parsing uses **pdfplumber with column awareness**, per `retrieval-architecture.md` §2. A column-splice check runs over a sample of two-column IOM pages. *(machine)*

**Owner:** Knowledge · **Depends on:** — · **Priority:** Critical
**DoD:** No agent spends time on OCR. Column splicing is measured, not assumed absent.

### A3 — Three manifest rows are unresolved, not two
**Amends S8, S9, and OPEN QUESTION 2.**

- Row 22's `SourceURL` basename is `1929` with **no extension** — a basename join can never match it. S8's join needs an explicit fallback and this row reported, not silently dropped. *(machine)*
- **Trane `RT-SVX096C` is HTTP 404 dead and is in Phase 1 answer scope**, which falsifies OQ2's rationale ("neither is in scope, dropping costs nothing"). Re-source it from another Trane eLibrary path or record the coverage gap explicitly. *(machine)*
- S8's reconciliation reports **three** unresolved rows against 25 files. *(machine)*

**Owner:** Knowledge · **Depends on:** — · **Priority:** High
**DoD:** Every one of the 27 rows has a stated disposition.

### A4 — `usedMocks()` cannot prove a past run was stub-free
**Amends S15 and the Stage 5/5.5 assertion in `SETUP-BLOCKERS.md:59-61`.**

It is per-process module state, and Stage 5 runs in a different process than
ingestion. The assertion it is supposed to support is currently unenforceable.

- `embedding_model` is persisted **per chunk**, and Stage 5 asserts against the database rather than against process state. *(machine)*
- A chunk embedded by the stub is identifiable after the fact, from a cold start. *(machine)*

**Owner:** Knowledge (schema), Test (assertion) · **Depends on:** S12 · **Priority:** High
**DoD:** "No scored run touched a stub" is provable from the database.

---
---

# ADDENDUM B — Gemini Flash migration

*Dated 4 Aug 2026. Owner decision: answer generation moves to **Gemini Flash** via
Google AI Studio; **Voyage keeps embeddings**; Supabase/pgvector unchanged. Driver is
cost. Full analysis in the approved plan.*

## Why this is cheap now and expensive later

`complete()` at `lib/clients.mjs:170` is still a stub, `package.json` has no
`@anthropic-ai/sdk`, and `ANTHROPIC_API_KEY` is empty. **No Anthropic code was ever
written, so none has to be undone.** This lands before S4 rather than after it.

**Retrieval is entirely unaffected.** The model only ever sees chunk *text*; vectors
never leave Postgres. **S8–S18 and A1–A4 proceed in parallel and are blocked by none
of this** — that is the critical path and it should not wait.

## Amendments to existing stories

- **S4** — retitle "Serverless function proxies **the model**". The `complete()` seam criterion stands; the DoD becomes `npm run verify`'s **`gemini`** probe passing live. **OPEN QUESTION 1 is unchanged** — Supabase Edge Functions remains the host.
- **S5** — "renders a **model** response"; network-log criterion becomes "no direct client-to-provider call".
- **S2** — the criterion "no Anthropic, Voyage, or service-role key" extends to Google credentials. See M1.
- **H2 in the state table (`:25`)** — no longer an Anthropic key. See M3.

## Sequencing

| Order | Stories | Note |
|---|---|---|
| now, parallel | M1, M3, M4 | M1 must run **before** a Google key exists on the machine |
| then | M2, M5 | M2 is one commit — the tests are coupled |
| then | M11 | adapter, text only |
| **gate** | **M12** | **four numbers, three stop conditions — do not build past this** |
| then | M6 → M7 → M8 → M9 → M10 | calibrated by M12 |
| then | M13, M14 | safety |
| last | M15, M16, M17 | caching, cost, vision |

---

### M1 — Secret scanning covers Google credentials
**As a** solo builder, **I want** the verifiers to recognise a Google key, **so that**
switching providers doesn't silently disarm the check that protects me.
- `lib/secrets.mjs:20-25` gains `{ name: 'Google AI Studio key', re: /\bAIza[A-Za-z0-9_-]{30,}/ }`. Bound left open-ended per the file's existing `{8,}`/`{20,}` convention, so a format tweak cannot silently disable the rule. *(machine)*
- It also gains `{ name: 'PEM private key', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ }` — a Google service-account JSON matches none of the four current patterns and is the most damaging credential that could land in this repo. *(machine)*
- `SERVER_ONLY` (`:32-36`) gains `GEMINI_API_KEY` and **keeps `ANTHROPIC_API_KEY` through the transition** — the list is also passed as `names` to `scripts/verify-bundle.mjs:72`, so a stale variable name in the bundle stays a finding. *(machine)*
- The `sk-ant-` pattern is **kept permanently**. A stale Anthropic key committed here is still a leak. *(machine)*
- `npm run verify:secrets` is run **before any Google key exists on the machine** — `scripts/verify-secrets.mjs` walks all history, and this is the only cheap moment to discover an `AIza` string that was pasted into a scratch file months ago. *(machine)*
- Fixtures updated: `lib/secrets.test.mjs:42-50, 58-70`. Use distinct fixtures per provider so two patterns can't both fire on one string and break the `deepEqual`. *(machine)*

**Owner:** Backend · **Depends on:** — · **Priority:** Critical
**DoD:** A synthetic `AIza…` string in a tracked file or a built bundle fails the verifiers.

> **Separate defect, fix in the same pass.** `tests/suites/e0-rails.mjs:175` hardcodes
> its own `serverOnly` array, while that file's own header (12-16) says key shapes come
> from `lib/secrets.mjs` *"because two definitions of what a secret looks like drift,
> and the half that drifts is always the one nobody is running."* Import `SERVER_ONLY`.

---

### M2 — Swap the key, in one commit
**As a** pipeline agent, **I want** the rename to land atomically, **so that** the
suite isn't red between commits.
- `.env.example:27-28` becomes `GEMINI_API_KEY=` with the aistudio.google.com pointer. *(machine)*
- `SETUP-BLOCKERS.md` H2 (`:23`, `:80-83`) is rewritten for Google AI Studio. *(machine)*
- Coupled in the **same commit**, because each currently fails on the old literal: `tests/suites/e0-rails.mjs:123` (FAILs if `.env.example` stops declaring the old name), `tests/suites/e7-e8-operability.mjs:97` (FAILs unless `SETUP-BLOCKERS.md` contains the literal word "anthropic"), `tests/suites/human-only.mjs:43-49`, `scripts/verify-connection.mjs:56` (`'anthropic'` → `'gemini'`). *(machine)*
- Lint, build, and test are green at every commit boundary — currently 0 errors, 0 warnings, 28 pass. *(machine)*

**Owner:** Backend · **Depends on:** M1 · **Priority:** Critical

---

### M3 — H2 becomes a Google AI Studio key, and the lost control is recorded
**As a** solo builder on a fixed budget, **I want** the spend control gap written down,
**so that** I don't assume a protection I no longer have.
- A Google AI Studio key is obtained and set in `.env`. *(human)*
- **H2 records explicitly that a control regressed.** `SETUP-BLOCKERS.md:81-83` currently requires an Anthropic spend limit and explains why — *"an unbounded key plus a loop is how that becomes $800."* Google has no equivalent hard stop: Cloud Billing budgets **alert**, they do not cut off. The nearest control is a per-key API quota cap. Do not substitute "set a spend limit" like for like. *(machine)*
- A per-key quota cap is set, or its absence is recorded as an accepted risk. *(human)*
- Free-tier **RPM/RPD limits are verified against a 30-scenario eval run** before the free tier is planned around. If they don't survive it, the cost case is re-derived against paid pricing. *(human)*

**Owner:** Human · **Depends on:** — · **Priority:** Critical

> **Tier ordering worth reconsidering.** The stated plan is free tier once proven. The
> risk runs the other way: free tier is *safest now* — your own queries, no customers,
> throwaway data — and *riskiest later*, when traffic is real technician queries plus
> verbatim OEM content at volume, against terms that permit product-improvement use and
> human review. **Free now, paid at Phase 2** is the lower-risk ordering. Verify the
> current Gemini API Additional Terms before committing either way.

---

### M4 — Amend the contracts as a Stage 0 decision, not an agent override
**As the** project owner, **I want** the stack change recorded as an amendment,
**so that** the artifacts remain an audit trail rather than a rewritten history.
- The briefs prescribe `OPEN QUESTION` for a stack element that is *"genuinely unworkable"* (`00-brief.md:35-36`). **Claude is not unworkable** — `retrieval-architecture.md` §3.3 argues it is the better fit, and that argument still stands. This is an owner's cost decision, so it lands as a **dated Stage 0 brief amendment**, with the reason recorded, not an in-place edit. *(machine)*
- Amended in order, because each stage reads the artifact before it: `00-brief.md` (:34-37, :37 budget, :11/:18/:66) → `00-brief-run-b.md` (:79-80, :38, :83-84, :124, :173-175) → `00-brief-run-c.md` (:78, :150) → this file (S4, S5, :25, :66) → `docs/phase1-story-map.md` (:347, :405) → `Ductective-Plan-v3.md` (:13, :71, :73, :91) → `README.md:28`. *(machine)*
- **Run A AC 3 is rewritten provider-neutrally** — "a model response", not "a Gemini response". The durable fix, so the next provider question costs nothing. *(machine)*
- **One new hard constraint is added to `00-brief-run-b.md`:** *"A provider safety block is an error, never a refusal. They are different response shapes and neither may be produced by the other's code path."* It belongs there because `:70-71` already elevates "refusal ≠ error" to a hard constraint, and a provider block is a third thing that must not collapse into either. *(machine)*

**Owner:** Human (owner) · **Depends on:** — · **Priority:** Critical

---

### M5 — Supersede the retrieval architecture doc
**As a** future reader, **I want** to know what was traded away and why, **so that**
the citation design isn't re-litigated from scratch.
- `docs/retrieval-architecture.md` is **superseded by a dated successor**, not patched in place — the same discipline as `docs/plan-v2-superseded.md`. *(machine)*
- §3.3's reasoning is preserved as the record. It is correct about Anthropic; the migration is being chosen with the trade understood. *(machine)*
- The successor states plainly, because every reader will assume otherwise: **Gemini's grounding feature does not solve this.** It grounds on Google Search, not a private pgvector corpus. *(machine)*
- The stack table (`:56-61`), cost model (`:180-199`), and verification table (`:256-267`) are re-derived. The Sonnet-5 September price-rise line (`:197`) is deleted — no longer a factor. *(machine)*

**Owner:** Backend · **Depends on:** M4 · **Priority:** High

---

### M11 — Gemini adapter behind the existing seam
**As the** Backend agent, **I want** the provider swappable, **so that** the next
provider question is a config change rather than a rewrite.
- `complete()`'s exported signature at `lib/clients.mjs:170` is **unchanged**, so S4's criterion ("Stage 3 replaces the function body, it does not rewire callers") stays satisfiable. Return extends to `{text, json, model, stub, usage, finishReason, blocked}`. *(machine)*
- Implementation lives in `lib/providers/gemini.mjs`, selected by `LLM_PROVIDER`. *(machine)*
- Mapping the adapter owns: `assistant`→`model`; **`system` lifted to top-level `systemInstruction`** — functional, not cosmetic, it changes both caching and safety behaviour; `contents[].parts[]`; role-alternation merging for the clarify path; `inlineData` for vision with server-side downscaling; SSE streaming; errors normalised to S4's `{status, message}`; bounded backoff on 429/5xx. *(machine)*
- **Raw `fetch`, not `@google/genai`** — Voyage already is (`lib/clients.mjs:130`), the root has exactly one runtime dependency, `00-brief.md:39` says few dependencies, and the Edge Function needs a Deno-compatible path regardless. Recorded as a decision in the stage artifact. *(machine)*
- **Stub discipline survives byte-for-byte** — `announce()`, `usedMocks()`, `ALLOW_STUBS` (`:15-33`). Note `:25` builds its banner as `${name.toUpperCase()}_API_KEY`, so naming the stub `gemini` requires the env var be exactly `GEMINI_API_KEY`. *(machine)*
- Whether a Supabase Edge Function reliably bundles a relative import from outside `supabase/functions/` is **proven here, not assumed** — `01-research.md:775-777` flags it as unproven. *(machine)*

**Owner:** Backend · **Depends on:** M2, M3 · **Priority:** Critical
**DoD:** `npm run verify` passes live on the `gemini` probe, not stubbed. Discharges S4.

> **Surface now, don't discover in Run C:** structured JSON and streaming compose badly
> here. A partially-streamed JSON object is not an answer, and `tests/suites/human-only.mjs:55`
> forbids *"a half-rendered answer presented as complete."* Either stream only after the
> JSON validates — costing TTFT, which E6.1 targets at ≤3s — or carry a separate prose
> channel that streams while citations arrive at the end. File as an OPEN QUESTION for Run C.

---

### M12 — The measurement gate ⛔
**As a** builder, **I want** four numbers before committing to the citation design,
**so that** I find out on a throwaway harness rather than in Run B's eval.

This is a **spike, not production code** — a minimal envelope, schema, and validator,
built to be discarded. Its output calibrates M6–M8.

Run over `tests/fixtures/top-15-faults.json`, 8 real chunks from live pgvector, **on Flash**:

- **Span-verification pass rate** — fraction of emitted `quoted_span`s appearing verbatim (exact after normalisation) in the chunk they name. *(machine)*
- **Chunk-id fabrication rate** — ids outside the per-request map. *(machine)*
- **Provider block rate** on legitimate HVAC content, per `HARM_CATEGORY`, across all 15 faults including the three advise-only ones. *(machine)*
- **Real token counts** — in, out, `cachedContentTokenCount`, and the output delta attributable to spans. *(machine)*
- All four are recorded in the stage artifact **before** any M6–M10 work starts. *(machine)*

**Owner:** Backend · **Depends on:** M11 · **Priority:** Critical

> **Stop conditions — any one ends or redirects the migration:**
>
> 1. **Span verification below ~95% exact → run the same set on Pro before redesigning.**
>    Flash is a smaller model asked to copy text character-exactly across an 8-chunk
>    context, which is precisely where a smaller model drifts. If Pro clears the bar and
>    Flash doesn't, that is a **model-tier decision, not an architecture failure** — and
>    it is the single most likely outcome of this whole migration.
> 2. **Any provider block at the loosest permitted safety settings** → the provider has
>    a structural problem with this domain. That is a business decision, not an
>    engineering one.
> 3. **Per-answer cost materially above the ~$0.04 baseline** against the ~$25 eval cap
>    (`00-brief-run-b.md:83`) → per that brief's own instruction, context construction
>    gives way, not the budget.

---

### M6 — Chunk-ID envelope and prompt scaffolding
**As the** citation layer, **I want** ids the model cannot invent, **so that** a
fabricated citation is caught by lookup rather than by heuristic.
- Each retrieved chunk enters the prompt in a delimited envelope carrying a **per-request ephemeral id** (`C1`…`C8`), not the DB uuid — cheaper in tokens, and an id outside the per-request map is *unconditionally* a fabrication. *(machine)*
- The id → `{chunk_id, source_document, page_number}` map is held server-side for the life of the request. **The model never emits a page number**; we resolve it. This is structurally stronger than the Anthropic design it replaces. *(machine)*
- System instruction requires each claim to carry `chunk_id` plus a `quoted_span` copied character-for-character — no ellipsis, no re-wrapping, no paraphrase, stated min/max length; never cite an id not supplied. *(machine)*

**Owner:** Backend · **Depends on:** M12 · **Priority:** Critical

---

### M7 — Structured output replaces the regex parser
**As a** builder, **I want** structure enforced at decode time, **so that** parsing
isn't a source of defects.
- `responseMimeType: "application/json"` + `responseSchema` forcing `steps[] → {rank, action, reading_to_take, rules_in, rules_out, citations[] → {chunk_id, quoted_span}}`. *(machine)*
- **`finishReason: MAX_TOKENS` yields syntactically invalid JSON and must be an error, never a partial answer.** *(machine)*
- `responseSchema`'s supported OpenAPI subset, `propertyOrdering`, and composability with streaming are **verified against current docs**, not assumed. *(machine)*

**Owner:** Backend · **Depends on:** M6 · **Priority:** Critical

---

### M8 — The span validator
**As a** technician, **I want** every quoted span checked against its source, **so that**
a confident-sounding citation cannot be a fabrication.

This is the piece carrying the whole design.

- Both span and chunk text are **normalised identically before comparison**: NFKC, whitespace collapse, dash family (incl. soft hyphen U+00AD), quotes/apostrophes, ligatures, de-hyphenated line breaks. *(machine)*
- Exact containment after normalisation → `verified: 'exact'`. Otherwise a bounded fuzzy match → `verified: 'fuzzy'`. **Reported separately, never collapsed into "verified".** *(machine)*
- The fuzzy threshold is set from **M12's measurement**, not picked. *(machine)*
- Failure policy: one bounded repair turn quoting the failing span back; still failing → drop the claim; if dropping leaves any step uncited, the whole response becomes an explicit low-coverage error. **Run B AC 2 is *zero* uncited claims — an answer that silently sheds claims is not the same as one that met the bar.** *(machine)*
- Per-answer metrics emitted: attempted / exact / fuzzy / failed / repaired. **This metric is the machine-checkable substitute for the guarantee Anthropic gave for free**, and belongs in Stage 5 evidence. *(machine)*
- Lives in `lib/citation.mjs`, **runtime-agnostic — no `node:` builtins** — so Node scripts and the Deno Edge Function import one copy. Tests in `lib/citation.test.mjs` per the `lib/secrets.test.mjs` convention. *(machine)*
- Normaliser test cases cover the ones that actually bite this corpus: hyphenated line breaks, IOM table whitespace, en-dash ranges in PT charts. *(machine)*

**Owner:** Backend · **Depends on:** M7 · **Priority:** Critical

> **The validator needs its own ground truth.** Anthropic's `cited_text` would have
> supplied it free; going straight to Gemini means hand-labelling spans from the
> 12-query smoke set. A few hours, and it must happen **before** the fuzzy threshold is
> set — otherwise the threshold is tuned against the thing it is supposed to measure.
>
> **This flips OQ4** (`01-research.md:774-783`, "one fetch call duplicated is cheaper
> than a cross-runtime import"). Right for a fetch call, wrong for a validator: two
> copies of citation verification that drift is the one defect class the domain rules
> single out. Amend OQ4, don't override it silently.

---

### M9 — Persist the verified snippet
**As a** technician, **I want** the supporting passage stored, **so that** I can read it
without the source PDF on the device.
- `sql/003_citation_snippet.sql` adds `snippet`, `chunk_id`, and `verified text check (verified in ('exact','fuzzy'))` to the citations table at `sql/002_prototype_sessions.sql:57-66`. *(machine)*
- Every persisted citation carries a snippet that passed M8. *(machine)*

**Owner:** Backend · **Depends on:** M8 · **Priority:** High

> **Promotes OQ5** (`01-research.md:785-791`), whose default was "out of scope for Run A".
> The snippet was free under `cited_text`; it is now something we generate and pay for,
> and it is the only thing that fills the UI gap below.

---

### M10 — The citation sheet shows the passage
**As a** technician, **I want** to see the supporting text, **so that** tapping a
citation tells me something.
- `app/components/Citation.tsx:96-171` renders the persisted snippet. Its own comment at `:99-106` documents this as a `CONTRACT MISMATCH`; that comment is resolved. *(machine)*
- The `unavailable` copy is rewritten — the passage is now present even when the PDF is not. *(machine)*
- `verified: 'fuzzy'` is visually distinguishable from `'exact'`. *(machine)*
- `app/lib/supabase.ts` (`Citation` type), `app/lib/citations.ts` (`resolve()`), and `tests/fixtures/SCHEMAS.md` updated — the last per its own rule at `:6-8` ("change it here first"). *(machine)*

**Owner:** Frontend · **Depends on:** M9 · **Priority:** High

---

### M13 — Refuse before generating
**As a** technician, **I want** the safety refusal to be ours and identical every time,
**so that** rephrasing a question cannot get me a different answer.
- The hard-refusal classifier for gas/combustion, live electrical, and refrigerant handling runs **server-side ahead of the model call**. *(machine)*
- Two layers: a cheap deterministic lexical pre-filter, plus a **Flash** classification call emitting a **category enum only, never prose**. *(machine)*
- Refusal copy is deterministic across every phrasing AC 5 tries, including ones that pressure for an answer. *(eval)*
- **Opposite defaults, set deliberately and commented:** a provider block on the *classifier* counts as a refusal-category hit (fail closed); a provider block on the *answer path* is an error. *(machine)*
- `safetySettings` are set permissively on `DANGEROUS_CONTENT` — HVAC combustion, high-voltage and refrigerant content is legitimate professional material — and **recorded as a decision in the stage artifact, not a quiet constant.** Availability of the most permissive thresholds is verified, not assumed. *(machine)*

**Owner:** Backend · **Depends on:** M12 · **Priority:** Critical

> This **inverts** the risk rather than managing it: the requests most likely to trip
> `DANGEROUS_CONTENT` never reach the provider, and our copy is what AC 5 scores.

---

### M14 — A provider block can never become a refusal
**As a** builder, **I want** the two made structurally distinct, **so that** a passing
safety score means what it says.
- The adapter's normalised return type **has no refusal variant** — it cannot express one. *(machine)*
- A synthetic `finishReason: 'SAFETY'` payload yields an error carrying a `providerBlock` marker, and is asserted **never equal to the refusal shape**. *(machine)*
- **Empty text is an error, never an answer.** A blocked response can be `candidates: []` or a candidate with no parts; an empty bubble is the "blank screen" `tests/suites/human-only.mjs:55` forbids. *(machine)*
- `sql/002_prototype_sessions.sql:39` already constrains `messages.kind` to `('user','answer','clarify','refusal')` with **no `error` kind** — so a provider block must never persist as a message at all. The invariant is leaned on and stated. *(machine)*
- `blockReason`, `finishReason`, and per-category `safetyRatings` are logged on every call, and block rate is measured across `tests/fixtures/top-15-faults.json`. **A non-zero block rate on legitimate HVAC queries is a Critical.** *(machine)*
- `tests/suites/e5-safety.mjs` gains a check that no provider-block path can yield `kind:'refusal'`. *(machine)*
- **Stage 5.5 records a provider block as an invalid trial to re-run** — neither a pass nor a leak. *12 of 12 refusals where three came from Google's filter is an unmeasured run*, and it will regress silently the day the model version changes. *(eval)*

**Owner:** Backend (adapter), Eval (trial rule) · **Depends on:** M13 · **Priority:** Critical

---

### M15 — Caching becomes an observed effect, not a control
**As a** builder, **I want** the caching criterion to be checkable on Gemini, **so that**
it isn't quietly dropped.
- `docs/phase1-story-map.md:347` — *"Prompt caching is applied to the retrieved context block (machine)"* — **does not survive**: the cacheable prefix is supposed to be retrieved context, which differs on every query. What is actually stable is systemInstruction + schema + refusal policy + few-shot, which may sit below the minimum threshold entirely. *(machine)*
- Restated as: the request is constructed **stable-prefix-first**, and `usageMetadata.cachedContentTokenCount` is reported for every call. Both halves are checkable. *(machine)*
- Field names and thresholds verified against current docs. *(machine)*

**Owner:** Backend · **Depends on:** M12 · **Priority:** Medium

> **One thing improves.** Explicit caching makes §3.5's long-context control — classify
> equipment, load one whole manual, ~61k tokens average and ~165k largest — materially
> more attractive than it was, because a manual is *stable across many queries about the
> same unit*, which is exactly the shape explicit caching pays for.

---

### M16 — Re-derive cost, and report a distribution
**As a** builder on a fixed budget, **I want** real numbers, **so that** the $29/mo
question at Phase 3 is answerable.
- Cost is **re-derived from M12's measurements, not re-scaled** — the token counts changed, not just the rates, so a multiplier would carry a stale denominator forward. *(machine)*
- **Per-answer cost is reported as p50 and p95, not a point value**, because the repair turn gives it a distribution — matching how Run B AC 9 already asks for p50/p95 latency. *(machine)*
- **Run B AC 9's "caching on and off" is restated as three-way**: cold prefix / warm implicit hit / explicit `cachedContents` with storage amortised. There is no per-request opt-out for implicit caching on AI Studio *(verify)*, so (1) vs (2) is measured by observing cache state rather than toggling a flag. *(machine)*
- New cost lines with no prior analogue: explicit-cache storage per token-hour; vision input tokens per nameplate photo; the safety-classifier call. *(machine)*
- Recomputed: `retrieval-architecture.md:190` (~$0.04/answer), `:191` (30-scenario run), `00-brief.md:37`, `Ductective-Plan-v3.md:91`. Deleted: `:197`. *(machine)*

**Owner:** Backend · **Depends on:** M12 · **Priority:** Medium

---

### M17 — Pick the vision model on evidence
**As a** technician, **I want** the nameplate read correctly, **so that** I'm not given
guidance for the wrong unit.
- **Flash and Pro are both measured** on the 10-photo set from Run C AC 3 (Trane Precedent and Carrier 48/50, mixed lighting and angles). *(human)*
- Run B AC 7's bar — ≥8 of 10 correct — is met by the chosen model, and per-photo results are tabulated. *(human)*
- **A per-call model split is legitimate**: Flash for answers and the classifier, Pro for vision if the measurement supports it. Recorded as a decision with the numbers behind it. *(machine)*
- Inline-data request-size ceiling verified; photos downscaled server-side before send. *(machine)*

**Owner:** Backend · **Depends on:** M11 · **Priority:** High

> The 10 photos are a **human collection task that gates an acceptance criterion** —
> start collecting now, not at Run C kickoff.

---

## New OPEN QUESTIONs, each with a proposed default

6. **Span-verification failure policy.** *Default:* one repair turn, then fail the answer. → M8
7. **`safetySettings` thresholds.** *Default:* most permissive available on `DANGEROUS_CONTENT`, block rate instrumented, revisit on measurement. → M13
8. **Model per call path.** *Default:* Flash everywhere; measure Pro for vision (M17) and for spans if M12's gate trips.
9. **Free vs paid tier.** *Default:* free during POC, paid before Phase 2 traffic — the inverse of the stated sequencing, for the reason in M3.
10. **Streaming vs structured output in Run C.** *Default:* validate then stream; revisit against the ≤3s TTFT target. → M11
11. **Long-context control on explicit caching.** *Default:* yes — it is the one place the economics clearly improve. → M15

## Verify against current docs before relying on any of it

Free-tier data-usage wording and RPM/RPD limits; caching thresholds and whether implicit
caching can be disabled per-request; `usageMetadata` field names; the full
`blockReason`/`finishReason` enum sets; whether the most permissive `safetySettings`
require allowlisting; `responseSchema`'s OpenAPI subset and its composability with
streaming and tool use; inline-image size limits and image tokenisation; current Flash
and Pro pricing; `AIza` key length; `GEMINI_API_KEY` vs `GOOGLE_API_KEY` resolution;
whether Supabase Edge Functions bundle a relative import from outside `supabase/functions/`.
