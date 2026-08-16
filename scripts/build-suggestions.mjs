/**
 * build-suggestions.mjs — ST-R15 (N4). Mine, validate, store.
 *
 *   npm run suggestions:build -- --dry          mine and report; no embedding, no writes
 *   npm run suggestions:build -- --no-write     mine and VALIDATE; report; no writes
 *   npm run suggestions:build                   mine, validate, upsert
 *   npm run suggestions:build -- --only doc_xxx one document
 *   npm run suggestions:build -- --limit-docs 5 the first five documents
 *
 * `--no-write` is the one to run **before** `sql/018` is applied: it costs the
 * same embedding as a real run and prints the self-retrieval percentiles that
 * set the floor, so the measurement exists before the table does.
 *
 * ## The validation, and why it is rank-1 self-retrieval
 *
 * A candidate question is embedded and run through **the same `match_chunks`
 * retrieval that will answer it**, scoped to its own document. It is kept only if
 * the chunk it was mined from comes back at **rank 1**. Anything else is a
 * phrasing that does not retrieve, and a suggestion that does not retrieve is a
 * suggestion that returns no-documentation when tapped — which is the whole
 * defect this round exists to fix.
 *
 * This mirrors `suggestUnits`' construction exactly (`lib/units.mjs`): propose a
 * candidate, put it back through the function that will later judge it for real,
 * and drop it unless the verdict holds.
 *
 * **Rank-1 rather than a similarity floor** is the primary gate because the brief
 * measured ~0.62 similarity on the Bosch corpus at both scope widths. An absolute
 * floor near that number would either wipe that corpus out or admit everything
 * depending which side of it was picked, and it would be a different number per
 * corpus. "The question retrieves back to the paragraph it was written from,
 * ahead of everything else in the document" is scale-free, is the property we
 * actually want, and is a stronger claim than a threshold. The floor below is a
 * secondary guard only.
 *
 * ## Cost
 *
 * **Zero Gemini quota.** Embedding (Voyage) and one RPC per candidate; no
 * `completeFn` anywhere in this file. That asymmetry is the design: generation is
 * 20 requests/day on the free tier and cannot pay for corpus-scale validation,
 * while embedding is not on that tier at all.
 */

import { supabaseAdmin, embed } from '../lib/clients.mjs';
import { mineDocument } from '../ingest/suggestions.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : d;
};
const DRY = process.argv.includes('--dry');
const NO_WRITE = process.argv.includes('--no-write');
const ONLY = arg('only', null);
const LIMIT_DOCS = Number(arg('limit-docs', 0)) || 0;

/**
 * OQ-R5 — the secondary similarity floor. **0.45.**
 *
 * ## The measurement that set it
 *
 * `npm run suggestions:build -- --no-write --limit-docs 12`, run against the live
 * corpus on **16 Aug 2026**:
 *
 *     documents sampled     12  (5 of them Bosch)
 *     candidates mined      475
 *     passed rank-1         182
 *     rejected by this floor 54   (30% of the rank-1 set)
 *     kept                  128
 *     self-retrieval similarity of the kept set: p10 0.465, p50 0.575, p90 0.647
 *
 * **One circularity, stated rather than hidden:** the p10 above is measured over
 * candidates that already survived this floor, so it cannot by itself justify
 * the floor's position. What it does establish is that 0.45 sits just under the
 * bottom decile of what survives — close enough to be doing real work (it
 * rejects 30% of rank-1 candidates) without cutting into the body of the
 * distribution. OQ-R5 caps the floor at 0.55 whatever a measurement says, and
 * the p50 of 0.575 shows why that cap matters: on this corpus a 0.55 floor would
 * discard nearly half of everything that retrieves correctly.
 *
 * ## Why rank-1 is the real gate and this is secondary
 *
 * The brief measured ~0.62 similarity on the Bosch corpus at both scope widths.
 * An absolute floor near that number would either wipe that corpus out or admit
 * everything depending which side of it was picked, and it would be a different
 * number per corpus. `--no-write` prints these percentiles on any corpus.
 *
 * A number with no measurement beside it is a guess with a decimal point. If this
 * is changed, re-measure and rewrite this block in the same commit.
 */
export const SIMILARITY_FLOOR = 0.45;

