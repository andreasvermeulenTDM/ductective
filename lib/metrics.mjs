/**
 * metrics.mjs — ST-09 (M15/M16). Token accounting, projected cost, and the
 * batch summary math behind criterion 9.
 *
 * Everything here is pure and key-free: the serve transport and the summarizer
 * CLI are thin wrappers around these functions, so the numbers ST-10 reports
 * are computed by tested code, not by a script nobody runs twice the same way.
 *
 * Instrumentation only — nothing in this module touches retrieval, prompts, or
 * response shapes.
 */

// ---------------------------------------------------------------------------
// Published rates — named constants with sources, per ST-09's criterion.
// ---------------------------------------------------------------------------

/**
 * Gemini Flash tier, USD per 1M tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (Flash row), read
 * 6 Aug 2026. The cached-input rate is the implicit/context-caching discount
 * price for tokens reported in `usageMetadata.cachedContentTokenCount` — 75%
 * off the input rate.
 *
 * The pinned model is `gemini-3.6-flash` (lib/providers/gemini.mjs). If that
 * pin is ever bumped, RE-CHECK these three numbers in the same change — a cost
 * projection at a stale rate is worse than none, because it looks measured.
 */
export const GEMINI_FLASH_INPUT_USD_PER_MTOK = 0.30;
export const GEMINI_FLASH_OUTPUT_USD_PER_MTOK = 2.50;
export const GEMINI_FLASH_CACHED_INPUT_USD_PER_MTOK = 0.075;

/**
 * Voyage embeddings, USD per 1M tokens — list price for the large tier
 * (`voyage-4-large`, the default in lib/clients.mjs).
 * Source: https://docs.voyageai.com/docs/pricing, read 6 Aug 2026.
 * Note the account carries a 200M-token free allowance (clients.mjs header),
 * so the practical marginal cost is $0 until that is exhausted; this constant
 * is the list rate so the projection is an upper bound, not an optimistic one.
 */
export const VOYAGE_USD_PER_MTOK = 0.18;

// ---------------------------------------------------------------------------
// Usage normalisation
// ---------------------------------------------------------------------------

/**
 * The usage block every /diagnose and /identify-unit response carries in
 * `meta.usage`, whatever path produced it. Paths that never call the model
 * (refusal, unit_required, empty scope, no-documentation) carry explicit
 * zeros rather than omitting the block — an absent field reads as "not
 * instrumented", which is exactly the ambiguity ST-09 exists to remove.
 *
 * `embedTokens` is the Voyage query-embedding spend (diagnose only; the
 * vision path embeds nothing).
 */
export function zeroUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedContentTokenCount: 0, embedTokens: 0 };
}

/** Fill defaults so the meta contract holds even against a partial stub. */
export function normalizeUsage(usage = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    inputTokens: n(usage.inputTokens),
    outputTokens: n(usage.outputTokens),
    totalTokens: n(usage.totalTokens),
    cachedContentTokenCount: n(usage.cachedContentTokenCount),
    embedTokens: n(usage.embedTokens),
  };
}

// ---------------------------------------------------------------------------
// Cost projection — M16
// ---------------------------------------------------------------------------

/**
 * Projected USD for one request, with and without the cache discount.
 *
 * "Without" is computed, not measured: Gemini's implicit caching cannot be
 * switched off per request (ST-10's stated assumption), so the uncached number
 * is the same token counts priced at the full input rate. Cached tokens are a
 * subset of input tokens in `usageMetadata`, so the discounted projection
 * prices (input − cached) at full rate and cached at the discount rate.
 *
 * @returns {{withCacheUsd: number, withoutCacheUsd: number}}
 */
export function estimateCostUsd(usage) {
  const u = normalizeUsage(usage);
  const cached = Math.min(u.cachedContentTokenCount, u.inputTokens);
  const embed = (u.embedTokens / 1e6) * VOYAGE_USD_PER_MTOK;
  const output = (u.outputTokens / 1e6) * GEMINI_FLASH_OUTPUT_USD_PER_MTOK;
  const withoutCacheUsd = (u.inputTokens / 1e6) * GEMINI_FLASH_INPUT_USD_PER_MTOK + output + embed;
  const withCacheUsd =
    ((u.inputTokens - cached) / 1e6) * GEMINI_FLASH_INPUT_USD_PER_MTOK +
    (cached / 1e6) * GEMINI_FLASH_CACHED_INPUT_USD_PER_MTOK +
    output + embed;
  return { withCacheUsd, withoutCacheUsd };
}

