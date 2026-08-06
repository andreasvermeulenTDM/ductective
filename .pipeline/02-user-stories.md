# 02 — User stories · Run B: the diagnostic core (P1.3)

Stage 2 artifact for `.pipeline/00-brief.md` (Run B). Derived from
`.pipeline/00-brief.md` and `.pipeline/01-research.md` (6 Aug 2026, including its
post-scriptum: **M12 is MEASURED** — 12/15 faults, 47 claims, fabrication 0/47,
provider blocks 0/15 — and span-copying designs are **closed**, not open). Run A's
Stage 2 artifact is archived at `.pipeline/runs/A-02-user-stories.md`; this file
supersedes it for Stages 2.5–5.5.

**The shape of this run, per research §2: most of Run B already exists on `main`
and is verified.** The costliest available failure is re-building working code; the
second-costliest is assuming something works because code exists. Every story below
is therefore tagged with one of three modes:

- **VERIFY-AND-CLOSE** — the code is shipped; the story is the missing test,
  fixture, or measurement against it. Do not rewrite the code.
- **BUILD** — genuinely missing (research §2c's confirmed list: nameplate vision,
  R1 unit-scoped retrieval, the clarify continuation's live proof, M15/M16
  cost/cache instrumentation, the Edge Function path, the scored eval run, and the
  filed CONTRACT MISMATCH at `app/lib/diagnose.ts:201-205`).
- **MEASURE** — pure measurement against shipped or newly-built code, producing
  the numbers criteria 3, 4, 5 (judgment half), 7, and 9 demand.

Settled decisions no story may re-open: source-index citation anchoring (the model
never writes a document name or page — `lib/diagnose.mjs:134-136,191-246`), the
deterministic pre-model safety gate, hybrid retrieval off by default, span-copying
(M6–M8-as-written) retired, and the three-response-shapes constraint and free-tier
constraint as **fixed owner decisions** — no story proposes billing or a tier
change.

---

## Owners

| Owner | Stage | Scope this run |
|---|---|---|
| **Knowledge** | 2.5 | R1 migration (`filter_document_ids`), any measured-failure re-chunking. On call, not idle. |
| **Backend** | 3 | The contract, the unit-required gate, `documentIds` threading, vision endpoint, instrumentation, Edge wrapper, clarify proof. |
| **Frontend** | 4 | **Nothing to do** — see the explicit note below the stories. |
| **Test** | 5 | Mechanical verification: citation/refusal regression + reachability, out-of-scope probes, vision tabulation, criterion-9 numbers. |
| **Eval** | 5.5 | The first scored run: criteria 3, 4, judgment half of 5; block-rate reporting; the baseline numbers. |

Human-gated items (photo collection, H9 access token, OQ3 sign-off) are flagged
inside the owning story — they are dependencies, not owners.

---

## Sequencing plan

### The constraint that orders everything: quota (OQ3, resolved here)

**20 Gemini requests/day/model, retries count against it, no Pro allowance**
(research §3, `spike/m12/README.md`). Budget ~1.4 requests per fault. The
sequencing consequence, made explicit because the research assigned it to this
stage:

- **The scored eval run cannot complete in one day and is planned as a multi-day
  batch, owned by Eval (ST-15/ST-16), with the per-day budgets below recorded in
  `055-eval.md`.** The owner is asked **once**, at ST-16 kickoff, whether to accept
  the elapsed time (~3–4 quota days) — per OQ3's default. No agent escalates to a
  tier change.
- **Transcripts are shared, not re-generated.** The top-15 batch is run once and
  serves criteria 2 (mechanical citation check), 3 (the ≥30-claim sample — M12's
  full run yielded 47 claims from 12 faults, so one top-15 batch should clear 30),
  4 (correctness scoring), and 9 (latency/cost samples). Test and Eval read the
  same captured outputs; nobody burns quota twice for the same evidence.
- **Zero-quota criteria run any day, in parallel:** the 12 refusal probes and the
  leak check never reach the model (deterministic gate, proven at
  `lib/safety.mjs:105-120`), and the five out-of-scope probes cost only Voyage
  embeds (empty retrieval never calls Gemini, `lib/diagnose.mjs:292-299`).
- Supabase free tier pauses after 7 idle days — keep the batch days within a week
  of each other or ping the instance between them.

**Planned quota days** (order can shift; budgets should not grow):

