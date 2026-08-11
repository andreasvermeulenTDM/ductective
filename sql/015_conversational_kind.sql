-- 015_conversational_kind.sql — ST-F06 (F2, "an ordinary message gets an
-- ordinary reply"). Run in the Supabase SQL Editor. Guarded; re-runnable.
--
-- ---------------------------------------------------------------------------
-- Why this file has to exist before the F2 build ships
-- ---------------------------------------------------------------------------
-- sql/002_prototype_sessions.sql:39 constrains the rendering contract:
--
--     kind text not null check (kind in ('user', 'answer', 'clarify', 'refusal'))
--
-- `app/lib/store.ts` persists the wire `kind` verbatim, so the new
-- `conversational` kind works for a **guest** (state only, nothing written) and
-- **fails the insert for every signed-in user**. Not a slow degradation: the
-- first "thanks" a signed-in technician sends is a failed write.
--
-- ---------------------------------------------------------------------------
-- Why `clarify` was not reused instead (02-user-stories-fixes.md §2.2)
-- ---------------------------------------------------------------------------
-- Reusing an existing kind would have avoided this migration, and it was
-- rejected on three counts, all of which are about the data being read back
-- later rather than about it being written now:
--
--  1. `listSessions`' derived counters (`store.ts:166-174`) read `kind` to say
--     what a job contains. A "thanks" turn filed as `clarify` reads as an open
--     clarification the technician never answered.
--  2. The clarify continuation loop treats a `clarify` turn as a question
--     awaiting a reply. A pleasantry filed there would put a session into a
--     state it can never leave.
--  3. sql/002's own comment says `kind` is the rendering contract, not
--     decoration: E6.4 requires an uncited diagnostic claim to be unrenderable,
--     and the UI switches on this column to enforce it. A conversational reply
--     is uncited **and legitimately so** — it makes no diagnostic claim — which
--     is precisely a distinction the column has to be able to carry. Collapsing
--     it into `clarify` would hide the one thing this column exists to say.
--
-- The reply body itself is a server-side constant (`lib/conversation.mjs`), never
-- model-authored, so nothing stored under this kind can be uncited *diagnostic*
-- content. That guarantee is in the code, not in this constraint; this constraint
-- only has to stop being in the way of it.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
-- One CHECK constraint on `public.messages`, widened. No column is added,
-- dropped or retyped; no row is read, written or deleted; no policy, grant,
-- index or function changes. `documents` and `chunks` are not touched. Every
-- value that was legal before is still legal, so this cannot invalidate an
-- existing row and there is nothing to roll back beyond re-adding the narrower
-- constraint.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- The widened rendering contract
-- ---------------------------------------------------------------------------
-- Drop-then-add rather than a second constraint: two overlapping CHECKs would
-- both have to be found and read by the next person trying to answer "what kinds
-- are legal". The house pattern from sql/005 and sql/006.
--
-- The constraint is named explicitly. sql/002 declared it inline, so Postgres
-- generated `messages_kind_check`; the drop below covers both that name and the
-- explicit one, so this file is correct whether it runs against a database
-- created by sql/002 or one that has already had this migration applied.
alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
  check (kind in ('user', 'answer', 'clarify', 'refusal', 'conversational'));

-- ---------------------------------------------------------------------------
-- Verify (optional — `npm run verify:conversational-kind` does this for you)
-- ---------------------------------------------------------------------------
-- select pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.messages'::regclass and conname = 'messages_kind_check';
--
-- Expect:
--   CHECK ((kind = ANY (ARRAY['user'::text, 'answer'::text, 'clarify'::text,
--                             'refusal'::text, 'conversational'::text])))
