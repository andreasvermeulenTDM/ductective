/**
 * ST-F01 — the guest disclosure is clearable, and is still not skippable.
 *
 *   npm test
 *
 * Brief AC 1 has two halves and they pull against each other: the disclosure must
 * be removable (the owner's report), and a machine test must prove it still
 * appears before the first answer for someone who has never seen it (ST-A06 AC 6).
 * The rule that satisfies both is "no dismiss control until an answer has landed",
 * and the proof of the second half is ST-F01 AC 5 — `dismiss()` is a no-op before
 * then, so no caller, ordering or future refactor can reach `dismissed: true`
 * without an answer having been delivered first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  INITIAL_GUEST_NOTICE,
  canDismiss,
  dismiss,
  isAnswer,
  reset,
  sawTurn,
  setSignedIn,
  shouldShow,
} from './guestNotice.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every assistant kind the wire can deliver, including this run's new one. */
const ASSISTANT_KINDS = ['answer', 'clarify', 'refusal', 'conversational'];

// ---------------------------------------------------------------------------
// AC 2 / AC 3 — when the control exists at all
// ---------------------------------------------------------------------------

test('AC 2: no dismissal before an answer, dismissal after one', () => {
  assert.equal(canDismiss({ ...INITIAL_GUEST_NOTICE, answersSeen: 0 }), false);
  assert.equal(canDismiss({ ...INITIAL_GUEST_NOTICE, answersSeen: 1 }), true);
  assert.equal(canDismiss({ ...INITIAL_GUEST_NOTICE, answersSeen: 5 }), true);
});

test('AC 3: a signed-in technician can never reach a dismissal state', () => {
  // They are not shown the notice, so there is nothing to dismiss. Asserted at
  // every answer count, because "signed in" must win regardless of history.
  for (const answersSeen of [0, 1, 5]) {
    assert.equal(canDismiss({ signedIn: true, answersSeen, dismissed: false }), false);
    assert.equal(shouldShow({ signedIn: true, answersSeen, dismissed: false }), false);
  }
});

test('the notice shows for a guest and stops showing once dismissed', () => {
  assert.equal(shouldShow(INITIAL_GUEST_NOTICE), true);
  const seen = sawTurn(INITIAL_GUEST_NOTICE, 'answer');
  assert.equal(shouldShow(seen), true, 'an answer alone does not clear it — a tap does');
  assert.equal(shouldShow(dismiss(seen)), false);
});

// ---------------------------------------------------------------------------
// AC 4 — every assistant kind is an answer; a user turn is not
// ---------------------------------------------------------------------------

for (const kind of ASSISTANT_KINDS) {
  test(`AC 4: a ${kind} turn counts as an answer`, () => {
    const after = sawTurn(INITIAL_GUEST_NOTICE, kind);
    assert.equal(after.answersSeen, 1, `${kind} did not count`);
    assert.equal(canDismiss(after), true);
    assert.equal(isAnswer(kind), true);
  });
}

test('AC 4: a refusal is an answer — the unit gate case, said explicitly', () => {
  // U7 lets the gate refuse before any unit exists, which is the whole reason the
  // gate carries the disclosure. If a refusal did not count, a technician whose
  // first question was a hazard could never clear the notice.
  const after = sawTurn(INITIAL_GUEST_NOTICE, 'refusal');
  assert.equal(canDismiss(after), true);
});

test('AC 4: an answer carrying no documentation still counts', () => {
  // The no-documentation reply arrives as `kind: 'answer'` with a server-authored
  // body and no citations (lib/diagnose.mjs). It is an answer the technician read.
  const after = sawTurn(INITIAL_GUEST_NOTICE, 'answer');
  assert.equal(after.answersSeen, 1);
});

test('AC 4: the technician\'s own turns do not move the counter', () => {
  let s = INITIAL_GUEST_NOTICE;
  for (let i = 0; i < 5; i++) s = sawTurn(s, 'user');
  assert.equal(s.answersSeen, 0);
  assert.equal(canDismiss(s), false);
  assert.equal(isAnswer('user'), false);
});

