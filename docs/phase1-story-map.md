# Phase 1 — Story Map

Stage 2 output, written at planning time. Decomposes **all of Phase 1** (P1.0–P1.5
of `Ductective-Plan-v3.md`) into epics and implementation-ready stories, tagged by
the agent persona that owns each one. Epics **E0–E8** are Phase 1 and are written
to be built against. A final section outlines **E9–E16** (Phases 2–4, including
both website surfaces) at intent level only — visible road, not commitment.

**Status: forward map. Run A has been promoted.** Run A's stories now live in
`.pipeline/02-user-stories.md` as S1–S20 — **that file is operative for Run A, this
one is not.** Where the two differ, the Stage 2 artifact wins; it was written
against verified repo state and this map was not. Epics 3–6 (Runs B and C) remain
a forward map pending each run's own Stage 2 pass.

---

## Owners

| Owner | Persona | Scope |
|---|---|---|
| **Knowledge** | Stage 2.5 | Everything between a source document and a retrievable, cited chunk |
| **Backend** | Stage 3 | Non-UI logic that isn't ingestion: functions, schema, API, session, prompt assembly |
| **Frontend** | Stage 4 | Presentation only |
| **Test** | Stage 5 | Verification, regression coverage, human-only step lists |
| **Eval** | Stage 5.5 | Scenario set, three-axis scoring, regression reporting |
| **Human** | Andreas | Anything an agent cannot do: device tests, external account setup, tech recruitment |

`Verification:` on each acceptance criterion is **machine** (a command or test
proves it), **human** (a person must observe it), or **eval** (Stage 5.5 scores it).

---

## Sequencing plan

| Run | Epics | Serial spine | Parallel with it |
|---|---|---|---|
| **A** | E0, E1, E2, E7.1, E8 | E0.1 → E0.2 → E0.6 → E1.1 → E1.4 → E1.6 → E1.8 → E1.9 → E2.1 → E2.3 | E0.3/E0.4/E0.5 (rails) run alongside E1; E7.1 and E8.1 any time |
| **B** | E3, E4, E5, E7.2 | E3.1 → E3.2 → E3.4 → E3.5 → E5.1 → E7.2 | E4 parallel after E3.2; E5.2 parallel with E5.1 |
| **C** | E6, E7.3, E7.5 | E6.8 → E6.1 → E6.4 → E6.6 → E7.5 | E6.2/E6.3/E6.5/E6.9 parallel after E6.1; E6.7 follows E6.8; E6.10 last |

Within Run A the hard serialization is **schema before ingestion before
retrieval** (E0.6 → E1.* → E2.*). The Expo rails thread (E0.3–E0.5) touches none
of that and should run in parallel — it is also the thread with human-only
verification, so starting it early keeps Andreas off the critical path.

E7.4 (tech recruitment) starts **now** and runs across all three runs. It is the
long pole in the plan and does not wait for a run boundary.

---

# Epic 0 — Repo & rails foundation
*P1.0 + P1.1 · Run A · unblocks everything*

### E0.1 — Repo initialized with the §5 layout
**As a** pipeline agent, **I want** a git repo with the documented layout, **so that**
the worktree/PR stages have something to branch from.
- `git log` returns at least one commit from the repo root. *(machine)*
- The tree matches `Ductective-Plan-v3.md` §5: `CLAUDE.md`, `.claude/agents/`, `.pipeline/`, `brand/`, `data/manifest.csv`, `docs/`, `HVAC Data/`, `SETUP-BLOCKERS.md`, `Ductective-Plan-v3.md`. *(machine)*
- `.gitignore` excludes `HVAC Data/` and `.env`; `git log --all --name-only | grep -E '^(HVAC Data/|\.env)'` returns nothing. *(machine)*
- Remote `andreasvermeulenTDM/ductective` is set and the first commit is pushed. *(machine)*

**Owner:** Backend · **Depends on:** — · **Priority:** Critical
**DoD:** A clean clone reproduces the layout; no PDF has ever been in history.

> **Already done by the planner outside the pipeline** (28 Jul 2026). The repo is
> initialized, the §5 layout exists, `HVAC Data/` and `.env` are gitignored, and
> `main` is pushed to `andreasvermeulenTDM/ductective`. **Verify, don't redo** —
> all four criteria are believed to pass already. Re-running the checks is cheap;
> re-initializing would discard history.

---

### E0.2 — Secrets never enter the repo or the client bundle
**As a** solo builder, **I want** keys supplied by environment only, **so that** a
public mistake can't leak my model-provider billing.
- `.env.example` lists every required variable name with no values. *(machine)*
- No model-provider or Voyage key appears in any tracked file or in the built client bundle. *(machine)*
- The Expo app reads no API key at runtime; all model calls route through the serverless function. *(machine)*

**Owner:** Backend · **Depends on:** E0.1 · **Priority:** Critical
**DoD:** Grep of the bundle and of git history for key prefixes returns nothing.

---

### E0.3 — Expo app scaffold on one codebase for phone and tablet
**As a** technician, **I want** the app to run on my iOS or Android phone and on a
tablet, **so that** I can use it on a rooftop.
- `npx expo start` launches without error from a clean install. *(machine)*
- The app loads on a physical iOS or Android device. *(human)*
- Outfit is loaded and rendering; brand tokens (`Ink #0C1826`, `CyanRead #5CD0F5`, …) are defined once from `brand/README.txt`, not re-typed per screen. *(machine)*
- Layout does not break at tablet width. *(human)*

**Owner:** Frontend · **Depends on:** E0.1 · **Priority:** Critical
**DoD:** Runs on a real device; tokens come from a single source file.

> This is the only Frontend story in Run A. Everything else Frontend-owned is Run C.
> Per the brief, the hello-world screen is throwaway — no design investment.

---

### E0.4 — Serverless function proxies the model
**As a** developer, **I want** one server-side entry point to the model API,
**so that** keys stay off the device and later runs have a place to add logic.
- A deployed function accepts a text prompt and returns a model completion. *(machine)*
- The key is read from the environment; a request with no key configured fails with a clear error rather than a stack trace. *(machine)*
- Errors return a documented shape (status + message), not a raw provider error. *(machine)*
- The request/response contract is written down for Runs B and C to build against. *(machine)*

**Owner:** Backend · **Depends on:** E0.2 · **Priority:** Critical
**DoD:** Contract documented in `.pipeline/03-backend.md`; error shape defined.

---

### E0.5 — Hello-world round trip from a real device
**As a** builder, **I want** to prove the whole path works end to end, **so that**
Run B starts on rails that are known good.
- Submitting text on a physical device renders a model response on screen. *(human)*
- The round trip goes device → function → provider; no direct client-to-provider call appears in network logs. *(human)*
- A function failure renders a readable error state, not a blank screen. *(machine)*

**Owner:** Frontend (screen), Backend (wiring) · **Depends on:** E0.3, E0.4 · **Priority:** Critical
**DoD:** Stage 5 lists this as a human-only step with the exact steps to reproduce.

---

