/**
 * reconcile.scope.test.mjs — the answer scope, pinned in CI.
 *
 * **Owner decision, 7 Aug 2026: no manufacturer or equipment limit.** If the corpus
 * holds documentation for a unit, the app answers on it. This file exists to keep
 * that true by accident-proofing it: the previous rule was an allowlist of two
 * manufacturers, and it silently decided what the product could answer. A rule that
 * important should fail loudly when it changes, not shrink coverage unnoticed.
 *
 * What is asserted here is the *scope* half. That a broad corpus does not become a
 * broad claim is asserted where it belongs — `units.test.mjs` for resolution, and
 * `tests/probes/safety-coverage-probes.mjs` over the wire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documents, reconcile, isInScope } from './reconcile.mjs';

const corpus = documents();

/**
 * ST-R13 (D1) — the one document deliberately withheld, and why.
 *
 * `07_Bosch_…Condensing-Unit-IOM.pdf` and
 * `B06_Bosch_IDS-Ultra-Series-Condenser-Installation-Manual.pdf` are the **same
 * manual**: 72 pages and 109 chunks each, and `npm run verify:duplicates` puts
 * them under one content fingerprint (`014ac23c…`, measured 16 Aug 2026 on the
 * live corpus). They arrived in two ZIP sets under two names, and `documentId`
 * hashes the SourceURL, so two names minted two identities. In a broad Bosch
 * retrieval two of the top eight slots were the same text twice — a technician
 * reading eight sources was reading seven.
 *
 * OQ-R9 picks the survivor: neither SourceURL is on the manufacturer's own
 * domain (both are `local:///`), so the tiebreak is the lexicographically smaller
 * documentId — `doc_b835940a1356c074`, the B06 row. Reproducible rather than a
 * preference. **Owner-confirmable** (ST-R13 AC 8); if the owner prefers the IOM
 * row, the change is which of these two cells carries the marker.
 *
 * OQ-R8 picks the mechanism, and the distinction matters: `EXCLUDED` drops the
 * row from `documents()` entirely, so `ingest/run.mjs` never visits it and its
 * **already-stored chunks would stay in the database, answerable**. `OUT-OF-SCOPE`
 * keeps the row visible, so the run visits it and re-syncs every chunk's
 * `in_phase1_scope` to false. Nothing is deleted, and no historical
 * `citations.chunk_id` is orphaned.
 */
const RETIRED_DUPLICATES = new Map([
  ['07_Bosch_Bosch-IDS-Ultra-Series-Condensing-Unit-Installation-Operation-Maintenance.pdf', 'doc_b835940a1356c074'],
]);

test('scope: every reconciled document is answerable, except a named retired duplicate', () => {
  const withheld = corpus.filter((d) => !d.inScope);
  assert.deepEqual(
    withheld.map((d) => d.file).sort(),
    [...RETIRED_DUPLICATES.keys()].sort(),
    'a document is withheld from answering that is not a recorded duplicate — nothing else should be'
  );
  assert.ok(corpus.length >= 80, `expected the full corpus, got ${corpus.length}`);
});

test('scope: the retired duplicate names the document it duplicates, in data', () => {
  // A marker saying only "OUT-OF-SCOPE" would retire the row and lose the reason.
  // The kept id is in the cell, so `verify:duplicates`' report and the manifest
  // agree without anyone holding both in their head.
  for (const [file, keptId] of RETIRED_DUPLICATES) {
    const doc = corpus.find((d) => d.file === file);
    assert.ok(doc, `${file} is no longer in the corpus at all — it should be retired, not removed`);
    assert.equal(doc.inScope, false);
    assert.match(doc.licenseStatus, /^OUT-OF-SCOPE/, 'the marker must be OUT-OF-SCOPE, not EXCLUDED');
    assert.match(doc.licenseStatus, new RegExp(`duplicate of ${keptId}\\b`), 'the marker must name the kept document');
    // The original licence is preserved after the semicolon — retiring a document
    // for duplication must not erase what we know about its provenance.
    assert.match(doc.licenseStatus, /;\s*\S+/, 'the original Legal Status is dropped');

    const kept = corpus.find((d) => d.id === keptId);
    assert.ok(kept, `the kept document ${keptId} is missing from the corpus`);
    assert.equal(kept.inScope, true, 'the surviving copy must still be answerable');
  }
});

