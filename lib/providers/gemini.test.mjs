/**
 * ST-09 — the adapter's usage surface, stub-tested.
 *
 *   npm test
 *
 * Zero live Gemini calls: `fetch` is mocked with a canned response body, which
 * is exactly what ST-09's first criterion asks for. The property under test is
 * that `usage` surfaces `cachedContentTokenCount` alongside input/output/total
 * (it was read nowhere before this story — a quota day ran blind on cache
 * behaviour), and that the retry count is observable via `attempts`.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { complete, ProviderError } from './gemini.mjs';

/** A minimal successful generateContent body. */
const body = (usageMetadata) => ({
  candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
  modelVersion: 'stub-model-001',
  usageMetadata,
});

const jsonResponse = (json, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json,
  text: async () => JSON.stringify(json),
});

/** complete() refuses to run without a key; give it an obviously fake one. */
function withFakeKey(t) {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'not-a-real-key';
  t.after(() => {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });
}

test('usage surfaces cachedContentTokenCount alongside input/output/total', async (t) => {
  withFakeKey(t);
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    jsonResponse(body({
      promptTokenCount: 3500,
      candidatesTokenCount: 900,
      totalTokenCount: 4400,
      cachedContentTokenCount: 2100,
    }))
  );
  t.after(() => fetchMock.mock.restore());

  const res = await complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(res.usage, {
    inputTokens: 3500,
    outputTokens: 900,
    totalTokens: 4400,
    cachedContentTokenCount: 2100,
  });
  assert.equal(res.attempts, 1);
});

test('a cache miss (field absent from usageMetadata) surfaces as 0, not undefined', async (t) => {
  withFakeKey(t);
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    jsonResponse(body({ promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }))
  );
  t.after(() => fetchMock.mock.restore());

  const res = await complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.usage.cachedContentTokenCount, 0);
  assert.equal(typeof res.usage.cachedContentTokenCount, 'number');
});

test('a retried call reports attempts, so the serve log can show the retry count', async (t) => {
  withFakeKey(t);
  let calls = 0;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return jsonResponse({ error: { message: 'quota' } }, 429);
    return jsonResponse(body({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }));
  });
  t.after(() => fetchMock.mock.restore());

  const res = await complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.attempts, 2);
  assert.equal(calls, 2);
});

test('a non-retryable failure carries .attempts on the ProviderError — a failed call still spent quota', async (t) => {
  withFakeKey(t);
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    jsonResponse({ error: { message: 'bad request' } }, 400)
  );
  t.after(() => fetchMock.mock.restore());

  await assert.rejects(
    complete({ messages: [{ role: 'user', content: 'hi' }] }),
    (e) => e instanceof ProviderError && e.status === 400 && e.attempts === 1
  );
});

// ---------------------------------------------------------------------------
// Model fallback chain (owner request, 10 Aug 2026)
// ---------------------------------------------------------------------------

import { MODEL_CHAIN, _resetModelMemo } from './gemini.mjs';

const ok200 = (model) => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: 'RAIL OK' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    modelVersion: model,
  }),
});
const quota429 = (scope) => ({
  ok: false,
  status: 429,
  text: async () =>
    JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
      message: `You exceeded your current quota: GenerateRequestsPer${scope}PerProjectPerModel-FreeTier` } }),
});

test('fallback: daily-exhausted head model chains to the next, loudly', async () => {
  _resetModelMemo();
  process.env.GEMINI_API_KEY ||= 'AQ.test-key-not-real';
  const calls = [];
  mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    // Head model: PerDay quota. Second model: succeeds.
    return calls.length <= 3 ? quota429('Day') : ok200(MODEL_CHAIN[1]);
  });
  try {
    const r = await complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.fallback, true);
    assert.equal(r.requestedModel, MODEL_CHAIN[0]);
    assert.equal(r.model, MODEL_CHAIN[1]);

    // Memoized: the next call must not probe the dead head model again.
    calls.length = 0;
    await complete({ messages: [{ role: 'user', content: 'again' }] });
    assert.ok(calls.every((u) => !u.includes(`/models/${MODEL_CHAIN[0]}:`)),
      'head model was probed again despite day-exhaustion memo');
  } finally {
    mock.restoreAll();
    _resetModelMemo();
  }
});

test('fallback: per-minute throttle chains NOW but does not memoize the day', async () => {
  _resetModelMemo();
  process.env.GEMINI_API_KEY ||= 'AQ.test-key-not-real';
  let phase = 0;
  const heads = [];
  mock.method(globalThis, 'fetch', async (url) => {
    const isHead = String(url).includes(`/models/${MODEL_CHAIN[0]}:`);
    if (isHead) heads.push(phase);
    if (phase === 0 && isHead) return quota429('Minute');
    return ok200(isHead ? MODEL_CHAIN[0] : MODEL_CHAIN[1]);
  });
  try {
    const r1 = await complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r1.fallback, true, 'first call should have fallen back');
    phase = 1;
    const r2 = await complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r2.fallback, false, 'minute throttle must not memoize the day');
    assert.ok(heads.includes(1), 'head model was never retried after the minute throttle');
  } finally {
    mock.restoreAll();
    _resetModelMemo();
  }
});

test('fallback: an explicit model never chains', async () => {
  _resetModelMemo();
  process.env.GEMINI_API_KEY ||= 'AQ.test-key-not-real';
  mock.method(globalThis, 'fetch', async () => quota429('Day'));
  try {
    await assert.rejects(
      () => complete({ model: MODEL_CHAIN[0], messages: [{ role: 'user', content: 'hi' }] }),
      (e) => e instanceof ProviderError && e.status === 429 && !e.chainExhausted
    );
  } finally {
    mock.restoreAll();
    _resetModelMemo();
  }
});

test('fallback: whole chain exhausted → one clear 429, chainExhausted set', async () => {
  _resetModelMemo();
  process.env.GEMINI_API_KEY ||= 'AQ.test-key-not-real';
  mock.method(globalThis, 'fetch', async () => quota429('Day'));
  try {
    await assert.rejects(
      () => complete({ messages: [{ role: 'user', content: 'hi' }] }),
      (e) => e.chainExhausted === true && /exhausted across the model chain/.test(e.message)
    );
  } finally {
    mock.restoreAll();
    _resetModelMemo();
  }
});

test('fallback: a non-quota error does not chain', async () => {
  _resetModelMemo();
  process.env.GEMINI_API_KEY ||= 'AQ.test-key-not-real';
  const calls = [];
  mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return { ok: false, status: 400, text: async () => 'bad request' };
  });
  try {
    await assert.rejects(() => complete({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(calls.length, 1, 'a 400 must fail fast, not walk the chain');
  } finally {
    mock.restoreAll();
    _resetModelMemo();
  }
});