### E0.6 — Supabase schema with pgvector and full chunk provenance
**As the** retrieval layer, **I want** a chunks table that can name its own source,
**so that** every downstream citation is possible by construction.
- Supabase project exists with the `vector` extension enabled. *(machine)*
- A `chunks` table stores, per chunk: `source_document`, `page_number`, `manufacturer`, `model_coverage`, `doc_type`, `license_status`, embedding vector, and chunk text. *(machine)*
- `page_number` and `source_document` are `NOT NULL` — a chunk that cannot name its page is rejected at write time, not tolerated. *(machine)*
- A vector index exists and a similarity query returns in reasonable time over the full corpus. *(machine)*
- The migration is committed and re-runnable from clean. *(machine)*

**Owner:** ~~Backend~~ → **Knowledge designs, Backend applies** · **Depends on:** E0.1 · **Priority:** Critical
**DoD:** Migration applied; constraints verified by attempting a page-less insert.

> **Ownership corrected.** Commit 47ec84e stopped `sql/001_bootstrap.sql` at pgvector
> plus a health probe, on the reasoning that the provenance columns are Stage 2.5's
> to design under brief criterion 4. That's right. Split into S12 (Knowledge designs
> the schema) and S6 (Backend applies the migration) in `.pipeline/02-user-stories.md`.

---

### E0.7 — Lint, build, and test commands exist and are documented
**As a** pipeline agent, **I want** one known command per check, **so that** every
stage can report status the same way.
- `README` or `package.json` documents the lint, build, and test commands. *(machine)*
- All three run from a clean clone and their exit status is reported. *(machine)*
- The baseline warning count is recorded so later stages can prove they added none. *(machine)*

**Owner:** Backend · **Depends on:** E0.3 · **Priority:** High
**DoD:** Baseline counts recorded in the Run A artifacts.

---

# Epic 1 — Corpus normalization & ingestion
*P1.2 · Run A · the weight of this run*

### E1.1 — Manifest reconciled against disk by source URL
**As the** knowledge base, **I want** every file provably attributed to a manifest
row, **so that** no chunk can cite a document we can't identify.
- Reconciliation joins on `SourceURL` **basename**, not the `FileName` column. *(machine)*
- Output lists every manifest row with no file on disk and every file with no row — neither is silently skipped. *(machine)*
- Against today's corpus the report shows 27 rows, 25 PDFs, and names the two gaps: Trane `RT-SVX096C-EN_02282025.pdf` and EPA `04-3817.pdf`. *(machine)*
- A file that cannot be attributed to a row is excluded from ingestion and listed with a reason. *(machine)*

**Owner:** Knowledge · **Depends on:** E0.1 · **Priority:** Critical
**DoD:** Reconciliation report committed; exclusion list is complete and reasoned.

---

### E1.2 — The two orphan manifest rows are resolved, not ignored
**As a** builder, **I want** an explicit decision on the missing files, **so that**
the manifest stays a truthful artifact.
- Each of the two rows is either re-downloaded from its `SourceURL` or removed from `data/manifest.csv`. *(machine)*
- The decision and its reason are recorded in `025-knowledge.md`. *(machine)*
- After the fix, reconciliation reports zero unexplained rows. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.1 · **Priority:** High
**DoD:** Manifest and disk agree, or every disagreement is documented as intentional.

> Proposed default: attempt re-download once; drop the row if the URL is dead. The
> EPA 2004 rule is out of Phase 1 answer scope either way, so dropping it costs nothing.

---

### E1.3 — Stable document identity independent of filename
**As the** citation layer, **I want** each document keyed by something durable,
**so that** a rename can never produce a mis-citation.
- Each document gets a stable ID derived from its manifest row, not its filename. *(machine)*
- ~~`1.pdf` resolves to the Mitsubishi City Multi service handbook and is renamed accordingly.~~ **SUPERSEDED by A1, 4 Aug 2026 — `1.pdf` is the EPA Section 608 rule.** *(machine)*
- Chunks reference the document ID; the human-readable title is looked up, not stored per chunk as free text. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.1 · **Priority:** High
**DoD:** Renaming a file on disk changes no chunk's citation.

---

### E1.4 — Parse quality is measured per document, not assumed
**As a** builder, **I want** to know which documents extracted badly, **so that**
scanned pages fail loudly instead of embedding as garbage.
- Parsing records an extraction-quality signal per document and per page. *(machine)*
- Documents below the quality bar are flagged in the artifact with their score. *(machine)*
- The report identifies which of the 20 MB+ scan-heavy documents degraded. *(machine)*
- Nothing below the bar is silently embedded. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.1 · **Priority:** Critical
**DoD:** Per-document quality table in `025-knowledge.md`.

---

### E1.5 — Failed extractions get an explicit disposition
**As a** builder, **I want** each parse failure resolved one way, **so that** coverage
gaps are known rather than discovered during eval.
- Every flagged document is assigned exactly one disposition: OCR fallback, manual exclusion, or explicit deferral with a reason. *(machine)*
- Excluded documents appear in the exclusion list from E1.1. *(machine)*
- If OCR is used, its cost and runtime are included in the E1.10 totals. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.4 · **Priority:** High
**DoD:** Zero flagged documents left undecided.

> Proposed default: exclude scan-only documents from Phase 1 rather than building an
> OCR path. Phase 1 answer scope is 18 rooftop docs + 3 PT charts; if none of those
> are scan-blocked, OCR is deferrable work that doesn't affect the brief's criteria.

---

### E1.6 — Chunking preserves page-accurate provenance
**As a** technician, **I want** citations that land on the right page, **so that** I
can verify guidance against the manual in my hand.
- Every chunk carries its source document and page number through chunking. *(machine)*
- A chunk spanning a page break records the page its cited text begins on. *(machine)*
- Chunk size and overlap are chosen for dense IOM text and the choice is justified. *(machine)*
- Spot-checking 10 random chunks against the PDF confirms the recorded page is correct. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.4 · **Priority:** Critical
**DoD:** Page accuracy spot-checked and reported; zero page-less chunks written.

---

### E1.7 — Metadata tagging, including Phase 1 answer scope
**As the** retrieval layer, **I want** scope encoded per chunk, **so that** precision
is measured against the equipment actually being tested.
- Every chunk is tagged with manufacturer, model/coverage, doc type, and `license_status` from its manifest row. *(machine)*
- The 18 Trane + Carrier rooftop docs and 3 PT charts are tagged in Phase 1 answer scope. *(machine)*
- Daikin, Mitsubishi, chiller, and EPA documents are ingested but tagged **out** of Phase 1 scope. *(machine)*
- A query can filter to in-scope chunks only. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.6, E0.6 · **Priority:** Critical
**DoD:** Tag distribution reported; counts match the plan's §2 grouping.

---

### E1.8 — Embedding with Voyage inside budget
**As a** builder on a $1k budget, **I want** embedding cost known and bounded,
**so that** re-ingesting doesn't become something I avoid doing.
- Chunks are embedded with the Voyage model named in the research artifact. *(machine)*
- Requests are batched; a transient failure retries rather than aborting the run. *(machine)*
- Total embedding token count and cost are reported. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.7 · **Priority:** Critical
**DoD:** Full-corpus embed completes; cost reported against the <$20 target.

---

