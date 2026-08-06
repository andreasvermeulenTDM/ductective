# 01 — Research · Run B: the diagnostic core (P1.3)

Stage 1 artifact for `.pipeline/00-brief.md` (Run B). Run A's research artifact is
archived at `.pipeline/runs/A-01-research.md`; this file supersedes it for Stages
2–5. Everything below was read from the working tree at `main` (`e5f3760`) on
6 Aug 2026, with lint/build/test executed fresh — nothing is carried forward on
trust from an earlier artifact unless marked as such.

**The single most important fact about Run B: it is not greenfield.** A large
fraction of the brief's in-scope list was built during Run A's S4 pass and the
Gemini migration (M-stories, `.pipeline/02-user-stories.md` Addendum B), is live
on `main`, and is exercised by 80 passing unit tests and the Stage 5 harness
(46 PASS · 0 FAIL). Section 2 therefore maps the surface area in three explicit
states — **EXISTS AND VERIFIED**, **EXISTS BUT UNMEASURED**, and **MISSING** —
because the costliest failure available to Stage 2 is writing stories for things
that already work, and the second-costliest is assuming something works because
code for it exists.

---

## 1. Stack & architecture

| Layer | What | Where |
|---|---|---|
| Runtime | Node ≥ 22, ESM `.mjs`, `"type": "module"` | `package.json` (engines, scripts) |
| Server deps | Exactly one runtime dependency: `@supabase/supabase-js` | `package.json:27-29` |
| Reasoning | Gemini Flash, pinned `gemini-3.6-flash`, raw `fetch` — no SDK | `lib/providers/gemini.mjs:28` |
| Embeddings | Voyage `voyage-4-large`, 1024 dims, raw `fetch` | `lib/clients.mjs:76-83` |
| Store/retrieval | Supabase Postgres 17.6 + pgvector 0.8.2; RPCs `match_chunks` / `match_chunks_hybrid` | `sql/001`–`006`, live instance |
| App | Expo SDK 54 / RN, TypeScript 5.9 — pinned to the test iPhone's Expo Go | `app/`, `app/AGENTS.md` |
| Lint/build/test | `eslint .` (flat config) · `tsc --noEmit` in `app/` · `node --test` | `eslint.config.mjs`, `package.json:10-14` |

**Module layout and the load-bearing seam.** `lib/diagnose.mjs` is the diagnostic
core and is deliberately transport-agnostic — it knows nothing about HTTP
(`lib/diagnose.mjs:1-26`). Two front doors are designed to call the same
`diagnose()`:

- `scripts/serve.mjs` — `npm run serve`, plain Node `http` on `0.0.0.0:8787`
  (`DIAGNOSE_PORT` overrides). **This is the path that works today.** Routes:
  `GET /health`, `POST /diagnose`, `POST /resolve-unit` (`scripts/serve.mjs:57-95`).
- A Supabase Edge Function wrapper — **does not exist.** See §2 MISSING.

The app consumes the core through `app/lib/diagnose.ts` when
`EXPO_PUBLIC_DIAGNOSE_URL` is set (`app/lib/diagnose.ts:116-120`); unset, the app
falls back to `app/lib/mockDiagnostics.ts` behind a PROTOTYPE banner
(`app/lib/store.ts:161-165`). Provider selection sits behind
`lib/clients.mjs:178-190` (`complete()`, `LLM_PROVIDER`, fail-closed stubs behind
`ALLOW_STUBS`); nothing above the adapter learns the provider's name.

**The core's pipeline, in order** (`lib/diagnose.mjs:268-361`):

1. **Safety gate** — deterministic, before a token is spent
   (`lib/safety.mjs:105-120` `classifyHazard`, called at `lib/diagnose.mjs:275`).
