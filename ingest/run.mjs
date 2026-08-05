/**
 * run.mjs — S18. The one documented command.
 *
 *   npm run ingest              full run
 *   npm run ingest -- --dry     everything except the writes and the embedding spend
 *
 * reconcile → parse → chunk → tag → embed → store, and it reports cost and
 * wall-clock at the end (brief criteria 5 and 8).
 *
 * **Idempotent by construction (S16).** Chunks carry a content hash over
 * `document_id + page + text`. A re-run diffs the corpus against what is stored:
 * unchanged chunks are left alone and are *not* re-embedded, new ones are
 * inserted, and chunks that no longer exist are deleted. Running it twice leaves
 * the same chunk count, which is criterion 5 stated exactly.
 *
 * The alternative — delete-all then insert-all — also gives a stable count while
 * paying to re-embed the entire corpus every run. That is what makes an ingest
 * script something you avoid running, and a corpus you avoid re-ingesting is one
 * that silently drifts from its sources.
 */

import { supabaseAdmin, embed, embedTokensUsed, EMBED_MODEL, usedMocks } from '../lib/clients.mjs';
import { documents, isMain } from './reconcile.mjs';
import { parseDocument, disposition } from './parse.mjs';
import { chunkDocument } from './chunk.mjs';

const DRY = process.argv.includes('--dry');

/**
 * Voyage's limits without a payment method on file: **3 requests/min and 10,000
 * tokens/min**. Measured from the 429 body, not guessed.
 *
 * A 96-chunk batch is roughly 38k tokens and bounces on the first call, so the
 * batch is sized by *tokens* rather than by count, and requests are paced against
 * both ceilings. With a payment method these rise to standard limits and the same
 * code simply runs faster — override with VOYAGE_RPM / VOYAGE_TPM.
 *
 * Pacing lives here rather than in `lib/clients.mjs` for the same reason it lives
 * in the M12 spike rather than the Gemini adapter: ingestion is a batch job where
 * throttling is part of the design, while a production client that silently sleeps
 * through a quota ceiling hides a capacity problem from whoever has to fix it.
 */
const RPM = Number(process.env.VOYAGE_RPM || 3);
const TPM = Number(process.env.VOYAGE_TPM || 10_000);

/**
 * A single request must fit inside the per-minute ceiling with room to spare.
 *
 * The first attempt used 85% of TPM per batch and still 429'd immediately, because
 * the estimate below undercounts: `docs/retrieval-architecture.md` §1 warns that
 * chars÷4 "will run somewhat high in reality — model numbers and table fragments
 * tokenise badly". A batch costed at 8.5k was nearer 15k, over the ceiling before
 * any pacing could help. 35% leaves headroom for an estimate that is wrong by 2x.
 */
const BATCH_TOKEN_BUDGET = Math.floor(TPM * 0.35);

/**
 * Deliberately pessimistic: chars/3, not chars/4.
 *
 * Under-estimating spends real quota and fails the request; over-estimating only
 * costs wall-clock on a job that already runs for hours. The asymmetry is the
 * whole argument.
 */
const estTokens = (s) => Math.ceil(s.length / 3);

