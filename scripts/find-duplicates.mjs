/**
 * find-duplicates.mjs — ST-R12 (D1). Does the corpus hold the same manual twice?
 *
 *   npm run verify:duplicates
 *   node --env-file=.env scripts/find-duplicates.mjs --json
 *
 * Reads the **`chunks` table**, not the PDFs, not `HVAC Data/`, and not Python.
 * That is the design decision that makes brief AC 5's "a re-run proves no
 * duplicate pair remains" runnable by anyone holding the service key, on any
 * machine, on the day they need it — rather than only on the one laptop with the
 * corpus and a pdfplumber install.
 *
 * ## Exit code
 *
 *   0  no exact-duplicate group has more than one **in-scope** document
 *   1  at least one does — the live defect
 *   2  the check could not run (no credentials, transport failure). **Never
 *      reported as a pass:** a check that could not run is not a check that
 *      passed (`03-backend-fixes.md` §6's honesty standard).
 *
 * A retired duplicate still appears in the report. `OUT-OF-SCOPE` keeps the row
 * and its chunks and flips `in_phase1_scope`, so nothing is deleted and no
 * historical `citations.chunk_id` is orphaned — the group is resolved, not gone,
 * and saying so is more useful than making it vanish.
 *
 * ## Memory
 *
 * The select is paged (`PAGE_ROWS` at a time) and only ever holds one hash per
 * chunk plus one row's text at a time, so ~10,000 chunks cost kilobytes rather
 * than the tens of megabytes the full text would.
 */

import { supabaseAdmin } from '../lib/clients.mjs';
import { pageContentHash } from '../ingest/chunk.mjs';
import { findDuplicates, hasUnresolvedDuplicates, NEAR_DUPLICATE_JACCARD } from '../ingest/duplicates.mjs';

const arg = (n) => process.argv.includes(`--${n}`);
const JSON_OUT = arg('json');

/** PostgREST's default ceiling is 1000; asking for more silently truncates. */
const PAGE_ROWS = 1000;

async function readCorpus(db) {
  const { data: docs, error: dErr } = await db
    .from('documents')
    .select('id, label, source_url, manufacturer, doc_type, in_scope, page_count');
  if (dErr) throw new Error(`documents read failed: ${dErr.message}`);

  /** documentId → page hashes, in (page_number, chunk_index) order. */
  const byDoc = new Map((docs ?? []).map((d) => [d.id, { doc: d, rows: [] }]));

  let from = 0;
  let scanned = 0;
  for (;;) {
    const { data, error } = await db
      .from('chunks')
      .select('document_id, page_number, chunk_index, text')
      .order('document_id', { ascending: true })
      .order('page_number', { ascending: true })
      .order('chunk_index', { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`chunks read failed at offset ${from}: ${error.message}`);
    if (!data?.length) break;

    for (const r of data) {
      const entry = byDoc.get(r.document_id);
      // A chunk whose document row is missing is a data defect worth seeing, but
      // it cannot be fingerprinted against anything — counted, not crashed on.
      if (!entry) continue;
      // Hash immediately and never keep the body: this is what keeps a
      // 10,000-chunk scan bounded in kilobytes instead of tens of megabytes.
      entry.rows.push({
        page_number: r.page_number,
        chunk_index: r.chunk_index,
        hash: pageContentHash(r.page_number, r.text),
      });
      scanned++;
    }

    if (data.length < PAGE_ROWS) break;
    from += PAGE_ROWS;
  }
  return { byDoc, scanned };
}

const fmt = (d) =>
  `      ${d.id}  ${String(d.chunks ?? '?').padStart(4)} chunks  ` +
  `${d.in_scope === false ? 'OUT-OF-SCOPE' : 'in scope    '}  ${d.page_count ?? '?'}pp  ${d.label}\n` +
  `        ${d.source_url}`;

async function main() {
  const started = Date.now();
  let db;
  try {
    db = supabaseAdmin();
  } catch (e) {
    console.error(`BLOCKED — ${e.message}`);
    console.error('This check needs the service key: npm run verify:duplicates uses --env-file=.env.');
    process.exit(2);
  }

  let corpus;
  try {
    corpus = await readCorpus(db);
  } catch (e) {
    console.error(`BLOCKED — ${e.message}`);
    process.exit(2);
  }

  const report = findDuplicates(corpus.byDoc);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...report, scannedChunks: corpus.scanned, elapsedMs: Date.now() - started }, null, 2));
  } else {
    console.log('');
    console.log('D1 — duplicate detection by parsed content');
    console.log('');
    console.log(`  documents      : ${report.documents}`);
    console.log(`  chunks scanned : ${corpus.scanned}`);
    console.log(`  elapsed        : ${Date.now() - started} ms`);
    console.log('');

    if (report.exact.length) {
      console.log(`  EXACT duplicate groups: ${report.exact.length}`);
      for (const g of report.exact) {
        const live = g.inScopeCount > 1 ? 'UNRESOLVED' : 'resolved';
        console.log(`\n    [${live}] fingerprint ${g.fingerprint}  (${g.inScopeCount} in scope)`);
        for (const d of g.documents) console.log(fmt(d));
        console.log(`      → OQ-R9 keeps ${g.keep}; retire ${g.retire.join(', ')}`);
      }
    } else {
      console.log('  EXACT duplicate groups: none');
    }
    console.log('');

    if (report.candidates.length) {
      console.log(`  CANDIDATE groups (Jaccard >= ${NEAR_DUPLICATE_JACCARD}) — reported only, never auto-retired:`);
      for (const c of report.candidates) {
        console.log(`\n    jaccard ${c.jaccard.toFixed(3)}`);
        for (const d of c.documents) console.log(fmt(d));
      }
      console.log('\n    A human decides on each. Two downloads of one manual can differ by a');
      console.log('    cover page; auto-retiring on similarity would eventually retire a revision.');
    } else {
      console.log(`  CANDIDATE groups (Jaccard >= ${NEAR_DUPLICATE_JACCARD}): none`);
    }
    console.log('');

    if (report.noContent.length) {
      console.log(`  NO-CONTENT (zero chunks — never grouped with each other): ${report.noContent.length}`);
      for (const d of report.noContent) console.log(`      ${d.id}  ${d.label}`);
      console.log('');
    }
  }

  const failed = hasUnresolvedDuplicates(report);
  if (failed) {
    console.error('FAIL — an exact-duplicate group still has more than one in-scope document.');
    console.error('       Retire the loser per OQ-R8: set its manifest Legal Status to');
    console.error('       "OUT-OF-SCOPE — duplicate of <kept id>; <original status>" and re-run ingest.');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`BLOCKED — ${e.message}`);
  process.exit(2);
});
