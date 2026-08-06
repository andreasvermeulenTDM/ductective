/**
 * ST-09 — cost projection and batch-summary math, pure and key-free.
 *
 *   npm test
 *
 * The DoD case lives at the bottom: the summarizer emits p50/p95 from a
 * fixture log. Costs are asserted to exact values computed by hand from the
 * named rate constants, so a silent rate edit breaks a test rather than a
 * budget report.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_FLASH_INPUT_USD_PER_MTOK,
  GEMINI_FLASH_OUTPUT_USD_PER_MTOK,
  GEMINI_FLASH_CACHED_INPUT_USD_PER_MTOK,
  VOYAGE_USD_PER_MTOK,
  zeroUsage,
  normalizeUsage,
  estimateCostUsd,
  modelCallHappened,
  quotaConsumedByError,
  parseRequestLog,
  percentile,
  summarize,
} from './metrics.mjs';

// --- usage normalisation -----------------------------------------------------

test('zeroUsage carries every field explicitly at 0 — absent reads as uninstrumented', () => {
  assert.deepEqual(zeroUsage(), {
    inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedContentTokenCount: 0, embedTokens: 0,
  });
});

test('normalizeUsage fills gaps a partial stub leaves', () => {
  const u = normalizeUsage({ inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(u, { inputTokens: 10, outputTokens: 5, totalTokens: 0, cachedContentTokenCount: 0, embedTokens: 0 });
  assert.deepEqual(normalizeUsage(undefined), zeroUsage());
  assert.equal(normalizeUsage({ inputTokens: NaN }).inputTokens, 0);
});

// --- cost projection ---------------------------------------------------------

test('estimateCostUsd prices cached tokens at the discount and uncached at full rate', () => {
  // 1M input of which 400k cached, 100k output, 1k embed — hand-computable.
  const { withCacheUsd, withoutCacheUsd } = estimateCostUsd({
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cachedContentTokenCount: 400_000,
    embedTokens: 1_000,
  });
  const output = 0.1 * GEMINI_FLASH_OUTPUT_USD_PER_MTOK;
  const embed = 0.001 * VOYAGE_USD_PER_MTOK;
  assert.equal(withoutCacheUsd, 1 * GEMINI_FLASH_INPUT_USD_PER_MTOK + output + embed);
  assert.equal(
    withCacheUsd,
    0.6 * GEMINI_FLASH_INPUT_USD_PER_MTOK + 0.4 * GEMINI_FLASH_CACHED_INPUT_USD_PER_MTOK + output + embed
  );
  assert.ok(withCacheUsd < withoutCacheUsd);
});

test('a cache miss projects identical with/without numbers', () => {
  const c = estimateCostUsd({ inputTokens: 3500, outputTokens: 900, cachedContentTokenCount: 0 });
  assert.equal(c.withCacheUsd, c.withoutCacheUsd);
});

test('cachedContentTokenCount is clamped to inputTokens — a lying stub cannot go negative', () => {
  const c = estimateCostUsd({ inputTokens: 100, cachedContentTokenCount: 500 });
  assert.equal(c.withCacheUsd, (100 / 1e6) * GEMINI_FLASH_CACHED_INPUT_USD_PER_MTOK);
});

test('zero usage costs zero', () => {
  assert.deepEqual(estimateCostUsd(zeroUsage()), { withCacheUsd: 0, withoutCacheUsd: 0 });
});

// --- ledger predicates -------------------------------------------------------

test('modelCallHappened keys off meta.model — null on every pre-model path', () => {
  assert.equal(modelCallHappened({ meta: { model: 'gemini-x' } }), true);
  assert.equal(modelCallHappened({ meta: { model: null } }), false);
  assert.equal(modelCallHappened({}), false);
});

test('quotaConsumedByError: provider blocks and attempted calls count; pre-model errors do not', () => {
  assert.equal(quotaConsumedByError({ providerBlocked: true }), true);
  assert.equal(quotaConsumedByError({ modelCallAttempted: true }), true);
  assert.equal(quotaConsumedByError({ status: 400, message: 'symptom is required' }), false);
  assert.equal(quotaConsumedByError(null), false);
});

// --- percentiles -------------------------------------------------------------

test('percentile is nearest-rank and null on empty', () => {
  const v = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(v, 50), 500);
  assert.equal(percentile(v, 95), 1000);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, NaN, 3], 50), 1); // non-numeric samples are dropped
});

// --- the DoD case: p50/p95 and mean cost from a fixture log ------------------

const FIXTURE_LOG = [
  // 4 model calls: two cache hits, two misses; latencies 8s/12s/20s/40s.
  { ts: 't1', route: '/diagnose', kind: 'answer', latencyMs: 8000, retrievalMs: 1000, generationMs: 6800,
    usage: { inputTokens: 3500, outputTokens: 900, totalTokens: 4400, cachedContentTokenCount: 2000, embedTokens: 20 } },
  { ts: 't2', route: '/diagnose', kind: 'answer', latencyMs: 12000, retrievalMs: 1500, generationMs: 10300,
    usage: { inputTokens: 4000, outputTokens: 1100, totalTokens: 5100, cachedContentTokenCount: 0, embedTokens: 25 } },
  { ts: 't3', route: '/identify-unit', kind: 'identify', latencyMs: 20000, retrievalMs: 100, generationMs: 19000,
    usage: { inputTokens: 1300, outputTokens: 40, totalTokens: 1340, cachedContentTokenCount: 0, embedTokens: 0 } },
  { ts: 't4', route: '/diagnose', kind: 'answer', latencyMs: 40000, retrievalMs: 2000, generationMs: 37500,
    usage: { inputTokens: 5000, outputTokens: 1200, totalTokens: 6200, cachedContentTokenCount: 3000, embedTokens: 30 } },
  // 1 request that never reached the model — timed, but not a cost sample.
  { ts: 't5', route: '/diagnose', kind: 'refusal', latencyMs: 1, retrievalMs: 0, generationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedContentTokenCount: 0, embedTokens: 0 } },
]
  .map((e) => JSON.stringify(e))
  .join('\n');

test('parseRequestLog reads JSONL and counts corrupt lines instead of dying on them', () => {
  const { entries, skipped } = parseRequestLog(FIXTURE_LOG + '\nnot json at all\n\n');
  assert.equal(entries.length, 5);
  assert.equal(skipped, 1);
});

test('summarize emits p50/p95 latency and mean cost with/without cache from the fixture log', () => {
  const { entries } = parseRequestLog(FIXTURE_LOG);
  const s = summarize(entries);

  assert.equal(s.requests, 5);
  assert.equal(s.modelCalls, 4);
  // Nearest-rank over [1, 8000, 12000, 20000, 40000].
  assert.equal(s.latencyMs.p50, 12000);
  assert.equal(s.latencyMs.p95, 40000);
  assert.equal(s.generationMs.p95, 37500);

  // The refusal is excluded from the cache split; hits and misses are 2/2.
  assert.equal(s.cacheHits.count, 2);
  assert.equal(s.cacheMisses.count, 2);

  // Mean cost equals the mean of per-entry projections — and caching saves money.
  const perEntry = s.requests && entries.slice(0, 4).map((e) => estimateCostUsd(e.usage));
  const meanUsd = perEntry.reduce((a, c) => a + c.withCacheUsd, 0) / 4;
  const meanNoCacheUsd = perEntry.reduce((a, c) => a + c.withoutCacheUsd, 0) / 4;
  assert.ok(Math.abs(s.cost.meanUsd - meanUsd) < 1e-12);
  assert.ok(Math.abs(s.cost.meanNoCacheUsd - meanNoCacheUsd) < 1e-12);
  assert.ok(s.cost.meanUsd < s.cost.meanNoCacheUsd);

  assert.deepEqual(s.tokens, { input: 13800, output: 3240, cached: 5000, embed: 75 });
});
