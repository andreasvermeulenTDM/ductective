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

test('scope: every reconciled document is answerable', () => {
  const withheld = corpus.filter((d) => !d.inScope);
  assert.deepEqual(
    withheld.map((d) => d.file),
    [],
    'a document is in the corpus but withheld from answering — nothing should be, today'
  );
  assert.ok(corpus.length >= 80, `expected the full corpus, got ${corpus.length}`);
});

test('scope: manufacturers are no longer a gate', () => {
  // The exact case the old allowlist got wrong: a technician holding a unit from a
  // manufacturer we carry documentation for, and being told we do not answer on it.
  const makers = new Set(corpus.map((d) => d.manufacturer));
  for (const m of ['Lennox', 'York', 'Bosch', 'Rheem', 'Goodman / Amana', 'Payne']) {
    assert.ok(makers.has(m), `${m} missing from the corpus`);
    assert.ok(
      corpus.filter((d) => d.manufacturer === m).every((d) => d.inScope),
      `${m} documents are in the corpus but not answerable`
    );
  }
  assert.ok(makers.size >= 10, `expected a broad corpus, got ${makers.size} manufacturers`);
});

test('scope: equipment class is no longer a gate', () => {
  // Furnaces, boilers, coils, ductless and air handlers were all excluded by class
  // before this decision. Each is now answerable when we hold its manual.
  const byCoverage = (re) => corpus.filter((d) => re.test(d.coverage));
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
  // Nothing uses it today; if something starts to, that is a deliberate act.
  assert.equal(corpus.filter((d) => !d.inScope).length, 0);
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
