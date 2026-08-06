# 04 — Frontend · Run A

**Nothing to do, as the brief prescribed — and here is the handoff that makes
that a completed stage rather than a skipped one.**

Run A's brief scoped Frontend to a throwaway hello-world screen and told this
stage to expect nothing beyond it. The repo is ahead of even that: a design
prototype already exists in `app/` (built outside the pipeline while H2/H3 were
pending, merged via PR #1 and iterated since), so there was no hello-world screen
left to build.

## What this stage is explicitly NOT claiming

- **The prototype is not this stage's deliverable and discharges no Run C
  criterion.** It carries mock answers behind a persistent PROTOTYPE banner; its
  citations are unverified by construction. Run C builds the real chat/camera UI
  against `.pipeline/00-brief-run-c.md` and treats the prototype as reference
  material, not a head start to extend.
- **Criteria 2 and 3 (device round trip) are not claimed.** They are human-only
  (H7 — physical device + Expo Go) and remain open on `SETUP-BLOCKERS.md`.

## What Run C inherits from Run A's tree

- `app/theme/tokens.ts` — the E6.8 token module, palette names verbatim from
  `brand/README.txt`, no React Native imports, greppably hex-free elsewhere.
- The structural guarantees already under Stage 5 checks: uncited answers render
  as WITHHELD defects, refusals carry no dismiss/bypass affordance, refusal
  contrast ≥ 4.5:1.
- The diagnostic client seam (`app/lib/diagnose.ts` → `scripts/serve.mjs`) that
  Stage 3 documented in `03-backend.md`.

## Lint / build / test

`app` TypeScript: `tsc --noEmit` clean. Unit tests: 65 pass repo-wide. No
component-test harness exists yet — that is Run C AC 10's deliverable (E6.10),
and the Stage 5 check for it is gated accordingly rather than failed against a
run that owed no components.

No `CONTRACT MISMATCH`, no `BLOCKED ON BACKEND` — nothing was built to mismatch.
Handed off to Stage 5.
