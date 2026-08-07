# Backlog

Open items that are not blocking the current round's acceptance criteria. Per
`CLAUDE.md`, Critical/High issues do **not** belong here — they block "done". The
one High below is filed rather than fixed because the fix belongs to a different
stage's files and needs its own story, tests and review; it is called out to the
owner rather than buried.

---

## H — `resolveUnit` misses full nameplate model numbers (found 7 Aug 2026)

**Status:** open. Found while adding the owner ZIP batch; **pre-existing**, not
introduced by it.

A technician types — or a camera reads — the model number printed on the plate.
`lib/units.mjs` matches the query's tokens against the manifest's coverage string,
and the match is `coverage.includes(token)`. A full nameplate model is one long
token that no coverage string contains, so a **covered** unit resolves as
`unrecognised`:

| Typed | Verdict | Reality |
|---|---|---|
| `Carrier 48TC` | covered, 1 doc | correct |
| `Carrier 48TCA06` | **unrecognised** | same unit, same manual |
| `Carrier 50HC024` | **unrecognised** | covered by `50HC-7-12-07SI` |
| `Trane Precedent` | covered, 4 docs | correct |
| `Trane YSC072E3RHB0000` | **unrecognised** | a Precedent — 4 manuals |

**Why this is High, not backlog-normal.** It lands directly on the camera story
the owner asked for. `lib/vision.mjs` instructs the model that "`model` is the
model number", `/identify-unit` passes that verbatim to `resolveUnit`, and U4 runs
resolution *before* the first question. So the most likely real-world path — point
the phone at the plate of a Trane Precedent — ends in "I don't have documentation
for that unit" while four Precedent manuals sit in the corpus. The unit-first
design converts a wrong answer into an unreachable state, which is right; this
turns a *right* answer into an unreachable state, which is not.

It is invisible to every current test because the fixtures and the ST-14 probes
all use family names (`Precedent`, `48TC`) or genuinely uncovered units.

**Proposed fix (needs its own story — Backend owns `lib/units.mjs`):**

1. Match a query token when a coverage token is a **prefix** of it, with a minimum
   coverage-token length (≥3) so `50` cannot match everything. This alone fixes
   `48TCA06` → `48TC` and `50HC024` → `50HC`.
2. Trane is not fixed by (1), because Trane coverage strings carry family names
   rather than model prefixes. Add the nameplate prefixes to the manifest coverage
   column — e.g. `Precedent packaged rooftop 3-25 ton (YSC, YHC)` — keeping scope
   and matching derived from manifest columns, per `reconcile.mjs`.
3. Guard both directions in `units.test.mjs`: full nameplate models resolve, and
   the ST-14 out-of-scope five still resolve to zero documents. Prefix matching is
   exactly the change that could make an uncovered unit look covered, so the
   coverage-edge assertions are the fix's safety net and must run against it.

**Do not** widen this into fuzzy/substring matching in the other direction. U4's
whole value is that it refuses to guess a nearest model; a looser matcher buys
recall by reintroducing the failure the story exists to prevent.

---

## L — `parseDocumentAsync` ignores `parser_version`

`ingest/parse.mjs:156` returns any cached parse, while the synchronous
`parseDocument` (line 74) discards a cache written by an older parser. A future
`PARSER_VERSION` bump would therefore be honoured by `npm run ingest` and silently
skipped by `npm run ingest:parse` — the exact "a parser fix that a warm cache
hides" failure the version check was added to prevent, still open on one of the two
paths. One line; no impact today because the cache was rebuilt at version 2.

---

## L — wire probes cannot prove which tree the server is running

Carried from `05-test-report.md` (ST-12/ST-14). The transcript's `gitCommit`
records the *prober's* HEAD, not the server's, and a stale `serve.mjs` once
produced a full run of false results. A `/health` endpoint returning the server's
own commit, asserted equal before a scored run, closes it.
