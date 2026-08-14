-- 017_membership_subject_guard.sql — run in the Supabase SQL Editor.
--
-- SAFE TO RUN AT ANY TIME. It changes grants and two policies on
-- `public.memberships`. No table, column, row or function is touched, and no
-- shipped app call loses a capability — see "What still works" below.
--
-- ===========================================================================
-- What was wrong
-- ===========================================================================
-- `memberships_insert_owner` constrained **which company** a row could be
-- written into, and said nothing about **whose membership it was**:
--
--     with check (public.is_company_owner(company_id))
--
-- `create_company` lets any authenticated user become the owner of a company
-- they invent, and `grant insert ... to authenticated` (sql/012:218) left the
-- table directly writable. So one POST to /rest/v1/memberships with
-- {company_id: <a company I just made>, user_id: <somebody else>} adds a
-- stranger to your company without their knowledge or action.
--
-- The consequence is not dramatic but it is real: `is_co_member(victim)` becomes
-- true, so `profiles_select_co_member` grants the attacker a standing read of
-- that person's display_name, trade_role and active_company_id — and it survives
-- being removed from the shop where they learned the victim's uuid. The delta is
-- *persistence past revocation*, which is exactly what removal is supposed to end.
--
-- It also contradicts a decision this schema already made deliberately.
-- `sql/013_join_codes.sql` rejects admin-adds-by-email so that joining always
-- requires the joiner's own action. This policy handed that capability back.
--
-- The same hole existed on UPDATE: `memberships_update_owner` let an owner
-- rewrite an existing row's `user_id`, which reaches the same end by another
-- road (point a throwaway member row at the victim).
--
-- ===========================================================================
-- The fix, in layers
-- ===========================================================================
-- 1. **Revoke INSERT outright**, mirroring what sql/012:185 already does for
--    `companies` and sql/013:103 for `company_join_codes`. `memberships` was the
--    one table where that reasoning was not applied. The grant was unused: every
--    membership is created by `create_company` or `redeem_join_code`, both
--    SECURITY DEFINER, which run as the function owner and are unaffected.
--
-- 2. **Restrict UPDATE to the `role` column.** A policy cannot compare NEW to OLD,
--    so it cannot express "you may change the role but not the subject". A
--    column-level grant can, and it makes a statement touching `user_id` or
--    `company_id` fail at parse time rather than relying on a predicate.
--
-- 3. **Tighten both policies anyway.** Belt and braces: sql/012:185's own comment
--    warns that "a policy alone would be re-grantable by a later `grant all`" —
--    the inverse is also true, and a grant alone is re-openable by a later policy
--    edit. Anchoring the subject to `auth.uid()` in the INSERT policy means that
--    even if INSERT is re-granted by mistake, a caller can still only ever write
--    their *own* membership.
--
-- ===========================================================================
-- What still works (verified against app/lib/accounts.ts before writing this)
-- ===========================================================================
--   * `create_company`      — SECURITY DEFINER, inserts company + owner row. Fine.
--   * `redeem_join_code`    — SECURITY DEFINER, inserts the member row. Fine.
--   * `setMemberRole`       — `.update({ role })`, the one column still granted.
--   * `removeMembership`    — `.delete()`, untouched.
--   * `listMyMemberships`   — `.select()`, untouched.
--   * `guard_last_owner`    — before update/delete, untouched.
-- The app never inserts a membership directly. Confirmed by reading every
-- `from('memberships')` call site.
-- ---------------------------------------------------------------------------

-- 1 — the table is no longer directly insertable.
revoke insert on public.memberships from authenticated;

-- 2 — UPDATE is narrowed to the role column. Revoke the table-wide grant first;
-- a column grant does not override a broader one that is already held.
revoke update on public.memberships from authenticated;
grant  update (role) on public.memberships to authenticated;

-- 3a — the INSERT policy now names its subject. Kept (rather than dropped with
-- the grant) so the constraint is stated in both places.
drop policy if exists memberships_insert_owner on public.memberships;
create policy memberships_insert_owner on public.memberships
  for insert to authenticated
  with check (
    public.is_company_owner(company_id)
    and user_id = (select auth.uid())
  );

-- 3b — the UPDATE policy, unchanged in intent, restated for the same reason. The
-- column grant is what actually prevents a subject rewrite; this keeps the
-- company constraint on both the old and the new row.
drop policy if exists memberships_update_owner on public.memberships;
create policy memberships_update_owner on public.memberships
  for update to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

-- ---------------------------------------------------------------------------
-- Verify (paste separately)
-- ---------------------------------------------------------------------------
--  -- expect: no INSERT row, and UPDATE listed only for column "role"
--  select grantee, privilege_type, column_name
--    from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'memberships'
--     and grantee = 'authenticated'
--   order by privilege_type, column_name;
--
--  select grantee, privilege_type
--    from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'memberships'
--     and grantee = 'authenticated'
--   order by privilege_type;
