/**
 * Unit tests for the /identify-unit client contract (identify.ts).
 *
 *   npm test
 *
 * Plain `.mjs` so `node --test` discovers it, importing the TS module through
 * Node's type stripping — the convention citations.test.mjs establishes.
 *
 * Every server interaction here is a stubbed fetch. That is not a shortcut but
 * the round's rule: zero live Gemini calls — the first live photo
 * identification is quota-gated to the owner's window (ST-07). What these
 * tests pin is the contract from 03-backend.md's ST-05 addendum: all four
 * response shapes (identified / unreadable / provider block / transport), and
 * the two invariants the UI depends on — a block or failure is never rendered
 * as a reading, and documentIds' absent-vs-empty semantics survive the client.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EDGE_PX,
  base64Bytes,
  confirmedUnitFrom,
  parseIdentifyResponse,
  postIdentify,
  resizeTarget,
  splitUnitText,
} from './identify.ts';

// --- fixtures: the four shapes, verbatim from 03-backend.md -----------------

const IDENTIFIED = {
  identified: true,
  manufacturer: 'Trane',
  model: 'YSC060A4',
  confidence: 'high',
  unit: {
    status: 'covered',
    documentIds: ['doc_rt_svx23r', 'doc_rt_svx46g'],
    documents: [
      { id: 'doc_rt_svx23r', manufacturer: 'Trane', coverage: 'Precedent rooftop 3-10 ton', doc_type: 'IOM', in_scope: true },
      { id: 'doc_rt_svx46g', manufacturer: 'Trane', coverage: 'Precedent rooftop 12.5-25 ton', doc_type: 'IOM', in_scope: true },
    ],
    covered: [{ manufacturer: 'Trane', families: ['Precedent rooftop 3-10 ton'] }],
    message: 'Covered — 2 documents for this unit.',
  },
  message: 'Covered — 2 documents for this unit.',
  meta: { latencyMs: 1200, model: 'gemini', usage: {}, image: { originalBytes: 1, sentBytes: 1, width: 1536, height: 1152, resized: true } },
};

const UNREADABLE = {
  identified: false,
  manufacturer: 'Trane', // a partial read surfaces, but resolves nothing
  model: null,
  confidence: 'low',
  unit: null,
  message: "I couldn't read a nameplate in that photo.\n\nTry again square-on and closer, with the model number in frame and glare off the plate.",
  meta: {},
};

const PROVIDER_BLOCK = {
  status: 502,
  message: 'provider safety block (SAFETY)',
  providerBlocked: true,
  blockReason: 'SAFETY',
};

const TRANSPORT_413 = {
  status: 413,
  message: 'image is 9000000 bytes; the limit is 8388608 (8 MiB). Capture at lower resolution or recompress.',
};

const stubFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// --- shape 1: identified ----------------------------------------------------

test('an identified plate parses with the unit verdict verbatim', async () => {
  const out = await postIdentify(stubFetch(200, IDENTIFIED), 'http://x', 'AAAA');
  assert.equal(out.ok, true);
  assert.equal(out.result.identified, true);
  assert.equal(out.result.manufacturer, 'Trane');
  assert.equal(out.result.model, 'YSC060A4');
  assert.equal(out.result.confidence, 'high'); // the word, never a decimal
  assert.deepEqual(out.result.unit.documentIds, ['doc_rt_svx23r', 'doc_rt_svx46g']);
  assert.equal(out.result.unit.documents.length, 2);
  assert.equal(out.result.unit.message, 'Covered — 2 documents for this unit.');
});

test('confirming an identification carries documentIds into the session payload', () => {
  const result = parseIdentifyResponse(IDENTIFIED);
  const confirmed = confirmedUnitFrom(result);
  assert.equal(confirmed.equipment, 'Trane YSC060A4');
  assert.deepEqual(confirmed.documentIds, ['doc_rt_svx23r', 'doc_rt_svx46g']);
});

test('a non-covered verdict keeps documentIds as [] — empty, not absent', () => {
  // [] downstream means "unit resolved to zero documents": /diagnose answers
  // with the honest no-documentation shape instead of citing another
  // manufacturer's manual. Collapsing [] to null would launder an out-of-scope
  // unit into an unscoped diagnosis.
  const outOfScope = {
    ...IDENTIFIED,
    manufacturer: 'Daikin',
    model: 'Rebel',
    unit: { ...IDENTIFIED.unit, status: 'out_of_scope', documentIds: [], documents: [] },
  };
  const confirmed = confirmedUnitFrom(parseIdentifyResponse(outOfScope));
  assert.deepEqual(confirmed.documentIds, []);
  assert.notEqual(confirmed.documentIds, null);
});

// --- shape 2: unreadable (a deliberate answer, not an error) ----------------

test('an unreadable plate is an honest answer with no unit attached', async () => {
  const out = await postIdentify(stubFetch(200, UNREADABLE), 'http://x', 'AAAA');
  assert.equal(out.ok, true);
  assert.equal(out.result.identified, false);
  assert.equal(out.result.unit, null);
  assert.equal(out.result.manufacturer, 'Trane'); // partial read surfaces…
  assert.equal(confirmedUnitFrom(out.result), null); // …but never confirms
  assert.match(out.result.message, /couldn't read/i);
});

// --- shape 3: provider block (theirs — an error with a retry) ---------------

test('a provider safety block is a failure with providerBlocked, never a reading', async () => {
  const out = await postIdentify(stubFetch(502, PROVIDER_BLOCK), 'http://x', 'AAAA');
  assert.equal(out.ok, false);
  assert.equal(out.status, 502);
  assert.equal(out.providerBlocked, true);
  assert.ok(!('result' in out), 'a block must not carry an identification');
});

// --- shape 4: transport -----------------------------------------------------

test('a transport error surfaces status and message off the wire shape', async () => {
  const out = await postIdentify(stubFetch(413, TRANSPORT_413), 'http://x', 'AAAA');
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.providerBlocked, false);
  assert.match(out.message, /8 MiB/);
});

test('a non-JSON error body still classifies as a failure', async () => {
  const out = await postIdentify(
    async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }),
    'http://x', 'AAAA'
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, 500);
  assert.equal(out.providerBlocked, false);
});

// --- malformed successes are failures, not guesses --------------------------

test('a malformed 200 is a 502-shaped failure, not a rendered identification', async () => {
  const cases = [
    null,
    {},
    { identified: true, confidence: 'high', message: 'x' }, // identified without names or unit
    { ...IDENTIFIED, unit: null }, // identified without its verdict
    { ...IDENTIFIED, confidence: 0.94 }, // a decimal is not a confidence class
    { ...UNREADABLE, unit: { status: 'covered', documentIds: [], documents: [], message: 'x' } }, // unreadable must not carry a unit
    { ...IDENTIFIED, unit: { ...IDENTIFIED.unit, documentIds: [1, 2] } }, // ids must be strings
  ];
  for (const body of cases) {
    const out = await postIdentify(stubFetch(200, body), 'http://x', 'AAAA');
    assert.equal(out.ok, false, `should reject: ${JSON.stringify(body)?.slice(0, 60)}`);
    assert.equal(out.status, 502);
  }
});

test('the request body matches the contract byte-for-byte', async () => {
  let sent;
  await postIdentify(async (url, init) => {
    sent = { url, body: init.body, contentType: init.headers['Content-Type'] };
    return { ok: true, status: 200, json: async () => UNREADABLE };
  }, 'http://host:8787', 'BASE64PAYLOAD');
  assert.equal(sent.url, 'http://host:8787/identify-unit');
  assert.equal(sent.contentType, 'application/json');
  assert.deepEqual(JSON.parse(sent.body), { image: 'BASE64PAYLOAD', mimeType: 'image/jpeg' });
});

// --- the resize decision ----------------------------------------------------

test('resizeTarget mirrors the server cap and never upscales a known size', () => {
  assert.deepEqual(resizeTarget(1024, 768), { resize: false, width: 1024 });
  assert.deepEqual(resizeTarget(1536, 1152), { resize: false, width: 1536 });
  // 4032×3024 (a phone capture) → long edge capped at 1536
  assert.deepEqual(resizeTarget(4032, 3024), { resize: true, width: 1536 });
  // portrait: the *long* edge is capped, so width lands below MAX_EDGE_PX
  assert.deepEqual(resizeTarget(3024, 4032), { resize: true, width: 1152 });
  assert.equal(MAX_EDGE_PX, 1536);
});

test('unknown dimensions resize to the cap rather than shipping full size', () => {
  assert.deepEqual(resizeTarget(0, 0), { resize: true, width: MAX_EDGE_PX });
});

test('base64Bytes estimates the decoded size for the pre-upload guard', () => {
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes('AAA='), 2);
  const oneMiB = 'A'.repeat(Math.ceil((1024 * 1024 * 4) / 3));
  assert.ok(Math.abs(base64Bytes(oneMiB) - 1024 * 1024) < 4);
});

// --- splitUnitText (device-test fix, 7 Aug 2026) -----------------------------
//
// Sending the whole typed string as both manufacturer and model resolved "Trane
// YSC072E3" but silently failed "Goodman AMEC960603", because the corpus carries
// "Goodman / Amana" and the server's manufacturer test is containment. Measured
// against the live endpoint before this split existed.

test('splitUnitText takes the make off the front, the way a plate reads', () => {
  assert.deepEqual(splitUnitText('Trane YSC072E3RHB0000'), { manufacturer: 'Trane', model: 'YSC072E3RHB0000' });
  assert.deepEqual(splitUnitText('Goodman AMEC960603'), { manufacturer: 'Goodman', model: 'AMEC960603' });
  assert.deepEqual(splitUnitText('Carrier 48TC A06'), { manufacturer: 'Carrier', model: '48TC A06' });
});

test('splitUnitText uses a lone token for both — a single word could be either', () => {
  assert.deepEqual(splitUnitText('48TCA06'), { manufacturer: '48TCA06', model: '48TCA06' });
});

test('splitUnitText normalises the whitespace a phone keyboard produces', () => {
  assert.deepEqual(splitUnitText('  Trane   YSC072  '), { manufacturer: 'Trane', model: 'YSC072' });
});