/** Rolling-window limiter over both ceilings. */
function makeLimiter() {
  const window = []; // { at, tokens }
  const prune = (now) => {
    while (window.length && now - window[0].at > 60_000) window.shift();
  };
  return async function take(tokens) {
    for (;;) {
      const now = Date.now();
      prune(now);
      const used = window.reduce((n, w) => n + w.tokens, 0);
      if (window.length < RPM && used + tokens <= TPM) {
        window.push({ at: now, tokens });
        return;
      }
      // Wait until the oldest entry falls out of the window.
      const waitMs = Math.max(1000, 60_000 - (now - window[0].at) + 250);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  };
}

/**
 * Voyage accepts at most 128 inputs per request — and a batch is also one
 * Supabase insert, where every row carries a 1024-float vector.
 *
 * On the free tier the token ceiling bound first and this never mattered. Raising
 * VOYAGE_TPM to the paid limit made the token budget 350k, so batches grew to
 * hundreds of chunks and the *insert* payload — not the embedding call — started
 * failing with a bare `fetch failed`. Two ceilings, and whichever is tighter has
 * to win.
 */
const MAX_BATCH_ROWS = 96;

/** Split by whichever ceiling binds first: token budget or row count. */
function tokenBatches(items) {
  const out = [];
  let cur = [];
  let curTokens = 0;
  for (const c of items) {
    const t = estTokens(c.text);
    if (cur.length && (curTokens + t > BATCH_TOKEN_BUDGET || cur.length >= MAX_BATCH_ROWS)) {
      out.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(c);
    curTokens += t;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Supabase writes retry on transport failures.
 *
 * A `TypeError: fetch failed` is a dropped connection, not a rejected write — and
 * an ingest that dies on one costs the whole remaining run. Postgres errors are
 * NOT retried: a constraint violation means the data is wrong, and repeating it
 * just fails more slowly.
 */
async function withRetry(label, fn, attempts = 4) {
  for (let n = 1; ; n++) {
    try {
      const { error } = await fn();
      if (error) throw new Error(`${label}: ${error.message}`);
      return;
    } catch (e) {
      const transport = /fetch failed|ECONN|ETIMEDOUT|socket hang up|network/i.test(e.message);
      if (!transport || n >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 2000 * n));
    }
  }
}

/** Voyage list price for the voyage-4 family. Free allowance is 200M tokens. */
const USD_PER_MTOK = 0.18;

/**
 * Hard spend stop. The run aborts here rather than continuing to bill.
 *
 * Voyage's docs say the first 200M tokens are "free for every account", and the
 * whole corpus is ~1.7M — so this should never fire. But the docs do not say
 * whether adding a payment method changes that, and "it should be free" is a
 * belief, not a control. This is the control.
 *
 * 5M is ~3x the corpus: generous enough that a legitimate re-ingest never trips
 * it, tight enough that a bug looping over the corpus stops in seconds. At full
 * list price 5M tokens is $0.90, so even the abort ceiling is small.
 *
 * Raise with VOYAGE_MAX_TOKENS, deliberately and per-run.
 */
const MAX_EMBED_TOKENS = Number(process.env.VOYAGE_MAX_TOKENS || 5_000_000);

export class SpendCapExceeded extends Error {}

/**
 * Embed a batch, surviving a rate-limit miss.
 *
 * A full ingest is a two-hour job on the free tier. The first attempt died on a
 * single 429 several minutes in, losing the run but — because of the content hash
 * — none of the work already stored. Retrying is what makes the job completable
 * unattended; the hash is what makes retrying cheap.
 *
 * Deliberately narrow: only 429 is retried, and only a few times. Anything else
 * fails immediately, because a run that grinds through real errors produces a
 * half-populated index that looks finished.
 */
async function embedWithRetry(batch, attempts = 5) {
  for (let n = 1; ; n++) {
    try {
      return await embed(batch.map((c) => c.text), { inputType: 'document' });
    } catch (e) {
      const rateLimited = /\b429\b/.test(e.message);
      if (!rateLimited || n >= attempts) throw e;
      // A full window, plus a little — the ceiling is per minute.
      await new Promise((r) => setTimeout(r, 65_000));
    }
  }
}

export async function ingest({ log = console.log } = {}) {
  const started = Date.now();
  const db = DRY ? null : supabaseAdmin();
  const limiter = makeLimiter();
  const stats = {
    documents: 0, excluded: 0, chunks: 0,
    inserted: 0, unchanged: 0, deleted: 0, embedded: 0, tokens: 0,
  };

  for (const doc of documents()) {
    const { pages, quality } = parseDocument(doc);
    const d = disposition(quality, doc);
    stats.documents++;

    if (d.state === 'excluded') {
      stats.excluded++;
      log(`  ✗ ${doc.label.slice(0, 50)} — ${d.reason}`);
      continue;
    }

    const chunks = chunkDocument({ doc, pages });
    stats.chunks += chunks.length;

    if (DRY) {
      log(`  · ${String(chunks.length).padStart(5)} chunks  ${doc.inScope ? 'in ' : 'out'}  ${doc.label.slice(0, 46)}`);
      continue;
    }

    // Upsert the document row first — chunks reference it.
    const { error: dErr } = await db.from('documents').upsert({
      id: doc.id,
      label: doc.label,
      file_name: doc.file,
      manufacturer: doc.manufacturer,
      doc_type: doc.docType,
      coverage: doc.coverage ?? '',
      source_url: doc.sourceUrl,
      license_status: doc.licenseStatus,
      in_scope: doc.inScope,
      page_count: quality.page_count,
      usable_pages: quality.usable_pages,
      two_column_pages: quality.two_column_pages,
      mean_alpha_ratio: quality.mean_alpha_ratio,
      disposition: d.state,
      disposition_reason: d.reason,
    });
    if (dErr) throw new Error(`document upsert ${doc.file}: ${dErr.message}`);

    // What is already stored for this document?
    const { data: existing, error: eErr } = await db
      .from('chunks').select('id, content_hash').eq('document_id', doc.id);
    if (eErr) throw new Error(`read chunks ${doc.file}: ${eErr.message}`);

    const have = new Map((existing ?? []).map((r) => [r.content_hash, r.id]));
    const want = new Map(chunks.map((c) => [c.content_hash, c]));

    const toInsert = chunks.filter((c) => !have.has(c.content_hash));
    const staleIds = (existing ?? []).filter((r) => !want.has(r.content_hash)).map((r) => r.id);

    stats.unchanged += chunks.length - toInsert.length;

    if (staleIds.length) {
      const { error } = await db.from('chunks').delete().in('id', staleIds);
      if (error) throw new Error(`delete stale ${doc.file}: ${error.message}`);
      stats.deleted += staleIds.length;
    }

    // Embed only what is genuinely new. This is the whole point of the hash.
    for (const batch of tokenBatches(toInsert)) {
      await limiter(batch.reduce((n, c) => n + estTokens(c.text), 0));
      const { embeddings, model, stub, tokens } = await embedWithRetry(batch);
      if (stub) throw new Error('refusing to store stub embeddings — set VOYAGE_API_KEY');

      const rows = batch.map((c, j) => ({ ...c, embedding: embeddings[j], embedding_model: model }));
      await withRetry(`insert chunks ${doc.file}`, () => db.from('chunks').insert(rows));

      stats.inserted += rows.length;
      stats.embedded += rows.length;
      stats.tokens += tokens;

      // Checked after each batch, not at the end — a cap you discover having
      // exceeded is a report, not a cap.
      if (stats.tokens > MAX_EMBED_TOKENS) {
        throw new SpendCapExceeded(
          `Stopped at ${stats.tokens.toLocaleString()} tokens, over the ` +
            `${MAX_EMBED_TOKENS.toLocaleString()} cap (~$${((stats.tokens / 1e6) * USD_PER_MTOK).toFixed(2)} ` +
            `at list price). Everything embedded so far is stored and will not be ` +
            `re-embedded. Raise VOYAGE_MAX_TOKENS only if this is expected.`
        );
      }
    }

    log(
      `  ${d.state === 'ingest' ? ' ' : '!'} ${String(chunks.length).padStart(5)} chunks  ` +
        `+${String(toInsert.length).padStart(5)} new  -${String(staleIds.length).padStart(4)}  ` +
        `${doc.inScope ? 'in ' : 'out'}  ${doc.label.slice(0, 44)}`
    );
  }

  stats.seconds = (Date.now() - started) / 1000;
  stats.tokens = stats.tokens || embedTokensUsed();
  stats.costUsd = (stats.tokens / 1_000_000) * USD_PER_MTOK;
  return stats;
}

if (isMain(import.meta.url)) {
  const s = await ingest();
  console.log(`\n${DRY ? 'DRY RUN — nothing written, nothing embedded' : 'Ingestion complete'}\n`);
  console.log(`  documents        : ${s.documents}  (${s.excluded} excluded)`);
  console.log(`  chunks in corpus : ${s.chunks}`);
  if (!DRY) {
    console.log(`  inserted         : ${s.inserted}`);
    console.log(`  unchanged        : ${s.unchanged}   ← not re-embedded, and not paid for again`);
    console.log(`  deleted (stale)  : ${s.deleted}`);
    console.log(`\n  embedding model  : ${EMBED_MODEL}`);
    console.log(`  tokens billed    : ${s.tokens.toLocaleString()}`);
    console.log(`  cost this run    : $${s.costUsd.toFixed(4)}   (list price; inside Voyage's 200M free allowance)`);
    const stubs = usedMocks();
    if (stubs.length) console.log(`\n  ⚠  STUBS USED: ${stubs.join(', ')} — this run's vectors are not real.`);
  }
  console.log(`  wall clock       : ${s.seconds.toFixed(1)}s\n`);
}
