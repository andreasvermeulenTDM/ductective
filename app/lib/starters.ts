/**
 * starters.ts — the wire contract for `POST /unit-suggestions` (N4 / ST-R15),
 * and the coverage statement shown when a unit's manuals support none.
 *
 * ---------------------------------------------------------------------------
 * What this file used to be, and why none of it survived
 * ---------------------------------------------------------------------------
 *
 * It was a taxonomy: four hardcoded symptom strings per equipment class, chosen
 * by regex over the unit's coverage text, under a comment claiming *"Always
 * four, always answerable"*. The first half was true. The second was asserted
 * and false, and `00-brief-round4.md` is the receipt — four taps on a Bosch IDS,
 * four dead turns, because that corpus is installation literature and the
 * taxonomy only knew how to offer diagnosis.
 *
 * The rule the type-ahead was built to (ST-F11) had simply never been applied
 * here: **a suggestion is a coverage claim.** A suggestion that comes back with
 * no documentation is worse than no suggestion, because the technician concludes
 * the app is broken rather than that the question was off-corpus.
 *
 * So `BY_CLASS`, `CLASS_PATTERNS`, `classifyEquipment` and `startersFor` are
 * gone. Suggestions are now mined from the unit's own chunks, proved by the
 * retrieval that will serve them, and stored (ST-R14/ST-R15). This file's whole
 * job is to accept them off the wire without repairing them, and to say what we
 * *do* hold when there are none.
 *
 * ---------------------------------------------------------------------------
 * The rule that shapes the parser — the same one `suggest.ts` states
 * ---------------------------------------------------------------------------
 *
 * **A malformed row is discarded, never repaired.** A repaired row is a coverage
 * claim nobody made: a suggestion with a guessed category renders in the wrong
 * order, and a suggestion with a guessed page cites a page the value is not on.
 * Dropping one costs a chip. Keeping a broken one costs the property the whole
 * round exists to establish.
 *
 * Pure and import-free, so `node --test` loads it directly. The fetch wrapper —
 * base URL, timeout, bearer header — lives in `diagnose.ts` beside
 * `requestUnitSuggestions`, exactly as `suggest.ts` and `identify.ts` are split.
 */

/**
 * The four mining categories (`02-user-stories-round4.md` §2.3).
 *
 * Kept as a closed set on purpose. An unrecognised category means the server
 * knows about a kind of suggestion this build does not, and the honest response
 * is to drop the row rather than render it in an arbitrary position — see the
 * parser note below.
 */
export const SUGGESTION_CATEGORIES = ['fault', 'reference', 'sequence', 'commissioning'] as const;

export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

/**
 * One row of `{suggestions}` from `POST /unit-suggestions`.
 *
 * Named `DocumentSuggestion` and **not** `UnitSuggestion`: `suggest.ts` already
 * owns that name for a type-ahead row, which is a different thing entirely (a
 * unit the corpus can answer on, versus a question one of its documents can
 * answer). Two things called the same name in the same folder is how a `label`
 * ends up rendered as a symptom.
 */
export type DocumentSuggestion = {
  /** The question, ready to render and ready to send. Server-authored, verbatim. */
  text: string;
  category: SuggestionCategory;
  /** The document the topic was mined from. Inside the unit's own scope. */
  documentId: string;
  /** The page it was mined from. 1-based, like every page in this app. */
  page: number;
  /** The document's display name, for anything that wants to say where it came from. */
  source_document: string;
};

/**
 * How many chips the empty session may show.
 *
 * OQ-R7 sets the cap and `ST-R15` AC 7 makes the **server** apply it, along with
 * the ordering. This is a second, defensive cap so a server bug cannot re-inflate
 * the first screen past the density baseline (ST-F18) — it truncates and never
 * reorders, because reordering here would be a second opinion about what to
 * offer first and the two would drift.
 */
export const SUGGESTION_LIMIT = 4;

/** Minimal fetch shape, so tests can inject one. Mirrors `suggest.ts`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Short, for the same reason `suggest.ts`'s is: this runs while a technician is
 * looking at an empty session. A lookup still in flight after this is worse than
 * one that gave up, because `requestUnitSuggestions` resolves to `[]` and the
 * screen shows the designed empty state rather than a spinner.
 */
export const UNIT_SUGGEST_TIMEOUT_MS = 6_000;

const CATEGORIES = new Set<string>(SUGGESTION_CATEGORIES);

function isSuggestion(row: unknown): row is DocumentSuggestion {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.text === 'string' && r.text.trim().length > 0 &&
    typeof r.category === 'string' && CATEGORIES.has(r.category) &&
    typeof r.documentId === 'string' && r.documentId.length > 0 &&
    typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 1 &&
    typeof r.source_document === 'string' && r.source_document.length > 0
  );
}

/**
 * Parse `{suggestions: [...]}`.
 *
 * Anything unexpected becomes `[]` or a shorter list — never a throw, and never
 * a partially-populated row. There is no error outcome to render: an absent
 * suggestion list is indistinguishable, to the technician, from a corpus that
 * had nothing to suggest, and neither is something they can act on. That is not
 * a shrug — §2.3 makes "nothing to suggest" a **designed** state with its own
 * copy, so the two collapsing onto one screen is by design rather than by
 * omission.
 *
 * Order is the server's, untouched. Length is capped. Nothing is rewritten.
 */
