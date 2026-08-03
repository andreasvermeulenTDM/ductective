# 04 (design pass) — the Run C mockup, implemented on the prototype

**This is not `.pipeline/04-frontend.md` and it discharges no Run C criterion.**
Stage 4's artifact is written when Stage 4 legitimately runs. This is the mockup's
visual design built onto the existing design prototype, on branch
`design/mockup-implementation`.

## Precondition — Stage 3 has not merged

The Frontend charter requires `03-backend.md` to be committed and its code present
before Stage 4 starts. It isn't. `.pipeline/` holds three briefs and nothing else —
no `01-research.md`, no `02-user-stories.md`, no `025-knowledge.md`, no
`03-backend.md`. What merged in PR #1 is the design prototype, and its own merge
commit says so: *"The prototype is NOT Run C's deliverable and discharges no Run C
criterion."*

So this pass implements only what needs no backend: the design system, the
rendering contracts, and the layouts. Streaming, vision, and real persistence are
filed below rather than faked. No backend code or SQL was touched.

## What changed

| File | Change |
|---|---|
| `app/theme/tokens.ts` | `refusalText`, `interactiveFill`, sunken/rail surfaces, `overline` + `chip` type, `touchSlop()` |
| `app/theme/layout.ts` | new — the 768dp tablet threshold and column widths, in one place |
| `app/components/Citation.tsx` | new — chip, phone sheet, tablet side panel |
| `app/components/Message.tsx` | mockup answer structure: lead, numbered checks, reading callout, chips, advise-only footer |
| `app/components/Chrome.tsx` | two-tab bar, tablet nav rail, session header, offline notice, transport-error card |
| `app/screens/ChatScreen.tsx` | coverage empty state, composer with camera action, offline/error states, tablet split |
| `app/screens/HistoryScreen.tsx` | mockup cards: date grouping, unit badge, cited count, refusal marker |
| `app/screens/CaptureScreen.tsx` | viewfinder framing and the s3 confirmation card |
| `app/App.tsx` | camera moves from tab to composer action; tablet rail + persistent session list; shipped lockup |
| `app/lib/store.ts` | `listSessions` embeds message kinds + citation ids to derive the two badges, with a fallback |

## Review findings fixed in the build

The mockup review flagged four blockers. Three are fixed here; one is a scope call
for you.

1. **Refusal red failed contrast.** `#C0453C` as *text* measures 3.23:1 on its own
   card, 3.14:1 in the offline chip, 2.96:1 as an icon on Steel900. Added
   `color.refusalText` `#D1746D` — same hue and saturation, lightness raised to the
   lowest value clearing 4.5:1 on all three surfaces (5.31 / 5.49 / 4.59).
   `color.refusal` stays `#C0453C` for fills and borders, which is what the brand
   specifies it for.
2. **Touch targets under 48dp.** Citation chips (26dp) and send (40dp) now sit
   inside 48dp Pressables. Note: this is **real layout, not `hitSlop`** —
   react-native-web doesn't implement hitSlop, so a hitSlop-only fix would have
   passed on native and silently failed on the one platform that can be audited
   here. hitSlop is left on as well.
3. **Type scale.** Held tokens.ts's 13px floor. The mockup's 11.5 / 12 / 12.5px
   labels are raised to 13. Rendered app uses 13, 17, 18, 22 — nothing below floor.
4. **Offline queue-and-send** — *not* implemented. See OPEN QUESTION 1.

Also fixed: the hand-redrawn logo is replaced by the shipped
`lockup-horizontal-notag-dark.png`, selected by `brand/README.txt`'s size rule
(no-tagline under ~160px; rendered at 140px). Gradients are gone — flat DuctBlue.
The mockup's `#050B12` / `#0A1421` / `#101F31` are tokens now, not stray hex.

**One defect I introduced and then fixed:** primary buttons were `SignalBlue`, and
white on `#2F93F2` is 3.19:1 — under floor for 17px labels. Filled controls now use
DuctBlue (6.91:1), which also matches `brand/README.txt`'s own roles: DuctBlue is
emphasis, SignalBlue is links.

## Departures from the mockup

- **No Settings tab.** No Epic 6 story defines it and it has no content; an empty
  tab is the dead end E6.6 forbids. Two tabs, camera as the composer's action.
