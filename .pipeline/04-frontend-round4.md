# 04 — Frontend · Device feedback, round 4

Reads `.pipeline/00-brief-round4.md`, `.pipeline/02-user-stories-round4.md`,
`.pipeline/04-frontend-fixes.md`, `app/AGENTS.md`. Branch `stage/frontend-round4`.

Stories owned: **ST-R02**, **ST-R06**, **ST-R16**. All three landed. No backend
file was touched — `lib/**`, `sql/**` and `scripts/serve.mjs` are byte-unchanged
on this branch.

---

## 0. Precondition — read this before the rest

**Stage 3 for round 4 has not merged.** There is no `.pipeline/03-backend-round4.md`,
and the backend the stories depend on is not in the tree:

| what ST-R06 / ST-R16 consume | state in this worktree |
|---|---|
| `meta.shape: 'reference'` on `/diagnose` (ST-R05) | **absent** — `RESPONSE_SCHEMA` has no `reference` kind |
| `POST /unit-suggestions` (ST-R15 AC 7) | **absent** — `serve.mjs:204` routes four paths and this is not one |
| `sql/018 document_suggestions` (ST-R15 AC 1) | **absent** — `sql/` stops at `017` |

The launching agent's instruction was explicit that Backend runs in parallel and
that a wrong or missing contract is raised in this artifact rather than fixed in
`lib/`. That is what I did: both stories are implemented **against the contract
exactly as `02-user-stories-round4.md` documents it**, and both degrade to a
designed state — not an error, not a stub, not the old behaviour — when the
server has not landed it. Nothing acceptance-critical is stubbed.

The consequence, stated plainly rather than buried: **on the tree as it stands
today, ST-R16's screen shows the empty state on every unit** (the route 404s, and
a 404 is `[]` by construction), and **ST-R06's branch never fires** (no reply
carries `meta.shape`, and an absent shape renders exactly as today). Both light
up the moment Backend merges, with no further frontend change. §5 lists what
Stage 5 has to route.

---

## 1. ST-R02 — a conventional dismiss glyph, ≥48dp, rule untouched

**Commit** `4a4607d`.

### What changed

`GuestNotice` (`app/components/Chrome.tsx`) drew the dismiss control as the
**word** "Got it", in a header that already holds a red offline glyph and an
uppercase heading — which is exactly the owner's report (N1: *"it should be
easier and maybe have an X"*). It is now an `Ionicons` `close` at 22dp inside the
same `Pressable`.

- **No new dependency.** `@expo/vector-icons` already draws every other glyph in
  the file (brief hard constraint 5). `guestNoticeUi.test.mjs` asserts it is the
  *only* glyph source the component imports from, so the mark cannot have arrived
  via a second package.
- **48dp on both platforms.** `s.guestDismiss` keeps `minHeight`/`minWidth:
  MIN_TOUCH` as real layout — `react-native-web` does not implement `hitSlop`, so
  a slop-only target would silently be 22dp on the platform this is most often
  reviewed on. `hitSlop={touchSlop(GLYPH)}` is kept for native. `GLYPH` is a named
  constant because the two uses have to agree and drift between them is invisible.
- **Label.** `accessibilityRole="button"` and `GUEST_DISCLOSURE.dismissLabel`
  ("Dismiss the not-saved notice"). A bare X with no label is unusable with
  VoiceOver, and this is the disclosure of all things.
- **Placement.** Trailing edge, with `guestLabel`'s `flex: 1` taking the slack —
  asserted as an ordering over the header (glyph → heading → dismiss) plus the
  flex, so "does not read as part of the cluster" is structural.
- **Colour.** `color.textPrimary`, and deliberately **not** a `refusal*` role: red
  here would read as "this is the dangerous thing" rather than "this closes it".
  It carries its own row in the semantic contrast matrix on `refusalSurface`.
- `s.guestDismissText` is deleted rather than left dangling.

### What did **not** change, which is the load-bearing half

- `app/lib/guestNotice.ts` is **byte-unchanged** (AC 6). `Chrome.tsx` never
  references `canDismiss`, `guestNotice` or `answersSeen` — asserted — so the rule
  "the control does not exist until an answer has been delivered" still lives in
  exactly one place and is still reached only through the caller's callback.
- The guard is still `{onDismiss && …}`: **absent, not disabled**. No `disabled=`,
  no `opacity` anywhere in the component.
