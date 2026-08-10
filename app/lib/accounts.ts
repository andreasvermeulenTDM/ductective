/**
 * accounts.ts — profile, company, membership and join-code access.
 *
 * **This is the contract Stage 4 builds against.** Every function here either
 * resolves with data or rejects with an `AccountFailure` carrying an
 * `AccountErrorCode` (see `accountErrors.ts`). No function returns a bare
 * Supabase error object, and none of them returns `null` to mean "failed" — a
 * screen that has to tell those two apart gets it wrong eventually.
 *
 * **Isolation is not enforced here.** Every read below is permitted or refused by
 * row-level security in `sql/010`–`sql/013`, not by the filters in this file. The
 * anon key ships in the app bundle, so a `where` clause in client code is a
 * convenience for the query planner and nothing more (brief hard constraint 3).
 * If a filter here were the only thing keeping user B out of user A's data, that
 * would be a defect regardless of whether it happened to work.
 *
 * The company surface is deliberately small, because OQ-A1 makes it small: a
 * company is a name, a roster, and a role. There is no function here that reads
 * another technician's sessions, and there is no policy that would permit one.
 */

import { supabase, isConfigured } from './supabase';
import type { Company, JoinCode, Membership, Profile, RosterEntry } from './supabase';
import { toAccountError, type AccountError, type AccountErrorCode } from './accountErrors';

/** Thrown by everything in this module. `code` is the thing to switch on. */
export class AccountFailure extends Error {
  readonly code: AccountErrorCode;
  readonly detail: string | null;
  readonly serverHint: string | null;

  constructor(e: AccountError) {
    super(e.code);
    this.name = 'AccountFailure';
    this.code = e.code;
    this.detail = e.detail;
    this.serverHint = e.hint;
  }
}

function db() {
  if (!isConfigured || !supabase) throw new AccountFailure({ code: 'network', detail: null, hint: null });
  return supabase;
}

const boom = (raw: unknown): never => {
  throw new AccountFailure(toAccountError(raw as never));
};

// ---------------------------------------------------------------------------
// Profile (ST-A03, ST-A11)
// ---------------------------------------------------------------------------

/**
 * The signed-in user's own profile.
 *
 * Returns `null` only when there is genuinely no row — which, given the
 * auto-provision trigger in `sql/010`, should never happen for a signed-in user
 * and is worth surfacing as an empty state rather than a crash if it ever does.
 */
export async function getMyProfile(): Promise<Profile | null> {
  const client = db();
  /*
   * The `.eq('id', …)` is **disambiguation, not isolation** — the distinction the
   * header insists on, and this is the function that proves why it matters.
   *
   * `sql/012` adds `profiles_select_co_member`, and Postgres ORs same-command
   * policies together. So the moment a second technician joins your company this
   * select is permitted to return their row too, and `.maybeSingle()` throws on
   * more than one. Without the filter: a solo user works and every real shop
   * breaks — and no single-user fixture would ever show it. Found by Stage 4 as
   * CONTRACT MISMATCH CM-1.
   *
   * The filter picks which permitted row we want. It is not what stops anyone
   * reading someone else's; that is still the policy's job alone.
   */
  const { data: auth } = await client.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;

  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, trade_role, active_company_id, created_at, updated_at')
    .eq('id', uid)
    .maybeSingle();
  if (error) boom(error);
  return data ?? null;
}

/**
 * Update your own name and trade role.
 *
 * The 1–60 character rule is enforced by a `check` constraint in `sql/010`. The
 * trim-and-measure below is convenience so the user gets told before a round
 * trip; the constraint is the rule (ST-A11 AC 2).
 */
export async function updateMyProfile(patch: {
  display_name?: string | null;
  trade_role?: string | null;
}): Promise<Profile> {
  const clean: Record<string, string | null> = {};
  for (const key of ['display_name', 'trade_role'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    const trimmed = typeof value === 'string' ? value.trim() : null;
    if (trimmed !== null && (trimmed.length < 1 || trimmed.length > 60)) {
      throw new AccountFailure({ code: 'company_name_invalid', detail: key, hint: '1–60 characters.' });
    }
    clean[key] = trimmed && trimmed.length ? trimmed : null;
  }

  const { data, error } = await db()
    .from('profiles')
    .update(clean)
    .select('id, display_name, trade_role, active_company_id, created_at, updated_at')
    .single();
  if (error) boom(error);
  return data as Profile;
}

// ---------------------------------------------------------------------------
// Companies (ST-A07, ST-A08)
// ---------------------------------------------------------------------------

/**
 * Every company this user belongs to, with their role in each.
 *
 * Empty is the **normal** result, not an error state: a solo technician with no
 * company is a first-class user (brief AC 5) and nothing about the app may be
 * gated behind this being non-empty.
 */
export async function listMyMemberships(): Promise<(Membership & { company: Company })[]> {
  const client = db();
  /*
   * Same shape of correction as `getMyProfile`, same reason (CM-2).
   * `memberships_select_member` is `using (is_member(company_id))` — it permits
   * every membership row of every company you belong to, which is correct for a
   * roster and wrong for "mine". Unfiltered, a three-person shop returned three
   * rows and the company appeared three times in the user's own list.
   *
   * Again: disambiguation, not isolation.
   */
  const { data: auth } = await client.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  const { data, error } = await client
    .from('memberships')
    .select('id, company_id, user_id, role, created_at, company:companies(id, name, city, region, created_by, created_at, updated_at)')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) boom(error);
  type Row = Membership & { company: Company | Company[] | null };
  return ((data ?? []) as Row[])
    .map((row) => ({ ...row, company: (Array.isArray(row.company) ? row.company[0] : row.company) as Company }))
    .filter((row) => Boolean(row.company));
}

