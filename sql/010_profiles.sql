-- 010_profiles.sql — run in the Supabase SQL Editor. ST-A03.
--
-- SAFE TO RUN AT ANY TIME. This file is purely additive: it creates one new
-- table and one trigger, and it touches nothing that exists. It does not touch
-- `sessions`, `messages`, `citations`, `documents` or `chunks`, so it can be run
-- while an ingest is in flight. The dangerous file is 011, not this one — see
-- .pipeline/02-user-stories-accounts.md §5.7 for why they are separate.
--
-- Guarded and re-runnable: running it twice succeeds and changes nothing.
--
-- ---------------------------------------------------------------------------
-- What a profile is, and what it deliberately is not
-- ---------------------------------------------------------------------------
-- One row per authenticated user, created by the database rather than by the
-- app. Auto-provisioning matters more than it looks: if the client created its
-- own profile row, then every code path that reads a profile would have to cope
-- with it being missing, and one path would eventually forget. ST-A03 AC 5 puts
-- that in writing — the trigger has **no** provider condition, so a user who
-- arrives via Apple or Google gets a profile on exactly the same terms as one
-- who arrives with a password.
--
-- `active_company_id` is declared here but its foreign key arrives in 012, where
-- `companies` exists. Same for the co-member read policy ST-A03 AC 6 asks for:
-- it needs `public.is_co_member()`, which needs `memberships`, which is 012's.
-- Splitting it that way keeps each file runnable on its own rather than making
-- 010 depend on a table three files ahead of it.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,

  -- Nullable: a user who signs up with a password has not told us their name
  -- yet, and blocking sign-up on it would put a form between a technician on a
  -- roof and their first answer. The length rule is the rule (ST-A11 AC 2); the
  -- client-side check is convenience.
  display_name       text,
  trade_role         text,

  -- Which company new sessions are stamped with (OQ-A2/OQ-A5). Nullable and
  -- expected to stay null for most users — a solo technician is a first-class
  -- user (brief AC 5), not a degraded one.
  active_company_id  uuid,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    alter table public.profiles
      add constraint profiles_display_name_len
      check (display_name is null or length(btrim(display_name)) between 1 and 60);
  end if;

  -- Free text with a length bound rather than a fixed vocabulary. Recorded as an
  -- OPEN QUESTION in .pipeline/03-backend-accounts.md: "Service Technician",
  -- "Refrigeration Tech" and "Apprentice" are all real answers and no list we
  -- guess at today survives contact with a beta. Widening a length check later
  -- costs nothing; migrating off a wrong enum costs a migration.
  if not exists (select 1 from pg_constraint where conname = 'profiles_trade_role_len') then
    alter table public.profiles
      add constraint profiles_trade_role_len
      check (trade_role is null or length(btrim(trade_role)) between 1 and 60);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-provision — one profile per auth user, created by the database
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the inserting role during sign-up is GoTrue's, not
-- ours. `search_path` is pinned, which is the standard hazard with definer
-- functions and the reason sql/001's health probe pins it too.
--
-- `on conflict do nothing` makes it idempotent, so a provider that re-inserts
-- (or a backfill run twice) cannot fail sign-up. **Sign-up must never fail
-- because of this trigger** — a technician who cannot create an account because
-- of a profile row is a worse outcome than a missing display name, so the name
-- lookup is defensive about metadata shapes rather than assuming one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text;
begin
  -- Every key a provider might use. Apple sends `full_name` on the FIRST
  -- authorization only and never again (§1k), so if it is present here it is the
  -- only chance the database will ever get it.
  name := nullif(btrim(coalesce(
    meta->>'display_name',
    meta->>'full_name',
    meta->>'name',
    ''
  )), '');

  insert into public.profiles (id, display_name)
  values (new.id, left(name, 60))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- NOTE: creating a trigger on `auth.users` requires privilege on a schema this
-- project does not own. It is the pattern Supabase's own documentation uses and
-- it is expected to work — but ST-A12 taught this run not to assume anything
-- about `auth`, so `sql/probe_auth_delete_capability.sql` checks this too. If
-- this statement raises `must be owner of relation users`, stop and report it:
-- the fallback is to provision the profile from an RPC on first sign-in, which
-- is a different (and worse) design, not a tweak.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for anyone who already exists. Idempotent.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Read your own row, update your own row. You may not INSERT (rows come from the
-- trigger, so a client cannot manufacture a profile for a uuid it does not own)
-- and you may not DELETE (deletion is ST-A12's, and it goes through an RPC that
-- also removes the auth user — a client-side profile delete would leave an
-- account with no profile and no way back).
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- The `anon` role has no business here. Guest mode (OQ-A4) writes nothing and
-- reads nothing from the database at all, so there is no unauthenticated access
-- to preserve.
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Verify (paste separately after running the file)
-- ---------------------------------------------------------------------------
-- select count(*) as profiles, (select count(*) from auth.users) as users
--   from public.profiles;
-- select policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename = 'profiles' order by policyname;
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'profiles' order by grantee;
