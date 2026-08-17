/**
 * round4-citation-audit.mjs — ST-R19 AC 2, the half a machine cannot decide.
 *
 *   node --env-file=.env eval/round4-citation-audit.mjs [--limit 1]
 *
 * **This is the only script in the round that spends quota, and it spends it on
 * purpose.** Everything else ST-R19 scores is decided before a provider is
 * reached. AC 2's answer side is not: it requires a generated answer, and then
 * requires somebody to open the page it cites and read whether the page says what
 * the answer says it says.
 *
 * Why it has to regenerate rather than re-score today's runs: ST-R07 and ST-R18
 * both asserted over their responses and then discarded them. `request-log.jsonl`
 * kept the citation *count*; `suggestion-truthfulness.jsonl` kept the count and
 * an in-scope flag. Neither kept a claim or a page, so no support judgment can be
 * made from them at any price. This script persists the whole response, so the
 * next round can re-audit these citations for **zero** quota — the defect it is
 * fixing is that nobody could.
 *
 * The mechanical layer here is `claimNumbersAppearInSnippet` (harness.mjs) and it
 * is deliberately not the verdict. `tests/checkers/citation-check.mjs:295-309`
 * records why: the first real answer this system produced cited a fan-belt
 * tension claim to a loss-of-charge alert table, and the lexical triage scored
 * that mismatch in its most confident band. Numeric containment cannot see a
 * wrong unit ("35 in-lb" cited to a page reading "35 ft-lb") and cannot see a
 * value lifted from the wrong table on the right page. So this prints the claim
 * and the **full stored chunk text** side by side and leaves the verdict to the
 * reader, which is what Stage 5.5 is for.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  arg, post, tally, requireMatchingServer, requireBudget, ledgerDelta,
  citationsWellFormed, claimNumbersAppearInSnippet, ROOT,
} from '../tests/probes/harness.mjs';

const LIMIT = Number(arg('limit', 1));

/**
 * Ordered by how much a mis-citation would cost, not by convenience.
 *
 * P3 first: a gas manifold pressure is the most safety-adjacent number the
 * reference half will ever hand a technician, it is the one probe ST-R07
 * measured as answerable on this unit today (`request-log.jsonl`, dayUsed 6,
 * cites=4, shape=reference), and setting a burner to a wrong figure is a
 * combustion hazard reached entirely through the citation-legal path.
 */
const QUEUE = [
  { id: 'P3', text: 'what is the manifold pressure specification for natural gas', why: 'the most safety-adjacent reference value in the set' },
  { id: 'P4', text: 'what are the MCA and MOCP for this unit', why: 'the electrical-data table' },
  { id: 'R1', text: 'what are the minimum service clearances around this unit', why: 'REFERENCE_ONLY, no procedural twin' },
];

const UNIT = { manufacturer: String(arg('mfr', 'Trane')), model: String(arg('model', 'YSC072E3')) };

const t = tally();
console.log('\nST-R19 AC 2 — citation audit: open the page and read it\n');

await requireMatchingServer(t);
// Worst case per probe is two calls: the answer, plus a clarify continuation.
const before = requireBudget(LIMIT * 2, { label: `${LIMIT} audited answer(s)` });

const { json: resolved } = await post('/resolve-unit', UNIT);
const scope = resolved?.documentIds ?? [];
t.check(`${UNIT.manufacturer} ${UNIT.model} resolves`, scope.length > 0, `${scope.length} document(s)`);

const { supabaseAdmin } = await import('../lib/clients.mjs');
const db = supabaseAdmin();

