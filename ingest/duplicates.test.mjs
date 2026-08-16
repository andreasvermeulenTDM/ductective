/**
 * duplicates.test.mjs — ST-R12 (D1), without a database.
 *
 *   npm test
 *
 * The hashing and grouping rules are pure, so they are tested against fixtures
 * here; the live corpus half is `npm run verify:duplicates`, which is a **check**
 * (it needs the service key) and is reported as BLOCKED when it cannot run
 * rather than counted as a pass.
 *
 * The load-bearing assertion is the first one: `contentHash` must be
 * byte-unchanged. It keys 3,787 stored rows, and re-keying it would make every
 * chunk look new and re-embed the entire corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, pageContentHash, documentFingerprint } from './chunk.mjs';
import {
  fingerprintDocument, jaccard, chooseSurvivor, findDuplicates,
  hasUnresolvedDuplicates, NEAR_DUPLICATE_JACCARD,
} from './duplicates.mjs';

// --- AC 1: the existing hash did not move ------------------------------------

test('contentHash is byte-unchanged — 3,787 stored hashes depend on it', () => {
  // Pinned to a literal, not recomputed from the implementation. A test that
  // recomputes the value it is checking proves only that the code ran.
  // Value taken from `git show HEAD:ingest/chunk.mjs` before this story touched
  // the file, so it is the pre-change hash and not a recomputation.
  assert.equal(contentHash('doc_d409dfbd55519a2e', 69, 'the quick brown fox'), '512b74f5d30b478283cc644c244b7a18');
  assert.equal(contentHash('doc_x', 1, ''), contentHash('doc_x', 1, ''));
  assert.notEqual(contentHash('doc_a', 1, 'same'), contentHash('doc_b', 1, 'same'), 'documentId is still in it');
});

test('pageContentHash has no document identity in it — the whole point of D1', () => {
  // The Bosch case, in miniature: one paragraph, two documents, one hash.
  const text = 'Refer to Table 12 for minimum service clearances.';
  assert.equal(pageContentHash(69, text), pageContentHash(69, text));
  // …whereas the existing hash disagrees for the same text, which is why nothing
  // in the tree could see the duplicate.
  assert.notEqual(
    contentHash('doc_d409dfbd55519a2e', 69, text),
    contentHash('doc_b835940a1356c074', 69, text)
  );
});

test('pageContentHash separates the page from the text', () => {
  // A NUL separator, as contentHash uses, so page 1 + "23 psi" cannot collide
  // with page 12 + "3 psi".
  assert.notEqual(pageContentHash(1, '23 psi'), pageContentHash(12, '3 psi'));
  assert.notEqual(pageContentHash(1, 'a'), pageContentHash(2, 'a'));
  assert.equal(pageContentHash(3, undefined), pageContentHash(3, ''));
});

// --- AC 2: the fingerprint ---------------------------------------------------

test('two documents with identical parsed text produce the identical fingerprint', () => {
  const pages = [[1, 'alpha'], [2, 'beta'], [3, 'gamma']];
  const a = documentFingerprint(pages.map(([p, t]) => pageContentHash(p, t)));
  const b = documentFingerprint(pages.map(([p, t]) => pageContentHash(p, t)));
  assert.equal(a, b);
  assert.equal(a.length, 32);
});

test('order is part of the identity — the same pages shuffled are a different document', () => {
  const h = [pageContentHash(1, 'alpha'), pageContentHash(2, 'beta')];
  assert.notEqual(documentFingerprint(h), documentFingerprint([...h].reverse()));
});

test('a document with no chunks fingerprints as empty, never as a value', () => {
  assert.equal(documentFingerprint([]), '');
  assert.equal(documentFingerprint(undefined), '');
  assert.equal(fingerprintDocument([]).fingerprint, '');
});

test('fingerprintDocument sorts by (page_number, chunk_index) rather than trusting arrival order', () => {
  const rows = [
    { page_number: 2, chunk_index: 0, text: 'b' },
    { page_number: 1, chunk_index: 1, text: 'a2' },
    { page_number: 1, chunk_index: 0, text: 'a1' },
  ];
  const shuffled = [rows[2], rows[0], rows[1]];
  assert.equal(fingerprintDocument(rows).fingerprint, fingerprintDocument(shuffled).fingerprint);
  assert.equal(fingerprintDocument(rows).chunks, 3);
});

test('a precomputed hash is accepted, so the live scan can drop the text as it reads', () => {
  const rows = [{ page_number: 1, chunk_index: 0, text: 'alpha' }];
  const pre = [{ page_number: 1, chunk_index: 0, hash: pageContentHash(1, 'alpha') }];
  assert.equal(fingerprintDocument(rows).fingerprint, fingerprintDocument(pre).fingerprint);
});

// --- jaccard -----------------------------------------------------------------

test('jaccard is share-of-union, and two empty documents are not similar', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard([], []), 0, 'two failed parses are not a match');
  assert.equal(jaccard(['a'], []), 0);
});

// --- AC 4 / OQ-R9: which one survives ----------------------------------------

test('chooseSurvivor prefers the manufacturer\'s own domain', () => {
  const oem = { id: 'doc_zzz', manufacturer: 'Bosch', source_url: 'https://www.bosch-homecomfort.com/x.pdf' };
  const local = { id: 'doc_aaa', manufacturer: 'Bosch', source_url: 'local:///07_Bosch_x.pdf' };
  assert.equal(chooseSurvivor([local, oem]).id, 'doc_zzz');
  assert.equal(chooseSurvivor([oem, local]).id, 'doc_zzz', 'and the order it is handed them does not matter');
});

test('chooseSurvivor falls back to the lexicographically smaller id, reproducibly', () => {
  // Both `local:///`, which is the real Bosch case. Arbitrary on purpose: the
  // choice has to be the same on every machine and stable across re-runs.
  const a = { id: 'doc_b835940a1356c074', manufacturer: 'Bosch', source_url: 'local:///B06_x.pdf' };
  const b = { id: 'doc_d409dfbd55519a2e', manufacturer: 'Bosch', source_url: 'local:///07_x.pdf' };
  assert.equal(chooseSurvivor([a, b]).id, 'doc_b835940a1356c074');
  assert.equal(chooseSurvivor([b, a]).id, 'doc_b835940a1356c074');
});

// --- AC 3 / AC 5 / AC 9: the report ------------------------------------------

/** Two identical manuals under two identities, plus one distinct one. */
const CORPUS = () => {
  const shared = [
    { page_number: 1, chunk_index: 0, text: 'Bosch IDS Ultra installation manual.' },
    { page_number: 69, chunk_index: 0, text: 'Minimum service clearances are listed in Table 12.' },
  ];
  return [
    { doc: { id: 'doc_b835940a1356c074', label: 'Bosch_IDS-Ultra-Condenser-Install', source_url: 'local:///B06.pdf', manufacturer: 'Bosch', in_scope: true, page_count: 72 }, rows: shared.map((r) => ({ ...r })) },
    { doc: { id: 'doc_d409dfbd55519a2e', label: 'Bosch_IDS-Ultra-Condensing-Unit-IOM', source_url: 'local:///07.pdf', manufacturer: 'Bosch', in_scope: true, page_count: 72 }, rows: shared.map((r) => ({ ...r })) },
    { doc: { id: 'doc_other', label: 'Bosch_Gateway-Troubleshooting', source_url: 'local:///B24.pdf', manufacturer: 'Bosch', in_scope: true, page_count: 20 }, rows: [{ page_number: 1, chunk_index: 0, text: 'Gateway troubleshooting guide.' }] },
  ];
};

