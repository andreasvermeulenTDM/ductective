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
