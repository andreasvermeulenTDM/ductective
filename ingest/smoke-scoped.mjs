/**
 * smoke-scoped.mjs — ST-03 / R1. Does unit-scoped retrieval actually scope?
 *
 *   npm run ingest:smoke:scoped
 *
 * The unscoped smoke set (smoke.mjs) measures whether retrieval finds the right
 * sections. This measures the new guarantee sql/007 adds: with
 * `filter_document_ids` set, retrieval returns chunks from those documents ONLY
 * — the cross-manufacturer contamination that put 3 Carrier citations on a
 * Trane answer must be structurally impossible, not merely outranked.
 *
 * Three checks per probe, each against BOTH match functions (R1 acceptance 2–4):
 *
 *   single  — filtered to ONE known-right document's id, every returned row
 *             carries that document_id, and more than zero rows come back.
 *   mfr     — filtered to every in-scope document id of the unit's
 *             manufacturer, zero rows from any other manufacturer, and >0 rows.
 *             (ST-03's spot-check: Trane query + Trane ids ⇒ zero Carrier.)
 *   nofilter— `filter_document_ids: null` returns rows and errors nowhere, so
 *             existing callers are provably untouched. (The full no-regression
 *             proof is smoke.mjs re-run after sql/007 is applied.)
 *
 * REQUIRES sql/007_unit_scoped_retrieval.sql applied to the live instance.
 * Until then PostgREST cannot resolve the new signature (PGRST202) and this
 * script reports BLOCKED with exit code 2 — distinct from a real scoping
 * failure, which exits 1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { supabaseAdmin, embed, EMBED_MODEL } from '../lib/clients.mjs';
import { isMain } from './reconcile.mjs';

const SET = 'tests/fixtures/retrieval-smoke-set.json';
const RESULTS = 'tests/fixtures/retrieval-smoke-scoped-results.json';
const TOP_K = 8;

/**
 * The probes are the R01/R05/R11 cross-manufacturer misses ST-03 names as the
 * test material, plus R02 so the Carrier direction is exercised too — scoping
 * that only works for one manufacturer would pass a Trane-only check.
 * `mfr` names the manufacturer whose in-scope documents form the wide filter;
 * it must match `documents.manufacturer` exactly (see lib/units.mjs).
 */
const PROBES = [
  { id: 'R01', mfr: 'Trane' },
  { id: 'R02', mfr: 'Carrier' },
  { id: 'R05', mfr: 'Trane' },
  { id: 'R11', mfr: 'Trane' },
];

/** PostgREST's "no such function" family — the migration hasn't been applied. */
const isMissingFunction = (error) =>
  !!error &&
  (error.code === 'PGRST202' ||
    error.code === 'PGRST203' ||
    /could not (find|choose).*function/i.test(error.message ?? ''));

async function rpc(db, mode, args) {
  const { data, error } =
    mode === 'vector'
      ? await db.rpc('match_chunks', {
          query_embedding: args.embedding,
          match_count: TOP_K,
          scope_only: true,
          filter_document_ids: args.filter,
        })
      : await db.rpc('match_chunks_hybrid', {
          query_embedding: args.embedding,
          query_text: args.query,
          match_count: TOP_K,
          scope_only: true,
          filter_document_ids: args.filter,
        });
  if (error) {
    if (isMissingFunction(error)) {
      const e = new Error(
        `The live ${mode === 'vector' ? 'match_chunks' : 'match_chunks_hybrid'} has no ` +
          `filter_document_ids parameter (${error.code ?? 'no code'}: ${error.message}).\n` +
          `  Run sql/007_unit_scoped_retrieval.sql in the Supabase SQL editor first, then re-run this.`
      );
      e.blocked = true;
      throw e;
    }
    throw new Error(`retrieval (${mode}): ${error.message}`);
  }
  return (data ?? []).map((h) => ({
    document_id: h.out_document_id,
    document: h.out_document,
    page: h.out_page,
    manufacturer: h.out_manufacturer,
  }));
}

