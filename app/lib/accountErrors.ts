/**
 * accountErrors.ts — one place that turns a Supabase error into something a
 * screen can render.
 *
 * **This is the error contract Stage 4 builds against.** Stage 4 maps
 * `AccountErrorCode` to copy; it should never parse a message string, because the
 * strings come from GoTrue and Postgres and both change them without notice.
 *
 * The database side of the contract is deliberate: every defined failure in
 * `sql/012`–`sql/014` is `raise exception '<code>' using errcode = 'P0001'`, which
 * PostgREST surfaces as `{ code: 'P0001', message: '<code>', details, hint }`. So
 * the *message* is the machine-readable code and `details`/`hint` carry the
 * human-facing context. That is unusual enough to be worth stating rather than
 * discovering.
 *
 * Three outcomes here are **not** errors and must not render as one:
 *
 *   - `cancelled`      — the technician dismissed the OAuth sheet. Resolve silently.
 *                        ST-A04 AC 5 says so explicitly.
 *   - `email_taken`    — measured behaviour, see below. It is a *routing* signal.
 *   - `already_a_member` — they are already in the company they tried to join.
 *
 * No branch here logs an email, a password or a token (ST-A04 AC 9).
 *
 * Pure and import-free so it is unit-testable under `node --test`.
 */

export type AccountErrorCode =
  // --- auth ----------------------------------------------------------------
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'invalid_email'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'provider_disabled'
  | 'cancelled'
  | 'network'
  // --- company -------------------------------------------------------------
  | 'not_authenticated'
  | 'not_company_owner'
  | 'company_name_invalid'
  | 'last_owner'
  | 'sole_owner_of_company'
  | 'join_code_unknown'
  | 'join_code_expired'
  | 'join_code_revoked'
  | 'join_code_exhausted'
  | 'already_a_member'
  | 'auth_delete_unavailable'
  // --- everything else -----------------------------------------------------
  | 'unknown';

export type AccountError = {
  code: AccountErrorCode;
  /**
   * Extra context the database attached — for `sole_owner_of_company` and
   * `last_owner` this is the **company id**, which is what lets the deletion
   * screen offer the two paths the user can complete alone (ST-A12 AC 5).
   */
  detail: string | null;
  /** A server-side suggestion. Advisory; the screen owns the final wording. */
  hint: string | null;
};

/** Codes the database defines itself, keyed by the message it raises. */
const DB_CODES = new Set<AccountErrorCode>([
  'not_authenticated',
  'not_company_owner',
  'company_name_invalid',
  'last_owner',
  'sole_owner_of_company',
  'join_code_unknown',
  'join_code_expired',
  'join_code_revoked',
  'join_code_exhausted',
  'already_a_member',
  'auth_delete_unavailable',
]);

type RawError = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
  details?: string | null;
  hint?: string | null;
  name?: string | null;
} | null | undefined;

const err = (code: AccountErrorCode, raw?: RawError): AccountError => ({
  code,
  detail: raw?.details ?? null,
  hint: raw?.hint ?? null,
});

/**
 * Map anything Supabase can hand back to a code.
 *
 * Ordered most-specific first. The GoTrue arm reads `error.code` where there is
 * one (newer GoTrue sets stable string codes) and falls back to message matching
 * only where it must — an ordering that gets more reliable over time rather than
 * less.
 */
export function toAccountError(raw: RawError): AccountError {
  if (!raw) return err('unknown');

  // --- Postgres / PostgREST: our own raise exception ------------------------
  const message = String(raw.message ?? '');
  if (DB_CODES.has(message as AccountErrorCode)) return err(message as AccountErrorCode, raw);

  // --- GoTrue stable codes -------------------------------------------------
  switch (raw.code) {
    case 'invalid_credentials':
    case 'invalid_grant':
      return err('invalid_credentials', raw);
    case 'user_already_exists':
    case 'email_exists':
      return err('email_taken', raw);
    case 'weak_password':
      return err('weak_password', raw);
    case 'email_address_invalid':
    case 'validation_failed':
      return err('invalid_email', raw);
    case 'email_not_confirmed':
      return err('email_not_confirmed', raw);
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return err('rate_limited', raw);
    case 'anonymous_provider_disabled':
    case 'provider_disabled':
      return err('provider_disabled', raw);
    default:
      break;
  }

  if (raw.status === 429 || /rate limit/i.test(message)) return err('rate_limited', raw);
  if (/is not enabled|unsupported provider/i.test(message)) return err('provider_disabled', raw);
  if (/invalid login credentials/i.test(message)) return err('invalid_credentials', raw);
  if (/already registered|already been registered/i.test(message)) return err('email_taken', raw);
  if (/is invalid/i.test(message) && /email/i.test(message)) return err('invalid_email', raw);
  if (/password/i.test(message) && /(short|weak|at least)/i.test(message)) return err('weak_password', raw);
  if (raw.name === 'AuthRetryableFetchError' || /network|fetch failed|timed out/i.test(message)) {
    return err('network', raw);
  }

  return err('unknown', raw);
}

/**
 * ST-A04 AC 8 / OQ-A9 — recognise "this address is already registered" when the
 * server refuses to say so.
 *
 * **Measured on this project, 10 Aug 2026** (`npm run measure:linking`):
 * `signUp` with an address that already exists does **not** error. It returns a
 * user object with an **empty `identities` array** and **no session** — GoTrue's
 * user-enumeration protection. The call looks like a success, no account is
 * created, and nothing is signed in.
 *
 * If the app treats that as a successful sign-up it will show a technician a
 * "welcome" screen for an account that does not exist, and their real history
 * will appear to have vanished. That is precisely the OQ-A9 failure this run
 * exists to prevent, so it gets its own predicate rather than an inline check at
 * one call site.
 */
export function isExistingAddressDecoy(signUpData: {
  user?: { identities?: unknown[] | null } | null;
  session?: unknown | null;
} | null | undefined): boolean {
  if (!signUpData?.user) return false;
  if (signUpData.session) return false;
  const identities = signUpData.user.identities;
  return Array.isArray(identities) && identities.length === 0;
}

/** True when the user dismissed the provider sheet. Not a failure. */
export function isUserCancelled(result: { type?: string } | null | undefined): boolean {
  return result?.type === 'cancel' || result?.type === 'dismiss';
}
