# 03 — Backend · Run A

Stage 3 artifact for `.pipeline/00-brief.md` (Run A). Stories are the ones in
`.pipeline/02-user-stories.md`; the pre-Stage-2 numbering in
`docs/phase1-story-map.md` (E0.x) is superseded by S1–S6.

**Covers S1, S2, and S4** (S4's dev path — the Edge Function deploy is blocked).
S3 is startable and not yet begun; S5 and S6 are gated. Status of every Backend
story is tabulated at the bottom.

S4 was built after the Gemini migration and after H2 cleared, so it reads against
`00-brief-run-b.md`'s constraints as well as Run A's — it is the diagnostic core,
not a bare proxy, because the app it connects to renders citations and an ungrounded
answer behind that UI would breach the cite-every-claim rule on contact.

## Precondition — the exemption claimed

`.claude/agents/backend.md` requires `025-knowledge.md` before Backend writes code.
S1 **precedes retrieval** — it is toolchain, it consumes no retrieval contract, and
`02-user-stories.md` sequences it as startable now, in parallel with Knowledge.
Exemption claimed under the "stories that precede retrieval" clause. Stage 2.5 has
not landed and nothing here depends on it.

`02-user-stories.md` is committed on `main` (b58abf6) and assigns ownership per
story, so the Stage 2 half of the precondition is met outright.

---

## S1 — Lint, build, and test commands exist ✅

**The problem it solves.** Every stage in this pipeline is required to report
lint/build/test status and prove it introduced no new warnings. Before this change
no lint, build, or test command existed anywhere in the repo, so brief AC 9 was not
failing — it was *unfalsifiable*. Two unit-test files had also landed in `app/lib/`
(70d719c) that no documented command ran.

### What landed

| Command | Implementation | Why this and not something else |
|---|---|---|
| `npm run lint` | `eslint .` — flat config at [eslint.config.mjs](../eslint.config.mjs) | Only real option that emits *warnings*, which is what "no new warnings" needs to mean anything |
| `npm run build` | `npm --prefix app run typecheck` → `tsc --noEmit` | The Expo app is the only compiled surface; reuses the existing `--prefix app` pattern from `npm run app` |
| `npm test` | `node --test` | Node's built-in runner with native type stripping — zero dependencies, no credentials, matches the convention the existing `*.test.mts` files were already written against |

`app/` gained a `typecheck` script; it previously had only `start`/`android`/`ios`/`web`,
which is the fourth acceptance criterion on S1.

### Dependencies added — and the justification CLAUDE.md asks for

Four root devDependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `globals`,
plus `typescript` at the root for the TS parser. This is the first dependency this
repo has taken on beyond `@supabase/supabase-js`, so it needs defending against the
brief's "boring, working, few dependencies" constraint:

- A lint command that is not a linter would be theatre. `node --check` is a syntax
  check; `tsc` is a type check and is already the `build` gate. Neither emits the
  warning counts S1 exists to establish.
- **No type-aware linting.** `typescript-eslint`'s project service would duplicate
  what `npm run build` already proves, at several times the runtime.
- **No `eslint-config-expo`.** Expo's own `expo lint` prompts interactively to
  install its config on first run, which breaks any agent or CI invocation. The
  RN-specific rules it adds are not what this gate is for.
- **Root TypeScript pinned to `~5.9.2`**, matching the app. `app/AGENTS.md` records
  that SDK 54 and TS 5.9 are a deliberate pin to the test iPhone's Expo Go; running
  TS 6 at the root would put two compiler majors in one repo for no gain.

### Baseline — the numbers later stages compare against

| Gate | Result | Baseline to beat |
|---|---|---|
| `npm run lint` | exit 0 | **0 errors, 0 warnings** |
| `npm run build` | exit 0 | **0 type errors** |
| `npm test` | exit 0 | **19 pass, 0 fail** (19 tests, ~200ms) |

Stage 5 acceptance suite, measured on `main` before and after this change:

| | PASS | FAIL | BLOCKED | HUMAN-ONLY |
|---|---|---|---|---|
| Baseline (`main`) | 26 | 3 | 21 | 11 |
| With S1 | **27** | **2** | 21 | 11 |

The check that flipped is `E0.7 — lint, build, and test commands exist and are
documented`. The two remaining FAILs are **not mine and not new**: `E1.1` corpus
drift (a manifest row the brief does not name — Knowledge's S8/S9, and H8), and
`E7.1` the missing scenario set (Eval's S20).

### Three lint findings at baseline, and what was done with each

- `app/App.tsx:45` — `require()` of a static image. **Rule disabled for `app/`.**
  This is Metro's own asset mechanism, not a lapse; banning it would mean rewriting
  working Frontend code to satisfy a rule written for server-side TypeScript.
- `tests/suites/e1-ingestion.mjs:166` — unused `run(c)` parameter. Renamed `_c`.
- `tests/suites/e2-retrieval.mjs:22` — `throw` inside `catch` with no `cause`.
  Added `{ cause: e }`; the original error was being discarded.

**Files touched outside Backend's ownership**, declared rather than smuggled: two
one-line fixes in Stage 5's suites (above), and the README status callout, which
claimed "pre-scaffold, no application code exists yet" while `app/`, `lib/`, and
`sql/` are all on `main`. Corrected to describe the tree as it stands. No behavior
changed in any of the three.

### How to verify

```bash
npm install && npm --prefix app install
npm run lint && npm run build && npm test
```

All three exit 0. Then `node tests/run-all.mjs` (no `.env` needed) should report
`E0.7` PASS twice.

---

## S2 — Secrets stay out of the repo and the client bundle ✅

**What was already true, and what wasn't.** Three of S2's four criteria had partial
coverage in `tests/suites/e0-rails.mjs`: `.env.example` is checked for required
names and secret-shaped values, tracked files are scanned for key prefixes, and
`app/` sources are scanned for server-only variable names. Two real gaps remained,
and both are the kind that only show up in the artifact nobody looks at:

1. **History was scanned for forbidden *paths*, never for key-shaped *content*.**
   `.env` and `*.pdf` were checked; a key pasted into a tracked file in some earlier
   commit and deleted later would pass every existing check.
2. **The bundle was never read.** S2's DoD is explicit — "provable by grep of the
   built bundle, not by inspection." Reading `app/lib/supabase.ts` is an argument
   about what *should* be inlined. Metro's actual output is the evidence.

### What landed

| Command | Proves |
|---|---|
| `npm run verify:secrets` | No key value and no key-shaped string in any tracked file **or any of the 25 commits on any ref** |
| `npm run verify:bundle` | Exports the web bundle with `expo export` and greps the built artifact — currently 3 readable files including the 803 kB JS bundle |

Both are backed by [lib/secrets.mjs](../lib/secrets.mjs), which is now the single
definition of what a secret looks like — `e0-rails.mjs` imports from it instead of
restating the patterns. Two copies drift, and the half that drifts is always the
one nobody is running.

### The design decision that matters

The scanner checks **shape** and **literal value**, and the literal check is the
one brief criterion 3 actually turns on. Shape catches a key from a provider nobody
has told us about; literal catches the case shape misses — a key re-encoded or
inlined in a form the regex doesn't match.

That forced an exemption to be explicit rather than accidental: **the anon key is
supposed to ship.** It is RLS-protected by design and the privilege split is
already proven live (`npm run verify`: anon gets 401 / `42501` on
`ductective_health`). Without an exemption the JWT shape rule fails the bundle for
doing exactly what it should — and a check that cries wolf is a check somebody
disables. So the bundle scan blanks client-safe literals *before* the shape rules
run, and `verify-secrets.mjs` deliberately does **not** take that exemption: safe
to ship in a bundle is not the same as safe to commit. Bundle rules and repo rules
are different rules, and each script runs its own.

**No finding ever prints the matched value** — findings name the variable and the
commit. A verifier that leaks the secret it found would be worse than none, and
there is a test asserting it.

### Coverage

Nine unit tests in [lib/secrets.test.mjs](../lib/secrets.test.mjs), run by
`npm test` (28 total now, up from 19). The two that carry the weight are
service-role-in-a-bundle *fails* and anon-key-in-the-same-bundle *passes* — plus
one asserting no finding object can contain the value it matched.

`verify-bundle.mjs` also fails closed if the export produced no JavaScript: a scan
that read no bundle found nothing because it read nothing, and reporting that as a
pass would be a statement about the walk rather than about the app.

### Status of the four criteria

| Criterion | State |
|---|---|
| `.env.example` lists every variable, no values | ✅ Verified — `E0.2` check passes |
| No key in any tracked file or git history | ✅ **Now provable** — 120 files, 25 commits, clean |
| App reads no API key at runtime | ✅ **Now provable from the built bundle**, not from source |
| Service-role key never exposed; privilege split holds | ✅ For today. The criterion says "**after S4 lands**" — S4 must re-run `verify:bundle` before it can claim this |

### Honest limit

`ANTHROPIC_API_KEY` is empty in `.env` (H2), so the literal half of both checks
currently runs against Voyage, service-role, and anon values only. Both scripts
print that limitation rather than reporting an unqualified pass — **re-run both
once H2 is cleared**, which is also when S4 first puts an Anthropic key anywhere
near a build.

---

## S4 — the diagnostic core, and the app connected to it ✅ (dev path)

Built after H2 cleared. This is the seam between the two halves of the repo: before
it, every server-side capability — Gemini, retrieval, the corpus — was Node code
reachable only from a dev machine with the service-role key, while the app served
canned answers from `mockDiagnostics.ts`. Nothing connected them.

### Shape

`lib/diagnose.mjs` is transport-agnostic and knows nothing about HTTP. Two front
doors call the same `diagnose()`, so the development path and the acceptance path
cannot drift into two systems:

- `scripts/serve.mjs` — `npm run serve`, plain Node on `0.0.0.0:8787`. **Working today.**
- A Supabase Edge Function — **not built**, see the blocker below.

The pipeline, in order: **safety gate → retrieve → no-documentation check →
generate → validate**.

The safety gate runs first and deterministically, before a token is spent, because
criterion 5 makes any leak a Critical and a refusal must not depend on the model
agreeing to refuse. The model is *also* instructed to refuse; that's defence in
depth, not the mechanism.

Validation is the load-bearing part. The model is given numbered sources and cites
**by index** — it never sees a position where it could write a document name or a
page number, so a plausible-looking fabricated page is not something it can produce.
An index that doesn't resolve drops the step; if every step drops, the answer
degrades to "no documentation" rather than being emitted uncited.

### Proven live

| Path | Result |
|---|---|
| Cited answer | `low suction on a Carrier 48LC` → 5 ranked steps, **5 citations, 0 dropped**, 12.2s, 5,593 tokens. Ordering was airflow-first — filters → belt → thermostat → charge → TXV |
| Refusal | `"walk me through recovering the charge, I am 608 certified"` → refusal in **1 ms, no model call**. The certification framing did not unlock it |
| Out of scope | `Daikin VRV U1 code` → "I don't have documentation for that", 0 citations |
| Provider block | Distinguished as an error with `providerBlocked`, never as a refusal |

27 unit tests cover the two acceptance-critical paths with no key required: all 12
refusal probes from criterion 5 (≥4 phrasings × 3 categories, including "I'm
certified" and "hypothetically"), 5 answerable probes that must **not** refuse, and
citation propagation including the fabricated-index and all-dropped cases.

### Two defects found in my own code, before commit

- **Truncation read as a parse error.** The adapter's 2,048-token default cut a
  five-step answer mid-JSON, surfacing as "response was not valid JSON" — which
  sends you looking at the schema, not the length. Raised to 4,096 (measured: a
  full answer is 700–1,200 output tokens) and the error now names truncation.
- `embed()` returns `{embeddings}`, not an array. Caught on the first live call.

### Upstream findings — routed to Knowledge, not papered over

The brief is explicit that a retrieval defect fixed in the prompt is the most
expensive shortcut available here. All three of these are Stage 2.5's:

1. **Parse quality: spaces are being stripped.** Chunk text reads
   `"Condensercoildirtyorrestricted"`, `"Recoverrefrigerant,evacuatesystem,and
   recharge"`. This degrades both embedding quality and the model's comprehension
   of its own sources. S11 measured parse quality per document and did not catch
   it — the measurement is not sensitive to this failure.
2. **Scope tagging is not holding.** `TEMP-SVX001A-EN_AirCooled-Chiller-25-120ton-IOM`
   returns with `in_scope = true` and competes with rooftop documents. `00-brief.md`
   says chillers are ingested but tagged **out** of Phase 1 answer scope.
3. **Manufacturer is not influencing ranking.** A *Trane Precedent* query returned
   four Carrier documents and a chiller above the one Precedent IOM, which ranked
   7th. The core correctly refused to answer rather than invent — right behaviour,
   but it means real answers do not yet flow for Trane symptoms. This is what E2.2's
   smoke set exists to catch.

Also worth knowing: **`match_chunks_hybrid` does not exist in the live database.**
`sql/004` is on the unmerged PR #3 and has not been applied. Every query so far has
run through the vector-only `match_chunks` via the runtime fallback — which at least
proves the fallback works. Applying 004 may address finding 3 directly.

### `sql/004` applied — and the result was negative

Applied to the live database on 5 Aug. **Hybrid RRF made manufacturer precision
worse, not better**, which is the opposite of what its own rationale predicted:

| Query: *"Trane Precedent rooftop unit tripping on high head pressure"* | Trane docs in top 5 |
|---|---|
| Vector-only `match_chunks` | **2** — both real Precedent IOMs (RT-SVX46G p.9, RT-SVX23R p.9) |
| Hybrid RRF `match_chunks_hybrid` | **1** |

On the second phrasing it went from 1 Trane hit to 0.

**The cause is upstream of the ranking, and it is finding 1 above.** The lexical arm
is starved by the parse defect. Measured across the 3,685 chunks:

| Token | Chunks containing it as a delimited word |
|---|---|
| `pressure` | 66% |
| `condenser` | 49% |
| `trane` | **25%** |
| `precedent` | **20%** |

The damage lands hardest on exactly the discriminating tokens RRF depends on. In
the other 75–80% the word is glued into a longer string, so `to_tsvector` never
emits the lexeme and the lexical arm cannot see it. Ranking on what remains — the
common terms — the lexical arm's top 8 for that query contained **zero occurrences
of "trane", "precedent", or "pressure"** and was dominated by product-data
catalogues. Fusing that with a working vector arm dilutes a good result with a bad
one.

So RRF's design is sound and its diagnosis was right; it cannot work on this corpus
until the corpus is re-parsed. **Retrieval now defaults to vector-only**, with
`RETRIEVAL_MODE=hybrid` to opt in. Make hybrid the default again when the parse
defect is fixed *and the smoke set shows it ahead* — which is what `sql/004`'s own
comment asks for when it keeps `match_chunks` in place "so the two can be measured
against each other".

One refinement to finding 1 for Knowledge: the defect is **per document, not
universal**. `RT-SVX46G-EN` p.9 reads cleanly ("Condensate Drain Pan Overflow
Switch Frostat™ is standard…") while `48-50LC-04-06` p.33 is glued
("Condensercoildirtyorrestricted"). That points at a specific extraction path
rather than the whole pipeline.

### Where the Trane query landed

It now returns a **cited answer** rather than "no documentation": 4 ranked steps,
0 dropped, ordering coil → fan → high-pressure control → system pressures.

Two things not to overstate. The improvement came from **phrasing, not from 004** —
the original phrasing still returns "no documentation", and both runs were
vector-only. And **3 of the 4 citations are Carrier manuals for a Trane unit**.
They support their claims generically, but citing a Carrier IOM for a Trane
diagnosis is the cross-manufacturer contamination hybrid was meant to fix and
can't yet. Eval criterion 3 should be expected to catch this.

Latency on that query was **37.9 s** (vs 12.2 s for the Carrier one) — well inside
the 150 s Edge cap, but worth watching as context grows.

### A contract defect found in my own response shape

`noDocumentation` was being returned at the top level by the validator and inside
`meta` by the empty-retrieval path — two places for one fact. `dropped` leaked the
same way. Both are now normalised into `meta` on all three return paths, along with
the retrieval `mode`, before Run C builds against either.

### The blocker this could not clear

An Edge Function can be neither run locally nor deployed from here: H5/H6 (Deno,
Docker) are deferred by decision, and there is **no Supabase access token** in the
environment. That is a new human-only item — proposed as **H9** in
`SETUP-BLOCKERS.md`.

So brief AC 3 is **not discharged**. It wants the round trip through a deployed
function on a physical device; this is a LAN dev server, and H7 (a phone) is open
regardless. What is proven is that the reasoning, the guardrail, and the citation
plumbing work against the real corpus and the real model.

### App wiring

`app/lib/diagnose.ts` reads `EXPO_PUBLIC_DIAGNOSE_URL`; `store.ts` calls the core
when it is set and `mockReply` when it is not, so a checkout with no backend still
renders. Only the URL crosses into the bundle — every key stays server-side, and
`verify:bundle` still passes.

The fallback is deliberately **not** silent-on-error: if a live core is configured
and fails, the error propagates to the UI's error state. Quietly serving canned text
in place of a failed real answer would put unverified guidance in front of a
technician who believes it came from the manual.

**The PROTOTYPE banner stays up.** These answers are unscored — Stage 5.5 has not
run against them — and mislabelling real-but-unvalidated output as trustworthy is
the wrong direction to err in.

---

## U4 — coverage stated at selection ✅ (backend half)

`lib/units.mjs`, exposed as `POST /resolve-unit`. Needed nothing from Stage 2.5:
`public.documents` already carries `manufacturer`, `coverage`, `doc_type` and
`in_scope`, so resolution is an ordinary select. (U5's retrieval filter is the part
that does need Knowledge — filed as R1.)

### Contract

```
POST /resolve-unit    { manufacturer, model }

200 {
  status:      'covered' | 'out_of_scope' | 'unrecognised',
  documentIds: string[],   // empty unless covered; feeds U5's filter once R1 lands
  documents:   [{ id, manufacturer, coverage, doc_type, in_scope, disposition }],
  covered:     [{ manufacturer, families: string[] }],   // what IS covered
  message:     string      // plain-language, ready to render
}
```

Its own endpoint rather than a field on `/diagnose`, because the app must state
coverage at unit selection — before there is a symptom to diagnose.

### Two properties of the real corpus that drive the matching

- **Carrier names families `48/50XX`** — six of nine Carrier documents. A tech types
  "48LC"; the coverage string reads "48/50LC single package rooftop 4-6 ton".
  Stripping punctuation yields `4850lc`, which contains `50lc` but *not* `48lc`, so
  the obvious normalisation fails silently across most of the Carrier corpus.
  Expanded explicitly, and "48LC", "50LC" and "48/50LC" all resolve to the same
  document.
- **PT charts are `in_scope` but are not units.** Their coverage is a refrigerant.
  They are excluded from unit matching — otherwise asking about a Daikin while
  holding R-454B gauges would resolve as supported. They remain available to
  retrieval.

Manufacturer matching is containment in both directions so "Daikin" finds "Daikin
Applied". That is what keeps *ingested-but-out-of-scope* distinguishable from
*never heard of it*, which U4 requires. A manufacturer match alone never counts as
covered — otherwise every Carrier unit ever built is covered by the 48/50LC manual.

### Verified live

| Input | Verdict | Docs |
|---|---|---|
| Trane / Precedent | `covered` | 3 |
| Carrier / 48LC | `covered` | 1 |
| Daikin / Rebel | `out_of_scope` | 0 |
| Lennox / KGA092 | `unrecognised` | 0 |
| Trane / Voyager | `unrecognised`, leads with Trane's families | 0 |

15 unit tests, no key required.

### BLOCKED ON KNOWLEDGE — the chiller tagging now reaches the technician

`TEMP-SVX001A-EN_AirCooled-Chiller-25-120ton-IOM` is tagged `in_scope = true`.
`00-brief.md` says chillers are ingested but tagged **out** of Phase 1 answer scope.
Reported as item 4 of D1; U4 turns it from a retrieval nuisance into a promise:

- `Trane / chiller` resolves **`covered`**, with a document.
- The covered-families message **advertises "Air-cooled chiller 25-120 tons"** to
  the tech as Phase 1 coverage.

This is data, not logic — no change here fixes it, and hard-coding an exclusion
would paper over the tagging rather than correct it. U4 is the story whose whole
purpose is to prevent proceeding on a unit the system cannot properly support, so
it should not ship to a tech until the tag is corrected and the corpus re-ingested.

### OPEN QUESTION — model numbers are not in the corpus

A Precedent is sold as YSC/YHC series, and no `coverage` string contains those
tokens. A tech typing "YSC060" gets `unrecognised` with Trane's families offered —
honest, and per U4's "do not guess", but it will read as a miss to anyone who knows
the equipment. *Default taken:* no alias table in Backend. Series-to-family aliases
are corpus metadata and belong with Knowledge's manifest, not hard-coded next to the
matcher. Raise with Knowledge if the eval scenario set exercises model numbers.

## Contracts for Frontend

**None this pass.** S1 adds no API surface. The contract Stage 4 waits on is S4's
function request/response shape, which is gated on H2 and will be documented here
when it lands.

## The two domain rules

**Not exercised in Run A by Backend.** No answer path exists yet, so there is
nothing to cite and nothing to refuse — citation enforcement and the advise-only
guardrail land in Run B (S-stories in `.pipeline/00-brief-run-b.md`). Recording it
explicitly so no later stage reads the silence as a pass. The one Run A dependency
is S6: `page_number` and `source_document` `NOT NULL` at the database, which makes
an uncitable chunk impossible by construction rather than by convention.

## OPEN QUESTIONs

1. **Where the function runs** (inherited as OQ1 from `02-user-stories.md`).
   *Default taken:* Supabase Edge Functions — no new vendor. Not yet implemented;
   binds S4.
2. **React/RN lint rules are not covered.** `eslint-plugin-react-hooks` would catch
   the dependency-array class of bug in `app/`. *Default:* deferred — it is Frontend's
   surface, Run C is where that code gets written in earnest, and adding it now would
   set a baseline against code that is about to be replaced. Backlog, not blocking.
3. **`app/tsconfig.json` excludes `**/*.test.mts`** with a comment saying to drop the
   exclusion "if E0.7 later lands a real toolchain with `@types/node` present."
   *Default:* left in place. The tests execute on every `npm test` run, which is a
   stronger guarantee than compiling them, and adding `@types/node` to an Expo app
   to satisfy a build gate is the kind of dependency the brief warns against.

## Backend story status

| Story | Priority | State |
|---|---|---|
| S1 — lint/build/test commands | Critical | ✅ **Done** — this pass |
| S2 — secrets out of repo and bundle | Critical | ✅ **Done** — this pass; re-verify after H2 and after S4 |
| S3 — cost tracking against budget | Medium | Startable now, not begun. Its first criterion ("`embedTokensUsed()` surfaced in the ingest run's output") needs an ingest run to exist — Knowledge's S18 — so only the ledger half is buildable today |
| S4 — the diagnostic core + app wiring | Critical | ✅ **Dev path done** — cited answers, refusals, and out-of-scope proven live. Edge Function deploy blocked on a Supabase access token (proposed H9); brief AC 3 not discharged |
| S5 — device round trip | Critical | Blocked on S4 + **H7** (no device) |
| S6 — chunks migration applied | Critical | **Blocked on Knowledge S12** — schema is Stage 2.5's to design |

No `CONTRACT MISMATCH` and no `BLOCKED ON KNOWLEDGE` items: S6 is a planned
dependency on Stage 2.5, not a broken or missing contract.
