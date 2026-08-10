-- 012_companies.sql — ST-A07, ST-A08. Companies, memberships, roles.
--
-- Additive with one exception: it adds `sessions.company_id` and the trigger that
-- stamps it. That is a column addition with a default of null, so it takes a brief
-- ACCESS EXCLUSIVE lock on `sessions` only — not on `documents` or `chunks`, which
-- this file never mentions.
--
-- Guarded and re-runnable.
--
-- ---------------------------------------------------------------------------
-- Two design decisions this file is built on. Do not "simplify" either.
-- ---------------------------------------------------------------------------
--
-- 1. **No policy on `memberships` may sub-select `memberships`.** A policy whose
--    USING clause reads its own table re-enters itself and Postgres raises
--    `infinite recursion detected in policy for relation "memberships"` — at
--    runtime, for real users, not at migration time. It is the single most common
--    way a Supabase org model ships broken (§1c). Every company-side policy below
--    therefore calls a SECURITY DEFINER helper, which reads `memberships` as the
--    table owner and so is not subject to the policy at all.
--
--    This is also why `force row level security` is NOT set on `memberships`:
--    forcing RLS on the owner would reintroduce exactly the recursion the helpers
--    exist to avoid.
--
-- 2. **A company cannot be created by a plain INSERT.** "You may insert a company
--    you will own" plus "only an owner may add members" makes the first company
--    uncreatable — the company row cannot exist for the membership to point at,
--    and the membership cannot exist to authorize the company (§1e). Loosening
--    either policy opens a hole. So INSERT on `companies` is granted to nobody and
--    `public.create_company()` writes both rows in one transaction.
--
-- ---------------------------------------------------------------------------
-- The privacy decision, in the schema (OQ-A1 — RESOLVED BY OWNER: NO)
-- ---------------------------------------------------------------------------
-- A company sees its roster. It sees no session, no message, no citation, ever.
-- Nothing in this file grants read access to `sessions`, `messages` or
-- `citations`, and `sessions.company_id` — added here — is referenced by **no
-- policy anywhere**. It is a historical stamp (OQ-A2), not an access key.
--
-- Adding a company-read policy on those three tables requires a signed Stage 0
-- brief amendment with the in-app disclosure shipping first. ST-A05 AC 5,
-- ST-A15 AC 7 and ST-A18 AC 4 exist to turn the test suite red if it happens.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  city        text,
  region      text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Roles are `text` + `check`, matching `messages.kind` in sql/002. Widening a
-- check constraint is cheaper than altering a type, and a third role
-- ("dispatcher", "office") is plausible enough to plan for (OQ-A8).
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);

drop trigger if exists companies_touch_updated_at on public.companies;
create trigger companies_touch_updated_at
  before update on public.companies
  for each row execute function public.touch_updated_at();

-- `profiles.active_company_id` gets its foreign key now that the target exists
-- (ST-A07 AC 10). `set null`, because losing a company must never orphan a user.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_active_company_fkey') then
    alter table public.profiles
      add constraint profiles_active_company_fkey
      foreign key (active_company_id) references public.companies(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers — the anti-recursion layer
-- ---------------------------------------------------------------------------
-- Each reads `memberships` with the owner's rights, so the policies that call
-- them do not re-enter themselves. `set search_path` is pinned: an unpinned
-- definer function is the standard privilege-escalation hazard.
create or replace function public.is_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.memberships m
     where m.company_id = p_company_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_company_owner(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.memberships m
     where m.company_id = p_company_id
       and m.user_id = auth.uid()
       and m.role = 'owner'
  );
$$;

-- ST-A03 AC 6 lives here rather than in 010, because it needs `memberships`.
-- "Co-member" is the narrowest relation OQ-A1 permits: you may see the person,
-- because a roster of uuids is useless, and nothing else.
create or replace function public.is_co_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.memberships mine
      join public.memberships theirs on theirs.company_id = mine.company_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user_id
  );
$$;

