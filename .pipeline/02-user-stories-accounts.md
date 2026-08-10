# 02 — User stories · Accounts, user profiles & company profiles

Stage 2 artifact for `.pipeline/00-brief-accounts.md`.

> **This is not Run B.** `.pipeline/00-brief.md` and `.pipeline/02-user-stories.md`
> belong to Run B (the diagnostic core) and are untouched by this file. Stages 3–5.5
> reading *this* run take `.pipeline/00-brief-accounts.md` as the brief and this file
> as the story set. Story ids here are `ST-A**` so they can never collide with Run B's
> `ST-**`.

> **Revised 10 Aug 2026 — the owner has answered the open questions.** §2 now records
> **decisions**, not proposed defaults. Two were confirmed as proposed (OQ-A1, OQ-A3) and
> **two were overturned** (OQ-A4 guest path, OQ-A7 sign-in methods). The overturns are not
> cosmetic: ST-A06 is rewritten from its premise up, ST-A01/ST-A04/ST-A05 change, ST-A20
> is new and is a **schedule gate on the whole run**, and §§4, 5, 7, 8, 9 have all moved.
> Anything the decisions made *harder* is stated in §8 rather than smoothed over.

**Stage 1 did not run for this brief.** §1 records everything I had to establish by
reading code that a research pass would normally have handed downstream stages. It is not
optional reading: four of the items in it (policy recursion, the company-creation
chicken-and-egg, the JWT-revocation nuance, and the persistence seam in §1i) determine
whether ST-A05, ST-A06, ST-A07 and ST-A08 are written correctly or are quietly wrong.

**Two rules from `CLAUDE.md` bind this run and no story below relaxes either.** This run
adds identity *around* the product. It does not touch retrieval, citation anchoring, or
the deterministic safety gate. ST-A19 exists specifically to prove that.

---

## Contents