2. **Retrieve** — `match_chunks` over pgvector, `TOP_K = 8`, vector-only by
   default (`lib/diagnose.mjs:32,75-102`); `RETRIEVAL_MODE=hybrid` opts into
   `match_chunks_hybrid`, which measured worse and stays off (comment at
   `lib/diagnose.mjs:48-74`, evidence `.pipeline/03-backend.md:269-309`).
3. **No-documentation check** — empty retrieval answers honestly and never calls
   the model (`lib/diagnose.mjs:292-299`, fixed copy at `:252-256`).
4. **Generate** — structured JSON via `responseSchema` (`RESPONSE_SCHEMA`,
   `lib/diagnose.mjs:153-174`), `temperature 0.2`, `maxOutputTokens 4096`
   (raised from the adapter default after a measured truncation defect,
   `:304-315`).
5. **Validate** — `validateAnswer()` (`lib/diagnose.mjs:191-246`): the model
   cites sources **by index only** (`buildSources`, `:134-136`); an index that
   does not resolve drops the step; all-dropped degrades to no-documentation.
   The model is never in a position to write a document name or page number.

---

## 2. Relevant surface area — what exists, what is measured, what is missing

### 2a. EXISTS AND VERIFIED (do not rebuild; regression-protect)

**The `diagnose` contract and its three response shapes.** The brief's Amendment-1
constraint (ours/theirs/transport, `.pipeline/00-brief.md:73-90`) is implemented
end to end:

- *Our refusal*: `kind: 'refusal'`, HTTP 200, body from `refusalBody()`
  (`lib/safety.mjs:131-140`), post-checked by `refusalLeaksProcedure()`
  (`:149-151`, invoked at `lib/diagnose.mjs:278-280`). No model call, no
  citations, `meta.category`/`meta.trigger` populated.
- *Provider block*: adapter surfaces `blocked`/`blockReason` first-class
  (`lib/providers/gemini.mjs:99-107`, checked for both `promptFeedback.blockReason`
  and `finishReason ∈ {SAFETY, PROHIBITED_CONTENT, BLOCKLIST}`); the core throws
  `DiagnoseError(502, …, {providerBlocked, blockReason})` (`lib/diagnose.mjs:329-334`);
  the server serializes `{status, message, providerBlocked, blockReason}`
  (`scripts/serve.mjs:85-94`); the app renders it as a retryable error, never as
  safety advice (`app/lib/diagnose.ts:41-76`).
- *Transport error*: `DiagnoseError` → `{status, message}` (`scripts/serve.mjs:86-90`).

**The refusal guardrail, tested at the brief's bar.** `classifyHazard` refuses on
ACTION verbs unconditionally and on DOMAIN nouns only with procedural intent
(`lib/safety.mjs:34-94`); framing ("I'm certified", "hypothetically") is never
consulted (`:26-29`). Unit tests cover all 12 probes from criterion 5 (≥4
phrasings × 3 categories) plus 5 must-NOT-refuse probes and the leak detector —
`lib/safety.test.mjs` region of `lib/diagnose.test.mjs` (13 named tests,
`lib/diagnose.test.mjs:53-166`; `.pipeline/03-backend.md:231-234` records 27
tests across the two acceptance-critical paths). Verified live: the
608-certification framing refused in 1 ms with no model call
(`.pipeline/03-backend.md:224-229`).

**Citation anchoring and propagation.** Source-index anchoring plus
`validateAnswer()` drop semantics (above); citations carry
`{source_document, page, claim, ordinal, chunk_id, snippet, verified:'exact'}`
(`lib/diagnose.mjs:229-243`). The snippet **is** the retrieved chunk — database
text, never model output — so `verified:'exact'` is structural
(comment `:235-239`). Persistence: `sql/006_citation_snippet.sql` added
`snippet`/`chunk_id`/`verified` to `public.citations`; the app persists citations
per message (`app/lib/store.ts:97-112`) and renders the passage in the citation
sheet (M10, `app/components/Citation.tsx`). Unit tests cover fabricated-index
drop, count-divergence, all-dropped degradation (`lib/diagnose.test.mjs:107-141`).

