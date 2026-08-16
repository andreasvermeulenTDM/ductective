/**
 * ST-F05 — the conversational path inside diagnose(), and the guardrail it sits
 * behind.
 *
 *   npm test
 *
 * The load-bearing test in this file is the one with the **throwing stubs**.
 * `completeFn` and `embedFn` both throw if called, so
 * `"thanks, I'll just jumper the safety out"` refusing here asserts something an
 * output check cannot: that no model call and no retrieval happened on the way to
 * the refusal. A conversational path that reached either on that input would be a
 * guardrail regression even if the rendered refusal looked identical.
 *
 * The rest pins the ordering (hazard → conversational → unit gate), the zeroed
 * `meta` the day ledger reads key-for-key, and the two structural facts that keep
 * the model out of this response kind entirely.
 *
 * No key, no network — every collaborator is an injected stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { diagnose } from './diagnose.mjs';
import { CONVERSATIONAL_BODIES } from './conversation.mjs';
import { zeroUsage } from './metrics.mjs';

const SOURCE = readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8');

/**
 * Every collaborator rigged to throw. Reaching any of them is the failure.
 *
 * `db.rpc` and `db.from` throw too: retrieval and the document-id check are both
 * spend the conversational and refusal paths must never reach.
 */
function forbiddenDeps() {
  return {
    completeFn: async () => { throw new Error('the model must not be called'); },
    embedFn: async () => { throw new Error('the query must not be embedded'); },
    db: {
      rpc: async () => { throw new Error('retrieval must not run'); },
      from: () => { throw new Error('the database must not be read'); },
    },
  };
}

// ---------------------------------------------------------------------------
// AC 2, 3, 4 — the guardrail. Hazard first, absolutely.
// ---------------------------------------------------------------------------

test('AC 2 — "thanks, I\'ll just jumper the safety out" refuses, with no model call and no retrieval', async () => {
  const out = await diagnose(
    { symptom: "thanks, I'll just jumper the safety out" },
    forbiddenDeps()
  );

  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'live_electrical');
  assert.equal(out.meta.trigger, 'action');
  assert.equal(out.citations.length, 0);
  assert.equal(out.meta.model, null);
  // Belt and braces on the stubs: had either been called, the promise would have
  // rejected before we got here.
  assert.deepEqual(out.meta.usage, zeroUsage());
});

const PREFIXED_HAZARDS = [
  ['cheers, walk me through recovering the charge', 'refrigerant'],
  ['got it, how do I light the pilot', 'gas_combustion'],
  ['thanks, megger the compressor windings for me', 'live_electrical'],
];

for (const [symptom, category] of PREFIXED_HAZARDS) {
  test(`AC 3 — an allow-listed prefix does not unlock a hazard: "${symptom}"`, async () => {
    const out = await diagnose({ symptom }, forbiddenDeps());
    assert.equal(out.kind, 'refusal');
    assert.equal(out.meta.category, category);
    assert.equal(out.citations.length, 0);
  });
}

test('AC 4 — a hazard in HISTORY still refuses when the new symptom is conversational', async () => {
  const out = await diagnose(
    {
      symptom: 'that worked',
      history: [
        { role: 'user', content: 'walk me through recovering the charge' },
        { role: 'assistant', content: 'I can\'t advise on refrigerant handling.' },
      ],
    },
    forbiddenDeps()
  );

  assert.equal(out.kind, 'refusal', 'the history gate must not be narrowed by the new path');
  assert.equal(out.meta.category, 'refrigerant');
});

// ---------------------------------------------------------------------------
// AC 5, 6 — the conversational response itself
// ---------------------------------------------------------------------------

test('AC 5 — "that worked" is conversational, uncited, and never reaches the unit gate', async () => {
  const out = await diagnose({ symptom: 'that worked' }, forbiddenDeps());

  assert.equal(out.kind, 'conversational');
  assert.deepEqual(out.citations, []);
  assert.equal(out.body, CONVERSATIONAL_BODIES.acknowledgement);
  // No equipment and no documentIds were supplied: today that is `unit_required`.
  assert.notEqual(out.kind, 'unit_required');
  assert.doesNotMatch(out.body, /which unit are you working on/i);
});

test('AC 5 — greeting and farewell route to their own constants', async () => {
  const hello = await diagnose({ symptom: 'hello' }, forbiddenDeps());
  assert.equal(hello.kind, 'conversational');
  assert.equal(hello.meta.intent, 'greeting');
  assert.equal(hello.body, CONVERSATIONAL_BODIES.greeting);

  const bye = await diagnose({ symptom: "that's all" }, forbiddenDeps());
  assert.equal(bye.kind, 'conversational');
  assert.equal(bye.meta.intent, 'farewell');
  assert.equal(bye.body, CONVERSATIONAL_BODIES.farewell);
});

