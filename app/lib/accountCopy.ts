/**
 * accountCopy.ts — every word the identity screens say, in one place.
 *
 * `accountErrors.ts` turns a Supabase failure into an `AccountErrorCode`. This
 * turns that code into something a technician on a roof can act on. The split is
 * deliberate: Stage 3 owns the codes and may add to them, Stage 4 owns the
 * wording and may reword freely, and neither has to touch the other's file.
 *
 * ---------------------------------------------------------------------------
 * Three rules this file exists to hold
 * ---------------------------------------------------------------------------
 *
 *  1. **`cancelled` is not an error.** The technician dismissed the provider
 *     sheet. `isSilentOutcome` says so and the screens check it before they
 *     render anything at all — showing "sign-in failed" to someone who chose not
 *     to sign in is the app arguing with them.
 *
 *  2. **`auth_delete_unavailable` is not a user error.** It means this Supabase
 *     project will not let a `SECURITY DEFINER` function delete from
 *     `auth.users`, so the Edge Function fallback in `sql/014` is still needed.
 *     It is our deployment gap, the user did nothing, and nothing was deleted.
 *     `.pipeline/03-backend-accounts.md` §3.1 forbids showing it as a failure, so
 *     it carries `tone: 'notice'` and copy that says whose problem it is.
 *
 *  3. **Nothing here softens what a guest loses.** `GUEST_DISCLOSURE` says the
 *     conversation is gone when the app closes, because that is what happens
 *     (OQ-A4). "Sign in to save" describes what is on offer; a technician who has
 *     spent twenty minutes on a rooftop needs to know what is at risk.
 *
 * Pure and import-free — the only import is a type, which Node erases — so
 * `node --test` can load it directly and `accountCopy.test.mjs` can assert the
 * mapping is total rather than trusting that it is.
 */

import type { AccountErrorCode } from './accountErrors.ts';

/**
 * `error` — something failed and the technician may want to retry.
 * `notice`  — nothing is broken; this is information or a routing signal.
 *
 * Both render on a steel card with one glyph. **Neither is ever red all over:**
 * that is the refusal card's language and `Message.tsx` owns it exclusively.
 * E5.2 requires a refusal and a failure to be tellable apart at arm's length in
 * sunlight, and reusing the refusal's styling for a wrong password would destroy
 * exactly that distinction.
 */
export type CopyTone = 'error' | 'notice';

export type AccountCopy = {
  title: string;
  detail: string;
  tone: CopyTone;
};

/**
 * True when the screen must render **nothing**: no banner, no toast, no retry.
 *
 * ST-A04 AC 5. Only `cancelled` qualifies, and it qualifies absolutely.
 */
export function isSilentOutcome(code: AccountErrorCode): boolean {
  return code === 'cancelled';
}

/**
 * The whole map, keyed by the closed union so TypeScript fails the build if
 * Stage 3 adds a code and nobody writes copy for it. That is the point of a
 * `Record` here rather than a `switch` with a default: an unmapped code should be
 * a compile error, not a silent fall-through to "something went wrong".
 *
 * The *runtime* fallback still exists (`copyForError` below) because a database
 * or GoTrue can hand back a code this app has never heard of, and a blank screen
 * is the one outcome ST-A10 AC 3 forbids.
 */