- `app/screens/accountUi.test.mjs` passes **unmodified** — all 45 of its
  assertions, including ST-F02 AC 1/2/3 and ST-A06 AC 6. That discharges brief
  AC 1's "a test still proves it is absent before the first answer" in the
  strongest form available: an existing test that continues to pass.
- `GUEST_DISCLOSURE` is byte-for-byte unchanged (AC 9), `dismiss: 'Got it'`
  included. It is now unused as visible copy and is kept deliberately — the
  constant is frozen, and `fencedInventory` counts every literal in the
  declaration, so deleting it would also have shortened fenced copy by two words.
- All seven `BYPASS_PATTERNS` from `tests/suites/e5-safety.mjs` run over
  `Chrome.tsx` and `accountCopy.ts` and match nothing (AC 8).

### How to verify

```
node --test app/components/guestNoticeUi.test.mjs   # 13 tests, ST-R02 AC 1-9
node --test app/screens/accountUi.test.mjs          # 45 tests, unmodified, green
```

AC 10 is **[H] and stays [H]**: no X before the first answer, an X after it, one
gloved tap clears it, force-quit brings it back. See §6 — I could not render this.

---

## 2. ST-R06 — a reference answer renders as data, not a checklist

**Commit** `202f6ca`.

### The parser, and why it refuses rather than launders

`app/lib/referenceFormat.ts` (new) turns ST-R05's `spec — value (condition)`
body into rows. It is a separate module from `answerFormat.ts` on purpose:
`parseAnswer` recovers *procedure*, this recovers *data*, and a parser that could
emit a `ParsedStep` from a reference body would be a place for an imperative to
grow back.

The decision worth reviewing is that **a body containing a numbered line or a
`Reading:` marker yields no items at all**, and `Message.tsx` then falls back to
the ordinary answer turn — which draws it as the ordered checklist it evidently
is, under `CHECK IN THIS ORDER`, with the advise-only footer attached.

The alternative (strip the numbers, draw the lines as spec rows) would take a
procedure and present it as inert data. That is ST-R06's own user story pointed
the other way — *"these are not steps and reading them as steps is how someone
does them in order"* — and it is worse, because a procedure disguised as data
loses the qualification that makes a procedure safe to read. So the parser
declines. It also drops any row with an empty value, mirroring ST-R05 AC 3.

### The render

`ReferenceAnswer` in `Message.tsx`:

- Overline `FROM THE MANUAL`; **`CHECK IN THIS ORDER` does not appear in the
  branch**, and it still appears in `AnswerTurn`, so this was not bought by
  deleting it (AC 1).
- **No ordinal exists in the branch at all** — no `{i + 1}`, no `stepNumber`, no
  `Reading:` (AC 2).
- Rows are **stacked, not columned**: `referenceSpec` (caption/secondary) above
  `referenceValue` (bodyStrong/primary), both full width. A two-column row is
  exactly where AC 7's 200%-font-scale requirement breaks, and a spec like
  "Service clearance, condenser coil side" is long before any scaling. The
  absence of `flexDirection: 'row'` on `referenceRow` is asserted.
- **Per-row citation chips** (AC 3), tappable, wired to the same
  `onCitationPress` → `CitationSheet` every other turn uses. ST-R05 AC 4 builds
  citations from the surviving items through the same mapping steps use, so item
  *i* ↔ citation *i*; this shape has the positional anchor `AnswerTurn` never had.
  **But only when the counts agree exactly** (`citations.length === items.length
  && broken.length === 0`); otherwise the chips fall back to one row beneath the
  values. A citation attached to the wrong claim is worse than an uncited one
  (`CLAUDE.md`), so the mismatch case declines to pair rather than pairing
  approximately. Broken chips are shown alongside, never dropped.
- **The hazard-adjacent note is a pointer, not a withholding** (AC 5). Steel
  surface, `information-circle-outline` in `textSecondary`, no `color.refusal*`
  anywhere in the branch or in any of its nine style rules, no `alert` role. The
  reasoning is precise: a technician who reads it as a refusal will assume the
  values above were withheld, when they were given. The advise-only footer is
  still attached.

### The citation net, asserted as an ordering (AC 4)

