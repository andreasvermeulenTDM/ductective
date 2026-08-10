/**
 * ST-A01 AC 3 — the config verifier must name the exact toggle that is wrong.
 *
 *   npm test
 *
 * A verifier that reports "auth is misconfigured" costs more time than it saves:
 * the person reading it still has to go and find out which of six dashboard
 * switches it meant. So the failure branches are asserted here against a stubbed
 * client rather than against the live project, which cannot be misconfigured on
 * demand.
 *
 * The check that matters most is the one asserting the **absence** of a
 * capability: anonymous sign-in must fail. OQ-A4 removed the only reason to have
 * it, and a re-enabled toggle would silently restore the ownerless-user path
 * ST-A14 exists to close — with nothing in the repo changing to say so.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OAUTH_REDIRECT,
  PAIRING_RULE,
  REQUIRED_PROVIDERS,
  SCRATCH_EMAIL_DOMAIN,
  checkAuthConfig,
  providerEnabled,
  scratchEmail,
} from './auth-config.mjs';

const find = (checks, needle) => checks.find((c) => c.name.includes(needle));

/** A client whose every answer is configurable, and which records nothing else. */
function stubAnon({ signUp, anonymous, oauth }) {
  return {
    auth: {
      signUp: async () => signUp,
      signInAnonymously: async () => anonymous,
      signInWithOAuth: async ({ provider }) => oauth(provider),
    },
  };
}

const stubAdmin = { auth: { admin: { deleteUser: async () => ({ error: null }) } } };

const goodSignUp = {
  data: { user: { id: 'u1', email_confirmed_at: '2026-08-10T00:00:00Z' }, session: { access_token: 't' } },
  error: null,
};
const okOAuth = (provider) => ({
  data: { url: `https://x.supabase.co/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(OAUTH_REDIRECT)}` },
  error: null,
});

/**
 * Every network hop is stubbed, `fetch` included. A unit test that reaches the
 * internet is a unit test that fails on a train, and this one would do it while
 * appearing to test a dashboard toggle.
 */
const stubFetch = async () => ({ status: 302, headers: { get: () => 'https://appleid.apple.com/auth/authorize' } });
const run = (opts) => checkAuthConfig({ fetchImpl: stubFetch, ...opts, admin: stubAdmin });

test('a correctly configured project passes every check', async () => {
  const { checks } = await run({
    anon: stubAnon({
      signUp: goodSignUp,
      anonymous: { data: {}, error: { code: 'anonymous_provider_disabled', message: 'off' } },
      oauth: okOAuth,
    }),
    providers: [],
  });
  assert.equal(find(checks, 'email confirmation is OFF').ok, true);
  assert.equal(find(checks, 'anonymous sign-in is DISABLED').ok, true);
  assert.ok(checks.every((c) => c.ok), checks.filter((c) => !c.ok).map((c) => c.name).join(', '));
});

test('confirmation ON fails, and names the Confirm email toggle', async () => {
  const { checks } = await run({
    anon: stubAnon({
      signUp: { data: { user: { id: 'u1' }, session: null }, error: null },
      anonymous: { data: {}, error: { code: 'anonymous_provider_disabled' } },
      oauth: okOAuth,
    }),
    providers: [],
  });
  const c = find(checks, 'email confirmation is OFF');
  assert.equal(c.ok, false);
  assert.match(c.hint, /Confirm email/);
  assert.match(c.hint, /Authentication/);
});

test('anonymous sign-in ON fails — the absence check is the one that rots quietest', async () => {
  const { checks } = await run({
    anon: stubAnon({
      signUp: goodSignUp,
      anonymous: { data: { user: { id: 'anon-1' }, session: { access_token: 't' } }, error: null },
      oauth: okOAuth,
    }),
    providers: [],
  });
  const c = find(checks, 'anonymous sign-in is DISABLED');
  assert.equal(c.ok, false);
  assert.match(c.hint, /anonymous sign-ins/i);
});

test('a disabled provider fails and names that provider, not "OAuth"', async () => {
  const { checks } = await run({
    anon: stubAnon({
      signUp: goodSignUp,
      anonymous: { data: {}, error: { code: 'anonymous_provider_disabled' } },
      oauth: () => ({ data: null, error: { message: 'Unsupported provider: provider is not enabled' } }),
    }),
    providers: ['apple'],
  });
  const c = find(checks, 'apple provider is enabled');
  assert.equal(c.ok, false);
  assert.match(c.hint, /Apple/);
  assert.match(c.hint, /Services ID/);
});

test('a redirect mismatch is its own failure, not folded into "provider broken"', async () => {
  const { checks } = await run({
    anon: stubAnon({
      signUp: goodSignUp,
      anonymous: { data: {}, error: { code: 'anonymous_provider_disabled' } },
      oauth: () => ({ data: { url: 'https://x.supabase.co/auth/v1/authorize?redirect_to=exp%3A%2F%2Fwrong' }, error: null }),
    }),
    providers: ['google'],
  });
  const c = find(checks, 'redirect_to matches');
  assert.equal(c.ok, false);
  assert.match(c.hint, /Redirect URLs/);
});

test('every scratch user created is handed to cleanup, including the anonymous one', async () => {
  const { createdUserIds } = await run({
    anon: stubAnon({
      signUp: goodSignUp,
      anonymous: { data: { user: { id: 'anon-1' }, session: { access_token: 't' } }, error: null },
      oauth: okOAuth,
    }),
    providers: [],
  });
  assert.deepEqual(createdUserIds.sort(), ['anon-1', 'u1']);
});

test('providerEnabled reads the redirect, and a not-enabled answer is not enabled', async () => {
  const notEnabled = async () => ({
    status: 302,
    headers: { get: () => 'ductective://auth-callback?error=validation_failed&error_code=validation_failed' },
  });
  const enabled = async () => ({ status: 302, headers: { get: () => 'https://appleid.apple.com/auth/authorize?...' } });
  assert.equal(await providerEnabled('https://x/authorize', notEnabled), false);
  assert.equal(await providerEnabled('https://x/authorize', enabled), true);
  assert.equal(await providerEnabled('', enabled), false);
  // A network failure is not evidence of a working provider.
  assert.equal(await providerEnabled('https://x/authorize', async () => { throw new Error('offline'); }), false);
});

test('the pairing rule and the provider list are stated where code can see them', () => {
  assert.deepEqual([...REQUIRED_PROVIDERS], ['apple', 'google']);
  assert.match(PAIRING_RULE, /Apple/);
  assert.match(PAIRING_RULE, /never ship google alone/i);
});

test('scratch addresses use a resolvable domain — measured, not assumed', () => {
  // Both `@example.com` and an invented `.dev` domain were refused by this
  // project on 10 Aug 2026 with `Email address "…" is invalid`. A verifier that
  // fails forever for a reason unrelated to the toggle it checks is a check
  // nobody reads.
  assert.notEqual(SCRATCH_EMAIL_DOMAIN, 'example.com');
  assert.match(scratchEmail(), /^ductective-authcheck-[a-z0-9-]+@/);
  assert.notEqual(scratchEmail(), scratchEmail());
});