// ---------------------------------------------------------------------------
// AC 5 — the disclosure is not skippable. This is brief AC 1's machine proof.
// ---------------------------------------------------------------------------

test('AC 5: dismiss() is a no-op before an answer has been delivered', () => {
  const before = INITIAL_GUEST_NOTICE;
  const after = dismiss(before);
  assert.deepEqual(after, before, 'the state changed — the disclosure became skippable');
  assert.equal(after.dismissed, false);
});

test('AC 5: no sequence of user turns alone can reach dismissed', () => {
  // Driven rather than argued: N user turns, then a dismiss attempt, for N in
  // 0..5. A screen that sends only the technician's own words can never clear the
  // notice, however many it sends.
  for (let n = 0; n <= 5; n++) {
    let s = INITIAL_GUEST_NOTICE;
    for (let i = 0; i < n; i++) s = sawTurn(s, 'user');
    assert.equal(dismiss(s).dismissed, false, `${n} user turns reached dismissed`);
    assert.equal(shouldShow(dismiss(s)), true, `the notice disappeared after ${n} user turns`);
  }
});

test('AC 5: a signed-in state cannot be used to set dismissed either', () => {
  const s = { signedIn: true, answersSeen: 3, dismissed: false };
  assert.equal(dismiss(s).dismissed, false);
});

test('the one legitimate route: an answer, then a tap', () => {
  const s = dismiss(sawTurn(sawTurn(INITIAL_GUEST_NOTICE, 'user'), 'answer'));
  assert.equal(s.dismissed, true);
  assert.equal(s.answersSeen, 1);
});

// ---------------------------------------------------------------------------
// AC 6 / AC 7 — reset, and the absence of persistence
// ---------------------------------------------------------------------------

test('AC 6: reset() returns the initial state', () => {
  const busy = { signedIn: true, answersSeen: 9, dismissed: true };
  assert.deepEqual(reset(busy), INITIAL_GUEST_NOTICE);
  assert.equal(reset(busy).dismissed, false);
  assert.equal(reset(busy).answersSeen, 0);
});

test('signing in and back out does not carry a dismissal across the change of hands', () => {
  // `setSignedIn` tracks auth; the shell calls `reset()` on a *user change*. Both
  // are asserted because a dismissal surviving a change of technician would show
  // the next person a screen that never told them nothing is being saved.
  const dismissed = dismiss(sawTurn(INITIAL_GUEST_NOTICE, 'answer'));
  assert.equal(dismissed.dismissed, true);
  assert.equal(setSignedIn(dismissed, true).signedIn, true);
  assert.equal(reset(dismissed).dismissed, false);
});

test('AC 7: the module holds no persistence at all', () => {
  // OQ-F1's default made structural rather than conventional. Owner decision,
  // 10 Aug 2026: the dismissal lasts until the app closes, and there is no stored
  // flag anywhere. A grep, because the point is that no future edit can add one
  // quietly.
  const src = readFileSync(join(HERE, 'guestNotice.ts'), 'utf8');
  assert.doesNotMatch(src, /AsyncStorage/, 'the dismissal must not persist across app runs');
  assert.doesNotMatch(src, /^\s*import\s/m, 'a pure module: no imports, no I/O, no storage');
  assert.doesNotMatch(src, /\brequire\(/);
  assert.doesNotMatch(src, /localStorage|SecureStore|MMKV/);
});

test('AC 1: it is importable under node --test with no React Native in sight', () => {
  const src = readFileSync(join(HERE, 'guestNotice.ts'), 'utf8');
  assert.doesNotMatch(src, /react-native|from 'react'/);
  // And the import at the top of this file already proved the runtime half.
  assert.equal(typeof canDismiss, 'function');
});

// ---------------------------------------------------------------------------
// The updaters are pure
// ---------------------------------------------------------------------------

test('no updater mutates the state it was given', () => {
  const s = { ...INITIAL_GUEST_NOTICE };
  const snapshot = JSON.stringify(s);
  sawTurn(s, 'answer');
  dismiss(s);
  setSignedIn(s, true);
  reset(s);
  assert.equal(JSON.stringify(s), snapshot);
});
