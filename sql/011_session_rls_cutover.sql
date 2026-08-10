-- 011_session_rls_cutover.sql — ST-A05 + ST-A14.
--
-- ###########################################################################
-- ##  STOP. THIS IS A RELEASE STEP, NOT A SCHEMA CHORE.                    ##
-- ###########################################################################
--
-- The moment this file runs, every app build without auth stops working:
-- `app/lib/store.ts`'s `.is('user_id', null)` returns nothing, and its inserts
-- are refused. Run it **only when the auth-carrying build is already loaded on
-- the test device.** .pipeline/02-user-stories-accounts.md §5.1 says so, and §4
-- ties this file to ST-A02 (session persistence), ST-A06 (the guest route) and
-- ST-A05 shipping as ONE release.
--
-- It also DESTROYS DATA by default. Read the disposition block before you run it.
--
-- ---------------------------------------------------------------------------
-- Before you start
-- ---------------------------------------------------------------------------
--  1. sql/010_profiles.sql has been run.
--  2. The build on the phone signs in. If it does not, run nothing here.
--  3. You have read ST-A14 below and decided delete-or-claim.
--
-- Safe with respect to the ingest: this touches `sessions`, `messages` and
-- `citations` only. It does not read, write or lock `documents` or `chunks`.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
--  * `sessions.user_id` gains `default auth.uid()`, so the database stamps
--    ownership and the client never has to remember to (§1d). The app diff is a
--    deletion, not an addition, and forging an owner becomes impossible rather
--    than merely unusual.
--  * Rows with `user_id is null` are disposed of (ST-A14).
--  * `sessions.user_id` becomes NOT NULL, ordered *after* the disposition so a
--    skipped disposition fails loudly instead of half-applying (ST-A14 AC 5).
--  * The three `prototype_*_anon` policies are **dropped**, not shadowed. The
--    brief is explicit that E9 replaces the `user_id is null` predicate rather
--    than bolting a second policy beside it.
--  * The `anon` role is revoked outright on all three tables. Under OQ-A4 the
--    guest route never touches the database, so there is no legitimate
--    unauthenticated read or write left to preserve.
--
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- STEP 0 — ST-A14 AC 1: COUNT FIRST. Run this line on its own and read it.
-- ---------------------------------------------------------------------------
select count(*) as ownerless_sessions from public.sessions where user_id is null;

-- Expected on 10 Aug 2026: 4. These are prototype rows created before accounts
-- existed. Every one of them is mock diagnostic content typed during design work.
--
-- The next statement DELETES them, and cascades to their messages and citations.
-- There is no undo. If any of it is worth keeping, run the CLAIM block instead.

-- ---------------------------------------------------------------------------
-- STEP 1a — OPTIONAL. Claim the prototype rows instead of destroying them.
-- ---------------------------------------------------------------------------
-- Run this INSTEAD OF step 1b, not as well as it. Replace the uuid with the one
-- from Authentication → Users for the account that should inherit them. That
-- account must already exist, or the foreign key added in step 3 will reject it.
--
--   update public.sessions
--      set user_id = 'PASTE-YOUR-USER-UUID-HERE'::uuid
--    where user_id is null;

-- ---------------------------------------------------------------------------
-- STEP 1b — DEFAULT. Destroy them.
-- ---------------------------------------------------------------------------
-- Cascades to `messages` and `citations` via the ON DELETE CASCADE in sql/002.
delete from public.sessions where user_id is null;

-- ---------------------------------------------------------------------------
-- STEP 2 — the database stamps ownership, not the client
-- ---------------------------------------------------------------------------
alter table public.sessions alter column user_id set default auth.uid();

-- ---------------------------------------------------------------------------
-- STEP 3 — ownership becomes structural
-- ---------------------------------------------------------------------------
-- NOT NULL first: if step 1 was skipped this raises, which is the interlock
-- ST-A14 AC 5 asks for. A half-applied cutover is worse than a failed one.
alter table public.sessions alter column user_id set not null;