- **No LTE pill.** Reporting "LTE" without a network API is decoration that lies.
  `ConnectionChip` renders only after a request actually fails on the network — the
  half of the state that matters on a roof.
- **No `first token 1.2s` readout.** E6.1 wants time-to-first-token measured and
  reported as evidence, not shown to a technician mid-job.
- **No numeric confidence.** The confirmation says "High confidence", not `0.94`.
  A raw score is an internal a tech can't calibrate against.
- **No quick-answer options (s4) or safe-alternative rows (s8).** See CONTRACT
  MISMATCH 1 — they can't survive a reopen, and options that vanish are worse than
  options that were never drawn.

## OPEN QUESTION

1. **Offline queue-and-send.** The mockup promises questions send themselves when
   signal returns. That's a durable outbox — persistence, retry, ordering, dedupe,
   and a decision about what happens if the unit context changed before it flushes.
   E6.6 asks for an offline *state*, not an outbox. **Default taken:** the offline
   notice says what survives and asks the tech to send again on signal. Nothing is
   silently queued. Reverse it and it becomes Stage 3 scope.
2. **Type floor vs mockup density.** tokens.ts forbids text under 13px, justified
   by sunlight and safety glasses; the mockup draws 75 sub-13px labels. **Default
   taken:** the floor wins, chips fit less per row. If the floor is wrong, it should
   be changed in tokens.ts deliberately rather than per screen.

## CONTRACT MISMATCH — owner: Backend (Stage 3)

1. **No field for clarify options or refusal alternatives.** The persisted message
   contract is `kind | body | citations`. The mockup's quick answers and "what I can
   still do" rows have nowhere to live, so they are not rendered.
2. **No positional anchor on citations.** The mockup places chips inline after the
   claim they support. `citations` carries `claim` text but no span or step index,
   so chips render in a row under the answer instead. Inline placement needs an
   anchor field from Run B.
3. **No structured answer.** Lead / numbered checks / reading callout are parsed out
   of prose by `parseAnswer()` in `Message.tsx`. That is a prototype accommodation.
   Run B should emit the structure rather than have the UI infer it.
4. **No retrieved passage.** The source view shows the document, page, and what the
   citation is attached to — not the quoted span the mockup shows, because the
   contract doesn't carry it and the corpus isn't on the device.

## BLOCKED ON BACKEND

- **E6.1 streaming.** Answers arrive whole. No streaming transport exists.
- **E6.3 nameplate vision.** Capture is simulated; there is no vision endpoint.
- **E6.2 clarify continuity, E6.5 restart persistence** — partially real via
  `sql/002`, but untested against a real core.

## Verification

| Check | Status |
|---|---|
| `npx tsc --noEmit` | **Pass**, 0 errors (baseline was also 0) |
| `npx expo export --platform web` | **Pass**, bundles 801KB, lockup asset included |
| Lint | **No lint script exists in this repo.** Not run, not claimed. |
| Tests | **No test script or runner exists.** E6.10's component tests are unwritten. |
| Contrast audit, rendered DOM | **0 failures** across the app at 375 and 1024 wide |
| Touch targets, rendered DOM | **0 controls under 48dp** |
| Unlabelled controls | **0** |
| Text sizes in use | 13, 17, 18, 22 — none below the 13px floor |
| Stray hex outside tokens | 1 occurrence, in a comment in `Message.tsx`, no value |
| Refusal has no bypass affordance | **Verified live** — 0 interactive elements inside `role="alert"` |
| Citation tap-through | **Verified live** — sheet on phone, side panel on tablet |
| Screenshots | **Not captured.** The Browser pane wasn't displayed, so no frames composited. |

Verified in the browser at 375×812 and 1024×768 against real Supabase. **Not
verified on a physical iOS or Android device** — that needs SETUP-BLOCKERS H7, and
no agent can claim it.

## Still open for E6

- Camera states: permission denied, upload failure. History: loading, error.
  Roughly 5 of E6.6's 9 states exist.
- E6.4's unresolvable-citation error state.
- 200% OS font scaling (E6.7) — needs a device.
- E6.10 component tests — needs a test runner chosen and added.
