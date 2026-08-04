/**
 * Unit tests for the E6.4 resolution rule.
 *
 *   node --test app/lib/
 *
 * Node's built-in runner, and Node ≥ 22.18 strips the types on import — so this
 * adds no dependency, which the brief's "boring, working, few dependencies"
 * constraint asks for and which E0.7 (still open, Backend-owned) has not settled.
 *
 * These cover the half of E6.10 that needs no renderer. The other half —
 * component rendering and citation tap-through — still needs a test harness;
 * see the OPEN QUESTION in `.pipeline/04-frontend-design-pass.md`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, isResolvable, partition } from './citations.ts';
import type { Citation } from './supabase.ts';

const cite = (over: Partial<Citation> = {}): Citation => ({
  id: 'c1',
  source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
  page: 84,
  claim: 'High head pressure causes',
  ordinal: 1,
  ...over,
});

test('a citation with a document and a real page resolves', () => {
  assert.equal(resolve(cite()).resolvable, true);
  assert.equal(isResolvable(cite()), true);
});

test('page 1 is valid — the first page of a PT chart is a real citation', () => {
  assert.equal(isResolvable(cite({ page: 1 })), true);
});

test('a missing document does not resolve', () => {
  for (const doc of ['', '   ']) {
    const r = resolve(cite({ source_document: doc }));
    assert.equal(r.resolvable, false);
    assert.match((r as { reason: string }).reason, /document/i);
  }
});

test('a missing page does not resolve, and the reason names the document', () => {
  const r = resolve(cite({ page: null as unknown as number }));
  assert.equal(r.resolvable, false);
  assert.match((r as { reason: string }).reason, /RT-SVX23R-EN/);
});

test('page 0 and negative pages do not resolve', () => {
  // The failure this guards: a chip reading "p.0" looks authoritative and sends
  // a tech hunting through a 300-page IOM for a page that never existed.
  assert.equal(isResolvable(cite({ page: 0 })), false);
  assert.equal(isResolvable(cite({ page: -3 })), false);
});

test('a non-integer page does not resolve', () => {
  assert.equal(isResolvable(cite({ page: 12.5 })), false);
  assert.equal(isResolvable(cite({ page: NaN })), false);
  assert.equal(isResolvable(cite({ page: Infinity })), false);
});

test('partition splits usable from broken and keeps both', () => {
  const good = cite({ id: 'good' });
  const bad = cite({ id: 'bad', page: 0 });

  const { usable, broken, hasAnyUsable } = partition([good, bad]);

  assert.equal(hasAnyUsable, true);
  assert.deepEqual(usable.map((c) => c.id), ['good']);
  assert.deepEqual(broken.map((b) => b.citation.id), ['bad']);
  // Broken ones are kept, not dropped: discarding them would make an answer
  // look better sourced than it is.
  assert.equal(broken.length, 1);
});

test('all-broken reports no usable citation — the caller must withhold the answer', () => {
  const { usable, broken, hasAnyUsable } = partition([
    cite({ id: 'a', page: 0 }),
    cite({ id: 'b', source_document: '' }),
  ]);

  assert.equal(hasAnyUsable, false);
  assert.equal(usable.length, 0);
  assert.equal(broken.length, 2);
});

test('no citations at all is not "usable"', () => {
  assert.equal(partition([]).hasAnyUsable, false);
});
