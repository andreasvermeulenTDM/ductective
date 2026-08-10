/**
 * ST-A04 AC 5 and AC 8 — the error contract Stage 4 renders from.
 *
 *   npm test
 *
 * Two cases here are the ones worth having: a cancelled OAuth sheet is **not an
 * error** and must never render as one, and a duplicate sign-up is **not a
 * success** even though GoTrue answers it like one. Getting either wrong shows a
 * technician something untrue about their own account.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isExistingAddressDecoy,
  isUserCancelled,
  toAccountError,
} from './accountErrors.ts';

test('at least five distinct auth outcomes map to distinct codes (AC 5)', () => {
  const codes = [
    toAccountError({ code: 'invalid_credentials', message: 'Invalid login credentials' }).code,
    toAccountError({ code: 'email_exists', message: 'A user with this email address has already been registered' }).code,
    toAccountError({ code: 'weak_password', message: 'Password should be at least 6 characters' }).code,
    toAccountError({ code: 'email_address_invalid', message: 'Email address "x" is invalid' }).code,
    toAccountError({ name: 'AuthRetryableFetchError', message: 'fetch failed' }).code,
    toAccountError({ status: 429, message: 'email rate limit exceeded' }).code,
    toAccountError({ message: 'Unsupported provider: provider is not enabled' }).code,
  ];
  assert.deepEqual(codes, [
    'invalid_credentials',
    'email_taken',
    'weak_password',
    'invalid_email',
    'network',
    'rate_limited',
    'provider_disabled',
  ]);
  assert.equal(new Set(codes).size, codes.length, 'every outcome must be distinguishable');
});

test('a cancelled OAuth sheet is not an error (AC 5)', () => {
  assert.equal(isUserCancelled({ type: 'cancel' }), true);
  assert.equal(isUserCancelled({ type: 'dismiss' }), true);
  assert.equal(isUserCancelled({ type: 'success' }), false);
  assert.equal(isUserCancelled(null), false);
});

test('our own database errors survive PostgREST intact, with their detail', () => {
  const e = toAccountError({
    code: 'P0001',
    message: 'sole_owner_of_company',
    details: '11111111-2222-3333-4444-555555555555',
    hint: 'Promote another member to owner, or delete the company, then try again.',
  });
  assert.equal(e.code, 'sole_owner_of_company');
  // ST-A12 AC 5: the payload must name the company so the UI can act on it.
  assert.equal(e.detail, '11111111-2222-3333-4444-555555555555');
  assert.match(e.hint, /Promote another member/);
});

test('every join-code failure mode is its own code', () => {
  for (const code of [
    'join_code_unknown',
    'join_code_expired',
    'join_code_revoked',
    'join_code_exhausted',
    'already_a_member',
    'last_owner',
    'not_company_owner',
    'auth_delete_unavailable',
  ]) {
    assert.equal(toAccountError({ code: 'P0001', message: code }).code, code);
  }
});

test('an unrecognised error is `unknown`, never a guess', () => {
  assert.equal(toAccountError({ message: 'something nobody has seen' }).code, 'unknown');
  assert.equal(toAccountError(null).code, 'unknown');
  assert.equal(toAccountError(undefined).code, 'unknown');
});

test('OQ-A9 (AC 8): the measured duplicate-address decoy is detected', () => {
  // Measured against the live project on 10 Aug 2026 with
  // `npm run measure:linking`: signUp on an existing address does NOT error. It
  // returns a user with an EMPTY identities array and no session. Treating that
  // as success would congratulate a technician on an account that does not
  // exist, and their real history would appear to have vanished.
  assert.equal(isExistingAddressDecoy({ user: { identities: [] }, session: null }), true);

  // A genuine new sign-up carries at least one identity.
  assert.equal(
    isExistingAddressDecoy({ user: { identities: [{ provider: 'email' }] }, session: null }),
    false
  );
  // A signed-in result is never a decoy, whatever the identities say.
  assert.equal(isExistingAddressDecoy({ user: { identities: [] }, session: { access_token: 'x' } }), false);
  assert.equal(isExistingAddressDecoy(null), false);
  assert.equal(isExistingAddressDecoy({ user: null }), false);
});

test('no mapping branch echoes a credential', () => {
  // AC 9 in spirit: the mapper must not carry a password or token into anything a
  // screen might render or log. Only code/detail/hint come out.
  const e = toAccountError({ message: 'Invalid login credentials', code: 'invalid_credentials' });
  assert.deepEqual(Object.keys(e).sort(), ['code', 'detail', 'hint']);
});