test('scope: EXCLUDED would NOT have retired it — the two markers behave differently', () => {
  // §1e, pinned by a test rather than by a comment, because it is the whole
  // mechanism. `EXCLUDED` drops a row from `documents()`; `ingest/run.mjs`
  // iterates `documents()`, so it would never visit the row and would never
  // resync its stored chunks. The document would keep answering.
  const excluded = reconcile().matched.filter((m) => /^\s*EXCLUDED/i.test(m.licenseStatus ?? ''));
  assert.ok(excluded.length > 0, 'no EXCLUDED rows to contrast against');
  const files = new Set(corpus.map((d) => d.file));
  for (const m of excluded) {
    assert.equal(files.has(m.file), false, `${m.file} is EXCLUDED but still enumerated — the contrast no longer holds`);
  }
  // …whereas the retired duplicate IS enumerated, which is what lets the ingest
  // run reach it and flip its chunks.
  for (const file of RETIRED_DUPLICATES.keys()) {
    assert.equal(files.has(file), true, `${file} is not enumerated, so ingest would never resync its chunks`);
  }
});

/**
 * The scope rules below say "no manufacturer and no equipment class is a gate".
 * A retired duplicate is neither — it is a *second copy* of a manual whose first
 * copy is still fully answerable — so it is excluded from those two checks by
 * name rather than by loosening them to `some()`. Loosening them would let a
 * whole manufacturer go dark and still pass.
 */
const answerable = corpus.filter((d) => !RETIRED_DUPLICATES.has(d.file));

test('scope: manufacturers are no longer a gate', () => {
  // The exact case the old allowlist got wrong: a technician holding a unit from a
  // manufacturer we carry documentation for, and being told we do not answer on it.
  const makers = new Set(corpus.map((d) => d.manufacturer));
  for (const m of ['Lennox', 'York', 'Bosch', 'Rheem', 'Goodman / Amana', 'Payne']) {
    assert.ok(makers.has(m), `${m} missing from the corpus`);
    assert.ok(
      answerable.filter((d) => d.manufacturer === m).every((d) => d.inScope),
      `${m} documents are in the corpus but not answerable`
    );
    // And the manufacturer did not go dark because its only copy was retired.
    assert.ok(
      answerable.some((d) => d.manufacturer === m && d.inScope),
      `${m} has no answerable document left`
    );
  }
  assert.ok(makers.size >= 10, `expected a broad corpus, got ${makers.size} manufacturers`);
});

test('scope: equipment class is no longer a gate', () => {
  // Furnaces, boilers, coils, ductless and air handlers were all excluded by class
  // before this decision. Each is now answerable when we hold its manual.
  const byCoverage = (re) => answerable.filter((d) => re.test(d.coverage));
  for (const [label, re] of [
    ['furnace', /furnace/i],
    ['boiler', /boiler/i],
    ['air handler', /air handler/i],
    ['ductless / split', /ductless|split/i],
    ['coil', /coil/i],
    ['chiller', /chiller/i],
  ]) {
    const found = byCoverage(re);
    assert.ok(found.length > 0, `no ${label} documents in the corpus to check`);
    assert.ok(found.every((d) => d.inScope), `${label} documents are not answerable`);
  }
});

test('scope: the OUT-OF-SCOPE marker still works, so the decision is reversible in data', () => {
  assert.equal(isInScope({ licenseStatus: 'Freely published OEM' }), true);
  assert.equal(isInScope({ licenseStatus: 'OUT-OF-SCOPE — deferred to Phase 2' }), false);
  assert.equal(isInScope({}), true, 'a row with no status is answerable by default');
  // ST-R13 is the first deliberate use of it. Every withheld document must be a
  // recorded duplicate — the count is not free to grow for any other reason.
  assert.deepEqual(
    corpus.filter((d) => !d.inScope).map((d) => d.file).sort(),
    [...RETIRED_DUPLICATES.keys()].sort()
  );
});

test('scope: EXCLUDED rows are attributed but never enter the corpus', () => {
  const { matched } = reconcile();
  const excluded = matched.filter((m) => /^\s*EXCLUDED/i.test(m.licenseStatus));
  assert.ok(excluded.length >= 10, `expected the declined documents to still be on record, got ${excluded.length}`);
  const files = new Set(corpus.map((d) => d.file));
  for (const m of excluded) {
    assert.equal(files.has(m.file), false, `${m.file} is EXCLUDED but reached the corpus`);
  }
});

test('scope: reconciliation is clean — every file attributed, every row resolved', () => {
  const { orphanRows, unattributed, files, matched } = reconcile();
  assert.equal(orphanRows.length, 0, 'a manifest row resolved to no file');
  assert.equal(unattributed.length, 0, 'a file on disk has no manifest row and would have no provenance');
  assert.equal(matched.length, files.length);
});
