/**
 * run.mjs — the M12 measurement gate. ⛔
 *
 *   node --env-file=.env spike/m12/run.mjs [--model gemini-3.6-flash] [--faults 15]
 *
 * ⚠️ SPIKE. A minimal envelope, schema and validator, built to be discarded. Its
 * only job is to produce four numbers on a throwaway harness rather than
 * discovering them in Run B's eval, where they would be expensive.
 *
 * The four numbers, per M12:
 *   1. span-verification pass rate  — do emitted spans appear verbatim in the
 *                                     chunk they name
 *   2. chunk-id fabrication rate    — ids outside the per-request map
 *   3. provider block rate          — per HARM_CATEGORY, across all 15 faults
 *   4. real token counts            — in / out / cached, plus the output delta
 *                                     attributable to carrying spans at all
 *
 * Nothing here is production code. M6–M8 are calibrated *by* this output; they do
 * not import it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { normalise } from './chunks.mjs';
import { supabaseAdmin, embed } from '../../lib/clients.mjs';
import { complete, ProviderError, DEFAULT_MODEL } from '../../lib/providers/gemini.mjs';

/**
 * Chunks now come from live pgvector via match_chunks — M12 as originally
 * written. The pdftotext + keyword-overlap path in chunks.mjs was a stand-in
 * from before the chunks table existed, and its flaw finally showed: drawing on
 * the full manifest corpus, keyword overlap served product-data spec tables for
 * common terms, the model correctly returned zero claims for 7 of 9 faults, and
 * the run starved below the 20-claim floor. Real retrieval serves the chunks the
 * production system would actually cite from, which is the thing worth measuring.
 */
async function retrieveChunks(db, faultName, k = 8) {
  const { embeddings } = await embed([`rooftop unit ${faultName}`], { inputType: 'query' });
  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: embeddings[0],
    match_count: k,
    scope_only: true,
  });
  if (error) throw new Error(`match_chunks: ${error.message}`);
  return (data ?? []).map((h) => ({ doc: h.out_document, page: h.out_page, text: h.out_text }));
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const MODEL = arg('model', DEFAULT_MODEL);
const LIMIT = Number(arg('faults', '15'));

/**
 * Pacing, because the free tier will not carry this run unpaced.
 *
 * The first full attempt returned 429 RESOURCE_EXHAUSTED on 11 of 15 faults. That
 * is M3's open question answered: the free tier does not survive a 30-call run.
 * The adapter's bounded backoff (3 attempts, sub-second) is correct for a
 * transient 429 and useless against a per-minute quota — so the pacing belongs
 * here, in the harness, not in production retry logic.
 */
const DELAY_MS = Number(arg('delay', '7000'));
const QUOTA_WAIT_MS = Number(arg('quota-wait', '65000'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The no-spans baseline doubles the call count, and the free-tier limit is
 * **20 requests per day per model** (`GenerateRequestsPerDayPerProjectPerModel-
 * FreeTier`, confirmed from the 429 detail). 15 faults × 2 schemas = 30 calls,
 * so the gate cannot complete in a day with the baseline on.
 *
 * `--no-baseline` drops to 15 calls, which fits. The cost is number 4's span
 * *overhead* — in/out totals are still real. Sample the overhead separately, or
 * run the full thing once billing is enabled.
 *
 * Note the daily cap is per *model*, so a Pro comparison run has its own budget.
 */
const BASELINE = !process.argv.includes('--no-baseline');

// The fixture is a coverage reference authored by Stage 5, not a bare array —
// `faults` is the list, and it carries a `refusal` flag per fault.
const FAULTS = JSON.parse(readFileSync('tests/fixtures/top-15-faults.json', 'utf8')).faults.slice(0, LIMIT);

/**
 * The envelope M6 will formalise. Chunk ids are **per request** — `c1..c8`, not
 * database ids — so a fabricated id is detectable without a lookup, and so the
 * model cannot recite an id it saw in training.
 */
function envelope(chunks) {
  return chunks
    .map((c, i) => `<chunk id="c${i + 1}" doc="${c.doc}" page="${c.page}">\n${c.text}\n</chunk>`)
    .join('\n\n');
}

const SYSTEM =
  'You are a diagnostic assistant for HVAC technicians working on light-commercial ' +
  'rooftop units. Answer ONLY from the supplied chunks. Every claim must cite the ' +
  'chunk it came from by its exact id, and must quote a span copied CHARACTER-FOR-' +
  'CHARACTER from that chunk. Never invent a chunk id. If the chunks do not support ' +
  'an answer, return an empty claims array.';

/** With spans — the design under test. */
const SCHEMA_SPANS = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          chunk_id: { type: 'string' },
          quoted_span: { type: 'string' },
        },
        required: ['claim', 'chunk_id', 'quoted_span'],
      },
    },
  },
  required: ['claims'],
};

