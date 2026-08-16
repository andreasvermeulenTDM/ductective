/**
 * diagnose.coverage.test.mjs — ST-R20. No coverage claim in this module may be a
 * literal.
 *
 *   npm test
 *
 * `00-brief-round4.md` hard constraint 2: a statement about what the corpus holds
 * is a **coverage claim**, and it must be derived from documents actually in
 * scope, never written down.
 *
 * This module broke that rule for nine days. `UNIT_REQUIRED`'s third sentence
 * read "Phase 1 covers Trane Precedent and Carrier 48/50 light-commercial rooftop
 * units". It went false on 7 Aug 2026 when the corpus grew to fifteen
 * manufacturers; `NO_DOCUMENTATION` was rewritten that day *specifically so it
 * could not go stale*, and the comment recording that is ten lines above the
 * sentence that kept the claim. One was fixed, one was missed, and nothing
 * noticed.
 *
 * So the assertion is the generalisation, not the instance: **no manufacturer
 * name from `data/manifest.csv` appears as a literal anywhere in
 * `lib/diagnose.mjs`.** The next hardcoded inventory fails CI the day it is
 * typed, whichever string it is.
 *
 * Comments are blanked first (`tests/lib/jsx.mjs`, the same reader
 * `units.suggest.test.mjs` uses). The comment that *records* the defect names
 * Trane and Carrier on purpose — a test that forbade writing down the history of
 * a bug would be a strange kind of progress.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankComments } from '../tests/lib/jsx.mjs';
import { parseCsv } from '../ingest/reconcile.mjs';
import { diagnose } from './diagnose.mjs';
import { zeroUsage } from './metrics.mjs';

const SRC = blankComments(readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8'));

/**
 * Every manufacturer the manifest names, as the documents table would.
 *
 * `Unknown` is dropped: it is the manifest's placeholder for a row whose maker
 * could not be attributed, not a name anyone would write into a coverage claim,
 * and it collides with ordinary English ("unknown document id" — the ST-04
 * fail-closed error). Excluding it is the one exception and it is named here
 * rather than hidden in a regex.
 */
const MANUFACTURERS = (() => {
  const rows = parseCsv(readFileSync(new URL('../data/manifest.csv', import.meta.url), 'utf8'));
  const [header, ...data] = rows;
  const at = header.indexOf('Manufacturer');
  return [...new Set(data.map((r) => (r[at] ?? '').trim()).filter(Boolean))]
    .filter((m) => !/^unknown$/i.test(m));
})();

/** Family names that were in the sentence this story deleted. */
const FAMILIES = ['Precedent', '48/50', 'Phase 1 covers'];

test('the manifest actually loaded — a zero-length list would pass every check below', () => {
  assert.ok(MANUFACTURERS.length >= 10, `only ${MANUFACTURERS.length} manufacturers read from the manifest`);
});

test('no manufacturer name from the manifest is a literal in lib/diagnose.mjs', () => {
  const hits = [];
  for (const name of MANUFACTURERS) {
    // Split on the slash so "Goodman / Amana" is checked as both halves — a
    // response string is far more likely to name one of them than the pair.
    for (const part of name.split('/').map((s) => s.trim()).filter((s) => s.length >= 4)) {
      if (new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(SRC)) hits.push(part);
    }
  }
  assert.deepEqual(hits, [], `lib/diagnose.mjs names ${hits.join(', ')} — coverage is classifyUnit's claim to make, from the live corpus`);
});

test('the deleted sentence and its family names are gone too', () => {
  for (const needle of FAMILIES) {
    assert.doesNotMatch(SRC, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `"${needle}" survives in lib/diagnose.mjs`);
  }
});

test('the unit gate still asks the question, and still costs nothing', async () => {
  // AC 3 — `kind:'unit_required'` and its zeroed meta are otherwise unchanged.
  const throwing = () => { throw new Error('the unit gate must not reach the model or the database'); };
  const out = await diagnose(
    { symptom: 'not cooling' },
    { completeFn: throwing, embedFn: throwing, db: { rpc: throwing, from: throwing } }
  );
  assert.equal(out.kind, 'unit_required');
  assert.deepEqual(out.citations, []);
  assert.deepEqual(out.meta.usage, zeroUsage());
  assert.deepEqual(out.meta.latency, { retrievalMs: 0, generationMs: 0 });
  assert.equal(out.meta.attempts, 0);
  assert.equal(out.meta.model, null);
  assert.equal(out.meta.noDocumentation, false);

  // It asks for the unit and promises grounding — and promises nothing about
  // what is in the library, which is the whole point of the story.
  assert.match(out.body, /which unit/i);
  assert.match(out.body, /manufacturer and model/i);
});

test('the unit-gate copy trips none of the safety suite\'s bypass patterns', async () => {
  // AC 4. The copy reaches the screen, so it is held to the same bar as every
  // other user-visible string.
  const src = readFileSync(new URL('../tests/suites/e5-safety.mjs', import.meta.url), 'utf8');
  const block = /const BYPASS_PATTERNS\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block, 'BYPASS_PATTERNS not found in tests/suites/e5-safety.mjs');
  const patterns = [...block[1].matchAll(/\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)/g)].map((m) => new RegExp(m[1], m[2]));
  assert.ok(patterns.length >= 3, `only ${patterns.length} bypass patterns parsed`);

  const throwing = () => { throw new Error('no model call'); };
  const out = await diagnose({ symptom: 'not cooling' }, { completeFn: throwing, embedFn: throwing, db: { rpc: throwing, from: throwing } });
  for (const re of patterns) {
    assert.doesNotMatch(out.body, re, `unit-gate copy matches a bypass pattern: ${re}`);
  }
});
