-- 013_join_codes.sql — ST-A09. A second technician joins with a code.
--
-- Additive and safe to re-run. Touches nothing that exists except by adding a
-- table and two functions.
--
-- ---------------------------------------------------------------------------
-- Why a code and not an email invite (OQ-A3 — RESOLVED BY OWNER)
-- ---------------------------------------------------------------------------
-- An email invite needs a deliverable transactional mailer, a template and a
-- deep-link scheme, none of which this repo has; Supabase's built-in mailer is
-- rate-limited hard on the free tier — measured on this project on 10 Aug 2026,
-- `email rate limit exceeded` after a handful of sign-ups. Admin-adds-by-email
-- needs an email→uid lookup from the client, which is an enumeration oracle over
-- the whole user table. A code is how this actually happens on a job: the owner
-- reads eight characters down the phone.
--
-- ---------------------------------------------------------------------------
-- What makes the code safe
-- ---------------------------------------------------------------------------
--  * **The table is not readable except by owners of the owning company.** A code
--    can never be found by reading rows — only by being told it.
--  * 10 characters of Crockford base32 = 50 bits. Crockford excludes I, L, O and
--    U precisely so a code survives being read aloud and written down.
--  * Expiry (14 days by default), a use limit, and revocation, all enforced in
--    the RPC rather than in the UI — a rule enforced only client-side is not a
--    rule, because the anon key ships in the bundle.
--  * Redemption is a SECURITY DEFINER RPC, so the joining technician never needs
--    read access to the code table at all.
--
-- **Residual risk, named rather than hidden:** there is no request-rate limit at
-- the database, so online brute force is bounded by entropy and expiry rather
-- than prevented. At 50 bits with a 14-day window and a use limit that is
-- impractical, but it is not nothing. Filed to .pipeline/backlog.md.

create table if not exists public.company_join_codes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  max_uses    integer not null default 10 check (max_uses > 0),
  uses        integer not null default 0,
  revoked_at  timestamptz
);

create index if not exists company_join_codes_company_idx
  on public.company_join_codes (company_id);

-- ---------------------------------------------------------------------------
-- The generator
-- ---------------------------------------------------------------------------
-- Server-side, so the client cannot choose a weak code for a company it owns.
-- `lib/join-code.mjs` mirrors this alphabet and its unit test is what proves the
-- distribution and the excluded characters; the two are kept honest by
-- `scripts/verify-accounts.mjs`, which validates codes the RPC actually issued
-- against the JS validator rather than trusting either side on its own.
create or replace function public.generate_join_code(p_length integer default 10)
returns text
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- Crockford: no I, L, O, U
  out_code text := '';
  i integer;
begin
  for i in 1..p_length loop
    -- gen_random_bytes would be better still, but it lives in pgcrypto and this
    -- project pins only pgvector. 32 is a power of two, so the modulo below is
    -- unbiased over a uniform source.
    out_code := out_code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return out_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security (ST-A09 AC 3)
-- ---------------------------------------------------------------------------
alter table public.company_join_codes enable row level security;

drop policy if exists join_codes_select_owner on public.company_join_codes;
create policy join_codes_select_owner on public.company_join_codes
  for select to authenticated
  using (public.is_company_owner(company_id));

drop policy if exists join_codes_update_owner on public.company_join_codes;
create policy join_codes_update_owner on public.company_join_codes
  for update to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

drop policy if exists join_codes_delete_owner on public.company_join_codes;
create policy join_codes_delete_owner on public.company_join_codes
  for delete to authenticated
  using (public.is_company_owner(company_id));

-- No INSERT policy: codes are minted by the RPC, which is the only place the
-- generator runs.
revoke all on public.company_join_codes from anon;
revoke insert on public.company_join_codes from authenticated;
grant select, update, delete on public.company_join_codes to authenticated;