```
kind === 'conversational'      -> ConversationalTurn      (ST-F07, unchanged)
citations.length === 0         -> UncitedDefect
usable.length === 0            -> UncitedDefect (all-broken, E6.4 strict)
shape === 'reference'          -> ReferenceAnswer   <- BELOW both nets
                               -> AnswerTurn        (fallback, always reachable)
```

`meta.shape` rides on `kind: 'answer'` (OQ-R2) precisely so an uncited reference
answer is caught by the nets above it. `referenceUi.test.mjs` pins the ordering
with a helper that fails when a landmark is **missing**, not just when it is
moved — the vacuous-green lesson `messageUi.test.mjs` already records.

The other end of the same guarantee is at the wire boundary: `diagnose.ts`
admits `shape === 'reference'` and drops every other value, so an unrecognised
shape cannot arrive half-supported.

### Plumbing, and what is deliberately not persisted

`AnswerShape` is declared in `supabase.ts` beside `MessageKind`. `DiagnoseReply`
gains `meta?: { shape?: AnswerShape }`; `Message` gains `shape?: AnswerShape`;
`store.ts` passes `result.meta?.shape` through without inspecting it (the store
has no opinion about rendering and must not grow one — same rule ST-F07 set for
`conversational`); `ChatScreen` passes `m.shape` to `MessageView`.

**No column, no migration.** `appendMessage`'s insert still names exactly
`{session_id, kind, body, seq}` — asserted. Per OQ-R2 the cost is that a session
reopened from history redraws a reference answer as a plain cited answer. That is
accepted: it is one screen, not a lost citation, and the alternative is a
`messages.kind` CHECK migration while `sql/015` is still unapplied, which would
fail the insert for every signed-in technician.

### How to verify

```
node --test app/lib/referenceFormat.test.mjs   # 13 tests, incl. the refusal to launder
node --test app/components/referenceUi.test.mjs # 17 tests, incl. the branch ordering
node --test app/components/messageUi.test.mjs   # ST-F07 unchanged, green
```

AC 7 is **[H]**: a clearance answer readable at 200% font scale without the value
wrapping away from its label. The structural half (stacked rows) is asserted; the
visual half is not, and cannot be from here.

---

## 3. ST-R16 — the manual's suggestions, or nothing and why

**Commit** `b62d55c`.

### The taxonomy is deleted

`app/lib/starters.ts` was four hardcoded strings per equipment class under a
comment claiming *"Always four, always answerable"*. `BY_CLASS`,
`CLASS_PATTERNS`, `classifyEquipment` and `startersFor` are **gone**, and
`starters.test.mjs` asserts they stay gone — a dormant export is what a later
round wires back up "just for the offline case".

`app/lib/starters.test.mjs` is rewritten rather than deleted. Its one load-bearing
assertion survives in the form AC 9 requires: **no suggestion the app would
render is one `classifyHazard` refuses**, run over server payloads spanning all
four categories instead of over literals. It is paired with a guard proving the
gate still refuses known-procedural text, so it cannot pass vacuously.

### The wire contract, consumed as documented

`POST /unit-suggestions` `{documentIds}` → `{suggestions:[{text, category,
documentId, page, source_document}]}`, per ST-R15 AC 7.

- `parseSuggestionsResponse` **discards malformed rows rather than repairing
  them** — the rule `suggest.ts:11-18` already sets. Every field is checked;
  an unrecognised `category` drops the row, because ordering is per-category
  (OQ-R7) and placing an unplaceable row arbitrarily makes the offer's order a
  lie. The type is `DocumentSuggestion`, **not** `UnitSuggestion` — `suggest.ts`
  already owns that name for a different thing.
- Order is the server's, untouched. Length is capped at 4 client-side as a second
  guard so a server bug cannot re-inflate the first screen past the density
  baseline. It truncates and never reorders.
- `requestUnitSuggestions(documentIds, cancel)` in `diagnose.ts` resolves to `[]`
  for **every** failure — unconfigured, unreachable, non-200, malformed, timeout,
  abort. It never throws. An empty scope is not asked about at all.
- **A 404 and an empty answer are indistinguishable by construction**, asserted
  directly. That is ST-R15 AC 12 read strictly: until `sql/018` is applied the
  route 404s, and the screen degrades to the designed empty state, never to an
  error and never to the taxonomy.

### Three states on the screen, and the third is designed

