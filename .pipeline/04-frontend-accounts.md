# 04 — Frontend · Accounts, guest disclosure, company & profile screens

Stage 4 artifact for `.pipeline/00-brief-accounts.md`,
`.pipeline/02-user-stories-accounts.md` and `.pipeline/03-backend-accounts.md`.

> **This is not Run B.** `.pipeline/04-frontend.md` belongs to Run B (the
> diagnostic core) and is untouched. Branch: `stage/frontend-accounts`.

**Precondition checked before any code was written.** `03-backend-accounts.md` is
committed at `215a3db` and merged at `e20335a`, and the code it describes is
present in the worktree — `app/lib/auth.ts`, `authState.ts`, `accounts.ts`,
`accountErrors.ts`, the `supabase.ts` persistence wiring and the guest seam inside
`store.ts` all exist and their 40 tests pass. Stage 3 has merged; nothing was
reimplemented.

**No backend code, contract or migration was changed by this run.** Nothing under
`sql/`, `lib/`, `scripts/`, `ingest/`, `app/lib/accounts.ts`, `app/lib/auth.ts`,
`app/lib/accountErrors.ts`, `app/lib/authState.ts`, `app/lib/store.ts` or
`app/lib/supabase.ts` is touched. Three divergences between the documented
contract and the shipped policies were found; all three are compensated in **one**
adapter and filed under `CONTRACT MISMATCH` against Backend rather than fixed
here.

---

## Contents

