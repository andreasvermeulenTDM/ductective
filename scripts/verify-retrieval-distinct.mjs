/**
 * verify-retrieval-distinct.mjs — ST-R13 AC 4, made re-runnable.
 *
 *   npm run verify:retrieval-distinct
 *
 * **Zero Gemini quota.** One Voyage query embedding and one RPC; no generation.
 * That matters: this is the check that guards D1, and a guard nobody can afford
 * to run on a spent day is a guard that stops being run.
 *
 * ## What this asserts, and why it is not what AC 4 originally said
 *
 * AC 4 first asked for *"eight distinct `(document_id, page)` pairs"*. On
 * 17 Aug 2026 Stage 5 measured that at **7 of 8** and reported it FAIL — while
 * the property the criterion existed to protect held at **8 of 8 distinct chunk
 * texts**, with the retired duplicate absent entirely. Slots 3 and 6 were two
 * *different* chunks on one page.
 *
 * Chunking is sub-page. `(document_id, page)` was therefore never a distinct key
 * for a chunk, and the criterion was conflating a page with a chunk. The
 * restatement measures the defect in the terms the brief measured it in:
 *
 *   1. **distinct text across the top-K** — the defect was "the same text twice";
 *   2. **no chunk from a retired-as-duplicate document** — the mechanism.
 *
 * Both, because either alone can pass for the wrong reason. Text-distinctness
 * alone would pass if the retirement silently regressed but the two copies
 * happened not to co-occur for this query; the retirement check alone would pass
 * on a corpus that had grown a *third* copy under a different id.
 *
 * The `(document_id, page)` count is still **printed**, because it is a genuine
 * observation about retrieval diversity and losing it would lose the thing that
 * exposed the confusion. It is not asserted — see AC 4's note on why adopting a
 * diversity requirement by accident is the failure mode to avoid.
 *
 * ## The query is pinned on purpose
 *
 * The brief never recorded the query behind its own finding, which is why Stage 5
 * had to caveat its measurement as "one query's result, not the brief's re-run".
 * Pinning it here does not recover the brief's query — nothing can — but it does
 * mean every future run measures the same thing, so a change in the number is a
 * change in the corpus rather than a change in what was asked.
 */

import { retrieve } from '../lib/diagnose.mjs';
import { resolveUnit } from '../lib/units.mjs';
import { supabaseAdmin } from '../lib/clients.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};

/** The brief's case: a *broad* Bosch question, which is what surfaced the pair. */
const QUERY = arg('query', 'condenser unit refrigerant charge and installation clearances');
const UNIT = { manufacturer: arg('mfr', 'Bosch'), model: arg('model', 'IDS Ultra') };
const TOP_K = Number(arg('topk', 8));

const db = supabaseAdmin();
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\nST-R13 AC 4 — the measured defect, measured again\n');
console.log(`  query: "${QUERY}"`);

const verdict = await resolveUnit(UNIT, { db });
console.log(`  unit : ${UNIT.manufacturer} ${UNIT.model} → ${verdict.status}, ${verdict.documentIds.length} document(s)\n`);
if (verdict.status !== 'covered' || !verdict.documentIds.length) {
  console.error('  cannot measure retrieval without a covered unit\n');
  process.exit(1);
}

const { chunks } = await retrieve(QUERY, { topK: TOP_K, db, documentIds: verdict.documentIds });

for (const [i, c] of chunks.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${c.documentId} p${String(c.page).padStart(3)}  ` +
    `sim=${Number(c.similarity).toFixed(3)}  ${String(c.document).slice(0, 44)}`);
}

// --- 1. the defect itself: distinct text -------------------------------------
// Compared on normalised text rather than chunkId: two rows could carry the same
// passage under different ids, which is exactly what a duplicated document is.
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const texts = chunks.map((c) => norm(c.text));
const distinctTexts = new Set(texts).size;
console.log('');
check(`every retrieved chunk carries distinct text`, distinctTexts === chunks.length,
  `${distinctTexts} of ${chunks.length}`);

// --- 2. the mechanism: nothing retired is being read -------------------------
const { data: retired, error } = await db.from('documents').select('id, label').eq('in_scope', false);
if (error) {
  check('retired-document list readable', false, error.message);
} else {
  const retiredIds = new Set((retired ?? []).map((r) => r.id));
  const leaked = chunks.filter((c) => retiredIds.has(c.documentId));
  check(`no retrieved chunk belongs to a retired document (${retiredIds.size} retired)`,
    leaked.length === 0,
    leaked.length ? leaked.map((c) => `${c.documentId} p${c.page}`).join(', ') : 'none');
}

// --- printed, deliberately not asserted --------------------------------------
const slots = new Set(chunks.map((c) => `${c.documentId}:${c.page}`)).size;
const sims = chunks.map((c) => Number(c.similarity));
console.log(`\n  distinct (document_id, page) slots: ${slots} of ${chunks.length}  ` +
  `— printed, NOT asserted (chunking is sub-page; see ST-R13 AC 4)`);
if (sims.length) {
  console.log(`  similarity range: ${Math.min(...sims).toFixed(3)}–${Math.max(...sims).toFixed(3)}` +
    `  — finding 3 territory; §7.8 says this round does not address it`);
}

console.log(`\n${failures === 0 ? 'PASS — the corpus holds the manual once, and retrieval proves it' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