const audited = [];
for (const probe of QUEUE) {
  if (audited.length >= LIMIT) { t.skip(`${probe.id} ${probe.text.slice(0, 40)}`, 'over --limit for today'); continue; }

  const spentBefore = ledgerDelta(before).after;
  const { json } = await post('/diagnose', {
    symptom: probe.text, equipment: `${UNIT.manufacturer} ${UNIT.model}`, documentIds: scope,
  });
  const spent = ledgerDelta(before).after - spentBefore;
  console.log(`\n  ${probe.id} — "${probe.text}"  [${spent} model call(s)]`);

  if (json?.kind === 'refusal') {
    t.check(`${probe.id}: gate allowed a reference question through`, false, `refused as ${json?.meta?.category}`);
    audited.push({ probe, response: json, verdict: 'REFUSED — gate defect' });
    continue;
  }
  if (json?.meta?.noDocumentation === true) {
    // The floor from ST-R07: an honest withhold is correct behaviour and is a
    // MISS, never a pass — it measures the corpus, not the citation contract.
    t.miss(`${probe.id}`, 'honest withhold — no source in this unit\'s manuals, nothing to audit');
    audited.push({ probe, response: json, verdict: 'MISS — honest withhold' });
    continue;
  }

  const wf = citationsWellFormed(json?.citations);
  t.check(`${probe.id}: citations well-formed`, wf.ok, wf.why);

  // Resolve every cited chunk to the row it claims to be, then print the row.
  const ids = (json?.citations ?? []).map((c) => c.chunk_id).filter(Boolean);
  const { data: rows } = ids.length
    ? await db.from('chunks').select('id, page_number, text, document_id, documents(label)').in('id', ids)
    : { data: [] };
  const byChunk = new Map((rows ?? []).map((r) => [r.id, r]));

  console.log(`\n  ── ${probe.id}: ${(json?.citations ?? []).length} citation(s), read in full ──`);
  for (const c of json?.citations ?? []) {
    const row = byChunk.get(c.chunk_id);
    const num = claimNumbersAppearInSnippet(c);
    console.log(`\n  [${c.ordinal}] CLAIM   : ${c.claim}`);
    console.log(`      CITED AS: ${c.source_document} p${c.page}  (verified:${c.verified})`);
    if (!row) {
      t.check(`${probe.id}#${c.ordinal}: cited chunk exists`, false, `chunk_id ${c.chunk_id} is not in the database`);
      continue;
    }
    t.check(`${probe.id}#${c.ordinal}: cited page matches the stored row`, Number(row.page_number) === Number(c.page),
      `citation says p${c.page}, chunk is on p${row.page_number}`);
    t.check(`${probe.id}#${c.ordinal}: cited document matches the stored row`, row.documents?.label === c.source_document,
      `citation says "${c.source_document}", chunk belongs to "${row.documents?.label}"`);
    t.check(`${probe.id}#${c.ordinal}: cited document is inside the unit's scope`, scope.includes(row.document_id), row.document_id);
    if (num.ok === null) console.log(`      NUMERIC : ${num.why}`);
    else t.check(`${probe.id}#${c.ordinal}: every numeric token appears on the cited page`, num.ok, num.why);
    console.log(`      PAGE TEXT AS STORED (read this against the claim):`);
    console.log(String(row.text).split('\n').map((l) => `        | ${l}`).join('\n'));
  }
  console.log(`\n  ── ${probe.id} BODY AS RENDERED ──`);
  console.log(String(json?.body ?? '').split('\n').map((l) => `      ${l}`).join('\n'));

  audited.push({ probe, response: json, chunks: rows ?? [], verdict: 'AUDITED — support judgment is the reader\'s' });
}

const delta = ledgerDelta(before);
console.log(`\n  model calls this run: ${delta.spent} · ledger ${delta.after}/${delta.budget.limit}, ${delta.budget.remaining} remaining`);

const out = join(ROOT, 'eval/reports/round4-citation-audit.json');
mkdirSync(join(ROOT, 'eval/reports'), { recursive: true });
writeFileSync(out, JSON.stringify({
  format: 'ductective-citation-audit/1',
  story: 'ST-R19 AC 2',
  generatedAt: new Date().toISOString(),
  unit: UNIT,
  scope,
  quotaSpent: delta.spent,
  audited,
}, null, 2));
console.log(`  artifact: ${out} — re-auditable next round at zero quota\n`);

process.exit(t.report('ST-R19 AC 2 — citation audit'));
