/**
 * suggestions.mjs — ST-R15 / ST-R17 (N4). Serving validated suggestions.
 *
 * Two callers, one query, deliberately:
 *
 *   - `POST /unit-suggestions` — the chips on the first screen (ST-R16)
 *   - `classifyMeta`'s `capability` body — "what can you help with?" (ST-R17)
 *
 * **Neither may name a question the other would not serve.** A suggestion is a
 * coverage claim (`00-brief-round4.md` hard constraint 2), and two definitions of
 * "what we can answer" is two chances for one of them to be wrong. So both go
 * through `suggestionsForScope` and the ordering below is the only ordering.
 *
 * ## What is *not* here
 *
 * No phrasing, no mining, no validation. A row in `document_suggestions` was
 * already mined structurally (`ingest/suggestions.mjs`), gated by
 * `classifyHazard`, and proved by running the same `match_chunks` retrieval that
 * will answer it (`scripts/build-suggestions.mjs`). This module only selects,
 * filters to in-scope documents, deduplicates and orders.
 *
 * ## Until sql/018 is applied
 *
 * The select fails and every caller gets `[]`. That degrades the first screen to
 * its empty state and the capability answer to the coverage statement alone —
 * **never to an error, and never to the old hardcoded taxonomy**.
 */

import { norm } from '../ingest/suggestions.mjs';

/**
 * OQ-R7 — up to four on the empty session, at most two from any one category.
 *
 * Four matches what shipped before, so the density baseline (ST-F18) does not
 * move. The per-category cap is what stops a document with a large fault table
 * filling the screen with codes and never offering the clearance question that
 * the corpus is actually made of. **Zero is legal** and is a designed state.
 */
export const MAX_SUGGESTIONS = 4;
export const MAX_PER_CATEGORY = 2;

/**
 * Category order, and it is not alphabetical.
 *
 * `fault` first because a technician with a code in front of them wants that
 * answered; `reference` next because on an installation corpus it is what we
 * mostly hold; then the two that describe a whole job rather than a moment.
 */
export const CATEGORY_ORDER = ['fault', 'reference', 'sequence', 'commissioning'];

/**
 * Order, deduplicate and cap. Pure — the rows are whatever the caller read.
 *
 * Deduplication is across *documents* by normalised text: a family of manuals
 * shares headings, so "what does the manual specify for electrical data?" can be
 * mined from six of the twelve documents in one unit's scope. Showing it six
 * times is not six suggestions.
 *
 * Deterministic throughout: the same scope always yields the same list in the
 * same order, so a technician who reopens a job does not see it reshuffle for
 * reasons they cannot see.
 *
 * @param {Array<{text:string, category:string, document_id:string, page_number:number,
 *                similarity?:number, source_document?:string}>} rows
 * @param {{limit?: number, perCategory?: number}} [opts]
 */
export function selectSuggestions(rows, { limit = MAX_SUGGESTIONS, perCategory = MAX_PER_CATEGORY } = {}) {
  const seen = new Set();
  const unique = [];
  // Sort before deduplicating so which copy survives is deterministic rather
  // than whichever the database happened to return first.
  const ordered = [...(rows ?? [])]
    .filter((r) => r && typeof r.text === 'string' && r.text.trim())
    .sort((a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (b.similarity ?? 0) - (a.similarity ?? 0) ||
      String(a.document_id).localeCompare(String(b.document_id)) ||
      (a.page_number ?? 0) - (b.page_number ?? 0) ||
      a.text.localeCompare(b.text)
    );

  for (const r of ordered) {
    const key = norm(r.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  const taken = new Map();
  const out = [];
  for (const r of unique) {
    if (out.length >= limit) break;
    const n = taken.get(r.category) ?? 0;
    if (n >= perCategory) continue;
    taken.set(r.category, n + 1);
    out.push(r);
  }

  // If the per-category cap left room, fill it rather than under-offering: four
  // clearance questions beat two chips and a gap.
  if (out.length < limit) {
    for (const r of unique) {
      if (out.length >= limit) break;
      if (!out.includes(r)) out.push(r);
    }
  }

  return out.map((r) => ({
    text: r.text,
    category: r.category,
    documentId: r.document_id,
    page: r.page_number,
    source_document: r.source_document ?? null,
  }));
}

/**
 * The validated suggestions for a resolved unit's scope.
 *
 * Filtered to `documents.in_scope = true` by the join, so a document retired as a
 * duplicate (ST-R13) or taken out of Phase 1 scope stops offering questions with
 * no second action — the reason OQ-R6 chose a table over a committed file.
 *
 * Resolves to `[]` on every failure, including the table not existing. There is
 * no not-found shape and no error shape: **nothing to suggest is a normal
 * answer**, and this restates `03-backend-fixes.md` §2.4's contract for the new
 * route so the two cannot diverge.
 *
 * @param {string[]} documentIds
 * @param {{db?: object, limit?: number}} [opts]
 */
export async function suggestionsForScope(documentIds, { db, limit = MAX_SUGGESTIONS } = {}) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return [];
  try {
    const client = db ?? (await import('./clients.mjs')).supabaseAdmin();
    const { data, error } = await client
      .from('document_suggestions')
      // The embedded select is the in_scope filter: PostgREST drops a row whose
      // required embedded resource does not match, so an out-of-scope document's
      // suggestions never arrive rather than being filtered here and possibly
      // forgotten.
      .select('text, category, document_id, page_number, similarity, documents!inner(label, in_scope)')
      .in('document_id', documentIds)
      .eq('documents.in_scope', true);
    if (error) return [];
    const rows = (data ?? []).map((r) => ({
      ...r,
      source_document: r.documents?.label ?? null,
    }));
    return selectSuggestions(rows, { limit });
  } catch {
    // Includes `sql/018` not being applied, which is the expected state until the
    // owner runs it. The app renders its empty state; nothing errors.
    return [];
  }
}