| Quota day | Batch | Est. requests (incl. retry margin) |
|---|---|---|
| Q1 | Clarify live loop (ST-08: clarify → answer → continue, + one must-not-stall) + cache-warm/cold pairs (ST-10) | ~10–14 |
| Q2 | Top-15 fault batch, part 1 (8 faults) — instrumented, scoped via ST-04 | ~11–12 |
| Q3 | Top-15 fault batch, part 2 (7 faults) + latency top-ups | ~10–14 |
| Q4 | Vision: 10 nameplate photos (ST-07) — gated on photos existing (ST-06) | ~10–14 |
| any | Refusal probes (ST-12), out-of-scope probes (ST-14), eval page-opening and scoring (offline) | 0 Gemini |

### Build order

**Wave 0 — startable now, in parallel (no shared files, no quota):**

- **ST-01** Backend: publish the contract (documentation of shipped shapes).
- **ST-03** Knowledge: R1 migration (against **live** schema names — research risk 5).
- **ST-08a** Backend: clarify unit tests (the free, pure-prompt halves).
- **ST-09** Backend: cost/cache/latency instrumentation (must land **before** any
  quota day, or the batches produce transcripts without numbers).
- **ST-12 / ST-13** Test: refusal + citation regression/reachability harness work.
- **ST-15** Eval: scoring harness and protocol (no quota until ST-16).
- **ST-06** (human-gated): **start photo collection now** — the brief says so
  explicitly; it gates ST-07 here and Run C's criterion 3. Add the missing
  `SETUP-BLOCKERS.md` entry.

**Wave 1 — serialized on Wave 0:**

- **ST-04** Backend: thread `documentIds` through `diagnose()`/`retrieve()`
  (needs ST-03). **ST-02** (unit-required gate) lands with it — same contract
  change, one review.
- **ST-05** Backend: vision endpoint (needs only the shipped adapter; can proceed
  in parallel with ST-04, but its "narrows retrieval" half needs ST-04).

**Wave 2 — the quota days (Q1–Q4 above), strictly after ST-09** and, for Q2–Q4,
after ST-04/ST-05, so every burned request produces scoped, instrumented evidence.
The top-15 batch runs **unit-scoped** — that is R1's whole point for criterion 3.

**Wave 3 — H9-gated, does not block Waves 1–2:**

- **ST-11** Backend: Edge Function wrapper + deployed-runtime timing. If H9 is
  still open at measurement time, ST-10 reports dev-server numbers as a proxy and
  flags the gap (see Infeasibility flags).

**Wave 4 — scoring (ST-16 Eval, ST-10 write-up), then Stage 5/5.5 verdicts.**

---

# Stories

Global Definition of Done, applying to every story in addition to its own:
`npm run lint`, `npm run build`, `npm test` exit 0 with **no new warnings**
(before/after counts — baseline is 0/0 per research §5); no secrets committed;
evidence (command, exit code, output) recorded in the owning stage's artifact;
work on a `stage/<name>` branch, PR per pipeline rules.

---

## ST-01 · Publish the `/diagnose` contract, precisely

- **Mode:** VERIFY-AND-CLOSE
- **User story:** As the Run C frontend agent, I want the complete request,
  response, error, and refusal contract published in `03-backend.md` so that I
  never have to guess a field name against source code.
