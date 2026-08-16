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
// ST-R01 (D2) — the request log tells an honest withhold from an uncited answer
//
// `00-brief-round4.md`'s D2: the log recorded `kind` and `scopedTo` but not
// `noDocumentation`, so the four dead turns of the 16 Aug device session read as
//
//     answer   6243ms  retrieved=8 cites=0 scope=33
//
// and there was no way to tell "I honestly had nothing" from "I answered with
// nothing attached". In a system whose first rule is *cite every claim*, those
// are the two outcomes that most need telling apart, and the owner had to infer
// which it was from an output-token count.
//
// The fix is two fields on every /diagnose line and a pure classifier over them,
// so the distinction is asserted by a test rather than read by eye.
// ---------------------------------------------------------------------------

/**
 * The outcome fields every `/diagnose` request-log row carries, derived from the
 * response. Pure, and **every field is always present** — an absent
 * `noDocumentation` must never be readable as `false`, which is precisely the
 * ambiguity D2 is about (`zeroUsage`'s reasoning, applied to outcomes).
 *
 * `kind` is the response kind; `noDocumentation` is the honest-withhold flag
 * `validateAnswer` sets; `cites` is the citation count actually sent to the app.
 *
 * @param {{kind?: string, citations?: Array, meta?: object}} result
 */
export function diagnoseLogFields(result) {
  return {
    kind: result?.kind ?? null,
    noDocumentation: result?.meta?.noDocumentation === true,
    cites: Array.isArray(result?.citations) ? result.citations.length : 0,
    ...(result?.meta?.scopedTo !== undefined ? { scopedTo: result.meta.scopedTo } : {}),
    ...(result?.meta?.scopeFallback ? { scopeFallback: true } : {}),
    ...(result?.meta?.intent ? { intent: result.meta.intent } : {}),
    ...(result?.meta?.shape ? { shape: result.meta.shape } : {}),
  };
}

/**
 * The `/diagnose` console line, up to the usage suffix.
 *
 * Extracted from `serve.mjs` so the one thing the owner actually watches during a
 * live session is covered by a test rather than by eyeballing a terminal. `nodoc`
 * is the visible half of D2: a withhold now says so on the line, without anyone
 * parsing JSONL mid-session.
 */
export function diagnoseLogLine(result) {
  const m = result?.meta ?? {};
  const cites = Array.isArray(result?.citations) ? result.citations.length : 0;
  return (
    `${String(result?.kind ?? '?').padEnd(8)} ${m.latencyMs}ms  ` +
    `retrieved=${m.retrieved ?? '-'} cites=${cites}` +
    (m.noDocumentation === true ? ' nodoc' : '') +
    (m.scopedTo !== undefined ? ` scope=${m.scopedTo}` : '') +
    (m.scopeFallback ? ' SCOPE-FALLBACK' : '') +
    (m.dropped ? ` dropped=${m.dropped}` : '')
  );
}

/**
 * The outcome a request-log row records, or `null` when the row predates
 * ST-R01 and therefore cannot say.
 *
 * **A pre-existing line is never counted as anything.** The session that
 * motivated this round is in the old format, and a classifier that read a
 * missing `noDocumentation` as `false` would relabel four honest withholds as
 * uncited answers — inventing the alarm it exists to raise (AC 6).
 *
 * The five signatures, all distinct:
 *
 *   cited answer   kind:'answer'         noDocumentation:false  cites > 0
 *   honest withhold                      noDocumentation:true   cites: 0
 *   refusal        kind:'refusal'                               cites: 0
 *   conversational kind:'conversational'                        cites: 0
 *   UNCITED ANSWER kind:'answer'         noDocumentation:false  cites: 0
 *
 * The last is **impossible by construction** — `validateAnswer` forces
 * `noDocumentation` when nothing survived validation — so it is counted
 * separately and printed loudly. If it ever becomes reachable, the citation
 * guarantee has a hole and the metrics line is where it shows up first.
 *
 * @returns {'answers'|'withholds'|'refusals'|'conversational'|'clarifies'|
 *           'unitRequired'|'uncitedAnswers'|null}
 */
export function classifyLogOutcome(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.noDocumentation !== 'boolean') return null;
  if (!Number.isInteger(entry.cites)) return null;

  // A withhold is a withhold whatever kind label it wears — `validateAnswer`
  // relabels a model `no_documentation` as `kind:'answer'`, and that relabelling
  // is exactly what made the log unreadable in the first place.
  if (entry.noDocumentation) return 'withholds';

  switch (entry.kind) {
    case 'refusal': return 'refusals';
    case 'conversational': return 'conversational';
    case 'clarify': return 'clarifies';
    case 'unit_required': return 'unitRequired';
    case 'answer': return entry.cites > 0 ? 'answers' : 'uncitedAnswers';
    default: return null;
  }
}

/** Every key `classifyLogOutcome` can return, so a zeroed tally is complete. */
export const OUTCOME_KEYS = Object.freeze([
  'answers', 'withholds', 'refusals', 'conversational', 'clarifies',
  'unitRequired', 'uncitedAnswers',
]);

/**
 * Tally outcomes over a batch of rows. `unclassified` counts rows that carry no
 * outcome — old-format lines, `/identify-unit` rows and error rows — so the
 * numbers add up and nothing goes missing silently.
 */
export function summarizeOutcomes(entries) {
  const out = Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 0]));
  out.unclassified = 0;
  for (const e of entries ?? []) {
    const k = classifyLogOutcome(e);
    if (k) out[k] += 1; else out.unclassified += 1;
  }
  return out;
}

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
    // ST-R01 — brief AC 6. Kept beside the cost numbers deliberately: `npm run
    // metrics` is the one command anyone runs over a finished session, so the
    // outcome split has to be there rather than in a second tool.
    outcomes: summarizeOutcomes(entries),
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
