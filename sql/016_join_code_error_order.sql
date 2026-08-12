-- 016_join_code_error_order.sql — run in the Supabase SQL Editor.
--
-- SAFE TO RUN AT ANY TIME. It replaces one function body. No table, column,
-- policy, grant or row is touched, and the function's signature, return type and
-- privileges are identical to sql/013's.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `redeem_join_code` checked exhaustion *before* membership:
--
--     if rec.uses >= rec.max_uses then raise 'join_code_exhausted' ...
--     if <already a member>        then raise 'already_a_member'   ...
--
-- On a single-use code — which is a perfectly ordinary way to invite one
-- technician — the person who just redeemed it gets `join_code_exhausted` when
-- they tap it a second time, because their own redemption consumed the last use.
-- Its hint is "Ask for a new code", and that is **wrong advice**: they are
-- already in the company and need nothing at all. They would go and ask a
-- foreman for a code they cannot use and do not require.
--
-- Caught by `scripts/verify-accounts.mjs` (ST-A09 AC 5), which asserted the
-- useful error rather than the one the implementation happened to produce.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- Membership is now tested first. It is the more specific fact and the one the
-- technician can act on — and it is *stable*, where exhaustion is incidental to
-- how many uses the code happened to have. Ordering by specificity is the rule
-- worth keeping here: when two conditions are both true, report the one that
-- explains the situation rather than the one that merely holds.
--
-- Everything else is byte-identical to sql/013's function, including the
-- FOR UPDATE lock that makes concurrent redemption of a last use safe.
-- ---------------------------------------------------------------------------

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

  -- Moved ABOVE the exhaustion check. See the header: on a single-use code the
  -- redeemer's own use exhausts it, so testing exhaustion first tells the one
  -- person who definitely does not need a new code to go and ask for one.
  if exists (select 1 from public.memberships m
              where m.company_id = rec.company_id and m.user_id = uid) then
    raise exception 'already_a_member' using errcode = 'P0001',
      detail = rec.company_id::text;
  end if;

  if rec.uses >= rec.max_uses then
    raise exception 'join_code_exhausted' using errcode = 'P0001',
      hint = 'Ask for a new code.';
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
