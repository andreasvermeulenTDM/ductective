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

## E6.6 — state coverage, enumerated

The story says "nine states"; `tests/suites/human-only.mjs` is the operative spec
and asks for **loading, empty, error, and offline for each of chat, camera, and
history** — twelve. All twelve now exist and are reachable.

| | loading | empty | error | offline |
|---|---|---|---|---|
| **Chat** | reopening a session | first run, with coverage stated | transport failure, nothing partial kept | inline notice, answers stay readable |
| **Camera** | reading the plate | viewfinder, nothing captured | plate unreadable → retake or type | no signal → type instead |
| **History** | loading past jobs | no jobs yet | query failed, with retry | can't reach history, nothing lost |

Plus a thirteenth that E6.3 requires: **camera permission denied**, routing to
manual entry. Verified live — denied → "Type the model instead" → a working model
form, no dead end.

Two notes on how they're reached:

- Offline is classified from the failure that actually occurred (`lib/net.ts`),
  not a mocked flag. The human-only checklist rightly insists the screenshots come
  from airplane mode on a real device, and that still stands.
- Camera's three failure states are unreachable without a camera or a vision
  endpoint, so a `__DEV__`-only simulator opens them. `__DEV__` is false in any
  production build. It exists because a state nobody can open is a state nobody
  has checked, and it disappears on its own when the real camera lands.

## E6.4 — the unresolvable-citation rule

`lib/citations.ts` defines *resolves* once, for the UI and for Stage 5: a citation
resolves when it names a document and a page a technician could physically turn to.
A missing document, or a page that is null, non-integer, or < 1, does not.

Three behaviours follow, all wired:

1. A broken citation renders as a red **"! source unresolved"** chip, never as a
   chip with `p.0` or `p.undefined` in it. Tapping explains why.
2. Broken citations render **alongside** good ones rather than being dropped —
   silently discarding them would make an answer look better-sourced than it is.
3. An answer whose citations **all** fail to resolve is an uncited claim and
   renders as the withheld-defect card. Well-formed prose doesn't make it citeable.

**This state cannot be reached through the app's own write path**, and that is the
correct outcome: `sql/002` constrains `source_document not null` and
`page integer not null check (page > 0)`, so the database refuses to store one.
The guard covers citations arriving from Run B's core, which writes on a different
path. E6.4 marks this criterion *(machine)* rather than screenshot-based for
exactly that reason — so no `__DEV__` backdoor was added to fake it.

## E6.9 — a real defect found at 375×667

Checking the narrowest common phone turned up something 375×812 hid. The capture
confirmation renders **713dp of content into a 667dp viewport**, and the screen
had no scroll container — so the overflow was not below the fold, it was
*unreachable*. The prototype warning line simply wasn't there.

All four capture layouts are `ScrollView`s now, with `flexGrow: 1` so short
content still centres. Verified: before the fix the warning sat at 713 with no
way to reach it; after, the container scrolls 78dp and the line lands at 635.

This is also the fix E6.7's 200% font-scale criterion needs — at that scale every
one of these screens overflows on every device, not just the small ones.

Chat and history were already scroll-based and are clean at 375×667: no
horizontal scroll, no clipping, no truncation, all controls reachable.

## E6.10 — half done, and the half that isn't

`parseAnswer()` moved out of `Message.tsx` into `lib/answerFormat.ts` so it can be
tested without a renderer. With `lib/citations.ts`, the two pieces of real logic
behind the citation contract are now pure, exported, and covered:

```bash
node --test app/lib/*.test.mts
```

**19 tests, all passing.** They cover the rule that `p.0` and `p.undefined` can
never render as authoritative, that broken citations are kept rather than dropped,
that an all-broken answer must be withheld, and that the prose parser doesn't
mistake "630 psig" for a step number or a wrapped line for the reading callout.

Zero new dependencies: Node's built-in runner, and Node ≥ 22.18 strips the types
on import. Two consequences worth recording:

- The tests are `.mts` because `app/package.json` is CommonJS. Adding
  `"type": "module"` would change how Metro resolves the app, which is not a
  change to make for a test file.
- They're excluded from `tsc --noEmit` (see `app/tsconfig.json`). Typechecking
  them would mean adding `@types/node` to an Expo app with no other use for it.
  They are *executed* every run, which is the stronger guarantee.

**No script was added.** `tests/README.md` names its own command `verify:stage5`
specifically so that adding it doesn't partially satisfy E0.7, which is
Backend-owned and which the suite grades. Same discipline here: E0.7 stays
honestly FAIL until Backend wires a real toolchain.

### OPEN QUESTION — the other half of E6.10

E6.10 asks for component tests covering "message rendering, citation rendering and
**tap-through**, and refusal rendering". Tap-through cannot be asserted without a
renderer, and no renderer exists here. Today those contracts are held by static
JSX analysis in `tests/suites/e6-app.mjs`, which catches a deleted guard but not a
broken interaction.

**Default taken:** ship the pure-logic tests, leave rendering to static analysis,
and don't unilaterally add `@testing-library/react-native` — picking the toolchain
is E0.7's job and it belongs to Backend. Reverse it if you'd rather I choose one.

## E6.7 — 200% font scale, simulated and fixed

OS font scaling multiplies `fontSize`, so it can be reproduced in the browser by
rewriting the font-size and line-height rules React Native Web emits. Doing that
at 2× found a real defect on the app's most-tapped control.

**The citation chip clipped its own label.** It carried a fixed `height: 26`, and
a React Native `View` is `overflow: hidden` — so at 200% the pill stayed 24dp
around 32dp of text and the document name was cut off. Same fixed-height pattern
fixed in three places: the chip, the source icons, and the step number circle, all
`height` → `minHeight` with padding. The step number becomes a rounded rect rather
than a circle at large scale, which is the correct trade: the brief says legibility
wins where it competes with elegance.

Also added `maxWidth` on the chip's touch wrapper so a long document name ellipses
inside the column instead of running off the screen edge.

Measured at 375×667, on an answer with steps and citations:

| scale | clipped | overflowing right | targets < 48dp |
|---|---|---|---|
| 100% | 0 | 0 | 0 |
| **200%** | **0** | **0** | **0** |
| 300% | 0 | 2 chips | 0 |

300% is past what E6.7 asks for and is recorded, not fixed.

**This does not discharge the criterion.** E6.7's check is human-only and means
the OS setting on a physical device; this is a simulation of the same multiplier,
and it is worth exactly as much as that. What it buys is that the obvious
breakage is already gone before anyone picks up a phone.

## Still open for E6

- 200% font scale on real hardware (E6.7) — still human-only, still unclaimed.
- Component tap-through tests — see the OPEN QUESTION above.
