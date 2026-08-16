/**
 * conversation.meta.test.mjs — ST-R08 (N3). Capability, installation scope and
 * presence, all server-authored.
 *
 *   npm test
 *
 * The turn the 16 Aug session broke on is not small talk and is not a symptom:
 * "what can you help with?" and "how do I install this thing" both fell into the
 * diagnostic pipeline and came back as *"I don't have documentation covering
 * that"* — a no-source error about a question nobody asked.
 *
 * What is under test here is the thing that makes the widening safe: **the model
 * authors none of it.** `RESPONSE_SCHEMA` is not extended, `validateAnswer`
 * gains no branch, and the only variable content in a capability body comes from
 * `documents` columns. So the tests are the classifier's precision, the bodies'
 * shape, and the gate ordering — proven with every dependency rigged to throw,
 * not observed to be fine.
 *
 * Zero quota: every dependency is injected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyMeta, classifyConversational, META_BODIES,
  INSTALLATION_SCOPE_BODY, PRESENCE_BODY, equipmentTokensIn,
  META_MAX_WORDS, META_MAX_CHARS,
} from './conversation.mjs';
import { refusalLeaksProcedure, classifyHazard } from './safety.mjs';
import { diagnose } from './diagnose.mjs';
import { zeroUsage } from './metrics.mjs';
import { ALL_GATE_PROBES, INSTALLATION_SCOPE } from '../tests/probes/installation-boundary-probes.mjs';

const SOURCE = readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// AC 6 — the positive matrix, >= 15 phrasings across three intents
// ---------------------------------------------------------------------------

const POSITIVE = [
  // capability
  ['what can you help with', 'capability'],
  ['what can you help with?', 'capability'],
  ['what can you do', 'capability'],
  ['what can you help me with', 'capability'],
  ['what can you help diagnose and solve', 'capability'],
  ['what can you help me diagnose', 'capability'],
  ['what do you cover', 'capability'],
  ['what can i ask you about', 'capability'],
  ['how can you help me', 'capability'],
  ['what else can you do', 'capability'],
  ['what are you able to answer', 'capability'],
  ['tell me what you can do', 'capability'],
  ['what sort of questions can i ask', 'capability'],
  ['What have you got for me?', 'capability'],
  // installation_scope — the N2 turn
  ['how do I install this rooftop unit', 'installation_scope'],
  ['how do i install it', 'installation_scope'],
  ['how to install this', 'installation_scope'],
  ['can you help me install a new unit', 'installation_scope'],
  ['help me install this thing', 'installation_scope'],
  ['do you help with installation', 'installation_scope'],
  ['can you cover new unit installation', 'installation_scope'],
  ['the app should help with new unit installation', 'installation_scope'],
  ['i need help installing this', 'installation_scope'],
  ['is there anything for installation', 'installation_scope'],
  // presence
  ['are you there?', 'presence'],
  ['you still there', 'presence'],
  ['can you hear me', 'presence'],
  ['is anyone there', 'presence'],
  ['are you still with me?', 'presence'],
];

test(`AC 6 — the positive matrix classifies (${POSITIVE.length} phrasings, >= 15 required)`, () => {
  assert.ok(POSITIVE.length >= 15);
  const missed = [];
  for (const [text, intent] of POSITIVE) {
    const v = classifyMeta(text);
    if (v?.intent !== intent) missed.push(`${JSON.stringify(text)} → ${v?.intent ?? 'null'} (wanted ${intent})`);
  }
  assert.deepEqual(missed, []);
});

test('the brief\'s own two framings are both covered', () => {
  assert.equal(classifyMeta('what can you help diagnose and solve')?.intent, 'capability');
  assert.equal(classifyMeta('the app should help with new unit installation')?.intent, 'installation_scope');
});

// ---------------------------------------------------------------------------
// AC 5 — the negative matrix, >= 20, including every ST-R03 answerable probe
// ---------------------------------------------------------------------------

const NEGATIVE = [
  // Diagnostic turns.
  'not cooling', 'the unit is short cycling', 'low airflow across the coil',
  'control board is flashing an error code', 'economizer not modulating',
  'compressor will not start', 'high head pressure at 400 psi',
  'what does a 3-flash code mean', 'the blower runs constantly',
  'evaporator coil is icing up', 'suction pressure is 40 psi, is that low',
  'it trips the breaker on startup',
  // Capability-shaped but about equipment — M2 disqualifies these outright.
  'what can you tell me about the compressor',
  'what can you help with on the gas valve',
  'what can you tell me about this heat pump',
  'what do you know about the economizer',
  // Long enough to be a real message.
  'what can you help me with on this rooftop unit that is not cooling properly today',
  'can you help me install a new unit and also work out why the old one kept tripping',
  // Ordinary continuations.
  'yes', '3 flashes', 'about 38', 'it locked out again',
];

test(`AC 5 — the negative matrix returns null (${NEGATIVE.length} phrasings, >= 20 required)`, () => {
  assert.ok(NEGATIVE.length >= 20);
  const caught = NEGATIVE.filter((t) => classifyMeta(t) !== null)
    .map((t) => `${JSON.stringify(t)} → ${classifyMeta(t).intent}`);
  assert.deepEqual(caught, []);
});

test('AC 5 — a reference question is NEVER intercepted as a capability question', () => {
  // N4's failure arriving through N3's door: an installation reference question
  // answered with "here is what I can help with" instead of with the number.
  const caught = ALL_GATE_PROBES
    .filter((p) => p.expect === 'answer')
    .filter((p) => classifyMeta(p.text) !== null)
    .map((p) => p.text);
  assert.deepEqual(caught, [], 'a reference probe was swallowed by the meta classifier');
});

// ---------------------------------------------------------------------------
// AC 4 — the narrowing rules, each with its own test
// ---------------------------------------------------------------------------

test('AC 4 — patterns are anchored whole-utterance, never substring', () => {
  assert.notEqual(classifyMeta('what can you do'), null);
  assert.equal(classifyMeta('before we start, what can you do here on site'), null);
  assert.equal(classifyMeta('tell me how to install this after you tell me what can you do'), null);
});

test(`AC 4 — the ceilings hold (${META_MAX_WORDS} words, ${META_MAX_CHARS} chars)`, () => {
  const long = 'what can you help me with here on this particular job today please';
  assert.ok(long.split(' ').length > META_MAX_WORDS);
  assert.equal(classifyMeta(long), null);
  assert.equal(classifyMeta('x'.repeat(META_MAX_CHARS + 1)), null);
});

test('AC 4 — the equipment lexicon disqualifies a capability turn outright', () => {
  assert.equal(classifyMeta('what can you tell me about the compressor'), null);
  assert.equal(classifyMeta('what can you do about the fan'), null);
  // …but not an installation-scope turn, which names equipment by necessity.
  assert.equal(classifyMeta('how do I install this rooftop unit')?.intent, 'installation_scope');
});

test('AC 4 — a hazardous domain noun disqualifies every intent, including the exempt one', () => {
  assert.equal(classifyMeta('what can you help with on the gas valve'), null);
  assert.equal(classifyMeta('how do i install the gas line'), null);
  assert.equal(classifyMeta('how do i install the line set'), null);
  assert.equal(classifyMeta('can you help me install the capacitor'), null);
});

test('AC 4 — rule C4 is relaxed only for capability and presence', () => {
  // A `?` and a leading interrogative both disqualify small talk…
  assert.equal(classifyConversational('what can you help with?'), null);
  // …and both are permitted here, because the claim being requested is about our
  // own inventory, which is already citation-free everywhere in this codebase.
  assert.equal(classifyMeta('what can you help with?')?.intent, 'capability');
  assert.equal(classifyMeta('are you there?')?.intent, 'presence');
});

test('the module header records the relaxation and says it is the only one', () => {
  const src = readFileSync(new URL('./conversation.mjs', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\n\s*(\*|\/\/)\s*/g, ' ');
  assert.match(src, /C4 is relaxed for `capability` and `presence` only/,
    'the module header must record which rule was relaxed and for what');
  assert.match(src, /request for a claim about \*\*our own inventory\*\*/,
    'the reason for the relaxation must be on record, not just the fact of it');
  assert.match(src, /M1\s+patterns are anchored/, 'the three guards must be named');
});