**Retrieval integration.** Consumes Run A's contract exactly as documented in
`.pipeline/025-knowledge.md` §5: query-type embedding asymmetry
(`lib/diagnose.mjs:78-81`), `out_*` column mapping (`:91-101`), scope filter
respected. Live corpus: 3,787 chunks / 3,328 in-scope / 24 documents, all
`voyage-4-large` (`025-knowledge.md:127-129`). **Smoke set: 11/14 correct
document AND page** as of 6 Aug 11:41 (`tests/fixtures/retrieval-smoke-results.json`,
summary `correctDocs: 11, correctPages: 11`) — up from the 10/14 recorded in
`025-knowledge.md:171-176` after the chiller-scope fix. Run A's ≥10-of-12 bar is
met; brief prerequisite satisfied. The three misses are R01, R05, R11 — all
Trane-side cross-manufacturer rank misses (`tests/fixtures/retrieval-smoke-set.json`),
not coverage gaps.

**Out-of-scope honesty.** Empty retrieval and all-dropped both emit the fixed
no-documentation copy (`lib/diagnose.mjs:252-256`), proven live on `Daikin VRV U1
code` (`.pipeline/03-backend.md:228`). The model can also declare
`kind: 'no_documentation'` and it is honoured (`lib/diagnose.mjs:209-217`,
test at `lib/diagnose.test.mjs:149`).

