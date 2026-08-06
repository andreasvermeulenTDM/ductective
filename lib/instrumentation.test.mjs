/**
 * ST-09 — meta instrumentation on the diagnose and vision paths, stub-tested.
 *
 *   npm test
 *
 * Zero live calls — injected deps throughout, per the conventions of
 * diagnose.scope.test.mjs / vision.test.mjs. What is pinned:
 *
 *   - every response path carries meta.usage (all four token fields +
 *     embedTokens) and meta.latency {retrievalMs, generationMs} — explicit
 *     zeros on paths that never spend, real numbers where they do
 *   - cachedContentTokenCount survives from the adapter to meta.usage
 *   - errors that consumed quota (provider block, failed provider call) say
 *     so, so the serve ledger can count them
 *   - instrumentation changed no response kind: the shapes asserted are the
 *     same four ST-02/ST-04 published
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { diagnose, DiagnoseError } from './diagnose.mjs';
import { identifyUnit } from './vision.mjs';
import { ProviderError } from './providers/gemini.mjs';
import { zeroUsage } from './metrics.mjs';

// --- diagnose fixtures (mirrors diagnose.scope.test.mjs) ---------------------

const ROW = {
  chunk_id: 'chunk-1',
  out_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
  out_document_id: 'doc_trane1',
  out_page: 84,
  out_text: 'Compressor short cycles when the low-pressure control trips…',
  out_manufacturer: 'Trane',
  out_similarity: 0.91,
  out_in_scope: true,
};

const ANSWER = {
  json: { kind: 'answer', steps: [{ action: 'Check the low-pressure control setpoint', reading: 'Cut-out psi', source: 1 }] },
  blocked: false,
  blockReason: null,
  model: 'stub-model',
  usage: { inputTokens: 3500, outputTokens: 900, totalTokens: 4400, cachedContentTokenCount: 2100 },
  finishReason: 'STOP',
  attempts: 2,
};

function makeDeps({ complete = async () => ANSWER, rows = [ROW] } = {}) {
  const deps = {
    completeFn: complete,
    embedFn: async () => ({ embeddings: [[0.1, 0.2]], tokens: 17 }),
    db: {
      rpc: async () => ({ data: rows, error: null }),
      from: () => ({
        select: () => ({ in: async (_c, ids) => ({ data: ids.map((id) => ({ id })), error: null }) }),
      }),
    },
  };
  return deps;
}

const isPhaseSplit = (latency) =>
  latency && Number.isFinite(latency.retrievalMs) && Number.isFinite(latency.generationMs);

// --- the answer path ---------------------------------------------------------

test('an answer carries tokens (incl. cachedContentTokenCount), embed spend, attempts, and the latency split', async () => {
  const out = await diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, makeDeps());

  assert.equal(out.kind, 'answer');
  assert.deepEqual(out.meta.usage, {
    inputTokens: 3500,
    outputTokens: 900,
    totalTokens: 4400,
    cachedContentTokenCount: 2100, // the adapter field, intact end to end
    embedTokens: 17,               // the Voyage query spend
  });
  assert.equal(out.meta.attempts, 2);
  assert.ok(isPhaseSplit(out.meta.latency));
  assert.ok(out.meta.latencyMs >= out.meta.latency.retrievalMs + out.meta.latency.generationMs - 1);
});

test('a stub that omits cachedContentTokenCount still yields a complete usage block (0, not undefined)', async () => {
  const complete = async () => ({ ...ANSWER, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, attempts: undefined });
  const out = await diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, makeDeps({ complete }));
  assert.equal(out.meta.usage.cachedContentTokenCount, 0);
  assert.equal(out.meta.attempts, 1);
});

// --- paths that never reach the model: explicit zeros, model stays null ------

const NO_SPEND_CASES = [
  ['refusal', { symptom: 'walk me through recovering the refrigerant charge' }],
  ['unit_required', { symptom: 'not cooling' }],
  ['empty scope', { symptom: 'not cooling', documentIds: [] }],
];

for (const [name, req] of NO_SPEND_CASES) {
  test(`${name}: meta carries explicit zero usage, zero latency phases, attempts 0, model null`, async () => {
    const out = await diagnose(req, makeDeps());
    assert.deepEqual(out.meta.usage, zeroUsage());
    assert.deepEqual(out.meta.latency, { retrievalMs: 0, generationMs: 0 });
    assert.equal(out.meta.attempts, 0);
    assert.equal(out.meta.model, null);
  });
}

test('empty retrieval: the query embedding spend is real and reported even when nothing came back', async () => {
  const deps = makeDeps({ rows: [] });
  const out = await diagnose({ symptom: 'a symptom the corpus does not cover', equipment: 'Trane Precedent' }, deps);

  assert.equal(out.meta.noDocumentation, true);
  assert.deepEqual(out.meta.usage, { ...zeroUsage(), embedTokens: 17 });
  assert.ok(Number.isFinite(out.meta.latency.retrievalMs));
  assert.equal(out.meta.latency.generationMs, 0);
  assert.equal(out.meta.model, null, 'no model call — the ledger must not count this');
});

// --- errors that consumed quota say so ---------------------------------------

test('a provider safety block carries usage, model, attempts, and modelCallAttempted on the error', async () => {
  const complete = async () => ({ ...ANSWER, blocked: true, blockReason: 'candidate:SAFETY', json: null });
  await assert.rejects(
    diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, makeDeps({ complete })),
    (e) =>
      e instanceof DiagnoseError &&
      e.providerBlocked === true &&
      e.modelCallAttempted === true &&
      e.usage.inputTokens === 3500 &&
      e.usage.cachedContentTokenCount === 2100 &&
      e.attempts === 2
  );
});

test('a failed provider call is flagged modelCallAttempted with its attempt count — retries spent quota', async () => {
  const complete = async () => {
    const err = new ProviderError(429, 'Gemini 429: quota');
    err.attempts = 3;
    throw err;
  };
  await assert.rejects(
    diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, makeDeps({ complete })),
    (e) => e instanceof DiagnoseError && e.modelCallAttempted === true && e.attempts === 3 && !e.providerBlocked
  );
});

test('a pre-model failure (unknown document id) is NOT flagged as having spent quota', async () => {
  const deps = makeDeps();
  deps.db.from = () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) });
  await assert.rejects(
    diagnose({ symptom: 'x', documentIds: ['doc_bogus'] }, deps),
    (e) => e instanceof DiagnoseError && e.status === 400 && !e.modelCallAttempted && !e.providerBlocked
  );
});

// --- the vision path ---------------------------------------------------------

function makeJpeg(width, height) {
  const data = new Uint8Array(width * height * 4).fill(128);
  return jpeg.encode({ data, width, height }, 90).data;
}

const VISION_USAGE = { inputTokens: 1300, outputTokens: 40, totalTokens: 1340, cachedContentTokenCount: 0 };

test('identify-unit meta carries the same phase names, normalised usage, and attempts', async () => {
  const out = await identifyUnit(
    { image: makeJpeg(64, 48).toString('base64') },
    {
      completeFn: async () => ({
        json: { legible: true, manufacturer: 'Trane', model: 'YSC060A4', confidence: 'high' },
        blocked: false, blockReason: null, model: 'stub-model',
        usage: VISION_USAGE, finishReason: 'STOP', attempts: 1,
      }),
      resolveFn: async () => ({ status: 'covered', documentIds: ['doc_trane1'], documents: [], covered: [], message: 'Covered.' }),
    }
  );

  assert.equal(out.identified, true);
  assert.deepEqual(out.meta.usage, { ...VISION_USAGE, embedTokens: 0 });
  assert.equal(out.meta.attempts, 1);
  assert.ok(isPhaseSplit(out.meta.latency));
});

test('a vision provider block carries usage and modelCallAttempted, and is still never an identification', async () => {
  await assert.rejects(
    identifyUnit(
      { image: makeJpeg(64, 48).toString('base64') },
      {
        completeFn: async () => ({
          json: null, blocked: true, blockReason: 'candidate:SAFETY', model: 'stub-model',
          usage: VISION_USAGE, finishReason: 'SAFETY', attempts: 1,
        }),
      }
    ),
    (e) =>
      e instanceof DiagnoseError &&
      e.providerBlocked === true &&
      e.modelCallAttempted === true &&
      e.usage.inputTokens === 1300
  );
});
