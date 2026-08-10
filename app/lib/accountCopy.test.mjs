/**
 * ST-A04 AC 5, ST-A10 AC 3, ST-A12 — the copy contract.
 *
 *   npm test
 *
 * `accountErrors.test.mjs` proves a Supabase failure maps to the right *code*.
 * This proves the code maps to the right *words*, which is where two of this
 * run's rules actually get kept or broken:
 *
 *  - a cancelled OAuth sheet must render nothing at all, and
 *  - `auth_delete_unavailable` must never read as the technician's fault.
 *
 * Plain `.mjs` so `node --test` finds it; the module under test is TypeScript
 * with a single type-only import, which Node erases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPANY_OPTIONAL,
  COMPANY_PRIVACY,
  DELETE_ACCOUNT,
  GUEST_DISCLOSURE,
  GUEST_HISTORY,
  PRIVATE_RELAY_NOTE,
  SAVED_FROM_HERE,
  copyForError,
  isSilentOutcome,
} from './accountCopy.ts';

/** Every code in `AccountErrorCode`, copied from accountErrors.ts's union. */
const ALL_CODES = [
  'invalid_credentials', 'email_taken', 'weak_password', 'invalid_email',
  'email_not_confirmed', 'rate_limited', 'provider_disabled', 'cancelled', 'network',
  'not_authenticated', 'not_company_owner', 'company_name_invalid', 'last_owner',
  'sole_owner_of_company', 'join_code_unknown', 'join_code_expired',
  'join_code_revoked', 'join_code_exhausted', 'already_a_member',
  'auth_delete_unavailable', 'unknown',
];

test('every error code has its own copy — no code falls through to a shrug', () => {
  const generic = copyForError('unknown');
  for (const code of ALL_CODES) {
    if (code === 'unknown') continue;
    const copy = copyForError(code);
    assert.notDeepEqual(copy, generic, `${code} has no copy of its own`);
    assert.ok(copy.title.length > 0, `${code} has an empty title`);
    assert.ok(copy.detail.length > 0, `${code} has an empty detail`);
  }
});

test('ST-A10 AC 3: an unmapped error is a readable state, never a blank screen', () => {
  for (const nonsense of ['something_nobody_has_seen', '', null, undefined]) {
    const copy = copyForError(nonsense);
    assert.equal(copy.tone, 'error');
    assert.ok(copy.title.length > 0);
    assert.ok(copy.detail.length > 0);
  }
});

test('ST-A04 AC 5: at least five sign-in outcomes are distinguishable to a user', () => {
  const titles = [
    'invalid_credentials', 'invalid_email', 'weak_password', 'network',
    'rate_limited', 'provider_disabled', 'email_taken',
  ].map((c) => copyForError(c).title);
  assert.equal(new Set(titles).size, titles.length, 'two outcomes read identically');
});

test('ST-A04 AC 5: a cancelled sheet is silent, and nothing else is', () => {
  assert.equal(isSilentOutcome('cancelled'), true);
  for (const code of ALL_CODES) {
    if (code === 'cancelled') continue;
    assert.equal(isSilentOutcome(code), false, `${code} must not be swallowed`);
  }
});

test('three outcomes are notices, not errors — they are routing, not failure', () => {
  // §3.1 of the backend contract names these three explicitly. Painting a
  // "sign in with your password instead" red teaches a technician to fear a
  // message whose whole job is telling them which button to press.
  assert.equal(copyForError('email_taken').tone, 'notice');
  assert.equal(copyForError('already_a_member').tone, 'notice');
  assert.equal(copyForError('auth_delete_unavailable').tone, 'notice');
});

test('auth_delete_unavailable never reads as the technician\'s fault', () => {
  const copy = copyForError('auth_delete_unavailable');
  // It is a deployment gap. Two things must be true of the words: they say
  // nothing was deleted, and they do not blame or instruct the user.
  assert.match(copy.detail, /nothing was deleted|not something you did/i);
  assert.equal(copy.tone, 'notice');
});

test('sole_owner_of_company states that nothing was deleted and names both exits', () => {
  const copy = copyForError('sole_owner_of_company');
  assert.match(copy.detail, /nothing has been deleted/i);
  assert.match(copy.detail, /owner/i);
  assert.match(copy.detail, /delete the company/i);
});

test('every join-code failure says what to do next rather than only what went wrong', () => {
  for (const code of ['join_code_unknown', 'join_code_expired', 'join_code_revoked', 'join_code_exhausted']) {
    assert.match(copyForError(code).detail, /ask|check/i, `${code} offers no next step`);
  }
});

