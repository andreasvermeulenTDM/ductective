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
