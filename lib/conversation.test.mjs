/**
 * ST-F04 — the conversational classifier, and the canned bodies.
 *
 *   npm test
 *
 * Two things are being pinned, and the second matters more than the first:
 *
 *  1. The classifier is *narrow* — six rules (C1–C6), each with its own test, plus
 *     a 15-strong negative matrix of real symptom phrasings that must all fall
 *     through to the ordinary diagnostic pipeline.
 *  2. The bodies **carry no diagnostic claim**. That is asserted structurally —
 *     no numbered line, no `Reading:` marker, no equipment noun, no hazard-domain
 *     noun — not by reading the copy and agreeing with it. This is the machine
 *     form of CLAUDE.md's cite-every-claim rule on a path that is deliberately
 *     citation-free.
 *
 * No network, no model, no database: the module has none to stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONVERSATIONAL_BODIES,
  MAX_CHARS,
  MAX_WORDS,
  classifyConversational,
  conversationalBody,
  equipmentTokensIn,
  normaliseUtterance,
} from './conversation.mjs';
import { HAZARD_DOMAIN_PATTERNS, refusalLeaksProcedure } from './safety.mjs';

// ---------------------------------------------------------------------------
// AC 3 — the positive matrix: 12+ phrasings across the three intents
// ---------------------------------------------------------------------------

const POSITIVE = [
  // acknowledgement — the brief's own example first
  ['that worked', 'acknowledgement'],
  ['That worked.', 'acknowledgement'],
  ['that did it', 'acknowledgement'],
  ['that fixed it', 'acknowledgement'],
  ['it worked now', 'acknowledgement'],
  ['thanks', 'acknowledgement'],
  ['thanks!', 'acknowledgement'],
  ['thank you', 'acknowledgement'],
  ['cheers', 'acknowledgement'],
  ['cheers mate', 'acknowledgement'],
  ['got it', 'acknowledgement'],
  ['sorted', 'acknowledgement'],
  ['all good', 'acknowledgement'],
  ['perfect', 'acknowledgement'],
  ['nice one', 'acknowledgement'],
  ["that's great", 'acknowledgement'],
  // greeting
  ['hi', 'greeting'],
  ['hello', 'greeting'],
  ['hey', 'greeting'],
  ['hey there', 'greeting'],
  ['morning', 'greeting'],
  ['good morning', 'greeting'],
  // farewell
  ['bye', 'farewell'],
  ['see you', 'farewell'],
  ["that's all", 'farewell'],
  ['that’s all', 'farewell'], // U+2019, the apostrophe iOS actually types
  ['done for the day', 'farewell'],
  ['all done', 'farewell'],
];

test('AC 3 — the positive matrix covers ≥ 12 phrasings across all three intents', () => {
  assert.ok(POSITIVE.length >= 12, `only ${POSITIVE.length} phrasings`);
  const intents = new Set(POSITIVE.map(([, i]) => i));
  assert.deepEqual([...intents].sort(), ['acknowledgement', 'farewell', 'greeting']);
});

for (const [utterance, intent] of POSITIVE) {
  test(`"${utterance}" classifies as ${intent}`, () => {
    const verdict = classifyConversational(utterance);
    assert.ok(verdict, 'expected a verdict, got null');
    assert.equal(verdict.intent, intent);
  });
}

// ---------------------------------------------------------------------------
// AC 4 — the negative matrix: 15+ diagnostic phrasings, all null
// ---------------------------------------------------------------------------

const NEGATIVE = [
  "it's not cooling",
  'high head pressure on the Precedent',
  '3-flash code on the ignition board',
  'unit is short cycling',
  'the compressor will not start',
  'condenser fan runs but the compressor does not',
  'low suction pressure',
  'economizer stuck open',
  'blower motor tripping on overload',
  'coil is icing up',
  'thermostat calls but nothing happens',
  'Trane YSC072 no cooling',
  '48TC packaged rooftop error code',
  'reading 12 amps on the common',
  'filter is filthy and airflow is low',
  'what does a 3-flash code mean',
  'how do I check superheat',
  'is the capacitor bad',
  // the C3 case the story names explicitly
  'thanks — what does a 3-flash code mean',
  // the ST-F08 AC 5 false-negative-direction case
  "that worked, now it's short cycling",
];

test('AC 4 — the negative matrix covers ≥ 15 diagnostic phrasings', () => {
  assert.ok(NEGATIVE.length >= 15, `only ${NEGATIVE.length} phrasings`);
});

for (const utterance of NEGATIVE) {
  test(`"${utterance}" is NOT conversational`, () => {
    assert.equal(classifyConversational(utterance), null);
  });
}

// ---------------------------------------------------------------------------
// AC 2 — the six narrowing rules, one test each
// ---------------------------------------------------------------------------

test('C2 — a 7-word utterance returns null even when it opens with an allow-listed phrase', () => {
  const seven = 'thanks that is really very helpful indeed';
  assert.equal(seven.split(' ').length, 7);
  assert.equal(classifyConversational(seven), null);
});

test('C2 — a 49-character utterance returns null even when it opens with an allow-listed phrase', () => {
  // 49 characters, six words, no equipment noun, no interrogative: the ONLY rule
  // left to reject it is the character ceiling.
  const long = 'thanks aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd ee';
  assert.equal(long.length, 49);
  assert.ok(long.split(' ').length <= MAX_WORDS);
  assert.ok(long.length > MAX_CHARS);
  assert.equal(classifyConversational(long), null);
});

test('C3 — the match is whole-utterance, never substring', () => {
  assert.equal(classifyConversational('thanks').intent, 'acknowledgement');
  assert.equal(classifyConversational('thanks — what does a 3-flash code mean'), null);
  // Short enough for C2 and free of equipment nouns: only the anchor rejects it.
  assert.equal(classifyConversational('thanks for nothing pal really'), null);
});

test('C4 — any question mark returns null', () => {
  assert.equal(classifyConversational('thanks?'), null);
  assert.equal(classifyConversational('all good?'), null);
});

test('C4 — a leading interrogative returns null with no question mark', () => {
  for (const opener of ['what', 'why', 'how', 'when', 'where', 'which', 'is', 'does', 'should', 'can', 'could', 'do']) {
    assert.equal(classifyConversational(`${opener} that worked`), null, opener);
  }
});

test('C5 — a hazard-domain noun disqualifies, using safety.mjs list rather than a copy', () => {
  assert.ok(HAZARD_DOMAIN_PATTERNS.length > 0, 'safety.mjs must export the domain patterns');
  // Short, non-interrogative, allow-list-shaped — rejected only by C5.
  assert.equal(classifyConversational('thanks capacitor'), null);
  assert.equal(classifyConversational('all good burner'), null);
  assert.equal(classifyConversational('got it refrigerant'), null);
});

test('C5 — an equipment-lexicon noun disqualifies', () => {
  assert.equal(classifyConversational('thanks unit'), null);
  assert.equal(classifyConversational('all good coil'), null);
  assert.equal(classifyConversational('sorted the fault code'), null);
});

test('C1 — a hazardous utterance is never conversational, even without diagnose()', () => {
  // The ordering guarantee lives in diagnose() (ST-F05 AC 1-2). This asserts the
  // module's own second line of defence: a caller that wires the order wrong
  // still cannot get small talk out of a hazardous request.
  assert.equal(classifyConversational('bypass the limit'), null);
  assert.equal(classifyConversational('cheers, megger it'), null);
});

test('C6 — refusalLeaksProcedure is false for every body', () => {
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.equal(refusalLeaksProcedure(body), false, intent);
  }
});

// ---------------------------------------------------------------------------
// AC 5 — the bodies carry no diagnostic claim. Structural, not editorial.
// ---------------------------------------------------------------------------

test('AC 5 — no body contains a numbered or bulleted line', () => {
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.equal(/^\s*\d+[.)]\s+\S/m.test(body), false, `${intent}: numbered line`);
    assert.equal(/^\s*[-*•]\s+\S/m.test(body), false, `${intent}: bulleted line`);
  }
});

test('AC 5 — no body contains a Reading: marker or any digit', () => {
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.equal(/Reading:/i.test(body), false, `${intent}: Reading: marker`);
    // A number in a citation-free reply is the shape a measurement takes.
    assert.equal(/\d/.test(body), false, `${intent}: digit`);
  }
});

test('AC 5 — no body contains an equipment or hazard-domain noun', () => {
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.deepEqual(equipmentTokensIn(body), [], `${intent}: equipment noun`);
    const hazard = HAZARD_DOMAIN_PATTERNS.filter((re) => re.test(body)).map(String);
    assert.deepEqual(hazard, [], `${intent}: hazard-domain noun`);
  }
});

test('AC 5 — no body makes a coverage claim about a specific unit', () => {
  // "I have that manual" would be a claim about the corpus made by a constant,
  // which cannot know the corpus. §8 forbids it.
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.equal(/\bI (have|hold|carry) (that|the|your)\b/i.test(body), false, intent);
  }
});

// ---------------------------------------------------------------------------
// AC 6 — the acknowledgement invites the next symptom
// ---------------------------------------------------------------------------

test('AC 6 — the acknowledgement body carries a forward-looking clause', () => {
  const body = CONVERSATIONAL_BODIES.acknowledgement;
  assert.match(body, /if anything else comes up/i);
  assert.match(body, /tell me what you are seeing/i);
});

test('every body offers the citation promise rather than closing the conversation', () => {
  for (const [intent, body] of Object.entries(CONVERSATIONAL_BODIES)) {
    assert.match(body, /manuals I hold/i, intent);
  }
});

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

test('empty, blank and non-string input is null, never a throw', () => {
  for (const input of ['', '   ', null, undefined, 42, {}, []]) {
    assert.equal(classifyConversational(input), null, String(input));
  }
});

test('normaliseUtterance straightens the apostrophe iOS types', () => {
  assert.equal(normaliseUtterance('That’s All '), "that's all");
});

test('conversationalBody returns the constant, and throws on an unknown intent', () => {
  assert.equal(conversationalBody({ intent: 'greeting' }), CONVERSATIONAL_BODIES.greeting);
  assert.throws(() => conversationalBody({ intent: 'diagnostic' }), /no conversational body/);
});

test('the module reaches no network, model or database', () => {
  // Structural: the only import is the safety gate it defers to.
  const src = readFileSync(new URL('./conversation.mjs', import.meta.url), 'utf8');
  assert.equal(/\bfetch\(/.test(src), false);
  assert.equal(/supabase/i.test(src), false);
  assert.equal(/\b(complete|embed)Fn?\(/.test(src), false);
  assert.deepEqual([...src.matchAll(/^import .*? from '(.+?)';$/gm)].map((m) => m[1]), ['./safety.mjs']);
});
