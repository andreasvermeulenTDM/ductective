# 04 — Frontend · Device-feedback fixes, Wave 2 (F1, F4, F5)

Reads `.pipeline/00-brief-fixes.md`, `.pipeline/02-user-stories-fixes.md` (with the
OWNER DECISIONS block), `.pipeline/03-backend-fixes.md`, the Wave 0 section of
`.pipeline/05-test-report.md`, `app/AGENTS.md` and `CLAUDE.md`.
Branch `stage/frontend-fixes`, rebased on `main` at `2b30f29`.

**Scope taken:** the stories this run assigned to Frontend — **ST-F01**, **ST-F02**,
**ST-F03** (F1), **ST-F13**, **ST-F14** (F4), **ST-F17** (palette) and **ST-F19**
(density). ST-F01 and ST-F13 are Backend-owned in the wave plan and were *not*
delivered by Wave 1 (`03-backend-fixes.md` §Scope says so explicitly); they were
reassigned to this run and are built here. Both are pure `app/lib` modules.

**Not mine, not touched:** **ST-F07** (conversational rendering in `Message.tsx`)
and **ST-F11** (the type-ahead UI in `CaptureScreen.tsx`) are Wave 2 Frontend
stories that were not in this assignment. `Message.tsx` and `CaptureScreen.tsx` are
byte-unchanged on this branch — see §8.

---

## Contents