/** Without spans — the baseline, so the span output cost is isolable. */
const SCHEMA_NO_SPANS = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, chunk_id: { type: 'string' } },
        required: ['claim', 'chunk_id'],
      },
    },
  },
  required: ['claims'],
};

/** One retry per call after a full quota window, then give up and record it. */
async function askPaced(fault, chunks, schema) {
  let r = await ask(fault, chunks, schema);
  if (!r.ok && r.error === '429') {
    process.stdout.write(`    (quota hit — waiting ${Math.round(QUOTA_WAIT_MS / 1000)}s) `);
    await pause(QUOTA_WAIT_MS);
    r = await ask(fault, chunks, schema);
  }
  await pause(DELAY_MS);
  return r;
}

async function ask(fault, chunks, schema) {
  const prompt =
    `${envelope(chunks)}\n\n` +
    `A technician reports: "${fault.name}" on a light-commercial rooftop unit.\n` +
    `Give the diagnostic checks, in the order they should be performed.`;

  try {
    const r = await complete({
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      model: MODEL,
      json: schema,
      maxOutputTokens: 4096,
    });
    return { ok: true, ...r };
  } catch (e) {
    // A ProviderError is a failure of this run, not a measurement. Recorded
    // separately so it can never be averaged into a pass rate.
    return { ok: false, error: e instanceof ProviderError ? `${e.status}` : 'unknown', message: e.message };
  }
}

const rows = [];
console.log(`\nM12 measurement gate — ${MODEL}, ${FAULTS.length} faults, 8 chunks each\n`);

const db = supabaseAdmin();

for (const fault of FAULTS) {
  const chunks = await retrieveChunks(db, fault.name);
  if (chunks.length === 0) {
    console.error('match_chunks returned nothing — is the corpus ingested?');
    process.exit(1);
  }
  const ids = new Set(chunks.map((_, i) => `c${i + 1}`));
  const byId = Object.fromEntries(chunks.map((c, i) => [`c${i + 1}`, c]));

  const withSpans = await askPaced(fault, chunks, SCHEMA_SPANS);
  const noSpans = BASELINE ? await askPaced(fault, chunks, SCHEMA_NO_SPANS) : { ok: false };

  const row = {
    id: fault.id,
    name: fault.name,
    advisoryOnly: !!fault.refusal,
    ok: withSpans.ok,
    error: withSpans.ok ? null : withSpans.error,
    blocked: withSpans.blocked ?? false,
    blockReason: withSpans.blockReason ?? null,
    finishReason: withSpans.finishReason ?? null,
    claims: 0,
    spansVerified: 0,
    spansFailed: 0,
    fabricatedIds: 0,
    tokensIn: withSpans.usage?.inputTokens ?? 0,
    tokensOut: withSpans.usage?.outputTokens ?? 0,
    tokensOutNoSpans: noSpans.ok ? noSpans.usage?.outputTokens ?? 0 : null,
    failures: [],
  };

  if (withSpans.ok && withSpans.json) {
    for (const c of withSpans.json.claims ?? []) {
      row.claims++;
      if (!ids.has(c.chunk_id)) {
        row.fabricatedIds++;
        row.failures.push({ kind: 'fabricated-id', chunk_id: c.chunk_id });
        continue;
      }
      const hay = normalise(byId[c.chunk_id].text);
      const needle = normalise(c.quoted_span ?? '');
      if (needle && hay.includes(needle)) row.spansVerified++;
      else {
        row.spansFailed++;
        row.failures.push({ kind: 'span-not-found', chunk_id: c.chunk_id, span: (c.quoted_span ?? '').slice(0, 90) });
      }
    }
  }

  rows.push(row);
  const verdict = !row.ok ? `ERROR ${row.error}` : row.blocked ? `BLOCKED ${row.blockReason}` : `${row.spansVerified}/${row.claims} spans`;
  console.log(`  ${row.id}  ${verdict.padEnd(22)} ${row.name.slice(0, 46)}`);
}

// --- the four numbers -------------------------------------------------------
const usable = rows.filter((r) => r.ok && !r.blocked);
const claims = usable.reduce((n, r) => n + r.claims, 0);
const verified = usable.reduce((n, r) => n + r.spansVerified, 0);
const fabricated = usable.reduce((n, r) => n + r.fabricatedIds, 0);
const blocked = rows.filter((r) => r.blocked);
const errored = rows.filter((r) => !r.ok);

