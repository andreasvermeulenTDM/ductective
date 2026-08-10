/**
 * ST-A02 AC 7 — three auth states, and the third one is never rendered as either
 * of the other two.
 *
 *   npm test
 *
 * The bug this file exists to prevent is specific and visible: a shell that
 * collapses `determining` into `guest` shows "nothing is saved while you are
 * signed out" to a signed-in technician for 200ms at every cold start. It is not
 * a crash, nothing logs, and it tells the user the opposite of the truth about
 * the one thing OQ-A4 requires the app to be honest about.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_AUTH_STATE,
  isDetermining,
  isPersisting,
  nextAuthState,
} from './authState.ts';

const USER = { id: 'u-1', email: 'tech@shop.test' };

test('the app starts in `determining`, which is neither of the other two', () => {
  assert.equal(INITIAL_AUTH_STATE.phase, 'determining');
  assert.equal(isDetermining(INITIAL_AUTH_STATE), true);
  assert.equal(isPersisting(INITIAL_AUTH_STATE), false);
});

test('a stray signed-out during startup cannot flash the guest state', () => {
  const s = nextAuthState(INITIAL_AUTH_STATE, { type: 'signed-out' });
  assert.equal(s.phase, 'determining', 'only `resolved` may leave the determining state');
});

test('resolving with a stored session goes straight to signed-in, with no guest frame', () => {
  const s = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: USER });
  assert.equal(s.phase, 'signed-in');
  assert.equal(s.userId, 'u-1');
  assert.equal(isPersisting(s), true);
  assert.equal(s.justSignedIn, false, 'a cold start has no transcript to split');
});

test('resolving with no stored session goes to guest', () => {
  const s = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: null });
  assert.equal(s.phase, 'guest');
  assert.equal(isPersisting(s), false);
});

test('OQ-A4 sub-decision 2: guest → signed-in marks the boundary exactly once', () => {
  const guest = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: null });
  const signedIn = nextAuthState(guest, { type: 'signed-in', user: USER });
  assert.equal(signedIn.justSignedIn, true, 'the transcript needs a "saved from here" marker');

  const acknowledged = nextAuthState(signedIn, { type: 'boundary-acknowledged' });
  assert.equal(acknowledged.justSignedIn, false);
  assert.equal(acknowledged.phase, 'signed-in');
});

test('a token refresh is not a sign-in and must not re-mark the transcript', () => {
  const guest = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: null });
  const signedIn = nextAuthState(guest, { type: 'signed-in', user: USER });
  const acknowledged = nextAuthState(signedIn, { type: 'boundary-acknowledged' });

  // autoRefreshToken fires roughly hourly. Without this guard a long job would
  // collect a "saved from here" marker every hour.
  const refreshed = nextAuthState(acknowledged, { type: 'signed-in', user: USER });
  assert.equal(refreshed.justSignedIn, false);
  assert.equal(refreshed.phase, 'signed-in');
});

test('switching to a different user does mark a boundary is NOT claimed — it resets cleanly', () => {
  const first = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: USER });
  const second = nextAuthState(first, { type: 'signed-in', user: { id: 'u-2' } });
  assert.equal(second.userId, 'u-2');
  assert.equal(second.justSignedIn, false, 'signed-in → signed-in is an account switch, not a guest upgrade');
});

test('signing out returns to guest and clears the identity', () => {
  const signedIn = nextAuthState(INITIAL_AUTH_STATE, { type: 'resolved', user: USER });
  const out = nextAuthState(signedIn, { type: 'signed-out' });
  assert.equal(out.phase, 'guest');
  assert.equal(out.userId, null);
  assert.equal(out.email, null);
  assert.equal(isPersisting(out), false);
});

test('every reachable state is exactly one of the three', () => {
  const seen = new Set();
  let s = INITIAL_AUTH_STATE;
  for (const event of [
    { type: 'resolved', user: null },
    { type: 'signed-in', user: USER },
    { type: 'boundary-acknowledged' },
    { type: 'signed-out' },
    { type: 'signed-in', user: USER },
  ]) {
    seen.add(s.phase);
    s = nextAuthState(s, event);
  }
  seen.add(s.phase);
  assert.deepEqual([...seen].sort(), ['determining', 'guest', 'signed-in']);
});