**Unit resolution (U4 backend half — Run C's seam, already served).**
`lib/units.mjs` classifies `{manufacturer, model}` against `public.documents`
into `covered | out_of_scope | unrecognised` with the Carrier `48/50XX`
family-expansion and PT-chart exclusion the real corpus requires
(`lib/units.mjs:40-44,54-68`); exposed as `POST /resolve-unit`
(`scripts/serve.mjs:71-75`); contract published at `.pipeline/03-backend.md:370-382`
(returns `documentIds` explicitly "feeds U5's filter once R1 lands"). 14 unit
tests (`lib/units.test.mjs`), five verdicts verified live
(`.pipeline/03-backend.md:405-415`).

**Live answer path.** One cited answer proven end to end: `low suction on a
Carrier 48LC` → 5 ranked steps, 5 citations, 0 dropped, 12.2 s, 5,593 tokens;
a Trane phrasing → 4 steps at 37.9 s (`.pipeline/03-backend.md:224-229,311-324`).
These are **two point samples, not a measurement** — see 2b.

### 2b. EXISTS BUT UNMEASURED / UNVERIFIED (the cheap-looking traps)

**M12 — the span/citation fidelity gate is still UNMEASURED.** Latest run
`spike/m12/out/gemini-3.6-flash.json` (5 Aug 19:23): span verification 6/6
(100%), chunk-id fabrication 0/6, provider blocks 0 — but only 8 of 15 faults
completed (6 × 429/502 errors) and 6 total claims, below the harness's own floor
of ≥80% faults and ≥20 claims (`spike/m12/README.md:118-127`), so the gate's
answer is `UNMEASURED`, exit 2. The thin signal is *good* (and note: the shipped
design anchors by source index, so M12's remaining live questions are the
**provider block rate** and **real token counts**, not span copying — the
snippet now comes from the database, `lib/diagnose.mjs:235-239`). No newer run
exists in `spike/m12/out/` as of this writing. Quota finding that killed the
runs: the adapter's internal 5xx retries also consume the daily cap — budget
~1.4 requests per fault (`spike/m12/README.md:106-116`).

**The clarifying-question CONTINUATION.** All the parts exist and none of the
joints are verified:

- The model can return `kind: 'clarify'`; `validateAnswer` passes it citation-free
  (`lib/diagnose.mjs:194-197`, test `lib/diagnose.test.mjs:142-147`).
- `diagnose({history})` accepts prior turns and `buildPrompt` prepends them
  (`lib/diagnose.mjs:138-150`); `serve.mjs:77-78` passes `history` through.
- The adapter merges consecutive same-role turns specifically for the
  ask → answer → continue shape (`lib/providers/gemini.mjs:60-79`).

**What has never happened:** a second call carrying the first turn's history
producing a correct continuation of the *same* diagnosis. No unit test, no live
transcript, no fixture. Nor is the negative half tested (a sufficiently
specified symptom must not stall on a question — criterion 6's second
direction). The app never sends `history` at all (`app/lib/diagnose.ts:147-151`
posts only `{symptom, equipment}`) and `app/lib/store.ts` has no clarify-turn
handling — that half is Run C's, but Run B owns proving the server side.

**Latency and the 150 s cap.** Two samples (12.2 s, 37.9 s). No p50/p95, no
distribution, no slowest-path (vision + retrieval + reasoning) measurement,
no stated margin. Criterion 9 is entirely open. Note the app client times out at
60 s (`app/lib/diagnose.ts:131`) — a server answer between 60 s and 150 s would
pass the brief and fail the only existing client.

**Provider block rate per category.** Probed with 4 prompts on 4 Aug — zero
blocks (`SETUP-BLOCKERS.md:154-158`) — explicitly recorded as "four prompts, not
a measurement". M12 owns the real number; see above.

**Cross-manufacturer citation contamination.** The live Trane answer cited 3/4
Carrier manuals — every citation resolves and generically supports its claim, so
no mechanical check catches it (`.pipeline/03-backend.md:316-321`,
`.pipeline/R1-unit-scoped-retrieval.md:60-65`). This is the failure mode
criterion 3's human sampling will hit first, and R1 (below) is the designed fix.

**`equipment` today is a prompt string, not a scope.** `diagnose()` accepts
`equipment` and prepends `EQUIPMENT: …` to the user turn
(`lib/diagnose.mjs:143`); it does not influence retrieval at all. The unit-first
seam (§2d) needs it to.

### 2c. MISSING (Run B's actual build list)

1. **Nameplate vision (M17, criterion 7).** No endpoint exists. The adapter
   exports `imagePart()` (`lib/providers/gemini.mjs:82-84`) and nothing calls it
   anywhere in `lib/`, `scripts/`, or `app/`. No server-side downscaling, no
   model-choice-on-evidence measurement, no "identified model narrows retrieval"
   demonstration. The ten real nameplate photos are a **human collection task,
   not started** (brief Verification; `SETUP-BLOCKERS.md` has no entry for it —
   it should gain one).
2. **R1 — unit-scoped retrieval.** `filter_document_ids` exists in no committed
   migration (grep of `sql/` is empty) and `retrieve()` takes no document
   filter (`lib/diagnose.mjs:77`). The full change request, with the
   client-side-filtering trap and the PGRST203 overload gotcha, is
   `.pipeline/R1-unit-scoped-retrieval.md`. Owner: Knowledge. U5 (and the
   contamination fix above) are blocked on it.
3. **Prompt caching measurement (M15) and cost distribution (M16).** The only
   caching accommodation is structural — constant `SYSTEM` first for implicit
   prefix caching (`lib/diagnose.mjs:109-113`). `usage` surfaces
   input/output/total only (`lib/providers/gemini.mjs:197-201`);
   `cachedContentTokenCount` is read nowhere in the repo. No per-diagnosis cost
   number exists with or without caching; criterion 9's cost half is fully open.
4. **The Edge Function deployment path.** `scripts/serve.mjs` is explicitly not
   it (`scripts/serve.mjs:8-17`). Blockers: H5/H6 deferred, no Supabase access
   token (proposed H9, `.pipeline/03-backend.md:335-343`). The core avoids
   `node:` builtins below the transport layer (raw `fetch` throughout), but
   Deno-compatibility of the import graph is asserted, never proven
   (`.pipeline/02-user-stories.md:621` flags exactly this).
5. **The scored eval run.** `tests/fixtures/scenario-set.json` is stood up and
   deliberately unscored — every `competentTechWouldDo` is `UNVALIDATED`, every
   `supportingSource` null, by eval-charter design (its `_comment`). No scoring
   harness exists. Criteria 3, 4, and the judgment half of 5 have never been
   attempted. **These become the project's baseline numbers** (brief
   Verification: "record them precisely even where they're disappointing").
