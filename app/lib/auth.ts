/**
 * auth.ts — sign up, sign in, sign out, and the OAuth web flow.
 *
 * **The contract Stage 4 builds against.** Every function resolves with a defined
 * result or rejects with an `AccountFailure` carrying an `AccountErrorCode`
 * (`accountErrors.ts`). Screens map codes to copy; they must never parse a
 * message string.
 *
 * ---------------------------------------------------------------------------
 * Why the OAuth **web** flow and not native Sign in with Apple
 * ---------------------------------------------------------------------------
 * Native SIWA needs the app's own bundle identifier carrying the SIWA
 * capability. Inside Expo Go the running bundle identifier is Expo's, not
 * Ductective's, so a native sheet cannot be configured against our Apple
 * Services ID (§1k) — and the SDK 54 pin exists because the test iPhone tops out
 * at Expo Go 54 (`app/AGENTS.md`). The web flow works in Expo Go and keeps that
 * pin, so all three sign-in methods are genuinely offered and App Store guideline
 * 4.8 is satisfied in substance.
 *
 * Not in polish. **Native `expo-apple-authentication` in a development build is a
 * launch blocker**, filed in `.pipeline/backlog.md`. This run is compliant, and
 * E10 is where the native experience closes.
 *
 * ---------------------------------------------------------------------------
 * The pairing rule, which is a rule and not a preference
 * ---------------------------------------------------------------------------
 * Offering Google without offering Apple is an App Store rejection under
 * guideline 4.8 (brief hard constraint 4). `SIGN_IN_PROVIDERS` below is ordered
 * and exported so the sign-in screen renders from it rather than from a hand-kept
 * list, and ST-A04 AC 2's static test fails the build if Google appears without
 * Apple. Failing a build is much cheaper than failing a review.
 *
 * No branch here logs an email, a password or a token (ST-A04 AC 9).
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { supabase, isConfigured } from './supabase';
import { AccountFailure } from './accounts';
import { toAccountError, isExistingAddressDecoy, isUserCancelled } from './accountErrors';
import { resetGuestState, setStoreAuth } from './store';

export type OAuthProvider = 'apple' | 'google';

/**
 * Apple first, deliberately. Guideline 4.8 is about Apple being offered at least
 * as prominently as the alternatives, and an ordered constant is harder to get
 * wrong than a convention.
 */
export const SIGN_IN_PROVIDERS: readonly OAuthProvider[] = ['apple', 'google'] as const;

/**
 * The redirect registered with Supabase and with both providers.
 *
 * Must match `OAUTH_REDIRECT` in `lib/auth-config.mjs` byte for byte — ST-A01
 * AC 6 exists because a mismatch here is the classic works-on-web-fails-on-device
 * bug, and `scripts/verify-auth-config.mjs` asserts the same string against the
 * live project so the two cannot drift silently.
 */
export const OAUTH_REDIRECT = 'ductective://auth-callback';

function client() {
  if (!isConfigured || !supabase) {
    throw new AccountFailure({ code: 'network', detail: null, hint: 'Supabase env is missing.' });
  }
  return supabase;
}

const fail = (raw: unknown): never => {
  throw new AccountFailure(toAccountError(raw as never));
};

// ---------------------------------------------------------------------------
// Email and password
// ---------------------------------------------------------------------------

export type SignUpOutcome =
  | { status: 'signed-in'; userId: string }
  /**
   * The address is already registered. **Measured, not assumed** — see
   * `isExistingAddressDecoy`. GoTrue answers a duplicate sign-up with a
   * successful-looking response carrying an empty `identities` array and no
   * session, so the app must detect it or it will congratulate a technician on
   * an account that does not exist and their real history will appear to have
   * vanished. That is OQ-A9's worst outcome and this is where it is caught.
   */
  | { status: 'address-in-use' }
  /**
   * Email confirmation is ON for this project (measured 10 Aug 2026) and a
   * confirmation mail was sent. OQ-A7b wants it OFF for the beta; until ST-A01's
   * dashboard toggle is flipped this is what a real sign-up returns, so the app
   * handles it rather than treating brief AC 1 as broken.
   */
  | { status: 'confirmation-required' };

export async function signUpWithEmail(email: string, password: string): Promise<SignUpOutcome> {
  const { data, error } = await client().auth.signUp({ email: email.trim(), password });
  if (error) fail(error);
  if (isExistingAddressDecoy(data)) return { status: 'address-in-use' };
  if (!data.session) return { status: 'confirmation-required' };
  return { status: 'signed-in', userId: data.user!.id };
}

export async function signInWithEmail(email: string, password: string): Promise<{ userId: string }> {
  const { data, error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) fail(error);
  return { userId: data.user!.id };
}

// ---------------------------------------------------------------------------
// Apple and Google — the OAuth web flow
// ---------------------------------------------------------------------------

export type OAuthOutcome =
  | { status: 'signed-in'; userId: string }
  /** The technician dismissed the sheet. **Not an error.** Resolve silently. */
  | { status: 'cancelled' };