1. [What research would have handed us (established by reading code)](#1-what-research-would-have-handed-us)
2. [Decisions — resolved by owner, and remaining defaults](#2-decisions--resolved-by-owner-and-remaining-defaults)
3. [Owners](#3-owners)
4. [Sequencing plan — waves](#4-sequencing-plan--waves)
5. [Migration & rollout risk, stated honestly](#5-migration--rollout-risk-stated-honestly)
6. [The stories](#6-the-stories)
7. [Traceability — brief AC → stories](#7-traceability--brief-ac--stories)
8. [Criteria flagged as at-risk, human-only, or contested](#8-criteria-flagged-as-at-risk-human-only-or-contested)
9. [Deliberately not built in this run](#9-deliberately-not-built-in-this-run)

---

## 1. What research would have handed us

Established by reading the working tree on 10 Aug 2026. Cited to file and line so a
later stage can re-check rather than re-derive.

### 1a. The blast radius is two files

`sessions` / `messages` / `citations` are touched by **exactly two** files in the whole
repo:

- `app/lib/store.ts` — every app read and write.
- `scripts/verify-sessions.mjs` — the anon-key data-path verifier.

Both currently depend on the prototype predicate:

- `app/lib/store.ts:39` and `:58` — `listSessions()` filters `.is('user_id', null)` on
  both the enriched read and its fallback. After the cutover this filter returns **zero
  rows for every signed-in user**. It must be deleted, not adapted.
- `app/lib/store.ts:82` — `createSession()` inserts with **no `user_id`**. See §1d for
  why that is a feature, not a bug.
- `app/lib/store.ts:72-73` — a comment asserting `for all` on `user_id is null` permits
  DELETE. That comment goes stale at cutover and must be rewritten, not left.
- `scripts/verify-sessions.mjs:26` — builds an anon client with **no sign-in at all** and
  inserts rows. Post-cutover this script fails at check 2 unless it authenticates as a
  **real account** first (OQ-A4 removed the anonymous option). It is wired into
  `npm run verify:sessions`, so it is a rails regression if it is not updated in the same PR.

No server-side code (`scripts/serve.mjs`, `ingest/`, `lib/`) reads or writes these three
tables. There is no service-role writer to keep in sync. That is a significant
simplification and it should be stated so Stage 3 does not go looking for one.

### 1b. The client has no session storage, and fixing that is a new dependency

`app/lib/supabase.ts:17-19` constructs the one client with
`{ auth: { persistSession: false } }` and no storage adapter. React Native has no
`localStorage`, so `persistSession: true` alone does nothing: supabase-js needs an
explicit `auth.storage` adapter on native. `app/package.json` contains **no** storage
package — not `@react-native-async-storage/async-storage`, not `expo-secure-store`.

So brief scope item "session persistence across app restarts" **requires adding a
dependency**, which `CLAUDE.md` says must be justified in the artifact. It is justified
in ST-A02, with the SecureStore-vs-AsyncStorage trade-off recorded there rather than
decided silently.

The same client is used on web (`npm run app` → `expo start --web`), so whatever is
chosen must not break the web target — which is an argument for the platform-agnostic
option.

### 1c. Policies that reference `memberships` from `memberships` will recurse

This is the single most common way a Supabase org model ships broken. A policy on
`public.memberships` whose `USING` clause contains `select … from memberships …`
re-enters the same policy and Postgres raises `infinite recursion detected in policy for
relation "memberships"` — at runtime, for real users, not at migration time.

The fix is `SECURITY DEFINER` helper functions (`public.is_member(uuid)`,
`public.is_company_owner(uuid)`) that read `memberships` with RLS bypassed for that
lookup only, `set search_path = public`, `revoke execute … from public, anon`,
`grant execute … to authenticated`. Every company-side policy in ST-A07/ST-A08/ST-A09
calls those helpers instead of sub-selecting the table. **Stage 3 must not "simplify"
this away.**

### 1d. `default auth.uid()` keeps the app diff to a deletion

`store.ts` inserts sessions without `user_id`. If the migration sets
`alter column user_id set default auth.uid()`, that insert keeps working unchanged and
the row is stamped by the database, while `with check (user_id = auth.uid())` still makes
it impossible to forge one. The only app change needed in `store.ts` is *removing* the
two `.is('user_id', null)` filters. Smaller diff, and the ownership stamp stops depending
on the client remembering to send it — which is exactly the posture hard constraint 3
demands.

### 1e. Creating a company is a chicken-and-egg under RLS

A sane `companies` insert policy is "you may insert a company you will own", and a sane
`memberships` insert policy is "only an owner of that company may add members". Together
they make the first company uncreatable: the company row cannot exist for the membership
to point at, and the membership cannot exist to authorize the company. Every workaround
that loosens one of the two policies opens a hole.

The correct shape is a `SECURITY DEFINER` RPC `public.create_company(name text)` that
inserts both rows in one transaction and returns the company id, with direct INSERT on
`companies` granted to nobody. ST-A07 is written that way.

### 1f. Removing a member is immediate even though their JWT is not revoked

Supabase access tokens are bearer JWTs with a default 1-hour life and **cannot be
revoked mid-flight**. If any story's isolation depended on token revocation, brief AC 4's
word "immediately" would be unachievable.

It does not, and the reason is worth writing down: our company policies join to
`memberships` **at query time**. The removed member's stale token still *authenticates*
(their `auth.uid()` is still valid) but it *authorizes* nothing, because the membership
row it depends on is gone. Access ends on the very next request.

This dictates the shape of ST-A08's negative test: **reuse the token B already holds,
issued before removal. Do not sign B in again.** A test that re-authenticates proves
nothing about immediacy.

### 1g. Deleting the auth user needs privilege the app must never hold

`auth.admin.deleteUser` requires the service-role key, which `scripts/sync-app-env.mjs:34`
structurally withholds from `app/.env` (only `EXPO_PUBLIC_*` is copied) and
`lib/secrets.mjs:51-56` lists as `SERVER_ONLY`. Hard constraint 2 forbids moving it.

Two ways to satisfy Apple's in-app deletion requirement without breaking that:

- **(A) `SECURITY DEFINER` RPC** owned by `postgres` that deletes app rows and then
  `delete from auth.users where id = auth.uid()`. No new hosting, no new deploy surface,
  no key anywhere near the bundle.
- **(B) A Supabase Edge Function** holding the service-role key as a function secret.
  Correct, but adds a CLI login, a deploy step, and a Human-owned setup task.

ST-A12 takes (A) as the default and names (B) as the pre-planned fallback, because the
permissions a `SECURITY DEFINER` function has over the `auth` schema are Supabase's to
change and have changed before. This is the run's highest *technical* risk — see §8.

### 1h. Repo conventions the stories inherit

- Migrations: `sql/NNN_name.sql`, numbered, guarded (`create table if not exists`,
  `drop policy if exists`), re-runnable, **run by hand by the owner in the Supabase SQL
  Editor** — there is no migration runner. Next free number is **010**.
- Enumerations are `text` + `check (… in (…))`, per `messages.kind`
  (`sql/002_prototype_sessions.sql:39`) — not a Postgres enum. New role and status
  columns follow that, because widening a check constraint is cheaper than altering a type.
- `npm test` is `node --test` from the repo root; Node skips `node_modules`, so new
  `*.test.mjs` files anywhere in tracked source are picked up automatically.
  `npm run build` is `tsc --noEmit` inside `app/`. `npm run lint` is `eslint .` at root.
- The Stage 5 harness (`tests/harness.mjs`, `tests/run-all.mjs`) has first-class
  `BLOCKED` and `HUMAN-ONLY` verdicts and `tests/run-all.mjs:184` states plainly that a
  criterion not mechanically executed is **never** reported as PASS. Every human-only AC
  below is written to land in that bucket rather than being dressed up as automatable.
- Anon-key-with-RLS verification already has a house pattern:
  `scripts/verify-sessions.mjs` header — "Verifying this with service_role would prove
  nothing, because service_role bypasses RLS entirely." ST-A15 extends that pattern; it
  does not invent one.
- Visual work uses `app/theme/tokens.ts` and the shipped brand assets. `CLAUDE.md` makes
  those the source of truth; ST-A04/ST-A10/ST-A11 may not introduce a parallel style.
  Note `app/components/Chrome.tsx:9-11` deliberately dropped the mockup's Settings tab as
  "an empty tab is the dead end E6.6 forbids" — this run is what finally gives that tab
  content, so reinstating it is a considered reversal, not a drive-by.
- **The SDK 54 pin is a pin to one phone.** `app/AGENTS.md:5-16`: the project was moved
  *back* from SDK 57 to 54 so it runs in the Expo Go on the test iPhone, which "tops out
  at SDK 54 and the App Store offers it no update". It also says the constraint disappears
  entirely with a development build. OQ-A7 collides with this head-on — see §1j.

### 1i. The persistence seam runs through six call sites in two screens

Needed to scope the guest path honestly (OQ-A4), because "nothing is saved" is a frontend
architecture change, not a flag:

- `app/screens/ChatScreen.tsx:18` imports `answerExisting, askQuestion, createSession,
  loadMessages`; calls them at `:105` (load), `:160` (create), `:172` (persist question),
  `:178` and `:283` (generate **and** persist the reply).
- `app/screens/HistoryScreen.tsx:9` imports `listSessions, deleteSession`; calls them at
  `:34` and `:66`.

The critical structural fact: **`answerExisting` fuses generation and persistence.**
`store.ts:165-178` calls the private `generateReply()` and then `appendMessage()` in one
function. A guest route needs the first half without the second, so `store.ts` needs a
seam — the generation half exposed, and the module dispatching on auth state behind the
*same* exported function names, so the two screens change as little as possible. That
honours `CLAUDE.md`'s "prefer extending working code over rewriting it".

Two details that make the in-memory route cheaper than it looks:

- `appendMessage` already fabricates citation ids (`store.ts:129`, `id: pending-${i}`), so
  an in-memory route producing synthetic ids matches behaviour the renderer already sees.
- `requestDiagnosis` (`app/lib/diagnose.ts:146-165`) sends **symptom, equipment,
  documentIds and photos — no conversation history**. So an unsaved transcript costs the
  model nothing in context, and splitting a transcript at sign-in (OQ-A4) costs no answer
  quality. This is load-bearing for the mid-session sign-up decision.

### 1j. `/diagnose` has no Supabase auth, so a guest still gets real cited answers

`app/lib/diagnose.ts:120-133`: the only credential on the diagnose path is the optional
shared `EXPO_PUBLIC_DIAGNOSE_TOKEN` bearer, and the file's own comment says it is "public
by nature — it ships in the client bundle… a gate against casual LAN callers, not a real
credential". `scripts/serve.mjs` is a separate Node process that knows nothing about
Supabase Auth.

**Confirmed consequence for OQ-A4: an unauthenticated guest gets real, live, cited answers
from the real knowledge base.** Guest mode degrades *persistence*, not *quality* — no
citation, refusal, or retrieval behaviour changes for a guest, which is what keeps
`CLAUDE.md`'s two domain rules intact on the guest path. Also confirmed: the server writes
no session rows (§1a), and its instrumentation files are documented in `.env.example:59-61`
as never containing symptom text — so "nothing is persisted" is true end to end, not just
client-side.

### 1k. Sign in with Apple cannot be fully exercised in Expo Go

Native Sign in with Apple needs the app's **own** bundle identifier carrying the SIWA
capability. In Expo Go the running bundle identifier is Expo's, not Ductective's, so a
native SIWA sheet cannot be configured against our Apple Service ID there. Combined with
§1h's SDK 54 pin, this is the sharpest collision the owner's OQ-A7 decision creates, and
it is dealt with explicitly in OQ-A7 and §8.5 rather than discovered in Wave 3.

Also concrete, and a classic source of a permanent data bug: **Apple returns the user's
name only on the very first authorization, ever.** If it is not captured on that first
callback it cannot be retrieved again for that Apple ID. ST-A04 makes capturing it an
acceptance criterion. And **Apple Private Relay** means the email Apple returns may be an
`@privaterelay.appleid.com` alias rather than the user's real address — so "link accounts
by matching email" is not reliable for Apple, which is why OQ-A9 exists.

---

## 2. Decisions — resolved by owner, and remaining defaults

Four questions were **answered by the owner on 7 Aug 2026** and are recorded here as
decisions. The rest remain Stage 2 defaults under `CLAUDE.md`'s "record it, propose a
default, proceed" rule, and are labelled as such. The distinction matters downstream: a
**RESOLVED BY OWNER** item may not be re-opened by a stage agent at all, while a
**DEFAULT** item may be revisited by the owning stage if it records why.

| # | Question | Status |
|---|---|---|
| OQ-A1 | Company sees technicians' jobs? | **RESOLVED BY OWNER — no. Confirmed as proposed.** |
| OQ-A2 | Session ownership shape | DEFAULT (Stage 2) |
| OQ-A3 | Join mechanism | **RESOLVED BY OWNER — join code. Confirmed as proposed.** |
| OQ-A4 | Guest path | **RESOLVED BY OWNER — guest mode, nothing saved. OVERTURNS the Stage 2 default.** |
| OQ-A5 | One company per user, or many | DEFAULT (Stage 2) |
| OQ-A6 | Company / account deletion fate | DEFAULT (Stage 2) |
| OQ-A7 | Sign-in methods | **RESOLVED BY OWNER — email+password, Apple, and Google. OVERTURNS the Stage 2 default.** |
| OQ-A7b | Email confirmation | DEFAULT (Stage 2), now scoped to the email/password path only |
| OQ-A9 | Account linking across providers | DEFAULT (Stage 2) — **new**, created by the OQ-A7 decision |

---

### OQ-A1 — Does a company see its technicians' jobs? · **RESOLVED BY OWNER (7 Aug 2026): NO**

**A company sees its roster. It sees nothing a technician asked, nothing an answer said,
and no session, ever.** The owner confirmed the Stage 2 recommendation. The reasoning
below stood up and is kept because the stories are built on it.

**What a company can see under this decision, exhaustively:**

| Visible to co-members / owners | Not visible to anyone but the technician |
|---|---|
| Company name and profile fields | Session titles |
| Who is a member (`display_name`, `trade_role`) | Session equipment / unit |
| Each member's role and join date | Every message, question, answer, refusal |
| — | Every citation |
| — | Session counts, timestamps, activity, or any aggregate derived from them |

**Why no:**

1. **It is the reversible direction.** Granting company read later is one additive policy
   plus an in-app disclosure. Retracting it after technicians have used the product
   believing their questions were private is not reversible at all — the questions have
   already been read. When one direction is recoverable and the other is not, the
   recoverable one wins.
2. **A diagnostic question is an admission of not knowing.** A technician who believes
   their employer is reading every question asks fewer of them, and asks them later —
   after they have already guessed. That degrades the product's actual job. Ductective's
   value comes from being asked early.
3. **Nobody has agreed to employer visibility.** Building it in and disclosing it in a
   settings screen nobody reads is not consent.
4. **The privacy-disclosure surface stays small.** No aggregation, no dashboards, no
   "manager view" to describe in a privacy nutrition label that E15 does not yet exist to
   write.
5. **The technical argument is a tie, so it does not decide.** Either policy is roughly the
   same amount of SQL. This is a product decision that happens to be expressed in SQL.

**The door stays open at a cost of one column.** ST-A07 adds a nullable
`sessions.company_id` **stamp** — the creator's active company at the moment the session
was created — and **no policy in this run reads it.** Adding it after real beta data
exists is the migration `sql/002`'s own comment was written to warn about. Same
cheap-now / expensive-later reasoning the schema already used for `user_id`.

**Guard rail, now stronger because this is an owner decision rather than a Stage 2
default:** flipping it requires a **signed Stage 0 brief amendment**, dated, and the
in-app disclosure must ship *with* it, before it takes effect — never after. No Stage 3/4
agent may add a company-read policy on `sessions`, `messages` or `citations` under any
circumstance. Three tests hold the line mechanically: ST-A05 AC 5 (a company owner's token
reading a member's session returns zero rows), ST-A15 AC 7 (the suite fails if such a
policy appears), and ST-A18 AC 4 (the user-facing privacy copy is coupled to the schema,
so adding the policy without changing the copy turns the suite red).

**Consequence for brief AC 4** — see §8.2. The company-scoped access surface is the
company row, the roster and the admin RPCs, *not* session data, so that is what AC 4's
test asserts the removal of.

---

### OQ-A2 — Does a session belong to the user, the company, or both? · DEFAULT (Stage 2)

**The user owns it, with a company stamp that grants nothing.**

`sessions.user_id` (NOT NULL, `default auth.uid()`) is the sole basis of access.
`sessions.company_id` is a nullable historical stamp: which company the technician was
working under when the session was created. It is set by trigger from
`profiles.active_company_id` at insert time and **never re-derived**.

- Leaving a company does **not** un-stamp past sessions; joining one does **not** stamp
  past sessions. The stamp is a fact about the past.
- `company_id` is `on delete set null`. Deleting a company never deletes a technician's work.

---

### OQ-A3 — Join mechanism · **RESOLVED BY OWNER (7 Aug 2026): JOIN CODE**

An owner generates a code; the joining technician types it. Confirmed as proposed. The
alternatives were rejected for reasons that still hold and are recorded so they are not
re-argued:

- **Email invite** needs deliverable transactional mail. The repo has no mail provider, no
  template, and no deep-link scheme; Supabase's built-in mailer is rate-limited hard on
  free tier. A vendor and a Human setup task for a feature whose whole job is "a second
  tech gets in".
- **Admin-adds-by-email** needs an email→uid lookup from the client, which is either an
  enumeration oracle over the whole user table or pending-invite rows that leak which
  emails are registered. Both are worse than the problem.
- **Join code** needs no infrastructure, works the way this actually happens on a job —
  the owner reads eight characters down the phone — and is fully testable against the
  database with no mail loop.

Shape: ≥8 characters of Crockford base32 (excludes I/L/O/U, so it survives being read
aloud), ≥40 bits of entropy, `expires_at` default 14 days, `max_uses`, revocable, scoped
to one company. The code table is **not selectable** by anyone except owners of that
company; redemption goes through a `SECURITY DEFINER` RPC, so a code can never be
enumerated by reading rows. Residual risk (online brute force) is named in ST-A09 and
filed to backlog rather than hidden.

---

### OQ-A4 — The guest path · **RESOLVED BY OWNER (7 Aug 2026): GUEST MODE, NOTHING SAVED — OVERTURNS the Stage 2 default**

**Decision: an unauthenticated technician can use the app and get real answers, but
nothing is persisted and nothing migrates on sign-up. The conversation lives in app state
only.**

The Stage 2 default was Supabase **anonymous sign-in** (a real `auth.users` row per
device, whose history carried over on upgrade). **That is now out.** Every trace of it is
removed from the stories: it is not enabled in the dashboard (ST-A01), it is not how
`scripts/verify-sessions.mjs` authenticates (ST-A05), there is no upgrade-preserves-uid
criterion, and no policy anywhere tests `is_anonymous`.

**What "guest" now means, precisely:**

| | Guest | Signed in |
|---|---|---|
| Ask a question, get a cited answer | **Yes — real, live, from the knowledge base** (§1j) | Yes |
| Nameplate capture, coverage, photos, refusals | Yes, unchanged | Yes |
| Rows written to `sessions`/`messages`/`citations` | **None, ever** | Yes |
| History tab | Empty state explaining why, with a sign-in action | Their jobs |
| Work survives closing the app | **No** | Yes |
| Create or join a company | No | Yes |

**Where this is genuinely better — and I do agree with the coordinator's read:**

- **`user_id NOT NULL` becomes unconditionally safe.** With anonymous sign-in there was
  always a live writer that could in principle produce a row; now, after the cutover,
  *the only client that can write is an authenticated one*, so no ownerless row can ever be
  created again. Brief AC 7 stops being a point-in-time cleanup and becomes a permanent
  property. ST-A14 AC 8 asserts exactly that.
- **The `anon` Postgres role can be revoked from these three tables entirely**, rather than
  merely being unable to satisfy a predicate. There is no legitimate unauthenticated read
  or write left to preserve. ST-A05 AC 3 is strengthened accordingly.
- **No guest-account accumulation, no MAU inflation, no cleanup job.** The backlog item
  the anonymous design created is deleted rather than deferred.
- **One less identity state in every policy.** No `is_anonymous` branch anywhere.

**Where this is genuinely harder — scoped honestly (§1i):**

- **`store.ts` currently persists every turn, and `answerExisting` fuses generation with
  persistence** (`store.ts:165-178`). A guest route needs the generation half alone. This
  is real frontend work, not a flag: a seam in `store.ts`, an in-memory implementation, and
  dispatch on auth state behind the same exported names so `ChatScreen` and `HistoryScreen`
  barely change. Six call sites are affected (§1i).
- **`ChatScreen` threads `sessionId` through everything** — `:105` load, `:160` create,
  `:172`/`:178`/`:283` append. The guest route must supply a synthetic in-memory session id
  so the component's existing logic (including the `ownSession` optimistic-turn guard at
  `:162-165` and the `unanswered` retry path at `:276-299`) keeps working rather than being
  rewritten.
- **The retry path must still work unsaved.** `answerUnanswered` regenerates a reply for a
  question that is already stored; in guest mode "already stored" means "already in state".
  The in-memory implementation has to preserve that behaviour or the guest loses the retry
  affordance that exists precisely for flaky rooftop signal.

**The accepted downside, recorded plainly and not softened:** *a guest who closes the app
loses their work.* Not "may lose" — loses. There is no recovery, no cache, no
undo, and no support path, because nothing was written anywhere. A technician who spends
twenty minutes diagnosing a unit as a guest and then background-kills the app has nothing.
**The owner chose this knowingly.** The mitigations are honesty and friction-free sign-in,
not a safety net: ST-A06 AC 6 requires the app to say so before the first answer, and
ST-A06 AC 7 requires the History tab to say so too.

**Two sub-decisions the coordinator asked to be defined:**

1. **What a guest sees on the History tab.** The tab **stays visible** — hiding it changes
   the shell's static `TABS` array (`Chrome.tsx:270-273`) and makes the app's shape depend
   on auth state, which is a bigger change for a worse result. For a guest it renders a
   dedicated empty state: *nothing is saved while you are signed out*, plus a **sign-in
   action**. It is an empty state with a way forward, not a dead end, which is what
   `Chrome.tsx:9-11`'s own reasoning (and E6.6) requires.
2. **An in-progress guest conversation when they sign up mid-session.** The visible
   conversation **stays on screen** and is **not** back-filled into the database. The first
   question asked *after* signing in creates a real persisted session containing only from
   that point, and the transcript is marked at the boundary (*saved from here*). Clearing
   the screen at the moment someone signs up was considered and rejected as punitive —
   destroying visible work to reward creating an account is the wrong lesson. Back-filling
   was rejected because it is exactly the migration the owner ruled out. **This split costs
   nothing in answer quality**, because `requestDiagnosis` sends no conversation history
   (§1i) — the model never saw the earlier turns anyway.

---

### OQ-A5 — One company per user, or many? · DEFAULT (Stage 2)

**The data model permits many; the app uses one at a time.** `memberships` has
`unique (company_id, user_id)` and no constraint limiting a user to one row — a contractor
working for two shops is a real person, and a one-company constraint is a migration to
remove later. `profiles.active_company_id` names the one currently in effect (it is what
stamps new sessions, per OQ-A2). Most users have zero or one, and ST-A10 shows a switcher
only above one membership, so the common case sees no extra chrome.

---

### OQ-A6 — Company deletion, and what happens to members' data · DEFAULT (Stage 2)

- **Company deletion** requires the `owner` role. It deletes the company, all memberships,
  and all join codes. It deletes **no** session, message or citation — those belong to
  users (OQ-A2), and `sessions.company_id` is `on delete set null`. Every ex-member keeps
  their full history and simply has no company.
- **Account deletion** hard-deletes the user: profile, memberships, and all sessions with
  their messages and citations by cascade, then the `auth.users` row. Not soft-deleted, not
  anonymized. Apple requires deletion, there is no billing or audit reason to retain, and
  under OQ-A1 nobody else could see the data anyway.
- **Sole owner of a company with other members:** the RPC **refuses**, transactionally,
  with a defined error, and the UI offers the two paths the user can complete alone —
  promote another member to owner, or delete the company. Auto-promoting the
  longest-tenured member was rejected: it makes someone an administrator without consent.
- **Sole owner of a company with no other members:** the company is deleted with them, same
  transaction, no prompt.

Every path is completable in-app by the user alone, without contacting support, which is
what Apple requires.

---

### OQ-A7 — Sign-in methods · **RESOLVED BY OWNER (7 Aug 2026): EMAIL+PASSWORD, SIGN IN WITH APPLE, AND GOOGLE — OVERTURNS the Stage 2 default**

The Stage 2 default was email+password only, which kept Sign in with Apple untriggered and
E10 out of this run. **That is now out.** The owner chose all three.

**Sign in with Apple is now a compliance requirement with a store-rejection consequence,
not a feature.** Offering Google triggers App Store guideline 4.8; hard constraint 4 in the
brief says so in terms ("If the stories propose Google or any social provider, Apple comes
with it or the app is rejected"). No story may ship Google without Apple, and no stage may
descope Apple to unblock a wave. If Apple slips, **Google slips with it** — that pairing is
now an explicit rule in ST-A04 AC 2 rather than a thing to remember.

**This pulls Human-owned, lead-time work into the run.** ST-A20 is new: Apple Developer
Program enrolment ($99/yr, with identity verification that is not instant), an Apple
Services ID + Sign in with Apple key (`.p8`), a Team ID and Key ID, and Google OAuth client
credentials for web/iOS/Android. `docs/phase1-story-map.md:E10` already warns this
enrolment "has a lead time and Human-owned identity verification, so start it before you
need it". **It is therefore a schedule gate on Wave 1 and is scheduled in Wave 0** (§4), so
it cannot silently block a wave.

**The collision with the SDK 54 pin, stated rather than discovered later (§1h, §1k).**
Native Sign in with Apple needs Ductective's own bundle identifier with the SIWA
capability, which Expo Go cannot provide. So:

- **Beta / this run:** implement Apple and Google via the **OAuth web flow**
  (`expo-auth-session` + `expo-web-browser` with `supabase.auth.signInWithOAuth`). This
  works inside Expo Go and preserves the SDK 54 pin that exists because the test iPhone
  cannot run anything newer. All three methods are genuinely offered, so guideline 4.8 is
  satisfied *in substance*.
- **Before App Store submission:** native `expo-apple-authentication` in a development /
  EAS build, which is E10. Recorded as a **launch blocker** in ST-A16, not as optional
  polish. The residual risk is review friction over a web-sheet Apple sign-in on iOS, not a
  missing feature — that distinction is honest and is stated in §8.5.

**New dependencies this adds:** `expo-auth-session` and `expo-web-browser`, both installed
with `npx expo install` at SDK-54-correct versions, plus `expo-crypto` if the auth-session
implementation requires it for PKCE. All are Expo-Go-compatible, which is the whole reason
for choosing the web flow. `expo-apple-authentication` is **not** added in this run — it
arrives with E10's development build.

**A secrets note that ties to existing rails:** Apple's Sign in with Apple key is a `.p8`
PEM private key. `lib/secrets.mjs:37` already matches
`-----BEGIN (RSA |EC )?PRIVATE KEY-----`, so if it were ever committed,
`npm run verify:secrets` would catch it. It belongs in the Supabase dashboard only —
never in the repo, never in `.env`, never in `app/.env` (which
`scripts/sync-app-env.mjs:34` structurally prevents anyway). ST-A20 AC 6 states this.

---

### OQ-A7b — Email confirmation on sign-up · DEFAULT (Stage 2), retained

**Default retained: OFF for the beta project. Re-enabling it before public release is a
launch blocker.** This now applies **only to the email/password path** — Apple and Google
return verified addresses of their own, so the OAuth paths are unaffected.

With confirmation ON, `signUp` returns no session until a mail round-trip completes, on a
shared free-tier SMTP with a low hourly cap. Brief AC 1 must be provable *on the device*;
gating it behind that mailer makes the acceptance pass flaky for reasons unrelated to the
code.

**Stated honestly:** confirmation OFF means a user can sign up with an email address that
is not theirs, i.e. squat on someone else's. Tolerable for a closed beta with a handful of
known testers. **Not** tolerable at public launch, and it interacts with OQ-A9 — unverified
emails must never be used as a basis for linking identities. ST-A16 files it to backlog
tagged `launch-blocker`.

---

### OQ-A8 — Role vocabulary · DEFAULT (Stage 2)

Not a genuine ambiguity — the brief sets the minimum — but recorded so nobody
re-litigates it. Two roles: **`owner`** (manage membership, generate/revoke join codes,
edit and delete the company) and **`member`** (read the company and its roster; nothing
else). Multiple owners allowed. Stored as `text` with a `check` constraint per §1h, so a
third role is a widened constraint rather than an altered type.

---

### OQ-A9 — Account linking across providers · DEFAULT (Stage 2) — **new, created by the OQ-A7 decision**

**The question the owner's OQ-A7 answer creates:** a technician signs up with
`dave@shop.com` and a password in March, then taps "Continue with Google" in April and
Google returns `dave@shop.com`. One account, or two?

**Default: one account per human, with `email` as the linking key where it can be
trusted — and an honest error rather than a silent duplicate where it cannot.**

1. Where Supabase links identities to an existing user, that is the desired behaviour and
   we adopt it.
2. Where it instead creates a second user, the app must **detect and explain**: *"That
   email is already registered with a password. Sign in that way, then link Google from
   your profile."* A silent duplicate account is the worst outcome — the technician's
   history "disappears" and nothing tells them why. That is the failure this decision
   exists to prevent.
3. **Never link on an unverified email.** With OQ-A7b's confirmation OFF, an
   email/password account's address is unproven; auto-linking a Google identity to it would
   let someone claim an account by registering the address first. So: linking is permitted
   only toward provider-verified addresses, and ST-A04 AC 8 tests exactly this.
4. **Apple Private Relay breaks email-matching by design** (§1k). A user whose Apple
   identity returns `…@privaterelay.appleid.com` **will** get a separate account from their
   `dave@shop.com` password account, and no amount of client logic can join them
   automatically. The app must not pretend otherwise. Accepted, disclosed in the sign-in
   copy, and manual linking from the profile screen is the escape hatch.

**Stage 3 must empirically determine the project's actual linking behaviour before
building the UI**, because outcomes 1 and 2 need different copy and different flows. ST-A04
AC 8 requires the observed behaviour to be recorded in `03-backend.md` — measured, not
assumed from documentation.

---

## 3. Owners

| Owner | Stage | Scope this run |
|---|---|---|
| **Knowledge** | 2.5 | **Nothing to do.** This run adds no documents, chunks, embeddings or provenance. Stage 2.5 should record "nothing to do" and hand off. |
| **Backend** | 3 | Every migration (`sql/010`–`sql/014`), every RPC, every policy, the client auth wiring in `app/lib/`, the guest/in-memory seam in `store.ts`, and the two files in §1a. |
| **Frontend** | 4 | Auth screens for all three methods, profile, company screens, the guest route and its disclosures, the deletion flow, the privacy disclosure copy. |
| **Test** | 5 | The isolation harness and the negative tests. Every "user B cannot read user A" assertion lives here and runs with the **anon key plus a user JWT**. |
| **Eval** | 5.5 | One story only (ST-A19): prove identity did not change what the product *says* — including on the guest path. |
| **Human** | — | **ST-A20** (Apple Developer Program enrolment and provider credentials — the run's schedule gate), ST-A01's dashboard configuration, running the migrations in the SQL Editor, and the on-device acceptance pass (ST-A17). |

---

## 4. Sequencing plan — waves

### Two things now order this run

**1. The Apple/Google credential gate (new, from OQ-A7).** ST-A20 contains an enrolment
with third-party identity verification that neither an agent nor the owner can accelerate.
It is scheduled in **Wave 0** and it gates the sign-in half of Wave 1. Nothing else in the
run depends on it — which is exactly why it must be started first and in parallel, not
picked up when Wave 1 begins.

**2. The cutover knot (unchanged in principle, smaller in membership).** The moment
`sql/011` runs, any app build without auth stops working: `store.ts`'s
`.is('user_id', null)` returns nothing and its inserts are refused. So **ST-A02 (session
persistence), ST-A06 (guest route) and ST-A05 (cutover) must land and release together.**
Note what changed: under the old anonymous-sign-in default the app needed a working
sign-in to function at all; under OQ-A4 the guest route means the app still *answers
questions* even for a user who never signs in. That makes the knot a little safer, and it
means **ST-A04 (sign-in UI) is no longer strictly inside it** — the app is usable without
it. ST-A04 should still ship in the same release if the credentials are ready, because a
cutover build where nothing can be saved by anyone is a poor place to linger.

### Wave 0 — parallel, no dependencies between them

| Story | Owner | Note |
|---|---|---|
| **ST-A20** | **Human** | **Start immediately.** Apple Developer enrolment + Apple/Google credentials. Schedule gate on Wave 1's sign-in half. |
| ST-A01 | Human + Backend | Supabase dashboard config + verifier. Its Apple/Google half is BLOCKED until ST-A20 delivers; its email/password half is not. |
| ST-A02 | Backend | Client persistence + storage adapter. Ships with Wave 1. |
| ST-A03 | Backend | `sql/010` profiles + auto-provision trigger. Touches nothing existing. |
| ST-A15a | Test | Fixture harness (service-role user create/teardown, JWT clients). Buildable before anything it tests exists. |
| ST-A16a | Test | Record the green baseline of lint/build/test/verify:secrets **before** any change, so "no new warnings" has a referent. |

### Wave 1 — the cutover. Serialized after Wave 0. One release.

- **ST-A06** the guest route: the `store.ts` seam, the in-memory implementation, the
  disclosures (needs A02; **does not need A20** — this is the part of the app that works
  with no identity at all, and it should not wait on Apple).
- **ST-A05** the RLS cutover, `sql/011` (needs A01's email/password half, A03, and
  A02+A06 in the same build).
- **ST-A14** prototype-row disposition — same migration file as A05, separate story because
  it is a data-loss decision that deserves its own review.
- **ST-A04** sign-up / sign-in / sign-out for all three methods. **Gated on ST-A20.** If
  ST-A20 has not landed, ST-A04's email/password half may ship and its Apple/Google half
  reports BLOCKED — **but Google may never ship ahead of Apple** (OQ-A7).

Nothing in Wave 2+ starts until Wave 1 is released and the device is verified working.

### Wave 2 — company data model. Serialized on Wave 1; internally partly parallel.

- **ST-A07** `sql/012` companies + memberships + helpers + `create_company` RPC +
  `sessions.company_id` stamp. Blocks the rest of the wave.
- Then, in parallel: **ST-A08** (roles, removal, last-owner guard) and **ST-A09**
  (`sql/013` join codes + `redeem_join_code` RPC).

### Wave 3 — company & profile UI. Parallel with each other, after Wave 2.

- **ST-A10** company screens · **ST-A11** profile screen (now also hosts provider linking,
  per OQ-A9) · **ST-A18** privacy disclosure copy · **ST-A13** the solo-user no-dead-end
  guarantee.

### Wave 4 — deletion. After Waves 2 and 3.

- **ST-A12** `sql/014` `delete_own_account()` + the confirmation flow. Last because it needs
  the company rules (sole-owner) and the profile screen to live in.

### Wave 5 — verification. After everything.

- **ST-A15** the full isolation suite · **ST-A16** rails green · **ST-A19** eval no-change
  attestation (now including the guest path) · **ST-A17** the human device pass.

### What can genuinely run in parallel

Frontend (ST-A04's email half, ST-A10, ST-A11, ST-A18) can be built against the
migrations' *shapes* as soon as those are written and reviewed — it does not need the
migration *run*. ST-A06's `store.ts` seam is pure frontend architecture and needs no
migration at all, so it can start the moment ST-A02 is agreed. Test (ST-A15) builds
fixtures from Wave 0. The truly serial edges are: **ST-A20 → ST-A04's OAuth half**, the
Wave-1 release knot, and **ST-A07 → ST-A08/A09**.

---

## 5. Migration & rollout risk, stated honestly

1. **The old build breaks at cutover.** Any Expo Go client on the test phone running
   pre-auth code stops reading and writing the moment `sql/011` runs. Mitigation: run
   `sql/011` only when the auth-carrying build is loaded on the device, and treat it as a
   release step, not a schema chore. The migration file must say this at the top, in the
   `sql/00*` house voice.
2. **"Keeps working" now has an asterisk, and it is OQ-A4's.** Hard constraint 5 says the
   device build must keep working through the transition. After the cutover it does — a
   guest can still ask questions and get cited answers (§1j) — but **history no longer
   persists until someone signs in.** Today's prototype persists for an anonymous user;
   tomorrow's does not. That is a deliberate, owner-chosen behaviour change, not an
   accident, and the tester should sign in immediately after installing the cutover build.
   Recorded here so it is not read later as a regression nobody noticed.
3. **`sql/011` needs a documented rollback.** Migrations are hand-run with no runner, so the
   file carries a commented block restoring the three `prototype_*_anon` policies and
   dropping `NOT NULL`. Untested rollbacks are fiction; ST-A05 requires the rollback be
   *executed once* against a scratch project and the result recorded.
4. **`user_id is null` rows are destroyed by default.** ST-A14 makes this a first-class
   decision with a count-first query and an optional, clearly-marked "claim to this uuid"
   block the owner may run *instead*. Silent data loss is unacceptable; announced deletion
   of mock prototype rows is fine.
5. **`set not null` fails loudly if the disposition step was skipped.** Intended interlock.
   Order the statements so it cannot be half-applied.
6. **OQ-A4 makes the null-row problem permanent-solved rather than once-solved.** With no
   anonymous sign-in and a guest route that never writes, no unowned row can be created
   after the cutover. `NOT NULL` is unconditionally safe and `anon` can be revoked from all
   three tables outright.
7. **Two migrations, not one.** Profiles (`010`) is additive and safe any time. The cutover
   (`011`) is the dangerous one. Keeping them separate means the risky file is small enough
   to read in full before running it.
8. **`scripts/verify-sessions.mjs` is part of the migration, not a follow-up** — and under
   OQ-A4 it needs a **real** test account, created and torn down via service role, because
   anonymous sign-in is no longer available to it. If it is not updated in the same PR,
   `npm run verify:sessions` goes red and stays red, and per `lib/secrets.mjs:66-72`'s own
   reasoning, a check that is always red is a check nobody reads.
9. **The Apple enrolment can slip the release, and no engineering can compress it.** §4
   places it in Wave 0 for that reason. If it slips past Wave 1, ship the email/password
   half and hold *both* Apple and Google (OQ-A7) — never Google alone.

---

## 6. The stories

Every acceptance criterion is tagged with how it is verified:

- **[M]** machine-verifiable — a named command or test asserts it.
- **[H]** human-only — needs a device, an eye, or a dashboard. Per
  `tests/run-all.mjs:184`, no agent may report these as PASS.
- **[M+H]** has both a machine half and a human half; both are required.

---

### ST-A20 — Apple and Google provider credentials exist *(new — from the OQ-A7 decision)*

**User story:** As the product owner, I want the Apple and Google developer credentials in
hand before the sign-in stories need them, so that a months-long enrolment does not sit
silently on the critical path of a two-week wave.

**Why this is a story and not a checklist item:** `docs/phase1-story-map.md:E10` flags the
Apple enrolment as having lead time and Human-owned identity verification. OQ-A7 made
Sign in with Apple mandatory. That combination is the classic silent blocker.

**Acceptance criteria**

1. **[H]** Apple Developer Program enrolment ($99/yr) is **complete**, including Apple's
   identity verification. Evidence: the Team ID is recorded.
2. **[H]** An Apple **Services ID** is created for Ductective with Sign in with Apple
   enabled, and its return URL is set to the Supabase project's auth callback.
3. **[H]** A Sign in with Apple **key** is generated and its `.p8`, Key ID and Team ID are
   stored in the Supabase dashboard.
4. **[H]** Google OAuth client credentials exist for the flows in use, with the Supabase
   callback registered as an authorized redirect URI.
5. **[M]** `SETUP-BLOCKERS.md` gains an entry for each credential in the file's existing
   format, naming what is blocked without it and — for the Apple enrolment — that it has
   **external lead time** and must be started in Wave 0.
6. **[M]** **No credential is committed.** The `.p8` lives in the Supabase dashboard only.
   Asserted by `npm run verify:secrets` staying green, which already matches PEM private
   keys at `lib/secrets.mjs:37`; and by a check that no `.p8` file is tracked in the repo.
7. **[H]** The owner records the date each item completed, so that if the run slips, §4's
   gate can be shown to be the cause rather than guessed at.

**Owner:** Human
**Dependencies:** none — **start on day one**
**Priority:** Critical (schedule gate)
**Definition of Done:** all credentials in the Supabase dashboard; SETUP-BLOCKERS.md
updated; nothing secret in the repo; dates recorded.

---

### ST-A01 — Supabase Auth is configured for this project

**User story:** As the product owner, I want the Supabase project's auth settings to match
the decisions this run is built on, so that no story downstream fails for a reason that is
a checkbox rather than a defect.

**Acceptance criteria**

1. **[H]** In the Supabase dashboard: email/password provider **enabled**; **Apple provider
   enabled**; **Google provider enabled** (OQ-A7); email confirmation **disabled**
   (OQ-A7b); **anonymous sign-ins DISABLED** — OQ-A4 removed the only reason to have them,
   and leaving them on would create exactly the ownerless-user path the guest decision
   eliminates.
2. **[M]** `node --env-file=.env scripts/verify-auth-config.mjs` exits 0 and prints a PASS
   for each of: `signUp` with a random address returns a **session** (proves confirmation
   is off); `signInAnonymously()` **fails** (proves anonymous is off — the check asserts the
   *absence* of a capability, which is the one that would otherwise rot silently); the Apple
   and Google providers are reachable, asserted by `signInWithOAuth({ skipBrowserRedirect:
   true })` returning a provider authorization URL for each rather than a
   provider-not-enabled error; the run cleans up any user it created via service role.
3. **[M]** The same script FAILs, with a message naming the exact dashboard toggle, when
   any of the above is misconfigured. Verified by asserting the failure branch in a unit
   test with a stubbed client — a config verifier that cannot report a specific missing
   toggle is not useful.
4. **[M]** `SETUP-BLOCKERS.md` gains an entry for this configuration.
5. **[M]** The script uses `EXPO_PUBLIC_SUPABASE_ANON_KEY` for auth calls and
   `SUPABASE_SERVICE_ROLE_KEY` for cleanup only, and `npm run verify:secrets` stays green.
6. **[M]** The redirect/callback URL scheme used by the OAuth flow is recorded in
   `03-backend.md` and matches what ST-A20 registered — a mismatch here is the single most
   common cause of an OAuth flow that works on web and fails on device.

**Owner:** Human (dashboard) + Backend (the verifier)
**Dependencies:** ST-A20 for the Apple/Google half; the email/password half has none
**Priority:** Critical
**Definition of Done:** dashboard configured; verifier committed and green (or reporting
BLOCKED against ST-A20, never PASS); SETUP-BLOCKERS.md updated.

---

### ST-A02 — The app remembers who you are across restarts

**User story:** As a technician, I want to still be signed in when I open the app the next
morning, so that I am not typing a password on a roof.

**New dependency, justified (per `CLAUDE.md`):** React Native has no `localStorage`;
supabase-js needs an explicit `auth.storage` adapter or `persistSession: true` is inert
(§1b). **Proposed: `@react-native-async-storage/async-storage`**, installed with
`npx expo install` so the version is SDK-54-correct. It is the adapter Supabase's own Expo
guidance uses, and it works on the web target the repo also builds. **`expo-secure-store`
was considered and not chosen:** it encrypts at rest, which is better, but its ~2048-byte
per-item limit can be exceeded by a Supabase session, producing a failure that appears only
for some users. Trade-off recorded rather than hidden: **the session token is stored
unencrypted on device.** Filed to backlog as "evaluate a chunked SecureStore adapter".

**Acceptance criteria**

1. **[M]** `app/lib/supabase.ts` constructs the client with `persistSession: true`,
   `autoRefreshToken: true`, `detectSessionInUrl: false`, and a `storage` adapter. A test in
   the `tests/suites/e6-app.mjs` static-analysis style asserts all four are present and that
   `persistSession: false` no longer appears in `app/`.
2. **[M]** `app/package.json` lists the storage package at an `npx expo install`-resolved
   version; `npm run build` exits 0 with no new errors.
3. **[M]** `npm run lint` exits 0 with no new warnings.
4. **[M]** `npm run verify:bundle` and `npm run verify:secrets` stay green.
5. **[H]** On the test device: sign in, force-quit the app, relaunch — the app opens signed
   in as the same user, with no auth screen.
6. **[M]** An `onAuthStateChange` subscription exists at the app shell and is unsubscribed
   on unmount (asserted statically) — a leaked listener across sign-out/sign-in is how
   stale-user bugs get in.
7. **[M]** The auth state exposed to the app distinguishes three states — **signed in**,
   **guest**, and **still determining** — and the third is not rendered as either of the
   other two. A shell that flashes the guest state for 200ms while the stored session loads
   would show "nothing is saved" to a signed-in user, which is a lie the UI tells at every
   cold start. Asserted by a unit test over the state machine.

**Owner:** Backend
**Dependencies:** ST-A01 (email/password half only)
**Priority:** Critical
**Definition of Done:** client wired; static and state-machine tests committed; rails
green; the [H] criterion recorded in ST-A17's device checklist. **Releases together with
ST-A05/A06.**

---

### ST-A03 — Every user has a profile, created automatically

**User story:** As a technician, I want the app to know my name and trade role, so that it
can address me and so my shop's roster shows a person rather than a uuid.

**Acceptance criteria**

1. **[M]** `sql/010_profiles.sql` exists, is guarded and re-runnable (running it twice
   succeeds), and creates `public.profiles` with at minimum:
   `id uuid primary key references auth.users(id) on delete cascade`, `display_name text`,
   `trade_role text`, `active_company_id uuid` (nullable; FK added in `sql/012`),
   `created_at`, `updated_at`.
2. **[M]** RLS is enabled; a user can `select` and `update` **their own** row, can `insert`
   nothing (rows come from the trigger) and `delete` nothing (deletion is ST-A12's).
3. **[M] NEGATIVE:** with user B's JWT on an **anon-key** client,
   `select * from profiles where id = <A's uuid>` returns **0 rows**, and
   `update profiles set display_name=… where id = <A's uuid>` affects 0 rows. Asserted in
   `scripts/verify-accounts.mjs`.
4. **[M]** A trigger on `auth.users` insert creates the profile row. Verified by: create a
   user via service role, then `select` that profile as that user → exactly 1 row, with
   `display_name` taken from sign-up metadata when present.
5. **[M]** The trigger fires for users created by **every** enabled provider — email/password,
   Apple, and Google — so no code path has to handle a missing profile. Tested per provider
   where a provider user can be simulated; where it cannot, the test asserts the trigger has
   no provider condition in its body (a `where` on `raw_app_meta_data->>'provider'` would be
   the defect).
6. **[M]** A co-member read policy exists and is **exactly** as narrow as OQ-A1 allows: a
   user may select `display_name` and `trade_role` of another user **only** when
   `public.is_co_member(other_id)` is true. Asserted positively (co-members see each other)
   **and negatively** (a non-co-member sees 0 rows).

**Owner:** Backend
**Dependencies:** ST-A01
**Priority:** Critical
**Definition of Done:** migration committed and run; positive and negative assertions in
`scripts/verify-accounts.mjs`.

---

### ST-A04 — Sign up and sign in — email, Apple, and Google

**User story:** As a technician, I want to create an account the way I already sign in to
everything else — Apple, Google, or an email and password — so that getting started takes
one tap and my job history is mine.

**Rewritten from the Stage 2 version by the OQ-A7 decision.** All three methods, with Apple
mandatory alongside Google, via the OAuth **web flow** for this run (OQ-A7).

**Acceptance criteria**

1. **[M+H]** The auth screen offers **all three**: Continue with Apple, Continue with
   Google, and email + password — plus **"Continue without an account"** (ST-A06). **[M]**
   static test: all four actions present, each with `accessibilityRole="button"` and a
   non-empty `accessibilityLabel`; **[H]** it reads correctly on device.
2. **[M] COMPLIANCE — the pairing rule:** a static test asserts that if a Google sign-in
   action is present in the built screen, an Apple sign-in action is present too. **This
   test exists to fail the build rather than fail App Review.** Shipping Google without
   Apple is a guideline 4.8 rejection (brief hard constraint 4), and no stage may descope
   Apple to unblock a wave.
3. **[M]** Apple and Google sign-in use `supabase.auth.signInWithOAuth` through
   `expo-auth-session`/`expo-web-browser`, and the redirect URL matches ST-A01 AC 6. A test
   asserts the configured redirect equals the registered one — a mismatch is the classic
   works-on-web-fails-on-device bug.
4. **[M]** **Apple's name is captured on first authorization.** Apple returns the user's
   full name **only on the very first** authorization for an Apple ID, ever (§1k). The
   sign-in handler persists it to `profiles.display_name` on that first callback. Tested by
   asserting the handler writes the name when present and does **not** overwrite an existing
   non-empty `display_name` on subsequent sign-ins.
5. **[M]** Sign-in failures render an `ErrorState`-family component with specific,
   human-readable copy — wrong password, invalid email, network, **user cancelled the OAuth
   sheet** (which is not an error and must not be shown as one), and provider error. Unit
   test maps at least five outcomes to distinct results, including the cancel path
   resolving silently.
6. **[M]** Every colour, spacing, radius and type value comes from `app/theme/tokens.ts`;
   no raw hex literal in the new screens; all targets ≥ `MIN_TOUCH`. Static tests, matching
   `tests/suites/e6-app.mjs`.
7. **[M]** Sign-out clears the stored session **and** all in-memory session/message state,
   and returns the app to the guest state rather than a blank screen. Test: after sign-out
   `getSession()` is null and the shell's reset function has run.
8. **[M] OQ-A9 — linking behaviour is measured, not assumed.** A test signs up
   `x@example.com` with a password, then completes an OAuth sign-in returning the same
   address, and asserts the **observed** outcome. `03-backend.md` records which of OQ-A9's
   two cases the project exhibits. If it creates a second user, the app must surface the
   OQ-A9 copy — asserted — and must **not** silently strand the first account's history.
9. **[M]** No password, email, or token is ever written to a log line. Static test over the
   new files.
10. **[H]** On device: sign up → ask a question → sign out → sign back in → **the job is
    still in history**. This is brief AC 1 and it is human-verified by design.
11. **[H]** The same round trip via Apple, and via Google, on the device.

**Owner:** Frontend, with Backend for the OAuth wiring
**Dependencies:** ST-A01, ST-A02, **ST-A20 (Apple/Google half)**
**Priority:** Critical
**Definition of Done:** all three methods shipped on brand tokens; the pairing test
committed; OQ-A9's observed behaviour recorded; criteria 10–11 in ST-A17's checklist.

---

### ST-A05 — Sessions are isolated to their owner by policy, not by the client

**User story:** As a technician, I want it to be impossible for anyone else to read my
jobs — including someone holding the app's anon key — so that "private" means enforced
rather than promised.

This is the story the schema in `sql/002` was written to make cheap. It **replaces** the
`user_id is null` predicate; it does not add a policy beside it.

**Acceptance criteria**

1. **[M]** `sql/011_session_rls_cutover.sql` exists, guarded and re-runnable, and: sets
   `sessions.user_id` `default auth.uid()`; disposes of null rows (ST-A14); sets `user_id`
   `NOT NULL`; **drops** `prototype_sessions_anon`, `prototype_messages_anon`,
   `prototype_citations_anon`; creates owner-keyed replacements on all three tables for the
   `authenticated` role only.
2. **[M]** After the migration, `select count(*) from pg_policies where schemaname='public'
   and tablename in ('sessions','messages','citations') and policyname like 'prototype_%'`
   returns **0**. The old predicate is gone, not shadowed.
3. **[M]** **The `anon` role is revoked outright** on all three tables — not merely unable
   to satisfy a predicate. OQ-A4 removed every legitimate unauthenticated read and write
   (the guest route never touches the database at all), so there is nothing left to
   preserve. Asserted two ways: a bare anon client with no sign-in reads **0 rows** and gets
   `42501` on insert, **and** `information_schema.role_table_grants` shows no privilege for
   `anon` on `sessions`, `messages`, `citations`.
4. **[M] NEGATIVE — brief AC 2, the core assertion:** with an **anon-key** client carrying
   **user B's** JWT:
   - `select … from sessions where id = <A's session id>` → **0 rows**;
   - `select … from messages where session_id = <A's session id>` → **0 rows**;
   - `select … from citations` joined to A's message → **0 rows**;
   - `insert into messages (session_id = <A's session id>, …)` → **error**, and A's message
     count is unchanged;
   - `delete from sessions where id = <A's session id>` → affects 0 rows, and the row still
     exists when re-read as A;
   - `update sessions set user_id = <B's uuid> where id = <A's session id>` → affects 0 rows
     (an ownership steal must be impossible, not merely unusual).
   Service role is used **only** to create and tear down fixtures. Any assertion made with
   the service-role client is worthless and is forbidden here.
5. **[M] NEGATIVE — OQ-A1 guard:** the same reads performed with the token of a user who is
   an **owner of A's company** also return **0 rows**. This is the mechanical enforcement of
   the OQ-A1 decision and it must exist even though no company-read policy is being
   written — its job is to go red if someone adds one later.
6. **[M]** `app/lib/store.ts` no longer contains `.is('user_id', null)` (both call sites),
   and its stale comment at `:72-73` is corrected. Static test asserts the string is absent
   from `app/`.
7. **[M]** `scripts/verify-sessions.mjs` authenticates as a **real account** — created and
   torn down via service role, since OQ-A4 removed anonymous sign-in — and
   `npm run verify:sessions` exits 0 against the migrated database with all seven of its
   existing checks still passing, including the cascade-delete and CHECK-constraint checks,
   which must not be weakened to accommodate auth.
8. **[M]** A signed-in user's full lifecycle still works end to end: create session → append
   user message → append answer with citations → read back through the app's join → delete →
   messages cascade.
9. **[M]** The migration file contains an executable, commented rollback block restoring the
   three prototype policies and dropping `NOT NULL`, and `03-backend.md` records that the
   rollback was **run once** against a scratch project and worked.
10. **[M]** `sessions.company_id` is **not** referenced by any policy created here.
    Grep-asserted over the migration.

**Owner:** Backend
**Dependencies:** ST-A01, ST-A03, ST-A14 (same file); must **release with** ST-A02 and
ST-A06
**Priority:** Critical
**Definition of Done:** migration written, reviewed, run by the owner; both app files in
§1a updated in the same PR; negative tests in `scripts/verify-accounts.mjs` and the Stage 5
suite; rollback rehearsed; device build confirmed working before the branch merges.

---

### ST-A06 — Guest mode: real answers, nothing saved *(rewritten — OQ-A4 was overturned)*

**User story:** As a technician who just installed the app on a roof, I want to ask a
question and get a real, cited answer without making an account first — and I want the app
to tell me plainly that nothing I do here is being kept.

**This story's premise is the opposite of the Stage 2 version.** The old story was "your
work survives signing up". The owner chose **guest mode, nothing saved**: no Supabase
anonymous sign-in, no rows, no migration of a guest transcript into an account. What
follows is built on that, including the parts that are harder.

**The architecture, stated so Stage 3/4 do not each invent one (§1i):** `store.ts` gains a
seam. Its generation half (`generateReply`, currently private at `store.ts:180-190`) is
separated from its persistence half (`appendMessage`), and the module dispatches on auth
state behind the **same exported names** — `createSession`, `askQuestion`, `answerExisting`,
`loadMessages`, `listSessions`, `deleteSession` — so `ChatScreen` and `HistoryScreen` change
as little as possible. The guest implementation keeps the transcript in app state, hands out
a synthetic session id so `ChatScreen`'s existing `ownSession` guard (`:162-165`) and
`unanswered` retry path (`:276-299`) keep working, and synthesises citation ids exactly as
`appendMessage` already does at `store.ts:129`.

**Acceptance criteria**

1. **[M] The defining criterion — a guest writes nothing.** With the store in guest mode,
   a full conversation (create → ask → answer with citations → retry an unanswered turn)
   issues **zero** calls to the Supabase client. Asserted by injecting a spy client and
   asserting `from()` is never invoked for `sessions`, `messages` or `citations`. This is
   the machine proof of "nothing is persisted", and it belongs at the seam rather than in a
   screen.
2. **[M]** Corroborated at the database: with service-role row counts taken before and
   after a scripted guest conversation, counts on all three tables are **unchanged**.
   Belt and braces, because AC 1 tests our code and this tests reality.
3. **[M]** **A guest gets real, live, cited answers** — quality is not degraded, only
   persistence (§1j). Asserted by driving the guest route against the live `/diagnose` and
   checking the reply carries `kind` and a non-empty `citations` array with
   `source_document` and `page`, identical in shape to the signed-in path. `CLAUDE.md`'s
   cite-every-claim rule applies to a guest exactly as to anyone else.
4. **[M]** **Refusals behave identically for a guest.** A hazard prompt on the guest route
   returns `kind: 'refusal'` and renders through the same component. No safety behaviour is
   conditioned on auth state anywhere — ST-A19 AC 4 asserts this globally; this criterion
   asserts it on the guest path specifically, because that is the path most likely to be
   treated as a lesser mode.
5. **[M]** A guest **cannot** create or join a company: those actions are not reachable
   without a session, and the RPCs are granted to `authenticated` only, so there is no
   client-side-only gate.
6. **[M+H]** **The app says so before the first answer, not after.** **[M]** static test:
   the guest composer/answer surface carries copy stating that nothing is saved while
   signed out and that closing the app loses the conversation. **[H]** it is legible and not
   buried. The wording must not be softened into "sign in to save" — the user needs to know
   what is *lost*, not what is *offered*.
7. **[M+H]** **The History tab for a guest** renders a dedicated empty state — nothing is
   saved while signed out — **with a sign-in action**. The tab stays visible (OQ-A4
   sub-decision 1). **[M]** static test asserts both the copy and a working action;
   **[H]** it reads as an explanation with a way forward, not a locked door. An empty tab
   with no action is the dead end `Chrome.tsx:9-11` forbids.
8. **[M]** **Signing up mid-conversation** (OQ-A4 sub-decision 2): the on-screen transcript
   is **retained**, **nothing is back-filled** to the database, and the **next** question
   creates a real persisted session containing only from that point. Asserted three ways:
   the transcript is still in state after the auth transition; row counts show no
   back-fill; and the new session's message count equals only the post-sign-in turns.
9. **[M]** The boundary is marked in the transcript (*saved from here*), so a technician is
   not left guessing which half survives. Static test for the marker.
10. **[M]** Signing **out** mid-conversation clears the in-memory transcript rather than
    leaving one user's text on screen for the next person. Unit test on the reset path.
11. **[H]** On device: fresh install → ask a question → get a cited answer → force-quit →
    reopen → **the conversation is gone, and the app has already told you it would be.**
    This is the accepted downside being verified as *working as designed*, not as a bug.

**Owner:** Frontend (the seam and the screens) with Backend (the `store.ts` split)
**Dependencies:** ST-A02; releases with ST-A05
**Priority:** Critical
**Definition of Done:** seam implemented with the spy-client test; both disclosures shipped;
mid-session sign-up behaviour tested; ST-A17 records the device pass.

---

### ST-A07 — A company exists, and the technician who creates it owns it

**User story:** As a shop owner, I want to create a company profile in the app, so that my
technicians have something to be associated with.

**Acceptance criteria**

1. **[M]** `sql/012_companies.sql` is guarded and re-runnable and creates:
   `public.companies (id uuid pk, name text not null check (length(btrim(name)) between 1
   and 120), city text, region text, created_by uuid references auth.users(id), created_at,
   updated_at)` and `public.memberships (id uuid pk, company_id uuid not null references
   companies(id) on delete cascade, user_id uuid not null references auth.users(id) on
   delete cascade, role text not null check (role in ('owner','member')), created_at,
   unique (company_id, user_id))`.
2. **[M]** RLS is enabled on both. Policies use the `SECURITY DEFINER` helpers
   `public.is_member(uuid)` and `public.is_company_owner(uuid)` and contain **no**
   sub-select on `memberships` from a `memberships` policy (§1c). Verified two ways: grep
   the migration, **and** a live test that selects the roster as a member without raising
   `infinite recursion detected in policy` — the grep alone is not proof.
3. **[M]** Helpers are locked down: `security definer`, `set search_path = public`,
   `revoke execute … from public, anon`, `grant execute … to authenticated`. Asserted
   against `information_schema.role_routine_grants`.
4. **[M]** `public.create_company(name text)` is a `SECURITY DEFINER` RPC that inserts the
   company and an `owner` membership for `auth.uid()` in one transaction and returns the
   company id (§1e). Direct `insert` on `companies` is granted to no one — a direct insert
   attempt with a user JWT fails.
5. **[M] NEGATIVE:** a user who is not a member of company X reads **0 rows** from
   `companies where id = X` and **0 rows** from `memberships where company_id = X`. A
   company is not discoverable by a stranger who guesses its uuid.
6. **[M] NEGATIVE:** a `member` (not owner) cannot `update` the company row and cannot
   `insert` a membership — both affect 0 rows or raise.
7. **[M] NEGATIVE:** an owner of company X cannot read, update, or add members to company Y.
8. **[M]** `create_company` is unreachable without a session — granted to `authenticated`
   only, so an unauthenticated caller cannot invoke it at all.
9. **[M]** `sessions.company_id uuid references companies(id) on delete set null` is added,
   populated on insert by a trigger from the creator's `profiles.active_company_id`, and
   **referenced by no policy** (OQ-A1/OQ-A2). Verified by: a session created by a member
   carries the stamp; deleting the company sets it null and deletes **no** session; and
   ST-A05 AC 5's owner-cannot-read test still passes.
10. **[M]** `profiles.active_company_id` gains its FK here and is set to the new company on
    creation and on successful join.
11. **[M]** Membership and role are readable from the database by a member —
    `select role from memberships where company_id = X and user_id = auth.uid()` returns
    exactly one row with the expected role. (Brief AC 3's "readable and enforced by policy".)

**Owner:** Backend
**Dependencies:** ST-A03, ST-A05
**Priority:** High
**Definition of Done:** migration committed and run; helper grants asserted; all negative
tests in `scripts/verify-accounts.mjs`.

---

### ST-A08 — An owner manages who is in the company

**User story:** As a shop owner, I want to change a technician's role and remove someone who
has left, so that the company's roster reflects who actually works here.

**Acceptance criteria**

1. **[M]** An owner can `update memberships.role` and `delete` a membership within their own
   company. A `member` can do neither (0 rows affected).
2. **[M]** A user may always remove **their own** membership (leave the company) — unless
   doing so would leave the company with zero owners, in which case it is refused with the
   same defined error as ST-A12's sole-owner case.
3. **[M]** The last owner cannot be removed or demoted. A trigger (or a `SECURITY DEFINER`
   RPC — Stage 3's choice, stated in `03-backend.md`) raises a defined error `last_owner`
   and the transaction rolls back. Tested for both paths: delete the last owner's
   membership, and update the last owner's role to `member`.
4. **[M] NEGATIVE — brief AC 4, token-level, and the exact construction matters:**
   - as owner, remove member B;
   - then, using **the access token B already held before removal — B is not signed in
     again** (§1f) — assert B reads **0 rows** from `companies where id = X`, **0 rows** from
     `memberships where company_id = X`, cannot `update` the company, and gets a defined
     error from every company-scoped RPC for X;
   - and assert the same is still true after a token refresh.
5. **[M]** Removal is roster-only: B's own sessions, messages and citations are **all still
   readable by B** afterwards, and the count is unchanged. Removing someone from a shop does
   not touch their work (OQ-A2).
6. **[M]** `profiles.active_company_id` for B becomes null on removal (or moves to another
   membership if B has one), so B is never left pointing at a company they cannot read.
   Asserted for both the zero-remaining and one-remaining cases.
7. **[M] NEGATIVE:** an owner of company Y cannot remove a member of company X.

**Owner:** Backend
**Dependencies:** ST-A07
**Priority:** High
**Definition of Done:** last-owner guard implemented and both paths tested; AC 4's
stale-token test committed exactly as written.

---

### ST-A09 — A second technician joins with a code

**User story:** As a technician, I want to type the code my boss read me over the phone and
be in the company, so that joining takes ten seconds on a job site.

**Acceptance criteria**

1. **[M]** `sql/013_join_codes.sql` is guarded and re-runnable and creates
   `public.company_join_codes (id uuid pk, company_id uuid not null references companies(id)
   on delete cascade, code text not null unique, created_by uuid, created_at, expires_at
   timestamptz not null, max_uses integer not null default 10 check (max_uses > 0), uses
   integer not null default 0, revoked_at timestamptz)`.
2. **[M]** Codes are ≥ 8 characters of Crockford base32 (no I, L, O, U) and carry ≥ 40 bits
   of entropy. Unit test over the generator: 10,000 generated codes have no duplicate, no
   excluded character, and pass a length check.
3. **[M] NEGATIVE:** the table is selectable **only** by owners of the owning company. A
   member reads 0 rows; a stranger reads 0 rows; an unauthenticated client reads 0 rows. A
   code can never be discovered by reading rows — only by being told it.
4. **[M]** `public.redeem_join_code(code text)` is `SECURITY DEFINER`, granted to
   `authenticated` only, and on success inserts a `member` membership for `auth.uid()`,
   increments `uses`, and sets `profiles.active_company_id`.
5. **[M]** Each failure mode returns its own defined error and creates **no** membership:
   unknown code, expired (`expires_at < now()`), revoked (`revoked_at is not null`),
   exhausted (`uses >= max_uses`), already a member. An unauthenticated caller cannot invoke
   it at all.
6. **[M]** Redemption is transactional under concurrency: two simultaneous redemptions of a
   code with `max_uses = 1` result in exactly one membership. Tested with two concurrent
   calls.
7. **[M]** An owner can generate a code and revoke a code; revocation takes effect on the
   next redemption attempt.
8. **[M]** Redeeming grants exactly what OQ-A1 allows and no more: immediately after
   joining, the new member can read the company row and the roster, and **still reads 0
   rows** of any other member's sessions. Asserted, because "joined a company" is the most
   plausible moment for an isolation hole to open.
9. **[M]** `expires_at` defaults to 14 days and is enforced in the RPC, not only in the UI.

**Owner:** Backend
**Dependencies:** ST-A07
**Priority:** High
**Definition of Done:** migration and RPC committed; every failure mode asserted;
brute-force residual risk filed to `.pipeline/backlog.md` with the rate-limit note.

---

### ST-A10 — Company screens in the app

**User story:** As a shop owner, I want to create my company, share a join code, and see who
is in it; and as a technician, I want to enter a code and see which company I belong to.

**Acceptance criteria**

1. **[M+H]** Screens exist for: create a company; view company + roster + your own role;
   enter a join code. Owners additionally get: generate code, revoke code, remove member,
   change role. **[M]** static test for presence and accessibility labels; **[H]** device
   pass.
2. **[M]** Owner-only actions are not rendered for a `member` — **and** this story states
   plainly that this is cosmetic. The enforcement is ST-A08's policies, and ST-A08's
   negative tests are what prove it. No AC here treats hidden UI as security.
3. **[M]** Every error from `create_company` and `redeem_join_code` maps to specific copy
   (expired, revoked, already a member, unknown code). Unit test over the mapping; an
   unmapped error falls back to a generic error state, never a blank screen.
4. **[M]** Tokens: no raw hex, spacing/radius/type from `app/theme/tokens.ts`, targets
   ≥ `MIN_TOUCH`. Same static checks as ST-A04.
5. **[M]** A user with more than one membership gets a switcher that sets
   `profiles.active_company_id`; a user with one membership sees no switcher (OQ-A5).
6. **[M]** A **guest** reaching these surfaces is routed to sign-in with an explanation, not
   an error — company features require an account (ST-A06 AC 5), and that must read as a
   reason rather than a failure.
7. **[M]** Nothing in the app routes into these screens by force. Verified by ST-A13.
8. **[H]** Reinstating a "Settings"/"Account" tab is a deliberate reversal of
   `app/components/Chrome.tsx:9-11`, which dropped it as an empty dead end. The Stage 4
   artifact must record that it now has content — this run is exactly what gives it some.

**Owner:** Frontend
**Dependencies:** ST-A07, ST-A08, ST-A09
**Priority:** High
**Definition of Done:** screens shipped on brand tokens; error mapping tested; Stage 4
artifact records the Chrome.tsx reversal.

---

### ST-A11 — Profile screen

**User story:** As a technician, I want to set my display name and trade role, see how I
sign in, and sign out — so the app knows who I am and my shop's roster shows a person.

**Acceptance criteria**

1. **[M+H]** A profile screen edits `display_name` and `trade_role` and persists them —
   asserted by reading the row back with that user's JWT.
2. **[M]** `display_name` is validated (1–60 characters after trim) client-side **and** by a
   database `check` constraint. Both asserted; the client check is convenience, the
   constraint is the rule.
3. **[M] NEGATIVE:** an update attempt against another user's profile affects 0 rows
   (covered by ST-A03 AC 3 — this story depends on it rather than re-implementing it).
4. **[M]** The screen shows **which sign-in methods are linked** to this account and, per
   OQ-A9, offers linking an additional provider. Where Apple Private Relay makes automatic
   linking impossible (§1k), the copy says so rather than failing silently. Static test for
   the copy; unit test for the link action.
5. **[M]** Sign-out is reachable here and behaves per ST-A04 AC 7.
6. **[M]** The screen is fully usable with **no company** — no company section, no empty
   company card, no "create a company to continue" prompt (brief AC 5).
7. **[M]** Tokens and touch targets, as ST-A04 AC 6.

**Owner:** Frontend
**Dependencies:** ST-A03, ST-A04
**Priority:** Medium
**Definition of Done:** screen shipped; validation on both sides; ST-A13's checks pass
against it.

---

### ST-A12 — Delete my account, in the app

**User story:** As a technician, I want to delete my account and everything in it from
inside the app, so that leaving is as easy as joining — and because the App Store requires
it.

**Approach (per §1g):** `SECURITY DEFINER` RPC `public.delete_own_account()`, owned by
`postgres`, granted to `authenticated` only. **Fallback if the `auth` schema will not permit
it: a Supabase Edge Function holding the service-role key as a function secret.** Under no
circumstance does the service-role key move client-side (hard constraint 2).

**Acceptance criteria**

1. **[M]** `delete_own_account()` exists, is `SECURITY DEFINER` with `set search_path`, is
   `revoke execute … from public, anon`, and is granted to `authenticated`. Grants asserted
   against `information_schema`.
2. **[M]** Happy path, verified with **service role after the fact** (the only correct use
   of service role here — proving absence, not asserting access): for a user with 2
   sessions, 6 messages and 4 citations, after the RPC there are **0** rows for that user in
   `sessions`, `messages`, `citations`, `profiles`, `memberships`, and **0** rows in
   `auth.users` for that uuid.
3. **[M]** All linked identities go with the account — an Apple- or Google-linked user is
   fully removed, not left with a dangling identity that could re-authenticate. Asserted by
   checking `auth.identities` for that uuid is empty.
4. **[M]** The user's old JWT is useless afterwards: a read with it returns 0 rows / errors,
   and `refreshSession` fails.
5. **[M]** Sole owner of a company **with other members**: the RPC raises the defined error
   `sole_owner_of_company`, **nothing is deleted** (all row counts unchanged — the
   transaction is atomic), and the error payload names the company so the UI can act on it.
6. **[M]** Sole owner of a company **with no other members**: the company, its memberships
   and its join codes are deleted in the same transaction; the user is deleted.
7. **[M]** A member (not owner), or an owner where another owner remains: deletion proceeds;
   the company survives, and the **remaining members' sessions are untouched** (count
   asserted before and after).
8. **[M]** Deleting a user modifies **no** other user's rows — asserted, including that no
   other user's `sessions.company_id` changes.
9. **[M+H]** The UI requires an explicit confirmation (typed confirmation or equivalent
   deliberate act), states exactly what is destroyed and that it is irreversible, and for the
   sole-owner case offers the two paths the user can complete alone (promote an owner, or
   delete the company). **[M]** static test for the confirmation gate and both paths;
   **[H]** the wording reads clearly on device.
10. **[M]** The deletion path is reachable **only** for a signed-in user; a guest has no
    account to delete and the surface is absent rather than erroring (OQ-A4).
11. **[M]** `npm run verify:secrets` and `npm run verify:bundle` stay green. Static test:
    the string `SUPABASE_SERVICE_ROLE_KEY` appears nowhere under `app/`.
12. **[M]** If the fallback (Edge Function) is taken, `03-backend.md` records why, and the
    service-role key is set as a function secret only — never in `app/.env`, which
    `scripts/sync-app-env.mjs:34` structurally prevents anyway.

**Owner:** Backend (RPC) + Frontend (flow)
**Dependencies:** ST-A05, ST-A07, ST-A08, ST-A11
**Priority:** Critical
**Definition of Done:** RPC (or fallback) shipped and every branch tested; UI flow shipped;
secrets rails green.

---

### ST-A13 — A solo technician is a first-class user

**User story:** As an independent technician with no company and no intention of creating
one, I want the entire product to work, with nothing asking me to join something.

The brief calls the "and / or" load-bearing. This story is where that is enforced rather
than assumed, which is why it is a story and not a footnote on the others.

**Acceptance criteria**

1. **[M]** A **signed-in** user with **zero** memberships completes the full lifecycle
   against the live database with their own JWT: create session → append question → append
   answer with citations → read back → delete → cascade verified. Identical assertions to
   `scripts/verify-sessions.mjs`, run as a company-less user.
2. **[M]** No policy on `sessions`, `messages`, `citations`, or `profiles` requires a
   membership row to exist. Verified by grep over `sql/010`–`sql/014` for `memberships`
   inside those tables' policies — the only permitted reference is `is_co_member` on the
   profiles co-member read (ST-A03 AC 6), which is additive and never restrictive.
3. **[M]** No screen is unreachable without a company. Static test: no navigation guard or
   early-return in `app/screens/**` is conditioned on `active_company_id` or a company object
   being non-null, except within the company screens themselves.
4. **[M]** `profiles.active_company_id is null` never causes a thrown error or an empty
   render in any shared component. Unit-tested by rendering the shell and each shared
   component with a null company.
5. **[M]** The same holds for the **guest** state: no shared component throws or renders
   blank when there is no session at all. Guest and company-less are two different axes and
   both must be safe — this criterion exists because OQ-A4 added the second one.
6. **[H]** A human walks the entire app signed in as a company-less user — every tab, every
   screen, the capture flow, history, profile — and confirms no dead end, no empty company
   card, and no prompt to create one. Recorded in ST-A17.
7. **[M]** No copy anywhere implies a company is required. Static test: the new screens
   contain no string matching `/must (create|join) a compan/i`.

**Owner:** Test (machine half) + Frontend (fixes) + Human (walk-through)
**Dependencies:** ST-A05, ST-A06, ST-A10, ST-A11
**Priority:** Critical
**Definition of Done:** all machine checks in the Stage 5 suite; the human walk-through
logged in `05-test-report.md` as HUMAN-ONLY with a result.

---

### ST-A14 — The prototype's ownerless rows get a decided fate

**User story:** As the owner, I want to know exactly what happened to the rows created
before accounts existed, so that no orphaned session is left readable by every authenticated
user.

Brief AC 7. Same migration file as ST-A05, separate story because destroying data is a
decision, not an implementation detail.

**Acceptance criteria**

1. **[M]** `sql/011` opens with a **count-first** query
   (`select count(*) from public.sessions where user_id is null`) whose result the owner sees
   before anything destructive runs, and a comment stating exactly what the next statements
   do.
2. **[M]** The file contains, in this order and clearly labelled: (a) an **optional,
   commented-out** "claim to this uuid" block the owner may run *instead* — a single
   `update public.sessions set user_id = '<uuid>' where user_id is null;` — and (b) the
   **default**, uncommented `delete from public.sessions where user_id is null;`, which
   cascades to messages and citations.
3. **[M]** After the migration, `select count(*) from public.sessions where user_id is null`
   returns **0**, and `user_id` is `NOT NULL` (asserted against
   `information_schema.columns.is_nullable = 'NO'`).
4. **[M]** No orphans remain anywhere: 0 rows in `messages` whose `session_id` has no
   session, and 0 rows in `citations` whose `message_id` has no message.
5. **[M]** The `NOT NULL` step is ordered **after** the disposition step, so a skipped
   disposition fails the migration loudly instead of half-applying it.
6. **[M]** No policy anywhere in `sql/010`–`sql/014` contains `user_id is null`.
   Grep-asserted — this is the specific thing the brief says must be replaced rather than
   retrofitted around.
7. **[H]** The owner confirms, before running, whether any history on the test device is
   worth claiming. The default is deletion and the migration says so in plain language.
8. **[M] The property is permanent, not point-in-time — this is OQ-A4's dividend.** With
   anonymous sign-in disabled (ST-A01 AC 1) and a guest route that writes nothing (ST-A06
   AC 1), there is no remaining code path that can create an ownerless row. Asserted by:
   the `NOT NULL` constraint, the `anon` revocation (ST-A05 AC 3), and ST-A06 AC 1 together.
   Brief AC 7 therefore stays true going forward rather than needing periodic cleanup.

**Owner:** Backend, with a Human decision gate
**Dependencies:** part of ST-A05
**Priority:** Critical
**Definition of Done:** disposition written into `sql/011`; post-migration assertions in the
Stage 5 suite; the owner's choice recorded in `03-backend.md`.

---

### ST-A15 — The isolation harness

**User story:** As the test agent, I want one harness that mints real users and real JWTs
and asserts every isolation claim in this run against RLS with the anon key, so that
"isolated" is a measured fact and not a design intention.

**Acceptance criteria**

1. **[M]** `scripts/verify-accounts.mjs` exists, is wired as `npm run verify:accounts`, and
   follows `scripts/verify-sessions.mjs`'s conventions (PASS/FAIL lines, non-zero exit on
   failure, `--env-file=.env`).
2. **[M]** It creates fixtures — users A, B, a company owner, and a company — via the
   **service-role** client, then performs **every assertion** through
   `createClient(url, ANON_KEY)` clients carrying each user's real JWT. The file states this
   constraint at the top in the house voice, and any assertion made with the service-role
   client (other than fixture setup and the absence-proving reads in ST-A12 AC 2) is a
   review-blocking defect.
3. **[M]** It tears down every fixture it created, including on failure, so repeated runs do
   not accumulate users.
4. **[M]** It covers, at minimum, every criterion marked **NEGATIVE** in ST-A03, ST-A05,
   ST-A07, ST-A08, ST-A09 and ST-A12 — enumerated in the artifact so coverage is checkable
   rather than claimed.
5. **[M]** `tests/suites/e9-accounts.mjs` exposes the same checks to `tests/run-all.mjs` with
   correct `story`/`ac` attribution to this file, and reports **BLOCKED** (never FAIL) when
   Supabase env is absent — matching `tests/run-all.mjs`'s stated contract.
6. **[M]** Every check names the brief AC it serves, so `05-test-report.md` maps back to
   `00-brief-accounts.md` without a human re-deriving it.
7. **[M]** The suite fails if any prototype policy still exists, if any company-read policy
   has appeared on `sessions`/`messages`/`citations` (the OQ-A1 guard), **or if anonymous
   sign-in has been re-enabled** on the project (the OQ-A4 guard — a re-enabled toggle would
   silently reintroduce ownerless users).

**Owner:** Test
**Dependencies:** the stories it asserts; the scaffold starts in Wave 0
**Priority:** Critical
**Definition of Done:** script and suite committed; run green; coverage table in
`05-test-report.md`.

---

### ST-A16 — The rails stay green

**User story:** As the owner, I want the existing quality gates to be exactly as green after
this run as before it, so identity work cannot smuggle in a regression.

**Acceptance criteria**

1. **[M]** `npm run lint` exits 0 with **no new warnings** against the Wave-0 baseline
   recorded in ST-A16a. (Brief AC 8.)
2. **[M]** `npm run build` (`tsc --noEmit` in `app/`) exits 0.
3. **[M]** `npm test` (`node --test`) exits 0, including every new `*.test.mjs`.
4. **[M]** `npm run verify:secrets` exits 0. (Brief AC 9.) Includes the Apple `.p8` check
   from ST-A20 AC 6.
5. **[M]** `npm run verify:bundle` exits 0 — no `SERVER_ONLY` name and no secret-shaped
   literal in the bundle after the new dependencies (`async-storage`, `expo-auth-session`,
   `expo-web-browser`) and the new auth code.
6. **[M]** `npm run verify:sessions` exits 0 post-cutover, with all seven of its original
   checks intact (ST-A05 AC 7).
7. **[M]** `npm run verify:accounts` exits 0.
8. **[M]** `.pipeline/backlog.md` gains entries for, at minimum: **native
   `expo-apple-authentication` in a development build before App Store submission**
   (`launch-blocker`, from OQ-A7); re-enabling email confirmation before public release
   (`launch-blocker`, OQ-A7b); password reset (`launch-blocker`, §9); OQ-A9's manual
   provider-linking path for Apple Private Relay users; a chunked SecureStore adapter
   (ST-A02); and join-code brute-force rate limiting (ST-A09).
9. **[M]** No `.env`, key, token, `.p8`, or password appears in any commit from this run.

**Owner:** Test / Backend
**Dependencies:** everything
**Priority:** Critical
**Definition of Done:** all seven commands green in one run, recorded with exit codes in
`05-test-report.md`; backlog entries filed.

---

### ST-A17 — The on-device acceptance pass

**User story:** As the owner, I want to prove on the actual phone that accounts work, so
that brief AC 1's word "on the device" means what it says.

Every criterion here is **[H]**. Per `tests/run-all.mjs:184`, no agent may report any of
them as PASS; they land in the HUMAN-ONLY section of `05-test-report.md`.

**Acceptance criteria**

1. **[H]** Fresh install → the app opens straight into use as a guest, with no auth wall,
   and **a real cited answer comes back** without signing in.
2. **[H]** The guest disclosure is visible before that first answer, and the History tab
   explains itself with a way forward.
3. **[H]** Force-quit as a guest → reopen → **the conversation is gone**, as disclosed. The
   accepted downside, confirmed working as designed.
4. **[H]** Sign up mid-conversation → the transcript stays on screen, is marked at the
   boundary, and the next question is saved while the earlier ones are not.
5. **[H]** Sign out → sign back in → history is intact. **This is brief AC 1.**
6. **[H]** The same round trip via **Sign in with Apple** and via **Google**.
7. **[H]** Force-quit and relaunch while signed in → still signed in, with no flash of the
   guest state at cold start (ST-A02 AC 7).
8. **[H]** Two accounts on the same device (or two devices): A's history is not visible to
   B anywhere in the UI. The eyeball companion to ST-A05's machine proof — not a substitute
   for it, and not a substitute the other way either.
9. **[H]** Create a company on device A; join it with the code on device B; B appears in the
   roster on A; **B's jobs do not appear anywhere on A.** (OQ-A1, seen rather than asserted.)
10. **[H]** Owner removes B; B's next action against company data fails cleanly with
    readable copy rather than a crash or a silent empty screen.
11. **[H]** The full company-less walk-through from ST-A13 AC 6.
12. **[H]** Delete the account on device B → sign-in with those credentials fails → history
    is gone.
13. **[H]** Every screen added this run reads correctly on the device's real size, in
    sunlight-grade contrast, with the shipped brand assets.

**Owner:** Human
**Dependencies:** all
**Priority:** Critical
**Definition of Done:** every item ticked with a date and a device name in
`05-test-report.md`'s human-only checklist.

---

### ST-A18 — The app states the privacy posture where it matters

**User story:** As a technician being asked to join my employer's company, I want to be told
what my employer can and cannot see **before** I join, so I am not guessing.

OQ-A1 is a promise. This story is where the promise is made to the user rather than only to
the database.

**Acceptance criteria**

1. **[M]** The join-code screen and the create-company screen each display copy stating, in
   plain language, that the company can see the member's name, trade role and role in the
   company, and **cannot** see their jobs, questions, answers or citations. Static test
   asserts the copy is present on both screens.
2. **[M]** The same statement appears on the company screen for an existing member, so it is
   discoverable after joining and not only at the moment of joining.
3. **[M]** The copy is not conditional, collapsible-away by default, or rendered below the
   fold of the primary action. Static test: it is not inside a collapsed-by-default
   component and precedes the join/create button in the tree.
4. **[M]** A test asserts the *claim matches the schema*: the copy is accurate only while no
   company-read policy exists on `sessions`/`messages`/`citations`, so this story's check is
   wired to ST-A15's OQ-A1 guard. **If someone later adds that policy without changing this
   copy, the app is lying to users and the suite goes red.** That coupling is the point of
   the story, and it matters more now that OQ-A1 is an owner decision rather than a Stage 2
   default.
5. **[H]** The wording is reviewed by the owner for tone and accuracy before release — this
   is a promise the product is making, and it should not be written solely by an agent.

**Owner:** Frontend, with Human review
**Dependencies:** ST-A10, ST-A15
**Priority:** High
**Definition of Done:** copy shipped on all three surfaces; the schema-coupling test
committed; owner sign-off recorded.

---

### ST-A19 — Identity changed nothing about what the product says

**User story:** As the eval agent, I want proof that adding accounts did not alter a single
answer, citation or refusal, so that `CLAUDE.md`'s two domain rules are demonstrably
untouched by this run.

**Acceptance criteria**

1. **[M]** The existing refusal probes (`tests/probes/safety-coverage-probes.mjs`) are
   re-run after the cutover and produce **identical** verdicts to the pre-run baseline. Any
   difference is a Critical defect in this run, regardless of direction — an identity change
   has no business moving a safety verdict.
2. **[M]** The citation checker (`tests/checkers/citation-check.mjs`) and the reachability
   probe produce identical verdicts pre- and post-run.
3. **[M]** `git diff` for this run touches **no** file under `lib/` implementing retrieval,
   prompting, citation anchoring or the safety gate, and no file under `ingest/`. Asserted
   by a path allowlist so an accidental edit is caught in review, not in an eval.
4. **[M]** The gate remains pre-model and deterministic: **no code path lets authentication
   state influence whether a refusal is issued.** A refusal is a refusal for a guest, a
   signed-in solo user, a member and an owner alike, and a test asserts the safety
   evaluation takes no identity input.
5. **[M] The guest path is evaluated, not assumed.** Because OQ-A4 introduced a second
   answer route through `store.ts` (§1i), the refusal and citation probes run **through the
   guest route as well as the signed-in route**, and the verdicts must be identical. A
   guest-only regression in citations or refusals is exactly the kind of defect a
   signed-in-only eval would miss.
6. **[M]** Zero-quota by construction — these probes never reach the model, so this story
   costs no Gemini budget and can run on any day.

**Owner:** Eval
**Dependencies:** ST-A05, ST-A06, ST-A16
**Priority:** High
**Definition of Done:** identical verdicts recorded in `055-eval.md` with the pre/post
comparison shown, not summarized, and with the guest and signed-in routes reported
separately.

---

## 7. Traceability — brief AC → stories

| Brief AC | Covered by | Verification |
|---|---|---|
| **1** — sign up, sign out, sign back in; history intact; **proven on the device** | ST-A04 (all three methods), ST-A02 · device proof **ST-A17 AC 5–6** | [H] on device + [M] lifecycle tests |
| **2** — only own sessions; negative test with B's token, **against RLS with the anon key** | **ST-A05 AC 3–5**, ST-A15 | [M] `verify:accounts` + `e9-accounts` suite |
| **3** — create a company; a second user joins; membership + role readable and policy-enforced | ST-A07 (AC 4, 11), ST-A09, ST-A10 | [M] RPC + policy tests |
| **4** — admin removes a member; access lost **immediately**, token-level test | **ST-A08 AC 4** (stale token, no re-login) | [M] token-level test — scope caveat in §8.2 |
| **5** — solo user, full use, no dead ends, nothing gated | **ST-A13** (all), ST-A11 AC 6, ST-A10 AC 7 | [M] policy grep + lifecycle + [H] walk-through |
| **6** — in-app deletion; defined fate for sessions and a solely-owned company | **ST-A12** (all), OQ-A6 | [M] every branch + [H] copy |
| **7** — `user_id is null` rows disposed; no orphans readable by all | **ST-A14** (all, incl. **AC 8** — now a permanent property), ST-A05 AC 1–3 | [M] post-migration counts + constraint + `anon` revocation |
| **8** — lint, build, test exit 0 with no new warnings | **ST-A16 AC 1–3**, baseline in ST-A16a | [M] exit codes vs baseline |
| **9** — no secret leaves the server; `verify:secrets` green | **ST-A16 AC 4–5**, ST-A20 AC 6 (`.p8`), ST-A12 AC 11–12, ST-A02 AC 4 | [M] `verify:secrets`, `verify:bundle` |

**Brief criteria with no story: none.** All nine are covered.

**Re-mapped by the owner's decisions:** AC 1 now runs through ST-A04's three methods rather
than email alone, and its device proof gained ST-A17 AC 6 (Apple and Google round trips).
AC 7 gained ST-A14 AC 8, which upgrades it from a one-time cleanup to a permanent property
— OQ-A4's clearest benefit. AC 9 gained the Apple `.p8` under ST-A20 AC 6, a secret class
that did not exist in the previous version of this plan. **AC 5's coverage no longer leans
on the anonymous-sign-in guest**: ST-A13 AC 5 now asserts the *guest* state is safe as a
separate axis from the *company-less* state.

**Additional coverage not demanded by the numbered list but required by the brief's scope
or by `CLAUDE.md`:** the guest path (hard constraint 5 → ST-A06), Sign in with Apple as a
compliance pairing (hard constraint 4 → ST-A04 AC 2, ST-A20), the privacy disclosure OQ-A1
obliges (ST-A18), and the domain-rule attestation across **both** answer routes (ST-A19
AC 5).

---

## 8. Criteria flagged as at-risk, human-only, or contested

Flagged rather than hidden, per the charter. Items that existed only because of anonymous
sign-in have been **removed**, not carried forward; items the owner's decisions introduced
are **added**.

1. **Brief AC 1 is not machine-verifiable and must never be reported as PASS by an agent.**
   "Proven on the device, not only in a test" is human-only by construction. ST-A17 AC 5–6
   is the record. The machine tests around it are supporting evidence, not the criterion.

2. **Brief AC 4 is narrower than it may read, and the narrowing comes from OQ-A1 — now an
   owner decision.** The criterion says a removed member "immediately loses whatever
   company-scoped access the stories define". Under OQ-A1 there is **no** company-scoped
   access to session data at all, so the test asserts loss of the company row, the roster,
   and the admin RPCs. That is the full company-scoped surface this run creates. Overturning
   OQ-A1 now requires a signed brief amendment, and would re-scope ST-A08 AC 4, ST-A05 AC 5,
   ST-A15 AC 7 and ST-A18 AC 4 together.

3. **"Immediately" is true at the row level, not the token level.** JWTs cannot be revoked
   mid-life (§1f). Access ends on the next request because the policies join to `memberships`
   at query time; the stale token authenticates but authorizes nothing. Any future design
   that caches membership into a JWT claim would silently break this criterion.

4. **Account deletion remains the run's highest *technical* risk (§1g).** If a
   `SECURITY DEFINER` function cannot delete from `auth.users` in the current Supabase
   project, ST-A12 falls back to an Edge Function — schedule impact, not scope change. **Stage
   3 should test this specific capability first**, before building the rest of ST-A12.
   OQ-A7 added a wrinkle: deletion must also clear `auth.identities` for Apple/Google-linked
   users (ST-A12 AC 3), or a "deleted" user could re-authenticate through a provider.

5. **NEW — Sign in with Apple is the run's highest *schedule and compliance* risk, and it
   collides with the SDK 54 pin (§1h, §1k).** Three distinct problems, stated separately
   because they have different fixes:
   - **Enrolment lead time.** Apple Developer Program enrolment involves identity
     verification that cannot be compressed. ST-A20 is in Wave 0 for this reason; if it slips
     past Wave 1, ship email/password and hold **both** Apple and Google.
   - **Expo Go cannot host native SIWA.** The bundle identifier is Expo's, not ours, so the
     native sheet cannot be configured against our Service ID. This run therefore uses the
     **OAuth web flow**, which works in Expo Go and keeps the pin that exists because the
     test iPhone cannot run a newer Expo Go.
   - **The web flow is a review-friction risk, not a missing feature.** Guideline 4.8 asks
     that Sign in with Apple be *offered*, and it is. But App Review expects the native
     experience on iOS, so **native `expo-apple-authentication` in a development build is a
     launch blocker** filed by ST-A16 AC 8. Honest framing: this run is compliant in
     substance and not yet in polish, and E10 is where that closes.

6. **NEW — a guest who closes the app loses their work, permanently (OQ-A4).** No recovery,
   no cache, no support path. The owner chose this knowingly. It is mitigated by disclosure
   (ST-A06 AC 6–7) and verified as *designed behaviour* (ST-A17 AC 3), not treated as a bug.
   The residual product risk — a technician losing twenty minutes of diagnosis and blaming
   the app rather than the mode — is real and is named here rather than left to be
   discovered in beta feedback.

7. **NEW — hard constraint 5 holds, with an asterisk (§5.2).** The device build keeps
   working through the transition: a guest still gets real cited answers. But **history no
   longer persists until someone signs in**, where today's prototype persists it for an
   anonymous user. That is a deliberate, owner-chosen behaviour change. It should be read as
   such and not later mistaken for a regression.

8. **NEW — ST-A06 is real frontend architecture, not a feature flag (§1i).** `answerExisting`
   fuses generation with persistence, and six call sites across two screens depend on the
   current shape. Scoping it as "add a guest mode" would under-estimate it. The seam design
   is specified in ST-A06 so Stage 3 and Stage 4 do not each invent a different one.

9. **NEW — OQ-A9 (account linking) is decided but not yet measured.** Stage 3 must determine
   the project's actual linking behaviour empirically before ST-A04's UI is built (ST-A04
   AC 8). And Apple Private Relay means some users **will** end up with two accounts no
   matter what the app does; the escape hatch is manual linking from the profile screen
   (ST-A11 AC 4), and the failure to prevent it is disclosed rather than hidden.

10. **`persistSession: true` requires a new dependency (§1b), and OQ-A7 added two more.**
    `async-storage`, `expo-auth-session`, `expo-web-browser` — all must be installed with
    `npx expo install` at SDK-54-correct versions, or brief AC 8's "no new warnings" fails on
    a peer-version warning that has nothing to do with accounts.

11. **Email confirmation off is a knowingly accepted weakness for the beta (OQ-A7b)**, and it
    now interacts with OQ-A9: an unverified email must never be a basis for linking
    identities (ST-A04 AC 8). Launch blocker, filed.

12. **No password reset ships in this run (§9).** A beta tester who forgets their password is
    locked out with no self-service path. Partially softened by OQ-A7 — a user who signed up
    with Apple or Google has no password to forget — but the email/password path still has
    the gap.

13. **Join-code brute force is bounded but not rate-limited.** Entropy, expiry, use limits
    and a non-readable table make it impractical, but there is no request-rate limit at the
    database. Filed to backlog with the reasoning.

14. **Nothing in the brief is judged infeasible.** All nine criteria are achievable as
    written, subject to items 1–5 above being read as scoping and scheduling facts rather
    than as escapes.

**Removed from this list since the previous revision, because OQ-A4 eliminated them:**
anonymous-user MAU accumulation; the guest-account cleanup job; the `is_anonymous` policy
branch and its tests; and the risk that an anonymous upgrade path silently orphans a
guest's history.

---

## 9. Deliberately not built in this run

Each with the risk of not building it, stated:

| Not built | Why | Risk if it stays unbuilt |
|---|---|---|
| Billing, Stripe, RevenueCat, seats-as-licences | Explicitly out of scope. A seat here is a membership row. | None this run. E13/E16 own it. |
| Web admin console, marketing site | Out of scope (E14/E16, Phases 3–4). | None this run. |
| SSO / SAML | Out of scope. | None. |
| **Native `expo-apple-authentication`** | Needs a development build; Expo Go cannot host it (§1k). The OAuth web flow ships instead. | **App Review friction on iOS. Launch blocker — closes with E10.** |
| Persistence for guests | OQ-A4, owner's decision. | **A guest who closes the app loses their work.** Accepted knowingly; disclosed in-app. |
| Supabase anonymous sign-in | OQ-A4 overturned it. | None — removing it simplified the schema and made `NOT NULL` permanent. |
| Password reset | Needs mail delivery + deep links, the same infrastructure OQ-A3 declined. | A locked-out email/password tester has no self-service path. **Launch blocker.** |
| Email change | Same mail dependency. | Minor for a beta. Backlog. |
| Automatic linking for Apple Private Relay users | Impossible by design (§1k). | Some users get two accounts. Manual linking (ST-A11 AC 4) is the escape hatch; disclosed. |
| Company-visible technician history | OQ-A1, owner-confirmed. | A shop owner may ask for it. Re-open only via a **signed** Stage 0 amendment, with disclosure shipping first. |
| Aggregate/anonymized company analytics | Out — it is the thin end of OQ-A1, and E11 owns instrumentation and its disclosure. | None this run. |
| Audit log of membership changes | No requirement yet; E16 territory. | A disputed removal has no record. Backlog. |
| Encrypted-at-rest session token | ST-A02's SecureStore size limit. | Token readable on a rooted/jailbroken device. Backlog. |

---

**Stage 2 complete (revised 10 Aug 2026 against the owner's decisions).** Stage 2.5
(Knowledge) has **nothing to do** in this run and should record that and hand off. Stage 3
starts with **ST-A20 on day one** — it is the only item with external lead time — then the
§8.4 deletion-capability test, then the Wave 0 migrations.
