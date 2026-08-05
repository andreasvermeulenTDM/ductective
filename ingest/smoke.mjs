/**
 * smoke.mjs — S17 / brief criterion 7. Does retrieval return the right sections?
 *
 *   npm run ingest:smoke
 *
 * The knowledge artifact's most important section. Retrieval that returns
 * plausible-looking *wrong* sections is the failure mode that survives every other
 * check in this pipeline: the chunk has a real document name and a real page
 * number, the citation renders, the answer reads well, and it is wrong.
 *
 * So this reports, per query, the documents and pages actually returned — not a
 * pass rate alone. A score with no per-query detail cannot be argued with.
 */

import { readFileSync } from 'node:fs';
import { supabaseAdmin, embed, EMBED_MODEL } from '../lib/clients.mjs';
import { isMain } from './reconcile.mjs';

const SET = 'tests/fixtures/retrieval-smoke-set.json';
const TOP_K = 8;

const norm = (s) => (s ?? '').toLowerCase();

export async function runSmokeSet({ topK = TOP_K, mode = 'hybrid' } = {}) {
  const { bar, queries } = JSON.parse(readFileSync(SET, 'utf8'));
  const db = supabaseAdmin();
  const rows = [];

  for (const q of queries) {
    // 'query', not 'document'. Voyage embeds asymmetrically and mismatching the
    // two costs recall silently — no error, just worse results.
    const { embeddings } = await embed([q.query], { inputType: 'query' });

    // Vector-only is kept callable so the fusion can be measured against it
    // rather than assumed to help. A change to retrieval that nobody compared is
    // a change nobody can defend.
    const { data, error } =
      mode === 'vector'
        ? await db.rpc('match_chunks', {
            query_embedding: embeddings[0],
            match_count: topK,
            scope_only: true,
          })
        : await db.rpc('match_chunks_hybrid', {
            query_embedding: embeddings[0],
            query_text: q.query,
            match_count: topK,
            scope_only: true,
          });
    if (error) throw new Error(`retrieval (${q.id}, ${mode}): ${error.message}`);

    // match_chunks prefixes its OUT columns (`out_*`) to avoid RETURNS TABLE name
    // collisions in Postgres. Normalised here so nothing above this line has to
    // know about that — the retrieval contract Stage 3 consumes is the shape below.
    const hits = (data ?? []).map((h) => ({
      chunk_id: h.chunk_id,
      document_id: h.out_document_id,
      document: h.out_document,
      page: h.out_page,
      text: h.out_text,
      manufacturer: h.out_manufacturer,
      doc_type: h.out_doc_type,
      coverage: h.out_coverage,
      license_status: h.out_license,
      in_scope: h.out_in_scope,
      similarity: h.out_similarity,
    }));
    const top = hits[0];

    // Correct document: any expectDocs pattern matches the top hit's label.
    const docOk = !!top && q.expectDocs.some((p) => new RegExp(p, 'i').test(top.document));

    // Correct page: the returned chunk actually contains the expected terms. A
    // chunk from the right manual but the wrong page will not.
    const text = norm(top?.text);
    const termsFound = q.expectTerms.filter((t) => text.includes(norm(t)));
    const pageOk = docOk && termsFound.length > 0;

    // Where in the top-k the first acceptable document appears. rank 1 is what
    // the bar measures, but a right answer at rank 3 is a different problem from
    // no right answer at all, and the fix differs.
    const rankOfFirstGood =
      hits.findIndex((h) => q.expectDocs.some((p) => new RegExp(p, 'i').test(h.document))) + 1;

    rows.push({
      id: q.id, fault: q.fault, query: q.query,
      topDocument: top?.document ?? '(nothing returned)',
      topPage: top?.page ?? null,
      similarity: top ? Number(top.similarity.toFixed(3)) : null,
      docOk, pageOk,
      termsFound,
      rankOfFirstGood: rankOfFirstGood || null,
      alternatives: hits.slice(1, 4).map((h) => `${h.document} p.${h.page}`),
    });
  }

  const correctDocs = rows.filter((r) => r.docOk).length;
  const correctPages = rows.filter((r) => r.pageOk).length;
  return {
    bar, rows,
    total: rows.length,
    correctDocs,
    correctPages,
    // Judged against the brief's bar, not against the number of queries authored:
    // adding queries must not be able to lower the bar.
    passes: correctDocs >= bar.minCorrectDocs && correctPages >= bar.minCorrectDocs,
  };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--mode');
  const mode = i > -1 ? process.argv[i + 1] : 'hybrid';
  const r = await runSmokeSet({ mode });
  console.log(`\nS17 — retrieval smoke set   (${EMBED_MODEL}, ${mode}, top-${TOP_K}, in-scope only)\n`);
  for (const row of r.rows) {
    const mark = row.docOk ? (row.pageOk ? '✓' : '~') : '✗';
    console.log(`  ${mark} ${row.id}  ${row.topDocument.slice(0, 44).padEnd(44)} p.${String(row.topPage ?? '-').padEnd(4)} sim=${row.similarity ?? '-'}`);
    console.log(`      ${row.query.slice(0, 88)}`);
    if (!row.docOk && row.rankOfFirstGood) console.log(`      first acceptable document at rank ${row.rankOfFirstGood}`);
    if (row.docOk && !row.pageOk) console.log(`      right document, but none of [${row.termsFound.length ? row.termsFound : 'expected terms'}] on this page`);
  }
  console.log(`\n  correct document : ${r.correctDocs}/${r.total}   (bar: ${r.bar.minCorrectDocs} of 12)`);
  console.log(`  correct page     : ${r.correctPages}/${r.total}`);
  console.log(`\n  ${r.passes ? '✅ criterion 7 met' : '❌ criterion 7 NOT met'}\n`);
  process.exitCode = r.passes ? 0 : 1;
}
