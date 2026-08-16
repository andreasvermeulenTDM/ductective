/**
 * starters.test.mjs — ST-R15 AC 10. Rewritten against the new module, not deleted.
 *
 *   npm test
 *
 * ## What changed, and what deliberately did not
 *
 * The old file tested `startersFor` and `classifyEquipment` — a taxonomy of four
 * hardcoded strings per equipment class. That taxonomy is gone: it claimed
 * "always answerable" without evidence and caused the four dead turns of the
 * 16 Aug 2026 session.
 *
 * **The one assertion that mattered is kept, and it is the safety one.** The old
 * header put it best: *a suggestion the safety gate would refuse is worse than no
 * suggestion, because the app invites a question and then declines it.* It now
 * runs over a fixture of **server payloads** rather than over a literal list, so
 * the property is still asserted after the list is gone — which is the whole
 * point of rewriting rather than deleting.
 *
 * The rest is the parser's contract: a malformed row is discarded, never
 * repaired, because a half-parsed suggestion would put a string in front of a
 * technician as a one-tap question with no evidence behind it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSuggestionsResponse, postUnitSuggestions, startersFor,
  MAX_UNIT_SUGGESTIONS, UNIT_SUGGESTIONS_TIMEOUT_MS,
} from './starters.ts';
import { classifyHazard } from '../../lib/safety.mjs';
import { TEMPLATES, CODE_TEMPLATE } from '../../ingest/suggestions.mjs';

const row = (over = {}) => ({
  text: 'What does the manual specify for minimum service clearances?',
  category: 'reference',
  documentId: 'doc_b835940a1356c074',
  page: 12,
  source_document: 'Bosch_IDS-Ultra-Condenser-Install',
  ...over,
});

// ---------------------------------------------------------------------------
// The assertion that survived the rewrite
// ---------------------------------------------------------------------------

test('every suggestion the app would render passes classifyHazard', () => {
  /*
   * A fixture of what the server actually sends, built from the same templates
   * `ingest/suggestions.mjs` phrases with — wrapped around the most hazardous
   * topics an HVAC corpus contains. If a future template edit made a suggestion
   * refuse itself, this fails here rather than on a roof.
   */
  const HAZARDOUS_TOPICS = [
    'refrigerant charge', 'the gas line', 'the lugs', 'the disconnect switch',
    'the terminal block', 'the burner', 'the compressor', 'the line set',
    'the capacitor', 'gas piping', 'the heat exchanger', 'the flame sensor',
  ];
  const payload = {
    suggestions: [
      ...HAZARDOUS_TOPICS.flatMap((topic) =>
        Object.entries(TEMPLATES).map(([category, t]) =>
          row({ text: t(topic), category })
        )
      ),
      ...['E4', 'A6', '3 flashes', 'LO'].map((code) => row({ text: CODE_TEMPLATE(code), category: 'fault' })),
    ],
  };

  const parsed = parseSuggestionsResponse(payload);
  assert.ok(parsed.length >= 48, `only ${parsed.length} fixture suggestions — the fixture did not build`);
  for (const s of parsed) {
    const hazard = classifyHazard(s.text);
    assert.equal(
      hazard,
      null,
      `suggestion "${s.text}" would be refused as ${hazard?.category} — the app must not offer a question it declines`
    );
  }
});

// ---------------------------------------------------------------------------
// The parser — a malformed row is discarded, never repaired
// ---------------------------------------------------------------------------

test('a well-formed payload parses to exactly what the server sent', () => {
  const parsed = parseSuggestionsResponse({ suggestions: [row()] });
  assert.deepEqual(parsed, [row()]);
});

test('every malformed shape is dropped rather than repaired', () => {
  const bad = [
    ['no text', row({ text: undefined })],
    ['empty text', row({ text: '   ' })],
    ['text is not a string', row({ text: 42 })],
    ['unknown category', row({ category: 'chit-chat' })],
    ['no category', row({ category: undefined })],
    ['no documentId', row({ documentId: undefined })],
    ['empty documentId', row({ documentId: '' })],
    ['page is not a number', row({ page: '12' })],
    ['page is zero', row({ page: 0 })],
    ['page is fractional', row({ page: 12.5 })],
    ['not an object', 'What are the clearances?'],
    ['null', null],
  ];
  for (const [name, s] of bad) {
    assert.deepEqual(parseSuggestionsResponse({ suggestions: [s] }), [], `a row with ${name} survived`);
  }
});

test('a good row beside a bad one survives alone — a shorter list, never a throw', () => {
  const parsed = parseSuggestionsResponse({ suggestions: [row({ page: 0 }), row(), row({ category: 'x' })] });
  assert.equal(parsed.length, 1);
});