export function parseSuggestionsResponse(json: unknown): DocumentSuggestion[] {
  if (!json || typeof json !== 'object') return [];
  const raw = (json as Record<string, unknown>).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isSuggestion)
    .slice(0, SUGGESTION_LIMIT)
    .map((s) => ({
      text: s.text,
      category: s.category,
      documentId: s.documentId,
      page: s.page,
      source_document: s.source_document,
    }));
}

/**
 * `POST /unit-suggestions`, resolving to `[]` on every failure there is.
 *
 * Unconfigured, unreachable, non-200, malformed, timed out, aborted — all the
 * same answer, on the precedent `requestResolveUnit` and `postSuggestUnits` set.
 * **Including a 404**, which is the shape this returns until `sql/018` is applied
 * and the route exists (ST-R15 AC 12): the screen degrades to the empty state,
 * never to an error card and never back to the taxonomy that caused this round.
 *
 * An empty scope is not asked about at all. `documentIds: []` means the unit
 * resolved to zero documents, and there is nothing for a suggestion to be mined
 * from — a round trip to be told so is latency spent on a known answer.
 */
export async function postUnitSuggestions(
  fetchFn: FetchLike,
  baseUrl: string,
  documentIds: string[],
  signal?: AbortSignal,
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
): Promise<DocumentSuggestion[]> {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return [];
  try {
    const res = await fetchFn(`${baseUrl}/unit-suggestions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ documentIds }),
      signal,
    });
    if (!res.ok) return [];
    return parseSuggestionsResponse(await res.json().catch(() => null));
  } catch {
    // Includes the abort a unit change fires, which is not a failure at all.
    return [];
  }
}

// ---------------------------------------------------------------------------
// The empty state's words — ST-R16 AC 2
// ---------------------------------------------------------------------------

/**
 * How many document kinds the statement names before it groups the rest.
 *
 * Three, because the sentence is read on a phone by someone who wants to start
 * typing. A full breakdown of eleven kinds is an inventory report, not an
 * orientation.
 */
const NAMED_KINDS = 3;

/**
 * The invitation that closes the empty state.
 *
 * **Frontend-authored, and it should not stay that way.** §2.3 specifies that
 * this is "the same sentence the capability answer uses" — i.e. it belongs to
 * ST-R08/ST-R17's server-side constant, so that "what can you help with?" and
 * this screen cannot drift into two different promises. That constant does not
 * exist in the tree yet. Recorded under CONTRACT MISMATCH in
 * `.pipeline/04-frontend-round4.md` against Backend; when it lands, this
 * constant is deleted and the sentence comes off the wire.
 *
 * It claims exactly one thing, and it is a thing the system guarantees by
 * construction rather than by promise: an answer is cited to a page or it is not
 * shown. It offers no capability, because offering one here would be the
 * hardcoded coverage claim this round exists to remove.
 */
export const NOTHING_TO_SUGGEST_INVITATION =
  'Nothing here is pre-canned for this one, so ask in your own words — anything the answer claims will be cited to a page, or I will say I do not have it.';

/** "a", "a and b", "a, b and c" — Oxford-comma-free, matching the app's copy. */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What we hold for this unit, said from the database and nothing else.
 *
 * ST-R16 AC 2 / §2.3. When a unit's documents support no validated suggestion,
 * showing zero chips under a "Common on this unit" heading would be an empty
 * promise, and inventing a chip would be the defect the round is fixing. What is
 * shown instead is the inventory: how many documents are in scope and what kinds
 * they are. **Every word of it is a column** — `docTypes` are the manifest's own
 * `DocType` strings, carried through `documents.doc_type` verbatim.
 *
 * Two rules keep it honest rather than merely short:
 *
 *  1. `count === 0` returns `''`. The caller renders nothing, because
 *     `CoverageLine` has already said "No documentation for this unit" one line
 *     above and a second sentence saying zero is noise on top of a good answer.
 *  2. The kind breakdown is only stated when `docTypes.length === count` — i.e.
 *     when we hold a type for every document we are counting. The type-ahead
 *     path reaches this screen with a family string and no document rows, so a
 *     partial breakdown would produce a sentence whose numbers do not add up.
 *     Count alone, in that case: less said, nothing wrong.
 */
export function coverageStatement(count: number, docTypes: string[] = []): string {
  if (!Number.isInteger(count) || count <= 0) return '';
  const head = count === 1 ? 'For this unit I hold 1 document' : `For this unit I hold ${count} documents`;

  const kinds = docTypes.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
  if (kinds.length !== count) return `${head}.`;

  const tally = new Map<string, number>();
  for (const kind of kinds) tally.set(kind, (tally.get(kind) ?? 0) + 1);

  // Most common first, then alphabetically — deterministic, so the same unit
  // reads the same way every time it is opened.
  const groups = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = groups.slice(0, NAMED_KINDS);
  const rest = groups.slice(NAMED_KINDS).reduce((n, [, c]) => n + c, 0);

  const parts = named.map(([kind, n]) => `${n} ${kind}`);
  if (rest > 0) parts.push(`${rest} other${rest === 1 ? '' : 's'}`);

  return `${head} — ${listOf(parts)}.`;
}
