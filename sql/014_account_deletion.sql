-- 014_account_deletion.sql — ST-A12. Delete my account, from inside the app.
--
-- An App Store requirement, not a feature. Additive and re-runnable.
--
-- ###########################################################################
-- ##  RUN sql/probe_auth_delete_capability.sql FIRST.                      ##
-- ###########################################################################
--
-- §1g of .pipeline/02-user-stories-accounts.md gives two ways to satisfy Apple's
-- in-app deletion requirement without ever moving the service-role key toward the
-- bundle, and §8.4 calls the choice between them the run's highest technical risk
-- because the privileges a SECURITY DEFINER function has over the `auth` schema
-- are Supabase's to change and have changed before.
--
-- **This file installs both entry points, so the probe picks one rather than
-- causing a rewrite:**
--
--   public.delete_own_account_data()  — everything except the auth.users row.
--                                       Always works. Never needs `auth`.
--   public.delete_own_account()       — the above, plus the auth.users row, in
--                                       one transaction.
--
--   probe says CAN_DELETE     → the app calls delete_own_account(). Done.
--                               No Edge Function, no CLI login, no extra human task.
--   probe says CANNOT_DELETE  → the app calls a `delete-account` Edge Function,
--                               which calls delete_own_account_data() with the
--                               caller's JWT and then auth.admin.deleteUser()
--                               with the service-role key held as a FUNCTION
--                               SECRET. The key still never reaches app/.env,
--                               which scripts/sync-app-env.mjs structurally
--                               prevents anyway. `npm run measure:authdelete`
--                               has already confirmed that admin.deleteUser works
--                               on this project, so path (B) is known-good.
--
-- Either way the whole thing is ONE transaction and it is atomic: if the auth
-- delete is refused, nothing is deleted. A half-deleted account — app rows gone,
-- login still working — is the worst outcome available here and is worse than a
-- failure the user can see.
--
-- ---------------------------------------------------------------------------
-- What deletion means here (OQ-A6)
-- ---------------------------------------------------------------------------
-- Hard delete. Not soft-deleted, not anonymized: Apple requires deletion, there
-- is no billing or audit reason to retain, and under OQ-A1 nobody else could see
-- the data anyway. Profile, memberships, sessions, messages, citations, and the
-- auth user with all its linked identities.
--
--  * **Sole owner of a company that still has other members** → refused with the
--    defined error `sole_owner_of_company`, nothing deleted, and the company id in
--    `detail` so the UI can offer the two paths the user can complete alone:
--    promote another member to owner, or delete the company. Auto-promoting the
--    longest-tenured member was rejected — it makes someone an administrator
--    without their consent.
--  * **Sole owner of a company with no other members** → the company, its
--    memberships and its join codes go with them, same transaction, no prompt.
--  * **A member, or an owner with another owner remaining** → the company
--    survives untouched and so does every other member's work.

-- A uid-explicit companion to is_company_owner(), because the deletion query
-- needs to ask about a *specified* user rather than about auth.uid(). Same
-- definer posture, same pinned search_path, same anti-recursion reason (§1c).
create or replace function public.is_company_owner_of(p_user_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.memberships m
     where m.company_id = p_company_id
       and m.user_id = p_user_id
       and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- delete_own_account_data — everything the `public` schema owns
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_account_data()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  uid uuid := auth.uid();
  blocker uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001',
      hint = 'Sign in before deleting your account.';
  end if;

  -- Refuse before destroying anything. The check and the deletes are in one
  -- transaction, so this is belt and braces rather than the only guard — but a
  -- user who is told "no" after their sessions are already gone has been lied to.
  select m.company_id into blocker
    from public.memberships m
   where m.user_id = uid
     and m.role = 'owner'
     and not exists (
       select 1 from public.memberships other
        where other.company_id = m.company_id
          and other.user_id <> uid
          and other.role = 'owner')
     and exists (
       select 1 from public.memberships other
        where other.company_id = m.company_id
          and other.user_id <> uid)
   limit 1;

  if blocker is not null then
    raise exception 'sole_owner_of_company' using errcode = 'P0001',
      detail = blocker::text,
      hint = 'Promote another member to owner, or delete the company, then try again.';
  end if;

  -- Companies this user solely owns and nobody else is in. Deleting the company
  -- cascades to its memberships and join codes; `guard_last_owner` stands aside
  -- because the company row is gone by the time the cascade reaches memberships.
  delete from public.companies c
   where public.is_company_owner_of(uid, c.id)
     and not exists (
       select 1 from public.memberships other
        where other.company_id = c.id and other.user_id <> uid);

  -- Any remaining memberships are ones where another owner survives, or where
  -- this user was a plain member. Removing them fires reset_active_company for
  -- nobody but this user, who is about to cease to exist.
  delete from public.memberships m where m.user_id = uid;

  -- Sessions cascade to messages and citations (sql/002). No other user's rows
  -- are touched: every delete here is keyed to this uid, and `sessions.company_id`
  -- on anyone else's row is unaffected because no company they are in is removed.
  delete from public.sessions s where s.user_id = uid;

  delete from public.profiles p where p.id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_own_account — the above plus the auth user, atomically
-- ---------------------------------------------------------------------------
-- If the `delete from auth.users` is refused, the exception rolls the whole
-- transaction back and `auth_delete_unavailable` tells the client to take the
-- Edge Function path. The user's data is untouched either way.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001',
      hint = 'Sign in before deleting your account.';
  end if;

  perform public.delete_own_account_data();

  begin
    -- Cascades to auth.identities, so an Apple- or Google-linked user cannot be
    -- left with a dangling identity that could re-authenticate into a "deleted"
    -- account (ST-A12 AC 3). That is the specific hole OQ-A7 opened.
    delete from auth.users u where u.id = uid;
  exception
    when insufficient_privilege or undefined_table then
      raise exception 'auth_delete_unavailable' using errcode = 'P0001',
        detail = sqlerrm,
        hint = 'This project does not permit a definer function to delete from auth.users. Use the delete-account Edge Function (path B in sql/014).';
  end;
end;
$$;

revoke execute on function public.delete_own_account_data() from public, anon;
revoke execute on function public.delete_own_account()      from public, anon;
revoke execute on function public.is_company_owner_of(uuid, uuid) from public, anon;
grant  execute on function public.delete_own_account_data() to authenticated;
grant  execute on function public.delete_own_account()      to authenticated;
grant  execute on function public.is_company_owner_of(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify (paste separately)
-- ---------------------------------------------------------------------------
-- select routine_name, security_type from information_schema.routines
--  where routine_schema='public'
--    and routine_name in ('delete_own_account','delete_own_account_data');
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--  where routine_schema='public'
--    and routine_name in ('delete_own_account','delete_own_account_data')
--  order by routine_name, grantee;
-- Then, from the repo:  npm run measure:authdelete && npm run verify:accounts
