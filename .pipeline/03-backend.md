# 03 — Backend · Run A

Stage 3 artifact for `.pipeline/00-brief.md` (Run A). Stories are the ones in
`.pipeline/02-user-stories.md`; the pre-Stage-2 numbering in
`docs/phase1-story-map.md` (E0.x) is superseded by S1–S6.

**This pass covers S1 only.** S2 and S3 are startable and not yet begun; S4–S6 are
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
| S2 — secrets out of repo and bundle | Critical | Startable now, not begun |
| S3 — cost tracking against budget | Medium | Startable now, not begun |
| S4 — serverless Claude proxy | Critical | **Blocked on H2** — `ANTHROPIC_API_KEY` empty; `lib/clients.mjs:172` throws `TODO(Stage 3)` |
| S5 — device round trip | Critical | Blocked on S4 + **H7** (no device) |
| S6 — chunks migration applied | Critical | **Blocked on Knowledge S12** — schema is Stage 2.5's to design |

No `CONTRACT MISMATCH` and no `BLOCKED ON KNOWLEDGE` items: S6 is a planned
dependency on Stage 2.5, not a broken or missing contract.