// ---------------------------------------------------------------------------
// Ledger predicates — the serve transport's counting decisions, pure
// ---------------------------------------------------------------------------

/**
 * Did producing this response spend a Gemini request? `meta.model` is null on
 * every path that never reached the model (refusal, unit_required, empty
 * scope, no-documentation-before-generate) and set on every path that did —
 * that invariant is what makes the day ledger honest about the 20/day budget.
 */
export const modelCallHappened = (result) => Boolean(result?.meta?.model);

/**
 * Did this *error* spend a Gemini request? A provider safety block certainly
 * did; `modelCallAttempted` is set where diagnose/vision convert a
 * ProviderError, because a call that 429'd or timed out still burned attempts.
 * Transport errors raised before the model (400s, 413s, retrieval 502s) spend
 * nothing and return false.
 */
export const quotaConsumedByError = (e) => Boolean(e && (e.providerBlocked || e.modelCallAttempted));

// ---------------------------------------------------------------------------
// Batch summary — the tool ST-10 runs (p50/p95, mean cost with/without cache)
// ---------------------------------------------------------------------------

/** Parse a JSONL request log, skipping (and counting) unparseable lines. */
export function parseRequestLog(text) {
  const entries = [];
  let skipped = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped++; }
  }
  return { entries, skipped };
}

/** Nearest-rank percentile. Returns null for an empty series. */
export function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Summarize a batch of request-log entries into criterion 9's numbers.
 * Latency percentiles run over every entry that carries `latencyMs`; cost and
 * the cache-hit/miss split run over model calls only — a refusal that spent
 * nothing is not a "cache miss", it is not a sample.
 */
export function summarize(entries) {
  const timed = entries.filter((e) => Number.isFinite(e.latencyMs));
  const modelCalls = entries.filter((e) => normalizeUsage(e.usage ?? e).totalTokens > 0 || e.modelCall === true);

  const usages = modelCalls.map((e) => normalizeUsage(e.usage ?? e));
  const costs = usages.map(estimateCostUsd);
  const tokens = usages.reduce(
    (t, u) => ({
      input: t.input + u.inputTokens,
      output: t.output + u.outputTokens,
      cached: t.cached + u.cachedContentTokenCount,
      embed: t.embed + u.embedTokens,
    }),
    { input: 0, output: 0, cached: 0, embed: 0 }
  );

  const group = (pred) => {
    const idx = usages.map((u, i) => [u, i]).filter(([u]) => pred(u)).map(([, i]) => i);
    return {
      count: idx.length,
      meanCostUsd: mean(idx.map((i) => costs[i].withCacheUsd)),
      meanLatencyMs: mean(idx.map((i) => modelCalls[i].latencyMs).filter(Number.isFinite)),
    };
  };

  return {
    requests: entries.length,
    modelCalls: modelCalls.length,
    latencyMs: { p50: percentile(timed.map((e) => e.latencyMs), 50), p95: percentile(timed.map((e) => e.latencyMs), 95) },
    retrievalMs: { p50: percentile(timed.map((e) => e.retrievalMs), 50), p95: percentile(timed.map((e) => e.retrievalMs), 95) },
    generationMs: { p50: percentile(timed.map((e) => e.generationMs), 50), p95: percentile(timed.map((e) => e.generationMs), 95) },
    tokens,
    cost: {
      totalUsd: costs.reduce((a, c) => a + c.withCacheUsd, 0),
      totalNoCacheUsd: costs.reduce((a, c) => a + c.withoutCacheUsd, 0),
      meanUsd: mean(costs.map((c) => c.withCacheUsd)),
      meanNoCacheUsd: mean(costs.map((c) => c.withoutCacheUsd)),
    },
    cacheHits: group((u) => u.cachedContentTokenCount > 0),
    cacheMisses: group((u) => u.cachedContentTokenCount === 0),
  };
}
