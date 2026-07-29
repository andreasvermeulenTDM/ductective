# Phase 1 — Story Map

Stage 2 output, written at planning time. Decomposes **all of Phase 1** (P1.0–P1.5
of `Ductective-Plan-v3.md`) into epics and implementation-ready stories, tagged by
the agent persona that owns each one.

**Status: draft, not the Stage 2 artifact.** `.pipeline/01-research.md` has not
landed, so this is derived from the plan of record and `.pipeline/00-brief.md`
rather than from codebase research. Run A's stories (Epics 0–2, plus E7.1) are the
ones that become `.pipeline/02-user-stories.md` once Stage 1 completes and the
assumptions in the last section are confirmed or corrected. Runs B and C get their
own briefs and their own Stage 2 passes; their stories here are a forward map, not
a commitment.

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
| **C** | E6, E7.3 | E6.1 → E6.3 → E6.4 | E6.2, E6.5, E6.6 parallel after E6.1 |

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
public mistake can't leak my Anthropic billing.
- `.env.example` lists every required variable name with no values. *(machine)*
- No Anthropic or Voyage key appears in any tracked file or in the built client bundle. *(machine)*
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

### E0.4 — Serverless function proxies Claude
**As a** developer, **I want** one server-side entry point to the Claude API,
**so that** keys stay off the device and later runs have a place to add logic.
- A deployed function accepts a text prompt and returns a Claude completion. *(machine)*
- The key is read from the environment; a request with no key configured fails with a clear error rather than a stack trace. *(machine)*
- Errors return a documented shape (status + message), not a raw provider error. *(machine)*
- The request/response contract is written down for Runs B and C to build against. *(machine)*

**Owner:** Backend · **Depends on:** E0.2 · **Priority:** Critical
**DoD:** Contract documented in `.pipeline/03-backend.md`; error shape defined.

---

### E0.5 — Hello-world round trip from a real device
**As a** builder, **I want** to prove the whole path works end to end, **so that**
Run B starts on rails that are known good.
- Submitting text on a physical device renders a Claude response on screen. *(human)*
- The round trip goes device → function → Claude; no direct client-to-Anthropic call appears in network logs. *(human)*
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

**Owner:** Backend · **Depends on:** E0.1 · **Priority:** Critical
**DoD:** Migration applied; constraints verified by attempting a page-less insert.

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
- `1.pdf` resolves to the Mitsubishi City Multi service handbook and is renamed accordingly. *(machine)*
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

### E5.2 — Refusals are visually unmistakable
**As a** technician glancing at a phone in sunlight, **I want** a refusal to look
different from advice, **so that** I don't skim past it.
- Refusals render in alert red `#C0453C` from the brand board. *(machine)*
- Refusal styling is distinct from normal answer styling at a glance. *(human)*
- Contrast passes on the dark background. *(machine)*

**Owner:** Frontend · **Depends on:** E5.1 · **Priority:** Critical

---

### E5.3 — Advise-only framing throughout
**As a** builder, **I want** the system to advise rather than instruct, **so that**
the guardrail can't be eroded story by story.
- Guidance is framed as what to check and what a reading means, not as step-by-step procedure through hazardous work. *(eval)*
- No story in any run may weaken this to pass — deviations are reported, not accommodated. *(eval)*

**Owner:** Backend · **Depends on:** E5.1 · **Priority:** Critical

---

# Epic 6 — Chat & camera experience
*P1.4 · Run C*

### E6.1 — Chat screen with streaming responses
**As a** technician, **I want** to see the answer as it arrives, **so that** the app
doesn't feel dead while I'm standing on a roof.
- Text input submits and the response streams token by token. *(human)*
- Interrupted or failed streams show a readable error and allow retry. *(machine)*

**Owner:** Frontend (screen), Backend (streaming transport) · **Depends on:** E3.4 · **Priority:** Critical

---

### E6.2 — Nameplate capture from the camera
**As a** technician, **I want** to shoot the nameplate in-app, **so that** I'm not
switching between apps with gloves on.
- Camera capture feeds the photo to E4.1. *(human)*
- Permission denial is handled with a clear path to manual model entry. *(machine)*