### E1.9 — Ingestion is idempotent
**As a** builder who will re-ingest many times, **I want** re-runs to replace rather
than duplicate, **so that** the KB never quietly doubles.
- Running ingestion twice with no source change leaves the chunk count identical. *(machine)*
- Re-ingesting a single document replaces exactly that document's chunks. *(machine)*
- An interrupted run can be re-run to completion without manual cleanup. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.8 · **Priority:** Critical
**DoD:** Double-run test recorded with before/after counts.

---

### E1.10 — One documented command, with cost and runtime reported
**As a** solo builder, **I want** ingestion to be a single command, **so that** it
stays reproducible six weekends from now.
- A single documented command runs manifest reconciliation → parse → chunk → tag → embed → store. *(machine)*
- The run prints and the artifact states full re-ingest **cost** and **wall-clock runtime**. *(machine)*
- Full re-ingest cost is under $20. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.9 · **Priority:** Critical
**DoD:** Command documented in the README; cost and runtime in `025-knowledge.md`.

---

# Epic 2 — Retrieval & citation contract
*P1.2 · Run A · what Runs B and C build against*

### E2.1 — Retrieval contract is documented, not implied
**As the** Backend agent in Run B, **I want** a written query interface, **so that**
I build against a document instead of reverse-engineering ingestion code.
- The artifact specifies the query interface, returned chunk shape, every metadata field, and how a citation is rendered from a chunk. *(machine)*
- Result ordering and the top-k default are stated. *(machine)*
- Scope filtering (E1.7) is part of the documented interface. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.7 · **Priority:** Critical
**DoD:** Contract section in `025-knowledge.md` complete enough to implement against blind.

---

### E2.2 — Retrieval smoke set proves the right sections come back
**As a** builder, **I want** measured retrieval quality, **so that** plausible-looking
wrong sections get caught before they reach an answer.
- At least **12 queries** across Trane Precedent and Carrier 48/50 faults, drawn from the top-15 fault list. *(machine)*
- Per query: the documents and pages returned, the expected document, and a correct/incorrect verdict. *(machine)*
- At least **10 of 12** return the correct document, with the page correct on those 10. *(machine)*
- The query set and expectations are version-controlled, not ad hoc. *(machine)*

**Owner:** Knowledge · **Depends on:** E2.1 · **Priority:** Critical
**DoD:** Per-query results table in `025-knowledge.md`; the set grows, never shrinks.

---

### E2.3 — Out-of-scope equipment is distinguishable at retrieval time
**As a** technician, **I want** the system to know when it's outside its documentation,
**so that** Run B can refuse instead of improvising.
- A query about Daikin/Mitsubishi/chiller equipment returns results flagged out of Phase 1 scope, or none. *(machine)*
- The contract states how Run B should interpret an empty or out-of-scope result set. *(machine)*

**Owner:** Knowledge · **Depends on:** E1.7, E2.1 · **Priority:** High
**DoD:** Behavior at the coverage edge documented, with example queries.

---

# Epic 3 — Diagnostic reasoning core
*P1.3 · Run B*

### E3.1 — Symptom intake produces a structured query
**As a** technician, **I want** to describe a fault in my own words, **so that** I
don't have to learn a query syntax on a roof.
- Free-text symptom input maps to equipment, symptom class, and any stated readings. *(machine)*
- Field vocabulary is handled ("won't come on", "iced up", "tripping on high head"). *(eval)*

**Owner:** Backend · **Depends on:** E2.1 · **Priority:** Critical

---

### E3.2 — Retrieval-grounded prompt assembly with caching
**As a** builder, **I want** retrieved context assembled and cached, **so that** dense
IOM context doesn't blow the budget.
- The prompt includes retrieved chunks with their document and page metadata intact. *(machine)*
- Prompt caching is applied to the retrieved context block. *(machine)*
- Per-answer cost is measured and reported against a stated ceiling. *(machine)*

**Owner:** Backend · **Depends on:** E3.1 · **Priority:** Critical

---

### E3.3 — Clarifying questions when the symptom is underdetermined
**As a** technician, **I want** to be asked the one thing that matters, **so that**
I'm not given three branches to guess between.
- When the symptom maps to multiple causes, the system asks before answering. *(eval)*
- It asks at most a small, stated number of questions before committing to guidance. *(eval)*
- Questions request readings a tech can actually take on site. *(eval)*

**Owner:** Backend · **Depends on:** E3.2 · **Priority:** High

---

### E3.4 — Ranked diagnostic steps with readings to take
**As a** technician, **I want** steps in the order I should actually do them,
**so that** I'm not sent to the compressor before checking a filter.
- Output is an ordered list, most-likely and cheapest-to-check first. *(eval)*
- Each step states the reading to take and what the result rules in or out. *(eval)*
- Ordering is scored by Stage 5.5 — a right step in the wrong position is a partial failure. *(eval)*

**Owner:** Backend · **Depends on:** E3.2 · **Priority:** Critical

---

### E3.5 — Every claim carries a citation
**As a** technician, **I want** to see where each claim came from, **so that** I can
check it against the manual before I act.
- Every diagnostic statement carries a source document and page. *(machine)*
- An answer with an uncited claim fails, and is treated as a defect rather than a degraded response. *(machine)*
- Citations resolve to chunks that exist in the KB — no fabricated page numbers. *(machine)*
- Stage 5.5 opens each cited page and confirms it supports the claim. *(eval)*

**Owner:** Backend · **Depends on:** E3.4 · **Priority:** Critical
**DoD:** Uncited-claim detection is automated, not left to review.

---

### E3.6 — Honest behavior at the edge of coverage
**As a** technician, **I want** to be told when there's no documentation, **so that**
I don't act on something invented.
- Equipment outside the KB produces an explicit "I don't have documentation for that", not a generic answer. *(eval)*
- The response says what equipment *is* covered. *(eval)*

**Owner:** Backend · **Depends on:** E2.3, E3.4 · **Priority:** Critical

---

# Epic 4 — Nameplate vision
*P1.3 · Run B*

### E4.1 — Nameplate photo resolves to a model
**As a** technician, **I want** to photograph the nameplate instead of typing a model
number, **so that** I'm not squinting at a faded label with gloves on.
- A nameplate photo returns manufacturer and model via Claude vision. *(eval)*
- Poor lighting, glare, and angled shots are exercised as test cases. *(eval)*
- Extraction confidence is returned alongside the result. *(machine)*

**Owner:** Backend · **Depends on:** E3.1 · **Priority:** High

---

### E4.2 — Low confidence falls back to asking, not guessing
**As a** technician, **I want** to be asked to confirm the model, **so that** a
misread nameplate doesn't silently produce guidance for the wrong unit.
- Below a stated confidence threshold, the system asks the tech to confirm or type the model. *(eval)*
- A model with no KB coverage routes to the E3.6 behavior. *(eval)*

**Owner:** Backend · **Depends on:** E4.1 · **Priority:** High

---

# Epic 5 — Safety guardrails
*P1.3 · Run B · a single leak blocks the round*

### E5.1 — Hard refusal on the three prohibited categories
**As a** technician, **I want** the app to stop rather than walk me through dangerous
work, **so that** it never becomes the reason someone gets hurt.
- Requests for gas/combustion procedures, live electrical work, or refrigerant handling refuse. *(eval)*
- Refusals hold across rephrasing, including prompts that pressure for an answer. *(eval)*
- Refusal points to standard safety procedure rather than guessing. *(eval)*
- Zero leaks across the full refusal scenario set — one leak blocks the round. *(eval)*

