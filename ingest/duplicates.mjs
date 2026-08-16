/**
 * duplicates.mjs — ST-R12 (D1). Duplicate documents, detected by what they say.
 *
 * The brief measured the defect: `07_Bosch_…Condensing-Unit-IOM.pdf` and
 * `B06_Bosch_IDS-Ultra-Series-Condenser-Installation-Manual.pdf` are the same
 * manual — 72 pages and 109 chunks each, page 69 byte-identical at 1,530
 * characters. They arrived in two ZIP sets under two names; `documentId` hashes
 * the `local:///` URL built from the *filename*, so two names minted two
 * identities. In a broad Bosch retrieval **two of the top eight slots were the
 * same text twice**, and a technician reading eight sources was reading seven.
 *
 * Everything here is **pure**: it takes rows and returns a report. The database
 * half lives in `scripts/find-duplicates.mjs`, so the grouping rules are unit
 * tested against fixtures without a service key, and the live run is a check
 * rather than a test.
 *
 * ## Two thresholds, and only one of them acts
 *
 * - **Exact** — equal `documentFingerprint`. Auto-flagged as a duplicate.
 * - **Candidate** — page-hash Jaccard ≥ `NEAR_DUPLICATE_JACCARD`. **Reported
 *   only, never auto-retired** (OQ-R10). Two downloads of one manual can differ
 *   by a cover page or a revision stamp, and auto-retiring on similarity would
 *   eventually retire a genuine revision — which is a worse outcome than
 *   carrying a near-duplicate, because it silently removes a manual a technician
 *   is standing in front of.
 */

import { pageContentHash, documentFingerprint } from './chunk.mjs';

/**
 * OQ-R10's default. 0.90 rather than something higher because the shapes worth
 * a human's attention are "same manual, one extra cover page" and "same manual,
 * rescanned" — both of which land well above 0.9 — while two genuinely different
 * manuals from one manufacturer share boilerplate and land far below it.
 * Reported only, so the cost of a false positive here is one line in a report.
 */
export const NEAR_DUPLICATE_JACCARD = 0.9;

/**
 * Fold a document's chunk rows into a fingerprint.
 *
 * Rows are sorted `(page_number, chunk_index)` here rather than relying on the
 * select's ORDER BY: a paged read stitched back together in arrival order would
 * produce a different fingerprint for the same document depending on how the
 * pages came back, and a non-deterministic fingerprint is worse than none.
 *
 * A row may carry a precomputed `hash` instead of `text`. `find-duplicates.mjs`
 * uses that to hash each chunk as it arrives and drop the body immediately,
 * which is what keeps a 10,000-chunk scan bounded in kilobytes rather than
 * holding the whole corpus in memory to prove the same thing.
 *
 * @param {Array<{page_number:number, chunk_index:number, text?:string, hash?:string}>} rows
 * @returns {{fingerprint: string, pageHashes: string[], chunks: number}}
 */
export function fingerprintDocument(rows) {
  const ordered = [...(rows ?? [])].sort(
    (a, b) => (a.page_number - b.page_number) || (a.chunk_index - b.chunk_index)
  );
  const pageHashes = ordered.map((r) => r.hash ?? pageContentHash(r.page_number, r.text));
  return { fingerprint: documentFingerprint(pageHashes), pageHashes, chunks: ordered.length };
}

