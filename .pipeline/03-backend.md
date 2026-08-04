# 03 — Backend · Run A

Stage 3 artifact for `.pipeline/00-brief.md` (Run A). Stories are the ones in
`.pipeline/02-user-stories.md`; the pre-Stage-2 numbering in
`docs/phase1-story-map.md` (E0.x) is superseded by S1–S6.

**This pass covers S1 and S2.** S3 is startable and not yet begun; S4–S6 are
gated. Status of every Backend story is tabulated at the bottom.

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
| S4 — serverless Claude proxy | Critical | **Blocked on H2** — `ANTHROPIC_API_KEY` empty; `lib/clients.mjs:172` throws `TODO(Stage 3)` |
| S5 — device round trip | Critical | Blocked on S4 + **H7** (no device) |
| S6 — chunks migration applied | Critical | **Blocked on Knowledge S12** — schema is Stage 2.5's to design |

No `CONTRACT MISMATCH` and no `BLOCKED ON KNOWLEDGE` items: S6 is a planned
dependency on Stage 2.5, not a broken or missing contract.