-- The foreign key is what makes ST-A12's "deleting a user removes their work"
-- structural rather than a promise the RPC has to keep. sql/002 left it off
-- because `auth.users` was not in play yet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_user_id_fkey') then
    alter table public.sessions
      add constraint sessions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create index if not exists sessions_user_updated_idx
  on public.sessions (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- STEP 4 — replace the prototype predicate
-- ---------------------------------------------------------------------------
-- ST-A05 AC 2: after this, `select count(*) from pg_policies where tablename in
-- ('sessions','messages','citations') and policyname like 'prototype_%'` is 0.
drop policy if exists prototype_sessions_anon  on public.sessions;
drop policy if exists prototype_messages_anon  on public.messages;
drop policy if exists prototype_citations_anon on public.citations;

alter table public.sessions  enable row level security;
alter table public.messages  enable row level security;
alter table public.citations enable row level security;

-- `(select auth.uid())` rather than a bare `auth.uid()`: the sub-select is
-- evaluated once as an InitPlan instead of once per row. On a history list this
-- is the difference between one call and one call per session.
drop policy if exists sessions_owner on public.sessions;
create policy sessions_owner on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The messages and citations policies reach the owner through the session, which
-- is the only place ownership lives. Note what is NOT here: `company_id` is not
-- referenced by any policy in this file (ST-A05 AC 10 / OQ-A1). A company sees
-- its roster and nothing a technician asked. Adding a company-read policy on
-- these three tables requires a signed Stage 0 brief amendment.
drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages
  for all to authenticated
  using (exists (select 1 from public.sessions s
                  where s.id = messages.session_id
                    and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                  where s.id = messages.session_id
                    and s.user_id = (select auth.uid())));

drop policy if exists citations_owner on public.citations;
create policy citations_owner on public.citations
  for all to authenticated
  using (exists (select 1 from public.messages m
                   join public.sessions s on s.id = m.session_id
                  where m.id = citations.message_id
                    and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.messages m
                   join public.sessions s on s.id = m.session_id
                  where m.id = citations.message_id
                    and s.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- STEP 5 — revoke `anon` outright (ST-A05 AC 3)
-- ---------------------------------------------------------------------------
-- Not "unable to satisfy a predicate" — no privilege at all. Two different
-- things, and only one of them survives someone later writing a permissive
-- policy by mistake.
revoke all on public.sessions  from anon;
revoke all on public.messages  from anon;
revoke all on public.citations from anon;

grant select, insert, update, delete on public.sessions  to authenticated;
grant select, insert, update, delete on public.messages  to authenticated;
grant select, insert, update, delete on public.citations to authenticated;

-- ---------------------------------------------------------------------------
-- Verify (paste separately)
-- ---------------------------------------------------------------------------
-- select count(*) as should_be_zero from public.sessions where user_id is null;
-- select is_nullable from information_schema.columns
--   where table_schema='public' and table_name='sessions' and column_name='user_id';
-- select count(*) as prototype_policies_left from pg_policies
--   where schemaname='public' and tablename in ('sessions','messages','citations')
--     and policyname like 'prototype_%';
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name in ('sessions','messages','citations')
--     and grantee = 'anon';
-- Then, from the repo:  npm run verify:sessions && npm run verify:accounts

-- ###########################################################################
-- ##  ROLLBACK — ST-A05 AC 9                                               ##
-- ###########################################################################
-- Rehearse this on a scratch project before you need it. An untested rollback is
-- fiction. Note plainly what it does NOT do: the rows deleted in step 1b are
-- gone, and no rollback brings them back. This restores the *schema and policy*
-- state of sql/002 so a pre-auth build works again; it does not restore data.
--
-- Uncomment the whole block to run it.
--
--   drop policy if exists sessions_owner  on public.sessions;
--   drop policy if exists messages_owner  on public.messages;
--   drop policy if exists citations_owner on public.citations;
--
--   alter table public.sessions alter column user_id drop not null;
--   alter table public.sessions alter column user_id drop default;
--   alter table public.sessions drop constraint if exists sessions_user_id_fkey;
--
--   grant select, insert, update, delete on public.sessions  to anon;
--   grant select, insert, update, delete on public.messages  to anon;
--   grant select, insert, update, delete on public.citations to anon;
--
--   create policy prototype_sessions_anon on public.sessions
--     for all to anon, authenticated
--     using (user_id is null) with check (user_id is null);
--
--   create policy prototype_messages_anon on public.messages
--     for all to anon, authenticated
--     using (exists (select 1 from public.sessions s
--                     where s.id = messages.session_id and s.user_id is null))
--     with check (exists (select 1 from public.sessions s
--                     where s.id = messages.session_id and s.user_id is null));
--
--   create policy prototype_citations_anon on public.citations
--     for all to anon, authenticated
--     using (exists (select 1 from public.messages m
--                      join public.sessions s on s.id = m.session_id
--                     where m.id = citations.message_id and s.user_id is null))
--     with check (exists (select 1 from public.messages m
--                      join public.sessions s on s.id = m.session_id
--                     where m.id = citations.message_id and s.user_id is null));
--
-- After a rollback the app must be reverted too: `store.ts` needs its two
-- `.is('user_id', null)` filters back, or the history list reads other people's
-- rows. Rolling back the database alone is not rolling back the release.