const sum = (k) => usable.reduce((n, r) => n + (r[k] ?? 0), 0);
const outWith = sum('tokensOut');
const withBaseline = usable.filter((r) => r.tokensOutNoSpans !== null);
const outNo = withBaseline.reduce((n, r) => n + r.tokensOutNoSpans, 0);
const outWithForDelta = withBaseline.reduce((n, r) => n + r.tokensOut, 0);

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a');

const summary = {
  model: MODEL,
  faults: rows.length,
  spanVerificationRate: pct(verified, claims),
  spanVerificationRaw: `${verified}/${claims}`,
  chunkIdFabricationRate: pct(fabricated, claims),
  chunkIdFabricationRaw: `${fabricated}/${claims}`,
  providerBlockRate: pct(blocked.length, rows.length),
  providerBlocks: blocked.map((b) => ({ id: b.id, reason: b.blockReason })),
  errors: errored.map((e) => ({ id: e.id, status: e.error })),
  tokensIn: sum('tokensIn'),
  tokensOutWithSpans: outWith,
  tokensOutWithoutSpans: outNo,
  spanOutputOverhead: outNo ? `${(((outWithForDelta - outNo) / outNo) * 100).toFixed(1)}%` : 'n/a',
};

console.log('\n--- the four numbers ---');
console.log(`  1. span verification      ${summary.spanVerificationRate}  (${summary.spanVerificationRaw})`);
console.log(`  2. chunk-id fabrication   ${summary.chunkIdFabricationRate}  (${summary.chunkIdFabricationRaw})`);
console.log(`  3. provider block rate    ${summary.providerBlockRate}  (${blocked.length}/${rows.length})`);
console.log(`  4. tokens in/out          ${summary.tokensIn}/${summary.tokensOutWithSpans}   span overhead ${summary.spanOutputOverhead}`);
if (errored.length) console.log(`     errors: ${errored.map((e) => e.id + ':' + e.error).join(', ')}`);

// --- stop conditions --------------------------------------------------------
const rate = claims ? verified / claims : 0;
console.log('\n--- stop conditions ---');
const stops = [];

/**
 * Coverage gate on the gate itself. A rate computed from a handful of claims is
 * not a measurement, and reporting one as if it were is precisely the false
 * precision this project's discipline exists to prevent. If most faults errored,
 * say the gate is UNMEASURED rather than quoting a percentage of a percentage.
 */
const MIN_FAULTS = Math.ceil(rows.length * 0.8);
const MIN_CLAIMS = 20;
const unmeasured = usable.length < MIN_FAULTS || claims < MIN_CLAIMS;
if (unmeasured) {
  console.log(
    `  ⚠  UNMEASURED — ${usable.length}/${rows.length} faults produced results ` +
      `(${claims} claims). Need ≥${MIN_FAULTS} faults and ≥${MIN_CLAIMS} claims.\n` +
      `     The numbers above are NOT the gate's output and must not be recorded as such.`
  );
  if (errored.length) {
    console.log(`     ${errored.length} fault(s) errored: ${[...new Set(errored.map((e) => e.error))].join(', ')}`);
  }
  process.exitCode = 2;
}

if (claims && rate < 0.95) stops.push(`span verification ${pct(verified, claims)} is below ~95% — run this set on Pro BEFORE redesigning. Flash drifting on character-exact copying across 8 chunks is a model-tier decision, not an architecture failure.`);
if (blocked.length) stops.push(`${blocked.length} provider block(s) on legitimate HVAC content — a structural problem with this domain, and a business decision rather than an engineering one.`);
if (fabricated) stops.push(`${fabricated} fabricated chunk id(s) — the envelope is not holding.`);
if (unmeasured) console.log('  not evaluated — the run did not produce enough data to judge.');
else if (!stops.length) console.log('  none triggered.');
for (const s of stops) console.log('  ⛔ ' + s);

mkdirSync('spike/m12/out', { recursive: true });
const stamp = MODEL.replace(/[^a-z0-9.]/gi, '-');
writeFileSync(`spike/m12/out/${stamp}.json`, JSON.stringify({ summary, rows }, null, 2));
console.log(`\nwritten: spike/m12/out/${stamp}.json`);
// Exit non-zero when the gate could not be measured or a stop condition fired, so
// a caller cannot mistake "it ran" for "it passed".
process.exitCode = unmeasured ? 2 : stops.length ? 1 : 0;