test('a missing or malformed envelope is [], not an error', () => {
  for (const json of [null, undefined, {}, { suggestions: null }, { suggestions: 'none' }, 'nope', 42]) {
    assert.deepEqual(parseSuggestionsResponse(json), []);
  }
});

test('source_document is optional and normalises to null, never to a guess', () => {
  assert.equal(parseSuggestionsResponse({ suggestions: [row({ source_document: undefined })] })[0].source_document, null);
  assert.equal(parseSuggestionsResponse({ suggestions: [row({ source_document: 7 })] })[0].source_document, null);
});

// ---------------------------------------------------------------------------
// The transport — [] for every failure there is
// ---------------------------------------------------------------------------

const ok = (json) => async () => ({ ok: true, json: async () => json });

test('an empty scope never reaches the wire', async () => {
  const fetchFn = () => { throw new Error('must not be called'); };
  assert.deepEqual(await postUnitSuggestions(fetchFn, 'http://x', []), []);
  assert.deepEqual(await postUnitSuggestions(fetchFn, 'http://x', null), []);
});

test('a 200 with suggestions returns them', async () => {
  const out = await postUnitSuggestions(ok({ suggestions: [row()] }), 'http://x', ['doc_a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].page, 12);
});

test('every failure resolves to [] — never a throw, never an error card', async () => {
  const failures = [
    ['non-200', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['malformed body', ok({ nope: true })],
    ['body is not JSON', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })],
    ['transport error', async () => { throw new Error('ECONNREFUSED'); }],
    ['abort', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }],
    // The expected state until the owner applies sql/018: the server itself
    // returns an empty list rather than an error, and this is the client half.
    ['sql/018 unapplied', ok({ suggestions: [] })],
  ];
  for (const [name, fetchFn] of failures) {
    assert.deepEqual(await postUnitSuggestions(fetchFn, 'http://x', ['doc_a']), [], `${name} did not resolve to []`);
  }
});

test('the request carries the scope verbatim and nothing else', async () => {
  let sent = null;
  const fetchFn = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ suggestions: [] }) };
  };
  await postUnitSuggestions(fetchFn, 'http://x', ['doc_a', 'doc_b']);
  assert.equal(sent.url, 'http://x/unit-suggestions');
  assert.deepEqual(sent.body, { documentIds: ['doc_a', 'doc_b'] });
});

// ---------------------------------------------------------------------------
// The taxonomy is gone, and cannot come back through this file
// ---------------------------------------------------------------------------

test('BY_CLASS, CLASS_PATTERNS, classifyEquipment and the hardcoded list are deleted', () => {
  // Comments blanked — the header names what was removed and why, which is the
  // record of the defect and must stay readable.
  const src = readFileSync(new URL('./starters.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const gone of ['BY_CLASS', 'CLASS_PATTERNS', 'EquipmentClass', 'classifyEquipment']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `${gone} survives in the code`);
  }
});

test('no symptom string is written down in this file at all', () => {
  // The defect, generalised: any literal that reads like a diagnostic claim about
  // equipment is a coverage claim the client is in no position to make.
  const src = readFileSync(new URL('./starters.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const symptom of [
    /not cooling/i, /short cycl/i, /low suction/i, /high head/i, /economizer/i,
    /reversing valve/i, /blower runs/i, /error code/i, /icing up/i,
  ]) {
    assert.doesNotMatch(src, symptom, `a hardcoded symptom string survives: ${symptom}`);
  }
});

test('startersFor survives only as an empty seam for ST-R16 to remove', () => {
  // It is imported by `app/screens/ChatScreen.tsx`, which belongs to ST-R16
  // (Frontend, in parallel). Shipping a red tsc on a branch the owner may be
  // running on a phone is not a trade worth making, so the name survives
  // returning nothing until that story removes the import.
  assert.deepEqual(startersFor(), []);
  assert.deepEqual(startersFor('Bosch IDS Ultra', ['IDS Ultra series condenser (residential)']), []);
  const src = readFileSync(new URL('./starters.ts', import.meta.url), 'utf8');
  assert.match(src, /DEPRECATED/, 'the seam must say it is one');
  assert.match(src, /ST-R16 removes the import and then removes this function/);
});

// ---------------------------------------------------------------------------
// Constants the UI reserves space against
// ---------------------------------------------------------------------------

test('the ceilings are stated, and match the server\'s', () => {
  assert.equal(MAX_UNIT_SUGGESTIONS, 4, 'OQ-R7 — four, so the density baseline does not move');
  assert.ok(UNIT_SUGGESTIONS_TIMEOUT_MS <= 5_000, 'a chip that arrives late is worse than one that never came');
});
