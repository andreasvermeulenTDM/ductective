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

### The chiller tagging — fixed at source, 6 Aug

U4 turned D1's item 4 from a retrieval nuisance into a promise made to a technician:
`Trane / chiller` resolved **`covered`**, and the covered-families message
**advertised "Air-cooled chiller 25-120 tons"** as Phase 1 coverage.

Fixed in the scope rule rather than by patching rows. `ingest/reconcile.mjs`
implemented only the manufacturer half of a definition its own comment states as
"Trane + Carrier **rooftop** docs", so every Trane document was in scope, chiller
included. `00-brief.md:64` is explicit: *"Ingest the Daikin, Mitsubishi, chiller,
and EPA documents but tag them out of scope."*

A coverage pattern, not a document-id denylist, so a second chiller added to the
manifest needs no code edit — the same reasoning that derives scope from manifest
columns rather than filenames. In scope went 21 → **20** (17 Trane + Carrier
rooftop, plus 3 PT charts).

> The brief's "18 Trane + Carrier rooftop docs" is a miscount — there are exactly 18
> such documents and one is this chiller. Line 64 names chillers directly, so it
> governs. Recorded rather than silently reconciled.

### A second defect found while fixing the first: metadata never reached chunks

The scope fix would have appeared to work and changed nothing. `content_hash` covers
the chunk text, so a scope correction changes no hash, re-inserts nothing, and never
touched the denormalised `in_scope` on existing chunks — while `match_chunks` filters
on the **chunk's** `in_scope`, not the document's.

`ingest/run.mjs` now detects that drift and re-syncs the denormalised columns.
Reported in the summary even at zero, because a metadata-only correction that
re-embeds nothing is otherwise indistinguishable from a run that did nothing:

```
metadata resynced: 63   ← scope/provenance corrected on existing chunks
inserted: 0 · unchanged: 3787 · tokens billed: 0 · 7.9s
```

**Verified after the run:** all 63 chiller chunks are `in_scope = false`, and the
chiller no longer appears in the top 5 for the Trane Precedent query — it was ranked
1st on one phrasing before.

### FLAGGED TO KNOWLEDGE — `sql/003` does not match the applied schema

Hit while writing the re-sync. The live `chunks` table uses `source_document`,
`page_number` and `model_coverage`; committed `sql/003_chunks.sql` declares `page`
and `coverage`. S6's criterion is that the migration is "committed and re-runnable
from clean" — as it stands a clean rebuild produces a **different database** from
the one running, and `match_chunks` is written against the live names. Backend
followed the live schema. Reconciling the file is Knowledge's.

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

---

# Addendum — Run B Stage 3 · 8 Aug 2026 · ST-02, ST-04, ST-05

Branch `stage/backend-vision` (commits `592469a`, `397b76c`, `0ddbbef`), cut from
`main` at `ac54279`. Everything above (Run A) stands; this extends it. Vision was
pulled to the front of the build order by Addendum A's owner escalation.

**Preconditions checked.** `02-user-stories.md` is committed with per-story
ownership. The retrieval contract consumed is `.pipeline/025-knowledge.md` **§5
addendum (ST-03, merged to main in `542d9e3`)** — built against the document, not
Knowledge's code, exactly as written. `sql/` untouched this round (Knowledge's
file); zero DDL run.