1. [What landed, and why](#1-what-landed-and-why)
2. [The two domain rules, on screen](#2-the-two-domain-rules-on-screen)
3. [CONTRACT MISMATCH](#3-contract-mismatch)
4. [BLOCKED ON BACKEND](#4-blocked-on-backend)
5. [BLOCKED — environment](#5-blocked--environment)
6. [How to verify each acceptance criterion](#6-how-to-verify-each-acceptance-criterion)
7. [Lint, build, test — exact status](#7-lint-build-test--exact-status)
8. [Accessibility and responsiveness — what applied](#8-accessibility-and-responsiveness)
9. [OPEN QUESTIONS and the defaults taken](#9-open-questions-and-the-defaults-taken)
10. [The Chrome.tsx reversal, recorded](#10-the-chrometsx-reversal-recorded)
11. [What I did not verify](#11-what-i-did-not-verify)

---

## 1. What landed, and why

### 1.1 New files

| File | Story | What it is |
|---|---|---|
| `app/lib/accountCopy.ts` | ST-A04/06/10/11/12/18 | Every word the identity screens say, keyed by `AccountErrorCode` as a **total `Record`** so an unmapped code is a compile error rather than a silent "something went wrong". Also holds the guest disclosure, the OQ-A1 privacy statement, the deletion copy and the Private Relay note. |
| `app/lib/accountsAdapter.ts` | — | **The only place Stage 4 works around Stage 3.** Three divergences, all documented in the file header, all filed in §3. |
| `app/components/Form.tsx` | ST-A04/10/11 | `Field`, `Button`, `Section`. No new dependency — tokens plus `ScalePressable`. Encodes the three accessibility facts once: visible label *and* `accessibilityLabel`, a focus ring RN does not give a `TextInput`, and `MIN_TOUCH`. |
| `app/screens/SignInScreen.tsx` | ST-A04, ST-A06 | Apple, Google, email+password, and "Continue without an account". |
| `app/screens/AccountScreen.tsx` | ST-A11, ST-A12, ST-A10 entry | Profile, companies, linked providers, sign-out, deletion. |
| `app/screens/CompanyScreen.tsx` | ST-A10, ST-A18 | Create, join, roster, owner actions, join codes, the privacy statement. |
| `app/lib/accountCopy.test.mjs` · `accountsAdapter.test.mjs` · `app/screens/accountUi.test.mjs` | — | 48 new tests. |

### 1.2 Files changed

`app/App.tsx` · `app/components/Chrome.tsx` · `app/screens/ChatScreen.tsx` ·
`app/screens/HistoryScreen.tsx` · `app/screens/UnitGate.tsx`.

### 1.3 The decisions worth knowing

**The 4.8 pairing rule is enforced by construction.** `SignInScreen` renders the
provider buttons by mapping `SIGN_IN_PROVIDERS` from `lib/auth.ts` — there is no
hand-kept list in the screen to fall out of step with it. Shipping Google without
Apple now requires deleting Apple from a shared module that a test asserts
against, rather than deleting a line from a screen. A static test also fails if a
hardcoded `signInWithProvider('google')` appears beside the map.

**The Account tab is static in both auth states.** OQ-A4 sub-decision 1 refused to
hide the History tab from a guest because that makes the shape of the app depend
on auth state. The same rule is applied to the new tab: it is always present, and
what changes is what is inside it — sign-in for a guest, profile/companies/deletion
when signed in. A guest therefore never has the company or deletion surfaces
*hidden*; they are **not mounted** (ST-A10 AC 6, ST-A12 AC 10).

**The guest disclosure is on two screens, not one — and the second one is the
find.** `ChatScreen` was the obvious place. But `UnitGate` also answers: U7's
carve-out calls `refusalCheck()` and renders a **refusal** before any unit exists,
and a refusal is an answer. A guest whose very first question is a hazard would
have got a reply having never been told the conversation is not being kept, which
is precisely the failure ST-A06 AC 6's "before the first answer, **not after**"
names. Both screens now carry it, and a test asserts the gate still answers so
the check cannot go quietly vacuous.

The disclosure sits **above the composer**, not inside the empty state, because an
empty state disappears on the first send and this has to still be true on the
tenth question.

**Signing in mid-job keeps the transcript and marks it.** Three things happen and
no fourth: the boundary is drawn (`SavedFromHere`), the guest session id is
*detached* so nothing writes into a uuid that is not a row, and the shell is told
the marker is drawn so an hourly token refresh does not scatter more of them.
`seqBase` rebases `seq` for the new session, so the persisted path's
`unique (session_id, seq)` still holds when the visible list is longer than the
session. The retry affordance on a pre-boundary unanswered turn re-asks rather
than regenerating in place — regenerating would write an answer with no question
above it.

**Deletion asks for a typed word.** ST-A12 AC 9 permits "a typed confirmation or
equivalent deliberate act". A second tap is not deliberate: it is the same gesture
in the same place, and a gloved thumb on a vibrating roof produces it by accident.
On `sole_owner_of_company` the copy leads with *nothing has been deleted* (the RPC
is atomic) and the error's `detail` — the company id — routes straight to the
company screen, where both exits the technician can complete alone live.

**Zero rows is never rendered as "you are not allowed".** §3.2 of the backend
contract makes a refused read and an empty read indistinguishable on purpose, so a
company is not discoverable by a stranger who guesses its uuid. `listJoinCodes`
returning `[]` for a member renders as "no codes", never as an error and never as
access denied. The UI does not try to tell the two apart, because it cannot.

---

## 2. The two domain rules, on screen

**Cite every claim.** No change, and that is the point. Citations render through
the existing `Message.tsx` / `Citation.tsx` path on both routes — the chip carries
`source_document` and `page` in its accessibility label, the sheet opens the
passage, and `Message.tsx`'s zero-citation guard still refuses to draw an uncited
answer as guidance. `appendGuestMessage` passes the payload through untouched
(§3.3), so a guest's answer is inspectable exactly as a signed-in one is. Nothing
this run added renders a claim, so nothing this run added can render one uncited.

**Advise-only, with hard refusals.** A refusal is `kind: 'refusal'`, a
**successful** result — structurally a different thing from a thrown
`AccountFailure`, so the two cannot be confused. It is rendered only by
`Message.tsx`'s `RefusalCard`: red all over, two-pixel alert border, no dismiss,
no collapse, no retry. A test asserts that **no new screen** renders a refusal or
borrows `color.refusal` (the fill), which is the language that tells a technician
at arm's length to stop.

The new error surfaces are deliberately *unlike* it. `InlineNotice` is a steel
card with one glyph in two tones — red for a failure, cyan for a routing signal
— which keeps E5.2's "tellable apart at a glance" intact. Three outcomes are
explicitly not failures and are tested as such: `cancelled` renders **nothing**,
`email_taken` routes the technician to the account their history is actually on,
and `auth_delete_unavailable` reads as our unfinished server work with *nothing
was deleted* stated, never as something the user did.

The guest disclosure borrows the alert red for its border and glyph, because it is
the app's other honest warning. It is not the refusal card: it has an action, it
is not red all over, and it makes no safety claim.

---

## 3. CONTRACT MISMATCH

**Owner: Backend.** All three are compensated in `app/lib/accountsAdapter.ts` and
nowhere else. Each has a comment in that file naming it. Stage 5 should route
these; none of them was fixed in backend code by this run.

### CM-1 · `getMyProfile()` throws in any company with more than one person

`app/lib/accounts.ts:getMyProfile` selects `profiles` with **no filter** and calls
`.maybeSingle()`, relying on RLS to leave exactly one row. True under `sql/010`,
whose only SELECT policy is `profiles_select_own`. `sql/012:158` then adds
`profiles_select_co_member` (ST-A03 AC 6, and correct). Policies are OR'd, so from
the moment a second person is in your company the select returns N rows and
`.maybeSingle()` fails with PostgREST's multiple-rows error.

Worst-shaped bug available: solo technicians and one-person companies work, every
real shop's profile screen breaks — invisible in any fixture with one user in it.

**Adapter:** `myProfile(userId)` adds `.eq('id', userId)`. **That filter is
disambiguation, not isolation**, and the adapter header and a test both say so:
RLS decided which rows exist; this picks mine out of a set the database already
permitted. If it were the only thing keeping technicians apart it would be a
defect on the days it worked, because the anon key ships in the bundle.

**Suggested fix:** `.eq('id', (await supabase.auth.getUser()).data.user.id)` or
`.limit(1)` keyed on the caller, in `accounts.ts`.

### CM-2 · `listMyMemberships()` returns co-members' rows too

Its doc comment says "Every company this user belongs to, with their role in
each", and §3.2 describes it as the solo-technician emptiness check. It selects
`memberships` unfiltered, and `sql/012:186` `memberships_select_member` is
`using (is_member(company_id))` — every member may read **every** membership row
of their company. A three-person shop returns three rows for one company, so a
naive company list shows the same shop three times and the switcher offers it
repeatedly.

**Adapter:** `mine(rows, userId)`, tested against the row shape the policy
actually returns.

### CM-3 · `company_roster` carries no membership id, but the mutations need one

ST-A10 AC 1 requires an owner to remove a member and change a role from the
roster. `listRoster()` reads `public.company_roster`, which exposes
`company_id, user_id, role, joined_at, display_name, trade_role` — no membership
id, **correctly**, since OQ-A1 keeps that view down to what a company may see
about a person. But `setMemberRole(membershipId, …)` and
`removeMembership(membershipId)` are both keyed by membership id.

**Adapter:** `membershipIds(rows, companyId)` derives `user_id → membership id`
from the same `listMyMemberships()` call CM-2 already had to widen. CM-2's
over-broad read is what rescues CM-3. A roster row whose id cannot be resolved
gets **no controls** rather than a button that cannot work.

**Suggested fix:** either add `membership_id` to the view (it says nothing about
what a technician asked, so OQ-A1 is intact) or key the two mutations by
`(company_id, user_id)`.

---

## 4. BLOCKED ON BACKEND

### BF-1 · ST-A11 AC 4 — linking an additional provider

`app/lib/auth.ts` exposes `linkedProviders()` to **read** the list, and the screen
renders it. There is no function to **add** one. Implementing it in a screen would
mean a second OAuth web-flow round trip (`linkIdentity` → `openAuthSessionAsync` →
`setSession`) living outside `auth.ts` — the parallel auth path Stage 3's §10
explicitly told Stage 4 not to build, and it could not be exercised anyway
(providers are disabled, B4).

**What shipped instead of a stub:** the linked-methods list, the Private Relay
disclosure that AC 4 also requires, and one sentence saying linking is not in this
build yet and that signing in another way makes a separate account. A button that
cannot work is worse than an honest sentence, so there is no button.

**What unblocks it:** `linkProvider(provider: OAuthProvider)` in `app/lib/auth.ts`,
reusing the `signInWithProvider` round trip against `supabase.auth.linkIdentity`.
Roughly fifteen lines against a contract that already exists. Then ST-A20.

---

## 5. BLOCKED — environment

Reported as BLOCKED, never as PASS. Nothing was faked to get around any of these.

| # | What | Why | What unblocks it |
|---|---|---|---|
| E1 | Every screen that reads or writes `profiles`, `companies`, `memberships`, `company_join_codes` | **`sql/010`–`014` have not been applied.** The tables do not exist. | The owner runs §4 of `03-backend-accounts.md` in the SQL Editor |
| E2 | Sign-up end to end (brief AC 1) | **Email confirmation is ON** (measured, §1.2), so `signUp` sends mail and hits the rate limit | One dashboard toggle — H9 |
| E3 | Apple and Google, end to end | **Providers not enabled**; ST-A20 is Human-owned with external lead time | ST-A20, then the dashboard toggles. **No code change** — the screen already renders both and `signInWithProvider` already rejects with `provider_disabled`, which is honest |
| E4 | CM-1's adapter against a real multi-member company | Needs `sql/010` + `sql/012` applied and two real users | E1 |
| E5 | Any visual verification | No component test runner, no headless browser in this repo — see §11 | ST-A17's device pass |
| E6 | `npm run verify:bundle` (the export step) | Pre-existing; fails identically on untouched `main` (Stage 3 B7) | Stage 5. `--reuse` works and I verified the bundle by hand — §7 |

**A guest can be exercised today, and was.** The guest route touches no database
(ST-A06 AC 1), so the disclosure, the History empty state, the sign-in screen and
the "Continue without an account" path are the parts of this run that are not
blocked on a migration.

---

## 6. How to verify each acceptance criterion

Brief AC → how. Machine checks are `npm test` unless named otherwise.

| Brief AC | How to verify | Status |
|---|---|---|
| **1** — sign up / out / in, history intact, **on the device** | Human, ST-A17 AC 5. Frontend half: `accountUi.test.mjs` "all four ways in", "an in-use address routes", `accountCopy.test.mjs` sign-in outcome mapping | **BLOCKED** — E1, E2 |
| **2** — only own sessions | Backend/Test. Frontend adds no filter that could be mistaken for isolation; `accountsAdapter.test.mjs` "the filter is disambiguation, not isolation" states it and tests it | **BLOCKED** — E1 |
| **3** — create a company, a second user joins | `accountUi.test.mjs` "create, join, roster and the owner actions all exist" proves the surfaces are wired to the RPCs; the round trip needs `sql/012`/`013` | **BLOCKED** — E1 |
| **4** — admin removes a member | Roster remove is wired (CM-3 adapter). Enforcement is ST-A08's policies, not this UI, and no AC here treats hidden UI as security — `accountUi.test.mjs` asserts the file says so | **BLOCKED** — E1 |
| **5** — solo user, full use, no dead ends | `accountUi.test.mjs` "nothing outside the company screens is gated on a company" (grep for `active_company_id` in ChatScreen, HistoryScreen, App, Chrome — zero) and "the app never routes into the company screens by force"; `accountCopy.test.mjs` "no copy anywhere implies a company is required" (`/must (create\|join) a compan/i`) | ✅ **machine half passes** · human walk-through ST-A13 AC 6 |
| **6** — in-app deletion | `accountUi.test.mjs` typed-DELETE gate, `disabled={!armed}`, `sole_owner_of_company` handled with `e.detail` routing; `accountCopy.test.mjs` asserts the copy names what is destroyed and that it is final | **flow verifiable now, outcome BLOCKED** — E1 |
| **7** — ownerless prototype rows | Backend/migration. Frontend contributes the guest route writing nothing, unchanged from Stage 3 | **BLOCKED** — E1 |
| **8** — lint/build/test exit 0, no new warnings | §7 | ✅ |
| **9** — no secret leaves the server | `npm run verify:secrets` exit 0; `verify:bundle -- --reuse` against a hand-exported bundle: clean; `accountUi.test.mjs` asserts `SUPABASE_SERVICE_ROLE_KEY` appears in none of the new files | ✅ |

### Story criteria this run owns, and where each is checked

| Criterion | Check |
|---|---|
| ST-A04 AC 1 | `accountUi.test.mjs` — all four actions; every control labelled |
| **ST-A04 AC 2 (compliance)** | `accountUi.test.mjs` "Google cannot ship without Apple" — reads `SIGN_IN_PROVIDERS`, requires Apple present and **first**, and fails on a hardcoded Google call beside the map |
| ST-A04 AC 5 | `accountCopy.test.mjs` — seven outcomes with distinct titles, `cancelled` the only silent one; `accountUi.test.mjs` — the screen checks `isSilentOutcome` and short-circuits `status === 'cancelled'` |
| ST-A04 AC 6 / ST-A10 AC 4 | no hex outside tokens; `MIN_TOUCH` sizing (both halves — token used *and* no literal under 48) |
| ST-A04 AC 8 | `'address-in-use'` flips to sign-in mode with the address kept |
| ST-A04 AC 9 | no `console.*` in any new file |
| ST-A06 AC 6 | disclosure precedes the composer, is gated on auth state and **not** on `messages.length`; **and** the unit gate carries it, with a check that the gate still answers |
| ST-A06 AC 7 | the guest branch precedes the offline and error branches — for a guest nothing was requested, so nothing failed |
| ST-A06 AC 8 | `detached.current ? null : sessionId`, and `seqBase` rebasing |
| ST-A06 AC 9 | `<SavedFromHere/>`, `justSignedIn`, `onBoundaryDrawn` |
| ST-A06 AC 10 | shell clears screen state when a known user is replaced; `store.ts` clears its own memory in `signOut` |
| ST-A10 AC 2 | asserted **as documentation**, deliberately: the test checks the file states hiding is cosmetic and points at ST-A08. Hidden UI is not a security control and no criterion here treats it as one |
| ST-A10 AC 5 | switcher renders only above one membership (`memberships.length > 1`) |
| ST-A11 AC 2 | client-side 1–60 check on `display_name`, with the `sql/010` constraint as the rule |
| ST-A11 AC 6 | zero memberships renders one sentence and two actions — no card, no placeholder, no prompt. §9 OQ-F1 records the reading |
| ST-A12 AC 9, 10, 11 | typed gate, both sole-owner exits, screen not mounted for a guest, no service-role string |
| ST-A18 AC 1–3 | privacy notice appears **exactly three times**, precedes both primary buttons in tree order, and no `collaps`/`accordion`/`show more` anywhere in the file |
| ST-A02 AC 6, 7 | `return startAuth(...)` as the effect cleanup; `isDetermining(auth)` gating, and `phase !== 'signed-in'` — the wrong check that produces the flash — asserted absent |

---

## 7. Lint, build, test — exact status

Run on `stage/frontend-accounts` in the agent worktree, 10 Aug 2026.

| Command | Baseline (worktree, before my changes) | After | Verdict |
|---|---|---|---|
| `npm run lint` | exit **0** · **0 errors, 0 warnings** | exit **0** · **0 errors, 0 warnings** | ✅ **no new warnings** |
| `npm run build` (`tsc --noEmit`) | exit **0**, clean | exit **0**, clean | ✅ |
| `npm test` | **339 tests · 338 pass · 1 fail** | **387 tests · 386 pass · 1 fail** | ✅ **+48, all passing** |
| `npm run verify:secrets` | exit 0 | exit **0** — no key value, no key-shaped string in 234 tracked files and 183 commits | ✅ |
| `npm run verify:bundle` | **fails on untouched `main`** (Stage 3 B7) | fails identically — `Export failed — nothing to scan` | ⚠️ **pre-existing, unchanged** |
| `npm run verify:bundle -- --reuse` | — | exit **0** · **no server-side key, key-shaped string or server-only name in the built bundle** | ✅ |

**The one failing test is the known worktree artifact, not a regression.**
`ingest/reconcile.scope.test.mjs` fails with
`ENOENT … scandir '…/HVAC Data'`. `HVAC Data/` is gitignored source PDFs and is
absent from every agent worktree. It fails identically on the commit I branched
from. **The arithmetic closes:** 339 baseline + 48 new = 387, and 338 + 48 = 386
passing. Stage 3 projected 344 in the shared checkout; that becomes **392** after
this merge.

**`verify:bundle`, substantively.** The scripted export fails for a reason that
predates this run (Stage 3 traced it to how `verify-bundle.mjs` spawns `npx.cmd`,
not to the build). I did the same thing Stage 3 did and exported by hand:
`npx expo export --platform web` succeeded, producing a **1.54 MB** bundle (up
from Stage 3's 1.43 MB, which is the four new screens), and `--reuse` scanned it
clean. **That export is also the strongest compile-level proof this run has** —
production bundling resolves every new module for the web target, which is more
than `tsc` checks.

**One warning class that is pre-existing and not mine.** `node --test` prints
`[MODULE_TYPELESS_PACKAGE_JSON]` for `.ts` modules imported from `.mjs` tests.
Stage 3 introduced it with `store.guest.test.mjs`/`store.ts`; my adapter test adds
another instance of the same existing class. It is a Node runtime notice, not a
lint or build warning, and it does not affect any exit code. Clearing it means
adding `"type": "module"` to `app/package.json`, which is an Expo-facing change I
am not making on a frontend story — filed as a note for Stage 5.

**Rails I did not run:** `verify:auth`, `verify:accounts`, `verify:sessions`,
`measure:*`. They need `.env`, which does not exist in an agent worktree, and they
are Backend/Test-owned. Their status is Stage 3's §6 and is unchanged by this run,
which touched none of their inputs.

---

## 8. Accessibility and responsiveness

**Research did not run for this brief** (`00-brief-accounts.md` §Sequencing), so
there is no captured a11y bar from Stage 1. The bar applied is the one the
existing screens and `tests/suites/e6-app.mjs` already hold, which is **higher**
than the stated floor. What applied, and how it was checked:

| Bar | Applied | Checked by |
|---|---|---|
| **48dp minimum touch target** (E6.7, above the 44pt floor) | Every button, input and icon control | `accountUi.test.mjs` — both halves: `MIN_TOUCH` is what sizes them, *and* no numeric literal under 48 |
| **Form controls labelled** | `Field` renders a visible `<Text>` label **and** passes `accessibilityLabel` — a placeholder vanishes the moment you type into it | `accountUi.test.mjs` "every interactive element in the new screens is labelled" — 22 real tags scanned, verified non-vacuous |
| **Focus visible** | RN gives a `TextInput` no focus ring, so `Field` turns its border cyan on focus. Matters most on the web target, where the keyboard is how you move | Source; **not** rendered-verified (§11) |
| **Keyboard operable** | Every field carries `returnKeyType`/`onSubmitEditing`; forms submit without reaching for a button; `keyboardShouldPersistTaps="handled"` so a tap on a button under an open keyboard lands | Source; **not** rendered-verified |
| **Screen-reader roles** | `accessibilityRole="button"` on every action; `role="alert"` on `InlineNotice` in the error tone only — a routing notice that shouts is a notice people turn off; `accessibilityState` for disabled/busy; the join code is labelled character-by-character so it is readable aloud down a phone | Source |
| **Contrast** | Every colour from `theme/tokens.ts`; refusal *text* uses `refusalText` (the ≥4.5:1 variant), never `refusal` | `e6-app.mjs`'s existing token-pair contrast check, unchanged and still passing |
| **Breakpoints already in the codebase** (`TABLET_MIN_WIDTH = 768`) | The Account tab takes the full width on tablet rather than being squeezed beside the session list; the phone layout is a single scrolling column with no horizontal overflow | Source; **not** rendered-verified |

**Beyond the floor and worth naming:** the guest disclosure and the boundary
marker both expose their full text to the accessibility tree as one label, so a
screen-reader user gets the whole disclosure rather than fragments.

---

## 9. OPEN QUESTIONS and the defaults taken

Recorded with the default, and proceeded on the default. None re-opens a
**RESOLVED BY OWNER** decision.

**OQ-F1 · ST-A11 AC 6 says "no company section", ST-A10 AC 1 requires a
create-company screen.** Read literally the first makes the second unreachable.
**Default taken:** for a technician with zero memberships the account screen shows
**no card, no placeholder and no prompt** — one sentence saying a company is
optional, and two actions they may ignore forever. This satisfies ST-A11 AC 6's
actual target (nothing that reads as a missing thing to fill in), ST-A10 AC 1
(the screens exist and are reachable) and ST-A10 AC 7 (nothing routes into them
*by force* — a test asserts the shell cannot navigate straight into a company
screen). A screen with no route to creating a company would fail ST-A10 outright.

**OQ-F2 · What to show for `auth_delete_unavailable`.** §3.1 forbids showing it as
a user error but does not say what to show. **Default taken:** a `notice`-tone
card titled "Deleting from the app is not finished on the server yet", stating
that nothing was deleted, that the account is untouched, and that it is ours to
finish and not something they did or can fix. Tested. The alternative — hiding the
delete button entirely when the RPC is unavailable — was rejected: the app cannot
know that until it tries, and hiding an App-Store-required action is worse than
explaining an unfinished one.

**OQ-F3 · Where "sign in" leads from the three affordances that offer it** (the
composer disclosure, the History empty state, the unit gate). **Default taken:**
all three switch to the Account tab, which renders `SignInScreen` for a guest. One
route, no modal, no second navigation concept — the shell is a state switch, not a
router (`App.tsx` header), and adding an overlay for this would be the parallel
pattern `CLAUDE.md` warns about.

**OQ-F4 · Whether the sign-in screen should hard-fail when Supabase env is
missing.** The other screens render `ErrorState` + `CONFIG_HINT` and stop.
**Default taken:** show the same hint as a notice and disable only the sign-in
actions, keeping "Continue without an account" live. A guest needs no backend
(§1j), so an unconfigured build is still a usable one, and blocking the guest path
behind a config error would be a dead end the brief's hard constraint 5 forbids.

**OQ-F5 · The Chrome tab label.** The mockup's third tab was "Settings"; ST-A10
AC 8 calls it "Settings"/"Account". **Default taken: "Account"**, because its
content is identity rather than preferences and there are no settings in it.

---

## 10. The `Chrome.tsx` reversal, recorded

ST-A10 AC 8 requires this to be recorded rather than done quietly.

`app/components/Chrome.tsx:9-11` dropped the mockup's third tab with the reasoning
"No Epic 6 story defines it and it has no content; an empty tab is the dead end
E6.6 forbids." That reasoning was correct and has **expired** rather than been
overruled: E9 is what gives the tab content. The file header now says so, in
place, with the original argument preserved.

The condition that justified dropping it is the one being watched: the tab has
content in **both** auth states — sign-in for a guest, profile/companies/deletion
when signed in — so there is no state in which it is the empty dead end. That is
also why it is not conditionally rendered: a tab that appears when you sign in is
a shape change, and OQ-A4 sub-decision 1 already rejected that reasoning for
History.

---

## 11. What I did not verify

Stated rather than implied.

- **No visual verification was performed, and none was possible.** This repo has
  **no component test runner** (no React Testing Library, no react-test-renderer,
  no jest) and **no headless browser** (no Playwright, no Puppeteer, no jsdom in
  either `node_modules`). This run does not add one — that is a test-infrastructure
  decision with no mandate from any story in this file, and Stage 5 should own it
  if it is wanted. `tests/suites/e6-app.mjs` already establishes source-level
  structural checking as this repo's answer, and the new tests follow it.
- **What I did instead, and what it does and does not prove.** I started
  `expo start --web`, fetched the dev bundle (4.5 MB, HTTP 200) and confirmed all
  four new copy strings are present in it, then ran a full production
  `expo export --platform web` successfully. That proves every new module resolves
  and bundles for the web target and that no import is broken. It does **not**
  prove the app mounts, that a layout is correct, that focus is visible, or that
  the disclosure is legible on a phone in sunlight.
- **Camera and native auth flows do not work on the web target** in any case, so
  even with a browser the OAuth round trip could not have been exercised there.
- **Everything above is ST-A17's `[H]` work** and is left there rather than
  dressed up as passing here. Per `tests/run-all.mjs:184`, no agent may report a
  human-only criterion as PASS.
- **`.eq()` filters in `accountsAdapter.ts` are never isolation.** Said in the file
  header, in a test name, and here, because it is the one thing in this diff that
  could be misread as a security control.

---

**Stage 4 complete.** Four screens, three shared components, one copy module, one
adapter, 48 tests, and one gap found by reading rather than by a failing test (the
unit gate answers, so it needed the disclosure too). No backend file, contract or
migration was changed; three contract divergences are isolated in one adapter and
filed against Backend; one story criterion is filed as BLOCKED ON BACKEND with the
fifteen lines that would close it; and no safety, citation or secrets guarantee was
weakened to make an identity screen render.