**Owner:** Backend · **Depends on:** E3.4 · **Priority:** Critical

---

### E5.2 — Refusals are visually unmistakable and cannot be bypassed
**As a** technician glancing at a phone in sunlight, **I want** a refusal to look
different from advice and to stay put, **so that** I can't skim past it or click
through it.
- Refusals render in alert red `#C0453C` from the brand board. *(machine)*
- Refusal styling is distinct from normal answer styling at a glance. *(human)*
- Contrast passes on the dark background. *(machine)*
- A refusal is **not dismissible, not collapsible**, and is not styled as an error the user should retry past. *(machine)*
- No "show me anyway", "continue", or equivalent bypass affordance exists anywhere in the flow. *(machine)*
- The refusal body contains no step-by-step procedure — only the safety-procedure pointer. *(eval)*
- All three categories are triggered **through the UI** and captured: 3 of 3, with screenshots. *(human)*

**Owner:** Frontend · **Depends on:** E5.1 · **Priority:** Critical
**DoD:** Run C AC 5 satisfied with screenshots; no bypass path exists in code or UI.

---

### E5.3 — Advise-only framing throughout
**As a** builder, **I want** the system to advise rather than instruct, **so that**
the guardrail can't be eroded story by story.
- Guidance is framed as what to check and what a reading means, not as step-by-step procedure through hazardous work. *(eval)*
- No story in any run may weaken this to pass — deviations are reported, not accommodated. *(eval)*

**Owner:** Backend · **Depends on:** E5.1 · **Priority:** Critical

---

# Epic 6 — Chat & camera experience
*P1.4 · Run C · the mobile application · rewritten against `.pipeline/00-brief-run-c.md`*

> Frontend owns the weight of this run. Backend is thin and bounded: streaming
> transport, session/message persistence, and the image-upload path to Run B's
> vision endpoint. Run C **renders** the core's output — it does not tune reasoning,
> retrieval, ranking, or guardrail logic. A wrong answer is a Run B defect: log it,
> don't patch it in the UI. Frontend may not edit backend code; a contract gap is
> filed as a `CONTRACT MISMATCH` against Stage 3.

### E6.1 — Chat screen with streaming responses
**As a** technician, **I want** to see the answer as it arrives, **so that** the app
doesn't feel dead while I'm standing on a roof.
- Text input submits and the response **streams** into the message list rather than appearing all at once. *(human)*
- Time-to-first-token is measured on a real device over normal cellular and the actual number reported; target ≤ 3s. *(human)*
- Killing the network mid-stream produces a recoverable error state — never a blank screen, and never a half-rendered answer presented as complete. *(human)*
- The streaming transport contract is published by Stage 3 precisely enough that Frontend never guesses a field name. *(machine)*

**Owner:** Frontend (screen), Backend (streaming transport) · **Depends on:** E3.4 · **Priority:** Critical
**DoD:** Run C AC 2 and the mid-stream half of AC 6 satisfied on a physical device.

---

### E6.2 — Clarifying-question turns render in the same session
**As a** technician, **I want** to answer the app's question and keep going,
**so that** a clarification doesn't cost me my place.
- A clarifying question from the Run B core (E3.3) renders as its own turn, visually distinct from a diagnostic answer. *(machine)*
- Answering it continues the **same** session — no new conversation, no lost context. *(machine)*
- The message list makes clear what was asked and what the tech answered when the session is reopened later. *(machine)*

**Owner:** Frontend · **Depends on:** E3.3, E6.1 · **Priority:** Critical
**DoD:** A multi-turn clarify → answer flow survives a reopen from history with both turns intact.

> New. The old map had E3.3 producing clarifying questions with nothing rendering
> them — a backend behavior with no UI is not a feature.

---

### E6.3 — Nameplate capture, with a correction path that always works
**As a** technician, **I want** to shoot the nameplate and fix a misread fast,
**so that** a faded label doesn't send me down the wrong unit's diagnostics.
- Both **camera capture and photo-library** selection feed the image to the Run B vision endpoint. *(human)*
- The identified manufacturer + model renders back for confirmation before diagnostics proceed. *(human)*
- Across **10 real nameplate photos** (Trane Precedent and Carrier 48/50, mixed lighting and angles), ≥ 8 identify correctly; per-photo results are tabulated. *(human)*
- **Every one of the 10** can be corrected by the user in ≤ 2 taps — including the ones that were right. *(human)*
- Camera-permission denial routes to manual model entry rather than a dead end. *(machine)*

**Owner:** Frontend (capture + correction UI), Backend (upload path) · **Depends on:** E4.1, E4.2, E6.1 · **Priority:** Critical
**DoD:** Run C AC 3 satisfied with the per-photo table.

> The 10 photos are a **human collection task that gates this criterion** — start
> collecting during Run A, not at Run C kickoff.

---

### E6.4 — Citations are first-class UI
**As a** technician, **I want** to tap a citation and see the source, **so that** I
can verify a claim before I act on it.
- Every diagnostic claim renders with a visible, tappable citation resolving to source document name + page number. *(human)*
- Walking the **top-15 fault list** through the UI produces **zero uncited diagnostic claims**. *(human)*
- A statement with no citation must not render as a claim at all — this is a rendering contract, not a nicety. *(machine)*
- A citation that cannot resolve surfaces as an error, never as plain text. *(machine)*
- Component tests cover citation rendering and tap-through. *(machine)*

**Owner:** Frontend · **Depends on:** E3.5, E6.1 · **Priority:** Critical
**DoD:** Run C AC 4 satisfied; uncited-claim rendering is impossible by construction.

---

### E6.5 — Session history
**As a** technician, **I want** past diagnostics to persist, **so that** I can pick a
job back up after driving to the next site.
- History lists past sessions. *(machine)*
- Opening one resumes it with its **full message and citation state** intact. *(machine)*
- Sessions survive a full app restart. *(human)*

**Owner:** Backend (persistence), Frontend (list UI) · **Depends on:** E6.1 · **Priority:** High
**DoD:** Run C AC 8 satisfied, including citation state after restart.

---

### E6.6 — Full state coverage, including offline
**As a** technician on a roof with one bar, **I want** the app to tell me what's
happening, **so that** I'm not staring at a blank screen deciding whether to climb down.
- Loading, empty, error, and **offline/no-signal** states exist and are reachable for **chat, camera, and history** — nine states, enumerated. *(machine)*
- Each is captured with a screenshot in the stage artifact. *(human)*
- No state is a blank screen or an indefinite spinner. *(human)*

**Owner:** Frontend · **Depends on:** E6.1, E6.3, E6.5 · **Priority:** Critical
**DoD:** Run C AC 6 satisfied with the enumerated screenshot set.

> New. Signal loss on a commercial roof is the normal case, not the edge case.

---

### E6.7 — Accessibility floor
**As a** technician with the OS font cranked up and gloves on, **I want** the app to
stay usable, **so that** it works for how I actually hold a phone at work.
- Every interactive element has a VoiceOver/TalkBack label. *(machine)*
- Touch targets ≥ **48dp**. *(machine)*
- Body text contrast ≥ **4.5:1** against its token background. *(machine)*
- Focus and pressed states are visible. *(machine)*
- Text respects OS font-size settings up to **200%** without clipping. *(human)*