6. **"Unit required" on `/diagnose`.** A filed CONTRACT MISMATCH, owner Backend:
   the server currently runs retrieval and the model for a unitless non-hazard
   before the app's gate discards the answer — wasted quota and one bug away
   from rendering an ungrounded answer (`app/lib/diagnose.ts:201-205`).
7. **Regression coverage that breaks loudly** if the refusal or citation path
   stops being reachable (brief note for Stage 5) — unit tests exist; the
   harness-level reachability checks are Stage 5's to add for Run B stories.

### 2d. The Run C seam — unit-first entry, and what Run B owes it

Run C's brief Amendment 1 is **in force** (owner sign-off 6 Aug,
`.pipeline/00-brief-run-c.md:159-266`): the app opens on unit selection
(`app/screens/UnitGate.tsx`, built in `cfb8536`), manual entry is a co-equal
front door (`93e0cab`), and no route reaches the core with `equipment` unset.
Stories U1–U8: `docs/phase1-story-map.md:930-1108`.

The seam, precisely:

- **U7's safety escape** already leans on Run B: the gate calls
  `refusalCheck()` → `POST /diagnose` and renders the reply only if
  `kind === 'refusal'` (`app/lib/diagnose.ts:207-213`). Refusal classification
  is the server's `classifyHazard`, deliberately not duplicated client-side.
  Run B must keep the deterministic pre-model refusal reachable without
  equipment — and should close MISSING item 6 so this stops burning quota.
- **U4's verdict** comes from `POST /resolve-unit`; its `documentIds` field is
  the declared input to U5's retrieval filter (`.pipeline/03-backend.md:377`).
  The frontend does not call it yet (no reference to `resolve-unit` in `app/`
  outside style names) — rendering the verdict is Run C's; keeping the contract
  stable is Run B's.
- **U5** = R1 (MISSING item 2) + `diagnose()` accepting the scope. The natural
  shape: `/diagnose` grows an optional `documentIds: string[]` (or resolves the
  unit server-side per request) and `retrieve()` passes it to
  `filter_document_ids` once R1 lands. `sessions.equipment` exists and is
  nullable (`sql/002_prototype_sessions.sql:24`); Addendum C's open question 1
  defaults it to `NOT NULL` eventually — session persistence itself is Run C's.