const COPY: Record<AccountErrorCode, AccountCopy> = {
  // --- auth ------------------------------------------------------------------
  invalid_credentials: {
    tone: 'error',
    title: "That email and password don't match",
    detail:
      'Check both and try again. If you started with Apple or Google, use that button instead — there is no password on that account for the field to match.',
  },
  email_taken: {
    tone: 'notice',
    title: 'That email already has an account',
    detail:
      'Sign in with your password instead — your jobs are still on it. Once you are in, you can link Apple or Google from your profile.',
  },
  weak_password: {
    tone: 'error',
    title: 'That password is too short',
    detail: 'Use at least six characters.',
  },
  invalid_email: {
    tone: 'error',
    title: "That email address isn't valid",
    detail: 'Check it for a typo — it needs an @ and a domain after it.',
  },
  email_not_confirmed: {
    tone: 'error',
    title: 'This account has not been confirmed yet',
    detail:
      'A confirmation link was emailed when the account was created. Open it, then sign in here.',
  },
  rate_limited: {
    tone: 'error',
    title: 'Too many attempts just now',
    detail:
      'The server is throttling requests from this device. Wait a minute and try again — there is nothing wrong with the account.',
  },
  provider_disabled: {
    tone: 'notice',
    title: 'That sign-in method is not switched on yet',
    detail:
      'Apple and Google sign-in are still being set up for this build. Email and password work now, and everything on the Ask tab works with no account at all.',
  },
  cancelled: {
    // Never rendered — `isSilentOutcome` short-circuits first. Present so the
    // Record stays total and so a screen that forgets the check still shows
    // something truthful rather than "unknown error".
    tone: 'notice',
    title: 'Sign-in cancelled',
    detail: 'Nothing changed.',
  },
  network: {
    tone: 'error',
    title: "That didn't reach the server",
    detail: 'Check your signal and try again. Nothing has been half-done.',
  },

  // --- company ---------------------------------------------------------------
  not_authenticated: {
    tone: 'notice',
    title: 'You are signed out',
    detail:
      'Companies need an account. Asking questions and reading citations does not — that all still works.',
  },
  not_company_owner: {
    tone: 'error',
    title: 'Only an owner can do that',
    detail:
      'Ask an owner of this company to make the change. Nothing about your own jobs is affected either way.',
  },
  company_name_invalid: {
    tone: 'error',
    title: "That name won't work",
    detail: 'A company name has to be between 1 and 120 characters.',
  },
  last_owner: {
    tone: 'error',
    title: 'A company needs at least one owner',
    detail:
      'You are the last one. Make somebody else an owner first, then you can step down or leave.',
  },
  sole_owner_of_company: {
    tone: 'error',
    title: 'You are the only owner of a company',
    detail:
      'Nothing has been deleted — your account and everything in it is exactly as it was. Make another member an owner, or delete the company. Both are things you can do yourself, right here.',
  },
  join_code_unknown: {
    tone: 'error',
    title: "That code isn't recognised",
    detail:
      'Check the characters with whoever read it to you. Codes never contain I, L, O or U, so a 1 is a one and a 0 is a zero.',
  },
  join_code_expired: {
    tone: 'error',
    title: 'That code has expired',
    detail: 'Codes last 14 days. Ask for a fresh one.',
  },
  join_code_revoked: {
    tone: 'error',
    title: 'That code has been turned off',
    detail: 'An owner revoked it. Ask for a new one.',
  },
  join_code_exhausted: {
    tone: 'error',
    title: 'That code has been used up',
    detail: 'It hit the number of joins it was allowed. Ask for a new one.',
  },
  already_a_member: {
    tone: 'notice',
    title: 'You are already in this company',
    detail: 'Nothing to do — it is on your account already.',
  },
  auth_delete_unavailable: {
    // Rule 2 at the top of this file. This is our gap, not the technician's.
    tone: 'notice',
    title: 'Deleting from the app is not finished on the server yet',
    detail:
      'Nothing was deleted and your account is exactly as it was. This one is ours to finish — it is not something you did and not something you can fix from here.',
  },

  // --- fallback --------------------------------------------------------------
  unknown: {
    tone: 'error',
    title: "That didn't work",
    detail:
      'No more specific reason came back. Nothing has been changed. Try again, and if it keeps happening it is worth reporting.',
  },
};

/**
 * Copy for a code. **Never returns nothing** (ST-A10 AC 3): a code this build has
 * never seen falls back to `unknown`, which is a readable error state rather than
 * the blank screen the criterion exists to forbid.
 */
export function copyForError(code: string | null | undefined): AccountCopy {
  if (code && code in COPY) return COPY[code as AccountErrorCode];
  return COPY.unknown;
}

// ---------------------------------------------------------------------------
// Guest disclosures — ST-A06 AC 6, AC 7, AC 9
// ---------------------------------------------------------------------------

/**
 * Shown **before the first answer**, not after it.
 *
 * The wording is load-bearing and was reviewed against ST-A06 AC 6's explicit
 * instruction: *"The wording must not be softened into 'sign in to save' — the
 * user needs to know what is lost, not what is offered."* So the first sentence
 * is the loss, stated in the present tense, with no hedge. "May lose" would be
 * false: there is no cache, no draft, no recovery and no support path, because
 * nothing was written anywhere for anyone to recover from.
 *
 * The second half exists so the disclosure cannot be read as a downgrade warning.
 * A guest's answers are the real thing — same knowledge base, same citations,
 * same refusals (§1j). Only persistence differs.
 *
 * ---------------------------------------------------------------------------
 * ST-F02 — `dismiss` / `dismissLabel`, the words on the control that clears it
 * ---------------------------------------------------------------------------
 *
 * The owner reported that this notice can never be removed. It now can, but only
 * after an answer has been delivered — `canDismiss` in lib/guestNotice.ts owns
 * that rule and this file owns only the wording.
 *
 * **The wording is a receipt, not a risk waiver.** "I understand the risks" is
 * the phrase that comes to mind and it is wrong twice: nothing here is a risk to
 * accept, and the bypass grep in tests/suites/e5-safety.mjs matches that exact
 * phrasing across every source under app/, because a control worded that way is
 * how a refusal gets clicked past. accountUi.test.mjs runs those same patterns
 * over this file.
 *
 * The three fields above are **unchanged** by that addition and stay unchanged. A
 * dismiss control is not a licence to soften the disclosure (ST-F02 AC 7), and
 * accountCopy.test.mjs still pins the body's claims.
 *
 * Note for the density fence: keep quote and backtick characters out of the
 * object literal below. tests/lib/copyInventory.mjs counts every quoted span
 * inside the declaration, so a comment *inside* the braces is counted as copy and
 * the fenced word count stops meaning anything. Rationale lives up here instead.
 */