| state | what is drawn |
|---|---|
| looking | **nothing** in the chip area. No skeleton, no placeholder (AC 4) |
| suggestions | up to 4 chips, the server's own `text`, ≥48dp, labelled |
| nothing to offer | no chips, **no heading**, and in their place the coverage statement + the invitation |

- **The heading lives inside the guard**, not above it. An empty "Common on this
  unit" is worse than an absent one, and the only way to guarantee it cannot be
  drawn alone is for it to be inside the same conditional as the list.
- **A failed lookup is that third state**, not an error card (AC 5) — the
  `requestResolveUnit`/`requestSuggestUnits` precedent. There is nothing here to
  `catch`, because the client resolves rather than throws; asserted at both ends.
- **Nothing is disabled** (AC 3). Both front doors, the change-unit control and
  the composer are asserted to sit inside guards that mention only `equipment` —
  and `ChatScreen`'s own body is asserted to contain no suggestion state at all,
  so the composer cannot be gated on it.
- **No suggestion text is composed client-side** (AC 6). The chip renders
  `{sug.text}` whole; `ChatScreen` is asserted to contain no manufacturer name
  and no symptom string.
- **The scope is never re-derived** (AC 7). The chip hands back text only; `send`
  reads `documentIds` from the screen and passes it verbatim to `answerExisting`.
- The lookup is keyed on `scopeKey` (the joined scope) rather than the array,
  which is a fresh identity every render; a stale response cannot land on a new
  unit (`live` flag + `AbortController`).

### The coverage statement — every word a database column

`coverageStatement(count, docTypes)` in `starters.ts`, pure and unit-tested:

> `For this unit I hold 6 documents — 3 Install, 2 IOM and 1 Troubleshooting Guide.`

`docTypes` are the manifest's own `DocType` strings (`documents.doc_type`),
threaded through `ConfirmedUnit.docTypes` → `App.tsx`'s `coverage.types`. Sorted
most-common-first then alphabetically, so the same unit reads the same way every
time; past three kinds the tail groups as "*n* others" and the numbers still sum
to the count (asserted).

Two honesty rules, both tested:

1. `count === 0` returns `''` and the block does not render — `CoverageLine` has
   already said "No documentation for this unit" one line above, and a second
   sentence saying zero is noise on top of a good answer.
2. The breakdown is stated **only** when `docTypes.length === count`. The
   type-ahead path (`chooseSuggestion` in `CaptureScreen`) reaches this screen
   with a family string and no document rows, so it arrives empty and the
   statement gives the count alone rather than a mix whose numbers do not add up.

The count is `coverage.docs.length` — the **same** number `CoverageLine` renders
one line above. A card stating two different counts about one unit would be worse
than one stating a slightly coarser one.

### Density baseline (AC 8) — re-measured, **unchanged**

```
| scene                                          | D1 | D2 | D3 | D4 |
| (a) UnitGate · guest · no unit · t=0           |  9 | 12 | 93 |  8 |
| (a) UnitGate · guest · no unit · t=6s          |  9 | 11 | 93 |  8 |
| (b) ChatScreen + EmptyAsk · unit chosen · t=6s | 13 | 17 | 89 | 17 |
```

Identical to `tests/fixtures/density-baseline.json` on every scene and every
dimension. **The fixture is not regenerated and was not touched.** Four chips
became up to four chips, and the chip label was an `{expression}` before and
after, so nothing the counter reads moved. State (a) is unaffected: the scene
declares `onDismiss: false`, so ST-R02's glyph was never in that count either.

`densityScenes.mjs`'s EmptyAsk fragment now **declares which of the three states
it measures** — the suggestions state with a full four chips, i.e. the heaviest.
That keeps the baseline a ceiling rather than an average: `looking` draws no chip
block at all and the empty state trades four chips for two lines. Both terms of
the chained empty-state guard are declared, because the counter resolves each and
refuses to guess either.

### How to verify

```
node --test app/lib/starters.test.mjs        # 22 tests: parser, request, statement
node --test app/screens/emptyAskUi.test.mjs  # 15 tests: the three states, AC 1-7
node tests/density-baseline.mjs              # numbers above
```

AC 10 is **[H] and is the note that started the round**: the Bosch unit, on
device — either real installation-reference chips appear and at least one returns
a cited answer, or the empty state appears and reads as an honest statement
rather than a broken screen. It cannot be checked from here, and **until Backend
merges it will be the empty state on every unit**, which is not yet a fair test of
that criterion.

---