revoke execute on function public.is_member(uuid)        from public, anon;
revoke execute on function public.is_company_owner(uuid) from public, anon;
revoke execute on function public.is_co_member(uuid)     from public, anon;
grant  execute on function public.is_member(uuid)        to authenticated;
grant  execute on function public.is_company_owner(uuid) to authenticated;
grant  execute on function public.is_co_member(uuid)     to authenticated;

-- ---------------------------------------------------------------------------
-- The co-member profile read (ST-A03 AC 6)
-- ---------------------------------------------------------------------------
-- Additive and never restrictive: it widens what a member may see, and no policy
-- on `profiles`, `sessions`, `messages` or `citations` ever *requires* a
-- membership. A solo technician with zero memberships is unaffected by every
-- statement in this file (brief AC 5 / ST-A13 AC 2).
drop policy if exists profiles_select_co_member on public.profiles;
create policy profiles_select_co_member on public.profiles
  for select to authenticated
  using (public.is_co_member(id));

-- ---------------------------------------------------------------------------
-- Policies — companies
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;

-- A company is not discoverable by a stranger who guesses its uuid (AC 5).
drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies
  for select to authenticated
  using (public.is_member(id));

drop policy if exists companies_update_owner on public.companies;
create policy companies_update_owner on public.companies
  for update to authenticated
  using (public.is_company_owner(id))
  with check (public.is_company_owner(id));

drop policy if exists companies_delete_owner on public.companies;
create policy companies_delete_owner on public.companies
  for delete to authenticated
  using (public.is_company_owner(id));

-- Deliberately no INSERT policy, and the privilege is revoked as well. Both,
-- because a policy alone would be re-grantable by a later `grant all`.
revoke all on public.companies from anon;
revoke insert on public.companies from authenticated;
grant select, update, delete on public.companies to authenticated;

-- ---------------------------------------------------------------------------
-- Policies — memberships
-- ---------------------------------------------------------------------------
alter table public.memberships enable row level security;

drop policy if exists memberships_select_member on public.memberships;
create policy memberships_select_member on public.memberships
  for select to authenticated
  using (public.is_member(company_id));

drop policy if exists memberships_insert_owner on public.memberships;
create policy memberships_insert_owner on public.memberships
  for insert to authenticated
  with check (public.is_company_owner(company_id));

drop policy if exists memberships_update_owner on public.memberships;
create policy memberships_update_owner on public.memberships
  for update to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

-- An owner may remove anyone in their own company; anyone may remove themselves
-- (ST-A08 AC 2). The last-owner guard below is what stops either from emptying
-- the company of owners.
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.is_company_owner(company_id) or user_id = (select auth.uid()));

revoke all on public.memberships from anon;
grant select, insert, update, delete on public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- The roster view — what a company may read about a person, exactly
-- ---------------------------------------------------------------------------
-- RLS is row-level; it cannot restrict *columns*. This view is where the column
-- narrowing OQ-A1 describes actually happens: name, trade role, company role,
-- join date. Nothing else. `security_invoker = true` (Postgres 15+, and this
-- project is 17) makes the view run with the *caller's* rights, so both
-- underlying policies still apply — without it a view owned by `postgres` would
-- quietly bypass RLS and become the hole this run exists to close.
create or replace view public.company_roster
with (security_invoker = true) as
  select m.company_id,
         m.user_id,
         m.role,
         m.created_at as joined_at,
         p.display_name,
         p.trade_role
    from public.memberships m
    join public.profiles p on p.id = m.user_id;

revoke all on public.company_roster from anon;
grant select on public.company_roster to authenticated;