-- ---------------------------------------------------------------------------
-- create_join_code (ST-A09 AC 7, AC 9)
-- ---------------------------------------------------------------------------
create or replace function public.create_join_code(
  p_company_id uuid,
  p_expires_days integer default 14,
  p_max_uses integer default 10
)
returns table (id uuid, code text, expires_at timestamptz, max_uses integer, uses integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  new_code text;
  attempts integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_company_owner(p_company_id) then
    raise exception 'not_company_owner' using errcode = 'P0001',
      hint = 'Only an owner of this company can create a join code.';
  end if;
  if p_expires_days < 1 or p_expires_days > 90 then
    raise exception 'expiry_out_of_range' using errcode = 'P0001',
      detail = '1-90 days';
  end if;
  if p_max_uses < 1 or p_max_uses > 100 then
    raise exception 'max_uses_out_of_range' using errcode = 'P0001',
      detail = '1-100';
  end if;

  -- The unique index is the real collision guard; this loop only avoids surfacing
  -- a 23505 to the owner for what is a 1-in-2^50 event.
  loop
    attempts := attempts + 1;
    new_code := public.generate_join_code(10);
    exit when not exists (select 1 from public.company_join_codes c where c.code = new_code);
    if attempts > 8 then
      raise exception 'code_generation_failed' using errcode = 'P0001';
    end if;
  end loop;

  return query
    insert into public.company_join_codes (company_id, code, created_by, expires_at, max_uses)
    values (p_company_id, new_code, auth.uid(),
            now() + make_interval(days => p_expires_days), p_max_uses)
    returning company_join_codes.id,
              company_join_codes.code,
              company_join_codes.expires_at,
              company_join_codes.max_uses,
              company_join_codes.uses;
end;
$$;

revoke execute on function public.create_join_code(uuid, integer, integer) from public, anon;
grant  execute on function public.create_join_code(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_join_code (ST-A09 AC 4, 5, 6)
-- ---------------------------------------------------------------------------
-- Every failure mode gets its own defined error and creates NO membership. The
-- `for update` is what makes AC 6 true: two simultaneous redemptions of a
-- `max_uses = 1` code serialize on the row, so the second one sees `uses = 1` and
-- is refused. Checking then updating without the lock would let both through,
-- which is the classic way a seat limit becomes a suggestion.
create or replace function public.redeem_join_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  uid uuid := auth.uid();
  rec public.company_join_codes;
  normalized text := upper(btrim(coalesce(code, '')));
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001',
      hint = 'Sign in before joining a company.';
  end if;

  select * into rec from public.company_join_codes c
   where c.code = normalized
   for update;

  if not found then
    raise exception 'join_code_unknown' using errcode = 'P0001',
      hint = 'Check the code and try again.';
  end if;
  if rec.revoked_at is not null then
    raise exception 'join_code_revoked' using errcode = 'P0001',
      hint = 'Ask for a new code.';
  end if;
  if rec.expires_at < now() then
    raise exception 'join_code_expired' using errcode = 'P0001',
      hint = 'Ask for a new code.';
  end if;
  if rec.uses >= rec.max_uses then
    raise exception 'join_code_exhausted' using errcode = 'P0001',
      hint = 'Ask for a new code.';
  end if;
  if exists (select 1 from public.memberships m
              where m.company_id = rec.company_id and m.user_id = uid) then
    raise exception 'already_a_member' using errcode = 'P0001',
      detail = rec.company_id::text;
  end if;

  insert into public.memberships (company_id, user_id, role)
    values (rec.company_id, uid, 'member');

  update public.company_join_codes set uses = uses + 1 where id = rec.id;
  update public.profiles set active_company_id = rec.company_id where id = uid;

  return rec.company_id;
end;
$$;

revoke execute on function public.redeem_join_code(text) from public, anon;
grant  execute on function public.redeem_join_code(text) to authenticated;

-- Revoking a code is an ordinary UPDATE under join_codes_update_owner, so no RPC
-- is needed:  update public.company_join_codes set revoked_at = now() where id = …

-- ---------------------------------------------------------------------------
-- Verify (paste separately)
-- ---------------------------------------------------------------------------
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--  where routine_schema='public' and routine_name in ('create_join_code','redeem_join_code')
--  order by routine_name, grantee;
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='company_join_codes' order by policyname;