## 4. Accessibility and responsiveness — which bar applied

Stage 1 did not run for this brief, so there is no research-captured bar. The
floor from the launching agent's instruction applied, plus what the merged rounds
already set. What holds and how it was checked:

| bar | this round |
|---|---|
| interactive elements keyboard-reachable and operable | every new control is a `Pressable`/`ScalePressable` with `accessibilityRole="button"` — the same primitives the existing screens use. **Not rendered, so not proven** beyond the role and the props |
| form controls labelled | no new form control this round. Every new control carries an `accessibilityLabel` — the dismiss glyph names what it dismisses, each chip names its question |
| focus visible | unchanged. Every new control uses the existing `pressed` style convention; no focus ring was added or removed |
| ≥48dp targets | dismiss glyph and suggestion chips both asserted at `minHeight`/`minWidth: MIN_TOUCH` as real layout, `touchSlop` on top for native |
| layout at the codebase's breakpoints | `useLayout()`'s phone/tablet split is untouched. The reference sheet and the empty-state block are single-column and stack, so neither introduces a width assumption |
| 200% font scale | ST-R06's rows are stacked specifically for this (AC 7). The structural half is asserted; the visual half is **[H]** |
| contrast | all text pairings measured, matrix green — §5.3 |

---

## 5. Cross-stage items

### 5.1 CONTRACT MISMATCH — owner: **Backend**

**CM-1 · `meta.shape: 'reference'` is not on the wire.** ST-R05's response shape
does not exist in `lib/diagnose.mjs`. ST-R06 is built against it and is inert
until it lands: `diagnose.ts` reads `json.meta?.shape`, admits only
`'reference'`, and an absent `meta` renders exactly as today. **No adapter is
needed** — the field is additive. Nothing to route beyond "land ST-R05".

**CM-2 · the reference body's separator is unconfirmed — ADAPTER, isolated.**
ST-R05 AC 5 documents the body as `spec — value (condition)` lines. Backend had
not landed when this was written, so `SEPARATORS` in `referenceFormat.ts` is a
ladder: the documented em dash first, then an en dash and a spaced hyphen, and
the first rung that yields a row wins. It is the single divergence point, it is
commented as `ADAPTER` in the module header, and it is additive tolerance rather
than a second contract. **If Backend confirms the em dash, delete the lower two
rungs and change nothing else.** If Backend chose a different shape entirely
(e.g. a JSON `specs` array on the reply rather than a formatted body), that is a
larger divergence than the ladder covers and should come back to Frontend — the
parser fails closed, so the symptom will be "reference answers render as ordinary
cited answers", not a broken screen.

**CM-3 · `POST /unit-suggestions` does not exist.** ST-R15 AC 7. The client is
written to the documented request and response and degrades to `[]` on the 404 —
which is ST-R15 AC 12's own requirement, so this is a *documented* interim state
rather than a defect. Two knock-ons Backend should be aware of:

- `serve.mjs:205`'s 404 message must name the new route (ST-R15 AC 7 says so);
  the existing test `the 404 message names /suggest-units, so the route list
  stays discoverable` will need the new name.
- The route must sit under the same bearer gate as the other POSTs. `serve-auth.test.mjs`
  has a pattern for asserting that per route.

**CM-4 · the empty state's invitation sentence is Frontend-authored and should
not stay that way.** §2.3 specifies it as "the same sentence the capability
answer uses", i.e. ST-R08/ST-R17's server constant, so that "what can you help
with?" and this screen cannot drift into two different promises. That constant
does not exist yet, so `NOTHING_TO_SUGGEST_INVITATION` lives in
`app/lib/starters.ts` with a comment saying exactly this. **When ST-R17 lands,
delete the constant and take the sentence off the wire.** It is worded to claim
no capability at all — only that a claim is cited or withheld, which the system
guarantees by construction — so it is not a hardcoded coverage claim in the
meantime. Asserted.

### 5.2 Cross-stage findings — owner: **Backend** (not mine to fix)

**F-1 · a live gap in the live-electrical ACTION pattern.** Measured on this
branch against `lib/safety.mjs` as merged:

```
classifyHazard('how do I land the conductors')             -> live_electrical
classifyHazard('How do I land the line-voltage conductors?') -> null
```

