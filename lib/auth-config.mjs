/**
 * auth-config.mjs — what this Supabase project's auth settings must be, and how
 * to tell whether they are.
 *
 * ST-A01. Every decision in `.pipeline/02-user-stories-accounts.md` §2 that lives
 * in a dashboard toggle rather than in code is asserted here, because a toggle is
 * exactly the kind of state that rots silently: nothing in the repo changes when
 * someone flips it, and the first symptom is a story failing for a reason that is
 * not a defect.
 *
 * Two of the checks assert the **absence** of a capability:
 *
 *   - anonymous sign-in must FAIL (OQ-A4 — the owner chose guest-mode-nothing-saved,
 *     so there is no reason for an `auth.users` row nobody asked for). A check that
 *     something is off is the one that rots quietest, which is why it is written
 *     explicitly rather than assumed from the absence of code.
 *   - a signed-up user must come back with a **session** (OQ-A7b — email confirmation
 *     off for the beta). If confirmation is re-enabled, brief AC 1's on-device proof
 *     starts depending on a rate-limited shared mailer.
 *
 * The logic is separated from the runner (`scripts/verify-auth-config.mjs`) so the
 * failure branches can be unit-tested against a stubbed client. ST-A01 AC 3: a
 * config verifier that cannot name the exact toggle that is wrong is not useful.
 *
 * Nothing here prints an email, a password, or a token.
 */

import { randomBytes } from 'node:crypto';

/**
 * The OAuth redirect the app registers with Supabase, and which ST-A20 must
 * register with Apple and Google.
 *
 * ST-A01 AC 6 exists because a mismatch between this value and what is registered
 * upstream is the single most common cause of an OAuth flow that works on web and
 * fails on device. It is a constant in one place so the app, the verifier and the
 * artifact cannot disagree.
 *
 * `ductective` is the app's scheme (`app/app.json`). The path segment is arbitrary
 * but must match byte-for-byte on both sides.
 */
export const OAUTH_REDIRECT = 'ductective://auth-callback';

/** Providers the owner chose (OQ-A7). Apple is not optional — see PAIRING_RULE. */
export const REQUIRED_PROVIDERS = ['apple', 'google'];

/**
 * App Store guideline 4.8, restated where the code can see it: offering Google
 * without offering Sign in with Apple is a rejection, not a warning. Brief hard
 * constraint 4. ST-A04 AC 2 turns this into a build-failing test.
 */
export const PAIRING_RULE =
  'Sign in with Apple must be offered wherever Google is. Never ship Google alone.';

const HINTS = {
  confirmation:
    'Supabase dashboard → Authentication → Sign In / Providers → Email → turn OFF "Confirm email".',
  anonymous:
    'Supabase dashboard → Authentication → Sign In / Providers → turn OFF "Allow anonymous sign-ins".',
  apple:
    'Supabase dashboard → Authentication → Sign In / Providers → Apple → enable, and paste the Services ID, Team ID, Key ID and .p8 from ST-A20.',
  google:
    'Supabase dashboard → Authentication → Sign In / Providers → Google → enable, and paste the OAuth client id/secret from ST-A20.',
  redirect: `Supabase dashboard → Authentication → URL Configuration → add "${OAUTH_REDIRECT}" to Redirect URLs, and register the same value with the provider (ST-A20).`,
};

/**
 * Domain for throwaway accounts.
 *
 * **It must be a domain that really resolves.** Measured 10 Aug 2026 against the
 * live project, both rejected with `Email address "…" is invalid`:
 *
 *   - `@example.com`             — the RFC-reserved domain, refused outright
 *   - `@ductective-scratch.dev`  — well-formed, but the domain does not exist
 *
 * `@gmail.com` was accepted. So this project's Supabase Auth validates the
 * *domain*, not just the address shape, and a verifier that used a reserved or
 * invented domain would fail forever for a reason that has nothing to do with the
 * toggle it is checking — which is the always-red-check failure mode
 * `lib/secrets.mjs` already warns about.
 *
 * Set `DUCTECTIVE_SCRATCH_EMAIL_DOMAIN` to a domain the project owns as soon as
 * there is one; that is the right long-term answer and it is filed in
 * SETUP-BLOCKERS.md. Until then the default is a real, resolvable domain with a
 * random local part. **No mail is ever sent to it** once ST-A01's "Confirm email"
 * toggle is off, and every account created here is deleted in the same run.
 */
export const SCRATCH_EMAIL_DOMAIN =
  process.env.DUCTECTIVE_SCRATCH_EMAIL_DOMAIN || 'gmail.com';

/** A throwaway address that cannot collide with a real tester's. */
export function scratchEmail(rand = Math.random) {
  return `ductective-authcheck-${Date.now().toString(36)}-${Math.floor(rand() * 1e9).toString(36)}@${SCRATCH_EMAIL_DOMAIN}`;
}

/** 32 hex characters. Never logged, never persisted, never reused. */
export function scratchPassword(bytes) {
  return `Dx-${(bytes ?? randomBytes(16)).toString('hex')}`;
}