export async function runScopedSmoke() {
  const { queries } = JSON.parse(readFileSync(SET, 'utf8'));
  const db = supabaseAdmin();

  // The document ids the filters are built from — resolved live, the same table
  // Backend's /resolve-unit reads, so the ids here are the ids ST-04 will pass.
  const { data: docs, error: docsErr } = await db
    .from('documents')
    .select('id, label, manufacturer, in_scope')
    .eq('in_scope', true);
  if (docsErr) throw new Error(`documents: ${docsErr.message}`);

  const rows = [];

  for (const probe of PROBES) {
    const q = queries.find((x) => x.id === probe.id);
    if (!q) throw new Error(`probe ${probe.id} not in ${SET}`);

    // The known-right document: first in-scope label matching the query's own
    // expectDocs, sorted for determinism. The check is self-consistent — rows
    // must come from the filtered document — so which acceptable document is
    // chosen affects nothing but which one is proven.
    const acceptable = docs
      .filter((d) => q.expectDocs.some((p) => new RegExp(p, 'i').test(d.label)))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!acceptable.length) throw new Error(`probe ${probe.id}: no in-scope document matches expectDocs`);
    const target = acceptable[0];

    const mfrIds = docs.filter((d) => d.manufacturer === probe.mfr).map((d) => d.id);
    if (!mfrIds.length) throw new Error(`probe ${probe.id}: no in-scope ${probe.mfr} documents`);

    // One embed per probe ('query', asymmetric — see smoke.mjs), reused across
    // every check and both functions: 4 Voyage calls for the whole script.
    const { embeddings } = await embed([q.query], { inputType: 'query' });
    const base = { embedding: embeddings[0], query: q.query };

    for (const mode of ['vector', 'hybrid']) {
      const single = await rpc(db, mode, { ...base, filter: [target.id] });
      const mfr = await rpc(db, mode, { ...base, filter: mfrIds });
      const nofilter = await rpc(db, mode, { ...base, filter: null });

      const singleOk = single.length > 0 && single.every((h) => h.document_id === target.id);
      const leaks = mfr.filter((h) => h.manufacturer !== probe.mfr);
      const mfrOk = mfr.length > 0 && leaks.length === 0;
      const nofilterOk = nofilter.length > 0;

      rows.push({
        id: q.id, mode, query: q.query,
        target: { id: target.id, label: target.label },
        mfr: probe.mfr, mfrDocCount: mfrIds.length,
        singleOk, singleRows: single.length,
        mfrOk, mfrRows: mfr.length,
        leaks: leaks.map((h) => `${h.document} p.${h.page} (${h.manufacturer})`),
        nofilterOk,
        returned: { single, mfr: mfr.map((h) => `${h.document} p.${h.page}`) },
      });
    }
  }

  const failures = rows.filter((r) => !(r.singleOk && r.mfrOk && r.nofilterOk));
  return { rows, failures, passes: failures.length === 0 };
}

if (isMain(import.meta.url)) {
  let r;
  try {
    r = await runScopedSmoke();
  } catch (e) {
    if (e.blocked) {
      console.error(`\n  BLOCKED — sql/007 not applied.\n  ${e.message}\n`);
      process.exitCode = 2;
    } else {
      console.error(`\n  ERROR — ${e.message}\n`);
      process.exitCode = 1;
    }
    process.exit();
  }

  console.log(`\nST-03 — unit-scoped retrieval smoke   (${EMBED_MODEL}, top-${TOP_K}, in-scope only)\n`);
  for (const row of r.rows) {
    const mark = row.singleOk && row.mfrOk && row.nofilterOk ? '✓' : '✗';
    console.log(`  ${mark} ${row.id} [${row.mode.padEnd(6)}] single=${row.singleOk} (${row.singleRows} rows from ${row.target.label.slice(0, 36)})`);
    console.log(`      ${row.mfr}-only=${row.mfrOk} (${row.mfrRows} rows, ${row.leaks.length} leaks)  nofilter=${row.nofilterOk}`);
    for (const leak of row.leaks) console.log(`      LEAK: ${leak}`);
  }
  console.log(`\n  ${r.passes ? '✅ scoped retrieval holds' : `❌ ${r.failures.length} scoped check(s) failed`}\n`);

  writeFileSync(
    RESULTS,
    JSON.stringify(
      { model: EMBED_MODEL, at: new Date().toISOString(), passes: r.passes, rows: r.rows },
      null,
      2
    )
  );
  console.log(`  results written: ${RESULTS}\n`);
  process.exitCode = r.passes ? 0 : 1;
}