`\bland(ing)? .{0,16}(wire|conductor)s?\b` allows 16 characters between the verb
and the noun; `"the line-voltage "` is 17. The second phrasing is the one a
technician is more likely to type on an installation job, which is the corpus
this whole round is about. Not this story's to fix, and widening the gate from a
frontend branch would be editing another stage's file. Noted in a comment in
`app/lib/starters.test.mjs` beside the phrasings that *are* asserted.

**F-2 · ST-R04's lug noun is not in yet, as expected.** `"how do I torque the
lugs to 35 in-lb"` returns `null` today. Recorded so nobody reads its absence
from my tests as a claim that the boundary holds — it is deliberately not
asserted from here.

### 5.3 The contrast matrix — pointers updated, count and margin reported

The matrix pins `file:line` for every pairing, and this round shifted lines in
`Chrome.tsx`, `Message.tsx` and `ChatScreen.tsx`. All 22 Chrome pointers, 7
Message pointers, 6 ChatScreen pointers and 1 CaptureScreen pointer were
re-verified against the current source. The CaptureScreen one (`:815` →`:824`)
was **already stale on `main`** before this branch and is fixed here.

Text pairings: **30 → 35**, all green, no new colour role introduced.

| added row | roles | already measured? |
|---|---|---|
| guest notice dismiss glyph (ST-R02) | `textPrimary` on `refusalSurface` | yes — same pairing as the disclosure body |
| reference overline / spec label | `textSecondary` on `background` | yes |
| reference value | `textPrimary` on `background` | yes |
| reference hazard note | `textSecondary` on `surface` | yes |
| nothing-to-suggest statement | `textPrimary` on `accentSurface`/`background` | yes |
| nothing-to-suggest invitation | `textSecondary` on `accentSurface`/`background` | yes |

Every one reuses a role/backdrop pair the matrix already scored, so no new
measurement was required and no margin moved. `evaluateMatrix().failures` is `[]`
and `coverageGaps` is clean over the shipped tree.

### 5.4 Fenced copy

Unchanged. `CoverageLine verdicts`'s line pointers in `densityScenes.mjs` moved
(`787,797,806` → `903,913,922`) because the file grew above them; the words are
identical (29, as committed) and the "no fenced copy has been shortened" test
passes.

---

## 6. Verification status — and what I could not do

### Gates

| command | baseline (this worktree, `main`) | after |
|---|---|---|
| `npm run lint` | 0 errors, 0 warnings | **0 errors, 0 warnings** |
| `npm run build` (`tsc --noEmit`) | clean, exit 0 | **clean, exit 0** |
| `npm test` | 638 tests, 637 pass, **1 fail** | 711 tests, **710 pass, 1 fail** |

**The one failure is pre-existing and environmental, not mine.**
`ingest/reconcile.scope.test.mjs` calls `reconcile()`, which does
`readdirSync('HVAC Data')`. That directory is gitignored and is not present in an
agent worktree, so the test throws `ENOENT` before it asserts anything. It fails
identically on `main` in this worktree, at the commit I branched from. It will
pass on the owner's checkout.

**Test count.** The task brief said the baseline was 643 passing. I measured
**637 passing / 638 total** on `main` in this worktree at `ecd97f2`. I have not
reconciled the six-test difference — it may be another environment-dependent file
or a count from a different commit. **Reported rather than explained away**;
either way the delta this branch adds is +73 tests, all passing.

No test was weakened, skipped or deleted to pass. Three existing test files
(`accountUi.test.mjs`, `messageUi.test.mjs`, `density.test.mjs`) were left
untouched and all still pass; the only test-infrastructure edits were the
`file:line` pointers in `contrastMatrix.mjs` and `densityScenes.mjs`, which are
pointers by design and which a test exists to keep honest.

### What I could **not** verify — say this out loud

**I did not see any of these screens.** This worktree has no `.env` and no
browser, and there is **no component or E2E test runner in this repo** — no React
Testing Library, no `react-test-renderer`, no jest, no Playwright. Round 4 does
not add one; that would be a test-infrastructure decision no story here has a
mandate for. Every UI criterion I claim is asserted **by reading the source**, and
every criterion that needs a rendered tree is left `[H]`:

- ST-R02 AC 10 — the gloved tap, and the notice coming back after a force-quit.
- ST-R06 AC 7 — a clearance answer at 200% font scale.
- ST-R16 AC 10 — **the Bosch unit from the owner's session.** This is the note
  that started the round.