test('classifyMeta is pure — no network, no model, no database, no clock', () => {
  const src = readFileSync(new URL('./conversation.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('export function classifyMeta');
  const body = src.slice(start, src.indexOf('\n}', start));
  for (const forbidden of ['fetch', 'await', 'Date', 'supabase', 'complete(']) {
    assert.equal(body.includes(forbidden), false, `classifyMeta reaches for ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// AC 7 / AC 8 — the installation_scope body
// ---------------------------------------------------------------------------

test('AC 7 — installation_scope declines the walkthrough and names what governs the work', () => {
  assert.match(INSTALLATION_SCOPE_BODY, /won’t walk you through/i);
  assert.match(INSTALLATION_SCOPE_BODY, /certification training/i);
  assert.match(INSTALLATION_SCOPE_BODY, /company’s standard procedure/i);
  assert.match(INSTALLATION_SCOPE_BODY, /published sequence/i);
});

test('AC 7 — it names the reference half explicitly, so the redirect is help', () => {
  for (const category of [
    /clearance/i, /electrical/i, /charge/i, /torque/i, /sequence of operation/i, /commissioning/i,
  ]) {
    assert.match(INSTALLATION_SCOPE_BODY, category, `the redirect does not name ${category}`);
  }
});

test('AC 7 — no numbered line, no digit, no coverage promise', () => {
  assert.equal(refusalLeaksProcedure(INSTALLATION_SCOPE_BODY), false);
  assert.doesNotMatch(INSTALLATION_SCOPE_BODY, /\d/, 'a digit in this body would be an uncited value');
  assert.match(INSTALLATION_SCOPE_BODY, /manuals I hold/, 'the established no-coverage-promise wording');
  assert.doesNotMatch(INSTALLATION_SCOPE_BODY, /I have that unit|I cover /i);
});

test('AC 7 — no equipment noun beyond the boundary\'s own category names', () => {
  // The categories ARE the vocabulary of `docs/installation-boundary.md` §3;
  // anything more would be this constant claiming something about a unit it
  // cannot see.
  const ALLOWED = new Set(['airflow', 'static']);
  const leaked = equipmentTokensIn(INSTALLATION_SCOPE_BODY).filter((t) => !ALLOWED.has(t));
  assert.deepEqual(leaked, [], `the redirect names equipment: ${leaked.join(', ')}`);
});

test('the presence body invites the next turn rather than closing one', () => {
  assert.equal(refusalLeaksProcedure(PRESENCE_BODY), false);
  assert.equal(equipmentTokensIn(PRESENCE_BODY).length, 0);
  assert.deepEqual(Object.keys(META_BODIES).sort(), ['installation_scope', 'presence']);
});

// ---------------------------------------------------------------------------
// Orchestration — the gate ordering, with everything rigged to throw
// ---------------------------------------------------------------------------

const boom = () => { throw new Error('nothing downstream of the gate may be reached'); };
const throwingDeps = { completeFn: boom, embedFn: boom, db: { rpc: boom, from: boom } };

const docsDeps = (rows) => ({
  completeFn: boom,
  embedFn: boom,
  db: {
    rpc: boom,
    from: () => ({
      select: () => ({
        in: async () => ({ data: rows, error: null }),
        then: undefined,
      }),
    }),
  },
});

test('AC 2 — source order: hazard < conversational < meta < unit gate', () => {
  const hazard = SOURCE.indexOf('.map(classifyHazard)');
  const conversational = SOURCE.indexOf('classifyConversational(symptom)');
  const meta = SOURCE.indexOf('classifyMeta(symptom)');
  const unitGate = SOURCE.indexOf('body: UNIT_REQUIRED');
  assert.ok(hazard > 0 && conversational > 0 && meta > 0 && unitGate > 0);
  assert.ok(hazard < conversational, 'the hazard gate must run first');
  assert.ok(conversational < meta, 'small talk is narrower and must win');
  assert.ok(meta < unitGate, 'a capability question must not be answered with "which unit?"');
});

test('AC 3 — the guardrail proof, with every dependency rigged to throw', async () => {
  const out = await diagnose({ symptom: 'how do I install it and braze the line set' }, throwingDeps);
  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'refrigerant');
  assert.equal(out.meta.model, null);
  assert.deepEqual(out.meta.usage, zeroUsage());
});

test('AC 3 — classifyMeta re-checks the hazard gate itself', () => {
  // So a future caller that wires the order wrong still cannot get a redirect
  // out of a hazardous request. Every INSTALLATION_SCOPE probe expecting a
  // refusal must return null from the classifier.
  for (const p of INSTALLATION_SCOPE.filter((x) => x.expect === 'refusal')) {
    assert.ok(classifyHazard(p.text), `${p.text} should refuse at the gate`);
    assert.equal(classifyMeta(p.text), null, `${p.text} must not classify as a meta turn`);
  }
});

test('AC 8 — installation_scope renders as a redirect, not as a refusal', async () => {
  const out = await diagnose({ symptom: 'how do I install this rooftop unit' }, throwingDeps);
  assert.equal(out.kind, 'conversational');
  assert.equal(out.meta.intent, 'installation_scope');
  // Key by key: nothing downstream may count this as a refusal or style it as one.
  assert.equal('category' in out.meta, false);
  assert.equal('trigger' in out.meta, false);
  assert.equal(out.body, INSTALLATION_SCOPE_BODY);
});

test('AC 10 — all three intents carry the zeroed meta shape, key for key', async () => {
  const cases = [
    ['how do I install this rooftop unit', 'installation_scope', throwingDeps],
    ['are you there?', 'presence', throwingDeps],
    ['what can you help with?', 'capability', docsDeps([{ id: 'a', doc_type: 'IOM', in_scope: true }])],
  ];
  for (const [symptom, intent, deps] of cases) {
    const out = await diagnose({ symptom, ...(intent === 'capability' ? { documentIds: ['a'] } : {}) }, deps);
    assert.equal(out.kind, 'conversational', symptom);
    assert.equal(out.meta.intent, intent);
    assert.deepEqual(out.citations, []);
    assert.equal(out.meta.model, null);
    assert.deepEqual(out.meta.usage, zeroUsage());
    assert.equal(out.meta.attempts, 0);
    assert.deepEqual(out.meta.latency, { retrievalMs: 0, generationMs: 0 });
    assert.equal(out.meta.noDocumentation, false);
    assert.equal(out.meta.retrieved, 0);
  }
});

test('AC 9 — the capability body is composed from the documents rows in scope', async () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, doc_type: 'Install', in_scope: true })),
    { id: 'd7', doc_type: 'IOM', in_scope: true },
  ];
  const out = await diagnose(
    { symptom: 'what can you help with?', documentIds: rows.map((r) => r.id) },
    docsDeps(rows)
  );
  assert.equal(out.meta.intent, 'capability');
  assert.match(out.body, /\b8 documents\b/);
  assert.match(out.body, /7 Install/);
  assert.match(out.body, /1 IOM/);
});

test('AC 9 — a database failure degrades the capability answer, never errors it', async () => {
  // The one question that must never come back as a transport failure.
  const out = await diagnose(
    { symptom: 'what can you help with?', documentIds: ['a'] },
    { completeFn: boom, embedFn: boom, db: { rpc: boom, from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) }) } }
  );
  assert.equal(out.kind, 'conversational');
  assert.equal(out.meta.intent, 'capability');
  assert.ok(out.body.length > 80);
});

test('AC 11 — RESPONSE_SCHEMA is not extended and validateAnswer gains no branch for these intents', () => {
  const schema = SOURCE.slice(SOURCE.indexOf('export const RESPONSE_SCHEMA'), SOURCE.indexOf('// Validation'));
  for (const intent of ['capability', 'installation_scope', 'presence']) {
    assert.equal(schema.includes(intent), false, `the model can declare ${intent}`);
  }
  const validate = SOURCE.slice(
    SOURCE.indexOf('export function validateAnswer'),
    SOURCE.indexOf('const NO_DOCUMENTATION')
  );
  assert.ok(validate.length > 100);
  for (const intent of ['capability', 'installation_scope', 'presence', 'classifyMeta']) {
    assert.equal(validate.includes(intent), false, `validateAnswer knows about ${intent}`);
  }
});

test('the model is never told these intents exist', () => {
  const promptRegion = SOURCE.slice(
    SOURCE.indexOf('export const SYSTEM'),
    SOURCE.indexOf('export const RESPONSE_SCHEMA')
  );
  for (const intent of ['capability', 'installation_scope', 'presence']) {
    assert.equal(promptRegion.includes(intent), false, `SYSTEM or buildPrompt mentions ${intent}`);
  }
});
