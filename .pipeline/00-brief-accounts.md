# 00 — Brief · Accounts & company profiles

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.

> **This is a separate run from Run B.** `.pipeline/00-brief.md` is Run B's (the
> diagnostic core) and Run B is still open, so this brief lives beside it rather
> than replacing it. Stage 2 writes `.pipeline/02-user-stories-accounts.md`.
>
> **Owner instruction, 7 Aug 2026, verbatim:** *"user profiles and company
> profiles… I want user to be able to log in and / or set up a company profile
> which can have multiple users associated to it."*

## Objective

Give Ductective identity. A technician can create an account and sign in; a
company can exist as its own profile with **multiple technicians associated to
it**; and every technician's work is isolated to them under row-level security
rather than by convention.

The "and / or" in the owner's instruction is load-bearing and is a hard
requirement, not a nicety: **a solo technician with no company must be a
first-class user.** Most HVAC techs in the target market are independent or work
for a shop that will never buy seats. A design that makes a company mandatory
locks out the majority of Phase 2's beta audience.

## Where this sits in the plan

This pulls forward **E9 (Accounts & identity)** and the *data-model half* of
**E16 (Company seats & admin console)** from `docs/phase1-story-map.md:800,777`.
The story map flags the org data model as a "decide first" — the owner has now
decided its direction, which is what unblocks Stage 2 writing testable criteria.

**The schema was built for this and must be used as intended.** `sql/002` already
carries `sessions.user_id uuid` (nullable, deliberately — its own comment says
"cheap-now / expensive-later"), and the prototype RLS policies are written so that
E9 **replaces the predicate rather than retrofitting RLS onto tables that never
had it**. Any story that bolts a second policy alongside `user_id is null` instead
of replacing it is doing the expensive thing the schema already paid to avoid.

## In scope

- **Authentication.** Supabase Auth: sign-up, sign-in, sign-out, session
  persistence across app restarts. The app client currently sets
  `auth: { persistSession: false }` (`app/lib/supabase.ts`) — that flips.
- **User profile.** A profile row per authenticated user: display name, trade
  role, and whatever the app needs to greet and identify them.
- **Company profile.** An organization entity a user can create, with a name and
  the fields a shop needs to identify itself.
- **Membership.** Many users to one company, with a **role** (at minimum: an
  owner/admin who can manage membership, and a member who cannot).
- **Joining.** A path for a second technician to become associated with an
  existing company. The mechanism (email invite, join code, or admin-adds-by-email)
  is a Stage 2 decision — record it as an OPEN QUESTION with a proposed default.
- **Per-user data isolation.** RLS on `sessions`/`messages`/`citations` keyed to
  the authenticated user, replacing the `user_id is null` prototype predicate.
- **Account deletion, in-app.** An App Store requirement, not optional
  (`story-map:E9`). Must state what happens to that user's sessions, and what
  happens to a company when its last owner deletes their account.
- **Migration of existing prototype data.** Rows created before accounts existed
  have `user_id = null`. Say explicitly what becomes of them.

## Out of scope

- **All billing.** Stripe, seats-as-a-paid-unit, RevenueCat, entitlement sync,
  the $39/seat and $199/shop pricing. That is E16's billing half and E13. A
  "seat" here is a membership row, not a purchased licence.
- **The web admin console** (E16, Phase 4). Company management happens in the
  existing Expo app for now.
- **Marketing site** (E14).
- **SSO / SAML / enterprise directory.**
- Anything that changes the diagnostic core, retrieval, citations, or the safety
  gate. This run adds identity around the product; it does not touch what the
  product says.

## Hard constraints

1. **Supabase Auth is the mechanism.** The stack already has it; a second identity
   system is not justifiable.
2. **The anon key stays the only key in the app bundle.** `scripts/sync-app-env.mjs`
   withholds the service-role key from `app/.env` and `lib/secrets.mjs` enforces it.
   No story may move a privileged key client-side.
3. **RLS is the isolation mechanism, not application-layer filtering.** A `where
   user_id = …` in client code that RLS does not also enforce is a defect, because
   the anon key ships in the bundle and the client is not trusted.
4. **Sign in with Apple** must be offered wherever any third-party sign-in is
   offered — an App Store rule (`story-map:E15`). If the stories propose Google or
   any social provider, Apple comes with it or the app is rejected.
5. **Do not regress Phase 1.** The device build must keep working through the
   transition. Whether that means an anonymous/guest path or a forced sign-in wall
   is a Stage 2 decision — but "the prototype stops working until accounts ship"
   is not an acceptable answer.
6. **Never weaken a safety or citation guarantee to make an identity story pass.**
   `CLAUDE.md`'s two domain rules bind every stage, including this one.

## Acceptance criteria — what "done" means

Each must be objectively verifiable, and Stage 2 must write the verification into
every story:

1. A new technician can sign up, sign out, and sign back in, and their history is
   still there — proven on the device, not only in a test.
2. A signed-in technician sees **only** their own sessions. Proven by a negative
   test: user A's session id, requested with user B's token, returns nothing —
   asserted **against RLS with the anon key**, not by trusting client code.
3. A user can create a company, and a second user can become associated with it.
   Membership and role are readable from the database and enforced by policy.
4. An admin can remove a member; the removed member immediately loses whatever
   company-scoped access the stories define, proven by a token-level test.
5. A solo user with **no** company retains full use of the product, with no
   dead-end screens and nothing gated behind creating one.
6. In-app account deletion removes the account and states — and implements — a
   defined fate for that user's sessions and for a company they solely owned.
7. Existing `user_id is null` prototype rows have a stated, implemented
   disposition. No orphaned rows readable by every authenticated user.
8. `npm run lint`, `npm run build`, `npm test` exit 0 with no new warnings.
9. No secret leaves the server. `npm run verify:secrets` stays green.

## What Stage 2 must decide and record

Genuine ambiguities. Do **not** guess silently — record each as an `OPEN QUESTION`
with a proposed default and proceed on the default, per `CLAUDE.md`:

- **Does a company see its technicians' jobs?** A shop owner may expect visibility;
  a technician may reasonably not expect their employer reading every question they
  asked. This is a privacy decision with a real defensible answer either way, and
  it drives the entire RLS shape. Treat it as the most consequential open question
  in the run.
- **Session ownership:** does a session belong to the user, the company, or the
  user with a company stamp on it?
- **Join mechanism:** invite email, join code, or admin-adds-by-email.
- **Guest path:** does an unauthenticated user still get to use the app?
- **One company per user, or many?**
- **Company deletion** and what happens to its members' data.

## Sequencing note

Stage 1 (research) has **not** run for this brief. Stage 2 should read the code it
needs directly — `sql/002_prototype_sessions.sql`, `app/lib/supabase.ts`,
`app/lib/store.ts`, `scripts/sync-app-env.mjs`, `lib/secrets.mjs` — and record in
its artifact anything it had to establish that a research pass would normally have
handed it.