**Quota note, binding on Stages 5/5.5.** Zero live Gemini calls were made this
round — today's quota is spent by owner decision. Every provider interaction in
the new tests is a stub. **Live vision verification (criterion 7's ≥8/10) is
quota-gated to the next window (ST-07, quota day Q4)**; what is proven now is
the machinery: gates, downscaling math, response shapes, and the block/transport
invariants.

## What changed, and why

### ST-02 — the unit-required gate, server-side ✅ (CONTRACT MISMATCH closed)

The filed mismatch (`app/lib/diagnose.ts:201-205`): the server generated an
answer the client's unit gate then discarded — wasted quota, and one client bug
away from rendering ungrounded output. Now `diagnose()` gates **before
retrieval and before any Gemini call**: a non-hazard request with neither
`equipment` nor `documentIds` returns a fourth deliberate shape,
`kind: 'unit_required'`. A unitless **hazard** request still hits the
deterministic refusal first — the safety gate runs *before* the unit gate, so
U7's safety escape is unchanged.

Unscoped diagnosis remains legal **on test paths only** (OQ1 default):
`ALLOW_UNSCOPED_DIAGNOSE=1` (server env, documented in `.env.example`) or an
injected `deps.allowUnscoped`. Neither is reachable from the wire — `serve.mjs`
never passes deps. **No app code changed** (ST-02 criterion; Run C adopts the
shape).

Evidence (all in `lib/diagnose.gate.test.mjs`, provider-call counters):
`unitless non-hazard request gets unit_required with zero provider or retrieval
calls` · `unit_required is none of the other three shapes` · `unitless HAZARD
request still refuses deterministically (U7 escape preserved)` · `equipment
context passes the gate (and empty retrieval still never calls the model)` ·
both flag tests · `a missing symptom is still a 400`.

### ST-04 — unit scope threaded through `diagnose()` ✅

`/diagnose` accepts `documentIds: string[]` (the verdict from `/resolve-unit`
or `/identify-unit`, OQ1 default) and passes it to `match_chunks` /
`match_chunks_hybrid` as `filter_document_ids`, per the sql/007 contract. The
contract's own trap is enforced at the caller: **at the RPC, `[]` means
UNFILTERED**, so an empty array — "unit resolved to zero documents" — short-
circuits to the no-documentation shape **before any RPC or model call**.
Unknown ids are a 400 before retrieval (fail-closed, never silently unscoped).
Unscoped calls omit the `filter_document_ids` key entirely (the pre-007 live
function would reject the widened signature on every call otherwise).

Evidence (all in `lib/diagnose.scope.test.mjs`): `documentIds reach the RPC
arguments as filter_document_ids` · `an unscoped call does NOT carry the filter
key at all` · `documentIds: [] short-circuits…` · `unknown document ids fail
loudly…` · `a malformed documentIds value is a 400` · two PGRST fallback tests ·
`any other retrieval error still fails as a 502` · `empty-after-filter produces
the no-documentation shape, not an invented answer`.

The live cross-manufacturer retest and the verdict→scoped-diagnosis transcript
(ST-04's two live criteria) ride the Q2/Q3 batch — quota-gated, owned by the
batch runs, not repeated here.

### ST-05 — `POST /identify-unit` ✅ (machine half; accuracy is ST-07's)

`lib/vision.mjs`, beside `units.mjs` (OQ2 default). Base64 JPEG in; structured
`{identified, manufacturer, model, confidence}` out via the shipped
`imagePart()`/`inlineData` with **server-side downscaling first** (M11), then
**composition with `resolveUnit()`** — matching logic is not duplicated; the
identification carries the same coverage verdict and `documentIds` that scope
ST-04's retrieval. One mechanism serves criterion 7's "narrows retrieval" and
U5 both.

**Downscaling, and the evidence for the cap.** Pure `resizeDecision()`:
long edge capped at **1536 px**, input capped at **8 MiB**, box-average
resample, re-encode at q80. The 1536 figure is provider economics, cited in the
decision comment: Gemini bills vision at 258 tokens per 768×768 tile and itself
discards pixels beyond 3072×3072 — a 4032×3024 phone capture drops from ~20
tiles (~5,160 tokens) to 4 (~1,032) with zero information the model would have
kept. On a 20-requests/day budget where M12 measured ~3.5k tokens per whole
text diagnosis, an un-downscaled photo would dominate the request. **The
accuracy impact of 1536 px is unmeasured until ST-07's photos — if plates miss,
raise `MAX_EDGE_PX` on that measurement, not on instinct.**

**New dependency, justified:** `jpeg-js@0.4.4` (pure JS, zero transitive deps).
Node has no built-in image codec, so server-side downscaling needs one;
`sharp` was rejected because its native binding forecloses the Deno/Edge
Function path (ST-11) that the transport-agnostic core exists to keep open.
Decode is capped (`maxResolutionInMP`, `maxMemoryUsageInMB`) against
pixel-bomb JPEGs. JPEG only — the camera path produces JPEG; one codec is one
attack surface.

No image bytes and no keys are logged (the serve log carries sizes and the
verdict only); `npm run verify:secrets` green.

## The contracts Run C builds against (additions — everything else unchanged)

### `POST /diagnose` — request grows one field; responses grow one kind

```
POST /diagnose
{
  symptom:      string,          // required
  equipment?:   string,          // free-text unit context; satisfies the gate,
                                 // reaches the prompt, does NOT scope retrieval
  documentIds?: string[],        // the resolved unit's scope (from /resolve-unit
                                 // or /identify-unit's unit.documentIds)
  history?:     [{role, content}]
}
```

Semantics of `documentIds` — absent and empty are different on purpose:

| value | meaning | result |
|---|---|---|
| absent/undefined | unitless | non-hazard ⇒ `unit_required`; hazard ⇒ `refusal` |
| `[]` | unit resolved to zero documents | no-documentation shape, zero RPC, zero Gemini |
| `['doc_…']` | scope retrieval to these documents | scoped diagnosis; unknown id ⇒ 400 |
| wrong type / empty strings | malformed | 400 `{status, message}` |

**The `unit_required` shape** (HTTP 200 — deliberate, machine-readable, none of
the other three):

```json
{
  "kind": "unit_required",
  "body": "Which unit are you working on?\n\n…ready-to-render copy…",
  "citations": [],
  "meta": { "retrieved": 0, "dropped": 0, "noDocumentation": false,
            "mode": "vector", "latencyMs": 1, "model": null }
}
```

**`meta` additions on scoped requests:** `scopedTo: <n>` (count of documentIds
applied) and — only while sql/007 is unapplied — `scopeFallback: true` (see
CONTRACT MISMATCH below). A transcript without `scopeFallback` was truly scoped.

**The response-shape table, updated** (was three, now three-plus-one; no shape
is produced by another's code path):

| shape | wire | producer | pinned by |
|---|---|---|---|
| *ours* (refusal) | 200 `kind:'refusal'`, `meta.category/trigger` | `lib/safety.mjs` gate via `lib/diagnose.mjs` | 12 probes in `lib/diagnose.test.mjs`; `unitless HAZARD request still refuses…` |
| *theirs* (provider block) | 502 `{status, message, providerBlocked:true, blockReason}` | `lib/diagnose.mjs` blocked check; `lib/vision.mjs` identically | `a provider safety block is an ERROR with providerBlocked…` (vision.test) |
| *transport* | 4xx/5xx `{status, message}` | `DiagnoseError` → `serve.mjs` | `a transport failure surfaces as the wire error shape…` |
| **`unit_required`** | 200 `kind:'unit_required'` | `diagnose()` gate, pre-retrieval | `unit_required is none of the other three shapes` |

Citation payload unchanged: `{source_document, page, claim, ordinal, chunk_id,
snippet, verified:'exact'}` — scoped retrieval flows into the same validator,
pinned by `documentIds reach the RPC arguments…` asserting document+page
survive to the citation.

### `POST /identify-unit` — new

```
POST /identify-unit
{ "image": "<base64 JPEG>",        // data:image/jpeg;base64, prefix accepted
  "mimeType": "image/jpeg" }       // optional; default image/jpeg
```

**Limits (enforced server-side, in order):** body cap ~10.7 MiB (base64 of the
8 MiB binary cap + envelope headroom, 413 above); base64/JPEG validity (400);
decoded size ≤ 8 MiB (413); type must be JPEG (415). **JPEG only** — Frontend's
camera capture must request JPEG output (the platform default).

**200 — identified** (`unit` is `/resolve-unit`'s response *verbatim*; do not
re-implement rendering):

```json
{
  "identified": true,
  "manufacturer": "Trane",
  "model": "YSC060A4",
  "confidence": "high",
  "unit": { "status": "covered", "documentIds": ["doc_…"], "documents": [ … ],
            "covered": [ … ], "message": "Covered — 2 documents for this unit." },
  "message": "Covered — 2 documents for this unit.",
  "meta": { "latencyMs": 0, "model": "…", "usage": { … },
            "image": { "originalBytes": 0, "sentBytes": 0,
                        "width": 1536, "height": 1152, "resized": true } }
}
```

`confidence` is always one of `"high" | "medium" | "low"` — **a class, never a
decimal** (CaptureScreen renders the word). Chain `unit.documentIds` into
`POST /diagnose` to get the scoped diagnosis.

**200 — unreadable** (a deliberate answer, NOT an error — render as a re-take
prompt): `identified: false`, `unit: null`, `confidence` per the model
(defaults `"low"`), `message` is fixed re-take copy. Partially-read fields are
surfaced (`manufacturer` may be non-null) but `identified` stays false and no
unit is resolved — a partial read is never laundered into an identification.

**Errors** — the standard wire shape `{status, message, providerBlocked?,
blockReason?}`: 400 (missing/invalid/not-JPEG image), 413 (size), 415 (type),
502 with `providerBlocked: true` (Gemini safety block — render as retryable
error, never as a reading), other 4xx/5xx transport. A block or failure is
**never** returned as an identification.

### `POST /resolve-unit` — unchanged (contract above, Run A section). Cross-
referenced, not duplicated, per ST-01.

## How the two domain rules are enforced and tested this round

- **Citations.** Unchanged structural path (index anchoring → `validateAnswer`
  drop semantics); this round adds the scoped variants: empty scope and
  empty-after-filter both degrade to no-documentation with **zero model calls**
  (`documentIds: [] short-circuits…`, `empty-after-filter produces…`), and a
  scoped answer's citations still carry document+page from the retrieved set.
- **Refusals.** The deterministic gate stays ahead of everything new: hazard is
  classified before the unit gate, so no unit-context requirement can be used
  to route a hazardous request toward the model (`unitless HAZARD request still
  refuses deterministically`). The vision path cannot refuse (it makes no
  diagnostic claims) but inherits the block-is-never-ours invariant, tested.
- Fixtures for Stage 5.5: every shape above is producible offline via the
  injected-deps pattern the three test files demonstrate.

## CONTRACT MISMATCH / adapter ledger

1. **OPEN (adapter in place) — sql/007 not yet applied to the live instance.**
   Owner action (Supabase SQL editor run), tracked in `025-knowledge.md` §5
   addendum ("Status — live verification PENDING"). Until then the live
   functions reject `filter_document_ids` with PGRST202. The adapter — one
   commented block in `retrieve()` (`lib/diagnose.mjs`) — retries unscoped,
   `console.warn`s, and sets `meta.scopeFallback: true` so no transcript can
   pass as scoped when it was not. Matched on PostgREST codes
   PGRST202/PGRST203, never message text. **Delete the block once sql/007 is
   applied**; the two `pre-sql/007 …` tests then pin historical behavior only.
   Owner named: Knowledge (contract) / project owner (the editor run).
2. **CLOSED — the unit-required CONTRACT MISMATCH** (`app/lib/diagnose.ts:
   201-205`, filed in Run A/research §2c item 6). Closed by ST-02; evidence is
   the seven `lib/diagnose.gate.test.mjs` tests named above.

No `BLOCKED ON KNOWLEDGE` items — the adapter keeps every story completable.

## Deferred to Frontend (Run C) — build against this document

- Render `kind: 'unit_required'` as a unit-selection prompt (UnitGate flow),
  **not** as an error and not as a refusal; then retire the client-side-only
  gate at `app/lib/diagnose.ts:201-205` in favour of the server shape.
- Send `documentIds` on the app path (from `/resolve-unit` or
  `/identify-unit`'s `unit.documentIds`).
- Camera capture → base64 **JPEG** → `POST /identify-unit`; render the
  confidence word; treat `identified: false` as a re-take prompt; render 502
  `providerBlocked` as a retryable error.
- No app code was changed this round (ST-02's own criterion).

## OPEN QUESTIONs (defaults taken)

1. **ST-02's shape: distinct kind vs reusing `clarify`.** Default taken:
   distinct `kind: 'unit_required'`. ST-02's text says "distinct
   machine-readable shape", and `clarify` is a model-authored mid-diagnosis
   question — overloading it would make Run C's clarify UI carry gate
   semantics and blur criterion 6's "exactly one targeted question" measurement.
2. **JPEG-only on `/identify-unit`.** Default taken: 415 for anything else,
   message says to send JPEG. One pure-JS codec, and the camera default is
   JPEG. Revisit only if Run C's capture path cannot produce JPEG (it can).
3. **ST-17 (photo turns mid-diagnosis).** The endpoint's mechanics generalise
   (any JPEG in, structured reading out) but the prompt is nameplate-specific.
   Left for the owner's scope call per Addendum A; nothing here precludes it.

## Toolchain status — exact

| Command | Result |
|---|---|
| `npm run lint` | exit 0 — **0 errors, 0 warnings** (baseline 0/0, unchanged) |
| `npm run build` (`tsc --noEmit` in `app/`) | exit 0 — clean. (Fresh worktree note: requires the documented `npm --prefix app install` first; without it tsc mis-resolves Supabase types from the root tree.) |
| `npm test` | exit 0 — **111 pass / 0 fail** (baseline 80/0; +31: 7 gate, 9 scope, 15 vision) |
| `node --check` on `lib/diagnose.mjs`, `lib/vision.mjs`, `scripts/serve.mjs`, all three new test files | clean |
| `npm run verify:secrets` | green (no key-shaped or literal value in tree or history) |

Live calls this round: **0 Gemini, 0 Voyage, 0 Supabase** — everything stubbed.

## Run B Backend story status (this addendum)

| Story | State |
|---|---|
| ST-02 — unit-required gate | ✅ Done — mismatch closed, tests named above |
| ST-04 — scope threading | ✅ Code + tests done; live contamination retest and verdict→scoped transcript ride Q2/Q3 (quota) |
| ST-05 — vision endpoint | ✅ Machine half done; accuracy (≥8/10) is ST-07's, next quota window; photos are ST-06 (human-gated, still open) |

Per instruction from the coordinating agent this branch is pushed without a PR;
commits are per-story (`592469a` ST-02, `397b76c` ST-04, `0ddbbef` ST-05).

---

# Addendum — Run B Stage 3 · 6 Aug 2026 · ST-09 (cost, cache, latency — M15/M16)

Branch `stage/backend-st09`, cut from `main` at `bc2f1d5`. Everything above
stands; this extends it — **additively**. No response kind, gate, or retrieval
semantic changed; every diff on the answer path is a new `meta` field or a
timing capture around an existing call.

**Precondition.** `02-user-stories.md` committed with ownership; ST-09's own
dependency line is "None. Blocks Q1–Q4 usefulness" — it is cost-tracking rails,
exempt from the retrieval-contract wait (and `025-knowledge.md` is merged
regardless; nothing here touches ingestion, chunking, or embedding code —
`retrieve()` gained a timing wrapper and reads the `tokens` field `embed()`
already returned). Zero DDL, zero live provider calls (owner quota decision;
every provider interaction in the new tests is a stub).

## What landed, against ST-09's criteria

| Criterion | Where |
|---|---|
| Adapter surfaces `cachedContentTokenCount` | `lib/providers/gemini.mjs` — `usage` now carries it under Google's own field name (was read nowhere; a quota day ran blind on cache behaviour). Also `attempts`, because a retried/failed call still spent RPD. Stub-body unit tests in `lib/providers/gemini.test.mjs` |
| serve.mjs logs route, duration, tokens, cached, retries, projected cost | `scripts/serve.mjs` log-line tail: `tok=3500+900 cached=2100 retries=1 ~$0.0031 day=3/20`. Rates are named constants with source comments in `lib/metrics.mjs`. No symptom text and no image bytes in any log or file |
| Batch summarizer (the tool ST-10 runs) | `npm run metrics` → `scripts/summarize-metrics.mjs`, math in `lib/metrics.mjs` (`summarize`): p50/p95 for total/retrieval/generation latency, mean cost with/without cache, cache-hit vs -miss groups, token totals, day-ledger table |
| Structural caching preserved | Untouched — constant `SYSTEM` still first, zero prompt reordering (grep the diff: no change in `buildPrompt`/`SYSTEM`/`VISION_SYSTEM`) |
| Zero live calls; lands before Q1 | 0 Gemini, 0 Voyage, 0 Supabase this round; all 33 new tests are stubbed |

Plus the task's ledger requirement: a **per-day request ledger persisted
server-side** — a JSON file beside the server (`scripts/quota-ledger.json`),
which is the dev path ST-09 explicitly allows and is hereby declared as such.
The Edge Function path (H9, still blocked) will need its own durable store;
`lib/ledger.mjs` is transport-agnostic (path-injected) so that wrapper reuses
the same code against a mounted file or is replaced at the transport, not in
the core.

## Contract additions Run C builds against (additive — nothing removed or renamed)

Every `POST /diagnose` and `POST /identify-unit` **200** response's `meta` now
always carries:

```
meta: {
  …everything previously documented, unchanged…,
  usage: {                      // ALWAYS present now — explicit zeros on paths
    inputTokens: number,        //   that never called the model (refusal,
    outputTokens: number,       //   unit_required, empty scope, no-doc)
    totalTokens: number,
    cachedContentTokenCount: number,  // Gemini's own field name, verbatim
    embedTokens: number         // Voyage query-embed spend (0 on /identify-unit)
  },
  latency: { retrievalMs: number, generationMs: number },
  attempts: number,             // provider attempts; 0 = model never called
  budget: { day: 'YYYY-MM-DD', used: number, limit: 20, remaining: number }
}
```

- `latency` phases are 0 where the phase never ran; `latencyMs` (unchanged)
  remains the total. On `/identify-unit`, `retrievalMs` is the unit-resolution
  database lookup; the remainder of `latencyMs` is image preprocessing.
- `budget` counts **model calls, not HTTP requests**, against the Gemini
  free-tier 20/day RPD — a refusal or `unit_required` spends none and does not
  increment. `remaining` can go negative on an overrun day (honest, not
  clamped). It is attached by the serve transport; core-level callers (tests
  with injected deps) see everything except `budget`.
- **Citation payload, refusal shape, error shape, and all four kinds:
  unchanged.** The refusal/`unit_required`/no-doc shapes gained only the
  usage/latency/attempts zeros above. Frontend may render `meta.budget` (e.g. a
  dev-mode quota indicator) but nothing requires it.

Error responses are unchanged on the wire (`{status, message,
providerBlocked?, blockReason?}`). Internally, errors that consumed quota now
carry `modelCallAttempted: true`, `attempts`, and (for provider blocks)
`usage`/`model`, so the transport ledger counts them — pinned by tests; not part
of the wire contract.

## How the two domain rules fare

Untouched, and pinned: the 12 refusal probes, gate tests, scope tests, and
vision invariants all run against the instrumented code unmodified (123-test
baseline green throughout). The instrumentation tests additionally pin that a
refusal reports zero spend and `model: null` — i.e. the ledger cannot be used
to argue a refusal "cost" anything, and no instrumentation path can convert an
error into an answer (`instrument()` runs only on already-produced 200s; its
own failures warn and never alter the response).

## Files

- `lib/providers/gemini.mjs` — `cachedContentTokenCount` + `attempts` surfaced
- `lib/metrics.mjs` — rate constants (sourced), `estimateCostUsd`,
  `normalizeUsage`/`zeroUsage`, `percentile`/`summarize`, ledger predicates
- `lib/ledger.mjs` — day ledger + JSONL appender (file-backed, path-injected;
  corrupt file preserved as `.corrupt`, never crashes a quota day)
- `lib/diagnose.mjs`, `lib/vision.mjs` — meta instrumentation only
- `scripts/serve.mjs` — ledger/log wiring, extended log lines
- `scripts/summarize-metrics.mjs` + `npm run metrics`
- `.gitignore` (+3 machine-local state files), `.env.example`
  (`QUOTA_LEDGER_FILE`, `REQUEST_LOG_FILE`)
- Tests: `lib/providers/gemini.test.mjs` (4), `lib/metrics.test.mjs` (11),
  `lib/ledger.test.mjs` (7), `lib/instrumentation.test.mjs` (11)

## Verified end to end, zero quota

`node scripts/serve.mjs` (no keys), refusal + `unit_required` POSTs:

```
refusal  1ms  retrieved=- cites=0  tok=0+0 ~$0.0000 day=0/20
unit_required 2ms  retrieved=0 cites=0  tok=0+0 ~$0.0000 day=0/20
```

Both responses carried the full `meta.usage`/`latency`/`attempts`/`budget`
block; two JSONL entries appended; ledger correctly **not** incremented (no
model call). With two synthetic model-call entries + `recordModelCall`, `npm
run metrics` produced the p50/p95 table, mean cost with/without cache
($0.003134 vs $0.003381 on the fixture), hit/miss split, and the day table
(`2026-08-06 2/20 requests`). The DoD's "every field in one stub-driven log
line" is the model-path suffix, unit-pinned via `usageSuffix` inputs in
`lib/instrumentation.test.mjs` + the adapter tests.

## OPEN QUESTIONs (defaults taken)

1. **Ledger day boundary.** Google resets free-tier RPD at midnight Pacific;
   the ledger rolls at **local server midnight** (default taken — simplest
   honest thing for a single dev machine; within a session the running count is
   exact either way). Revisit only if a quota day ever straddles the offset.
2. **Rates for the pinned model.** Constants are the published Gemini
   Flash-tier rates ($0.30/$2.50/$0.075 per MTok) and Voyage large-tier list
   rate ($0.18/MTok — an upper bound; the account's 200M free allowance makes
   marginal embed cost $0). Default taken: project at list rates. **Re-check
   the constants whenever `DEFAULT_MODEL` or `EMBED_MODEL` bumps** — the
   comment on the constants says the same.
3. **What counts against 20/day.** Model calls (including blocked and failed
   ones — they spent quota), not HTTP requests. Known undercount: an error
   thrown *before* the adapter (e.g. retrieval 502) after a hypothetical future
   model call would not be counted — no such path exists today.

## Toolchain — exact

| Command | Result |
|---|---|
| `npm run lint` | exit 0 — **0 errors, 0 warnings** (baseline 0/0, unchanged) |
| `npm run build` | exit 0 — clean (`tsc --noEmit` in `app/`) |
| `npm test` | exit 0 — **156 pass / 0 fail** (baseline 123/0; +33: 4 adapter, 11 metrics, 7 ledger, 11 instrumentation) |
| `node --check` | clean on `lib/providers/gemini.mjs`, `lib/metrics.mjs`, `lib/ledger.mjs`, `lib/diagnose.mjs`, `lib/vision.mjs`, `scripts/serve.mjs`, `scripts/summarize-metrics.mjs` |
| `npm run verify:secrets` | green |

Live calls this round: **0 Gemini, 0 Voyage, 0 Supabase.**

No `CONTRACT MISMATCH` and no `BLOCKED ON KNOWLEDGE` items this round. Nothing
deferred to Frontend (rendering `meta.budget` is optional, not owed). Commits:
`4bb576c` adapter, `5da1480` metrics, `60322d3` ledger, `5cb1ded` core meta,
`a9a127a` serve/summarizer — pushed per instruction without a PR.

---

## Addendum — automatic model fallback (owner request, 10 Aug 2026)

Free-tier quota is per **model** per day, so `complete()` now walks a chain when
the pinned model's daily bucket is spent: `GEMINI_MODEL_CHAIN` (default
`gemini-3.6-flash → gemini-3.5-flash → gemini-3.5-flash-lite →
gemini-3.1-flash-lite` — concrete models verified callable on this account,
quality-ordered, full Flash before the lite tiers; 10 Aug probe). `-latest`
aliases are excluded by design: `gemini-flash-lite-latest` answered as
`modelVersion: gemini-3.5-flash-lite`, so an alias shares its concrete model's
quota bucket and a chain slot for it re-probes a bucket that just 429'd.
`gemini-2.5-flash-lite` is listed but NOT_FOUND on this account — listed ≠
callable, again. Semantics:

- **Daily** exhaustion (`…PerDay…` in the 429 detail) memoizes the model out of
  the chain until local midnight; a **per-minute** throttle chains for that one
  request but does not memoize.
- **Loud, per the eval charter's pinned-model rule:** every response's meta
  carries `model` (which actually answered) and `modelFallback: true|false`;
  transcripts can never pass a fallback answer as the pinned model.
- **An explicit `model` argument never chains** — M12/ST-16 comparison runs
  measure exactly what they name or fail trying.
- All buckets empty → a single clear 429 (`chainExhausted: true`), which the app
  renders as the usual quota error.
- Non-quota errors never chain: a 400 or a safety block on one model is a result,
  not a routing signal.

Five mocked-fetch tests pin these behaviors (`lib/providers/gemini.test.mjs`).
Eval note for ST-16: rounds intended as pinned-model measurements should either
set `GEMINI_MODEL_CHAIN` to a single model or treat any `modelFallback: true`
transcript as a separate bucket in the report — the harness sees the flag.
