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
const EMBED_BATCH = 96;

/** Voyage list price for the voyage-4 family. Free allowance is 200M tokens. */
const USD_PER_MTOK = 0.18;

export async function ingest({ log = console.log } = {}) {
  const started = Date.now();
  const db = DRY ? null : supabaseAdmin();
  const stats = {
    documents: 0, excluded: 0, chunks: 0,
    inserted: 0, unchanged: 0, deleted: 0, embedded: 0, tokens: 0,
  };

  for (const doc of documents()) {
    const { pages, quality } = parseDocument(doc);
    const d = disposition(quality);
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
    for (let i = 0; i < toInsert.length; i += EMBED_BATCH) {
      const batch = toInsert.slice(i, i + EMBED_BATCH);
      const { embeddings, model, stub, tokens } = await embed(batch.map((c) => c.text), {
        inputType: 'document', // corpus side of the asymmetry — queries use 'query'
      });
      if (stub) throw new Error('refusing to store stub embeddings — set VOYAGE_API_KEY');

      const rows = batch.map((c, j) => ({ ...c, embedding: embeddings[j], embedding_model: model }));
      const { error } = await db.from('chunks').insert(rows);
      if (error) throw new Error(`insert chunks ${doc.file}: ${error.message}`);

      stats.inserted += rows.length;
      stats.embedded += rows.length;
      stats.tokens += tokens;
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