**Owner:** Frontend · **Depends on:** E4.1, E6.1 · **Priority:** High

---

### E6.3 — Tappable citations
**As a** technician, **I want** to tap a citation and see the source, **so that** I
can verify a claim in seconds.
- Every citation in a response is tappable and opens the source document at the cited page. *(human)*
- A citation that cannot resolve is surfaced as an error, never rendered as plain text. *(machine)*

**Owner:** Frontend · **Depends on:** E3.5, E6.1 · **Priority:** Critical

---

### E6.4 — Session history
**As a** technician, **I want** past diagnostics to persist, **so that** I can pick a
job back up after driving to the next site.
- Conversations persist across app restarts. *(machine)*
- History is listable and a past session reopens with its citations intact. *(machine)*

**Owner:** Backend (persistence), Frontend (list UI) · **Depends on:** E6.1 · **Priority:** High

---

### E6.5 — Rooftop ergonomics on phone and tablet
**As a** technician in sunlight with gloves on, **I want** big targets and high
contrast, **so that** the app is usable where I actually work.
- Touch targets meet the plan's large-target bias. *(machine)*
- Layout works on phone and tablet from one codebase. *(human)*
- Readable in direct sunlight on a real device. *(human)*

**Owner:** Frontend · **Depends on:** E6.1 · **Priority:** High

---

### E6.6 — Brand compliance from the shipped assets
**As the** brand owner, **I want** the app to use the real tokens and lockups,
**so that** no parallel style gets invented.
- Colors and type come from `brand/README.txt` tokens; no hardcoded hex outside the token file. *(machine)*
- Lockup selection follows the README's size rules rather than being picked by eye. *(machine)*
- Outfit is the UI typeface throughout. *(machine)*

**Owner:** Frontend · **Depends on:** E0.3 · **Priority:** Medium

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

# Open questions, with the default I'd build on

1. **The two orphan manifest rows.** *Default:* attempt one re-download; drop the row if the URL is dead. Neither document is in Phase 1 answer scope. → E1.2
2. **OCR or exclude.** *Default:* exclude scan-blocked documents from Phase 1 rather than building an OCR path, **unless** the blocked set includes any of the 18 rooftop docs or 3 PT charts — in which case OCR becomes Critical, because the brief's 10-of-12 retrieval bar depends on those documents. → E1.5
3. **Chunk size for dense IOM text.** *Default:* Stage 2.5 picks and justifies it against the smoke set rather than us guessing here. Fault tables and wiring diagrams argue for structure-aware chunking over fixed windows. → E1.6
4. **Where the serverless function runs.** The brief says "serverless function" without naming a host. *Default:* Supabase Edge Functions, since Supabase is already a hard-constraint dependency and this adds no new vendor. → E0.4
5. **Session persistence location.** *Default:* Supabase, same reasoning — but this is Run C's decision and shouldn't be locked now. → E6.4

---

# Assumptions this map is built on

Flagged because Stage 1 hasn't run, so none of these are verified against code:

- **`app/` and `ingest/` do not exist yet.** Every Epic 0 and 1 story assumes greenfield. If the planner scaffolds either before Run A, Stage 2 must re-derive against what's actually there.
- ~~**The repo is not yet initialized locally.**~~ **Resolved 28 Jul 2026** — the repo is initialized and pushed to `andreasvermeulenTDM/ductective`, so E0.1 is verify-only. This map was drafted before that landed; if you find other statements about repo state that contradict the working tree, **trust the working tree** and correct the map.
- **No lint/build/test toolchain exists**, so E0.7 establishes the baseline rather than reporting against one.
- **Nothing here is a feasibility judgment on the brief's criteria.** The one criterion I'd watch is AC 7's 10-of-12 bar: it depends entirely on E1.4/E1.5 outcomes, and if the scan-heavy documents turn out to include Precedent or 48/50 IOMs, the bar and the OCR decision have to be revisited together rather than the bar being quietly missed.