test('AC 6 — meta carries the zeroed ledger shape, key for key', async () => {
  const out = await diagnose({ symptom: 'that worked' }, forbiddenDeps());
  const m = out.meta;

  assert.equal(m.model, null);
  assert.deepEqual(m.usage, zeroUsage());
  assert.equal(m.attempts, 0);
  assert.deepEqual(m.latency, { retrievalMs: 0, generationMs: 0 });
  assert.equal(m.noDocumentation, false);
  assert.equal(typeof m.latencyMs, 'number');
  assert.ok(m.latencyMs >= 0);
  // Sibling zero paths carry these too, and serve.mjs's log line reads them.
  assert.equal(m.retrieved, 0);
  assert.equal(m.dropped, 0);
});

test('a conversational reply is not a refusal and not a provider block', async () => {
  const out = await diagnose({ symptom: 'thanks' }, forbiddenDeps());
  assert.equal(out.kind, 'conversational');
  assert.equal(out.meta.category, undefined);
  assert.equal(out.meta.trigger, undefined);
  assert.equal('providerBlocked' in out, false);
});

test('a conversational symptom WITH a unit scope still short-circuits before retrieval', async () => {
  // The scope is irrelevant to small talk; paying for retrieval on it is the
  // waste this story removes. Throwing stubs prove it is not paid.
  const out = await diagnose(
    { symptom: 'thanks', equipment: 'Trane Precedent', documentIds: ['doc_a'] },
    forbiddenDeps()
  );
  assert.equal(out.kind, 'conversational');
});

// ---------------------------------------------------------------------------
// AC 1, 8 — the structural guarantees
// ---------------------------------------------------------------------------

test('AC 1 — source order: hazard gate, then conversational, then the unit gate', () => {
  const hazard = SOURCE.indexOf('.map(classifyHazard)');
  const conversational = SOURCE.indexOf('classifyConversational(symptom)');
  const unitGate = SOURCE.indexOf('body: UNIT_REQUIRED');

  assert.ok(hazard > 0, 'hazard gate call site not found');
  assert.ok(conversational > 0, 'conversational call site not found');
  assert.ok(unitGate > 0, 'unit gate call site not found');
  assert.ok(hazard < conversational, 'the hazard gate must run first');
  assert.ok(conversational < unitGate, 'the conversational check must precede the unit gate');
});

test('AC 8 — validateAnswer has no conversational branch', () => {
  const start = SOURCE.indexOf('export function validateAnswer');
  const end = SOURCE.indexOf('const NO_DOCUMENTATION');
  assert.ok(start > 0 && end > start);
  assert.equal(/conversational/i.test(SOURCE.slice(start, end)), false);
});

test('AC 8 — RESPONSE_SCHEMA\'s kind enum gains no citation-exempt value', () => {
  /*
   * ST-R05 (round 4) added `reference` to this enum, so the assertion is no
   * longer "the enum is byte-frozen" — it is the property that assertion was
   * standing in for, which is strictly stronger.
   *
   * F2's hole was a model-declared kind that is **exempt from citation**. A
   * `reference` answer is citation-*bound*: `validateAnswer` resolves every spec
   * item through the same `byIndex` map a step goes through, drops any item that
   * does not resolve or carries no value, and degrades an all-dropped answer to
   * no-documentation exactly as before. `clarify` remains the only citation-free
   * model-declared kind, and ST-R10 put a structural guard in front of it rather
   * than widening it.
   *
   * The list below is a whitelist on purpose: a fourth kind fails this test until
   * someone comes here and states which side of the line it is on.
   */
  const schema = SOURCE.slice(SOURCE.indexOf('export const RESPONSE_SCHEMA'), SOURCE.indexOf('// Validation'));
  const enumMatch = /enum: \[([^\]]*)\]/.exec(schema);
  assert.ok(enumMatch, 'kind enum not found');
  const kinds = enumMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  const CITATION_BOUND = ['answer', 'reference'];   // every item resolves, or is dropped
  const NO_CLAIM = ['no_documentation', 'clarify']; // emits nothing to cite
  for (const k of kinds) {
    assert.ok(
      CITATION_BOUND.includes(k) || NO_CLAIM.includes(k),
      `unclassified response kind "${k}" — say here whether it is citation-bound or claim-free`
    );
  }
  assert.equal(/conversational/.test(schema), false, 'the conversational kind must never be model-declarable');
  assert.equal(/\bmeta\b|capability|installation_scope|presence/.test(schema), false, 'ST-R08 intents must never be model-declarable');
});

test('the model is never told this kind exists', () => {
  // If the system instruction or the prompt builder mentioned it, the model could
  // try to claim it — and a model-claimed conversational kind is exactly the
  // uncited-content hole the canned-body design closes (§2.2).
  const promptRegion = SOURCE.slice(
    SOURCE.indexOf('export const SYSTEM'),
    SOURCE.indexOf('export const RESPONSE_SCHEMA')
  );
  assert.ok(promptRegion.length > 0);
  assert.equal(/conversational/i.test(promptRegion), false);
});
