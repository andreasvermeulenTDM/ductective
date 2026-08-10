# 03 — Backend · Accounts, user profiles & company profiles

Stage 3 artifact for `.pipeline/00-brief-accounts.md` and
`.pipeline/02-user-stories-accounts.md`.

> **This is not Run B.** `.pipeline/03-backend.md` belongs to Run B (the diagnostic
> core) and is untouched. Branch: `stage/backend-accounts`.

**Nothing in this run touches the diagnostic core.** No file under `ingest/`, no
retrieval, prompting, citation-anchoring or safety-gate file under `lib/`, and no
change to `scripts/serve.mjs`. The two new files under `lib/` — `auth-config.mjs`
and `join-code.mjs` — implement none of those four things and are named here so
ST-A19 AC 3's path allowlist can account for them rather than flag them.

---

## Contents

1. [The two measurements, first](#1-the-two-measurements-first)
2. [What landed](#2-what-landed)
3. [The contracts Stage 4 builds against](#3-the-contracts-stage-4-builds-against)
4. [The exact SQL the owner must run, in order](#4-the-exact-sql-the-owner-must-run-in-order)
5. [The release sequence — why `main` is never left broken](#5-the-release-sequence)
6. [Rails status, honestly](#6-rails-status-honestly)
7. [How to verify each acceptance criterion](#7-how-to-verify-each-acceptance-criterion)
8. [BLOCKED](#8-blocked)
9. [OPEN QUESTIONS and the defaults taken](#9-open-questions-and-the-defaults-taken)
10. [Deferred to Frontend](#10-deferred-to-frontend)

---

## 1. The two measurements, first

§8 of the stories names two measured unknowns that change the shape of a story.
Both were attempted before anything was built on them. **One is answered. One is
partly answered and its remainder is BLOCKED on a human running SQL** — stated
plainly rather than dressed up.

### 1.1 · Can a `SECURITY DEFINER` function delete from `auth.users`? — **BLOCKED on one paste, and it no longer changes the shape of ST-A12**

**Command attempted:** `npm run measure:authdelete`
(`scripts/measure-auth-delete.mjs`, committed).

```
MEASURED  path (B) mechanism — admin.deleteUser
          → WORKS — the auth.users row is gone
BLOCKED   path (A) — can a SECURITY DEFINER function delete from auth.users?
          → sql/014_account_deletion.sql has not been applied yet, and an agent
            cannot run DDL.
```

**Why it is blocked and not simply un-measured.** Answering it requires `CREATE
FUNCTION`, which is DDL. There is no migration runner in this repo, no
`DATABASE_URL`, no Supabase personal access token, and the Supabase CLI is not
logged in — every statement is run by hand by the owner in the SQL Editor, and
this run's own hard constraints say so. I could not find a way to get the answer
without a human, and inventing one (installing a Postgres driver, or asking for a
new credential) would have been a worse trade than a fifteen-second paste.

**So I removed the dependency instead of guessing at it.**
`sql/probe_auth_delete_capability.sql` is the paste. It is **non-destructive** —
it deletes the all-zeroes uuid, which cannot exist — it never touches `documents`
or `chunks`, it takes no heavy lock, and it drops every object it creates. It
returns one row:

| Answer | What ships |
|---|---|
| `CAN_DELETE` | The app calls `public.delete_own_account()`. No Edge Function, no CLI login, no new Human task. |
| `CANNOT_DELETE — …` | The app calls a `delete-account` Edge Function, which calls `public.delete_own_account_data()` with the caller's JWT and then `auth.admin.deleteUser()` with the service-role key held as a **function secret**. |

**`sql/014` installs both entry points**, so the probe *selects* a path rather
than *causing a rework*. That is the substantive de-risking §8.4 was asking for,
and it is why the remaining unknown is a scheduling detail rather than a design
one. Path (B) is already known-good: the measurement above confirms
`admin.deleteUser` works on this project today.

The probe also asks a **second** question in the same round trip: may we put a
trigger on `auth.users`? `sql/010`'s profile auto-provisioning depends on it. It
is the pattern Supabase's own documentation uses and is expected to work — but
this run has already been surprised once by `auth`, and finding out costs nothing.

**Atomicity, either way.** `delete_own_account()` performs the app-row deletes and
the `auth.users` delete in one transaction, and traps `insufficient_privilege` /
`undefined_table` into the defined error `auth_delete_unavailable`. If the
privilege is missing, **nothing is deleted**. A half-deleted account — data gone,
login still working — is the worst outcome available here and is worse than a
failure the user can see.

### 1.2 · What does this project do when the same email arrives via two providers? — **MEASURED**

**Command:** `npm run measure:linking` (`scripts/measure-auth-linking.mjs`,
committed). Run against the live project, 10 Aug 2026:

```
MEASURED  A0. identities on a fresh email/password user
          → email
MEASURED  A1. email_confirmed_at on an admin-created confirmed user
          → set
MEASURED  A. two auth.users rows with the same email
          → REFUSED — email_exists: A user with this email address has already
            been registered
MEASURED  B. anon signUp on an existing address
          → an obfuscated user with ZERO identities was returned (GoTrue
            user-enumeration protection: the call looks successful, no account
            was created, no session was issued)
MEASURED  C. self-service signUp confirmation state
          → signUp failed: email rate limit exceeded
          (a mail rate limit means confirmation email is being SENT — i.e.
           "Confirm email" is ON.)
```

**What the script can and cannot see, stated rather than glossed.** Completing a
real Apple or Google authorization needs a browser, a provider account, and
providers that are actually enabled — the last of which is BLOCKED on ST-A20 (both
measured disabled, §8). So it measures the *decidable substrate* underneath OQ-A9,
which is where the answer lives.

**The finding, and it settles OQ-A9's branch:**

1. **A silent duplicate is structurally impossible for a matching address.** This
   project refuses two `auth.users` rows with the same email (`email_exists`). So
   an OAuth provider returning an address that already exists must either **link
   to the existing user** or **error** — OQ-A9's outcome 2 (a second user, history
   apparently vanished) cannot happen by that route. That is the good branch.

2. **But GoTrue already lies about it in a way the app must handle.**
   `signUp` on an existing address does **not** error. It returns a
   successful-looking response carrying a user object with an **empty `identities`
   array** and **no session**. If the app treats that as a successful sign-up it
   will congratulate a technician on an account that does not exist, and their
   real history will appear to have vanished — the exact OQ-A9 failure, arriving
   through the email path rather than the OAuth one. `isExistingAddressDecoy()` in
   `app/lib/accountErrors.ts` detects it, `signUpWithEmail()` returns
   `{ status: 'address-in-use' }`, and `app/lib/accountErrors.test.mjs` asserts it.

3. **A finding that contradicts an assumption in OQ-A9 item 3, and matters.**
   OQ-A9 item 3 reasons that with confirmation OFF an email/password address is
   "unproven", so linking toward it would be unsafe. Measured: with confirmation
   OFF, GoTrue **autoconfirms** — `email_confirmed_at` is set. GoTrue's linking
   rule keys on *confirmed*, not on *actually verified*. So turning confirmation
   off does not make GoTrue refuse to link; it makes GoTrue **willing** to link an
   OAuth identity to an address nobody proved they own. That is the
   account-claiming risk OQ-A9 item 3 was trying to avoid, and switching the
   toggle off does not avoid it.
   **This does not change the decision** — confirmation stays off for the beta,
   because brief AC 1 must be provable on the device and the free-tier mailer
   makes that flaky — but it does raise the priority of the `launch-blocker`
   backlog item. Recorded here rather than left for someone to rediscover.

4. **Confirmation is currently ON**, so today's `signUp` sends mail and hits
   `email rate limit exceeded` after a handful of attempts. That is a real, live
   blocker on brief AC 1 and it is one dashboard click. Filed as **H9**.

5. **Apple Private Relay is untouched by all of the above**, because the two
   addresses genuinely differ. Some users will get two accounts and nothing can
   join them automatically. Disclosed, with manual linking as the escape hatch
   (ST-A11 AC 4), and filed to backlog.

**Consequence for Stage 4's copy:** build the "that address is already registered
— sign in that way, then link from your profile" path. It is reachable through the
email/password route today and through the OAuth route once ST-A20 lands.

---

## 2. What landed

### 2.1 Migrations — written, **not applied** (an agent cannot apply them)

| File | Story | Risk | Touches ingest tables? |
|---|---|---|---|
| `sql/probe_auth_delete_capability.sql` | ST-A12 / §8.4 | none — deletes nothing, drops itself | no |
| `sql/010_profiles.sql` | ST-A03 | **additive, safe any time** | no |
| `sql/011_session_rls_cutover.sql` | ST-A05 + ST-A14 | **destructive; a release step** | no |
| `sql/012_companies.sql` | ST-A07, ST-A08 | additive + one column on `sessions` | no |
| `sql/013_join_codes.sql` | ST-A09 | additive | no |
| `sql/014_account_deletion.sql` | ST-A12 | additive (functions only) | no |

All five follow the `sql/0NN_*.sql` house style: numbered, guarded
(`create table if not exists`, `drop policy if exists`, `do $$ … if not exists`),
re-runnable, with a verify block and — for `011` — an executable rollback block.

**None of them reads, writes or locks `documents` or `chunks`.** The running
ingest is untouched by every statement in this run.

Design points worth knowing, each argued in the file itself:

- **`default auth.uid()` on `sessions.user_id`** (§1d). The app diff becomes a
  *deletion* rather than an addition, and the ownership stamp stops depending on
  the client remembering to send it.
- **No policy sub-selects `memberships` from a `memberships` policy** (§1c).
  `is_member()`, `is_company_owner()`, `is_co_member()` and `is_company_owner_of()`
  are `SECURITY DEFINER` with pinned `search_path`, revoked from `public`/`anon`,
  granted to `authenticated`. `force row level security` is deliberately **not**
  set — forcing RLS on the owner would reintroduce the recursion the helpers exist
  to avoid.
- **`create_company()` breaks the chicken-and-egg** (§1e); direct `INSERT` on
  `companies` is revoked from everyone, not merely un-policied.
- **`anon` is revoked outright** on `sessions`/`messages`/`citations`/`profiles`/
  `companies`/`memberships`/`company_join_codes`. Under OQ-A4 the guest route
  never touches the database, so there is nothing unauthenticated to preserve.
- **`sessions.company_id` is referenced by no policy anywhere.** It is a
  trigger-set historical stamp (OQ-A2), derived and never accepted from the client
  — a claim the client makes about which company it was working under is not a
  fact worth recording.
- **The last-owner guard** is a `before update or delete` trigger that stands aside
  when the company row itself is already gone, which is what still allows a company
  to be deleted. Without that check an `ON DELETE CASCADE` would raise `last_owner`
  and company deletion would be impossible.
- **`redeem_join_code` takes `for update` on the code row**, which is what makes
  `max_uses` a limit rather than a suggestion under concurrency.
- **`public.company_roster`** is a `security_invoker = true` view. RLS is
  row-level and cannot restrict columns; this view is where OQ-A1's column
  narrowing actually happens. Without `security_invoker` a `postgres`-owned view
  would silently bypass RLS and become the hole this run exists to close.

### 2.2 App-side (`app/lib/`)

| File | Story | What |
|---|---|---|
| `supabase.ts` | ST-A02 | AsyncStorage adapter, `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`; plus the `Profile`/`Company`/`Membership`/`RosterEntry`/`JoinCode` row shapes |
| `authState.ts` | ST-A02 AC 7 | the three-state machine, pure and import-free |
| `accountErrors.ts` | ST-A04 AC 5/8 | the error contract; codes, never message strings |
| `accounts.ts` | ST-A03/07/08/09/11/12 | typed profile, company, membership, join-code and deletion access |
| `auth.ts` | ST-A02/A04 | sign-up, sign-in, the OAuth web flow, Apple first-authorization name capture, sign-out, the startup subscription |
| `store.ts` | ST-A05 AC 6, ST-A06 | the guest/persisted seam behind the same six exported names |

**The `store.ts` split, and one design choice worth defending.** `db()` and the
`diagnose` import are now **dynamic**. That is not style: `supabase.ts` constructs
a client with a React Native storage adapter and `diagnose.ts` imports
`react-native` at its top, so a static import made the module unloadable under
`node --test` — and ST-A06 AC 1 could then only ever have been asserted by reading
the source. It also buys a stronger property than the story asked for: **on the
guest route the Supabase client is never constructed at all.** Not "constructed and
unused" — absent.

### 2.3 Rails and instruments

| File | Wired as | Story |
|---|---|---|
| `lib/auth-config.mjs` + `scripts/verify-auth-config.mjs` | `npm run verify:auth` | ST-A01 |
| `scripts/measure-auth-linking.mjs` | `npm run measure:linking` | OQ-A9 / §8.9 |
| `scripts/measure-auth-delete.mjs` | `npm run measure:authdelete` | ST-A12 / §8.4 |
| `scripts/verify-accounts.mjs` | `npm run verify:accounts` | ST-A15 scaffold + every Backend NEGATIVE |
| `scripts/verify-sessions.mjs` | `npm run verify:sessions` | ST-A05 AC 7 — **retrofitted to a real account** |
| `lib/join-code.mjs` | — | ST-A09 AC 2 |

### 2.4 Tests — **+40**, all passing

`app/lib/store.guest.test.mjs` (9) · `app/lib/authState.test.mjs` (9) ·
`app/lib/accountErrors.test.mjs` (7) · `lib/join-code.test.mjs` (6) ·
`lib/auth-config.test.mjs` (9).

### 2.5 New dependencies, justified

All four installed with `npx expo install`, so the versions are SDK-54-correct and
no peer-version warning appears (§8.10):

| Package | Version | Why |
|---|---|---|
| `@react-native-async-storage/async-storage` | 2.2.0 | React Native has no `localStorage`; `persistSession: true` is inert without a `storage` adapter (§1b). Works on the web target the repo also builds. |
| `expo-auth-session` | ~7.0.11 | the OAuth web flow, which is what works inside Expo Go and keeps the SDK 54 pin (§1k) |
| `expo-web-browser` | ~15.0.11 | same |
| `expo-linking` | ~8.0.12 | pulled in by `expo-auth-session` for redirect construction |

**`expo-secure-store` was considered and not chosen.** It encrypts at rest, which
is better, but its ~2048-byte per-item limit can be exceeded by a Supabase session,
producing a failure that appears for some users and not others. **The trade-off,
recorded rather than hidden: the session token is stored unencrypted on the
device.** Filed to backlog.

`app/app.json` gains `"scheme": "ductective"` (required for the OAuth callback) and
the `expo-web-browser` plugin, added by `expo install`.
`app/tsconfig.json` gains `allowImportingTsExtensions`, justified in the file.

---

## 3. The contracts Stage 4 builds against

**Stage 4 builds against this section, not against my code, and cannot ask me to
change it.**

### 3.1 The error contract

Every function in `app/lib/accounts.ts` and `app/lib/auth.ts` either resolves with
data or rejects with an **`AccountFailure`**:

```ts
class AccountFailure extends Error {
  code: AccountErrorCode;   // switch on THIS
  detail: string | null;    // context — for sole_owner/last_owner, the company id
  serverHint: string | null;// advisory; the screen owns the final wording
}
```

Nothing returns a bare Supabase error, and nothing returns `null` to mean "failed".
**Never parse a message string** — GoTrue and Postgres change them without notice.

`AccountErrorCode` is a closed union:

| Group | Codes |
|---|---|
| auth | `invalid_credentials` `email_taken` `weak_password` `invalid_email` `email_not_confirmed` `rate_limited` `provider_disabled` `cancelled` `network` |
| company | `not_authenticated` `not_company_owner` `company_name_invalid` `last_owner` `sole_owner_of_company` `join_code_unknown` `join_code_expired` `join_code_revoked` `join_code_exhausted` `already_a_member` `auth_delete_unavailable` |
| fallback | `unknown` |

**Unusual and worth stating:** every defined database failure is
`raise exception '<code>' using errcode = 'P0001'`, which PostgREST surfaces as
`{ code: 'P0001', message: '<code>', details, hint }`. So the **message is the
machine-readable code** and `details`/`hint` carry the context. `toAccountError()`
does that translation; screens never see it.

**Three outcomes are NOT errors and must not render as one:**

- `cancelled` — the technician dismissed the OAuth sheet. Resolve silently
  (ST-A04 AC 5).
- `{ status: 'address-in-use' }` from `signUpWithEmail` — a **routing** signal, not
  a failure. Copy: *"That email is already registered. Sign in with your password,
  then link Google or Apple from your profile."*
- `already_a_member` — they are already in the company they tried to join.

`auth_delete_unavailable` is a **deployment gap**, not a user error. It means the
Edge Function fallback is required. Do not show it as a user-facing failure.

### 3.2 Empty and not-found

| Call | Empty result | Meaning |
|---|---|---|
| `listMyMemberships()` | `[]` | **the normal case.** A solo technician has no company and nothing may be gated behind this being non-empty (brief AC 5). |
| `listRoster(id)` | `[]` | you are not a member, or the company is empty. Not an error. |
| `listJoinCodes(id)` | `[]` | you are not an owner. **By policy, not by filter.** |
| `getMyProfile()` | `null` | should be unreachable (the trigger provisions it). Render an empty state, not a crash. |
| `listSessions()` as a guest | `[]` | **always.** The History tab's job for a guest is the disclosure, not a list that will vanish. |

A read that returns zero rows because RLS refused it is **indistinguishable** from
one that returned zero rows because there is nothing there. That is deliberate — a
company is not discoverable by a stranger who guesses its uuid — and the UI must
never try to tell the two apart.

### 3.3 The citation payload — unchanged, and that is the point

`Citation` in `app/lib/supabase.ts` is **byte-for-byte what it was before this
run**: `{ id, source_document, page, claim, ordinal, snippet?, chunk_id?,
verified? }`. `source_document` and `page` are `not null` in `sql/002` and nothing
here relaxes them.

**It is identical on the guest route.** `appendGuestMessage` passes
`source_document`, `page`, `claim` and `snippet` through untouched and synthesises
ids exactly as the persisted path already did at `pending-${i}`. Asserted by
`app/lib/store.guest.test.mjs` — "AC 3: a guest answer carries citations in exactly
the signed-in shape", which fails on an empty `source_document` or a non-positive
page.

### 3.4 The refusal response — unchanged, and distinguishable from an error

A refusal is `Message.kind === 'refusal'`, a **successful** result carrying a body
and citations. An error is a thrown `AccountFailure` or a rejected promise. They
are different types and cannot be confused.

**No code path in this run lets auth state influence a refusal.** `generateReply()`
takes `(input, equipment, documentIds, cancel, photos)` and **no identity
argument** — that is the structural half of ST-A19 AC 4. The behavioural half is
asserted: the guest test generates the same hazard input on both sides of the seam
and requires `kind`, `body` and citation count to be identical.

### 3.5 The OAuth redirect (ST-A01 AC 6)

```
ductective://auth-callback
```

Declared in **exactly two places, which must stay byte-identical**:
`OAUTH_REDIRECT` in `lib/auth-config.mjs` (what the verifier asserts against the
live project) and `OAUTH_REDIRECT` in `app/lib/auth.ts` (what the app sends).
`app/app.json` carries `"scheme": "ductective"`.

**ST-A20 must register this exact string** as the Supabase redirect URL and with
both providers. A mismatch is the classic works-on-web-fails-on-device bug, which
is why `verify:auth` has a dedicated check for it that fails separately from
"provider is broken".

### 3.6 The pairing rule, in code

`SIGN_IN_PROVIDERS` in `app/lib/auth.ts` is `['apple', 'google']`, ordered, Apple
first. **Render the sign-in screen from this constant.** ST-A04 AC 2's static test
must fail the build if a Google action appears without an Apple one — failing a
build is much cheaper than failing an App Review.

### 3.7 The auth state machine

```ts
type AuthPhase = 'determining' | 'guest' | 'signed-in';
```

`startAuth({ onResolved, onSignedIn, onSignedOut })` returns an **unsubscribe
function — call it on unmount** (ST-A02 AC 6). Feed its callbacks into
`nextAuthState`. Render `isDetermining(state)` as a loading state, **never** as
guest. `state.justSignedIn` is true for exactly one transition (guest →
signed-in) and is what tells the transcript to draw its *saved from here* marker;
call `boundary-acknowledged` once you have drawn it. A token refresh is not a
sign-in and never re-marks.

`setStoreAuth(signedIn)` is called by `startAuth` and by nothing else. The store
defaults to **guest**, so forgetting it loses data rather than leaking it — of the
two ways to be wrong, that is the recoverable one.

---

## 4. The exact SQL the owner must run, in order

Copy each file into the Supabase SQL Editor and run it. **Read the header of each
before running it.** Nothing here can be run by an agent.

| # | File | When | Read first because |
|---|---|---|---|
| 0 | `sql/probe_auth_delete_capability.sql` | **now** — before anything | It answers §8.4's question and decides which half of `014` ships. Deletes nothing, drops itself. **Paste the two returned values back.** |
| 1 | `sql/010_profiles.sql` | **now** — safe during the ingest | Purely additive. Creates `profiles`, the auto-provision trigger, and backfills existing users. |
| 2 | `sql/011_session_rls_cutover.sql` | **only when the auth build is on the phone** | **DESTROYS DATA.** Read STEP 0 and STEP 1 before running. It stops any app build without auth from working the moment it lands. |
| 3 | `sql/012_companies.sql` | after 011 | Adds `sessions.company_id`; brief lock on `sessions`, none on ingest tables. |
| 4 | `sql/013_join_codes.sql` | after 012 | Additive. |
| 5 | `sql/014_account_deletion.sql` | after 012 | Additive (functions only). |

**Before step 2, decide ST-A14.** `sql/011` opens with a count-first query:

```sql
select count(*) as ownerless_sessions from public.sessions where user_id is null;
```

Expected: **4.** These are prototype rows created before accounts existed — mock
diagnostic content typed during design work. The file then offers, clearly
labelled and in this order: **(a)** an optional, commented-out *claim to this
uuid* block, and **(b)** the **default, uncommented `delete`**, which cascades to
messages and citations. There is no undo. Announced deletion of mock prototype
rows is fine; silent data loss is not, which is why the count comes first.

> **Note on the count.** An early revision of `verify-accounts.mjs` left one extra
> ownerless row behind on 10 Aug 2026. It has been swept and the count is back to
> 4; the script now sweeps its own probe rows on every run, including on failure.

After each step, run the `-- Verify` block at the bottom of the file. After step 5:

```bash
npm run verify:auth        # ST-A01
npm run measure:authdelete # confirms path (A) or names path (B)
npm run verify:sessions    # ST-A05 AC 7 — all seven original checks
npm run verify:accounts    # every NEGATIVE criterion, anon key + real JWTs
```

**And two dashboard clicks that need no Apple account** (H9):
Authentication → Sign In / Providers → Email → turn **OFF** "Confirm email"; and
Authentication → URL Configuration → add `ductective://auth-callback` to Redirect
URLs. Leave "Allow anonymous sign-ins" **off** — it already is, and it must stay
that way.

### 4.1 The rollback, and what it does not do (ST-A05 AC 9)

`sql/011` carries an executable, commented rollback block that drops the three
owner-keyed policies, drops `NOT NULL`, drops the default and the FK, re-grants
`anon`, and recreates the three `prototype_*_anon` policies.

**It has NOT been rehearsed.** ST-A05 AC 9 requires it to be executed once against
a scratch project and the result recorded. An agent cannot run SQL, and there is
no scratch project in this account. **Reported as BLOCKED**, not as done — an
untested rollback is fiction, and claiming otherwise would be the worse defect.

It also does not restore data: the rows deleted in STEP 1b are gone, and rolling
back the database alone is not rolling back the release — `store.ts` would need
its two `.is('user_id', null)` filters back or the history list reads other
people's rows. The file says all of this in the block.

---

## 5. The release sequence

**Hard constraint 5: do not break the device build. `main` is never left broken by
this branch, and here is the argument, not the assurance.**

Every app-side change in this PR is **safe against the un-migrated database**:

| Change | Pre-migration behaviour |
|---|---|
| Removing `.is('user_id', null)` from `listSessions` | **Still correct.** The `prototype_sessions_anon` policy is `using (user_id is null)`, so the database applies the same filter. The client-side one was redundant even before the cutover. |
| `createSession` inserting with no `user_id` | Unchanged — it never sent one. |
| `persistSession: true` + storage adapter | Additive. No session exists yet; nothing regresses. |
| Guest/persisted dispatch | Nobody can sign in yet (H9: confirmation is ON), so the store stays in guest. |
| `sql/010`–`014` | Files on disk. Applied by hand, separately. |

**The one deliberate behaviour change**, which is a decision and not an accident
(§5.2): once this ships, a **guest writes nothing**, where today's prototype
persists for an unauthenticated user. That is OQ-A4, chosen knowingly by the
owner. It is not a regression and should not be read as one later.

### The order

1. **Now.** Merge this PR. `main` still works: guests get real cited answers; the
   database is untouched.
2. **Now.** Owner: run the probe (`sql/probe_…`), then `sql/010`. Both safe during
   the ingest.
3. **Now.** Owner: flip the two dashboard toggles (H9). Email sign-in starts
   working end to end at this point.
4. **Stage 4.** Frontend builds the sign-in / guest-disclosure / company / profile
   / deletion screens against §3 of this document.
5. **The knot — one release.** Load the auth-carrying build onto the test phone,
   confirm sign-in works **on the device**, *then* run `sql/011`. Not before. The
   migration file says so at the top, in the house voice.
6. **After the device is verified working:** `sql/012`, `sql/013`, `sql/014`.
7. **Whenever ST-A20 lands:** enable Apple and Google in the dashboard. No code
   change — the wiring already ships. `npm run verify:auth` goes from 3 FAILs to
   green.

---

## 6. Rails status, honestly

Run on branch `stage/backend-accounts` in the agent worktree, 10 Aug 2026.

| Command | Baseline (`main`) | This branch | Verdict |
|---|---|---|---|
| `npm run lint` | exit 0 · **0 errors, 0 warnings** | exit 0 · **0 errors, 0 warnings** | ✅ **no new warnings** |
| `npm run build` (`tsc --noEmit`) | exit 0, clean | exit 0, clean | ✅ |
| `npm test` | 304 tests, **304 pass** | **339 tests, 338 pass, 1 fail** | ⚠️ see below — **not a regression** |
| `npm run verify:secrets` | exit 0 | exit 0 · 224 files, 179 commits, no finding | ✅ |
| `npm run verify:bundle` | **FAILS on untouched `main`** | fails identically | ⚠️ **pre-existing**, see below |
| `npm run verify:bundle -- --reuse` | — | exit 0 · **no server-side key, key-shaped string, or server-only name in the bundle** | ✅ |
| `npm run verify:sessions` | exit 0 (7 checks) | exit 0 · **all 7 checks + the new real-account sign-in** | ✅ |
| `npm run verify:auth` | (new) | **exit 1 — 3 of 8 checks FAIL** | 🔴 H9 + ST-A20, see §8 |
| `npm run verify:accounts` | (new) | **exit 0 — 9 BLOCKED, 0 FAIL** | ⏸ migrations not applied |
| `npm run measure:linking` | (new) | exit 0, measurements in §1.2 | ✅ |
| `npm run measure:authdelete` | (new) | exit 0, 1 measured + 1 BLOCKED | ⏸ §1.1 |

### The one failing test is a worktree artifact, and I checked

`ingest/reconcile.scope.test.mjs` fails with
`ENOENT: no such file or directory, scandir '…/HVAC Data'`. `HVAC Data/` is
gitignored source PDFs and is absent from every agent worktree.

**Verified, not assumed:** `npm test` in the shared checkout is **304 tests, 304
pass, 0 fail** — including that file. The worktree baseline before any of my
changes was **299 tests, 298 pass, 1 fail** (the same file). 299 + 40 new = 339.
The arithmetic closes and nothing I wrote broke anything. After merge, the shared
checkout should read **344 tests, 344 pass**.

### `verify:bundle` fails on `main` too — pre-existing, and routed

`npm run verify:bundle` prints `Export failed — nothing to scan` with **no output
from the export itself**, both on my branch and on the untouched shared checkout.
Running the same export by hand from `app/` **succeeds** and produces a 1.43 MB
bundle. So the defect is in how `scripts/verify-bundle.mjs` spawns `npx.cmd`, not
in the build or in anything this run changed.

I did not fix it: it belongs to the rails, not to an accounts story, and fixing a
spawn blind is riskier than reporting it. **Routed to Stage 5.** The *substance*
of ST-A16 AC 5 is nevertheless verified — I exported by hand and ran
`verify:bundle -- --reuse` against the artifact, with all four new dependencies in
it, and it is clean.

---

## 7. How to verify each acceptance criterion

Brief AC → how. **BLOCKED means "cannot be verified until the owner runs the SQL",
which is neither PASS nor FAIL.**

| Brief AC | How to verify | Status now |
|---|---|---|
| **1** — sign up / out / in, history intact, **on the device** | Human, ST-A17 AC 5. Machine support: `npm run verify:sessions` | **BLOCKED** — H9 (confirmation ON) and the migrations |
| **2** — only own sessions; negative, **anon key + B's token** | `npm run verify:accounts` → the "ST-A05" section, six negative assertions | **BLOCKED** on `sql/011`. The script reports BLOCKED, not FAIL, because before the cutover the prototype policy is still in force and there is nothing to isolate yet |
| **3** — create a company, a second user joins, role readable + policy-enforced | `verify:accounts` → "ST-A07 / ST-A09" | **BLOCKED** on `sql/012`/`013` |
| **4** — admin removes a member, access lost **immediately**, token-level | `verify:accounts` → the removal block. **It reuses the token B held before removal and never signs B in again** — the only construction that proves immediacy (§1f) | **BLOCKED** on `sql/012` |
| **5** — solo user, full use, no dead ends | Machine: no policy on `sessions`/`messages`/`citations`/`profiles` requires a membership — grep `sql/010`–`014`; the only `memberships` reference is the additive `is_co_member` read. Human: ST-A13 AC 6 | **partly verifiable now** by grep; the rest is Stage 4/5 |
| **6** — in-app deletion, defined fate for sessions and a solely-owned company | `verify:accounts` → "ST-A12". Sole-owner-with-members raises `sole_owner_of_company` and deletes **nothing** | **BLOCKED** on `sql/014` + the probe |
| **7** — `user_id is null` rows disposed, no orphans | `sql/011` STEP 0 count (expect 4) → STEP 1b delete → the verify block. Then `verify:accounts` reports "no ownerless sessions" | **BLOCKED** on `sql/011` |
| **8** — lint/build/test exit 0, no new warnings | §6. Lint and build green; test green modulo the worktree artifact | ✅ (see §6) |
| **9** — no secret leaves the server | `npm run verify:secrets` (green) and `verify:bundle -- --reuse` (green). `SUPABASE_SERVICE_ROLE_KEY` appears nowhere under `app/` | ✅ |

### The two domain rules

- **Cite every claim.** The citation payload is unchanged and identical on both
  answer routes (§3.3), asserted in `app/lib/store.guest.test.mjs`. No migration
  relaxes `source_document not null` or `page not null check (page > 0)`.
- **Advise-only, with hard refusals.** `generateReply()` takes no identity
  argument, so no auth state can reach the gate. Asserted structurally (signature)
  and behaviourally (identical verdicts across the seam). The gate itself,
  `lib/safety.mjs`, is **untouched** by this run.

---

## 8. BLOCKED

| # | What | Why | What unblocks it |
|---|---|---|---|
| B1 | **Every criterion that needs a migration** — brief AC 2, 3, 4, 6, 7 | An agent cannot apply SQL; the owner runs it by hand | §4's ordered list |
| B2 | **ST-A12's path (A)/(B) decision** | Needs DDL | One paste of `sql/probe_auth_delete_capability.sql`. Both entry points already exist, so it selects rather than reworks |
| B3 | **`sql/011`'s rollback rehearsal** (ST-A05 AC 9) | Needs a scratch project and DDL | Owner runs the commented block once against a scratch project and records the result. **Not claimed as done** |
| B4 | **ST-A20 — Apple and Google** | Human-owned, external lead time, not started | Enrolment → Services ID + `.p8` → Google client. **Measured: both providers report not-enabled today.** Wiring already ships; enabling is a dashboard change with no code change |
| B5 | **ST-A04's OAuth half, end to end** | Depends on B4 | As B4. `signInWithProvider()` currently rejects with `provider_disabled`, which is honest |
| B6 | **Brief AC 1 on the device** | H9: confirmation is ON, so `signUp` hits the mailer's rate limit | One dashboard click, then the device pass (ST-A17) |
| B7 | **`npm run verify:bundle` (the export step)** | Pre-existing; fails identically on untouched `main` | Stage 5. `--reuse` works and the bundle is clean |

**No story was stubbed or faked to get around any of these.** ST-A20 in particular
is left visibly blocked rather than papered over: `verify:auth` reports it as three
FAILs naming the exact dashboard panel.

**No `CONTRACT MISMATCH` and no `BLOCKED ON KNOWLEDGE`.** Stage 2.5 correctly had
nothing to do in this run; nothing here consumes the retrieval contract.

---

## 9. OPEN QUESTIONS and the defaults taken

Per `CLAUDE.md`: recorded with a proposed default, and proceeded on the default.
None of these re-opens a **RESOLVED BY OWNER** decision.

**OQ-B1 · `trade_role` vocabulary.**
The stories never define one. **Default taken: free text, 1–60 characters after
trim, enforced by a `check` constraint** — no enum, no fixed list. "Service
Technician", "Refrigeration Tech", "Apprentice" and "Owner/Operator" are all real
answers, and any list guessed at today will be wrong for somebody in beta.
Widening a length check later costs nothing; migrating off a wrong enum costs a
migration. Matches §1h's `text` + `check` convention.

**OQ-B2 · How the roster's column narrowing is achieved.**
ST-A03 AC 6 asks that a co-member may see `display_name` and `trade_role` "only".
RLS is row-level and cannot restrict columns. **Default taken: a row-level policy
gated on `is_co_member(id)`, plus a `security_invoker` view
`public.company_roster` exposing exactly `company_id, user_id, role, joined_at,
display_name, trade_role`.** The policy is what the negative test asserts; the view
is what the app reads and what the column guarantee actually rests on. The residual
exposure is `active_company_id`, `created_at` and `updated_at` on a co-member's
profile row if read directly — none of which says anything about what a technician
asked, so OQ-A1 is intact.

**OQ-B3 · Whether the last-owner guard is a trigger or an RPC.**
ST-A08 AC 3 explicitly leaves the choice to Stage 3 and asks it to be stated.
**Chosen: a `before update or delete` trigger on `memberships`.** It covers every
path into the table — the owner's `delete`, a member leaving, a role change, and a
future RPC nobody has written yet — where an RPC-only guard covers only the paths
that remember to call it.

**OQ-B4 · The join-code generator lives in SQL, with a JS mirror.**
ST-A09 AC 2 asks for a unit test over "the generator" and AC 4 puts redemption in
an RPC. **Chosen: the authoritative generator is `public.generate_join_code()` in
`sql/013`**, so a company owner cannot choose a weak code. `lib/join-code.mjs` is
the shared **shape rule** plus a JS generator used for the 10,000-sample
distribution test. The drift risk is real and is closed by `verify:accounts`, which
runs the JS validator against a code the **RPC actually issued** — if the two
alphabets ever diverge, that check goes red.
Also: `sql/013` uses `random()`, not `gen_random_bytes`, because pgcrypto is not
installed on this project and adding an extension for a join code is not a trade
worth making. 50 bits, a 14-day expiry, a use limit, and an unreadable table are
what carry the security argument; brute force is bounded, not rate-limited, and
that is filed to backlog.

**OQ-B5 · The scratch-email domain.**
`verify:auth` and `verify:accounts` need throwaway addresses, and this project's
Supabase Auth **validates the domain** — both `@example.com` and an invented
`.dev` domain were refused with `Email address "…" is invalid`. **Default taken:
`gmail.com`, overridable via `DUCTECTIVE_SCRATCH_EMAIL_DOMAIN`,** with a random
local part, no mail sent once confirmation is off, and every account deleted in the
same run. A domain the project owns is the right answer and is filed as H14.

**OQ-B6 · The Edge Function is documented, not written.**
If the probe returns `CANNOT_DELETE`, path (B) needs a `delete-account` Edge
Function. **Default taken: not written in this run.** It needs a Supabase CLI login
and a deploy step (SETUP-BLOCKERS H4/H5), both Human-owned and both currently
deferred by decision — and writing Deno source that cannot be run, typechecked or
deployed would be exactly the v1 failure SETUP-BLOCKERS opens by describing
("compiling is not running"). `sql/014` already splits `delete_own_account_data()`
out, so the function is ~20 lines against a contract that already exists.

---

## 10. Deferred to Frontend

Backend stops at the seam. Everything below is Stage 4's, and §3 above is the
contract for all of it.

| Story | What Frontend builds | Against |
|---|---|---|
| ST-A04 | The sign-in screen: Apple, Google, email+password, **and "Continue without an account"**. Render from `SIGN_IN_PROVIDERS` (Apple first). Map `AccountErrorCode` to copy. The `address-in-use` route needs the OQ-A9 copy (§1.2). | §3.1, §3.6 |
| ST-A06 | The disclosures. **Before the first answer**, not after: nothing is saved while signed out, and closing the app loses the conversation. Not softened into "sign in to save" — the user needs to know what is *lost*. Plus the History empty state with a working sign-in action, and the *saved from here* boundary marker driven by `state.justSignedIn`. | §3.7, `store.ts` |
| ST-A10 | Create company, roster, join-code entry, owner actions. Owner-only UI is **cosmetic** — ST-A08's policies are the enforcement, and no AC may treat hidden UI as security. | `accounts.ts`, §3.1, §3.2 |
| ST-A11 | Profile screen; `display_name`/`trade_role`; linked providers via `linkedProviders()`; the Private Relay disclosure; sign-out. **Fully usable with no company** — no empty company card, no "create a company to continue". | `accounts.ts`, `auth.ts` |
| ST-A12 | The deletion flow: explicit confirmation, what is destroyed, irreversible. On `sole_owner_of_company`, read the company id from `error.detail` and offer the two paths the user can complete alone. Absent entirely for a guest. | §3.1 |
| ST-A13 | No dead ends. Nothing conditioned on `active_company_id` being non-null outside the company screens. | — |
| ST-A18 | The privacy copy on the join and create screens **and** on the company screen for existing members. Above the fold, not collapsible. | OQ-A1 |
| — | The app shell: call `startAuth`, **unsubscribe on unmount**, render `determining` as a loading state, and never call the store while determining. | §3.7 |

**What Frontend must not do:** add a `where user_id = …` and treat it as
isolation; hide a company action and treat that as enforcement; render a refusal
through anything but the refusal component; or show `auth_delete_unavailable` as a
user error.

---

**Stage 3 complete.** Five migrations, six app modules, six rails scripts, 40 new
tests, and two measurements — one answered, one reduced to a single paste that can
no longer change the shape of the story it belongs to. Nothing was applied to the
database, nothing touched the ingest, and no safety, citation or secrets guarantee
was weakened to make an identity story simpler.