- **Acceptance criteria:**
  - [ ] `03-backend.md` documents, with a JSON example each: the request shape
        (`symptom`, `equipment`, `history`, and ST-04's `documentIds`), the four
        response kinds (`answer`, `clarify`, `refusal`, `no_documentation`), the
        citation payload (`{source_document, page, claim, ordinal, chunk_id,
        snippet, verified}`), the wire error shape (`{status, message,
        providerBlocked?, blockReason?}`), and ST-02's unit-required shape.
  - [ ] The three-shapes invariant is stated as a table: which code path produces
        *ours* / *theirs* / *transport*, with file:line references — and a test
        listed against each path proving no shape is produced by another's code
        (existing tests at `lib/diagnose.test.mjs` / `lib/safety.test` region
        cited by name).
  - [ ] The streaming seam (OQ4) is documented: the core emits a complete
        validated object; Run C streams at the transport layer post-validation.
        Buffered behavior verified by the existing serve path; no reasoning
        change proposed. **Assumption on OQ4: accept the current shape** (default).
  - [ ] `POST /resolve-unit` and ST-05's vision endpoint contracts appear in the
        same document (cross-referenced, not duplicated).
- **Owner:** Backend
- **Dependencies:** ST-02 and ST-04 field names must be settled (can draft now,
  finalize when they land). ST-05 section lands with ST-05.
- **Priority:** Critical (criterion 1 is the thing Run C builds on)
- **Definition of Done:** Criterion 1's sentence is literally satisfiable: a
  reader of `03-backend.md` alone can construct every request and parse every
  response without opening a source file.

## ST-02 · Close the CONTRACT MISMATCH: unit-required on `/diagnose`

- **Mode:** BUILD (small)
- **User story:** As the system owner, I want the server to stop generating
  answers that the client's unit gate is guaranteed to discard, so that quota is
  not wasted and an ungrounded answer is never one client bug away from rendering.
- **Acceptance criteria:**
  - [ ] A unitless (no `equipment`/`documentIds`) **non-hazard** request to
        `/diagnose` returns a distinct machine-readable "unit required" shape
        **without** calling retrieval or the model. Unit test asserts zero
        provider calls (stub/counter).
  - [ ] A unitless **hazard** request still returns the deterministic refusal
        (`kind: 'refusal'`), preserving U7's safety escape
        (`app/lib/diagnose.ts:207-213` keeps working unchanged). Unit test.
  - [ ] The unit-required shape is none of the other three shapes (not a refusal,
        not a provider block, not a transport error) and is documented in ST-01.
  - [ ] Run B's own test paths can still exercise unscoped diagnosis explicitly
        (per OQ1's default: absent scope is legal **only** on test paths — a
        documented flag/env, not the default behavior of the app path).
  - [ ] No app code changes in this run (the app already gates client-side; Run C
        adopts the new shape).
- **Owner:** Backend
- **Dependencies:** None to start; ships with ST-04 as one contract change.
  **Assumption on OQ1: client supplies `documentIds` from `/resolve-unit`;
  server treats absence as unit-required on the app path** (research default).
- **Priority:** High
- **Definition of Done:** The filed CONTRACT MISMATCH is marked closed in
  `03-backend.md` with the test names as evidence.

## ST-03 · R1: unit-scoped retrieval in the database

- **Mode:** BUILD
- **User story:** As the diagnostic core, I want `match_chunks` to accept a
  `filter_document_ids` parameter so that retrieval for an identified unit never
  surfaces another manufacturer's manual.
- **Acceptance criteria:**
  - [ ] A committed `sql/00X` migration adds `filter_document_ids` per
        `.pipeline/R1-unit-scoped-retrieval.md`, **dropping the function first**
        (PGRST203 gotcha) and written against **live** column names, not
        `sql/003` (research risk 5 — the drift is documented, not rediscovered).
  - [ ] Filtering happens in SQL, not client-side post-filtering (the trap the R1
        doc names): passing N document IDs returns up to `match_count` rows all
        from those documents, verified live against the 3,787-chunk corpus.
  - [ ] `null`/empty filter preserves current unscoped behavior exactly — the
        14-probe retrieval smoke set still scores ≥ its current 11/14 with no
        regression (`tests/fixtures/retrieval-smoke-results.json` re-run and
        committed).
  - [ ] Scoped spot-check: a Trane-phrased query filtered to Trane document IDs
        returns zero Carrier chunks (the R01/R05/R11 cross-manufacturer misses
        are the test material).
  - [ ] `025-knowledge.md` updated with the new RPC signature; smoke set re-run
        recorded per the brief's Knowledge note.
- **Owner:** Knowledge
- **Dependencies:** None. Highest-leverage single change for criterion 3.
- **Priority:** Critical
- **Definition of Done:** Migration applied to the live instance, smoke set
  green, contract update committed. Backend unblocked on ST-04.

## ST-04 · Thread unit scope through `diagnose()`

- **Mode:** BUILD
- **User story:** As a technician who has identified my unit, I want diagnosis
  grounded only in that unit's documentation so that the steps and citations I
  get are for the machine in front of me.
- **Acceptance criteria:**
  - [ ] `/diagnose` accepts optional `documentIds: string[]`;
        `retrieve()`/`diagnose()` pass it to `filter_document_ids` (OQ1 default).
        Unit test: the scope reaches the RPC call arguments.
  - [ ] `/resolve-unit`'s `documentIds` output composes: verdict → scoped
        diagnosis works end to end in one live transcript (piggybacked on a Q2/Q3
        batch call, not extra quota).
  - [ ] The cross-manufacturer contamination case is retested: the live Trane
        phrasing that previously cited 3/4 Carrier manuals
        (`.pipeline/03-backend.md:316-321`), run unit-scoped, cites only Trane
        documents. Transcript committed as a fixture.
  - [ ] Unknown/invalid document IDs fail loudly (error shape), never silently
        unscoped — fail-closed per house style. Unit test.
  - [ ] Empty-after-filter retrieval produces the no-documentation shape, not an
        invented answer. Unit test.
- **Owner:** Backend
- **Dependencies:** ST-03. Ships with ST-02.
- **Priority:** Critical
- **Definition of Done:** U5's declared seam
  (`.pipeline/03-backend.md:377`) is real: `documentIds` in, scoped citations
  out, contract published via ST-01.

## ST-05 · Nameplate vision endpoint

- **Mode:** BUILD
- **User story:** As a technician at the unit, I want to post a nameplate photo
  and get back manufacturer and model so that I don't have to transcribe a
  weathered plate by hand.
- **Acceptance criteria:**
  - [ ] `POST /identify-unit` on the existing front door (`scripts/serve.mjs`),
        logic in `lib/` beside `units.mjs` (OQ2 default), accepting an image and
        returning `{manufacturer, model, confidence}` plus the error shapes from
        ST-01. Uses the shipped `imagePart()` (`lib/providers/gemini.mjs:82-84`)
        — currently zero callers — via `inlineData`.
  - [ ] Server-side downscaling before the provider call (M11), with the size
        cap chosen on evidence and the decision comment citing the measurement
        (house style). Unit-testable pure function for the resize decision.
  - [ ] Composes with `/resolve-unit` for the coverage verdict — matching logic
        is **not** duplicated; the endpoint returns or chains to the same
        `classifyUnit` result, yielding `documentIds` for ST-04.
  - [ ] Provider block and transport failures surface as *theirs*/*transport*
        shapes, never as a fabricated identification. Unit test with stubbed
        adapter.
  - [ ] No image bytes or API keys logged; `verify:secrets` still green.
- **Owner:** Backend
- **Dependencies:** ST-01 (contract slot), ST-04 (for the narrowing half).
  Accuracy measurement is ST-07's, not this story's.
- **Priority:** High
- **Definition of Done:** Endpoint callable with a local test image (any
  nameplate-like photo) returning structured output; contract published;
  criterion 7's machine half ready for ST-07's photos.

## ST-06 · Ten real nameplate photos (human-gated collection)

- **Mode:** BUILD (human-gated — no agent can do the collection)
- **User story:** As the eval of criterion 7, I need ten real nameplate photos
  (Trane Precedent and Carrier 48/50, mixed lighting and angles) so that vision
  accuracy is measured on reality, not stock imagery.
- **Acceptance criteria:**
  - [ ] `SETUP-BLOCKERS.md` gains the missing entry (research §2c item 1) with
        the spec: ≥10 photos, both manufacturers represented, mixed
        lighting/angles, stored where tests can read them
        (`tests/fixtures/nameplates/` proposed), **no EXIF/location data
        committed**.
  - [ ] Photos present in the repo (or a documented local path if size forbids
        committing), each with a ground-truth `{manufacturer, model}` manifest
        entry.
  - [ ] Flagged at every stage handoff until done — this gates Run B criterion 7
        **and** Run C criterion 3.
- **Owner:** Test (tracking and manifest); the collection itself is the project
  owner's, and started **now** per the brief's Verification section.
- **Dependencies:** None. Nothing else should wait on it except ST-07/Q4.
- **Priority:** Critical (sole human gate on criterion 7)
- **Definition of Done:** 10 photos + ground-truth manifest available to ST-07.

## ST-07 · Vision accuracy: ≥8/10, tabulated, and narrowing demonstrated

- **Mode:** MEASURE
- **User story:** As the run's gatekeeper, I want vision accuracy measured per
  photo against ground truth so that criterion 7 is a number, not an impression.
- **Acceptance criteria:**
  - [ ] All 10 photos posted **directly to the endpoint** (no UI — that is Run
        C's re-verification); per-photo table committed: photo, expected,
        returned manufacturer/model, correct?, latency. **≥8/10 correct on both
        fields** passes; the actual number is recorded either way.
  - [ ] "Identified model demonstrably narrows retrieval": for ≥1 correctly
        identified photo, the resulting `documentIds` scope changes retrieval
        output vs unscoped for the same symptom (diff committed) — one mechanism
        serving criterion 7 and U5 both.
  - [ ] Run within Q4's quota budget (~14 requests incl. retries); request count
        recorded.
- **Owner:** Test
- **Dependencies:** ST-05, ST-06, ST-04 (narrowing half). Scheduled as quota day
  Q4.
- **Priority:** High
- **Definition of Done:** Criterion 7's table exists with a pass/fail verdict
  and the narrowing diff.

## ST-08 · Clarifying questions, both directions, proven

- **Mode:** VERIFY-AND-CLOSE (parts shipped; joints never exercised)
- **User story:** As a technician with a vague symptom, I want one targeted
  question and a diagnosis that continues correctly after I answer — and as one
  with a specific symptom, I want no needless stalling.
- **Acceptance criteria:**
  - [ ] **(a, free)** Unit tests: `buildPrompt` renders `history` correctly for
        the ask → answer → continue shape; adapter role-merging
        (`lib/providers/gemini.mjs:60-79`) covered for that exact sequence;
        `validateAnswer` continues to pass `clarify` citation-free.
  - [ ] **(b, live, Q1)** One committed transcript: `"it's not cooling"` (+ unit
        scope) → exactly one `kind: 'clarify'` with a single targeted question →
        second call carrying the first turn's `history` + the user's answer →
        a `kind: 'answer'` that is a continuation of the **same** diagnosis
        (references the clarified fact; ranked, cited steps; passes
        `validateAnswer`). This has **never happened** before this story.
  - [ ] **(c, live, Q1)** The negative direction: a sufficiently specified
        symptom (e.g. the proven `low suction on a Carrier 48LC`) returns
        `kind: 'answer'` directly, not a clarify. One transcript.
  - [ ] Both live transcripts captured as fixtures so Stage 5 can regression-
        check the *shape* without quota.
  - [ ] If (b) fails first try (research risk 4), the fix is prompt scaffolding
        in `buildPrompt` — not a weakening of validation — and the failing +
        passing transcripts are both kept.
- **Owner:** Backend
- **Dependencies:** (a) none; (b)/(c) after ST-09 (so the calls are
  instrumented) — quota day Q1. App-side clarify handling is **Run C's**; this
  story proves the server half only.
- **Priority:** Critical (criterion 6, both halves)
- **Definition of Done:** Criterion 6 fully evidenced: tests green, two live
  transcripts committed, fixtures in place.

## ST-09 · Cost, cache, and latency instrumentation (M15/M16)

- **Mode:** BUILD
- **User story:** As the budget owner, I want every diagnosis to report its
  tokens, cache hits, projected cost, and wall-clock so that criterion 9 is read
  off logs instead of reconstructed.
- **Acceptance criteria:**
  - [ ] Adapter `usage` surfaces `cachedContentTokenCount` (read nowhere today)
        alongside input/output/total. Unit test with a stubbed response body.
  - [ ] `serve.mjs` logs per request: route, duration ms, token counts, cached
        tokens, retry count, and projected cost at published Gemini Flash + Voyage
        rates (rates as named constants with a source comment). No secrets, no
        symptom text beyond a truncated preview in logs.
  - [ ] A small script or log-parser summarizes a batch into p50/p95 latency and
        mean cost with/without cache hits — the tool ST-10 runs.
  - [ ] Structural caching accommodation (constant `SYSTEM` first) is preserved;
        any prompt reordering justifies itself against cache behavior in a
        decision comment.
  - [ ] Zero live calls needed to land this story (stub-tested); it must merge
        **before quota day Q1**.
- **Owner:** Backend
- **Dependencies:** None. Blocks Q1–Q4 usefulness.
- **Priority:** Critical (every quota day spent without it is evidence lost)
- **Definition of Done:** One stub-driven end-to-end log line shows every field;
  summarizer emits p50/p95 from a fixture log.

## ST-10 · Criterion 9: the numbers

- **Mode:** MEASURE
- **User story:** As the owner, I want per-diagnosis cost with caching on and
  off, p50/p95 latency, and the margin against the 150 s cap, so that Run C is
  built on measured headroom, not hope.
- **Acceptance criteria:**
  - [ ] p50/p95 server-side latency from ≥15 instrumented diagnoses (the Q2/Q3
        batch — shared transcripts, no extra quota) reported as numbers.
  - [ ] Per-diagnosis cost with and without prompt caching. **Assumption:**
        Gemini's implicit caching cannot be switched off per request; "without
        caching" is computed from token counts at full price vs the
        cache-discounted projection, plus a cold-vs-warm pair measured on Q1.
        Method stated alongside the numbers.
  - [ ] Slowest path (vision + retrieval + reasoning) timed end to end at least
        twice (Q4 piggyback); wall-clock margin against 150 s stated. If H9 is
        still open, numbers come from `npm run serve` and are **flagged as a
        dev-runtime proxy** (see Infeasibility flags) — the flag is part of the
        deliverable, not a waiver.
  - [ ] The 60 s app-client timeout (`app/lib/diagnose.ts:131`) vs measured p95
        is explicitly compared; if p95 > 60 s, that is a filed finding for Run C
        (client change), not a Run B code change.
  - [ ] Projected cost of a full eval run stated; if > ~$25, stop and re-check
        context construction per the brief (expected to pass trivially at Flash
        prices — state the number anyway).
- **Owner:** Test (numbers and write-up), Backend (any instrumentation gaps found)
- **Dependencies:** ST-09; Q1–Q4 executed; ST-11 if H9 clears in time.
- **Priority:** High
- **Definition of Done:** Criterion 9's four numbers (cost×2, p50/p95, margin,
  eval projection) appear in `05-test-report.md` with method and raw-log
  references.

## ST-11 · Edge Function deployment path (H9-gated)

- **Mode:** BUILD
- **User story:** As the deploy target's owner, I want the core running as a
  Supabase Edge Function so that the 150 s constraint is measured where it
  actually binds.
- **Acceptance criteria:**
  - [ ] A thin Deno wrapper around `diagnose()` (the core is transport-agnostic
        by design — this must stay a wrapper, not a rewrite); import-graph
        Deno-compatibility **proven by execution**, not asserted
        (the exact gap `A-02-user-stories.md:621` flagged).
  - [ ] Deployed to the live project; `/health`-equivalent and one scoped
        diagnosis succeed from the deployed URL (1–2 quota requests, folded into
        a scheduled day).
  - [ ] Wall-clock of that deployed call recorded and handed to ST-10 as the
        real-runtime data point.
  - [ ] Secrets via Supabase function env, never in code; `verify:secrets` green.
  - [ ] If **H9 (access token) is still open**, this story is BLOCKED-not-FAIL:
        the wrapper and a local `deno` execution proof still land; deployment is
        flagged as the remaining human gate.
- **Owner:** Backend
- **Dependencies:** H9 (human). Does not block any other story.
- **Priority:** Medium (the brief demands design-and-measure against the cap;
  the dev-proxy path plus this wrapper satisfies "design for it" even if
  deployment waits)
- **Definition of Done:** Wrapper committed and executed under Deno; deployed
  measurement done or H9 explicitly re-flagged to the owner.

## ST-12 · Refusal path: mechanical 12/12 + loud reachability

- **Mode:** VERIFY-AND-CLOSE
- **User story:** As the safety owner, I want the refusal guardrail's coverage to
  break loudly if it ever stops being reachable, so that a refactor cannot
  silently put the model in front of the gate.
- **Acceptance criteria:**
  - [ ] Existing 12-probe (≥4 phrasings × 3 categories) + 5 must-not-refuse unit
        coverage re-confirmed green and mapped probe-by-probe to criterion 5 in
        the test report — including the expertise/"theoretically" framings.
  - [ ] Harness-level reachability check added (research §2c item 7): a request
        through the **serve path** (not just the lib) hits `classifyHazard`
        before any provider call — asserted via provider-call counter/stub, so a
        route refactor that bypasses the gate fails CI loudly.
  - [ ] `refusalLeaksProcedure()` post-check asserted reachable the same way.
  - [ ] Each refusal body machine-checked: points to standard safety procedure,
        contains no step-by-step procedure (leak detector), `meta.category`
        populated — 12/12, zero Gemini quota (no model call by design).
  - [ ] Confirms unitless hazard requests still refuse after ST-02 (shared test
        with ST-02's criterion).
- **Owner:** Test
- **Dependencies:** ST-02 landed (for the unitless case). Zero quota — any day.
- **Priority:** Critical (any leak is a run-blocking Critical per criterion 5)
- **Definition of Done:** Criterion 5's mechanical half and criterion 10's
  refusal-coverage clause evidenced; judgment half handed to ST-16.

## ST-13 · Citation propagation: zero-uncited, checked by machine

- **Mode:** VERIFY-AND-CLOSE
- **User story:** As the correctness owner, I want every emitted claim
  mechanically proven to carry a resolvable citation, so that criterion 2 is a
  checker's verdict, not a reviewer's impression.
- **Acceptance criteria:**
  - [ ] Existing drop-semantics unit tests (fabricated index, count divergence,
        all-dropped degradation) re-confirmed and named in the report.
  - [ ] A mechanical checker runs over the Q2/Q3 top-15 transcripts: every
        diagnostic step carries ≥1 citation whose `source_document` + `page`
        resolve against `public.documents`/`chunks`, and whose `chunk_id` exists.
        **Zero uncited claims across the top-15** or the run fails criterion 2.
        Checker + results committed.
  - [ ] Harness-level reachability: a serve-path answer response is asserted to
        have passed `validateAnswer` (e.g. `verified: 'exact'` present on every
        citation), so the validator can never be silently bypassed.
  - [ ] The checker is reusable by the loop stage on later rounds without quota
        (reads transcripts, not the API).
- **Owner:** Test
- **Dependencies:** Q2/Q3 transcripts (Eval-run batch); checker itself needs
  nothing and lands in Wave 0.
- **Priority:** Critical (criteria 2 and 10)
- **Definition of Done:** Checker output over 15/15 transcripts committed with
  exit code 0 and zero uncited claims, or failures filed as Critical.

## ST-14 · Coverage edges admitted, 5/5

- **Mode:** VERIFY-AND-CLOSE
- **User story:** As a technician with equipment Ductective doesn't cover, I want
  an honest "no documentation for that" so that I never act on an invented
  answer.
- **Acceptance criteria:**
  - [ ] Five out-of-scope symptoms (e.g. Daikin VRV, Lennox split, York chiller,
        residential mini-split, Goodman furnace — final list is Test's, all
        outside Trane Precedent / Carrier 48/50 / PT charts) posted to the serve
        path: **5/5 return the no-documentation shape**, verbatim fixed copy
        (`lib/diagnose.mjs:252-256`), zero fabricated steps, zero citations.
  - [ ] Asserted that **no Gemini call occurred** for empty-retrieval cases
        (provider counter) — the honesty is structural, and the probes cost only
        Voyage embeds.
  - [ ] The model-declared `no_documentation` path (retrieval non-empty but
        insufficient) covered by the existing unit test, named in the report.
  - [ ] Scoped variant: out-of-scope unit + `documentIds` empty-after-resolve
        behaves identically (ties to ST-04's empty-scope criterion).
- **Owner:** Test
- **Dependencies:** ST-02/ST-04 landed (for the scoped variant). Effectively
  zero quota — any day.
- **Priority:** High (criterion 8)
- **Definition of Done:** 5/5 table in `05-test-report.md` with response bodies.

## ST-15 · The scoring harness (eval's first real tooling)

- **Mode:** BUILD
- **User story:** As the eval stage, I want a scoring harness over captured
  transcripts so that scoring is repeatable and never mixed with generation.
- **Acceptance criteria:**
  - [ ] Harness reads the Q2/Q3 transcripts + `tests/fixtures/scenario-set.json`
        and produces per-fault records: correctness verdict (competent-tech,
        **including step ordering** — a right step ranked fourth that belongs
        first is a partial failure), per-claim citation-validity slots, and the
        actual output quoted for every failure.
  - [ ] Citation-validity sampling protocol implemented: select **≥30 claims
        spanning all top-15 faults**, resolve each to its source page (via
        `chunk_id`/`page` — offline, zero quota), record supports /
        does-not-support / **contradicts** per claim. A `contradicts` anywhere is
        auto-flagged Critical regardless of the overall rate.
  - [ ] Refusal-judgment protocol: the 12 refusal bodies scored for "points to
        standard safety procedure, no procedure content" — the judgment half of
        criterion 5.
  - [ ] Provider-block counting per category folded in (the block-rate number
        M12 left as the open question; 0/15 in M12's run is the prior). If
        blocks fire on ordinary diagnostics, that is an **owner finding**, not a
        prompt-tuning task.
  - [ ] Hard rule encoded in the harness docs: **eval does not tune the KB, the
        prompt, or its own scenarios to pass** — scenario disagreements are
        filed, per the brief. Scenario `competentTechWouldDo` fields get
        validated during scoring, not rewritten to match output.
- **Owner:** Eval
- **Dependencies:** None to build (fixture-driven); consumes Q2/Q3 to run.
- **Priority:** Critical
- **Definition of Done:** Harness runs end-to-end on a synthetic fixture
  transcript producing the full report shape, before any real scoring.

## ST-16 · The scored run: baseline numbers, recorded precisely

- **Mode:** MEASURE
- **User story:** As the project owner, I want the first scored eval — criteria
  3, 4, and the judgment half of 5 — recorded precisely even where
  disappointing, so that every later round has a baseline to beat.
- **Acceptance criteria:**
  - [ ] Executed per the quota schedule above (Q2 + Q3 generation, offline
        scoring after) — **owner asked once, at kickoff, to accept the ~3–4
        elapsed quota days** (OQ3 default; a tier change is never proposed).
        Per-day request counts recorded in `055-eval.md`.
  - [ ] Criterion 4: all top-15 scored, target **≥12/15** correct including
        ordering; every failure listed with actual output quoted. The number is
        recorded whether or not it meets the bar.
  - [ ] Criterion 3: ≥30-claim sample scored, target **≥90%** supporting; any
        contradicting citation filed Critical individually. Both the rate and
        the per-claim table recorded.
  - [ ] Criterion 5 (judgment half): 12/12 refusal bodies scored as safety-
        procedure-pointing with zero procedural leakage; any leak filed Critical
        and run-blocking.
  - [ ] Provider block rate per category reported (target: a number, not a
        verdict).
  - [ ] Generation used the unit-scoped path (ST-04) — scoping is part of what
        the baseline measures; the artifact says so explicitly.
  - [ ] The provisional-bar caveat restated in the artifact: P1.5's tech
        overrides these scores; scenario disagreements fix the scenario. If a
        scenario exercises YSC/YHC series numbers and misses, file it to
        Knowledge per OQ5's default (manifest metadata) rather than scoring
        around it.
- **Owner:** Eval
- **Dependencies:** ST-15, ST-04, ST-09; quota days Q2/Q3; ST-13's checker runs
  over the same transcripts first (a transcript failing the mechanical check is
  fixed before judgment scoring wastes effort on it).
- **Priority:** Critical (three acceptance criteria live here)
- **Definition of Done:** `055-eval.md` carries the three numbers, the failure
  quotes, the block rate, and the per-day quota ledger.

---

## Frontend — nothing to do (explicit)

Per the brief's stage notes: **there is no UI in Run B.** Stage 4's agent should
write "nothing to do" in `04-frontend.md` and hand off. Two temptations to refuse,
both already assigned elsewhere: rendering the unit-required shape (Run C, which
also owns adopting it in `app/lib/diagnose.ts`), and sending `history` from the
app (Run C's clarify UI). If any story above appears to need a screen, that is a
scoping error in this file — say so in the artifact rather than building it.

---

## Criterion → story map (brief §Acceptance criteria)

| Criterion | Stories | Mode |
|---|---|---|
| 1 — contract published | ST-01 (+ ST-02/04/05 field sources) | VERIFY-AND-CLOSE |
| 2 — zero uncited claims | ST-13 (checker) over ST-16's transcripts | VERIFY + MEASURE |
| 3 — citation validity ≥90%, contradicts = Critical | ST-15, ST-16; ST-03/ST-04 (contamination fix) | MEASURE |
| 4 — correctness ≥12/15 incl. ordering | ST-15, ST-16 | MEASURE |
| 5 — refusals 12/12 | ST-12 (mechanical) + ST-15/ST-16 (judgment) | VERIFY + MEASURE |
| 6 — clarify, both directions | ST-08 | VERIFY-AND-CLOSE |
| 7 — nameplate vision ≥8/10 + narrowing | ST-05, ST-06 (human-gated), ST-07 | BUILD + MEASURE |
| 8 — coverage edges 5/5 | ST-14 | VERIFY-AND-CLOSE |
| 9 — cost & latency numbers | ST-09, ST-10, ST-11 | BUILD + MEASURE |
| 10 — tests on refusal + citation paths, clean toolchain | ST-12, ST-13 + global DoD | VERIFY-AND-CLOSE |

Every criterion maps to at least one story; no story exists without a criterion or
a filed item (ST-02 ← CONTRACT MISMATCH; ST-11 ← Edge cap constraint) behind it.

---

## Assumptions on OPEN QUESTIONs (defaults adopted, per research §7)

| OQ | Assumption built on | Where |
|---|---|---|
| OQ1 | Client supplies `documentIds` from `/resolve-unit`; server treats absence as unit-required on the app path, unscoped only on flagged test paths | ST-02, ST-04 |
| OQ2 | Vision is `POST /identify-unit` on the same front door, composing with `/resolve-unit` | ST-05 |
| OQ3 | Multi-day scored run with a per-day ledger; owner asked once to accept elapsed time; no tier change proposed by any agent | Sequencing plan, ST-16 |
| OQ4 | Current buffered, complete-validated-object shape accepted; streaming is Run C transport; seam documented | ST-01 |
| OQ5 | YSC/YHC aliases stay a Knowledge manifest question, raised only if an eval scenario hits it | ST-16 |

## Infeasibility flags (brief criteria vs research reality — surfaced, not hidden)

1. **Criterion 9's "margin against the 150 s cap" cannot be honestly measured
   without H9.** The cap binds on the Edge runtime, which has never executed the
   core. Until the human-gated access token lands, ST-10 reports dev-server
   (`npm run serve`) numbers explicitly labeled a proxy, and ST-11 proves Deno
   compatibility locally. This satisfies "design for it, measure against it" in
   letter only — the flag ships in the report either way.
2. **Criterion 7 is gated on a not-started human task.** The ten photos do not
   exist and no agent can create them (ST-06). If they are not collected by Q4,
   criterion 7 is BLOCKED (not FAIL) at Stage 5, per house rules — and Run C's
   criterion 3 inherits the same gate. Started-now is the mitigation the brief
   itself orders.
3. **Criteria 3+4 cannot be generated in one day on the fixed free tier** (20
   req/day/model, retries counted). Not infeasible — re-scheduled: the multi-day
   plan above is the design, with the owner's one-time sign-off on elapsed time.
   Any story that assumes a single-session eval is wrong by construction.
4. **Criterion 9's "caching off" is not a switch Gemini exposes.** Implicit
   caching cannot be disabled per request; ST-10's with/without comparison is
   computed from measured token counts plus a cold/warm pair, with the method
   stated. This is the honest available measurement, flagged rather than
   presented as an A/B toggle.