**Owner:** Frontend · **Depends on:** E6.8 · **Priority:** Critical
**DoD:** Run C AC 7 satisfied and evidenced.

> New. This was buried inside the old "rooftop ergonomics" story as a vague
> large-targets bullet; the Run C brief makes it a measured floor.

---

### E6.8 — A design system, not per-screen styling
**As the** builder of Phase 2, **I want** reusable components and one token module,
**so that** later screens inherit the brand instead of re-implementing it.
- Colour and type come from a **single token module** sourced from `brand/README.txt`, using the pack's own token names verbatim. *(machine)*
- **No hardcoded hex outside it** — greppable, and the grep result is reported. *(machine)*
- Components (message, citation, refusal, input, empty/error state) are reusable by Phase 2 screens rather than one-off per screen. *(machine)*
- Lockups are chosen by `README.txt`'s size rules, not by eye. Outfit is loaded and is the UI typeface. The cyan accent is not recoloured. *(machine)*

**Owner:** Frontend · **Depends on:** E0.3 · **Priority:** Critical
**DoD:** Run C AC 9 satisfied; the grep for stray hex returns nothing.

> Upgraded from Medium. It was brand compliance; the Run C brief makes it the
> foundation Phase 2 builds on, which changes both its priority and its shape.

---

### E6.9 — One codebase, correct on phone and tablet
**As a** technician, **I want** the app right on whatever I'm carrying, **so that**
the tablet isn't a stretched phone.
- Runs from one codebase on a physical iOS device, a physical Android device, and a tablet. *(human)*
- Tablet layout is **correct**, not phone layout stretched to width. *(human)*
- Readable at arm's length in direct sunlight; where elegance trades against legibility, legibility wins. *(human)*

**Owner:** Frontend · **Depends on:** E6.1 · **Priority:** Critical
**DoD:** Run C AC 1 satisfied on all three form factors.

---

### E6.10 — Component tests over the things that must not silently break
**As a** builder, **I want** the rendering contracts under test, **so that** a refactor
can't quietly reintroduce an uncited claim or a dismissible refusal.
- Component tests cover message rendering, citation rendering and tap-through, and refusal rendering. *(machine)*
- Lint, build, and test run with exact status reported and **no new warnings** (before/after counts against the baseline). *(machine)*

**Owner:** Frontend (tests), Test (verification) · **Depends on:** E6.4, E5.2 · **Priority:** High
**DoD:** Run C AC 10 satisfied.

---

# Epic 7 — Evaluation & validation
*Spans all runs*

### E7.1 — Scenario set stood up from the top-15 faults
**As the** Eval agent, **I want** the scenario set to exist before the reasoning core
does, **so that** Run B is measured rather than self-assessed.
- A version-controlled scenario file covers all 15 faults from `Ductective-Plan-v3.md` §3. *(machine)*
- Each scenario records the input, what a competent tech would do, and the supporting source. *(machine)*
- The three advise-only faults are marked as hard-refusal scenarios. *(machine)*
- Written during **Run A** — Stage 5.5 has nothing to score in Run A and does this instead. *(machine)*

**Owner:** Eval · **Depends on:** — · **Priority:** High
**DoD:** File committed; the set only ever grows.

---

### E7.2 — Three-axis scoring, reported separately
**As a** builder, **I want** correctness, citation validity, and safety scored apart,
**so that** a good average can't hide a citation that doesn't support its claim.
- Each scenario is scored on correctness (including ordering), citation validity, and safety compliance. *(eval)*
- The three are never collapsed into one number. *(eval)*
- Citation validity is checked by opening the cited page, not by checking a citation exists. *(eval)*
- Scenarios where Eval's own domain judgment is uncertain are flagged for human review, not guessed. *(eval)*

**Owner:** Eval · **Depends on:** E7.1, E3.5 · **Priority:** Critical

---

### E7.3 — Regressions reported explicitly
**As a** builder, **I want** to know what broke, **so that** an improved average
doesn't mask a scenario that used to pass.
- Each round compares against the prior `055-eval.md`. *(eval)*
- Any previously-passing scenario that now fails is called out as a regression regardless of overall movement. *(eval)*

**Owner:** Eval · **Depends on:** E7.2 · **Priority:** High

---

### E7.5 — UI-driven guardrail-leak check
**As a** builder, **I want** the interface probed for leaks the core would refuse,
**so that** a rendering path can't undo a guardrail the reasoning layer honors.
- Guardrail probes run **through the UI**, not against the core directly — the question Run C uniquely answers is whether the interface can be made to leak what the core correctly refused. *(eval)*
- The top-15 scenario set is rerun as a **regression** against Run B's scores. *(eval)*
- Any leak is a **Critical** and blocks Phase 1 exit. *(eval)*

**Owner:** Eval · **Depends on:** E7.2, E6.1, E5.2 · **Priority:** Critical
**DoD:** Run C's eval section complete; zero leaks, or Phase 1 does not exit.

> New. Stage 5.5's genuinely new work in Run C — the rest of its Run C job is
> regression. A core that refuses correctly can still leak through a UI that
> renders a refused draft, retries around it, or exposes it in history.

---

### E7.4 — Real commercial tech validates the guidance
**As a** builder, **I want** a working tech to review real cases, **so that** Phase 1
exits on someone's judgment and not only on my own scoring.
- A commercial RTU service tech is recruited. *(human)*
- The tech reviews diagnostic outputs across the top-15 faults. *(human)*
- Their verdict per case is recorded, including disagreements. *(human)*

**Owner:** Human · **Depends on:** — · **Priority:** Critical
**DoD:** Started immediately, in parallel with Run A — this is the long pole.

---

# Epic 8 — Operability
*Cross-cutting*

### E8.1 — The human-only critical path is written down
**As a** solo builder, **I want** every step an agent can't do in one list, **so that**
I'm never the silent blocker.
- `SETUP-BLOCKERS.md` lists every human-only step: Supabase project creation, API key provisioning, device testing, App Store/Play accounts, tech recruitment. *(machine)*
- Each entry states what unblocks and what it blocks. *(machine)*
- Stage 5 appends any human-only verification it finds. *(machine)*

**Owner:** Test · **Depends on:** — · **Priority:** High

---

### E8.2 — Spend stays visible against the $1k budget
**As a** builder on a fixed budget, **I want** running cost visible, **so that** I
find out before the money is gone, not after.
- Ingestion and per-answer costs are reported by the runs that incur them. *(machine)*
- Cumulative spend against the ~$1,000 ceiling is tracked in one place. *(machine)*

**Owner:** Backend · **Depends on:** E1.10 · **Priority:** Medium

---

# Run A coverage map

Every acceptance criterion in `.pipeline/00-brief.md` maps to at least one story.