1. [Precondition check](#1-precondition-check)
2. [What landed, and why](#2-what-landed-and-why)
3. [F5 — the palette, with every ratio that moved](#3-f5--the-palette-with-every-ratio-that-moved)
4. [F5 — the density before/after](#4-f5--the-density-beforeafter)
5. [How to verify each acceptance criterion](#5-how-to-verify-each-acceptance-criterion)
6. [Gate status](#6-gate-status)
7. [Accessibility and responsiveness — what was held](#7-accessibility-and-responsiveness--what-was-held)
8. [CONTRACT MISMATCH / BLOCKED ON BACKEND](#8-contract-mismatch--blocked-on-backend)
9. [Instrument defects found and fixed, reported not absorbed](#9-instrument-defects-found-and-fixed-reported-not-absorbed)
10. [OPEN QUESTIONs, with the default taken](#10-open-questions-with-the-default-taken)
11. [Recommendations I did not act on](#11-recommendations-i-did-not-act-on)

---

## 1. Precondition check

| Requirement | State |
|---|---|
| `03-backend-fixes.md` committed | yes — `089816e`, on `main` |
| The backend code it describes is present in this worktree | yes. `lib/conversation.mjs`, `lib/diagnose.mjs` step 1a, `sql/015_conversational_kind.sql`, `lib/units.mjs` `suggestUnits`, `POST /suggest-units`, `app/lib/suggest.ts`, `requestSuggestUnits` in `app/lib/diagnose.ts`, and `MessageKind`/`DiagnoseReply['kind']` both carrying `'conversational'` — all verified in the tree, not assumed from the artifact |
| Wave 0 instruments present | yes — `tests/lib/contrastMatrix.mjs`, `tests/lib/density.mjs`, `tests/fixtures/density-baseline.json` |
| Backend reimplemented to unblock myself | **no.** No file under `lib/`, `scripts/`, `sql/` or `ingest/` is touched on this branch |

---

## 2. What landed, and why

### F1 — the account message can be cleared (ST-F01, ST-F02, ST-F03)

| story | file | what |
|---|---|---|
| ST-F01 | **`app/lib/guestNotice.ts`** (new) | `canDismiss`, `dismiss`, `sawTurn`, `reset`, `setSignedIn`, `isAnswer`. Pure, no imports at all |
| ST-F01 | **`app/lib/guestNotice.test.mjs`** (new) | 19 tests |
| ST-F02 | `app/components/Chrome.tsx` | `GuestNotice` takes an optional `onDismiss`; the affordance sits inside a `{onDismiss && …}` guard |
| ST-F02 | `app/lib/accountCopy.ts` | `GUEST_DISCLOSURE.dismiss` / `.dismissLabel`. The three existing fields are byte-unchanged |
| ST-F02 | `app/App.tsx` | one dismissal state for both surfaces; reset wired to the existing `lastUser` effect |
| ST-F02 | `app/screens/ChatScreen.tsx`, `app/screens/UnitGate.tsx` | render on `!signedIn && !noticeDismissed`; both report every assistant turn |
| ST-F03 | `app/screens/accountUi.test.mjs` | the ST-A06 AC 6 test rewritten, plus 7 new static checks |

**The rule, unchanged from §2.1 of the stories and from the owner's decision: the
dismiss control does not exist until the first answer of this app run has been
delivered.** Absent, not disabled. A refusal counts as an answer — that is the
whole reason `UnitGate` carries the disclosure — and the counter is shared, so an
answer taken at the gate earns the dismissal on the composer.

Three things make that a guarantee rather than an intention:

1. `dismiss(state)` returns the state **unchanged** when `canDismiss` is false. No
   call site, ordering mistake or later refactor can reach `dismissed: true`
   without an answer first. That is brief AC 1's machine proof and it is driven
   over 0..5 user turns in `guestNotice.test.mjs`.
2. **No persistence, structurally.** The module has no imports, and a test greps
   it for `AsyncStorage`, `require(`, `localStorage`, `SecureStore` and `MMKV`.
   OQ-F1's owner decision — until the app closes — cannot rot into a stored flag
   by accident.
3. `accountUi.test.mjs` asserts that **no file outside `app/lib/guestNotice.ts`
   sets the flag directly**, and that neither screen holds its own `useState` for
   it.

The copy is `Got it` / `Dismiss the not-saved notice` — a receipt, not a risk
waiver. Both are run against `e5-safety.mjs`'s seven `BYPASS_PATTERNS` by a test in
`accountUi.test.mjs`; "I understand the risks" would match one of them and is wrong
anyway.

**`GUEST_DISCLOSURE.label` / `.body` / `.action` are byte-for-byte unchanged.**
`accountCopy.test.mjs` passes unmodified.

### F4 — see more of the cited page (ST-F13, ST-F14)

| story | file | what |
|---|---|---|
| ST-F13 | **`app/lib/pageText.ts`** (new) | `fetchPageText(citation)`, `usableSourceUrl`, `withPageAnchor` |
| ST-F13 | **`app/lib/pageText.test.mjs`** (new) | 15 tests against a recording stub client |
| ST-F14 | `app/components/Citation.tsx` | `WholePage`, below the snippet, collapsed by default |
| ST-F14 | `app/lib/citations.ts` | `PAGE_TEXT_COPY` — the honesty line and the link copy |
| ST-F14 | **`app/components/citationUi.test.mjs`** (new) | 16 structural tests |

Route B, as the owner chose it, **plus the link the owner added on 10 Aug**: two
anon-key queries (`chunk_id` → `(document_id, page_number)`, then every sibling
chunk ordered by `chunk_index`), the cited block marked in place with
`accentSurface`/`accentBorder`, and a link to `documents.source_url` — **only when
it is a real `http(s)` URL**, because owner-supplied rows carry a `local:///`
pseudo-URL and a link that goes nowhere is worse than none.

**No page image was built.** Route A was priced and declined; `pageText.ts`'s header
carries the pricing so the next person to ask does not re-derive it.

Three things it deliberately does *not* do:

- It never throws into a render path. Every failure — no `chunk_id`, a query error,
  an empty page, an unconfigured client, a client that throws — resolves to `null`.
- It never renders an error card or a retry. A technician on a roof cannot act on
  "the sibling chunk query failed", so the fallback is one plain sentence.
- It never demotes the snippet. `FROM THE PAGE` stays exactly where it was; the
  page sits below it, collapsed, because the snippet is the passage the claim
  actually rests on.

**The honesty line is not optional and not collapsible:** *"This is the extracted
text of the page, not a picture of it. Figures, wiring diagrams and tables may not
survive extraction…"*. Without it a technician who expands a page, sees no wiring
diagram, and concludes we do not hold one has been misled by omission — the same
class of defect as a citation that overstates itself. The link copy says it leaves
the app, says it opens the whole document, and does **not** promise `#page=N` will
land.

### F5 — lighter, and less (ST-F17, ST-F19)

`app/theme/tokens.ts` is the only file whose colours changed. §3 and §4 have the
numbers.

---

## 3. F5 — the palette, with every ratio that moved

### What changed, and the one-line reason it is the shape it is

The shipped ladder steps by a consistent **~1.19 in relative luminance**
(ink → steel900 → `#1D3450` → `#24405E`). So "one step lighter" is exactly "every
surface role takes the next rung", and most of the new values are values that were
already in the file, one role further up.

| role | before | after | note |
|---|---|---|---|
| `background` | `palette.ink` `#0C1826` | `palette.steel900` `#16283D` | the owner's decision, literally |
| `surface` | `palette.steel900` `#16283D` | `#1D3450` | the old `surfaceRaised` |
| `surfaceRaised` | `#1D3450` | `#233F62` | derived, one rung on |
| `border` | `#24405E` | `#2A4B6F` | one rung on, or a hairline on the new `surfaceRaised` would be invisible |
| `backgroundSunken` | `#050B12` | `palette.ink` | owner's decision |
| `backgroundRail` | `#0A1421` | `palette.ink` | owner's decision |
| `textSecondary` | `palette.steel400` `#7D93AB` | `#9DAEC0` (`steelText`) | derived: Steel400's hue 211° and sat 0.215 held, lightness 0.58 → 0.669 |
| `refusalText` / `statusOffline` | `#D1746D` | `#DE9B96` (`alertRedText`) | derived: alertRed's hue 4° and sat 0.52 held, lightness 0.62 → 0.72 |

**`palette` is untouched** — it is the brand pack verbatim. **`accent` is still
`palette.cyanRead`** and still carries text at 8.40:1 on the new background;
`brand/README.txt:31` forbids recolouring it and Option 2 was rejected to keep it.
`interactiveFill`, `pressed`, `textPrimary`, `textOnAccent`, `textOnInteractive`,
`borderStrong`, `refusal`, `refusalSurface`, `refusalBorder`, `scrim` are unchanged.

### Why the two text colours had to move, and why that is not optional

Wave 0 found two pairings the **shipped** palette had never cleared:

```
textSecondary #7D93AB on surfaceRaised #1D3450 = 4.00:1   FAIL
refusalText   #D1746D on surfaceRaised #1D3450 = 3.88:1   FAIL
```

Both are the pressed state of a history row — a state a gloved finger holds, not a
one-frame flicker — and `refusalText` is the label E5.2 requires to be legible. The
arithmetic is unforgiving: on the new `surfaceRaised` a foreground needs relative
luminance ≥ 0.36 to clear 4.5:1, and no saturated red reaches that (pure `#FF0000`
is 0.21). **A red that clears the floor on that surface is necessarily paler than
`#D1746D`.** That is the honest cost of the lift, and it is stated rather than
hidden. Both were derived at a **4.7** floor rather than 4.5, so the safety label
keeps a margin instead of sitting on the line.

### Every text pairing, before → after (ST-F17 AC 7)

Thirty rows, from `node tests/run-all.mjs --run=C`. **Every ratio that decreased is
listed**, because "still green" is not the same as "no worse".

| pairing | before | after | Δ |
|---|---|---|---|
| textSecondary → surfaceRaised [pressed] | **4.00 FAIL** | **4.72 ok** | +0.72 |
| refusalText → surfaceRaised [pressed] | **3.88 FAIL** | **4.71 ok** | +0.83 |
| refusalText → refusalSurface | 5.29 | 7.60 | +2.31 |
| statusOffline → refusalSurface | 5.29 | 7.60 | +2.31 |
| textSecondary → backgroundRail | 5.84 | 7.88 | +2.04 |
| textSecondary → accentSurface over backgroundRail | 4.84 | 6.49 | +1.65 |
| refusalText → background | 5.48 | 6.57 | +1.09 |
| refusalText → surface | 4.58 | 5.57 | +0.99 |
| textSecondary → background | 5.65 | 6.58 | +0.93 |
| textSecondary → surface | 4.72 | 5.57 | +0.85 |
| refusalText → accentSurface over background | 4.52 | 5.28 | +0.76 |
| textSecondary → accentSurface over background | 4.66 | 5.28 | +0.62 |
| textOnInteractive → interactiveFill (×2) | 6.91 | 6.91 | 0 |
| textOnInteractive → pressed (×2) | 9.47 | 9.47 | 0 |
| textPrimary → refusalSurface | 15.63 | 15.63 | 0 |
| accent → backgroundRail | 10.39 | 10.05 | **−0.34** |
| accent → accentSurface over backgroundRail | 8.62 | 8.28 | **−0.34** |
| accent → accentSurface over surface | 6.74 | 5.70 | **−1.04** |
| accent → surfaceRaised | 7.11 | 6.02 | **−1.09** |
| accent → surface | 8.40 | 7.11 | **−1.29** |
| accent → accentSurface over background | 8.28 | 6.74 | **−1.54** |
| accent → background | 10.05 | 8.40 | **−1.65** |
| textOnInteractive → border [disabled] | 10.66 | 9.00 | **−1.66** |
| textPrimary → backgroundSunken | 17.85 | 16.16 | **−1.69** |
| textPrimary → surfaceRaised | 11.44 | 9.69 | **−1.75** |
| textPrimary → surface | 13.51 | 11.44 | **−2.07** |
| textPrimary → refusalSurface (dup row) | 15.63 | 15.63 | 0 |
| textPrimary → accentSurface over background | 13.33 | 10.84 | **−2.49** |
| textPrimary → background | 16.16 | 13.51 | **−2.65** |

**Thirteen pairings decreased.** Every one of them is a very high-contrast pairing
that stays very high — the smallest post-change value in that column is **5.70**,
and the floor is 4.5. The two tightest rows in the whole matrix are now the two
that used to fail, at 4.71 and 4.72. **Zero failures, 30 of 30.**

Non-text pairings (measured, not scored — the Wave 0 open question stands): the
notable moves are `borderStrong → background` 5.65 → 4.72, `borderStrong → surface`
4.72 → 4.00 and `borderStrong → accentSurface over background` 4.66 → 3.79, i.e.
the secondary-button outline is a little softer against a lighter page. `scrim →
background` went 1.00 → 1.13, which is a real improvement: the modal scrim is Ink
and now actually darkens the screen behind a sheet instead of matching it.

**`refusalSurface` deliberately did not move.** Lifting it a rung tested at 2.89:1
for `refusal` on it and 1.83:1 for `refusalBorder`, down from 3.42 and 2.17 — i.e.
it would have softened the refusal card's own identity to keep a surface ladder
tidy. The card now reads a shade deeper than the page rather than a shade above it,
and `refusalText` on it improved to 7.60.

**ST-F17 AC 9 — the lockup.** `App.tsx:61` still loads
`lockup-horizontal-notag-dark.png`, and it is still the right asset: the background
is `#16283D`, which is dark. The shipped light lockup would be wrong here. Marked
for the human pass rather than claimed as verified on a device.

---

## 4. F5 — the density before/after

**Scope: the unit-entry screen only** (`app/screens/UnitGate.tsx`), per the owner's
10 Aug decision. The chat empty state, the persistent chrome and the answer
rendering were **not** restyled for density even though scene (b) measures denser
— a reduction the owner did not ask for is unrequested change. §11 records what I
would otherwise have proposed.

All figures from `npm run density`. **Rendered-in-branch, not
visible-without-scrolling** — the tool says so on every run and that half is
ST-F20 AC 7, human-only. I have not judged it and do not claim it.

| scene | D1 controls | D2 text blocks | D3 words | D4 containers |
|---|---|---|---|---|
| (a) UnitGate · guest · no unit · **t=0** — before | 9 | 14 | 108 | 9 |
| (a) UnitGate · guest · no unit · **t=0** — after | **9** | **12** | **93** | **8** |
| | 0% | **−14.3%** | **−13.9%** | **−11.1%** |
| (a) same at **t=6s** — before | 9 | 13 | 108 | 9 |
| (a) same at **t=6s** — after | **9** | **11** | **93** | **8** |
| | 0% | **−15.4%** | **−13.9%** | **−11.1%** |
| (b) ChatScreen + EmptyAsk — before | 13 | 17 | 89 | 17 |
| (b) ChatScreen + EmptyAsk — after | 13 | 17 | 89 | 17 |
| | **unchanged, by design** | | | |

The `UnitGate` fragment alone: **D1 3 → 3, D2 7 → 5 (−29%), D3 52 → 37 (−29%),
D4 2 → 1 (−50%).**

**Scene (b) being byte-identical is the evidence that the owner's narrowing was
respected.** It is not an omission.

### The reductions actually taken, one line of reasoning each (ST-F19 AC 5)

| # | change | why |
|---|---|---|
| 1 | the two door **cards** become two **rows of one card** | the owner's complaint was "over-complicated", and the measurable form of that is competing blocks. The gate goes from four to three before the technician has done anything. **Both routes survive** — this is a merge, not a deletion |
| 2 | the door **hints** fold into the labels | *"Fastest when the plate is readable"* was advice about a choice the row order already makes. *"Works offline"* is the one fact that changes which door a technician with no signal picks, so it stayed in the label. The camera-denied case is not lost: `PermissionDenied` routes straight to manual entry and says so at the moment it is true |
| 3 | the sub-paragraph loses one clause | *"…so I need to know the machine before the symptom"* → *"…so I need the machine first."* The citation promise — the reason the gate exists — is untouched |
| — | the rows use `ScalePressable` rather than a pressed fill | a press felt as scale and haptic rather than drawn as a background is what keeps each row from being a block of its own. Existing pattern: the urgent toggle below them and the lockup in `App.tsx` |

**Why the number is not larger, plainly.** `GUEST_DISCLOSURE` is **56 of the 93
words** left on that screen — 60% — and it is fenced by ST-F18 AC 5, ST-A06 AC 6,
`accountCopy.test.mjs` and brief hard constraint 1. Shortening a disclosure to make
a UI story pass is exactly what no stage may do. The chrome (prototype banner, tab
bar, lockup) is another 3 controls and 4 containers and is out of scope by the
owner's narrowing. So the achievable reduction on this screen is bounded at roughly
what it achieved, and an honest small number is the right answer rather than a
manufactured large one.

Also stale, and not counted as headroom: the OWNER DECISIONS closing line describes
"an urgent-question box with its own input and button" as a competing block. It is
already collapsed behind a one-line disclosure (`urgentOpen` defaults `false`) — a
previous design pass took it. Wave 0 flagged this as task 4 and I did not
double-count it.

**Nothing on the fenced list lost a word** — asserted by `npm test`, and
`GUEST_DISCLOSURE`'s pinned count went *up* (56 → 62) because the dismiss copy was
added beside it.

---

## 5. How to verify each acceptance criterion

Brief AC 1, 4, 5 and 6 are the ones this wave answers. AC 2 and AC 3 are ST-F07 /
ST-F11 and are **not** in this run (§8).

**Brief AC 1** — *the disclosure can be cleared, and a machine test proves it still
appears before the first answer for someone who has never seen it.*

| half | how to verify | status |
|---|---|---|
| clearable | `node --test app/lib/guestNotice.test.mjs`, plus the `{onDismiss && …}` guard asserted in `accountUi.test.mjs` | green |
| **not skippable** | `AC 5: dismiss() is a no-op before an answer has been delivered` and `AC 5: no sequence of user turns alone can reach dismissed` (driven 0..5) | green |
| both surfaces, one state | `ST-F02 AC 4: neither screen holds its own dismissal state` | green |
| the wording did not soften | `accountCopy.test.mjs` unmodified and passing | green |
| the copy is not a bypass | the seven `BYPASS_PATTERNS` run over `Chrome.tsx` and `accountCopy.ts` | green |
| on device | **[H]** ST-F02 AC 9 / ST-F20 AC 1 — no X before the first answer, an X after, tapping clears it, relaunch brings it back | not claimed |

**Brief AC 4** — *a technician can see more of the cited page than the snippet
alone, by the route Stage 2 chose and priced.*

| half | how to verify | status |
|---|---|---|
| the page is fetched correctly | `node --test app/lib/pageText.test.mjs` — the two queries, the ordering, the cited-block flag | green (15 tests) |
| it never breaks a render | the same file: no `chunk_id`, query error, empty page, throwing client — all `null` | green |
| the anon key only | a grep in the same file; only `chunks` and `documents` are read, both anon-readable | green |
| the honesty line and the link | `node --test app/components/citationUi.test.mjs` | green (16 tests) |
| against the live corpus | **BLOCKED on env** — this worktree has no `.env`. Needs one live tap on a real citation | not claimed |
| on device | **[H]** ST-F14 AC 10 | not claimed |

**Brief AC 5** — *the palette is lighter with every contrast check still green, and
the density reduction is stated as a measurable before/after.*

| half | how to verify | status |
|---|---|---|
| lighter | `git diff main -- app/theme/tokens.ts`; §3's table | done |
| every contrast check green | `node tests/run-all.mjs --run=C` → **E6.7 body text PASS**, **E5.2 refusal text PASS (worst 4.71:1)**. Also `node --test tests/lib/contrastMatrix.test.mjs` | **green — was 2 FAIL** |
| the checks were not weakened | the pinned-failures test was replaced by `every pairing the app draws clears the floor` plus a named test holding the two fixed pairings **above 4.6**, not at 4.5. The mutation tests (white background, white surface, illegible textSecondary/refusalText/accent) all still go red | green |
| no hex escaped the token module | E6.8 PASS; `accountUi.test.mjs` and `citationUi.test.mjs` both grep for hex | green |
| density before/after | `npm run density`; §4's table; pinned by `ST-F19: the unit-entry reduction holds` | green |
| on device, in sunlight | **[H]** ST-F17 AC 10, ST-F19 AC 7, ST-F20 AC 6 | not claimed |

**Brief AC 6** — see §6.

---

## 6. Gate status

Run on `stage/frontend-fixes` after rebasing onto `main` `2b30f29`, worktree clean.

| gate | command | before (baseline on `main`) | after | verdict |
|---|---|---|---|---|
| tests | `npm test` | 542 pass · 0 fail | **603 pass · 0 fail · 0 skipped · 0 todo**, exit 0 | +61 |
| lint | `npm run lint` | 0 errors · 0 warnings | **0 errors · 0 warnings**, exit 0 | unchanged |
| typecheck | `npm run build` | clean | **clean**, exit 0 | unchanged |
| secrets | `npm run verify:secrets` | clean | **clean** | unchanged |
| Stage-5 suites | `node tests/run-all.mjs --run=C` | 16 PASS · 4 FAIL · 3 BLOCKED · 11 HUMAN-ONLY | **18 PASS · 2 FAIL · 3 BLOCKED · 11 HUMAN-ONLY** | **+2 PASS, −2 FAIL** |
| web bundle | `npx expo export --platform web` | — | exports clean, 1.55 MB | see below |

**+61 tests:** 19 (`guestNotice`) + 15 (`pageText`) + 16 (`citationUi`) + 7
(`accountUi`, ST-F02/F03) + 1 (contrast matrix, net: one pinned-failure test
replaced by two) + 3 (density: the chained-guard reader, the ST-F19 reduction, the
reachability check). **No test was weakened, skipped, deleted or loosened, and none
is `.only`.**

**The two remaining Stage-5 FAILs are the two Wave 0 diagnosed as reader defects in
the E6 suite and routed to Test (its task 3).** Neither is mine and neither moved:

- `E6.4 the citation chip announces its document and page` — the check scans
  `['Pressable','TouchableOpacity']` and the chip is a `ScalePressable`. The
  criterion itself holds (`Citation.tsx:44` carries the label and `Tactile.tsx`
  forwards it).
- `E6.7 every interactive element carries an accessibility label` — 1 of **36**
  (was 1 of 35). The one offender is still `Tactile.tsx:52`, `ScalePressable`'s own
  internal `<Pressable {...rest}>`. My changes added one labelled control to the
  scan's view and introduced no new offender.

**The two contrast FAILs are now PASS, and they pass because the colours changed.**
No check was relaxed, re-scoped or skipped to get there.

### What I actually verified, and what I did not

- **Verified by running:** every unit test, the lint and typecheck gates, the
  Stage-5 suites that do not need credentials, the contrast matrix over the real
  `tokens.ts`, the density count over the real screens, and a **web bundle export**
  — which proves the whole tree resolves and compiles through Metro, something
  `tsc --noEmit` does not check.
- **Not verified, and not claimed:** *anything visual.* This repo has **no
  component or E2E test runner** — no React Testing Library, no
  react-test-renderer, no Playwright — so nothing here renders a tree. I did not
  screenshot, and I have no browser available in this environment. I could not run
  the app: the worktree has no `.env`, so `npm run app` cannot sync env, the
  Supabase client is unconfigured, and camera and native auth do not work on web
  regardless. **The palette is verified as ratios and the density as counts. How it
  looks on a roof through safety glasses is ST-F17 AC 10 and ST-F20, and it is
  still open.**
- **Not run:** `npm run verify:stage5` and `npm run verify:sessions` need
  `--env-file=.env`. `node tests/run-all.mjs --run=C` was run without it, so the
  Supabase-dependent checks report BLOCKED rather than FAIL — the same condition
  Wave 0 recorded.

---

## 7. Accessibility and responsiveness — what was held

Research captured no separate bar for this run, so the floor named in my brief
applies, plus the bars the repo already enforces. Which applied:

| bar | how it was held |
|---|---|
| **Keyboard/assistive reachability and operability** | every control added is a real `Pressable`/`ScalePressable` with `accessibilityRole` — `button` for the dismiss and the page toggle, `link` for the manufacturer's PDF, and `accessibilityState={{ expanded }}` on the page toggle so a screen reader knows it is a disclosure |
| **Labelled controls** | every new control carries an `accessibilityLabel`; asserted by `citationUi.test.mjs` and by `accountUi.test.mjs`'s existing app-wide check. The cited page block carries a label that announces *why* it is marked, so the marking is not colour-only |
| **48dp touch floor** | `MIN_TOUCH` as **real layout**, not `hitSlop`, on the dismiss control (`minHeight`+`minWidth`), the page toggle and the link — `react-native-web` does not implement `hitSlop`, so a slop-only target would be a floor met only on the platforms nobody audits. The gate's door rows are `MIN_TOUCH + 8` |
| **Focus visible** | unchanged from the shipped pattern; nothing here removes a pressed or focus state. The gate's door rows swapped a background flash for `ScalePressable`'s scale + haptic, which is the app's existing feedback pattern for in-card rows |
| **Contrast** | the whole of §3. Every pairing the app draws now clears 4.5:1, including two that did not before |
| **Breakpoints already in the codebase** | the tablet split (`useLayout`, `NavRail`, `SourcePanel`) is untouched, and ST-F14 lands on both surfaces automatically because both render `SourceBody` — asserted |
| **200% font scale** | the page expansion is height-capped at the same 260dp as the existing snippet scroll, so a twelve-block page cannot push "Back to the answer" off a 667dp screen. Whether text clips at 200% on a physical device is **[H]** and unchanged |

Not held, and said rather than implied: **nothing was rendered.** Reachability and
focus visibility are asserted from source and from the tokens, not observed.

---

## 8. CONTRACT MISMATCH / BLOCKED ON BACKEND

**No CONTRACT MISMATCH.** Everything this wave consumed matched
`03-backend-fixes.md` §2 exactly: `MessageKind` and `DiagnoseReply['kind']` already
carry `'conversational'`, the citation payload is unchanged, and the `chunks` /
`documents` schema is as §1d of the stories described it. No adapter was needed and
none was written. No backend file is touched on this branch.

**Filed against Backend — not blockers for this wave:**

| # | item | why it is Backend's |
|---|---|---|
| 1 | **`sql/015` is still not applied.** Already open in `03-backend-fixes.md` §3 and owned by the owner, not by an agent. Until it is applied, a signed-in technician's conversational turn fails to insert. **The guest path is unaffected**, and nothing in this wave works around it | owner action |
| 2 | **ST-F07** — the `kind === 'conversational'` branch in `Message.tsx`, placed before the `citations.length === 0` check. **Not built here; not in this run's assignment.** Until it lands, a conversational reply falls through to `UncitedDefect`, which is the correct fail-safe and is exactly what the backend artifact says to preserve behind the new branch | Frontend, next wave |
| 3 | **ST-F11** — the type-ahead UI in `CaptureScreen.tsx` against the `requestSuggestUnits` client that already exists. **Not built here; not in this run's assignment** | Frontend, next wave |
| 4 | `tests/lib/densityScenes.mjs`'s `CoverageLine verdicts` fence points at ChatScreen by **line number** (`lines: [787, 797, 806]`). I had to move it once already when the file shifted. A brittle pointer that silently mis-resolves is a hole in a fence; it should key on the copy, not the line. Wave 0's task 7 (fencing `CONVERSATIONAL_BODIES`) is the same file | Test |

**BLOCKED ON BACKEND: nothing.** Every story in this assignment is complete.

---

## 9. Instrument defects found and fixed, reported not absorbed

Two Wave 0 instruments were wrong in ways my changes exposed. Both are fixed with a
standing test, and both changed a *published number*, so they are called out rather
than folded into the diff.

**1. The density reader mis-evaluated a chained guard.** `{a && b && (<jsx>)}`
resolved only `a`, kept the block whatever `b` was, and handed `b && (<jsx>)` to the
word counter — so the condition's own text was counted as visible copy. Both screens
now gate the disclosure on two conditions, which is how it surfaced. Consequences
for the committed ST-F18 baseline, all in the direction of it having been *too
high*:

- every scene loses one phantom word — the word `capture`, from `App.tsx`'s
  `{!isTablet && !capture && (<TabBar/>)}`;
- scene (b) loses the entire unanswered-retry card (`{!busy && unanswered && !error
  && …}`), which is **not rendered** in that state: **D1 14 → 13, D2 20 → 17, D3
  121 → 89, D4 19 → 17**.

No screen changed to produce that delta; the instrument did. The original ST-F18
figures are preserved in `tests/fixtures/density-baseline.json` under `supersedes`
with the reason, and the corrected pre-reduction figures are under
`supersedes.correctedBaseline` — which is the "before" column §4's percentages are
computed against. The fix is pinned by `a chained guard evaluates both conditions,
and counts neither as copy`, including that an undeclared second condition still
throws rather than being guessed.

**2. The contrast matrix's `file:line` pointers went stale.** Twenty-eight of them
moved as `Chrome.tsx`, `ChatScreen.tsx` and `Citation.tsx` grew, and Wave 0's own
guard (`every pairing cites a file:line that really draws that role`, plus the stale
`NON_TEXT_FILLS` check) caught every one. All were re-pointed at the same sites; no
pairing was removed, relaxed or exempted. One `also:` reference to
`UnitGate.tsx:237` was dropped because ST-F19 deleted the door hint it named — the
pairing it belonged to is still measured at its primary site.

A note for whoever maintains these: **the matrix's line pointers are a maintenance
tax on every UI change.** They are also the reason the table can be audited against
the screens, which is worth paying for. Anchoring them on the style-rule name rather
than the line would keep the audit and drop the tax; filed as a suggestion, not
done here, because it is Test's file and this run had no mandate to redesign it.

---

## 10. OPEN QUESTIONs, with the default taken

**OQ-FE1 — where should the whole-page copy live?** ST-F14 AC 4 says "a constants
module beside the other citation copy", and there is no citation copy module —
`Citation.tsx` holds its strings inline. *Default taken: `PAGE_TEXT_COPY` in
`app/lib/citations.ts`*, which is the citation rules module, is already pure and
RN-free, and already has a test file. A separate `citationCopy.ts` would be a third
place to look for two dozen words. If a later run hoists the rest of the sheet's
copy out of the JSX, this is the file it should go to.

**OQ-FE2 — should the whole-page fetch run on mount, or on tap?** *Default taken:
on mount.* The control then only ever appears when there is a page behind it, which
is what makes "never renders an empty expansion" (AC 5) structural rather than a
promise. The cost is two cheap indexed reads per opened citation sheet, and a
visible one-line loading state while they run. On tap would save those reads and
buy an expansion that can turn out to be empty; that trade goes the wrong way for a
verification surface.

**OQ-FE3 — `border` moved a rung, which the owner's decision did not name.** *Taken
as a consequence, not a new decision:* with `surfaceRaised` at `#233F62` the old
`border` `#24405E` is the same luminance, so every hairline on a pressed row would
have vanished. The ratios are in §3. Trivially revertible in one line if the owner
disagrees.

**OQ-FE4 — the refusal label is paler than it was.** Not a choice so much as
arithmetic (§3), but it is a visible change to the app's most safety-critical
colour and the owner should see it on a device before it is settled. If it reads as
washed out, the lever is `surfaceRaised`: pulling it back toward `#1D3450` lets
`refusalText` go back toward `#D1746D` — but it cannot go all the way back while
the two must clear 4.5:1, which they must.

---

## 11. Recommendations I did not act on

Left alone deliberately, because the owner did not ask for them and reducing a
scene nobody complained about is unrequested change:

- **The chat empty state is the denser of the two surfaces** even after this round
  (scene (b): 17 text blocks and 17 containers against the gate's 12 and 8, in
  fewer words). `EmptyAsk` renders four starters plus a `Common on this unit`
  heading, and the unit is stated twice — once in `SessionHeader` and again in the
  `EmptyAsk` unit card. Those are the reductions stories §ST-F19 AC 5 listed and
  they are still available whenever the owner wants them.
- **The prototype banner and tab bar** contribute 4 controls and 5 containers to
  every scene. Out of scope by the owner's narrowing, and the banner is a
  deliberate honesty device.
- **Adopting WCAG 1.4.11 (3:1 non-text)** would turn a dozen shipped hairlines
  into failures against a bar nobody set. Wave 0's open question, still the owner's
  to answer; the ratios print on every run either way. Note that the lift moved
  three `borderStrong` pairings down (§3), so if 1.4.11 is ever adopted, that is
  where it will bite first.