const result = (name, ok, detail, hint) => ({ name, ok, detail, hint: ok ? null : hint });

/**
 * Run every configuration assertion.
 *
 * @param {object} opts
 * @param {object} opts.anon   supabase-js client built with the ANON key. Auth calls
 *                             go through this one — the app has no other key.
 * @param {object} opts.admin  service-role client. Cleanup **only**. It bypasses RLS,
 *                             so any assertion made with it would prove nothing.
 * @returns {Promise<{checks: Array, createdUserIds: string[]}>}
 */
export async function checkAuthConfig({ anon, admin, providers = REQUIRED_PROVIDERS, fetchImpl = fetch }) {
  const checks = [];
  const createdUserIds = [];

  // --- 1. email/password sign-up returns a session (confirmation OFF) --------
  const email = scratchEmail();
  const password = scratchPassword();
  const { data: signUp, error: signUpErr } = await anon.auth.signUp({ email, password });

  if (signUpErr) {
    checks.push(
      result(
        'email/password sign-up',
        false,
        `signUp failed: ${signUpErr.message}`,
        signUpErr.message?.toLowerCase().includes('disabled')
          ? 'Supabase dashboard → Authentication → Sign In / Providers → Email → enable "Email" and "Allow new users to sign up".'
          : HINTS.confirmation
      )
    );
  } else {
    if (signUp?.user?.id) createdUserIds.push(signUp.user.id);
    checks.push(result('email/password sign-up is enabled', true, 'signUp returned a user'));
    checks.push(
      result(
        'email confirmation is OFF',
        Boolean(signUp?.session?.access_token),
        signUp?.session ? 'signUp returned a session' : 'signUp returned no session',
        HINTS.confirmation
      )
    );
    // Recorded, not asserted. With confirmation off GoTrue autoconfirms, and a
    // confirmed address is what GoTrue uses to decide whether an OAuth identity
    // links to an existing user (OQ-A9). See scripts/measure-auth-linking.mjs.
    checks.push(
      result(
        'sign-up address is autoconfirmed',
        true,
        signUp?.user?.email_confirmed_at ? 'email_confirmed_at is set' : 'email_confirmed_at is NOT set'
      )
    );
  }

  // --- 2. anonymous sign-in is DISABLED (OQ-A4) -----------------------------
  // Asserting the absence of a capability. If this ever passes, ownerless
  // `auth.users` rows become creatable again and ST-A14's permanence claim dies.
  const { data: anonData, error: anonErr } = await anon.auth.signInAnonymously();
  if (anonData?.user?.id) createdUserIds.push(anonData.user.id);
  checks.push(
    result(
      'anonymous sign-in is DISABLED',
      Boolean(anonErr) && !anonData?.session,
      anonErr ? `rejected: ${anonErr.code ?? anonErr.status ?? 'error'}` : 'a session was issued',
      HINTS.anonymous
    )
  );

  // --- 3. Apple and Google are reachable (OQ-A7, gated on ST-A20) -----------
  for (const provider of providers) {
    const { data, error } = await anon.auth.signInWithOAuth({
      provider,
      options: { skipBrowserRedirect: true, redirectTo: OAUTH_REDIRECT },
    });
    const url = data?.url ?? '';
    // supabase-js builds the /authorize URL client-side, so a URL alone is not
    // proof the provider is on. The project answers `provider is not enabled`
    // when it is not, which is what this follows the URL to find out.
    const reachable = Boolean(url) && !error;
    checks.push(
      result(
        `${provider} provider is enabled`,
        reachable && (await providerEnabled(url, fetchImpl)),
        error ? error.message : url ? 'authorize URL issued' : 'no authorize URL',
        HINTS[provider]
      )
    );
    checks.push(
      result(
        `${provider} redirect_to matches ${OAUTH_REDIRECT}`,
        url.includes(encodeURIComponent(OAUTH_REDIRECT)),
        url ? 'redirect_to present in authorize URL' : 'no URL to inspect',
        HINTS.redirect
      )
    );
  }

  return { checks, createdUserIds, cleanup: () => cleanupUsers(admin, createdUserIds) };
}

/**
 * Follow the authorize URL far enough to learn whether the provider is configured.
 *
 * Supabase answers an unconfigured provider with a redirect back to the app whose
 * query string carries `error=...&error_code=validation_failed` and a message of
 * "Unsupported provider: provider is not enabled". A configured one redirects to
 * the provider's own domain. Neither case completes a sign-in, so this is safe to
 * run against a live project.
 */
export async function providerEnabled(url, fetchImpl = fetch) {
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { redirect: 'manual' });
    const location = res.headers?.get?.('location') ?? '';
    if (!location) return res.status >= 200 && res.status < 400;
    return !/error_code=|provider%20is%20not%20enabled|is+not+enabled/i.test(location);
  } catch {
    // A network failure is not evidence either way. Report not-enabled so the
    // check is loud rather than quietly green.
    return false;
  }
}

/** Service role, and only for this. Never used to assert anything. */
export async function cleanupUsers(admin, ids) {
  const failed = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) failed.push(id);
  }
  return failed;
}
