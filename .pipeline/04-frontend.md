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

---

# Addendum — Run B Stage 4 · 8 Aug 2026 · real nameplate capture (owner escalation)

Branch `stage/frontend-camera`, cut from `main` at `1f5799d` (the ST-02/ST-04/
ST-05 merge). One owner-escalated task, per Addendum A in `02-user-stories.md`:
**replace the simulated nameplate capture with the real camera, wired to the
live vision endpoint.** The owner's words: "I want to use my camera for
capturing the nameplate — not simulated."

Run B's "Frontend: nothing to do" note above still governs everything else —
this addendum is the one exception, and it is the owner's, not this stage's.

**Precondition checked.** `03-backend.md`'s Run B addendum is committed and the
code it describes is on `main` in this worktree: `lib/vision.mjs`,
`lib/units.mjs`, and the `/identify-unit` route in `scripts/serve.mjs`. Nothing
backend was reimplemented; `lib/` and `scripts/` are untouched this round.

**Quota rule honored: zero live Gemini calls.** Every test and every
verification here ran against stubbed fetch/server responses covering all four
contract shapes. **The first live photo identification is quota-gated to the
owner's next window** (ST-07, quota day Q4) — nothing in this round has pointed
a camera at a real plate and asked the model.

## What changed, and why

### Module choice (justified per SDK 54 docs, as required)

- **`expo-camera` ~17.0.10** for capture. `expo-image-picker`'s camera is a
  full-screen *system* modal; using it would discard the corner-bracketed
  viewfinder the screen is designed around. `CameraView` renders inside the
  frame, so the design language survives the hardware. Permissions via
  `useCameraPermissions` (the v54 hook).
- **`expo-image-picker` ~17.0.11** for the library path the story also
  requires — a plate photographed from the ground before climbing.
  `launchImageLibraryAsync({ mediaTypes: 'images' })` per v54 (the
  `MediaTypeOptions` enum is deprecated there).
- **`expo-image-manipulator` ~14.0.8** for client-side resize, using the v54
  contextual API (`ImageManipulator.manipulate(uri).resize(...).renderAsync()`
  → `saveAsync({ format: JPEG, compress: 0.7, base64: true })`), not the
  deprecated `manipulateAsync`.

All three installed with `npx expo install` so versions align to the SDK 54 pin
(`app/AGENTS.md`). Config plugins in `app.json` carry the permission strings for
future dev builds; Expo Go uses its own Info.plist today.

### Files

- **`app/lib/identify.ts`** (new) — the `/identify-unit` contract kept pure: no
  React Native import, so `node --test` runs it (the `citations.ts` split).
  Types for the response and the `unit` verdict verbatim from `03-backend.md`;
  `parseIdentifyResponse` rejects anything off-contract (a malformed 200 is a
  502-shaped failure, never a guessed reading); `postIdentify` classifies the
  four shapes with fetch injected; `resizeTarget` mirrors the server's 1536 px
  cap (`lib/vision.mjs` `MAX_EDGE_PX`) and never upscales a known size;
  `confirmedUnitFrom` builds the session payload with `documentIds` verbatim.
- **`app/lib/diagnose.ts`** — `requestIdentifyUnit(base64, cancel?)`: base URL
  (with the existing loopback rewrite), 60 s timeout, cancel path, failures
  thrown as the same `DiagnoseError` the app already renders.
  `requestDiagnosis` grows the contract's optional `documentIds` field
  (absent = omitted; `[]` sent as-is — the semantics differ on purpose). The
  unit-required `CONTRACT MISMATCH` comment at `refusalCheck` now records its
  closure by ST-02 instead of describing a fixed defect as current.