test('the duplicate pair is found by content and the loser named', () => {
  const r = findDuplicates(CORPUS());
  assert.equal(r.exact.length, 1);
  const g = r.exact[0];
  assert.deepEqual(g.documents.map((d) => d.id), ['doc_b835940a1356c074', 'doc_d409dfbd55519a2e']);
  assert.equal(g.keep, 'doc_b835940a1356c074');
  assert.deepEqual(g.retire, ['doc_d409dfbd55519a2e']);
  assert.equal(g.inScopeCount, 2);
  assert.equal(g.documents[0].chunks, 2, 'the chunk count is reported per document');
});

test('the report is deterministic — the same corpus gives the same report', () => {
  const a = JSON.stringify(findDuplicates(CORPUS()));
  const shuffled = CORPUS();
  const b = JSON.stringify(findDuplicates([shuffled[2], shuffled[1], shuffled[0]]));
  assert.equal(a, b);
});

test('AC 5: unresolved while both are in scope, resolved once the loser is out', () => {
  const before = findDuplicates(CORPUS());
  assert.equal(hasUnresolvedDuplicates(before), true, 'this is the exit-code-1 state');

  // OQ-R8's resolution: the loser's manifest row goes OUT-OF-SCOPE, which
  // propagates to `documents.in_scope` and every chunk's `in_phase1_scope`.
  // Nothing is deleted, so the group is still reported — and no longer fails.
  const retired = CORPUS();
  retired[1].doc.in_scope = false;
  const after = findDuplicates(retired);
  assert.equal(after.exact.length, 1, 'the group is still visible, which is honest');
  assert.equal(after.exact[0].inScopeCount, 1);
  assert.equal(hasUnresolvedDuplicates(after), false, 'this is the exit-code-0 state');
});

test('AC 9: two documents with zero chunks are NO-CONTENT, never duplicates of each other', () => {
  const r = findDuplicates([
    { doc: { id: 'doc_empty1', label: 'scan with no text layer', in_scope: true }, rows: [] },
    { doc: { id: 'doc_empty2', label: 'excluded at parse', in_scope: true }, rows: [] },
  ]);
  assert.equal(r.exact.length, 0, 'two failed parses are not the same manual');
  assert.deepEqual(r.noContent.map((d) => d.id), ['doc_empty1', 'doc_empty2']);
  assert.equal(hasUnresolvedDuplicates(r), false);
});

test('a near-duplicate is a CANDIDATE and is never auto-retired (OQ-R10)', () => {
  const body = Array.from({ length: 20 }, (_, i) => ({ page_number: i + 1, chunk_index: 0, text: `page ${i + 1} body` }));
  const r = findDuplicates([
    { doc: { id: 'doc_rev_a', label: 'rev A', in_scope: true }, rows: body.map((x) => ({ ...x })) },
    // Same manual with an extra cover page — 20 of 21 hashes shared, j = 20/21.
    { doc: { id: 'doc_rev_b', label: 'rev B', in_scope: true }, rows: [{ page_number: 0, chunk_index: 0, text: 'REVISION B COVER' }, ...body.map((x) => ({ ...x }))] },
  ]);
  assert.equal(r.exact.length, 0, 'a revision is not an exact duplicate');
  assert.equal(r.candidates.length, 1);
  assert.ok(r.candidates[0].jaccard >= NEAR_DUPLICATE_JACCARD);
  assert.equal(hasUnresolvedDuplicates(r), false, 'a candidate must never fail the check on its own');
});

test('an exact group is not also reported as a candidate of itself', () => {
  const r = findDuplicates(CORPUS());
  const exactIds = new Set(r.exact.flatMap((g) => g.documents.map((d) => d.id)));
  for (const c of r.candidates) {
    assert.ok(
      !(exactIds.has(c.documents[0].id) && exactIds.has(c.documents[1].id)),
      'an exact pair reported twice would double-count the same defect'
    );
  }
});
