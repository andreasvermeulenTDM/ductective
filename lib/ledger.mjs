/**
 * ledger.mjs — ST-09. The per-day request ledger against the Gemini free-tier
 * budget, persisted server-side.
 *
 * Persistence is a JSON file beside the server (the dev path — serve.mjs
 * defaults it into scripts/, overridable via QUOTA_LEDGER_FILE). That is
 * deliberate and declared: the Edge Function path (H9, still blocked) will
 * need durable storage, but a quota day run through `npm run serve` must be
 * observable *today*, and a file the owner can open beats a table nobody has
 * applied. Zero DDL.
 *
 * What counts: **model calls**, not HTTP requests. The 20/day budget is
 * Gemini's requests-per-day cap, and a deterministic refusal or a
 * `unit_required` gate response spends none of it — counting those would make
 * the ledger cry wolf at 20 while the real quota sat untouched. The serve
 * transport decides via metrics.mjs's `modelCallHappened` /
 * `quotaConsumedByError` predicates (blocked and failed calls spent quota
 * too).
 *
 * Instrumentation only: a ledger failure must never fail a diagnosis, so the
 * transport wraps every call here in its own try/catch.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Gemini API free tier, requests/day for the Flash models — the "20/day"
 * budget every Run B quota-day plan is written against (see lib/vision.mjs
 * header and ST-09). Source: https://ai.google.dev/gemini-api/docs/rate-limits
 * (free tier RPD), read 6 Aug 2026. Re-check when the model pin bumps.
 */
export const FREE_TIER_REQUESTS_PER_DAY = 20;

/**
 * Local server date, YYYY-MM-DD. OPEN QUESTION (default taken): Google resets
 * free-tier quota at midnight *Pacific*; this ledger rolls at local midnight.
 * For a single dev machine the drift only mislabels which day a request lands
 * on near midnight — the running count the log line shows stays honest within
 * a session, which is what "a quota day is observable while it runs" needs.
 */
export function dayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Read the ledger file. A missing file is an empty ledger; a corrupt one is
 * preserved as `<file>.corrupt` (evidence, not garbage) and treated as empty —
 * losing the running count is recoverable, crashing the server mid-quota-day
 * is not.
 */
export function readLedger(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { days: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.days ? parsed : { days: {} };
  } catch {
    try {
      renameSync(file, `${file}.corrupt`);
      console.warn(`[ledger] ${file} was not valid JSON — preserved as ${file}.corrupt, starting fresh`);
    } catch { /* the rename is best-effort; the fresh ledger is the point */ }
    return { days: {} };
  }
}

const emptyDay = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cachedContentTokenCount: 0 });

/** The budget line for `meta.budget` — read-only, no increment. */
export function budget(file, now = new Date()) {
  const day = dayKey(now);
  const rec = readLedger(file).days[day] ?? emptyDay();
  return {
    day,
    used: rec.requests,
    limit: FREE_TIER_REQUESTS_PER_DAY,
    // Can go negative on an overrun day — that is a fact worth seeing, not
    // clamping away.
    remaining: FREE_TIER_REQUESTS_PER_DAY - rec.requests,
  };
}

/**
 * Record one model call (successful, blocked, or failed — all spent quota) and
 * return the post-increment budget. Token counts accumulate per day so a
 * finished quota day reads as totals without replaying the request log.
 */
export function recordModelCall(file, { now = new Date(), usage = {} } = {}) {
  const ledger = readLedger(file);
  const day = dayKey(now);
  const rec = ledger.days[day] ?? (ledger.days[day] = emptyDay());
  rec.requests += 1;
  rec.inputTokens += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  rec.outputTokens += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  rec.cachedContentTokenCount += Number.isFinite(usage.cachedContentTokenCount) ? usage.cachedContentTokenCount : 0;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n');

  return {
    day,
    used: rec.requests,
    limit: FREE_TIER_REQUESTS_PER_DAY,
    remaining: FREE_TIER_REQUESTS_PER_DAY - rec.requests,
  };
}

/**
 * Append one instrumented request to the JSONL log the summarizer reads
 * (`scripts/summarize-metrics.mjs`, the tool ST-10 runs). One line per
 * request; no symptom text and no image bytes ever land here — the entry is
 * numbers, route, and kind only, per ST-09's no-secrets criterion.
 */
export function appendRequestLog(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n');
}
