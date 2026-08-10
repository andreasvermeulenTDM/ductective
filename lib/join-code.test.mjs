/**
 * ST-A09 AC 2 — the join-code generator, over ten thousand samples.
 *
 *   npm test
 *
 * The three properties that matter, and why each is here rather than assumed:
 * a duplicate would let two shops share a code; an excluded character would make
 * a code unreadable over the phone, which is the only way it is ever delivered;
 * and too few bits would make brute force practical, since ST-A09 accepts that
 * there is no rate limit at the database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROCKFORD_ALPHABET,
  EXCLUDED_CHARACTERS,
  JOIN_CODE_LENGTH,
  bitsOfEntropy,
  generateJoinCode,
  isWellFormedJoinCode,
  normalizeJoinCode,
} from './join-code.mjs';

const SAMPLES = 10_000;

test('10,000 codes: no duplicate, no excluded character, all the right length', () => {
  const seen = new Set();
  for (let i = 0; i < SAMPLES; i += 1) {
    const code = generateJoinCode();
    assert.equal(code.length, JOIN_CODE_LENGTH);
    assert.equal(seen.has(code), false, `duplicate at sample ${i}`);
    seen.add(code);
    for (const bad of EXCLUDED_CHARACTERS) {
      assert.equal(code.includes(bad), false, `"${bad}" is unreadable over the phone`);
    }
    assert.equal(isWellFormedJoinCode(code), true);
  }
  assert.equal(seen.size, SAMPLES);
});

test('the alphabet is Crockford base32 and nothing else', () => {
  assert.equal(CROCKFORD_ALPHABET.length, 32);
  assert.equal(new Set(CROCKFORD_ALPHABET).size, 32);
  for (const bad of EXCLUDED_CHARACTERS) assert.equal(CROCKFORD_ALPHABET.includes(bad), false);
});

test('entropy clears the 40-bit floor with room to spare', () => {
  assert.ok(bitsOfEntropy() >= 40, `${bitsOfEntropy()} bits`);
  assert.equal(bitsOfEntropy(), 50);
});

test('every character of the alphabet is actually reachable', () => {
  // A generator with an off-by-one on the range would silently never emit the
  // first or last symbol, cutting entropy without failing anything above.
  const seen = new Set();
  for (let i = 0; i < SAMPLES; i += 1) for (const ch of generateJoinCode()) seen.add(ch);
  assert.equal(seen.size, 32, `only ${seen.size} of 32 symbols were ever produced`);
});

test('the validator rejects what the RPC would refuse to look up', () => {
  assert.equal(isWellFormedJoinCode('ABC'), false, 'too short');
  assert.equal(isWellFormedJoinCode('ABCDEFGHIJ'), false, 'contains I');
  assert.equal(isWellFormedJoinCode('abcdefghjk'), false, 'lower case is not what is stored');
  assert.equal(isWellFormedJoinCode(''), false);
  assert.equal(isWellFormedJoinCode(null), false);
  assert.equal(isWellFormedJoinCode(12345678), false);
  assert.equal(isWellFormedJoinCode('0123456789'), true);
});

test('normalization matches what redeem_join_code does before it looks up', () => {
  assert.equal(normalizeJoinCode('  abcdefghjk '), 'ABCDEFGHJK');
  assert.equal(normalizeJoinCode(null), '');
});
