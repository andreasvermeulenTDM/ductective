/**
 * summarize-metrics.mjs — ST-09's log parser; the tool ST-10 runs.
 *
 *   npm run metrics                              # scripts/request-log.jsonl
 *   node scripts/summarize-metrics.mjs FILE      # any request log
 *
 * Turns a batch of instrumented requests into criterion 9's numbers: p50/p95
 * server-side latency (total, retrieval, generation), token totals, and mean
 * per-request cost with the cache discount and at full price — "without
 * caching" is computed, not measured, because Gemini's implicit caching has no
 * per-request off switch (ST-10's stated assumption). All math lives in
 * lib/metrics.mjs, where it is unit-tested; this file only reads and prints.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRequestLog, summarize } from '../lib/metrics.mjs';
import { readLedger, FREE_TIER_REQUESTS_PER_DAY } from '../lib/ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || process.env.REQUEST_LOG_FILE || join(HERE, 'request-log.jsonl');

let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`No request log at ${file}.`);
  console.error('Run `npm run serve`, make some requests, then run this again.');
  process.exit(1);
}

const { entries, skipped } = parseRequestLog(text);
const s = summarize(entries);

const ms = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);
const usd = (v) => (v === null || v === undefined ? '—' : `$${v.toFixed(6)}`);

console.log(`request log: ${file}`);
console.log(
  `entries: ${s.requests} (${s.modelCalls} model calls` +
    (skipped ? `, ${skipped} corrupt line${skipped === 1 ? '' : 's'} skipped` : '') +
    ')'
);
console.log('');
// ST-R01 / brief AC 6 — the line that tells an honest withhold from a cited
// answer. `UNCITED-ANSWER` is impossible by construction (validateAnswer forces
// noDocumentation when nothing survived); it is printed anyway, and loudly, so
// that if it ever becomes reachable nobody has to go looking for it.
const o = s.outcomes;
console.log(
  `outcomes    cited=${o.answers} withheld=${o.withholds} refused=${o.refusals} ` +
    `conversational=${o.conversational} clarify=${o.clarifies} unit-required=${o.unitRequired}  ` +
    `UNCITED-ANSWER: ${o.uncitedAnswers}` +
    (o.unclassified ? `  (${o.unclassified} row${o.unclassified === 1 ? '' : 's'} carry no outcome — pre-ST-R01 format, /identify-unit or errors)` : '')
);
if (o.uncitedAnswers > 0) {
  console.log('  !! an answer was logged with citations:0 and noDocumentation:false — the citation guarantee has a hole');
}
console.log('');
console.log(`latency     p50 ${ms(s.latencyMs.p50)}   p95 ${ms(s.latencyMs.p95)}`);
console.log(`retrieval   p50 ${ms(s.retrievalMs.p50)}   p95 ${ms(s.retrievalMs.p95)}`);
console.log(`generation  p50 ${ms(s.generationMs.p50)}   p95 ${ms(s.generationMs.p95)}`);
console.log('');
console.log(`tokens      input=${s.tokens.input} output=${s.tokens.output} cached=${s.tokens.cached} embed=${s.tokens.embed}`);
console.log(`cost/request (cache-discounted)  mean ${usd(s.cost.meanUsd)}   batch total ${usd(s.cost.totalUsd)}`);
console.log(`cost/request (no cache, computed) mean ${usd(s.cost.meanNoCacheUsd)}   batch total ${usd(s.cost.totalNoCacheUsd)}`);
console.log(
  `cache hits   ${s.cacheHits.count}  (mean cost ${usd(s.cacheHits.meanCostUsd)}, mean latency ${ms(s.cacheHits.meanLatencyMs)})`
);
console.log(
  `cache misses ${s.cacheMisses.count}  (mean cost ${usd(s.cacheMisses.meanCostUsd)}, mean latency ${ms(s.cacheMisses.meanLatencyMs)})`
);

// The day ledger, so a finished quota day reads as one table.
const ledgerFile = process.env.QUOTA_LEDGER_FILE || join(HERE, 'quota-ledger.json');
const days = readLedger(ledgerFile).days;
const dayKeys = Object.keys(days).sort();
if (dayKeys.length) {
  console.log('');
  console.log(`day ledger (${ledgerFile}):`);
  for (const k of dayKeys) {
    const d = days[k];
    console.log(
      `  ${k}  ${d.requests}/${FREE_TIER_REQUESTS_PER_DAY} requests  ` +
        `in=${d.inputTokens} out=${d.outputTokens} cached=${d.cachedContentTokenCount}`
    );
  }
}
