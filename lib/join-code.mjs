/**
 * join-code.mjs — the join-code alphabet and shape rule, in one place.
 *
 * ST-A09 AC 2. The **authoritative generator is `public.generate_join_code()` in
 * `sql/013_join_codes.sql`**, deliberately: generating server-side means a
 * company owner cannot choose a weak code, accidentally or otherwise.
 *
 * This module is the shape rule that both sides answer to. `isWellFormedJoinCode`
 * is what `scripts/verify-accounts.mjs` runs against codes the RPC **actually
 * issued** — so the SQL and the JS cannot drift apart without a test going red,
 * which is the honest way to have a mirror at all. `generateJoinCode` exists so
 * the distribution properties can be checked over ten thousand samples without
 * ten thousand round trips to Postgres.
 *
 * Crockford base32 excludes I, L, O and U. Not aesthetics: the first three are
 * unreadable next to 1 and 0 when a shop owner reads a code down the phone from a
 * roof, and U is excluded so the alphabet cannot spell an unfortunate word.
 */

import { randomInt } from 'node:crypto';

/** Must match the `alphabet` constant in sql/013_join_codes.sql exactly. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters Crockford drops. Present here so the exclusion is testable. */
export const EXCLUDED_CHARACTERS = ['I', 'L', 'O', 'U'];

/** ST-A09 AC 2 requires ≥ 8 characters and ≥ 40 bits. 10 gives exactly 50. */
export const JOIN_CODE_LENGTH = 10;
export const JOIN_CODE_MIN_LENGTH = 8;

/** log2(32) per character. */
export const bitsOfEntropy = (length = JOIN_CODE_LENGTH) => length * 5;

/**
 * A code, from a cryptographic source.
 *
 * `randomInt` rather than `Math.random`: the SQL side uses `random()` because
 * pgcrypto is not installed on this project and adding an extension for a join
 * code is not a trade worth making — but nothing forces the JS mirror to be as
 * weak as the weakest side, and this generator is what the distribution test
 * measures.
 */
export function generateJoinCode(length = JOIN_CODE_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CROCKFORD_ALPHABET[randomInt(0, CROCKFORD_ALPHABET.length)];
  return out;
}

/**
 * True when `code` could have come from either generator.
 *
 * Deliberately strict about case: the RPC upper-cases and trims before lookup, so
 * a lower-case code is fine to *type* and never fine to *store*.
 */
export function isWellFormedJoinCode(code) {
  if (typeof code !== 'string') return false;
  if (code.length < JOIN_CODE_MIN_LENGTH) return false;
  for (const ch of code) {
    if (!CROCKFORD_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** What the user typed, as the RPC will look it up. */
export const normalizeJoinCode = (code) => String(code ?? '').trim().toUpperCase();