I ran `npx expo export --platform web`, which **succeeded**: the tree bundles
(1.56 MB) and `scripts/verify-bundle.mjs --reuse` confirms no server-side key or
server-only variable name reaches the client bundle. **That is not visual
verification and must not be read as any.** It proves Metro resolves every import
and that no secret leaked. It proves nothing whatsoever about what the screens
look like or whether a technician can operate them.

(Incidental: `npm run verify:bundle` **fails in this worktree** for an environment
reason unrelated to this branch — its `spawnSync('npx.cmd', …)` produces no output
and returns non-zero after it has already deleted `app/dist`. Running the export
by hand and then the script with `--reuse` works and is what I did. Worth someone
checking on a normal checkout.)

The owner has a device session running, so these screens may get real eyes soon.
Until then, three acceptance criteria are open on human inspection and one of
them (ST-R16 AC 10) **cannot be fairly judged until Backend merges**, because the
route it depends on does not exist and the screen will honestly show the empty
state on every unit.

---

## 7. OPEN QUESTIONs raised by this round

Every one is built on its default.

**OQ-R13 — should the empty-state document count be `coverage.docs.length` or
`documentIds.length`?**
*Default (building on it): `coverage.docs.length`.* It is the same number
`CoverageLine` renders one line above, and a unit card that states two different
counts about one unit is worse than one that states a slightly coarser one. They
can differ on the type-ahead path, where `coverage` is one family string while
`documentIds` may be many. If the owner would rather the statement be precise
than consistent, the change is one expression in `EmptyAsk` — but then
`CoverageLine` should move with it, not diverge from it.

**OQ-R14 — should an unrecognised suggestion `category` drop the row or render
it last?**
*Default: drop it.* Ordering is per-category (OQ-R7), so a category this build
does not know cannot be placed, and placing it arbitrarily makes the offer's
order a lie. The cost is that a fifth category added server-side is silently
invisible to an older client until it ships. Given hard constraint 2 — a
suggestion is a coverage claim — silently showing fewer is the safer failure than
silently showing them wrong. If Backend adds a category, add it to
`SUGGESTION_CATEGORIES`; the test pins the four so that is a deliberate act.

**OQ-R15 — per-row citation chips on a reference answer, or one chip row?**
*Default: per-row, but only when `citations.length === items.length`.* Per-row is
the point of the shape — a spec sheet whose numbers share one undifferentiated
chip row does not tell a technician which page a given value came from — and
ST-R05 AC 4's item↔citation correspondence is what makes it sound. The equality
guard is the part I would not remove: it is the difference between "cites
precisely" and "mis-cites confidently", and `CLAUDE.md` is explicit about which
of those is worse.

---

## 8. Files changed

```
app/App.tsx                          coverage state carries doc types
app/components/Chrome.tsx            ST-R02 — the dismiss glyph
app/components/Message.tsx           ST-R06 — ReferenceAnswer + the shape branch
app/lib/diagnose.ts                  meta.shape parsing; requestUnitSuggestions
app/lib/identify.ts                  ConfirmedUnit.docTypes
app/lib/referenceFormat.ts    (new)  the reference parser (+ the CM-2 adapter)
app/lib/starters.ts          (rewrite) wire contract + coverage statement
app/lib/store.ts                     shape passed through, never persisted
app/lib/supabase.ts                  AnswerShape; Message.shape
app/screens/CaptureScreen.tsx        docTypes on both confirm paths
app/screens/ChatScreen.tsx           ST-R16 — EmptyAsk's three states
tests/lib/contrastMatrix.mjs         6 new rows; all file:line pointers refreshed
tests/lib/densityScenes.mjs          EmptyAsk state declared; fenced lines refreshed

app/components/guestNoticeUi.test.mjs (new, 13)
app/components/referenceUi.test.mjs   (new, 17)
app/lib/referenceFormat.test.mjs      (new, 13)
app/lib/starters.test.mjs             (rewritten, 22)
app/screens/emptyAskUi.test.mjs       (new, 15)
```

Untouched, deliberately: `lib/**`, `sql/**`, `scripts/serve.mjs`,
`app/lib/guestNotice.ts`, `app/lib/accountCopy.ts`, `app/screens/accountUi.test.mjs`,
`app/components/messageUi.test.mjs`, `tests/lib/density.test.mjs`,
`tests/fixtures/density-baseline.json`.