-- ---------------------------------------------------------------------------
-- create_company (ST-A07 AC 4) — the chicken-and-egg breaker
-- ---------------------------------------------------------------------------
create or replace function public.create_company(name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  clean text := btrim(coalesce(name, ''));
begin
  -- Belt and braces with the `authenticated`-only grant. A definer function that
  -- assumes a caller is authenticated is one misconfigured grant away from being
  -- callable by anyone.
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001',
      hint = 'Sign in before creating a company.';
  end if;

  if length(clean) < 1 or length(clean) > 120 then
    raise exception 'company_name_invalid' using errcode = 'P0001',
      detail = 'name must be 1-120 characters after trimming',
      hint = 'Enter the company name.';
  end if;

  insert into public.companies (name, created_by) values (clean, uid)
    returning id into new_id;

  insert into public.memberships (company_id, user_id, role)
    values (new_id, uid, 'owner');

  -- The creator starts working under it. Sessions created from now on carry the
  -- stamp; nothing already created is re-stamped (OQ-A2 — the stamp is a fact
  -- about the past, and rewriting the past is how audit trails become fiction).
  update public.profiles set active_company_id = new_id where id = uid;

  return new_id;
end;
$$;

revoke execute on function public.create_company(text) from public, anon;
grant  execute on function public.create_company(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The last-owner guard (ST-A08 AC 3)
-- ---------------------------------------------------------------------------
-- A company with zero owners is unadministrable and unrecoverable in-app: nobody
-- can generate a code, remove a member, or delete it. So the last owner cannot be
-- removed and cannot be demoted, and both paths raise the same defined error.
--
-- The `companies` existence check is what lets a company still be deleted: an
-- ON DELETE CASCADE removes the memberships *after* the parent row is gone, so
-- this trigger sees no company and stands aside. Without it, deleting a company
-- would raise `last_owner` and be impossible.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  -- NEW is unassigned in a DELETE trigger and referencing it there raises, so
  -- everything below reads OLD and the return value is chosen by TG_OP.
  result public.memberships := case when tg_op = 'DELETE' then old else new end;
  owners_left integer;
begin
  if old.role <> 'owner' then
    return result;                   -- members are free to come and go
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return result;                   -- an owner staying an owner: no risk
  end if;
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return result;                   -- the company itself is being deleted
  end if;

  select count(*) into owners_left
    from public.memberships m
   where m.company_id = old.company_id
     and m.role = 'owner'
     and m.id <> old.id;

  if owners_left = 0 then
    raise exception 'last_owner' using errcode = 'P0001',
      detail = old.company_id::text,
      hint = 'Promote another member to owner, or delete the company.';
  end if;

  return result;
end;
$$;

drop trigger if exists memberships_guard_last_owner on public.memberships;
create trigger memberships_guard_last_owner
  before update or delete on public.memberships
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Nobody is left pointing at a company they cannot read (ST-A08 AC 6)
-- ---------------------------------------------------------------------------
create or replace function public.reset_active_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.profiles p
     set active_company_id = (
           select m.company_id from public.memberships m
            where m.user_id = old.user_id
            order by m.created_at
            limit 1)
   where p.id = old.user_id
     and p.active_company_id = old.company_id;
  return old;
end;
$$;

drop trigger if exists memberships_reset_active_company on public.memberships;
create trigger memberships_reset_active_company
  after delete on public.memberships
  for each row execute function public.reset_active_company();

-- ---------------------------------------------------------------------------
-- sessions.company_id — the stamp that grants nothing (ST-A07 AC 9)
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists company_id uuid references public.companies(id) on delete set null;

-- Derived, never accepted from the client. If the app could set it, it would be a
-- claim rather than a fact, and a claim is not worth recording.
create or replace function public.stamp_session_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.company_id := (select p.active_company_id from public.profiles p where p.id = new.user_id);
  return new;
end;
$$;

drop trigger if exists sessions_stamp_company on public.sessions;
create trigger sessions_stamp_company
  before insert on public.sessions
  for each row execute function public.stamp_session_company();

-- ---------------------------------------------------------------------------
-- Verify (paste separately)
-- ---------------------------------------------------------------------------
-- -- no policy on the three private tables mentions company_id or memberships:
-- select tablename, policyname, qual::text from pg_policies
--  where schemaname='public' and tablename in ('sessions','messages','citations');
-- -- helper grants are authenticated-only:
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--  where routine_schema='public'
--    and routine_name in ('is_member','is_company_owner','is_co_member','create_company')
--  order by routine_name, grantee;
-- -- nobody may insert a company directly:
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='companies' order by grantee;