// ---------------------------------------------------------------------------
// ST-A06 — the guest disclosure says what is LOST
// ---------------------------------------------------------------------------

test('ST-A06 AC 6: the disclosure names the loss and is not softened into an offer', () => {
  const body = GUEST_DISCLOSURE.body.toLowerCase();
  // The criterion is explicit: "the user needs to know what is lost, not what is
  // offered". Closing the app losing the conversation is the fact that has to be
  // on screen before the first answer.
  assert.match(body, /close the app/);
  assert.match(body, /gone|lost/);
  assert.match(body, /not signed in/);
  // "may lose" would be false — there is no cache and no recovery.
  assert.doesNotMatch(body, /might lose|may lose|could lose/);
  // And it must not be the softened version the criterion rules out.
  assert.doesNotMatch(body, /sign in to save/);
});

test('ST-A06 AC 6: the disclosure does not imply a guest gets worse answers', () => {
  // §1j: a guest gets real, live, cited answers. Persistence degrades; quality
  // does not, and the copy must not suggest otherwise.
  assert.match(GUEST_DISCLOSURE.body, /same/i);
});

test('ST-A06 AC 7: the History empty state explains and offers a way forward', () => {
  assert.match(GUEST_HISTORY.title, /nothing is saved/i);
  assert.match(GUEST_HISTORY.detail, /gone|until you close/i);
  assert.ok(GUEST_HISTORY.action.length > 0, 'an empty tab with no action is a dead end');
});

test('ST-A06 AC 9: the boundary marker exists and says which half survives', () => {
  assert.match(SAVED_FROM_HERE.label, /saved from here/i);
  assert.match(SAVED_FROM_HERE.detail, /before you signed in/i);
  assert.match(SAVED_FROM_HERE.detail, /kept|saved/i);
});

// ---------------------------------------------------------------------------
// ST-A18 — the privacy posture, and ST-A13's no-company-required rule
// ---------------------------------------------------------------------------

test('ST-A18: the privacy statement names what a company can and cannot see', () => {
  assert.match(COMPANY_PRIVACY.can, /name/i);
  assert.match(COMPANY_PRIVACY.can, /trade role/i);
  for (const forbidden of [/job/i, /question/i, /answer/i, /citation/i]) {
    assert.match(COMPANY_PRIVACY.cannot, forbidden);
  }
  // The claim is only true while no company-read policy exists on
  // sessions/messages/citations. Stage 5's OQ-A1 guard is the other half of
  // ST-A18 AC 4 and is what turns red if somebody adds one.
  assert.match(COMPANY_PRIVACY.cannot, /^not\b/i);
});

test('ST-A13 AC 7: no copy anywhere implies a company is required', () => {
  const everything = [
    COMPANY_OPTIONAL,
    COMPANY_PRIVACY.can,
    COMPANY_PRIVACY.cannot,
    GUEST_DISCLOSURE.body,
    GUEST_HISTORY.detail,
    PRIVATE_RELAY_NOTE,
    DELETE_ACCOUNT.what,
    ...ALL_CODES.map((c) => `${copyForError(c).title} ${copyForError(c).detail}`),
  ].join(' ');
  assert.doesNotMatch(everything, /must (create|join) a compan/i);
  assert.match(COMPANY_OPTIONAL, /optional/i);
});

// ---------------------------------------------------------------------------
// ST-A12 — deletion
// ---------------------------------------------------------------------------

test('ST-A12 AC 9: deletion copy states exactly what is destroyed and that it is final', () => {
  for (const thing of [/account/i, /job/i, /question/i, /answer/i, /citation/i]) {
    assert.match(DELETE_ACCOUNT.what, thing);
  }
  assert.match(DELETE_ACCOUNT.irreversible, /cannot be undone/i);
  assert.match(DELETE_ACCOUNT.irreversible, /no backup|no way/i);
});

test('ST-A12 AC 9: the confirmation is a typed word, not a second tap', () => {
  assert.equal(DELETE_ACCOUNT.confirmWord, 'DELETE');
  assert.match(DELETE_ACCOUNT.confirmPrompt, /type/i);
  assert.match(DELETE_ACCOUNT.confirmPrompt, new RegExp(DELETE_ACCOUNT.confirmWord));
});

test('ST-A11 AC 4: Private Relay is disclosed rather than pretended away', () => {
  assert.match(PRIVATE_RELAY_NOTE, /apple/i);
  assert.match(PRIVATE_RELAY_NOTE, /separate|alias/i);
});