/**
 * Create a company and become its owner, in one transaction.
 *
 * Goes through the `create_company` RPC rather than an insert because a direct
 * insert is granted to nobody: "you may insert a company you will own" plus "only
 * an owner may add members" makes the first company uncreatable, and every
 * workaround loosens one of the two policies (§1e).
 */
export async function createCompany(name: string): Promise<string> {
  const { data, error } = await db().rpc('create_company', { name });
  if (error) boom(error);
  return data as string;
}

export async function updateCompany(
  companyId: string,
  patch: { name?: string; city?: string | null; region?: string | null }
): Promise<Company> {
  const { data, error } = await db()
    .from('companies')
    .update(patch)
    .eq('id', companyId)
    .select('id, name, city, region, created_by, created_at, updated_at')
    .single();
  if (error) boom(error);
  return data as Company;
}

/** Owner only. Deletes memberships and join codes; deletes nobody's sessions. */
export async function deleteCompany(companyId: string): Promise<void> {
  const { error } = await db().from('companies').delete().eq('id', companyId);
  if (error) boom(error);
}

/**
 * The roster — exactly what a company may see about its people (OQ-A1).
 *
 * Reads `public.company_roster`, a `security_invoker` view over `memberships`
 * joined to `profiles`. Name, trade role, company role, join date. There is no
 * column on it for anything a technician asked, and no policy that would let one
 * be added without a signed brief amendment.
 */
export async function listRoster(companyId: string): Promise<RosterEntry[]> {
  const { data, error } = await db()
    .from('company_roster')
    // `membership_id` first: it is the key the owner actions act on, and CM-3 was
    // that the roster could not supply one. Selecting it here is what lets
    // `setMemberRole`/`removeMembership` be wired from the screen that lists people.
    .select('membership_id, company_id, user_id, role, joined_at, display_name, trade_role')
    .eq('company_id', companyId)
    .order('joined_at', { ascending: true });
  if (error) boom(error);
  return (data ?? []) as RosterEntry[];
}

/**
 * Change a member's role. Owner only, and the database refuses to demote the last
 * owner with `last_owner` — a company with no owners is unadministrable and
 * unrecoverable from inside the app.
 */
export async function setMemberRole(membershipId: string, role: 'owner' | 'member'): Promise<void> {
  const { error } = await db().from('memberships').update({ role }).eq('id', membershipId);
  if (error) boom(error);
}

/**
 * Remove someone from the company, or leave it yourself.
 *
 * Roster-only. The removed member keeps every session, message and citation they
 * ever created (OQ-A2) — removing someone from a shop does not touch their work.
 * Their access to *company* data ends on their very next request, because the
 * policies join to `memberships` at query time; the stale JWT still
 * authenticates, but it authorizes nothing (§1f).
 */
export async function removeMembership(membershipId: string): Promise<void> {
  const { error } = await db().from('memberships').delete().eq('id', membershipId);
  if (error) boom(error);
}

/** Which company stamps new sessions (OQ-A5). Null is valid and common. */
export async function setActiveCompany(companyId: string | null): Promise<void> {
  const { error } = await db().from('profiles').update({ active_company_id: companyId }).select('id').single();
  if (error) boom(error);
}

// ---------------------------------------------------------------------------
// Join codes (ST-A09)
// ---------------------------------------------------------------------------

/** Owner only. Returns 0 rows for a member or a stranger — by policy, not by filter. */
export async function listJoinCodes(companyId: string): Promise<JoinCode[]> {
  const { data, error } = await db()
    .from('company_join_codes')
    .select('id, code, expires_at, max_uses, uses, revoked_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) boom(error);
  return (data ?? []) as JoinCode[];
}

export async function createJoinCode(
  companyId: string,
  opts: { expiresDays?: number; maxUses?: number } = {}
): Promise<JoinCode> {
  const { data, error } = await db().rpc('create_join_code', {
    p_company_id: companyId,
    p_expires_days: opts.expiresDays ?? 14,
    p_max_uses: opts.maxUses ?? 10,
  });
  if (error) boom(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as JoinCode;
}

export async function revokeJoinCode(codeId: string): Promise<void> {
  const { error } = await db()
    .from('company_join_codes')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', codeId);
  if (error) boom(error);
}

/**
 * Redeem a code and join the company. Returns the company id.
 *
 * Every failure mode has its own code — `join_code_unknown`, `join_code_expired`,
 * `join_code_revoked`, `join_code_exhausted`, `already_a_member` — and none of
 * them creates a membership. Expiry and use limits are enforced in the RPC, not
 * in the UI: a rule enforced only client-side is not a rule.
 */
export async function redeemJoinCode(code: string): Promise<string> {
  const { data, error } = await db().rpc('redeem_join_code', { code: code.trim().toUpperCase() });
  if (error) boom(error);
  return data as string;
}

// ---------------------------------------------------------------------------
// Account deletion (ST-A12)
// ---------------------------------------------------------------------------

/**
 * Delete this account and everything in it. Irreversible.
 *
 * Rejects with `sole_owner_of_company` — and `detail` set to the company id —
 * when the user solely owns a company that still has other members. **Nothing is
 * deleted in that case**; the transaction is atomic. The screen offers the two
 * paths the user can complete alone: promote another member to owner, or delete
 * the company.
 *
 * `auth_delete_unavailable` means this Supabase project does not permit a
 * `SECURITY DEFINER` function to delete from `auth.users`, and the Edge Function
 * fallback described in `sql/014` is required. It is a deployment gap, not a user
 * error, and it must not be shown as one. See `.pipeline/03-backend-accounts.md`
 * for the measured answer for this project.
 */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await db().rpc('delete_own_account');
  if (error) boom(error);
}
