-- probe_auth_delete_capability.sql — RUN THIS FIRST, before sql/010.
--
-- Not a migration. It is deliberately un-numbered so it never lands in the
-- ordered migration list: it creates one function, answers one question, and
-- drops the function again.
--
-- ===========================================================================
-- The question
-- ===========================================================================
-- ST-A12 (in-app account deletion) is an App Store requirement. Deleting the
-- `auth.users` row normally needs the service-role key, which
-- `scripts/sync-app-env.mjs` structurally withholds from the app bundle and
-- `lib/secrets.mjs` lists as SERVER_ONLY. Brief hard constraint 2 forbids moving
-- it client-side.
--
-- `.pipeline/02-user-stories-accounts.md` §1g gives two ways out:
--
--   (A) a SECURITY DEFINER function owned by `postgres` that deletes from
--       auth.users itself — no new hosting, no deploy surface, no key anywhere
--       near the bundle;
--   (B) a Supabase Edge Function holding the service-role key as a function
--       secret — correct, but it adds a CLI login, a deploy step and a
--       Human-owned setup task.
--
-- §8.4 calls this the run's highest technical risk and says Stage 3 must test
-- the capability **before** building the rest of ST-A12, because the permissions
-- a definer function has over the `auth` schema are Supabase's to change and
-- have changed before. An agent cannot run SQL against this project — the owner
-- runs every statement by hand in the SQL Editor — so this is the smallest
-- possible thing to paste in to get the answer.
--
-- ===========================================================================
-- Why this is safe to run right now, including during an ingest
-- ===========================================================================
--  * It deletes nothing. The DELETE targets the all-zeroes uuid, which is not a
--    real user, so a permitted delete removes 0 rows and a forbidden one raises
--    42501 before touching anything.
--  * It never touches `documents` or `chunks`.
--  * It takes no heavy lock: at most a momentary RowExclusiveLock on auth.users.
--  * It drops the function it created, so the database is byte-identical after.
--
-- ===========================================================================
-- How to run it
-- ===========================================================================
-- Paste the whole file into the Supabase SQL Editor and run it. It prints ONE
-- row with ONE column. Send that value back — it decides which half of
-- sql/014_account_deletion.sql ships:
--
--   'CAN_DELETE'  → path (A). Grant `public.delete_own_account()` and ship it.
--                   No Edge Function, no CLI login, no extra Human task.
--   'CANNOT_...'  → path (B). Ship `public.delete_own_account_data()` only, and
--                   add the Edge Function described in .pipeline/03-backend-accounts.md.
--
-- Either answer is fine and neither is a defect. sql/014 is written so that both
-- entry points already exist; the probe decides which one the app calls.
-- ---------------------------------------------------------------------------

create or replace function public._ductective_probe_auth_delete()
returns text
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  -- The all-zeroes uuid. Guaranteed absent: gen_random_uuid() cannot produce it,
  -- and no provider issues it. So this statement's only observable effect is
  -- whether it is *allowed*, which is the entire question.
  delete from auth.users where id = '00000000-0000-0000-0000-000000000000'::uuid;
  return 'CAN_DELETE';
exception
  when insufficient_privilege then
    return 'CANNOT_DELETE — insufficient_privilege: ' || sqlerrm;
  when undefined_table then
    return 'CANNOT_DELETE — auth.users not visible to a definer function: ' || sqlerrm;
  when others then
    return 'CANNOT_DELETE — ' || sqlstate || ': ' || sqlerrm;
end;
$$;

-- Nobody but the person running this needs it, and it is about to be dropped.
revoke execute on function public._ductective_probe_auth_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Second question, same round trip: may we put a trigger on auth.users?
-- ---------------------------------------------------------------------------
-- sql/010's profile auto-provisioning depends on it. It is the pattern Supabase's
-- own documentation uses and it is expected to work — but this run has already
-- been surprised once by `auth`, and finding out here costs nothing.
create or replace function public._ductective_probe_auth_trigger()
returns text
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  execute 'create trigger _ductective_probe_trg after insert on auth.users '
       || 'for each row execute function public._ductective_probe_noop()';
  execute 'drop trigger _ductective_probe_trg on auth.users';
  return 'CAN_TRIGGER';
exception
  when others then
    return 'CANNOT_TRIGGER — ' || sqlstate || ': ' || sqlerrm;
end;
$$;

create or replace function public._ductective_probe_noop()
returns trigger language plpgsql set search_path = public, pg_catalog
as $$ begin return new; end; $$;

select public._ductective_probe_auth_delete()  as auth_delete_capability,
       public._ductective_probe_auth_trigger() as auth_trigger_capability;

-- Leave nothing behind.
drop function if exists public._ductective_probe_auth_delete();
drop function if exists public._ductective_probe_auth_trigger();
drop function if exists public._ductective_probe_noop();