/** PostgREST's default page ceiling. Asking for more silently truncates. */
const PAGE_ROWS = 1000;

async function readChunks(db, documentId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await db
      .from('chunks')
      .select('id, document_id, page_number, chunk_index, text')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true })
      .order('chunk_index', { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`chunks read failed for ${documentId}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data.map((r) => ({ ...r, chunk_id: r.id })));
    if (data.length < PAGE_ROWS) break;
  }
  return rows;
}

/**
 * Voyage's free tier without a payment method: **3 requests/min**. Measured from
 * the 429 body by `ingest/run.mjs`, not guessed.
 *
 * One embed request per candidate would make a corpus-scale run impossible — the
 * live corpus mines 3,412 candidates, which is nineteen hours at three a minute.
 * Batching is what makes this a job the owner can actually run: a candidate
 * question is ~12 tokens, so 64 of them is ~800 tokens, comfortably inside the
 * 10,000 tokens/min ceiling, and 3,412 candidates becomes ~54 requests — under
 * twenty minutes for the whole corpus.
 *
 * The RPC half is Supabase and is not on this budget, so it stays per-candidate.
 */
const EMBED_BATCH = 64;
const EMBED_RPM = Number(process.env.VOYAGE_RPM || 3);

let lastEmbedAt = 0;
async function pacedEmbed(texts, embedFn) {
  const minGapMs = Math.ceil(60_000 / Math.max(1, EMBED_RPM));
  const wait = lastEmbedAt + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastEmbedAt = Date.now();
  return embedFn(texts, { inputType: 'query' });
}

/**
 * Does each question retrieve back to the chunk it was mined from, at rank 1?
 *
 * `match_count: 5` rather than 1 so a near miss is *reported as a rank* — "this
 * phrasing came back third" is a usable measurement, "it failed" is not.
 *
 * @returns {Promise<Array<{candidate: object, kept: boolean, reason: string,
 *                          similarity: number, rank: number}>>}
 */
async function validateBatch(candidates, db, embedFn) {
  const { embeddings } = await pacedEmbed(candidates.map((c) => c.text), embedFn);
  const out = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const { data, error } = await db.rpc('match_chunks', {
      query_embedding: embeddings[i],
      match_count: 5,
      filter_document_ids: [candidate.documentId],
    });
    if (error) { out.push({ candidate, kept: false, reason: `rpc:${error.message}`, similarity: 0, rank: 0 }); continue; }

    const rows = data ?? [];
    const rank = rows.findIndex((r) => r.chunk_id === candidate.chunkId) + 1;
    const similarity = rows[0]?.out_similarity ?? 0;

    if (rank !== 1) {
      out.push({ candidate, kept: false, reason: rank === 0 ? 'not-retrieved' : `rank-${rank}`, similarity, rank });
    } else if (similarity < SIMILARITY_FLOOR) {
      out.push({ candidate, kept: false, reason: 'below-floor', similarity, rank });
    } else {
      out.push({ candidate, kept: true, reason: 'kept', similarity, rank });
    }
  }
  return out;
}

async function main() {
  let db;
  try { db = supabaseAdmin(); } catch (e) {
    console.error(`BLOCKED — ${e.message}`);
    console.error('This build needs the service key: npm run suggestions:build uses --env-file=.env.');
    process.exit(2);
  }

  const { data: docs, error } = await db
    .from('documents')
    .select('id, label, manufacturer, doc_type, in_scope')
    .eq('in_scope', true)
    .order('id');
  if (error) { console.error(`BLOCKED — documents read failed: ${error.message}`); process.exit(2); }

  let corpus = (docs ?? []).filter((d) => !ONLY || d.id === ONLY);
  if (LIMIT_DOCS) corpus = corpus.slice(0, LIMIT_DOCS);

  console.log('');
  console.log(
    'N4 — suggestion build' +
    (DRY ? ' (dry: mine and report; no embedding, no writes)' : NO_WRITE ? ' (validate and report; no writes)' : '')
  );
  console.log(`  in-scope documents: ${corpus.length}`);
  console.log('');

  const totals = { mined: 0, dropped: {}, kept: 0, written: 0 };
  const similarities = [];
  const perDocument = [];

  for (const doc of corpus) {
    const chunks = await readChunks(db, doc.id);
    const drops = {};
    const candidates = mineDocument(chunks, {
      onDrop: (reason) => { drops[reason] = (drops[reason] ?? 0) + 1; },
    });
    totals.mined += candidates.length;
    for (const [k, v] of Object.entries(drops)) totals.dropped[k] = (totals.dropped[k] ?? 0) + v;

    const kept = [];
    if (!DRY) {
      for (let i = 0; i < candidates.length; i += EMBED_BATCH) {
        const verdicts = await validateBatch(candidates.slice(i, i + EMBED_BATCH), db, embed);
        for (const v of verdicts) {
          if (v.kept) { kept.push({ ...v.candidate, similarity: v.similarity }); similarities.push(v.similarity); }
          else totals.dropped[v.reason] = (totals.dropped[v.reason] ?? 0) + 1;
        }
      }

      if (kept.length && !NO_WRITE) {
        /*
         * Idempotent and resumable. The upsert conflicts on
         * (document_id, text) and only writes rows that changed, so a re-run
         * over an unchanged corpus leaves `validated_at` alone — asserted by
         * running twice and comparing.
         */
        const { error: upErr } = await db.from('document_suggestions').upsert(
          kept.map((c) => ({
            document_id: c.documentId,
            chunk_id: c.chunkId,
            page_number: c.page,
            text: c.text,
            topic: c.topic,
            category: c.category,
            similarity: c.similarity,
            retrieval_rank: 1,
          })),
          { onConflict: 'document_id,text', ignoreDuplicates: false }
        );
        if (upErr) {
          console.error(`  ! ${doc.id}: ${upErr.message}`);
          if (/document_suggestions/.test(upErr.message)) {
            console.error('    sql/018 is not applied. Everything degrades to the empty state until it is.');
            process.exit(2);
          }
        } else {
          totals.written += kept.length;
        }
      }
    }

    totals.kept += kept.length;
    const byCategory = {};
    for (const c of (DRY ? candidates : kept)) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    perDocument.push({ id: doc.id, label: doc.label, manufacturer: doc.manufacturer, chunks: chunks.length, candidates: candidates.length, kept: kept.length, byCategory });

    console.log(
      `  ${String(candidates.length).padStart(4)} mined  ${String(kept.length).padStart(4)} kept  ` +
      `${doc.id}  ${doc.label.slice(0, 46)}`
    );
  }

  console.log('');
  console.log(`  candidates mined : ${totals.mined}`);
  console.log(`  kept             : ${totals.kept}`);
  console.log(`  written          : ${totals.written}`);
  console.log('  dropped:');
  for (const [reason, n] of Object.entries(totals.dropped).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }

  if (similarities.length) {
    const sorted = [...similarities].sort((a, b) => a - b);
    const p = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1))];
    console.log('');
    console.log(`  self-retrieval similarity over ${sorted.length} kept candidates:`);
    console.log(`    p10 ${p(10).toFixed(3)}   p50 ${p(50).toFixed(3)}   p90 ${p(90).toFixed(3)}`);
    console.log(`    floor in force: ${SIMILARITY_FLOOR} (OQ-R5 — re-measure and rewrite the comment if this is changed)`);
  }

  /*
   * ST-R15 AC 9 / ST-R14 AC 8 — the Bosch line, by name.
   *
   * §2.3's honest expectation was that reference-category mining *should*
   * produce some suggestions on an installation corpus rather than zero. That
   * has to be measured rather than assumed, so the scope from the 16 Aug session
   * gets its own line in every report.
   */
  const bosch = perDocument.filter((d) => /bosch/i.test(d.manufacturer ?? ''));
  if (bosch.length) {
    const mix = {};
    for (const d of bosch) for (const [k, v] of Object.entries(d.byCategory)) mix[k] = (mix[k] ?? 0) + v;
    console.log('');
    console.log(`  THE BOSCH SCOPE (${bosch.length} documents) — the unit from the 16 Aug session:`);
    console.log(`    candidates ${bosch.reduce((a, d) => a + d.candidates, 0)}, kept ${bosch.reduce((a, d) => a + d.kept, 0)}`);
    console.log(`    category mix: ${Object.entries(mix).map(([k, v]) => `${k}=${v}`).join(', ') || '(none — the empty state is what ships)'}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(`BLOCKED — ${e.message}`);
  process.exit(2);
});
