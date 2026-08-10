/**
 * accountsAdapter.ts — the one place Stage 4 works around Stage 3's contract.
 *
 * **Read this before adding anything to it.** Everything else in `app/screens/`
 * consumes `lib/accounts.ts` and `lib/auth.ts` exactly as
 * `.pipeline/03-backend-accounts.md` §3 documents them. Three calls do not
 * behave the way §3 describes once `sql/012` is applied, and rather than sprinkle
 * compensations through four screens, all three live here, named, with the
 * divergence written down and Backend named as the owner.
 *
 * All three are recorded as **CONTRACT MISMATCH** in
 * `.pipeline/04-frontend-accounts.md` so Stage 5 can route the fix. None of them
 * is a fix applied to backend code — no file under `lib/accounts.ts`, `sql/` or
 * anywhere else in Stage 3's surface is touched by this run.
 *
 * ---------------------------------------------------------------------------
 * CM-1 · `getMyProfile()` throws in any company with more than one person
 * ---------------------------------------------------------------------------
 * `accounts.ts:getMyProfile` selects from `profiles` with **no filter** and calls
 * `.maybeSingle()`, relying on RLS to leave exactly one row. That held under
 * `sql/010`, whose only SELECT policy is `profiles_select_own`. `sql/012` then
 * adds `profiles_select_co_member` (ST-A03 AC 6, and correct — a roster of uuids
 * is useless). Policies are OR'd, so from the moment a second person is in your
 * company the select returns N rows and `.maybeSingle()` fails with PostgREST's
 * multiple-rows error.
 *
 * The symptom would be: solo technicians and one-person companies work fine,
 * every real shop's profile screen breaks. That is the worst shape of bug —
 * invisible in every test fixture with one user in it.
 *
 * ---------------------------------------------------------------------------
 * CM-2 · `listMyMemberships()` returns co-members' rows too
 * ---------------------------------------------------------------------------
 * Its doc comment says "Every company this user belongs to, with their role in
 * each", and §3.2 describes it as the solo-technician emptiness check. But it
 * selects `memberships` unfiltered, and `memberships_select_member` is
 * `using (is_member(company_id))` — every member may read **every** membership
 * row of their company. So a three-person shop returns three rows for one
 * company, and a naive company list shows the same shop three times.
 *
 * ---------------------------------------------------------------------------
 * CM-3 · `company_roster` carries no membership id, but the mutations need one
 * ---------------------------------------------------------------------------
 * ST-A10 AC 1 requires an owner to remove a member and change a role from the
 * roster. `listRoster()` reads `public.company_roster`, which exposes
 * `company_id, user_id, role, joined_at, display_name, trade_role` — no
 * membership id, correctly, since OQ-A1 keeps that view down to what a company
 * may see about a person. But `setMemberRole(membershipId, …)` and
 * `removeMembership(membershipId)` are both keyed by membership id, which the
 * roster cannot supply. CM-2's over-broad read is what rescues this: the same
 * `listMyMemberships()` call already returns the rows with their ids.
 *
 * ---------------------------------------------------------------------------
 * The thing this file is NOT
 * ---------------------------------------------------------------------------
 * **The filter below is not isolation and must never be cited as any.** RLS
 * decides which rows exist; `id = userId` here picks *my* row out of a set the
 * database has already decided I am allowed to see. If this filter were the only
 * thing keeping one technician out of another's data it would be a defect on the
 * days it worked, because the anon key ships in the bundle (brief hard
 * constraint 3). It is disambiguation, not security.
 */

import { supabase, isConfigured } from './supabase';
import type { Company, Membership, Profile } from './supabase';
import { AccountFailure, listMyMemberships } from './accounts';
import { toAccountError } from './accountErrors';

export type MembershipRow = Membership & { company: Company };

/**
 * CM-1. The signed-in user's own profile, disambiguated by id.
 *
 * Same columns, same return contract as `getMyProfile()` — `null` means there is
 * genuinely no row, which the `sql/010` trigger should make unreachable and which
 * the screen renders as an empty state rather than a crash (§3.2).
 */
export async function myProfile(userId: string): Promise<Profile | null> {
  if (!isConfigured || !supabase) {
    throw new AccountFailure({ code: 'network', detail: null, hint: null });
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, trade_role, active_company_id, created_at, updated_at')
    .eq('id', userId) // disambiguation, not isolation — see the header
    .maybeSingle();
  if (error) throw new AccountFailure(toAccountError(error as never));
  return (data as Profile) ?? null;
}

/**
 * CM-2 / CM-3. Everything `memberships` will hand back: my rows *and* my
 * co-members' rows, because that is what the policy permits and what the API
 * actually returns. Split by the two helpers below rather than pretended away.
 */
export function readableMemberships(): Promise<MembershipRow[]> {
  return listMyMemberships();
}

/** CM-2. My memberships — one row per company, which is what a company list wants. */
export function mine(rows: MembershipRow[], userId: string): MembershipRow[] {
  return rows.filter((r) => r.user_id === userId);
}

/**
 * CM-3. `user_id → membership id`, for one company, so an owner can act on a
 * roster row at all. Empty when the read returned nothing, which a caller must
 * treat as "no controls" rather than as an error — a member legitimately sees a
 * narrower set than an owner does.
 */
export function membershipIds(rows: MembershipRow[], companyId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.company_id === companyId) out[r.user_id] = r.id;
  return out;
}
