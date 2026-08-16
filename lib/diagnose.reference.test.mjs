/**
 * diagnose.reference.test.mjs — ST-R05 (N2). Cited data, with no imperative slot.
 *
 *   npm test
 *
 * ## What this story actually fixes
 *
 * The safety gate was never what blocked an installation *reference* question.
 * `classifyHazard` returns `null` for "what are the minimum service clearances"
 * and always did. What blocked it was the response **shape**: `RESPONSE_SCHEMA`
 * permitted only a ranked list of `action` + `reading` + `source`, and a
 * clearance has no reading and rules nothing in or out. The model's honest move
 * under that schema was `no_documentation` — on a corpus that holds exactly that
 * number. **The app told the technician it lacked a page it was looking at.**
 *
 * ## Why this is not a new hole
 *
 * A `reference` answer is **citation-bound, not citation-exempt**. Every item
 * resolves through the same `byIndex` map a step does, an unresolvable item is
 * dropped exactly as a step is, and an answer with zero surviving items degrades
 * to no-documentation exactly as today. Two further structural rules keep it a
 * datum rather than a procedure: there is no `action` field for the model to
 * fill, and an item with no `value` is dropped.
 *
 * Zero quota: every dependency is injected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSources, validateAnswer, diagnose, RESPONSE_SCHEMA, SYSTEM, HAZARD_ADJACENT_NOTE,
} from './diagnose.mjs';
import { refusalLeaksProcedure } from './safety.mjs';
import { zeroUsage } from './metrics.mjs';

const SOURCE = readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8');

const SOURCES = buildSources([
  { chunkId: 'c1', document: 'Bosch_IDS-Ultra-Condenser-Install', documentId: 'doc_b8', page: 12,
    text: 'Minimum service clearance, coil side: 36 in. Top: 60 in.' },
  { chunkId: 'c2', document: 'Bosch_IDS-Ultra-Condenser-Install', documentId: 'doc_b8', page: 18,
    text: 'Electrical data: MCA 24.7 A, MOCP 40 A. Lug torque 35 in-lb.' },
]);

const reference = (specs, extra = {}) => ({ kind: 'reference', specs, ...extra });

// ---------------------------------------------------------------------------
// AC 1 / AC 2 — the schema
// ---------------------------------------------------------------------------

test('AC 1 — the kind enum gains `reference` and a spec item has no `action` field', () => {
  assert.ok(RESPONSE_SCHEMA.properties.kind.enum.includes('reference'));
  const item = RESPONSE_SCHEMA.properties.specs.items;
  assert.deepEqual(Object.keys(item.properties).sort(), ['condition', 'source', 'spec', 'value']);
  assert.equal('action' in item.properties, false, 'an imperative slot is the whole thing being avoided');
  assert.deepEqual([...item.required].sort(), ['source', 'spec', 'value']);
});

test('AC 2 — every value in the kind enum is citation-bound or claim-free', () => {
  // The property the old byte-frozen assertion stood in for. A model-declared
  // kind that is exempt from citation is the F2 hole; `reference` is not one.
  const CITATION_BOUND = new Set(['answer', 'reference']);
  const CLAIM_FREE = new Set(['no_documentation', 'clarify']);
  for (const kind of RESPONSE_SCHEMA.properties.kind.enum) {
    assert.ok(
      CITATION_BOUND.has(kind) || CLAIM_FREE.has(kind),
      `unclassified response kind "${kind}"`
    );
  }
  // And the citation-bound ones genuinely degrade rather than emitting uncited.
  for (const json of [
    { kind: 'answer', steps: [{ action: 'x', reading: 'y', source: 99 }] },
    reference([{ spec: 'clearance', value: '36 in', source: 99 }]),
  ]) {
    const out = validateAnswer(json, SOURCES);
    assert.equal(out.noDocumentation, true, `${json.kind} emitted with an unresolvable source`);
    assert.deepEqual(out.citations, []);
  }
});

// ---------------------------------------------------------------------------
// AC 3 — the drop rules
// ---------------------------------------------------------------------------

test('AC 3 — a spec whose source does not resolve is dropped, exactly as a step is', () => {
  const out = validateAnswer(reference([
    { spec: 'Minimum service clearance, coil side', value: '36 in', source: 1 },
    { spec: 'Invented spec', value: '99 in', source: 7 },     // fabricated index
  ]), SOURCES);
  assert.equal(out.kind, 'answer');
  assert.equal(out.shape, 'reference');
  assert.equal(out.dropped, 1);
  assert.equal(out.citations.length, 1);
  assert.doesNotMatch(out.body, /Invented spec/);
});

test('AC 3 — a spec with no value is dropped: this is what keeps it a datum', () => {
  // "Terminate the conductors" has no value; "35 in-lb" does. Without this rule
  // a reference answer becomes a procedure with citations stapled to it.
  const out = validateAnswer(reference([
    { spec: 'Lug torque', value: '35 in-lb', source: 2 },
    { spec: 'Terminate the conductors', source: 2 },
    { spec: 'Land the ground', value: '   ', source: 2 },
  ]), SOURCES);
  assert.equal(out.dropped, 2);
  assert.equal(out.citations.length, 1);
  assert.doesNotMatch(out.body, /Terminate the conductors/);
  assert.doesNotMatch(out.body, /Land the ground/);
});

test('AC 3 — every item dropped degrades to no-documentation, exactly as today', () => {
  for (const specs of [
    [{ spec: 'x', value: '1', source: 99 }],
    [{ spec: 'x', source: 1 }],
    [],
  ]) {
    const out = validateAnswer(reference(specs), SOURCES);
    assert.equal(out.kind, 'answer');
    assert.equal(out.noDocumentation, true);
    assert.deepEqual(out.citations, []);
    assert.equal(out.shape, undefined, 'a degraded answer is not a reference answer');
  }
});

test('AC 3 — the degradation uses the caller\'s no-documentation body', () => {
  // ST-R09 AC 8: the scoped body must be reachable from here too, so a
  // technician cannot tell which internal path they hit.
  const out = validateAnswer(reference([]), SOURCES, { noDocumentationBody: 'SCOPED BODY?' });
  assert.equal(out.body, 'SCOPED BODY?');
  assert.equal(out.noDocumentation, true);
});

// ---------------------------------------------------------------------------
// AC 4 / AC 5 — what a surviving reference answer looks like
// ---------------------------------------------------------------------------

test('AC 4 — a surviving reference answer is kind:answer + shape:reference', () => {
  const out = validateAnswer(reference([
    { spec: 'Minimum service clearance, coil side', value: '36 in', source: 1 },
  ]), SOURCES);
  assert.equal(out.kind, 'answer');
  assert.equal(out.shape, 'reference');
});

test('AC 4 — the citation contract is byte-identical to the one steps produce', () => {
  const asSteps = validateAnswer({ kind: 'answer', steps: [
    { action: 'Check the clearance', reading: '36 in', source: 1 },
  ] }, SOURCES);
  const asReference = validateAnswer(reference([
    { spec: 'Minimum service clearance, coil side', value: '36 in', source: 1 },
  ]), SOURCES);

  assert.deepEqual(Object.keys(asReference.citations[0]).sort(), Object.keys(asSteps.citations[0]).sort());
  const c = asReference.citations[0];
  assert.equal(c.source_document, 'Bosch_IDS-Ultra-Condenser-Install');
  assert.equal(c.page, 12);
  assert.equal(c.ordinal, 1);
  assert.equal(c.chunk_id, 'c1');
  assert.equal(c.verified, 'exact');
  assert.equal(c.snippet, SOURCES[0].text);
  // The claim is the whole datum, so ST-R07 AC 4 can check the cited page really
  // contains the number that was reported.
  assert.equal(c.claim, 'Minimum service clearance, coil side — 36 in');
});

test('AC 5 — the body is spec — value (condition), never a numbered checklist', () => {
  const out = validateAnswer(reference([
    { spec: 'MCA', value: '24.7 A', condition: 'single phase 208V', source: 2 },
    { spec: 'MOCP', value: '40 A', source: 2 },
  ]), SOURCES);
  assert.match(out.body, /^MCA — 24\.7 A \(single phase 208V\)$/m);
  assert.match(out.body, /^MOCP — 40 A$/m);
  assert.doesNotMatch(out.body, /Reading:/, 'a spec is not a reading');
  assert.doesNotMatch(out.body, /^\s*\d+\.\s/m, 'a spec is not a step');
  assert.equal(refusalLeaksProcedure(out.body), false);
});

// ---------------------------------------------------------------------------
// AC 6 — the hazard-adjacent note
// ---------------------------------------------------------------------------

test('AC 6 — the note is appended when a surviving spec names hazardous equipment', () => {
  const out = validateAnswer(reference([
    { spec: 'Lug torque, line-voltage connections', value: '35 in-lb', source: 2 },
  ]), SOURCES);
  assert.ok(out.body.includes(HAZARD_ADJACENT_NOTE), 'the pointer is missing beside a hazard-adjacent value');
  // The values are still there. It is a pointer, not a withholding.
  assert.match(out.body, /35 in-lb/);
  assert.equal(out.citations.length, 1);
});

test('AC 6 — and not appended when nothing hazardous is named', () => {
  const out = validateAnswer(reference([
    { spec: 'Minimum service clearance, coil side', value: '36 in', source: 1 },
  ]), SOURCES);
  assert.equal(out.body.includes(HAZARD_ADJACENT_NOTE), false);
});

test('AC 6 — the note is a module constant with no procedure in it', () => {
  assert.equal(typeof HAZARD_ADJACENT_NOTE, 'string');
  assert.equal(refusalLeaksProcedure(HAZARD_ADJACENT_NOTE), false);
  assert.doesNotMatch(HAZARD_ADJACENT_NOTE, /^\s*[-*•\d]/m);
  // No imperative verb: this is a pointer, and an imperative would make it the
  // very thing it is pointing away from.
  for (const imperative of [/\bfollow\b/i, /\bcheck\b/i, /\bensure\b/i, /\bdo not\b/i, /\bmake sure\b/i, /\buse\b/i]) {
    assert.doesNotMatch(HAZARD_ADJACENT_NOTE, imperative, `the note gives an instruction: ${imperative}`);
  }
});

// ---------------------------------------------------------------------------
// AC 7 — SYSTEM
// ---------------------------------------------------------------------------

test('AC 7 — SYSTEM gains a reference rule, and rules 1 and 2 keep their positions', () => {
  const lines = SYSTEM.split('\n');
  const ruleAt = (n) => lines.findIndex((l) => l.startsWith(`${n}. `));
  for (let n = 1; n <= 7; n++) assert.ok(ruleAt(n) > 0, `rule ${n} missing`);
  for (let n = 1; n < 7; n++) assert.ok(ruleAt(n) < ruleAt(n + 1), `rule ${n} is out of order`);

  assert.match(lines[ruleAt(1)], /Every diagnostic claim/, 'rule 1 moved');
  assert.match(lines[ruleAt(2)], /You advise; you do not instruct/, 'rule 2 moved');

  const rule7 = lines.slice(ruleAt(7)).join(' ');
  assert.match(rule7, /kind "reference"/);
  assert.match(rule7, /values and criteria ONLY/i);
  assert.match(rule7, /no instruction, no procedure and no step/i);
  assert.match(rule7, /Rule 2\s+outranks this rule/i, 'the precedence must be stated inside the rule');
});

test('AC 7 — rule 6 keeps its meaning: an uncovered symptom is still said plainly', () => {
  const lines = SYSTEM.split('\n');
  const at = lines.findIndex((l) => l.startsWith('6. '));
  assert.match(lines[at], /do not cover the equipment or symptom, say so plainly/);
});

// ---------------------------------------------------------------------------
// AC 8 — the safety gate is still first and still absolute
// ---------------------------------------------------------------------------

test('AC 8 — a hazardous request refuses with completeFn AND embedFn rigged to throw', async () => {
  const boom = () => { throw new Error('a reference capability must not reach the model on a hazardous request'); };
  const out = await diagnose(
    { symptom: 'how do I braze the line set to spec', documentIds: ['doc_b8'] },
    { completeFn: boom, embedFn: boom, db: { rpc: boom, from: boom } }
  );
  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'refrigerant');
  assert.equal(out.meta.model, null);
  assert.deepEqual(out.meta.usage, zeroUsage());
});

// ---------------------------------------------------------------------------
// The end-to-end shape, through diagnose()
// ---------------------------------------------------------------------------

const ROW = (page, text) => ({
  chunk_id: `c${page}`, out_document: 'Bosch_IDS-Ultra-Condenser-Install', out_document_id: 'doc_b8',
  out_page: page, out_text: text, out_manufacturer: 'Bosch', out_similarity: 0.7, out_in_scope: true,
});

const deps = (json) => ({
  completeFn: async () => ({
    json, blocked: false, blockReason: null, model: 'stub',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedContentTokenCount: 0 },
    finishReason: 'STOP', attempts: 1,
  }),
  embedFn: async () => ({ embeddings: [[0.1]], tokens: 5 }),
  db: {
    rpc: async () => ({ data: [ROW(12, 'Minimum service clearance, coil side: 36 in.')], error: null }),
    from: () => ({ select: () => ({ in: async (_c, ids) => ({ data: ids.map((id) => ({ id, doc_type: 'Install', in_scope: true })), error: null }) }) }),
  },
});

test('a clearance question returns a cited value, and meta.shape says what it is', async () => {
  const out = await diagnose(
    { symptom: 'what are the minimum service clearances', documentIds: ['doc_b8'] },
    deps(reference([{ spec: 'Minimum service clearance, coil side', value: '36 in', source: 1 }]))
  );
  assert.equal(out.kind, 'answer');
  assert.equal(out.meta.shape, 'reference');
  assert.equal(out.meta.noDocumentation, false);
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].page, 12);
  assert.ok(out.citations[0].source_document.length > 0);
  assert.match(out.body, /36 in/);
});

test('meta.shape is absent on an ordinary answer, so the app can key off its presence', async () => {
  const out = await diagnose(
    { symptom: 'compressor short cycling', documentIds: ['doc_b8'] },
    deps({ kind: 'answer', steps: [{ action: 'Check the LP control', reading: 'Cut-out psi', source: 1 }] })
  );
  assert.equal(out.kind, 'answer');
  assert.equal('shape' in out.meta, false);
});

test('a reference answer that lost every item is logged as a withhold, not as an answer', async () => {
  const out = await diagnose(
    { symptom: 'what are the minimum service clearances', documentIds: ['doc_b8'] },
    deps(reference([{ spec: 'clearance', value: '36 in', source: 42 }]))
  );
  assert.equal(out.meta.noDocumentation, true);
  assert.deepEqual(out.citations, []);
  assert.equal('shape' in out.meta, false);
});

test('no citation-exempt branch was added to validateAnswer', () => {
  const validate = SOURCE.slice(
    SOURCE.indexOf('export function validateAnswer'),
    SOURCE.indexOf('const NO_DOCUMENTATION')
  );
  // Exactly two `byIndex.get` call sites — the steps loop and the specs loop.
  assert.equal((validate.match(/byIndex\.get\(/g) ?? []).length, 2);
  // And exactly one place that emits citations per kind.
  assert.equal((validate.match(/verified: 'exact'/g) ?? []).length, 2);
});