export const GUEST_DISCLOSURE = {
  label: 'NOTHING HERE IS BEING SAVED',
  body:
    'You are not signed in, so this conversation exists only on this screen. Close the app and it is gone — there is no copy of it anywhere and no way to get it back. The answers and their citations are exactly the same either way.',
  action: 'Sign in or create an account',
  // ST-F02. A receipt, not a risk waiver — see the note above this declaration.
  dismiss: 'Got it',
  dismissLabel: 'Dismiss the not-saved notice',
} as const;

/** ST-A06 AC 7 — the History tab for a guest. An explanation with a way forward. */
export const GUEST_HISTORY = {
  title: 'Nothing is saved while you are signed out',
  detail:
    'Jobs are kept only on an account. Whatever is on the Ask tab lives in this app until you close it, and then it is gone.',
  action: 'Sign in or create an account',
} as const;

/**
 * ST-A06 AC 9 — the boundary marker.
 *
 * Drawn once, at the point in the transcript where signing in happened, so a
 * technician is never left guessing which half of their morning survived.
 */
export const SAVED_FROM_HERE = {
  label: 'SAVED FROM HERE',
  detail:
    'Everything above happened before you signed in and was never written down. From here on this job is kept.',
} as const;

// ---------------------------------------------------------------------------
// The privacy posture — ST-A18
// ---------------------------------------------------------------------------

/**
 * OQ-A1 is a promise made to the database. This is where it is made to the person.
 *
 * It appears on **three** surfaces — create a company, enter a join code, and the
 * company screen itself — because ST-A18 AC 2 requires it to be discoverable
 * after joining and not only in the moment of joining, when nobody reads.
 *
 * ST-A18 AC 3: it is not collapsible, not conditional, and it precedes the
 * join/create button in the component tree. ST-A18 AC 4 couples it to the schema:
 * the claim below is true only while no company-read policy exists on
 * `sessions`, `messages` or `citations`. If one is ever added, this copy becomes
 * a lie and the Stage 5 OQ-A1 guard is what turns red.
 */
export const COMPANY_PRIVACY = {
  label: 'WHAT YOUR COMPANY CAN SEE',
  can: 'Your name, your trade role, and whether you are an owner or a member.',
  cannot:
    'Not your jobs, not the questions you asked, not the answers you were given, and not the citations behind them. Nobody in the company can open a job of yours, and there is no screen anywhere that would show them one.',
} as const;

// ---------------------------------------------------------------------------
// Account deletion — ST-A12 AC 9
// ---------------------------------------------------------------------------

/**
 * The confirmation is a typed word, not a second tap.
 *
 * ST-A12 AC 9 asks for "a typed confirmation or equivalent deliberate act". A
 * second tap is not deliberate — it is the same gesture again, in the same place,
 * and a gloved thumb on a vibrating roof produces it by accident. Typing six
 * characters cannot happen by accident.
 */
export const DELETE_ACCOUNT = {
  title: 'Delete your account',
  what:
    'This removes your account, your profile, every job you have run, every question and answer inside them, and every citation attached to those answers. It also takes you off the roster of any company you are in.',
  irreversible:
    'It cannot be undone. There is no backup, no grace period, and no way for anyone to restore it afterwards.',
  confirmWord: 'DELETE',
  confirmPrompt: 'Type DELETE to confirm',
  action: 'Delete my account permanently',
} as const;

/**
 * ST-A11 AC 4 / §1k — why two accounts can exist for one human, said plainly.
 *
 * Apple Private Relay hands back an `@privaterelay.appleid.com` alias rather than
 * the real address. The two addresses genuinely differ, so no amount of client
 * logic can join the accounts, and pretending otherwise would leave a technician
 * hunting for history that is sitting under a different identity. Disclosed
 * instead, with manual linking as the escape hatch.
 */
export const PRIVATE_RELAY_NOTE =
  'If you used Apple with "Hide My Email", Apple gives us an alias instead of your real address. An account made that way cannot be matched to one you made with your email — they stay separate, and linking them here is the only way to join them up.';

/** ST-A13 AC 7 / brief AC 5 — said out loud, on the screen that could imply otherwise. */
export const COMPANY_OPTIONAL =
  'A company is optional. Ductective works exactly the same on your own — same manuals, same citations, same refusals — and nothing is held back if you never join one.';
