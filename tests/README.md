# tests/ — the Stage 5 verification suite

Executable acceptance criteria. Every check traces to a story in
[`docs/phase1-story-map.md`](../docs/phase1-story-map.md) and, where the story
maps to one, to a numbered criterion in a `.pipeline/00-brief*.md`.

```bash
npm run verify:stage5
```

```bash
node --env-file=.env tests/run-all.mjs --run=all --out=.pipeline/05-test-report.md
```

Without `--env-file=.env`, every check that needs Supabase reports **BLOCKED**
rather than FAIL. That distinction is the whole design: a missing credential is
not a defect, and reporting it as one sends the iterate-until-done loop chasing
something that isn't broken.

---

## Verdicts

Four, not two. A criterion that was not mechanically executed is **never PASS**,
no matter how confident an argument could be constructed that it works.

| Verdict | Meaning |
|---|---|
| **PASS** | A command or test ran and demonstrates the criterion. Evidence captured. |
| **FAIL** | It ran and the criterion did not hold. |
| **BLOCKED** | It could not run. The note names exactly what was missing. |
| **HUMAN-ONLY** | Needs a device, an external account, or a human eye. Listed, never claimed. |

Exit code is `1` if and only if something FAILED. BLOCKED and HUMAN-ONLY are
reported loudly and do not fail the run.

**Evidence** is the exact command, its exit code, and the relevant output —
enough to re-run and get the same answer. Prose asserting that something works
is not evidence, and the harness has no way to record one.

---

## Layout

```
tests/
  run-all.mjs            the run: precondition gate → suites → integrity → report
  harness.mjs            verdict builders, evidence capture, stage gating
  lib/contrast.mjs       WCAG 2.1 contrast, and a reader for the token module
  lib/csv.mjs            manifest parsing + the SourceURL-basename join key
  lib/jsx.mjs            JSX tag/attribute extraction without a parser
  suites/e0-rails.mjs    E0.1 E0.2 E0.6 E0.7    brief AC 1, 4, 9
  suites/e1-ingestion.mjs E1.1–E1.10            brief AC 5, 6, 8
  suites/e2-retrieval.mjs E2.1–E2.3             brief AC 7
  suites/e5-safety.mjs   E5.1–E5.3              Run C AC 5   — every round
  suites/e6-app.mjs      E6.4 E6.7 E6.8 E6.10   Run C AC 4, 7, 9, 10 — every round
  suites/e7-e8-…mjs      E7.1 E8.1 E8.2         — every round
  suites/human-only.mjs  the checklist no agent can complete
  fixtures/              the fault list, and the schemas Stage 5 asserts against
  last-run.md            generated report
  last-run.json          generated state, for round-over-round comparison
```

No test framework. The repo has no test toolchain yet — that is story E0.7,
still open — and the brief's constraint is "boring, working, few dependencies".
This mirrors [`scripts/verify-connection.mjs`](../scripts/verify-connection.mjs),
which is the convention already here. Node ≥ 22, zero new dependencies.

---

## Run scoping

`--run=A` (default) executes the Run A suites plus everything marked `run: '*'`.
Suites for a run that isn't active are **not executed and not counted** — they are
listed in the report under "Not run this round". That is scope, not a verdict, and
nothing in the report claims coverage of them.

Safety (E5) and the machine-checkable half of the app (E6) run in *every* round.
They guard the citation contract, the token module, and the refusal path — exactly
the things a later refactor breaks quietly.

## Preconditions

`run-all` first reports which pipeline stages have landed. A check owned by a
stage whose artifact is absent reports **BLOCKED against that stage**, not FAIL
against the code. Running a suite against a tree missing a stage's work and
reporting green is worse than not running it at all.

## Run integrity

`lib/clients.mjs` records every stub it activates and states that Stage 5 must
assert the list is empty. `run-all` does, after every suite. If a stub answered
during verification, the run is marked FAILED regardless of what the checks said —
a scored run that unknowingly graded fabricated data is worse than one that failed
outright.

## Regressions

Each run writes `last-run.json` and compares the next run against it. Anything
that went PASS → FAIL is reported as a **regression at the top of the report**,
above the summary counts — an improved total that hides a broken check is the
reporting failure this suite exists to avoid.

One caveat: checks are matched on story + description. Tightening an existing
check without renaming it shows up as a regression on the next run. That is the
mechanism working, but read the diff before routing it as a defect.

---

## What this suite deliberately does not do

**It does not author test cases for the stages it grades.** The retrieval smoke
set (E2.2) belongs to Knowledge; the scenario set (E7.1) belongs to Eval. A stage
that writes its own test cases and then reports its own score against them has
measured nothing. Both are read from `fixtures/` — see
[`fixtures/SCHEMAS.md`](fixtures/SCHEMAS.md) for the shapes those stages produce,
so the expectation is published rather than discovered when a check goes red.

**It does not score answers.** Whether a diagnostic answer is *correct*, whether a
citation actually *supports* the claim attached to it, and whether a refusal holds
under pressure are Stage 5.5's measurements. This suite owns the mechanical half:
that a chunk with no page can't be written, that an uncited claim can't render,
that no bypass affordance exists. Neither substitutes for the other.

**It does not weaken a check to make it pass.** Per
[`.claude/agents/test.md`](../.claude/agents/test.md), fixes here are limited to
wiring-level breakage. Assertions are never loosened, skipped, or deleted to turn
a FAIL green, and acceptance criteria are never edited. A relaxed test reports a
system that doesn't exist.

**It does not satisfy E0.7.** Wiring `lint`, `build`, and `test` scripts is a
Backend-owned story and this suite grades it. The command above is deliberately
named `verify:stage5` so that adding it does not partially satisfy a criterion
this suite is also scoring.