| Brief AC | Stories | Verification |
|---|---|---|
| 1 — repo, §5 layout, gitignore, clean history | E0.1, E0.2 | machine |
| 2 — `npx expo start`, loads on device | E0.3 | machine + human |
| 3 — device round trip, no key in client | E0.2, E0.4, E0.5 | human |
| 4 — chunks table, pgvector, full provenance | E0.6, E1.7 | machine |
| 5 — single command, idempotent | E1.9, E1.10 | machine |
| 6 — every chunk resolves to a manifest row; exclusions listed | E1.1, E1.2, E1.3, E1.5 | machine |
| 7 — ≥12 queries, ≥10 correct doc + page | E2.2 | machine |
| 8 — re-ingest cost and runtime stated | E1.8, E1.10 | machine |
| 9 — lint/build/test status, no new warnings | E0.7 | machine |
| §Verification — Stage 5.5 stands up the scenario set | E7.1 | machine |

Reverse direction: no Run A story exists that doesn't serve a brief criterion,
except E2.3 and E8.1, which serve Run B's guardrails and the human critical path
respectively. Both are cheap and are called out here rather than smuggled in.

---

# Run C coverage map

Against `.pipeline/00-brief-run-c.md`. Run B has no brief yet, so Epics 3–5 stay a
forward map until it lands.

| Brief AC | Stories | Verification |
|---|---|---|
| 1 — one codebase, iOS + Android + tablet, tablet not stretched | E6.9 | human |
| 2 — streaming, TTFT ≤ 3s measured on device | E6.1 | human |
| 3 — 10 nameplate photos, ≥ 8 correct, all correctable in ≤ 2 taps | E6.3 | human |
| 4 — top-15 through the UI, zero uncited claims | E6.4 | human + machine |
| 5 — 3 of 3 refusals, alert red, no bypass, screenshots | E5.2 | human + eval |
| 6 — loading/empty/error/offline across chat, camera, history | E6.6, E6.1 | human |
| 7 — accessibility floor (labels, 48dp, 4.5:1, focus, 200%) | E6.7 | machine + human |
| 8 — history lists, resumes with citations, survives restart | E6.5 | machine + human |
| 9 — single token module, no stray hex | E6.8 | machine |
| 10 — component tests, lint/build/test, no new warnings | E6.10 | machine |
| §Verification — UI-driven guardrail-leak check + top-15 regression | E7.5 | eval |

Criterion 3 depends on a **human collection task** — 10 real nameplate photos.
It gates an acceptance criterion and has a lead time measured in site visits, so
it belongs in `SETUP-BLOCKERS.md` now rather than at Run C kickoff. Same for H7:
the brief notes that nearly half of Run C is unverifiable without a phone in hand.

---

# Open questions, with the default I'd build on

1. **The two orphan manifest rows.** *Default:* attempt one re-download; drop the row if the URL is dead. Neither document is in Phase 1 answer scope. → E1.2
2. **OCR or exclude.** *Default:* exclude scan-blocked documents from Phase 1 rather than building an OCR path, **unless** the blocked set includes any of the 18 rooftop docs or 3 PT charts — in which case OCR becomes Critical, because the brief's 10-of-12 retrieval bar depends on those documents. → E1.5
3. **Chunk size for dense IOM text.** *Default:* Stage 2.5 picks and justifies it against the smoke set rather than us guessing here. Fault tables and wiring diagrams argue for structure-aware chunking over fixed windows. → E1.6
4. **Where the serverless function runs.** The brief says "serverless function" without naming a host. *Default:* Supabase Edge Functions, since Supabase is already a hard-constraint dependency and this adds no new vendor. → E0.4
5. **Session persistence location.** *Default:* Supabase, same reasoning — but this is Run C's decision and shouldn't be locked now. → E6.5

---

# Assumptions this map is built on

Flagged because Stage 1 hasn't run, so none of these are verified against code:

- **`app/` and `ingest/` do not exist yet.** Every Epic 0 and 1 story assumes greenfield. If the planner scaffolds either before Run A, Stage 2 must re-derive against what's actually there.
- ~~**The repo is not yet initialized locally.**~~ **Resolved 28 Jul 2026** — the repo is initialized and pushed to `andreasvermeulenTDM/ductective`, so E0.1 is verify-only. This map was drafted before that landed; if you find other statements about repo state that contradict the working tree, **trust the working tree** and correct the map.
- **No lint/build/test toolchain exists**, so E0.7 establishes the baseline rather than reporting against one.
- **Nothing here is a feasibility judgment on the brief's criteria.** The one criterion I'd watch is AC 7's 10-of-12 bar: it depends entirely on E1.4/E1.5 outcomes, and if the scan-heavy documents turn out to include Precedent or 48/50 IOMs, the bar and the OCR decision have to be revisited together rather than the bar being quietly missed.

---
---

# Beyond Phase 1 — Epics E9–E16

**Not a commitment, and not pipeline-ready.** Phase 1 exits on a self-testable
build validated by one commercial tech. Everything below is Phases 2–4 from
`docs/plan-v2-superseded.md` §Phase 2–4, which `Ductective-Plan-v3.md` leaves
"deferred, not discarded." It exists so the shape of the road is visible and so
Phase 1 decisions don't accidentally foreclose it.

These epics are deliberately written as **intent + candidate stories + what must
be decided first**, not as acceptance-criteria checklists. Each depends on choices
you haven't made yet (pricing enforcement model, hosting, org data model). Writing
testable criteria against undecided choices would be false precision — the Stage 2
pass for each phase writes those, against that phase's own brief.

**The website lives here, in two separate surfaces:** the Phase 3 marketing site
(E14) and the Phase 4 company admin console (E16). Neither exists in Phase 1, and
the Run C brief explicitly puts "marketing site, app-store listing assets" out of
scope.

---

## Phase 2 — Private beta

### E9 — Accounts & identity
Ductective is a single-user prototype through Phase 1. The beta needs to know who
someone is before it can gate anything later.
- Supabase auth: sign-up, sign-in, session persistence · **Backend**
- Sign in with Apple (App Store requires it wherever third-party sign-in is offered) · **Backend/Frontend**
- Per-user data isolation on sessions and history — retrofitting row-level security onto E6.5's schema · **Backend**
- Account deletion, in-app (App Store requirement, not optional) · **Backend/Frontend**

**Decide first:** whether beta testers get accounts or a shared build. **Watch:**
E6.5's session schema is written in Run C with no user column — adding one later
is a migration, so it's worth a five-minute conversation during Run C.

### E10 — Build & store distribution
Phase 1 ships over Expo Go. Nothing in the map produces an installable artifact.
- EAS build pipeline for iOS and Android · **Backend**
- Apple Developer ($99/yr) and Google Play ($25 one-time) enrollment · **Human**
- Signing, provisioning, certificates · **Human/Backend**
- App icon and splash from `brand/png/app-icon-*.png` (already in the pack, unused) · **Frontend**
- TestFlight and Play internal testing distribution · **Human**
- OTA update channel · **Backend**

**Decide first:** nothing blocking — but the Apple enrollment has a lead time and
Human-owned identity verification, so start it before you need it.

### E11 — Beta instrumentation & feedback
The beta's purpose is learning what techs actually ask, which is invisible without
instrumentation.
- Usage analytics: queries asked, faults hit, abandonment points · **Backend**
- In-app feedback capture per answer — thumbs plus a reason · **Frontend**
- Wrong-answer reports route into the Stage 5.5 scenario set, which only ever grows · **Eval**
- Cost per active user tracked against the subscription price you plan to charge · **Backend**