- **U6** (new session per unit) is a client/session rule; Run B only needs to
  not fight it (stateless `diagnose()` already doesn't).

---

## 3. Data & integrations

**Supabase (service-role, server-only).** `supabaseAdmin()`
(`lib/clients.mjs:49`). Tables: `documents` (id, manufacturer, coverage,
doc_type, in_scope, disposition — U4 reads it, `lib/units.mjs:153-160`),
`chunks` (full denormalised provenance per chunk, `page_number NOT NULL`;
**live column names differ from committed `sql/003`** — flagged at
`.pipeline/03-backend.md:458-465`; `sql/006` renamed `chunks.in_scope` →
`in_phase1_scope`), `sessions`/`messages`/`citations`
(`sql/002`, extended by `sql/006`; `messages.kind ∈ {user, answer, clarify,
refusal}` — note `clarify` is already a legal persisted kind).

**Retrieval RPCs.** `match_chunks(query_embedding vector(1024), match_count int,
scope_only bool default true)` returning `out_*` columns, cosine-ranked;
`match_chunks_hybrid` (sql/004) exists, measured worse, opt-in only. Contract:
`.pipeline/025-knowledge.md` §5. **Any signature change must `drop function`
first** or PostgREST throws PGRST203 (`.pipeline/R1-unit-scoped-retrieval.md:67-80`).

**Gemini.** `https://generativelanguage.googleapis.com/v1beta`, key in
`x-goog-api-key` header, never a query param (`lib/providers/gemini.mjs:115-123`).
Bounded retry ×3 on 429/5xx. Structured output via
`responseMimeType`/`responseSchema`. **Free tier: 20 requests/day/model**,
measured from the 429 detail (`spike/m12/README.md:53-74`); retries count
against it; **no Pro allowance at all on this account** — every Pro variant
returns RESOURCE_EXHAUSTED (`spike/m12/README.md:106-116`). Owner has accepted
free-tier management; do not recommend billing. Pinned model verified callable;
the model *list* is not a capability check (`SETUP-BLOCKERS.md:144-152`).

**Voyage.** `embed(texts, {inputType})` — `'query'` for search, `'document'` at
ingest; asymmetry is functional (`lib/clients.mjs:102`, `lib/diagnose.mjs:78-80`).
Returns `{embeddings}`, not an array (a live-caught defect,
`.pipeline/03-backend.md:242`).

**Env contract** (`.env.example`): server-side `GEMINI_API_KEY`,
`VOYAGE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; client-safe
`EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY`, `EXPO_PUBLIC_DIAGNOSE_URL`. Knobs:
`GEMINI_MODEL`, `RETRIEVAL_MODE`, `DIAGNOSE_PORT`, `LLM_PROVIDER`,
`ALLOW_STUBS`. Secrets discipline is enforced by `npm run verify:secrets` and
`verify:bundle` (`lib/secrets.mjs` is the single pattern source; the live
Google key shape is `AQ.`, covered — `SETUP-BLOCKERS.md:160-162`).

---

## 4. Conventions

- **Artifacts first.** Prior `.pipeline/*` files are the source of truth;
  disagreements are filed (`CONTRACT MISMATCH`, `R1`, `D1`) rather than worked
  around. Follow that pattern.
- **Measure, don't assume** — the house style is a decision comment citing the
  measurement (`lib/diagnose.mjs:48-74` on hybrid; `gemini.mjs:15-27` on
  pinning). New behaviour needs its number.
- **Fail closed, loudly.** Stubs throw without `ALLOW_STUBS`; no silent
  mode fallbacks (`lib/diagnose.mjs:83-88`); malformed model JSON is an error,
  never a partial answer (`gemini.mjs:184-189`).
- **Errors:** `DiagnoseError{status, message, …extra}` /
  `ProviderError{status, message}`; the documented wire error shape is
  `{status, message, providerBlocked?, blockReason?}`.
- **Tests:** `node --test`, colocated `lib/*.test.mjs`, no credentials required
  — pure functions (`buildPrompt`, `validateAnswer`, `classifyHazard`,
  `classifyUnit`) are exported specifically to be testable without a key.
  Stage 5's harness (`tests/run-all.mjs`) reports PASS/FAIL/BLOCKED/HUMAN-ONLY;
  criteria needing live keys are BLOCKED, never FAIL.
- **One dependency rule:** raw `fetch` over SDKs, justified in the artifact if
  broken (`gemini.mjs:1-11`, `.pipeline/03-backend.md:48-66`).
- **Domain rules are code**, not prompt copy: the deterministic gate precedes
  the model; citation validity is structural. No stage may re-open that.

---

## 5. Build / test / deploy — status measured this session

| Command | Result (6 Aug 2026) |
|---|---|
| `npm run lint` | exit 0 — 0 errors, 0 warnings |
| `npm run build` (`tsc --noEmit` in `app/`) | exit 0 — clean |
| `npm test` | **80 pass / 0 fail** (~330 ms, no credentials) |
| Stage 5 harness (`tests/last-run.md`) | **46 PASS · 0 FAIL · 4 BLOCKED · 11 HUMAN-ONLY**, no stubs activated |

Deploy target: Supabase Edge Functions (150 s wall-clock cap, the brief's hard
constraint) — **untested; no access token (H9)**. Dev path is
`npm run serve` + `EXPO_PUBLIC_DIAGNOSE_URL`. CI: none configured. Free-tier
Supabase pauses after 7 idle days (`SETUP-BLOCKERS.md:76-78`).

Constraint that shapes everything downstream: **20 Gemini requests/day/model,
retries included.** A single M12 gate run does not fit in a day; the brief's
≥30-claim citation sample plus the top-15 correctness run plus 12 refusal probes
cannot run in one free-tier day either. **Stage 2 must schedule eval across
multiple days (or as an owner-gated batch), not assume a single session** — the
scheduling decision is Stage 2's, flagged here, not resolved here.

---

## 6. Recommended approach

**Close the gaps around a working core; do not rebuild the core.** Sequence:

1. **Verify the clarify continuation** (server-side loop test: clarify → answer
   → continued diagnosis over `history`, plus the must-not-stall negative) —
   pure-prompt halves unit-tested free, one live transcript as evidence.
2. **Land R1** (Knowledge) and thread `documentIds` through
   `retrieve()`/`diagnose()`; add the "unit required" (or
   unitless-hazard-check-only) behaviour to `/diagnose`, closing the filed
   CONTRACT MISMATCH. This is also the highest-leverage fix for criterion 3,
   because it deletes cross-manufacturer contamination instead of out-ranking it.
3. **Build the vision endpoint** on the existing adapter (`imagePart` +
   server-side downscale in `serve.mjs`/core), choose the model on evidence
   (M17), and demonstrate identified-model → narrowed retrieval via the same
   `documentIds` path — one mechanism serving criterion 7 and U5 both.
4. **Instrument, then measure**: surface `cachedContentTokenCount` in the
   adapter's `usage`, log per-request cost/latency in `serve.mjs`, and take
   p50/p95 + cost with/without caching from a scheduled multi-day run that also
   completes M12's block-rate number (batch the calls; they share quota).
5. **Score the eval** (Stage 5.5's first scored run) last, against the
   documented contract, spread across free-tier days.

Justification: the acceptance-critical invariants (zero uncited claims, refusal
≠ error ≠ provider block, no-documentation honesty) are already enforced
structurally and tested; the open criteria are almost all *measurements* (9, 3,
4, judgment-5) or *one missing endpoint* (7) or *one missing SQL parameter*
(R1 → 3/criterion-1 completeness). Rejected alternatives: **(a)** the M6–M8
model-copied-span design from Addendum B — superseded by source-index anchoring,
which is structurally stronger (the model can't fabricate what it never writes)
and cheaper; re-opening it would re-litigate a settled decision against
`lib/diagnose.mjs:22-25`; **(b)** making hybrid retrieval the default — measured
worse twice (8/14 vs 10/14; and R1 removes most of its motivation,
`R1-unit-scoped-retrieval.md:92-101`); **(c)** building the Edge Function first
— blocked on H9 (human), and the transport-agnostic core means it stays a
wrapper, not a rewrite; **(d)** paying for Pro/billing to un-gate quota —
explicitly the owner's call, and the owner has accepted free-tier management.

---

## 7. Risks & Unknowns

1. **Quota is the schedule.** 20 req/day/model, retries included, no Pro
   allowance. Every live measurement in criteria 3–5, 7, 9 competes for the
   same 20 calls. Biggest planning risk in the run.
2. **M12's block-rate number is still outstanding** with 0 observed blocks in
   ~12 successful calls. If the filter fires on ordinary rooftop diagnostics at
   volume, that is an owner finding, not a prompt-tuning task (brief `:85-90`).
3. **Latency headroom is unknown.** 37.9 s text-only worst sample; vision +
   retrieval + reasoning against a 150 s cap has never been timed, and the
   deployed runtime (Edge/Deno) has never executed the core at all.
4. **Clarify continuation may not work first try** — role-merging exists but the
   model re-answering coherently over injected history is unproven, and the
   negative direction (don't stall) is a prompt-behaviour question.
5. **`sql/003` vs live schema drift** (`.pipeline/03-backend.md:458-465`): a
   clean rebuild produces a different database than the one running. Any Run B
   migration (R1) must be written against live names and should not be the
   thing that discovers this the hard way. Owner: Knowledge.
6. **Vision accuracy is a coin not yet flipped** — ≥8/10 on real photos is
   plausible for Flash but unmeasured, and the photos don't exist yet
   (human-gated; the brief says start collection now).
7. **The eval baseline may disappoint** — first scored run ever; the brief
   pre-commits to recording it precisely rather than tuning to it, and eval is
   warned off tuning its own scenarios.
8. **Stale artifact hazard for downstream readers:** `025-knowledge.md` says
   10/14 smoke (now 11/14); Run C Amendment 1's landed-table says U4's contract
   is "not yet delivered" (it since landed in `1f57b6b`); `tests/last-run.md`
   E2.3's BLOCKED note predates out-of-scope ingestion. Trust the tree.

### OPEN QUESTIONs, with proposed defaults

- **OQ1 — How does `/diagnose` receive unit scope?** *Default:* an optional
  `documentIds: string[]` supplied by the client from `/resolve-unit`'s verdict
  (keeps `diagnose()` stateless and the matching logic in one place,
  `lib/units.mjs`); the server treats absent/empty as unscoped **for Run B's
  test paths only** and returns a distinct "unit required" shape on the app
  path once the CONTRACT MISMATCH fix lands. Alternative (server re-resolves
  `{manufacturer, model}` per request) costs a `documents` read per call and
  duplicates nothing — acceptable fallback if the contract review prefers it.
- **OQ2 — Where does the vision endpoint live?** *Default:* a third route on
  the same front door (`POST /identify-unit` in `serve.mjs`, logic in
  `lib/` beside `units.mjs`), returning `{manufacturer, model, confidence}` and
  composing with `/resolve-unit` rather than duplicating its matching. Mirrors
  the U3→U4 flow the story map already draws.
- **OQ3 — Does the ≥30-claim eval sample run on free tier at all?** It cannot
  complete in one day (~15 diagnoses ≥ a day's quota before probes). *Default:*
  Stage 2 plans a multi-day scored run with per-day call budgets recorded in
  the eval artifact; the owner is asked once whether to accept the elapsed time
  or change tiers — not resolved by any agent.
- **OQ4 — Is streaming's seam adequate?** The core returns a complete validated
  object; Run C's constraint is "a token stream is a transport change".
  *Default:* accept the current shape — structured-output validation before
  emission means Run C streams *rendered* body text (or streams post-
  validation), per the M11 note (`02-user-stories.md:626-630`). Verify buffered
  in this run; leave the seam. No reasoning rewrite.
- **OQ5 — Model-number aliases (YSC/YHC → Precedent)** remain unresolved from
  `.pipeline/03-backend.md:467-474`. *Default:* unchanged — corpus metadata,
  Knowledge's manifest, raised only if eval scenarios exercise series numbers.

---

## Post-scriptum — M12 superseded the same day (8 Aug, after this artifact)

The M12 status above reads the 5 Aug UNMEASURED output; a full run completed
hours after this artifact was written. **The gate is now MEASURED**: 12/15
faults, 47 claims — span verification **80.9%** (stop condition 1 fired, and is
moot for the shipped source-index design), fabrication **0/47**, provider blocks
**0/15**, ~3.5k/260 tokens per answer. Verdict and retirement of M6–M8-as-written:
`spike/m12/README.md` §"THE GATE HAS RUN". Stage 2 should treat span-copying
designs as closed, not open.
