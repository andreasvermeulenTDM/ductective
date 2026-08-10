# 02 — User stories · Accounts, user profiles & company profiles

Stage 2 artifact for `.pipeline/00-brief-accounts.md`.

> **This is not Run B.** `.pipeline/00-brief.md` and `.pipeline/02-user-stories.md`
> belong to Run B (the diagnostic core) and are untouched by this file. Stages 3–5.5
> reading *this* run take `.pipeline/00-brief-accounts.md` as the brief and this file
> as the story set. Story ids here are `ST-A**` so they can never collide with Run B's
> `ST-**`.

**Stage 1 did not run for this brief.** §1 below records everything I had to establish
by reading code that a research pass would normally have handed downstream stages. It
is not optional reading: three of the items in it (policy recursion, the company-creation
chicken-and-egg, and the JWT-revocation nuance) determine whether stories ST-A05,
ST-A07 and ST-A08 are written correctly or are quietly wrong.

**Two rules from `CLAUDE.md` bind this run and no story below relaxes either.** This run
adds identity *around* the product. It does not touch retrieval, citation anchoring, or
the deterministic safety gate. ST-A19 exists specifically to prove that.

---

## Contents

1. [What research would have handed us (established by reading code)](#1-what-research-would-have-handed-us)
2. [Decisions and OPEN QUESTIONS](#2-decisions-and-open-questions)
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
- `scripts/verify-sessions.mjs:26` — builds an anon client with **no sign-in at all**
  and inserts rows. Post-cutover this script fails at check 2 unless it authenticates
  first. It is wired into `npm run verify:sessions`, so it is a rails regression if it
  is not updated in the same PR.

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
change and have changed before. This is the run's highest technical risk — see §8.

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

---

## 2. Decisions and OPEN QUESTIONS

Per `CLAUDE.md`: each is recorded with a proposed default, and every story below is
written **on that default**. An owner who overturns one should expect the named stories
to be re-scoped, not merely tweaked.

---

### OQ-A1 — Does a company see its technicians' jobs? **← the consequential one**

**Default: NO. A company sees its roster. It sees nothing a technician asked, nothing an
answer said, and no session ever.**

This is a privacy decision, and it is being made deliberately rather than falling out of
whichever policy was easiest to write.

**What a company can see under this default, exhaustively:**

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
   recoverable one is the default.
2. **A diagnostic question is an admission of not knowing.** A technician who believes
   their employer is reading every question asks fewer of them, and asks them
   later — after they have already guessed. That degrades the product's actual job.
   Ductective's value comes from being asked early.
3. **It is the honest default for a beta.** Nobody has agreed to employer visibility.
   Building it in and disclosing it in a settings screen nobody reads is not consent.
4. **The store and privacy-disclosure surface stays small.** No aggregation, no
   dashboards, no "manager view" to describe in a privacy nutrition label that E15 does
   not yet exist to write.
5. **The technical argument is a tie, so it does not decide.** Either policy is roughly
   the same amount of SQL. This is a product decision that happens to be expressed in SQL.

**Why an owner might legitimately overturn it:** a shop paying for seats (Phase 4)
frequently wants a record of what advice its techs received, for training and for
liability. That is a real, defensible position. It is also a **billing-era** position,
and billing is explicitly out of this run.

**How the default keeps that door open at zero cost:** ST-A07 adds a nullable
`sessions.company_id` **stamp** — the creator's active company at the moment the session
was created — and **no policy in this run reads it.** It costs one column now; adding it
after real beta data exists is the migration `sql/002`'s own comment was written to warn
about. This is the same "cheap-now / expensive-later" reasoning the schema already used
for `user_id`.

**Guard rail:** flipping this on later is a **Stage 0 brief amendment**, dated and
signed by the owner, and it must ship *with* in-app disclosure *before* it takes effect,
never after. No Stage 3/4 agent may add a company-read policy on `sessions`, `messages`
or `citations` on its own authority. ST-A15 enforces this mechanically: the isolation
suite asserts that a **company owner's** token reading a **member's** session returns
zero rows. If someone adds the policy quietly, that test goes red.

**Consequence for brief AC 4** (a removed member "immediately loses whatever
company-scoped access the stories define"): under this default the company-scoped access
surface is the company row, the roster, and the admin RPCs — *not* session data. AC 4's
test therefore asserts loss of those. Called out explicitly in §8 so nobody discovers
later that the criterion was quietly narrowed.

---

### OQ-A2 — Does a session belong to the user, the company, or both?

**Default: the user owns it, with a company stamp that grants nothing.**

`sessions.user_id` (NOT NULL, `default auth.uid()`) is the sole basis of access.
`sessions.company_id` is a nullable historical stamp: which company the technician was
working under when the session was created. It is set by trigger from
`profiles.active_company_id` at insert time and **never re-derived**.

Two consequences to state now so they are not surprises:

- Leaving a company does **not** un-stamp past sessions, and joining one does **not**
  stamp past sessions. The stamp is a fact about the past.
- `company_id` is `on delete set null`. Deleting a company never deletes a technician's
  work.

---

### OQ-A3 — Join mechanism: invite email, join code, or admin-adds-by-email?

**Default: an owner-generated join code, redeemed by the joining technician.**

- **Email invite** requires deliverable transactional mail. The repo has no mail
  provider, no template, and no deep-link scheme; Supabase's built-in mailer is
  rate-limited hard on free tier. That is a vendor and a Human setup task for a feature
  whose whole job is "a second tech gets in".
- **Admin-adds-by-email** requires resolving an email to a user id from the client, which
  means either exposing an email→uid lookup (an enumeration oracle over your whole user
  table) or creating pending-invite rows that leak which emails are registered. Both are
  worse than the problem.
- **Join code** needs no infrastructure, works the way this actually happens on a
  job — the owner reads eight characters down the phone — and is fully testable against
  the database with no mail loop.

Shape: ≥8 characters of Crockford base32 (excludes I/L/O/U, so it survives being read
aloud), ≥40 bits of entropy, `expires_at` default 14 days, `max_uses`, revocable,
scoped to one company. The code table is **not selectable** by anyone except owners of
that company; redemption goes through a `SECURITY DEFINER` RPC so a code can never be
enumerated by reading rows. Residual risk (online brute force) is named in ST-A09 and
filed to backlog rather than hidden.

---

### OQ-A4 — Does an unauthenticated user still get to use the app?

**Default: yes — via Supabase *anonymous sign-in*, not via the `user_id is null`
predicate.**

This is what lets hard constraint 5 ("do not regress Phase 1") and the RLS cutover
coexist. On first launch, with no stored session, the app calls `signInAnonymously()`.
The guest is a real `auth.users` row with a real uid, so:

- Every row in `sessions` has an owner. `user_id` can be `NOT NULL`. There is exactly
  **one** policy shape, not a guest branch and a member branch.
- The prototype keeps working with zero screens between launch and asking a question.
- Upgrading to a real account is `updateUser({ email, password })` on the **same uid**,
  so the guest's history carries over rather than being abandoned — which is the whole
  reason to prefer this over a "sign-in wall".

**Honest costs, stated:**

- Anonymous sign-in must be enabled in the Supabase dashboard (Human task, ST-A01) and
  each guest is a real user row counting toward MAU.
- A guest's history is recoverable only from that install. Clear the app data and it is
  gone, because there is no credential to prove ownership. **The UI must say this
  plainly** (ST-A06), not discover it for the user later.
- Guests may **not** create or join a company. Policies gate that on
  `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false`, which is
  machine-testable.

**Rejected alternative:** a forced sign-in wall. It is simpler, and it means the test
device cannot be demoed until someone makes an account — which the brief names as "not
an acceptable answer".

---

### OQ-A5 — One company per user, or many?

**Default: the data model permits many; the app uses one at a time.**

`memberships` has `unique (company_id, user_id)` and no constraint limiting a user to one
row — a contractor working for two shops is a real person and a one-company constraint is
a migration to remove later. `profiles.active_company_id` names the one that is currently
in effect (it is what stamps new sessions, per OQ-A2). In practice most users have zero
or one, and the UI in ST-A10 shows a switcher only when a user has more than one, so the
common case sees no extra chrome.

---

### OQ-A6 — Company deletion, and what happens to members' data

**Default:**

- **Company deletion** requires the `owner` role. It deletes the company, all its
  memberships, and all its join codes. It deletes **no** session, message, or citation —
  those belong to users (OQ-A2), and `sessions.company_id` is `on delete set null`. Every
  ex-member keeps their full history and simply has no company.
- **Account deletion** hard-deletes the user: profile, memberships, and all sessions with
  their messages and citations by cascade, then the `auth.users` row. Not soft-deleted,
  not anonymized. Apple's requirement is deletion, there is no billing or audit reason to
  retain, and under OQ-A1 nobody else could see the data anyway.
- **Sole owner of a company with other members:** the RPC **refuses**, transactionally,
  with a defined error, and the UI offers the user the two paths they can complete alone:
  promote another member to owner, or delete the company. Auto-promoting the
  longest-tenured member was considered and rejected — it makes someone an administrator
  without their consent.
- **Sole owner of a company with no other members:** the company is deleted with them, in
  the same transaction, no prompt.

This still satisfies Apple: every path is completable in-app by the user alone, without
contacting support.

---

### OQ-A7 — Third-party sign-in, and therefore Sign in with Apple

**Default: email + password only in this run. No social providers, so Sign in with Apple
is not triggered.**

Hard constraint 4 says Apple must be offered *wherever any third-party sign-in is
offered*. Offering **none** is compliant. Native Sign in with Apple needs an Apple
Developer account, a development build (the app is pinned to SDK 54 for Expo Go per
`app/AGENTS.md`), and signing config — all of which is E10, none of which exists.

**Flagged forward, loudly:** the day E10/E15 adds Google or any social provider, Sign in
with Apple becomes a **launch blocker**, not a nice-to-have. Filed to
`.pipeline/backlog.md` by ST-A16 so it cannot be forgotten between runs.

---

### OQ-A7b — Email confirmation on sign-up

**Default: OFF for the beta project, and re-enabling it before public release is recorded
as a launch blocker.**

With confirmation ON, `signUp` returns no session until a mail round-trip completes, on a
shared free-tier SMTP with a low hourly cap. Brief AC 1 must be provable *on the device*;
gating it behind that mailer makes the acceptance pass flaky for reasons unrelated to the
code.

**Stated honestly:** confirmation OFF means a user can sign up with an email address that
is not theirs, i.e. squat on someone else's. That is tolerable for a closed beta with a
handful of known testers. It is **not** tolerable at public launch, and ST-A16 files it
to backlog tagged `launch-blocker` alongside password reset (§9).

---

### OQ-A8 — Role vocabulary

**Not a genuine ambiguity — the brief sets the minimum — but recorded so nobody
re-litigates it.** Two roles: **`owner`** (manage membership, generate/revoke join codes,
edit and delete the company) and **`member`** (read the company and its roster; nothing
else). Multiple owners are allowed. Stored as `text` with a `check` constraint, per
§1h, so a third role can be added later by widening the constraint rather than altering
a type.

---

## 3. Owners

| Owner | Stage | Scope this run |
|---|---|---|
| **Knowledge** | 2.5 | **Nothing to do.** This run adds no documents, chunks, embeddings or provenance. Stage 2.5 should record "nothing to do" and hand off. |
| **Backend** | 3 | Every migration (`sql/010`–`sql/014`), every RPC, every policy, the client auth wiring in `app/lib/`, and the two files in §1a. |
| **Frontend** | 4 | Auth screens, profile screen, company screens, the guest and upgrade paths, the deletion flow, the privacy disclosure copy. |
| **Test** | 5 | The isolation harness and the negative tests. Every "user B cannot read user A" assertion lives here and is run with the **anon key plus a user JWT**. |
| **Eval** | 5.5 | One story only (ST-A19): prove identity did not change what the product *says*. |
| **Human** | — | Dashboard configuration (ST-A01), running the migrations in the SQL Editor, and the on-device acceptance pass (ST-A17). Human items are dependencies inside stories, and ST-A01/ST-A17 where the human *is* the owner. |

---

## 4. Sequencing plan — waves

### The one hard serialization

**ST-A05 (session RLS cutover) is a coordinated release, not a migration.** The moment
`sql/011` runs, any app build without auth stops working: `store.ts`'s
`.is('user_id', null)` returns nothing and its inserts are refused. So **ST-A02 (session
persistence), ST-A06 (guest sign-in) and ST-A05 must land together and be released
together.** Splitting them across releases breaks the device build, which hard constraint
5 forbids. Everything else in this run can be sequenced freely around that one knot.

### Wave 0 — parallel, no dependencies between them

| Story | Owner | Note |
|---|---|---|
| ST-A01 | Human + Backend | Dashboard config. **Start first** — it has a human in it and it gates the whole run. |
| ST-A02 | Backend | Client persistence + storage adapter. Ships with Wave 1. |
| ST-A03 | Backend | `sql/010` profiles + auto-provision trigger. Touches nothing existing. |
| ST-A15a | Test | Fixture harness (service-role user create/teardown, JWT clients). Buildable before anything it tests exists. |
| ST-A16a | Test | Record the green baseline of lint/build/test/verify:secrets **before** any change, so "no new warnings" has a referent. |

### Wave 1 — the cutover. Strictly serialized after Wave 0. One release.

- **ST-A06** guest anonymous sign-in + upgrade-to-account (needs A01, A02).
- **ST-A04** sign-up / sign-in / sign-out UI (needs A01, A02).
- **ST-A05** the RLS cutover, `sql/011` (needs A01, A03, and A02+A06 in the same build).
- **ST-A14** prototype-row disposition — same migration file as A05, separate story
  because it is a data-loss decision that deserves its own review.

Nothing in Wave 2+ may start until Wave 1 is released and the device is verified working.

### Wave 2 — company data model. Serialized on Wave 1; internally partly parallel.

- **ST-A07** `sql/012` companies + memberships + helpers + `create_company` RPC +
  `sessions.company_id` stamp. Blocks the rest of the wave.
- Then, in parallel: **ST-A08** (roles, removal, last-owner guard) and **ST-A09**
  (`sql/013` join codes + `redeem_join_code` RPC).

### Wave 3 — company & profile UI. Parallel with each other, after Wave 2.

- **ST-A10** company screens · **ST-A11** profile screen · **ST-A18** privacy disclosure
  copy · **ST-A13** the solo-user no-dead-end guarantee (part machine, part human).

### Wave 4 — deletion. After Waves 2 and 3.

- **ST-A12** `sql/014` `delete_own_account()` + the confirmation flow. Last because it
  needs the company rules (sole-owner) and the profile screen to live in.

### Wave 5 — verification. After everything.

- **ST-A15** the full isolation suite · **ST-A16** rails green · **ST-A19** eval
  no-change attestation · **ST-A17** the human device pass.

### What can genuinely run in parallel

Frontend (ST-A04, ST-A10, ST-A11, ST-A18) can be built against the migrations' *shapes*
as soon as the relevant migration is written and reviewed — it does not need the
migration *run*. Test (ST-A15) can build fixtures from Wave 0. Only the Wave-1 knot and
ST-A07-before-A08/A09 are truly serial.

---

## 5. Migration & rollout risk, stated honestly

1. **The old build breaks at cutover.** Any Expo Go client on the test phone running
   pre-auth code stops reading and writing the moment `sql/011` runs. Mitigation: run
   `sql/011` only when the auth-carrying build is loaded on the device, and treat it as a
   release step, not a schema chore. The migration file must say this at the top, in the
   `sql/00*` house voice.
2. **`sql/011` needs a documented rollback.** Migrations here are hand-run with no runner,
   so the file carries a commented block that restores the three `prototype_*_anon`
   policies and drops the `NOT NULL`. Untested rollbacks are a fiction; ST-A05 requires
   the rollback be *executed once* against a scratch project and the result recorded.
3. **`user_id is null` rows are destroyed by default.** ST-A14 makes this a first-class
   decision with a count-first query and an optional, clearly-marked "claim to this uuid"
   block the owner may run *instead*. Silent data loss is not acceptable; announced data
   loss of mock prototype rows is.
4. **`set not null` fails loudly if the disposition step was skipped.** Good — that is
   the intended interlock, and the migration should order the statements so it cannot be
   half-applied.
5. **Two migrations, not one.** Profiles (`010`) is additive and safe to run any time.
   The cutover (`011`) is the dangerous one. Keeping them separate means the risky file
   is small enough to read in full before running it.
6. **`scripts/verify-sessions.mjs` is part of the migration, not a follow-up.** If it is
   not updated in the same PR, `npm run verify:sessions` goes red and stays red, and per
   `lib/secrets.mjs:66-72`'s own reasoning, a check that is always red is a check nobody
   reads.
7. **Anonymous users accumulate.** Every reinstall mints a new guest row. No cleanup job
   is in scope; filed to backlog with a note that a "delete guest accounts idle > N days"
   job will be wanted before the beta scales.

---

## 6. The stories

Every acceptance criterion is tagged with how it is verified:

- **[M]** machine-verifiable — a named command or test asserts it.
- **[H]** human-only — needs a device, an eye, or a dashboard. Per
  `tests/run-all.mjs:184`, no agent may report these as PASS.
- **[M+H]** has both a machine half and a human half; both are required.

---

### ST-A01 — Supabase Auth is configured for this project

**User story:** As the product owner, I want the Supabase project's auth settings to
match the decisions this run is built on, so that no story downstream fails for a reason
that is a checkbox rather than a defect.

**Acceptance criteria**

1. **[H]** In the Supabase dashboard: email/password provider **enabled**; anonymous
   sign-ins **enabled** (OQ-A4); email confirmation **disabled** (OQ-A7b); no social
   provider enabled (OQ-A7).
2. **[M]** `node --env-file=.env scripts/verify-auth-config.mjs` exits 0 and prints a
   PASS for each of: `signUp` with a random address returns a **session** (proves
   confirmation is off); `signInAnonymously()` returns a session whose decoded JWT has
   `is_anonymous === true`; the run cleans up both users via service role.
3. **[M]** The same script FAILs, with a message naming the exact dashboard toggle, when
   any of the three is misconfigured. Verified by asserting the failure branch in a unit
   test with a stubbed client — a config verifier that cannot report a specific missing
   toggle is not useful.
4. **[M]** `SETUP-BLOCKERS.md` gains an entry for this configuration, in the file's
   existing format, including the anonymous-sign-in toggle.
5. **[M]** The script uses `EXPO_PUBLIC_SUPABASE_ANON_KEY` for the auth calls and
   `SUPABASE_SERVICE_ROLE_KEY` for cleanup only, and `npm run verify:secrets` stays
   green.

**Owner:** Human (dashboard) + Backend (the verifier)
**Dependencies:** none — start first
**Priority:** Critical
**Definition of Done:** dashboard configured; verifier committed and green;
SETUP-BLOCKERS.md updated; lint/test green.

---

### ST-A02 — The app remembers who you are across restarts

**User story:** As a technician, I want to still be signed in when I open the app the
next morning, so that I am not typing a password on a roof.

**New dependency, justified (per `CLAUDE.md`):** React Native has no `localStorage`;
supabase-js needs an explicit `auth.storage` adapter or `persistSession: true` is inert
(§1b). **Proposed: `@react-native-async-storage/async-storage`**, installed with
`npx expo install` so the version is SDK-54-correct. It is the adapter Supabase's own
Expo guidance uses, and it works on the web target the repo also builds.
**`expo-secure-store` was considered and not chosen:** it encrypts at rest, which is
better, but it has a ~2048-byte per-item limit that a Supabase session (access + refresh
token + user object) can exceed, producing a failure that appears only for some users.
Trade-off recorded rather than hidden: **the session token is stored unencrypted on
device.** Filed to backlog as "evaluate a chunked SecureStore adapter" — not a blocker
for a beta, and not something to discover later.

**Acceptance criteria**

1. **[M]** `app/lib/supabase.ts` constructs the client with `persistSession: true`,
   `autoRefreshToken: true`, `detectSessionInUrl: false`, and a `storage` adapter. A
   test in the `tests/suites/e6-app.mjs` static-analysis style asserts all four are
   present and that `persistSession: false` no longer appears in `app/`.
2. **[M]** `app/package.json` lists the storage package at an
   `npx expo install`-resolved version; `npm run build` (`tsc --noEmit` in `app/`) exits
   0 with no new errors.
3. **[M]** `npm run lint` exits 0 with no new warnings.
4. **[M]** `npm run verify:bundle` and `npm run verify:secrets` stay green — the new
   dependency introduces no `SERVER_ONLY` name or secret-shaped literal into the bundle.
5. **[H]** On the test device: sign in, force-quit the app, relaunch — the app opens
   signed in as the same user, with no auth screen.
6. **[M]** An `onAuthStateChange` subscription exists at the app shell and is unsubscribed
   on unmount (asserted statically) — a leaked listener across sign-out/sign-in is how
   stale-user bugs get in.

**Owner:** Backend
**Dependencies:** ST-A01
**Priority:** Critical
**Definition of Done:** client wired; static test committed; rails green; the [H]
criterion recorded in ST-A17's device checklist. **Releases together with ST-A05/A06.**

---

### ST-A03 — Every user has a profile, created automatically

**User story:** As a technician, I want the app to know my name and trade role, so that
it can address me and so my shop's roster shows a person rather than a uuid.

**Acceptance criteria**

1. **[M]** `sql/010_profiles.sql` exists, is guarded and re-runnable (running it twice in
   a row succeeds), and creates `public.profiles` with at minimum:
   `id uuid primary key references auth.users(id) on delete cascade`,
   `display_name text`, `trade_role text`, `active_company_id uuid` (nullable; FK added in
   `sql/012`), `created_at`, `updated_at`.
2. **[M]** RLS is enabled and a user can `select` and `update` **their own** row, and can
   `insert` nothing (rows come from the trigger) and `delete` nothing (deletion is
   ST-A12's).
3. **[M] NEGATIVE:** with user B's JWT on an **anon-key** client, `select * from profiles
   where id = <A's uuid>` returns **0 rows**, and `update profiles set display_name=…
   where id = <A's uuid>` affects 0 rows. Asserted in `scripts/verify-accounts.mjs`.
4. **[M]** A trigger on `auth.users` insert creates the profile row. Verified by: create a
   user via service role, then `select` that profile as that user → exactly 1 row, with
   `display_name` taken from sign-up metadata when present.
5. **[M]** Anonymous (guest) users also get a profile row — the trigger does not exclude
   them — so no code path has to handle a missing profile.
6. **[M]** A co-member read policy exists and is **exactly** as narrow as OQ-A1 allows:
   a user may select `display_name` and `trade_role` of another user **only** when
   `public.is_co_member(other_id)` is true. Asserted positively (co-members see each
   other) **and negatively** (a non-co-member sees 0 rows).

**Owner:** Backend
**Dependencies:** ST-A01
**Priority:** Critical
**Definition of Done:** migration committed and run; both positive and negative
assertions in `scripts/verify-accounts.mjs`; `npm run verify:sessions` unaffected.

---

### ST-A04 — Sign up, sign in, sign out

**User story:** As a technician, I want to create an account with my email and sign back
into it later, so that my job history is mine and follows me to a new phone.

**Acceptance criteria**

1. **[M+H]** An auth screen exists offering sign-up and sign-in with email + password,
   and a **"Continue without an account"** action (ST-A06). **[M]** static test: all
   three actions are present with `accessibilityRole="button"` and non-empty
   `accessibilityLabel`; **[H]** it reads correctly on device.
2. **[M]** Every colour, spacing, radius and type value comes from `app/theme/tokens.ts`.
   Static test: no raw hex literal in the new screens, matching the existing contrast/token
   checks in `tests/suites/e6-app.mjs`.
3. **[M]** All interactive targets are ≥ `MIN_TOUCH`. Static test, same pattern as the
   existing suite.
4. **[M]** Auth failures render an `ErrorState`-family component with a specific,
   human-readable message (wrong password, invalid email, network) — never a blank screen
   and never a raw Supabase error string. Static test: the catch path routes to the error
   component; a unit test maps at least three Supabase error codes to distinct copy.
5. **[M]** Sign-out clears the stored session **and** any in-memory session/message state.
   Test: after sign-out the client's `getSession()` is null and the app shell state
   holding `sessionId`/`equipment` has been reset (asserted on the reset function, which
   must exist and be called from the sign-out handler).
6. **[H]** On device: sign up → ask a question → sign out → sign back in → **the job is
   still in history**. This is brief AC 1 and it is human-verified by design.
7. **[M]** No password, email, or token is ever written to a log line, and no auth error
   string containing a password is constructed. Static test over the new files.

**Owner:** Frontend
**Dependencies:** ST-A01, ST-A02
**Priority:** Critical
**Definition of Done:** screens shipped using brand tokens; static tests committed;
criterion 6 entered in ST-A17's checklist.

---

### ST-A05 — Sessions are isolated to their owner by policy, not by the client

**User story:** As a technician, I want it to be impossible for anyone else to read my
jobs — including someone holding the app's anon key — so that "private" means enforced
rather than promised.

This is the story the schema in `sql/002` was written to make cheap. It **replaces** the
`user_id is null` predicate; it does not add a policy beside it.

**Acceptance criteria**

1. **[M]** `sql/011_session_rls_cutover.sql` exists, guarded and re-runnable, and:
   sets `sessions.user_id` `default auth.uid()`; disposes of null rows (ST-A14); sets
   `user_id` `NOT NULL`; **drops** `prototype_sessions_anon`, `prototype_messages_anon`,
   `prototype_citations_anon`; creates owner-keyed replacements on all three tables for
   the `authenticated` role only.
2. **[M]** After the migration, `select count(*) from pg_policies where schemaname='public'
   and tablename in ('sessions','messages','citations') and policyname like 'prototype_%'`
   returns **0**. The old predicate is gone, not shadowed.
3. **[M]** The new policies grant to `authenticated` only. A bare **anon** client with no
   sign-in (exactly what `scripts/verify-sessions.mjs:26` builds today) reads **0 rows**
   from all three tables and gets an RLS error (`42501`) on insert.
4. **[M] NEGATIVE — brief AC 2, the core assertion:** with an **anon-key** client
   carrying **user B's** JWT:
   - `select … from sessions where id = <A's session id>` → **0 rows**;
   - `select … from messages where session_id = <A's session id>` → **0 rows**;
   - `select … from citations` joined to A's message → **0 rows**;
   - `insert into messages (session_id = <A's session id>, …)` → **error**, and A's message
     count is unchanged;
   - `delete from sessions where id = <A's session id>` → affects 0 rows, and the row still
     exists when re-read as A;
   - `update sessions set user_id = <B's uuid> where id = <A's session id>` → affects 0 rows
     (an ownership steal must be impossible, not merely unusual).
   Service role is used **only** to create and tear down the fixtures. Any assertion made
   with the service-role client is worthless and is forbidden here.
5. **[M] NEGATIVE — OQ-A1 guard:** the same reads performed with the token of a user who
   is an **owner of A's company** also return **0 rows**. This test is the mechanical
   enforcement of the OQ-A1 decision and it must exist even though no company-read policy
   is being written — its job is to go red if someone adds one later.
6. **[M]** `app/lib/store.ts` no longer contains `.is('user_id', null)` (both call sites),
   and its stale comment at `:72-73` about the `for all` prototype policy is corrected.
   Static test asserts the string is absent from `app/`.
7. **[M]** `scripts/verify-sessions.mjs` authenticates (anonymous sign-in is sufficient)
   before its checks, and `npm run verify:sessions` exits 0 against the migrated database
   with all seven of its existing checks still passing — including the cascade-delete and
   CHECK-constraint checks, which must not be weakened to accommodate auth.
8. **[M]** A signed-in user's full lifecycle still works end to end: create session →
   append user message → append answer with citations → read back through the app's join
   → delete → messages cascade. This is `verify-sessions.mjs`'s existing body, now run
   under a real identity.
9. **[M]** The migration file contains an executable, commented rollback block restoring
   the three prototype policies and dropping `NOT NULL`, and the artifact for Stage 3
   records that the rollback was **run once** against a scratch project and worked.
10. **[M]** `sessions.company_id` is **not** referenced by any policy created here.
    Asserted by grep over the migration.

**Owner:** Backend
**Dependencies:** ST-A01, ST-A03, ST-A14 (same file); must **release with** ST-A02 and
ST-A06
**Priority:** Critical
**Definition of Done:** migration written, reviewed, run by the owner; both app files in
§1a updated in the same PR; negative tests in `scripts/verify-accounts.mjs` and the Stage
5 suite; rollback rehearsed; device build confirmed working before the branch merges.

---

### ST-A06 — The app works before you have an account, and your work survives signing up

**User story:** As a technician who just installed the app on a roof, I want to ask a
question immediately, and I want that question to still be there if I decide to make an
account afterwards.

**Acceptance criteria**

1. **[M]** On launch with no stored session, the app calls `signInAnonymously()` and
   proceeds to the normal first screen. Static test: the bootstrap exists and is not
   gated behind any UI action.
2. **[M]** A guest can complete the whole session lifecycle — create, ask, read back,
   delete — asserted against the database with a guest JWT on an anon-key client.
3. **[M] NEGATIVE:** guest A cannot read guest B's session. Same anon-key + JWT
   construction as ST-A05 AC 4. Guests are isolated from each other exactly as named
   users are.
4. **[M] NEGATIVE:** a guest cannot create a company and cannot redeem a join code.
   `create_company` and `redeem_join_code` raise a defined error for a JWT with
   `is_anonymous = true`, and no `companies`/`memberships` row is created. (Asserted once
   ST-A07/A09 land; until then this AC is BLOCKED, not PASS.)
5. **[M]** Upgrading preserves identity: for a guest with ≥1 session,
   `updateUser({ email, password })` succeeds, `auth.uid()` is **unchanged**, and every
   session created as a guest is readable afterwards with the new credentials. This is
   the criterion that makes the guest path defensible rather than a data trap.
6. **[M+H]** The app tells the truth about the guest state. **[M]** static test: the guest
   surface contains copy stating that history lives only on this device until an account
   is created; **[H]** it is legible and not buried.
7. **[M]** After upgrade, the guest-state copy is gone and the account is shown as
   permanent. Static test on the conditional.
8. **[H]** On device: fresh install → ask a question → create an account → the question is
   still in history.

**Owner:** Backend (bootstrap + upgrade) with Frontend (copy and the upgrade screen)
**Dependencies:** ST-A01, ST-A02; AC 4 additionally on ST-A07/ST-A09
**Priority:** Critical
**Definition of Done:** bootstrap and upgrade shipped; all negative tests committed;
releases with ST-A05.

---

### ST-A07 — A company exists, and the technician who creates it owns it

**User story:** As a shop owner, I want to create a company profile in the app, so that
my technicians have something to be associated with.

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
7. **[M] NEGATIVE:** an owner of company X cannot read, update, or add members to company
   Y. Cross-company isolation is asserted, not assumed.
8. **[M]** `create_company` raises a defined error for an anonymous JWT (OQ-A4) and no rows
   are written.
9. **[M]** `sessions.company_id uuid references companies(id) on delete set null` is added,
   populated on insert by a trigger from the creator's `profiles.active_company_id`, and
   **referenced by no policy** (OQ-A1/OQ-A2). Verified by: a session created by a member
   carries the stamp; deleting the company sets it null and deletes **no** session; and
   ST-A05 AC 5's owner-cannot-read test still passes.
10. **[M]** `profiles.active_company_id` gains its FK here and is set to the new company on
    creation and on successful join.
11. **[M]** Membership and role are readable from the database by a member — `select
    role from memberships where company_id = X and user_id = auth.uid()` returns exactly
    one row with the expected role. (Brief AC 3's "readable and enforced by policy".)

**Owner:** Backend
**Dependencies:** ST-A03, ST-A05
**Priority:** High
**Definition of Done:** migration committed and run; helper grants asserted; all four
negative tests in `scripts/verify-accounts.mjs`.

---

### ST-A08 — An owner manages who is in the company

**User story:** As a shop owner, I want to change a technician's role and remove someone
who has left, so that the company's roster reflects who actually works here.

**Acceptance criteria**

1. **[M]** An owner can `update memberships.role` and `delete` a membership within their
   own company. A `member` can do neither (0 rows affected).
2. **[M]** A user may always remove **their own** membership (leave the company) — unless
   doing so would leave the company with zero owners, in which case it is refused with the
   same defined error as ST-A12's sole-owner case.
3. **[M]** The last owner cannot be removed or demoted. A trigger (or a
   `SECURITY DEFINER` RPC — Stage 3's choice, stated in `03-backend.md`) raises a defined
   error `last_owner` and the transaction rolls back. Tested for both paths: delete the
   last owner's membership, and update the last owner's role to `member`.
4. **[M] NEGATIVE — brief AC 4, token-level, and the exact construction matters:**
   - as owner, remove member B;
   - then, using **the access token B already held before removal — B is not signed in
     again** (§1f) — assert B reads **0 rows** from `companies where id = X`, **0 rows**
     from `memberships where company_id = X`, cannot `update` the company, and gets a
     defined error from every company-scoped RPC for X;
   - and assert the same is still true after a token refresh.
5. **[M]** Removal is roster-only: B's own sessions, messages and citations are **all
   still readable by B** afterwards, and the count is unchanged. Removing someone from a
   shop does not touch their work (OQ-A2).
6. **[M]** `profiles.active_company_id` for B becomes null on removal (or moves to another
   membership if B has one), so B is never left pointing at a company they cannot read.
   Asserted for both the zero-remaining and one-remaining cases.
7. **[M] NEGATIVE:** an owner of company Y cannot remove a member of company X.

**Owner:** Backend
**Dependencies:** ST-A07
**Priority:** High
**Definition of Done:** last-owner guard implemented and both its paths tested; AC 4's
stale-token test committed exactly as written.

---

### ST-A09 — A second technician joins with a code

**User story:** As a technician, I want to type the code my boss read me over the phone
and be in the company, so that joining takes ten seconds on a job site.

**Acceptance criteria**

1. **[M]** `sql/013_join_codes.sql` is guarded and re-runnable and creates
   `public.company_join_codes (id uuid pk, company_id uuid not null references companies(id)
   on delete cascade, code text not null unique, created_by uuid, created_at, expires_at
   timestamptz not null, max_uses integer not null default 10 check (max_uses > 0), uses
   integer not null default 0, revoked_at timestamptz)`.
2. **[M]** Codes are ≥ 8 characters of Crockford base32 (no I, L, O, U) and carry ≥ 40 bits
   of entropy. Unit test over the generator: 10,000 generated codes have no duplicate, no
   excluded character, and pass a length check.
3. **[M] NEGATIVE:** the table is selectable **only** by owners of the owning company.
   A member reads 0 rows; a stranger reads 0 rows; an anonymous JWT reads 0 rows. A code
   can never be discovered by reading rows — only by being told it.
4. **[M]** `public.redeem_join_code(code text)` is `SECURITY DEFINER`, granted to
   `authenticated` only, and on success inserts a `member` membership for `auth.uid()`,
   increments `uses`, and sets `profiles.active_company_id`.
5. **[M]** Each failure mode returns its own defined error and creates **no** membership:
   unknown code, expired (`expires_at < now()`), revoked (`revoked_at is not null`),
   exhausted (`uses >= max_uses`), already a member, anonymous caller.
6. **[M]** Redemption is transactional under concurrency: two simultaneous redemptions of
   a code with `max_uses = 1` result in exactly one membership. Tested with two concurrent
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

**User story:** As a shop owner, I want to create my company, share a join code, and see
who is in it; and as a technician, I want to enter a code and see which company I belong
to.

**Acceptance criteria**

1. **[M+H]** Screens exist for: create a company; view company + roster + your own role;
   enter a join code. Owners additionally get: generate code, revoke code, remove member,
   change role. **[M]** static test for presence and accessibility labels; **[H]** device
   pass.
2. **[M]** Owner-only actions are not rendered for a `member` — **and** the story states
   plainly that this is cosmetic. The enforcement is ST-A08's policies, and ST-A08's
   negative tests are what prove it. No AC in this story treats hidden UI as security.
3. **[M]** Every error from `create_company` and `redeem_join_code` maps to specific copy
   (expired, revoked, already a member, unknown code, guest). Unit test over the mapping;
   an unmapped error must fall back to a generic error state, never a blank screen.
4. **[M]** Tokens: no raw hex, spacing/radius/type from `app/theme/tokens.ts`, targets
   ≥ `MIN_TOUCH`. Same static checks as ST-A04.
5. **[M]** A user with more than one membership gets a switcher that sets
   `profiles.active_company_id`; a user with one membership sees no switcher (OQ-A5).
6. **[M]** Nothing in the app routes into these screens by force. Verified by ST-A13.
7. **[H]** Reinstating a "Settings"/"Account" tab is a deliberate reversal of
   `app/components/Chrome.tsx:9-11`, which dropped it as an empty dead end. The Stage 4
   artifact must record that it now has content — this run is exactly what gives it some.

**Owner:** Frontend
**Dependencies:** ST-A07, ST-A08, ST-A09
**Priority:** High
**Definition of Done:** screens shipped on brand tokens; error mapping tested; Stage 4
artifact records the Chrome.tsx reversal.

---

### ST-A11 — Profile screen

**User story:** As a technician, I want to set my display name and trade role and sign
out, so the app knows who I am and my shop's roster shows a person.

**Acceptance criteria**

1. **[M+H]** A profile screen edits `display_name` and `trade_role` and persists them —
   asserted by reading the row back with that user's JWT.
2. **[M]** `display_name` is validated (1–60 characters after trim) client-side **and** by
   a database `check` constraint. Both asserted; the client check is convenience, the
   constraint is the rule.
3. **[M] NEGATIVE:** an update attempt against another user's profile affects 0 rows
   (already covered by ST-A03 AC 3 — this story does not re-implement it, it depends on it).
4. **[M]** Sign-out is reachable from this screen and behaves per ST-A04 AC 5.
5. **[M]** The screen is fully usable with **no company** — it shows no company section, no
   empty company card, and no "create a company to continue" prompt (brief AC 5).
6. **[M]** Tokens and touch targets, as ST-A04 AC 2–3.

**Owner:** Frontend
**Dependencies:** ST-A03, ST-A04
**Priority:** Medium
**Definition of Done:** screen shipped; validation on both sides; ST-A13's check passes
against it.

---

### ST-A12 — Delete my account, in the app

**User story:** As a technician, I want to delete my account and everything in it from
inside the app, so that leaving is as easy as joining — and because the App Store requires
it.

**Approach (per §1g):** `SECURITY DEFINER` RPC `public.delete_own_account()`, owned by
`postgres`, granted to `authenticated` only. **Fallback if the `auth` schema will not
permit it: a Supabase Edge Function holding the service-role key as a function secret.**
Under no circumstance does the service-role key move client-side (hard constraint 2).

**Acceptance criteria**

1. **[M]** `delete_own_account()` exists, is `SECURITY DEFINER` with
   `set search_path`, is `revoke execute … from public, anon`, and is granted to
   `authenticated`. Grants asserted against `information_schema`.
2. **[M]** Happy path, verified with **service role after the fact** (the only correct use
   of service role here — proving absence, not asserting access): for a user with 2
   sessions, 6 messages and 4 citations, after the RPC there are **0** rows for that user
   in `sessions`, `messages`, `citations`, `profiles`, `memberships`, and **0** rows in
   `auth.users` for that uuid.
3. **[M]** The user's old JWT is useless afterwards: a read with it returns 0 rows /
   errors, and `refreshSession` fails.
4. **[M]** Sole owner of a company **with other members**: the RPC raises the defined error
   `sole_owner_of_company`, **nothing is deleted** (all six row counts unchanged — the
   transaction is atomic), and the error payload names the company so the UI can act on it.
5. **[M]** Sole owner of a company **with no other members**: the company, its memberships
   and its join codes are deleted in the same transaction; the user is deleted.
6. **[M]** A member (not owner), or an owner where another owner remains: deletion
   proceeds; the company survives, and the **remaining members' sessions are untouched**
   (count asserted before and after).
7. **[M]** Deleting a user sets `sessions.company_id` to null on **no** other user's
   rows — one user's deletion must not modify another's data. Asserted.
8. **[M+H]** The UI requires an explicit confirmation (typed confirmation or equivalent
   deliberate act), states exactly what is destroyed and that it is irreversible, and for
   the sole-owner case offers the two paths the user can complete alone (promote an owner,
   or delete the company). **[M]** static test for the confirmation gate and the presence
   of both paths; **[H]** the wording reads clearly on device.
9. **[M]** A guest (anonymous) user can also delete their account by the same path.
10. **[M]** `npm run verify:secrets` and `npm run verify:bundle` stay green. Static test:
    the string `SUPABASE_SERVICE_ROLE_KEY` appears nowhere under `app/`.
11. **[M]** If the fallback (Edge Function) is taken, `03-backend.md` records why, and the
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

1. **[M]** A user with **zero** memberships completes the full lifecycle against the live
   database with their own JWT: create session → append question → append answer with
   citations → read back → delete → cascade verified. Identical assertions to
   `scripts/verify-sessions.mjs`, run as a company-less user.
2. **[M]** No policy on `sessions`, `messages`, `citations`, or `profiles` requires a
   membership row to exist. Verified by grep over `sql/010`–`sql/014` for `memberships`
   inside those tables' policies — the only permitted reference is `is_co_member` on the
   profiles co-member read (ST-A03 AC 6), which is additive and never restrictive.
3. **[M]** No screen is unreachable without a company. Static test: no navigation guard or
   early-return in `app/screens/**` is conditioned on `active_company_id` or a company
   object being non-null, except within the company screens themselves.
4. **[M]** `profiles.active_company_id is null` never causes a thrown error or an empty
   render in any shared component. Unit-tested by rendering the shell and each shared
   component with a null company.
5. **[H]** A human walks the entire app signed in as a company-less user — every tab, every
   screen, the capture flow, history, profile — and confirms no dead end, no empty company
   card, and no prompt to create one. Recorded in ST-A17.
6. **[M]** No copy anywhere implies a company is required. Static test: the new screens
   contain no string matching `/must (create|join) a compan/i`.

**Owner:** Test (machine half) + Frontend (fixes) + Human (walk-through)
**Dependencies:** ST-A05, ST-A10, ST-A11
**Priority:** Critical
**Definition of Done:** all machine checks in the Stage 5 suite; the human walk-through
logged in `05-test-report.md` as HUMAN-ONLY with a result.

---

### ST-A14 — The prototype's ownerless rows get a decided fate

**User story:** As the owner, I want to know exactly what happened to the rows created
before accounts existed, so that no orphaned session is left readable by every
authenticated user.

Brief AC 7. Same migration file as ST-A05, separate story because destroying data is a
decision, not an implementation detail.

**Acceptance criteria**

1. **[M]** `sql/011` opens with a **count-first** query
   (`select count(*) from public.sessions where user_id is null`) whose result the owner
   sees before anything destructive runs, and a comment stating exactly what the next
   statements do.
2. **[M]** The file contains, in this order and clearly labelled: (a) an **optional,
   commented-out** "claim to this uuid" block the owner may run *instead* — a single
   `update public.sessions set user_id = '<uuid>' where user_id is null;` — and (b) the
   **default**, uncommented `delete from public.sessions where user_id is null;`, which
   cascades to messages and citations.
3. **[M]** After the migration, `select count(*) from public.sessions where user_id is
   null` returns **0**, and `user_id` is `NOT NULL` (asserted against
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

**Owner:** Backend, with a Human decision gate
**Dependencies:** part of ST-A05
**Priority:** Critical
**Definition of Done:** disposition written into `sql/011`; post-migration assertions in
the Stage 5 suite; the owner's choice recorded in `03-backend.md`.

---

### ST-A15 — The isolation harness

**User story:** As the test agent, I want one harness that mints real users and real JWTs
and asserts every isolation claim in this run against RLS with the anon key, so that
"isolated" is a measured fact and not a design intention.

**Acceptance criteria**

1. **[M]** `scripts/verify-accounts.mjs` exists, is wired as `npm run verify:accounts`,
   and follows `scripts/verify-sessions.mjs`'s conventions (PASS/FAIL lines, non-zero exit
   on failure, `--env-file=.env`).
2. **[M]** It creates fixtures — users A, B, a company owner, and a company — via the
   **service-role** client, then performs **every assertion** through
   `createClient(url, ANON_KEY)` clients carrying each user's real JWT. The file states
   this constraint at the top in the house voice, and any assertion made with the
   service-role client (other than fixture setup and the absence-proving reads in ST-A12
   AC 2) is a review-blocking defect.
3. **[M]** It tears down every fixture it created, including on failure, so repeated runs
   do not accumulate users.
4. **[M]** It covers, at minimum, every criterion marked **NEGATIVE** in ST-A03, ST-A05,
   ST-A06, ST-A07, ST-A08, ST-A09 and ST-A12 — enumerated in the artifact so coverage is
   checkable rather than claimed.
5. **[M]** `tests/suites/e9-accounts.mjs` exposes the same checks to `tests/run-all.mjs`
   with correct `story`/`ac` attribution to this file, and reports **BLOCKED** (never
   FAIL) when Supabase env is absent — matching `tests/run-all.mjs`'s stated contract.
6. **[M]** Every check names the brief AC it serves, so `05-test-report.md` maps back to
   `00-brief-accounts.md` without a human re-deriving it.
7. **[M]** The suite fails if any prototype policy still exists or if any company-read
   policy has appeared on `sessions`/`messages`/`citations` (the OQ-A1 guard).

**Owner:** Test
**Dependencies:** the stories it asserts; the harness scaffold can start in Wave 0
**Priority:** Critical
**Definition of Done:** script and suite committed; run green; coverage table in
`05-test-report.md`.

---

### ST-A16 — The rails stay green

**User story:** As the owner, I want the existing quality gates to be exactly as green
after this run as before it, so identity work cannot smuggle in a regression.

**Acceptance criteria**

1. **[M]** `npm run lint` exits 0 with **no new warnings** against the Wave-0 baseline
   recorded in ST-A16a. (Brief AC 8.)
2. **[M]** `npm run build` (`tsc --noEmit` in `app/`) exits 0.
3. **[M]** `npm test` (`node --test`) exits 0, including every new `*.test.mjs`.
4. **[M]** `npm run verify:secrets` exits 0. (Brief AC 9.)
5. **[M]** `npm run verify:bundle` exits 0 — no `SERVER_ONLY` name and no secret-shaped
   literal in the bundle after the new dependency and the new auth code.
6. **[M]** `npm run verify:sessions` exits 0 post-cutover, with all seven of its original
   checks intact (ST-A05 AC 7).
7. **[M]** `npm run verify:accounts` exits 0.
8. **[M]** `.pipeline/backlog.md` gains entries for, at minimum: Sign in with Apple as a
   launch blocker the moment any social provider is added (OQ-A7); re-enabling email
   confirmation before public release (OQ-A7b); password reset (§9); a chunked SecureStore
   adapter (ST-A02); guest-account cleanup (§5.7); and join-code brute-force rate limiting
   (ST-A09).
9. **[M]** No `.env`, key, token or password appears in any commit from this run.

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

1. **[H]** Fresh install → the app opens straight into use as a guest, with no auth wall.
2. **[H]** Ask a question as a guest → create an account → the question is still in
   history. (ST-A06.)
3. **[H]** Sign out → sign back in → history is intact. **This is brief AC 1.**
4. **[H]** Force-quit and relaunch → still signed in. (ST-A02.)
5. **[H]** Two accounts on the same device (or two devices): A's history is not visible to
   B anywhere in the UI. The eyeball companion to ST-A05's machine proof — not a substitute
   for it, and not a substitute the other way either.
6. **[H]** Create a company on device A; join it with the code on device B; B appears in
   the roster on A; **B's jobs do not appear anywhere on A.** (OQ-A1, seen rather than
   asserted.)
7. **[H]** Owner removes B; B's next action against company data fails cleanly with
   readable copy rather than a crash or a silent empty screen.
8. **[H]** The full company-less walk-through from ST-A13 AC 5.
9. **[H]** Delete the account on device B → sign-in with those credentials fails → history
   is gone.
10. **[H]** Every screen added this run reads correctly on the device's real size, in
    sunlight-grade contrast, with the shipped brand assets.

**Owner:** Human
**Dependencies:** all
**Priority:** Critical
**Definition of Done:** every item ticked with a date and a device name in
`05-test-report.md`'s human-only checklist.

---

### ST-A18 — The app states the privacy posture where it matters

**User story:** As a technician being asked to join my employer's company, I want to be
told what my employer can and cannot see **before** I join, so I am not guessing.

OQ-A1 is a promise. This story is where the promise is made to the user rather than only
to the database.

**Acceptance criteria**

1. **[M]** The join-code screen and the create-company screen each display copy stating,
   in plain language, that the company can see the member's name, trade role and role in
   the company, and **cannot** see their jobs, questions, answers or citations. Static
   test asserts the copy is present on both screens.
2. **[M]** The same statement appears on the company screen for an existing member, so it
   is discoverable after joining and not only at the moment of joining.
3. **[M]** The copy is not conditional, collapsible-away by default, or rendered below the
   fold of the primary action. Static test: it is not inside a collapsed-by-default
   component and precedes the join/create button in the tree.
4. **[M]** A test asserts the *claim matches the schema*: the copy is accurate only while
   no company-read policy exists on `sessions`/`messages`/`citations`, so this story's
   check is wired to ST-A15's OQ-A1 guard. **If someone later adds that policy without
   changing this copy, the app is lying to users and the suite goes red.** That coupling
   is the point of the story.
5. **[H]** The wording is reviewed by the owner for tone and accuracy before release —
   this is a promise the product is making, and it should not be written solely by an
   agent.

**Owner:** Frontend, with Human review
**Dependencies:** ST-A10, ST-A15
**Priority:** High
**Definition of Done:** copy shipped on all three surfaces; the schema-coupling test
committed; owner sign-off recorded.

---

### ST-A19 — Identity changed nothing about what the product says

**User story:** As the eval agent, I want proof that adding accounts did not alter a
single answer, citation or refusal, so that `CLAUDE.md`'s two domain rules are demonstrably
untouched by this run.

**Acceptance criteria**

1. **[M]** The existing refusal probes (`tests/probes/safety-coverage-probes.mjs`) are
   re-run after the cutover and produce **identical** verdicts to the pre-run baseline. Any
   difference is a Critical defect in this run, regardless of direction — an identity
   change has no business moving a safety verdict.
2. **[M]** The citation checker (`tests/checkers/citation-check.mjs`) and the reachability
   probe produce identical verdicts pre- and post-run.
3. **[M]** `git diff` for this run touches **no** file under `lib/` implementing retrieval,
   prompting, citation anchoring or the safety gate, and no file under `ingest/`. Asserted
   by a path allowlist so an accidental edit is caught in review, not in an eval.
4. **[M]** The gate remains pre-model and deterministic: no story in this run introduces a
   code path where authentication state influences whether a refusal is issued. A refusal
   is a refusal for a guest, a member, and an owner alike, and a test asserts the safety
   evaluation takes no identity input.
5. **[M]** Zero-quota by construction — these probes never reach the model, so this story
   costs no Gemini budget and can run on any day.

**Owner:** Eval
**Dependencies:** ST-A05, ST-A16
**Priority:** High
**Definition of Done:** identical verdicts recorded in `055-eval.md` with the pre/post
comparison shown, not summarized.

---

## 7. Traceability — brief AC → stories

| Brief AC | Covered by | Verification |
|---|---|---|
| **1** — sign up, sign out, sign back in; history intact; **proven on the device** | ST-A04, ST-A02, ST-A06 · device proof **ST-A17 AC 3** | [H] on device + [M] lifecycle tests |
| **2** — only own sessions; negative test with B's token, **against RLS with the anon key** | **ST-A05 AC 3–5**, ST-A06 AC 3, ST-A15 | [M] `verify:accounts` + `e9-accounts` suite |
| **3** — create a company; a second user joins; membership + role readable and policy-enforced | ST-A07 (AC 4, 11), ST-A09, ST-A10 | [M] RPC + policy tests |
| **4** — admin removes a member; access lost **immediately**, token-level test | **ST-A08 AC 4** (stale token, no re-login) | [M] token-level test — see §8 for the scope caveat |
| **5** — solo user, full use, no dead ends, nothing gated | **ST-A13** (all), ST-A11 AC 5, ST-A10 AC 6 | [M] policy grep + lifecycle + [H] walk-through |
| **6** — in-app deletion; defined fate for sessions and a solely-owned company | **ST-A12** (all), OQ-A6 | [M] every branch + [H] copy |
| **7** — `user_id is null` rows disposed; no orphans readable by all | **ST-A14** (all), ST-A05 AC 1–2 | [M] post-migration counts + constraint check |
| **8** — lint, build, test exit 0 with no new warnings | **ST-A16 AC 1–3**, baseline in ST-A16a | [M] exit codes vs baseline |
| **9** — no secret leaves the server; `verify:secrets` green | **ST-A16 AC 4–5**, ST-A12 AC 10–11, ST-A02 AC 4 | [M] `verify:secrets`, `verify:bundle` |

**Brief criteria with no story: none.** All nine are covered.

**Additional coverage not demanded by the numbered list but required by the brief's
scope or by `CLAUDE.md`:** the guest path (hard constraint 5 → ST-A06), the privacy
disclosure that OQ-A1 obliges (ST-A18), and the domain-rule attestation (ST-A19).

---

## 8. Criteria flagged as at-risk, human-only, or contested

Flagged rather than hidden, per the charter.

1. **Brief AC 1 is not machine-verifiable and must never be reported as PASS by an agent.**
   "Proven on the device, not only in a test" is human-only by construction. ST-A17 AC 3 is
   the record. The machine tests around it are supporting evidence, not the criterion.

2. **Brief AC 4 is narrower than it may read, and the narrowing comes from OQ-A1.**
   The criterion says a removed member "immediately loses whatever company-scoped access
   the stories define". Under the OQ-A1 default there is **no** company-scoped access to
   session data at all, so the test asserts loss of the company row, the roster, and the
   admin RPCs. That is the full company-scoped surface this run creates. **If the owner
   overturns OQ-A1, ST-A08 AC 4 must be re-scoped to also assert loss of session read** —
   and the OQ-A1 guard tests in ST-A05 AC 5, ST-A15 AC 7 and ST-A18 AC 4 all change with
   it. Written here so the dependency is visible before, not after.

3. **"Immediately" is true at the row level, not the token level.** JWTs cannot be revoked
   mid-life (§1f). Access ends on the next request because the policies join to
   `memberships` at query time; the stale token authenticates but authorizes nothing. Any
   future design that caches membership into a JWT claim would silently break this
   criterion — noted so nobody "optimizes" it that way.

4. **Account deletion is the run's highest technical risk (§1g).** If a `SECURITY DEFINER`
   function cannot delete from `auth.users` in the current Supabase project, ST-A12 falls
   back to an Edge Function, which adds a CLI login, a deploy surface, and a Human setup
   task — schedule impact, not a scope change. The criterion itself (AC 6) remains
   achievable either way. **Stage 3 should test this specific capability first**, before
   building the rest of ST-A12, because it decides the shape of the story.

5. **`persistSession: true` requires a new dependency (§1b).** Not infeasible, but it is a
   dependency addition on a project pinned to Expo SDK 54 for a specific test phone
   (`app/AGENTS.md`). It must be installed with `npx expo install` and the SDK-54-correct
   version pinned, or brief AC 8's "no new warnings" fails on a peer-version warning that
   has nothing to do with accounts.

6. **Email confirmation off is a knowingly accepted weakness for the beta (OQ-A7b).** It
   permits address squatting. It is acceptable for a closed beta and is **not** acceptable
   at public launch; ST-A16 files it as a launch blocker.

7. **No password reset ships in this run (§9).** A beta tester who forgets their password
   is locked out with no self-service path. Stated plainly rather than discovered.

8. **Join-code brute force is bounded but not rate-limited.** Entropy, expiry, use limits
   and a non-readable table make it impractical, but there is no request-rate limit at the
   database. Filed to backlog with the reasoning.

9. **Nothing in the brief is judged infeasible.** All nine criteria are achievable as
   written, subject to items 1–4 above being read as scoping and scheduling facts rather
   than as escapes.

---

## 9. Deliberately not built in this run

Each with the risk of not building it, stated:

| Not built | Why | Risk if it stays unbuilt |
|---|---|---|
| Billing, Stripe, RevenueCat, seats-as-licences | Explicitly out of scope. A seat here is a membership row. | None this run. E13/E16 own it. |
| Web admin console, marketing site | Out of scope (E14/E16, Phases 3–4). | None this run. |
| SSO / SAML | Out of scope. | None. |
| Sign in with Apple / any social provider | OQ-A7 — offering none keeps us compliant; native SIWA needs E10. | **Becomes a launch blocker the day any social provider is added.** Backlog. |
| Password reset | Needs mail delivery + deep links, the same infrastructure OQ-A3 declined. | A locked-out beta tester has no self-service path. **Launch blocker.** Backlog. |
| Email change | Same mail dependency. | Minor for a beta. Backlog. |
| Company-visible technician history | OQ-A1 default. | A shop owner may ask for it. Re-open via a dated Stage 0 amendment with disclosure shipping first. |
| Aggregate/anonymized company analytics | Out — it is the thin end of OQ-A1 and E11 owns instrumentation and its disclosure. | None this run. |
| Guest-account cleanup job | Not needed at beta scale. | Guest rows accumulate against MAU. Backlog. |
| Audit log of membership changes | No requirement yet; E16 territory. | A disputed removal has no record. Backlog. |
| Encrypted-at-rest session token | ST-A02's SecureStore size limit. | Token readable on a rooted/jailbroken device. Backlog. |

---

**Stage 2 complete.** Stage 2.5 (Knowledge) has **nothing to do** in this run and should
record that and hand off to Stage 3. Stage 3 starts with ST-A01 and the §8.4 capability
test, in that order.