**Decide first:** what's collected and how it's disclosed — this is the first point
where a privacy policy stops being theoretical.

### E12 — Knowledge base widening
Phase 1 answer scope is 18 rooftop docs + 3 PT charts. Phase 2 widens toward
general HVAC.
- Un-scope the already-ingested Daikin, Mitsubishi, chiller, and EPA documents (E1.7 tagged them, didn't discard them) · **Knowledge**
- Source and ingest new OEM corpora · **Knowledge**
- Re-measure retrieval precision after each widening — precision degrades as the corpus grows, which is exactly why E1.7 scoped it in the first place · **Knowledge/Eval**
- Grow the scenario set alongside the corpus · **Eval**

**Decide first:** residential or wider commercial. v3 pivoted to commercial because
the corpus was already there; the same logic should drive the next widening.

---

## Phase 3 — Monetize (individuals)

### E13 — Subscriptions & paywall
$29/mo with a 7-day trial, via RevenueCat across both stores.
- RevenueCat integration and entitlement checks · **Backend**
- 7-day trial → $29/mo conversion flow · **Backend/Frontend**
- Paywall gating: what a non-subscriber can still do · **Frontend**
- Restore purchases, and entitlement state that survives reinstall · **Backend**

**Decide first:** what the free tier is, if any. Also whether per-answer Claude cost
at real usage actually clears $29/mo — E8.2 and E11's cost tracking exist to answer
this before you're contractually committed to a price.

### E14 — Marketing website ← *the website*
Next.js, per `docs/plan-v2-superseded.md:92`. The first non-app surface in the
whole plan, and the first use for `brand/favicon/` (16–512px) and
`brand/brand-board.html`, which ship in the repo today with nothing to attach to.
- Landing page: what Ductective is, who it's for, what equipment it covers · **Frontend**
- Pricing page — individual, $39/seat, $199/shop · **Frontend**
- **Privacy policy and terms** — App Store submission requires reachable URLs, so this is a launch blocker, not marketing polish · **Human/Frontend**
- Support and contact page — also an App Store requirement · **Frontend**
- Account-deletion information page (Apple wants the path documented publicly) · **Frontend**
- Store badges and screenshots, once E10 produces builds · **Frontend**
- Analytics and basic SEO · **Frontend**

**Decide first:** Next.js in this repo or its own. **Recommendation:** its own repo.
It shares only brand tokens with the app, deploys on a different cadence, and
dragging a web build into a pipeline whose seven agents all assume one Expo
codebase would cost more than the duplication saves. Extract the tokens from E6.8
into a shared package if the duplication starts to hurt — not before.

### E15 — Store & platform compliance
The work that turns a working app into a shippable one, and the usual source of
rejection.
- App Review submission, metadata, age rating · **Human**
- Privacy nutrition labels / Play data-safety declarations · **Human**
- Sign in with Apple compliance (pairs with E9) · **Backend**
- **A safety-critical question worth early legal input:** an app giving HVAC
  diagnostic guidance carries liability the advise-only guardrail is designed to
  bound. Whether that framing survives contact with App Review — and with a lawyer
  — is worth asking before launch week · **Human**

**Decide first:** the liability framing above. It's the one item in Phases 2–4 that
could reshape the product rather than just delay it.

---

## Phase 4 — Company plans

### E16 — Company seats & admin console ← *the second web surface*
$39/seat or $199/shop up to 6 techs, billed through Stripe rather than the app
stores — which is precisely why it needs a web surface.
- Stripe B2B subscriptions, seats, and invoicing · **Backend**
- Organization data model: org, membership, role, seat assignment · **Backend**
- Entitlement sync between Stripe (company) and RevenueCat (individual) — two billing systems, one entitlement truth, and the likeliest source of subtle bugs in the whole plan · **Backend**
- **Company admin dashboard (web):** invite and remove techs, assign seats, view billing · **Frontend**
- App Review compliance for the B2B billing model — Apple's rules on external purchase for business accounts are specific and have changed more than once · **Human**

**Decide first:** whether the admin console is a section of E14's Next.js site or a
separate authenticated app. **Recommendation:** same codebase as E14, separate
authenticated route — one web deploy, not two.

---

## What Phase 1 should do about all this

Almost nothing. Three exceptions, each cheap now and expensive later:

1. **E6.5's session schema** (Run C) — decide whether a user/org column goes in from
   the start. A nullable column costs nothing today; a migration over real beta
   data costs a weekend. → E9
2. **E6.8's token module** (Run C) — keep it importable and free of React Native
   specifics, so E14's website can consume it without a rewrite. → E14
3. **E8.2's cost tracking** (Run A) — it's already in the map for budget reasons,
   but its more important job is telling you whether $29/mo is profitable before
   you've published a price. → E13

Everything else waits for its phase and its own brief.

---
---

# ADDENDUM C — Unit-first entry (U1–U8)

**Runs B and C. Does not touch Run A's critical path.**

The app should open by establishing *which unit you are standing in front of* —
by photographing the data plate or by entering it — and only then take questions.

## This is a flow change, not a feature

The prototype already leans this way. `app/App.tsx:13-15` says the plan *"treats a
data plate as how you **start** a question, not a place you go"*, `sessions.equipment`
exists in `sql/002_prototype_sessions.sql:24`, and `App.tsx:61` already holds an
`equipment` state. But capture is currently an **optional composer action**. Making
it a **gate** is a different design with different consequences, and three of them
are not obvious:

1. **Coverage honesty moves earlier.** E3.6 currently discovers "I have no
   documentation for that" *after* a question. Unit-first discovers it before one is
   asked — which is strictly better for the tech and removes the most likely path to
   a confidently wrong answer.
2. **Retrieval narrows before the first query.** `documents.in_scope` and the scope
   tags from E1.7/E2.3 can filter to one unit's manuals from the outset. That should
   *raise* precision on brief AC 7's 10-of-12 bar and reduce the sibling-manual
   confusion Stage 1 flagged between `48-50FC` and `48-50FE`.
3. **It adds friction to a quick question**, and that is a real cost. The
   justification is the domain rule, not the UX: an answer citing the wrong unit's
   manual is a mis-citation, which `CLAUDE.md:57-59` names as worse than an uncited
   claim. The gate exists to make that failure unreachable.

> **Requires a Stage 0 brief amendment.** `.pipeline/00-brief-run-c.md` lists
> nameplate capture as an input *alongside* text, not as a precondition for it.
> Unit-first contradicts that. Amend the brief as a dated Stage 0 decision — the
> same instrument M4 used — rather than letting stage agents infer a new flow.

---

### U1 — The app opens on unit selection, not the composer
**As a** technician standing on a roof, **I want** to tell the app what I'm looking at
first, **so that** everything it says afterward is about my actual unit.
- A cold start with no active session lands on unit selection, not chat. *(machine)*
- Both paths are offered as co-equal choices: **photograph the data plate** or **enter the details**. *(machine)*
- The composer is unavailable until a unit is confirmed — disabled with a reason, not hidden. *(machine)*
- Opening an existing session from history does **not** re-ask; the unit is already on the session. *(machine)*

**Owner:** Frontend · **Depends on:** U2, U3 · **Priority:** Critical
**DoD:** No route reaches the composer with `equipment` unset.

---

### U2 — Manual entry is a first-class path, not a fallback
**As a** technician whose data plate is painted over, **I want** to type the unit in,
**so that** an unreadable plate doesn't lock me out of the app.
- Manufacturer and model can be entered directly, reachable **without opening the camera at all**. *(machine)*
- Partial and near-miss model numbers resolve — faded plates are the normal case, not the edge case. *(machine)*
- The field does not imply coverage it lacks: an unrecognised entry routes to U4 rather than silently accepting. *(machine)*
- Camera-permission denial lands here, not in a dead end. *(machine)*

**Owner:** Frontend · **Depends on:** — · **Priority:** Critical
**DoD:** The whole flow is completable with the camera permanently denied.

> Amends **E4.2**, which today treats manual entry only as a low-confidence
> *fallback*. Under unit-first it is one of two front doors.

---

### U3 — Capture resolves to a candidate unit, and you confirm it
**As a** technician, **I want** to see what it read before it acts on it, **so that** a
misread plate doesn't send me down the wrong unit's diagnostics.
- A photo returns manufacturer + model rendered for confirmation before any question is taken. *(human)*
- Extraction confidence is surfaced, not hidden. *(machine)*
- Low confidence pre-fills U2's form rather than guessing. *(eval)*
- Correction takes ≤ 2 taps, on every result including correct ones — this is Run C AC 3, unchanged. *(human)*

**Owner:** Frontend (UI), Backend (vision endpoint) · **Depends on:** E4.1, E4.2 · **Priority:** Critical
**DoD:** Run C AC 3 satisfied through the unit-first flow.

> `app/screens/CaptureScreen.tsx` already renders a confirmation card against a
> mocked `READ_MODEL`. This story replaces the mock, not the screen.

---

### U4 — Coverage is stated at selection, before any question
**As a** technician with a Daikin unit, **I want** to be told up front, **so that** I
don't ask three questions before finding out it can't help.
- A confirmed unit is matched against `documents.in_scope`. *(machine)*
- **In scope** (Trane Precedent, Carrier 48/50) → proceed. *(machine)*
- **Ingested but out of Phase 1 scope** (Daikin, Mitsubishi, chiller, EPA) → say so plainly and name what *is* covered, before a question is taken. *(eval)*
- **Unrecognised** → do not guess. Offer the nearest covered families, or let the tech proceed with an explicit "no documentation for this unit" state. *(eval)*
- The app never proceeds silently with a unit it has no documentation for. *(machine)*

**Owner:** Backend (resolution), Frontend (states) · **Depends on:** U2, U3, E1.7, E2.3 · **Priority:** Critical
**DoD:** Moves E3.6's coverage-edge honesty from post-question to pre-question.

> **The most valuable story in this addendum.** It converts the single most
> dangerous failure — fluent guidance about a unit with no backing documentation —
> from a runtime risk into an unreachable state.

---

### U5 — The session carries its unit, and retrieval is scoped by it
**As the** retrieval layer, **I want** the unit on the session, **so that** every
citation in a transcript belongs to the same machine.
- `sessions.equipment` is populated at session creation. The column exists and is nullable today — decide whether unit-first makes it `NOT NULL`. *(machine)*
- Every retrieval in the session filters to that unit's documents. *(machine)*
- The unit is visible in the session header throughout, not just at the start. *(machine)*
- History rows show the unit badge — already built in the design pass. *(machine)*

**Owner:** Backend (scoping), Frontend (header) · **Depends on:** U4, E2.3 · **Priority:** Critical
**DoD:** No answer in a session cites a document outside its unit's coverage.

---

### U6 — Changing the unit starts a new session
**As a** technician moving to the next rooftop, **I want** a clean session per unit,
**so that** my earlier citations don't silently start describing a different machine.
- Changing the unit is explicit, never inferred from the conversation. *(machine)*
- It **starts a new session** rather than re-scoping the current one. *(machine)*
- The prior session stays intact in history under its own unit. *(machine)*

**Owner:** Backend, Frontend · **Depends on:** U5 · **Priority:** High
**DoD:** A transcript can never contain citations scoped to two different units.

> This is a citation-integrity rule, not a convenience one. Re-scoping in place
> would leave earlier answers in the transcript cited against a machine they were
> never about.

---

### U7 — The gate cannot be bypassed into ungrounded answers
**As a** builder, **I want** one way in, **so that** the gate isn't a suggestion.
- No path reaches the diagnostic core without a resolved unit — including restored state, deep links, and a cold start while offline. *(machine)*
- **Safety refusals remain reachable at any point**, with or without a unit. A hard refusal does not depend on knowing the equipment, and gating it behind unit selection would be a guardrail regression. *(machine)*

**Owner:** Backend, Frontend · **Depends on:** U1 · **Priority:** Critical
**DoD:** Tested by attempting each bypass route, not by inspection.

---

### U8 — States for the new first screen
**As a** technician with one bar of signal, **I want** the first screen to work
anyway, **so that** I'm not stuck at the front door.
- Camera permission denied → U2. *(machine)*
- Vision endpoint down or rate-limited → U2, not a dead end. *(machine)*
- **Offline at cold start** → manual entry works offline; capture explains it needs signal. *(human)*
- Unrecognised-unit and out-of-scope states from U4 are reachable and screenshotted. *(human)*

**Owner:** Frontend · **Depends on:** U1, U4 · **Priority:** Critical
**DoD:** Run C AC 6 expands from nine states to twelve — unit selection joins chat,
camera, and history as a surface needing loading/empty/error/offline coverage.

---

## What this changes elsewhere

| Artifact | Change |
|---|---|
| `.pipeline/00-brief-run-c.md` | In-scope list: capture becomes a **precondition**, not a co-equal input. AC 6's nine states become twelve. Stage 0 amendment. |
| `docs/phase1-story-map.md` E4.2 | Manual entry promoted from fallback to front door — see U2 |
| `docs/phase1-story-map.md` E3.6 | Coverage-edge behavior moves earlier; U4 supersedes the post-question path |
| `docs/phase1-story-map.md` E6.1 | Composer gains a disabled-until-unit state |
| `sql/002_prototype_sessions.sql:24` | `equipment` may become `NOT NULL` — open question below |
| `app/App.tsx:57-87` | `capturing` overlay becomes a routed first screen; Run C picks real navigation anyway |

## Open questions

1. **Does `sessions.equipment` become `NOT NULL`?** *Default:* **yes** — a nullable
   column re-admits exactly the ungrounded session U7 exists to prevent. Cost is a
   migration on the prototype table. → U5
2. **Can a tech proceed with an unrecognised unit?** *Default:* **yes, with an
   explicit "no documentation for this unit" state** that persists in the session
   header. Refusing entirely makes the app useless on the 30% of rooftops carrying
   something else; proceeding silently is the failure U4 exists to prevent. The
   middle path is honest and still usable. → U4
3. **Does unit-first survive into Phase 2's wider KB?** *Default:* yes — the wider
   the corpus, the more retrieval precision depends on scoping. → U5
4. **Is there a "just ask" escape for a general question?** *Default:* **no** in
   Phase 1. Every answer is cited to a unit's manual; a unitless question has no
   grounded answer to give. Revisit if the tech validation (E7.4) says techs want it. → U1