/**
 * Run one provider round trip and set the session.
 *
 * `skipBrowserRedirect: true` because supabase-js's own redirect is a web-page
 * behaviour and there is no page here — we open the URL ourselves and read the
 * tokens back off the callback, which is also why `detectSessionInUrl` is false
 * on the client (`supabase.ts`).
 *
 * **BLOCKED, honestly:** as measured on 10 Aug 2026 the Apple and Google
 * providers are **not enabled** on this Supabase project, so this function
 * currently rejects with `provider_disabled`. That is ST-A20 (Apple Developer
 * Program enrolment and provider credentials — Human-owned, with external lead
 * time), not a defect in this code. The wiring ships now so that enabling the
 * toggles is the only remaining step.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthOutcome> {
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'ductective', path: 'auth-callback' });

  const { data, error } = await client().auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) fail(error);
  if (!data?.url) fail({ message: 'provider is not enabled', code: 'provider_disabled' });

  const result = await WebBrowser.openAuthSessionAsync(data!.url!, redirectTo);
  if (isUserCancelled(result)) return { status: 'cancelled' };
  if (result.type !== 'success') fail({ message: 'provider error', code: 'provider_disabled' });

  const params = parseCallback((result as { url: string }).url);
  if (params.error) {
    fail({ message: params.error_description ?? params.error, code: params.error });
  }
  if (!params.access_token || !params.refresh_token) {
    fail({ message: 'no tokens on the callback', code: null });
  }

  const { data: session, error: setErr } = await client().auth.setSession({
    access_token: params.access_token!,
    refresh_token: params.refresh_token!,
  });
  if (setErr) fail(setErr);

  await captureProviderName(session.user?.user_metadata ?? null);
  return { status: 'signed-in', userId: session.user!.id };
}

/**
 * Tokens come back in the URL **fragment**, not the query string. Reading them
 * from `searchParams` is the mistake that makes this work on some providers and
 * not others, so both are parsed and the fragment wins.
 */
export function parseCallback(url: string): Record<string, string | undefined> {
  const out: Record<string, string> = {};
  const take = (blob: string) => {
    for (const [k, v] of new URLSearchParams(blob).entries()) out[k] = v;
  };
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  if (query >= 0) take(url.slice(query + 1, hash >= 0 ? hash : undefined));
  if (hash >= 0) take(url.slice(hash + 1));
  return out;
}

/**
 * ST-A04 AC 4 — capture Apple's name on the **first** authorization.
 *
 * Apple returns the user's full name only on the very first authorization for an
 * Apple ID, ever. If it is not captured on that callback it cannot be retrieved
 * again for that Apple ID — it is a permanent data loss, not a retry. So this
 * runs on every provider sign-in and writes the name only when the profile does
 * not already have one: overwriting a name the technician set by hand with one
 * Apple happened to send would be worse than not capturing it at all.
 */
async function captureProviderName(metadata: Record<string, unknown> | null): Promise<void> {
  const raw = metadata?.full_name ?? metadata?.name ?? metadata?.display_name;
  const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
  if (!name) return;

  const { data: existing } = await client().from('profiles').select('display_name').maybeSingle();
  if (existing?.display_name && String(existing.display_name).trim().length) return;

  await client().from('profiles').update({ display_name: name }).eq('id', (await currentUserId()) ?? '');
}

async function currentUserId(): Promise<string | null> {
  const { data } = await client().auth.getUser();
  return data?.user?.id ?? null;
}

/**
 * ST-A11 AC 4 — which sign-in methods are linked to this account.
 *
 * Apple Private Relay means a user whose Apple identity returns an
 * `@privaterelay.appleid.com` alias **will** get a separate account from their
 * password account, and no client logic can join them (§1k). The screen says so
 * rather than failing silently; this is where it gets the facts to say it with.
 */
export async function linkedProviders(): Promise<string[]> {
  const { data, error } = await client().auth.getUserIdentities();
  if (error) return [];
  return (data?.identities ?? []).map((i) => i.provider);
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

/**
 * ST-A04 AC 7 / ST-A06 AC 10.
 *
 * Clears the stored session **and** the in-memory transcript. Leaving one
 * technician's text on screen for the next person to pick up the phone is a
 * privacy failure that no policy can catch, because nothing was ever written
 * anywhere for a policy to protect.
 *
 * The store flips to guest before the sign-out call rather than after, so a write
 * that is already in flight cannot land in the database on the way out.
 */
export async function signOut(): Promise<void> {
  setStoreAuth(false);
  resetGuestState();
  const { error } = await client().auth.signOut();
  if (error) fail(error);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Read the stored session once at startup and keep the store in step afterwards.
 *
 * Returns an unsubscribe function. **Call it on unmount** — a leaked
 * `onAuthStateChange` listener across sign-out/sign-in is how stale-user bugs get
 * in, and ST-A02 AC 6 asserts the unsubscribe statically.
 *
 * `onResolved` fires exactly once, when the stored-session read completes. Until
 * then the shell must render neither the guest state nor the signed-in state
 * (ST-A02 AC 7) — showing "nothing is saved while you are signed out" to a
 * signed-in technician for 200ms at every cold start is a lie the UI tells
 * itself into.
 */
export function startAuth(handlers: {
  onResolved: (user: { id: string; email?: string | null } | null) => void;
  onSignedIn: (user: { id: string; email?: string | null }) => void;
  onSignedOut: () => void;
}): () => void {
  if (!isConfigured || !supabase) {
    // No env: there is no session to restore and never will be. Resolve straight
    // to guest so the shell renders something rather than spinning forever.
    handlers.onResolved(null);
    return () => {};
  }

  let cancelled = false;

  supabase.auth.getSession().then(({ data }) => {
    if (cancelled) return;
    const user = data.session?.user ?? null;
    setStoreAuth(Boolean(user));
    handlers.onResolved(user ? { id: user.id, email: user.email } : null);
  });

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    if (cancelled) return;
    const user = session?.user ?? null;
    setStoreAuth(Boolean(user));
    if (user) handlers.onSignedIn({ id: user.id, email: user.email });
    else handlers.onSignedOut();
  });

  return () => {
    cancelled = true;
    sub.subscription.unsubscribe();
  };
}