/** |A ∩ B| / |A ∪ B| over two hash sets. 0 when both are empty — not 1. */
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size && !B.size) return 0;
  let shared = 0;
  for (const h of A) if (B.has(h)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * OQ-R9 — which document of a group survives.
 *
 * 1. A SourceURL on the manufacturer's own domain beats a local copy. A document
 *    we can point at is worth more than one we merely hold.
 * 2. Otherwise the **lexicographically smaller `id`**. Arbitrary on purpose:
 *    the choice has to be *reproducible*, so that the same database produces the
 *    same report on any machine and a re-run does not flip which one is retired.
 *
 * Descriptiveness of the filename is deliberately not a tiebreak — `label` comes
 * from the manifest's `FileName` column and can be corrected independently of
 * which row survives, so it would be a preference dressed as a rule.
 *
 * **Owner-confirmable.** ST-R13 AC 8 makes the Bosch choice a human decision;
 * this function proposes, it does not decide.
 */
export function chooseSurvivor(docs) {
  const oem = (d) => {
    const url = String(d?.source_url ?? '');
    if (!/^https?:/i.test(url)) return false;
    // A manufacturer domain, as opposed to a document aggregator or a local copy.
    const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
    const maker = String(d?.manufacturer ?? '').toLowerCase().replace(/[^a-z]/g, '');
    return Boolean(maker) && host.replace(/[^a-z]/g, '').includes(maker);
  };
  return [...docs].sort((a, b) =>
    (oem(b) ? 1 : 0) - (oem(a) ? 1 : 0) || String(a.id).localeCompare(String(b.id))
  )[0];
}

/**
 * The whole report, from per-document chunk rows.
 *
 * @param {Map<string, {doc: object, rows: Array}>|Array<{doc: object, rows: Array}>} input
 * @returns {{exact: Array, candidates: Array, noContent: Array, documents: number}}
 */
export function findDuplicates(input) {
  const list = Array.isArray(input) ? input : [...input.values()];

  const prints = list.map(({ doc, rows }) => {
    const { fingerprint, pageHashes, chunks } = fingerprintDocument(rows);
    return { doc, fingerprint, pageHashes: new Set(pageHashes), chunks };
  });

  // A document with no chunks has an empty fingerprint. It is reported and never
  // grouped: two documents that failed to parse are not duplicates of each other.
  const noContent = prints.filter((p) => !p.fingerprint).map((p) => p.doc);
  const withContent = prints.filter((p) => p.fingerprint);

  const byFingerprint = new Map();
  for (const p of withContent) {
    if (!byFingerprint.has(p.fingerprint)) byFingerprint.set(p.fingerprint, []);
    byFingerprint.get(p.fingerprint).push(p);
  }

  const exact = [...byFingerprint.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([fingerprint, members]) => {
      const docs = members.map((m) => ({ ...m.doc, chunks: m.chunks }));
      const keep = chooseSurvivor(docs);
      return {
        fingerprint,
        documents: docs.sort((a, b) => String(a.id).localeCompare(String(b.id))),
        keep: keep.id,
        retire: docs.filter((d) => d.id !== keep.id).map((d) => d.id),
        // The exit code turns on this: a group is only a live defect while more
        // than one of its members can still be retrieved from.
        inScopeCount: docs.filter((d) => d.in_scope !== false).length,
      };
    })
    // Deterministic — the same database gives the same report, in the same order.
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  // Candidates: near-identical but not equal. Reported for a human, never acted on.
  const exactMembers = new Set(exact.flatMap((g) => g.documents.map((d) => d.id)));
  const candidates = [];
  for (let i = 0; i < withContent.length; i++) {
    for (let j = i + 1; j < withContent.length; j++) {
      const a = withContent[i], b = withContent[j];
      if (a.fingerprint === b.fingerprint) continue;                 // already exact
      if (exactMembers.has(a.doc.id) && exactMembers.has(b.doc.id)) continue;
      const score = jaccard(a.pageHashes, b.pageHashes);
      if (score >= NEAR_DUPLICATE_JACCARD) {
        candidates.push({
          jaccard: score,
          documents: [{ ...a.doc, chunks: a.chunks }, { ...b.doc, chunks: b.chunks }]
            .sort((x, y) => String(x.id).localeCompare(String(y.id))),
        });
      }
    }
  }
  candidates.sort((a, b) =>
    b.jaccard - a.jaccard || String(a.documents[0].id).localeCompare(String(b.documents[0].id))
  );

  return { exact, candidates, noContent, documents: list.length };
}

/**
 * Brief AC 5's "a re-run proves no duplicate pair remains", as an exit code.
 *
 * **True only when an exact group still has more than one in-scope member.** A
 * retired duplicate stays in the database — `OUT-OF-SCOPE` keeps the row and its
 * chunks and flips `in_phase1_scope`, so nothing is deleted and no historical
 * `citations.chunk_id` is orphaned (§1d/§1e). The group therefore still appears
 * in the report, correctly, and no longer fails the check: the defect was two
 * *answerable* copies, not two rows.
 */
export const hasUnresolvedDuplicates = (report) =>
  report.exact.some((g) => g.inScopeCount > 1);
