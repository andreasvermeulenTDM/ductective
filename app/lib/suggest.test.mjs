/**
 * ST-F10 — the `/suggest-units` client contract (suggest.ts).
 *
 *   npm test
 *
 * Plain `.mjs` so `node --test` discovers it, importing the TS module through
 * Node's type stripping — the convention `identify.test.mjs` establishes.
 *
 * Two invariants are being pinned, and both are about what the app must NOT do:
 *
 *  1. **A malformed suggestion is dropped, never repaired.** `documentIds` goes
 *     straight into a session's retrieval scope; a half-parsed row would scope a
 *     diagnosis to the wrong unit's manuals.
 *  2. **Every failure is `[]`, never a throw and never an error card.** A
 *     type-ahead that can break the field is worse than no type-ahead, and free
 *     typing has to work exactly as it did before this route existed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_QUERY_CHARS,
  SUGGEST_DEBOUNCE_MS,
  parseSuggestResponse,
  postSuggestUnits,
  worthSuggesting,
} from './suggest.ts';

const GOOD = {
  manufacturer: 'Trane',
  family: 'Precedent rooftop heat/cool (WSC, DHC, WHC)',
  documentIds: ['doc_a', 'doc_b'],
  label: 'Trane — Precedent rooftop heat/cool (WSC, DHC, WHC)',
  matchedOn: 'model',
};

const ok = (json) => ({
  ok: true,
  status: 200,
  json: async () => json,
});

// --- parsing ---------------------------------------------------------------

test('a well-formed payload parses to the rows the server sent', () => {
  const out = parseSuggestResponse({ suggestions: [GOOD] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], GOOD);
});

test('the label is taken verbatim, never recomposed from the parts', () => {
  const odd = { ...GOOD, label: 'whatever the server said' };
  assert.equal(parseSuggestResponse({ suggestions: [odd] })[0].label, 'whatever the server said');
});

test('a suggestion with no documentIds is DROPPED — it is a coverage claim we cannot keep', () => {
  assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, documentIds: [] }] }), []);
  assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, documentIds: undefined }] }), []);
  assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, documentIds: ['', 'doc_b'] }] }), []);
  assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, documentIds: 'doc_a' }] }), []);
});

test('a suggestion missing any rendered field is dropped, not repaired', () => {
  for (const field of ['manufacturer', 'family', 'label']) {
    assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, [field]: '' }] }), [], field);
    assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, [field]: undefined }] }), [], field);
  }
  assert.deepEqual(parseSuggestResponse({ suggestions: [{ ...GOOD, matchedOn: 'vibes' }] }), []);
});

test('a good row survives beside a bad one — one defect does not empty the list', () => {
  const out = parseSuggestResponse({ suggestions: [{ ...GOOD, label: '' }, GOOD] });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, GOOD.label);
});

test('documentIds are copied, so a caller cannot mutate the parsed scope in place', () => {
  const payload = { suggestions: [{ ...GOOD, documentIds: ['doc_a'] }] };
  const out = parseSuggestResponse(payload);
  out[0].documentIds.push('doc_forged');
  assert.deepEqual(payload.suggestions[0].documentIds, ['doc_a']);
});

test('anything that is not {suggestions: []} is []', () => {
  for (const bad of [null, undefined, 42, 'nope', {}, { suggestions: null }, { suggestions: {} }, []]) {
    assert.deepEqual(parseSuggestResponse(bad), [], JSON.stringify(bad));
  }
});

// --- the query floor -------------------------------------------------------

test('a query below the floor never leaves the device', async () => {
  assert.equal(worthSuggesting('tr'), false);
  assert.equal(worthSuggesting('   '), false);
  assert.equal(worthSuggesting('tra'), true);
  assert.equal(MIN_QUERY_CHARS, 3);

  let called = 0;
  const out = await postSuggestUnits(async () => { called++; return ok({ suggestions: [GOOD] }); }, 'http://x', 'tr');
  assert.deepEqual(out, []);
  assert.equal(called, 0, 'a two-character query must not cost a round trip');
});

test('the debounce is declared once, in the contract module', () => {
  assert.equal(SUGGEST_DEBOUNCE_MS, 250);
});

// --- every failure is [] ---------------------------------------------------

test('a 200 with suggestions returns them, and the query is sent trimmed', async () => {
  let sent = null;
  const out = await postSuggestUnits(
    async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return ok({ suggestions: [GOOD] }); },
    'http://x',
    '  48LC  '
  );
  assert.equal(sent.url, 'http://x/suggest-units');
  assert.deepEqual(sent.body, { query: '48LC' });
  assert.equal(out.length, 1);
});

test('a non-200 is [] — never an error the technician cannot act on', async () => {
  for (const status of [400, 401, 404, 413, 500, 502]) {
    const out = await postSuggestUnits(
      async () => ({ ok: false, status, json: async () => ({ status, message: 'nope' }) }),
      'http://x',
      'tra'
    );
    assert.deepEqual(out, [], String(status));
  }
});

test('a transport failure is [], not a throw', async () => {
  const out = await postSuggestUnits(async () => { throw new Error('Network request failed'); }, 'http://x', 'tra');
  assert.deepEqual(out, []);
});

test('an abort — what the next keystroke causes — is [], not a failure', async () => {
  const out = await postSuggestUnits(
    async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; },
    'http://x',
    'tra'
  );
  assert.deepEqual(out, []);
});

test('unparseable JSON on a 200 is []', async () => {
  const out = await postSuggestUnits(
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    'http://x',
    'tra'
  );
  assert.deepEqual(out, []);
});

test('the shared-secret header is passed through, not reinvented', async () => {
  let headers = null;
  await postSuggestUnits(
    async (_url, init) => { headers = init.headers; return ok({ suggestions: [] }); },
    'http://x',
    'tra',
    undefined,
    { 'Content-Type': 'application/json', Authorization: 'Bearer abc' }
  );
  assert.equal(headers.Authorization, 'Bearer abc');
});

test('the module holds no manufacturer or model string of its own', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./suggest.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  // The corpus is named in the prose above the code (Trane, Goodman) as examples;
  // the code itself must describe no unit at all.
  for (const name of ['Trane', 'Carrier', 'Bosch', 'Goodman', 'Daikin', 'York', 'Lennox', 'Rheem', 'Payne']) {
    assert.equal(new RegExp(`\\b${name}\\b`).test(code), false, name);
  }
});