- **`app/lib/store.ts`, `app/screens/ChatScreen.tsx`, `app/App.tsx`** —
  `documentIds` threaded from the capture confirmation into every `/diagnose`
  call in the session, per the backend hand-off list ("send `documentIds` on
  the app path").
- **`app/screens/CaptureScreen.tsx`** — the rewrite. Kept: corner-bracketed
  frame (now clipping a live `CameraView`), the confirmation card, the ≤2-tap
  correction path ("Wrong unit, let me pick", now prefilled with the read so a
  near-miss is an edit), "Type the model instead" reachable from every state,
  the CancelBar escape. Gone: `StateSimulator`, the fixed `READ_MODEL` text,
  and both "Prototype:" warning captions (the second one — "the model you type
  isn't attached to the session yet" — was already stale: `createSession`
  persists `equipment`). New: `Choose from photos`, the in-frame permission
  prompt, and a distinct retryable `error` state.

### The response wiring, per the contract's own taxonomy

| Wire | Rendered as |
|---|---|
| `identified: true` | Confirmation card: real manufacturer, model, **confidence class word** (never a decimal), the unit's documents ("I'll answer from"), and — for `out_of_scope`/`unrecognised` — the verdict's ready-to-render `message` |
| `identified: false` | The honest "couldn't read that plate" **answer** (server's fixed retake copy, partial read surfaced but never resolved), with Retake + manual entry — deliberately *not* the error rendering |
| 502 `providerBlocked: true` | An **error with retry**, in copy that names it a filter artifact — never an identification, never safety advice |
| other 4xx/5xx / timeout / offline | Error with retry; network-shaped failures route to the existing `OfflineState` |

Confirming passes `confirmedUnitFrom(result)` — `{equipment, documentIds}` —
into exactly the seam the simulated path used (`onDone` → App state → session
creation), so a covered unit's diagnosis is scoped to its manuals and a
non-covered unit's `[]` yields the honest no-documentation answer downstream
instead of another manufacturer's citations. `PermissionDenied` is wired to the
real flow: auto-request once on arrival, in-frame re-request while
`canAskAgain`, `Linking.openSettings()` when permanently denied — manual entry
primary throughout.

## How to verify

- **Contract fidelity (mocked, no quota):** `npm test` — 12 new cases in
  `app/lib/identify.test.mjs` pin all four shapes, the request body
  byte-for-byte, malformed-200 rejection, `[]`-vs-`null` `documentIds`
  semantics, and the resize math.
- **On the device (owner, next quota window):** `npm run serve` with keys set,
  `EXPO_PUBLIC_DIAGNOSE_URL` pointed at the LAN address, Expo Go → camera
  button → shoot a plate. Expect: live viewfinder in the bracket frame;
  confirmation card with the real read; confirm → ask a symptom → the serve
  log shows `scope=N` on the diagnosis. Kill the server signal for the offline
  state; deny the permission for the denied path. This is Run C criterion 3's
  re-verification and **counts against quota** — it belongs in the ST-07
  window.

## Toolchain status — exact

| Command | Result |
|---|---|
| `npm run lint` | exit 0 — **0 errors, 0 warnings** (baseline 0/0, unchanged) |
| `npm run build` (`tsc --noEmit` in `app/`) | exit 0 — clean |
| `npm test` | exit 0 — **123 pass / 0 fail** (baseline 111/0; +12 identify contract tests) |
| `npm run verify:secrets` | green (shape rules only — `.env` holds no real values here) |

No component/E2E renderer exists in this repo (the Run A note above still
holds), so the changed views were **not** visually rendered by a harness —
verification is the contract tests plus the device pass above. Accessibility
held at the existing floor: every interactive element is a `Pressable` with
`accessibilityRole`/`accessibilityLabel`, disabled states declared via
`accessibilityState`, form controls labelled, the coverage notice announced as
an alert, and the 48 dp touch floor (`MIN_TOUCH`) kept throughout.

## CONTRACT MISMATCH / BLOCKED ON BACKEND

**None this round.** The `/identify-unit` contract was implementable exactly as
documented. Noted for completeness: the pre-existing sql/007 adapter
(`meta.scopeFallback`, owner: Knowledge/project owner) means a scoped diagnosis
may silently run unscoped until the migration is applied — visible in `meta`,
nothing for the client to do.

## OPEN QUESTIONs (defaults taken)

1. **Confirming a non-covered identification.** Default: allowed, with the
   verdict's `message` rendered on the card and `documentIds: []` passed
   verbatim — every subsequent question gets the honest no-documentation shape
   rather than another manufacturer's manual. The alternative (blocking
   confirm) would dead-end a tech whose plate read correctly but whose model
   coverage matching missed (the known YSC/YHC alias gap).
2. **Scope is not persisted.** The `sessions` table has no `documentIds`
   column, so a reopened session diagnoses gated-but-unscoped (equipment text
   only). Filed here as a Run C persistence gap — a schema change is not this
   stage's to make.
3. **Manual entry sends no verdict.** The typed path passes
   `documentIds: null` (server gates on `equipment`), unchanged behavior.
   Calling `/resolve-unit` from the manual form — U4's "coverage stated at
   selection" done properly client-side — is Run C scope.

Per instruction: branch pushed, **no PR, no merge**.

---

## Device feedback round 2 (7 Aug 2026) — all nine items

Owner tested on iPhone and returned nine items. All nine are done; the ninth
("UX still feels clunky") is the sum of the other eight rather than a separate fix.

| # | Item | Resolution |
|---|---|---|
| 1 | "What covered right now" should be removed | Removed from the gate **and** the chat empty state |
| 2 | Pre-canned responses should match the unit | `app/lib/starters.ts` — class derived from the resolved documents' coverage |
| 3 | Show if the unit is located / we have data | `CoverageLine` — "1 manual for this unit" / "No documentation" / "not checked" |
| 4 | Pre-done responses show twice when clicked | Fixed — a session-creation race, not a double tap |
| 5 | Take pictures during the diagnostic | ST-17 server + UI, below |
| 6 | Logo should go home | Lockup is a button with a real touch target |
| 7 | Clean up the home screen | Coverage panel gone, safety escape collapsed behind a disclosure |
| 8 | Delete history | Trash control + long press, destructive confirm, optimistic with rollback |
| 9 | UX feels clunky | The above |

### The duplicate was a race, not a double tap

Sending the first message creates a session and calls `onSession(id)`. That prop
change fired the load effect, which re-read the same turn from Postgres while the
optimistic copy was already in state — so the tapped suggestion rendered twice. The
screen now marks sessions it created itself and the effect skips them. The earlier
`sending` ref (from round 1) was a real fix for a different double-fire and is
untouched.

### Coverage stated per unit, and typed units now resolve

The camera path always had a verdict inside `/identify-unit`; **manual entry never
called `/resolve-unit` at all**, so a typed unit reached the composer ungrounded
*and* the app could not say whether it held documentation for it. It resolves now,
which fixes both.

Found by running it: sending the whole typed string as both `manufacturer` and
`model` resolved "Trane YSC072E3" and silently failed "Goodman AMEC960603" — the
corpus carries "Goodman / Amana" and the server's manufacturer test is containment,
so a multi-word make never matched. `splitUnitText` takes the make off the front.
Verified against the live endpoint across seven units.

### Suggestions may never be something the app refuses

The starter list is chosen by equipment class, and carries a rule worth stating: a
suggestion the safety gate would refuse is worse than no suggestion, because the app
invites a question and then declines it. Three of the top-15 faults (F11 ignition,
F12 rollout, F14 charge verification) sit in refusal territory, so none of them is
offered. `starters.test.mjs` runs the real `classifyHazard` over every suggestion of
every class, so a future edit that adds one fails CI rather than a roof.

### ST-17 — photos during the diagnostic, without weakening citations

The design question is the citation rule: `CLAUDE.md` requires every diagnostic
statement to trace to a source document and page, and **a photograph is not a source
document**. The resolution is that a photo is an *observation*, never an authority:

- The prompt says so explicitly — the photo informs what the answer says it can see,
  and every numbered step must still come from and cite a numbered source.
- `validateAnswer` enforces it structurally, unchanged: a step whose source index
  does not resolve is dropped whatever the model saw, and an answer that is *only*
  photo-justified degrades to no-documentation rather than emitting an uncited claim.

Ordering is deliberate and asserted: the safety gate and the coverage short-circuit
both run **before** the image is decoded, so a hazardous question with a photo
attached refuses without paying for image processing, and an uncovered unit is told
so without it either. Image validation is `prepareImage`, extracted from
`/identify-unit` so both routes run one implementation of the decode, JPEG-only and
size rules rather than two.

UI: the composer's camera button now does the job that is actually needed at each
point — identify the unit when there isn't one, photograph the part once there is.
Before, it re-ran nameplate capture mid-diagnosis, which is never what someone
pointing at a scorched contactor wants. The photo is held beside the composer with a
thumbnail and a remove control, and is sent with the next question rather than on
capture, because a photo with no words is a guessing game.

Verified live: hazard+photo refuses (no decode), uncovered+photo answers
no-documentation (no decode), a malformed image is a clean 400 and a PNG a 415 —
the same rules the nameplate route enforces.

**Gates: 286 tests pass · lint 0 · typecheck clean · ST-12/ST-14 probes 117
assertions green, ledger 0 → 0.**
