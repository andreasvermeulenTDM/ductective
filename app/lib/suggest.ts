/**
 * suggest.ts — the wire contract for `POST /suggest-units` (F3 / ST-F10), kept pure.
 *
 * No React Native import, so `node --test` can run it — the split `identify.ts`
 * and `citations.ts` already use. The fetch wrapper with the base URL, the
 * timeout and the shared-secret header lives in `diagnose.ts` beside
 * `requestSuggestUnits`; this file owns what goes on the wire and what is
 * accepted back off it.
 *
 * ## The rule that shapes the parser
 *
 * **A suggestion is a coverage claim, so a malformed one is discarded, never
 * repaired.** A suggestion the technician taps carries `documentIds` straight
 * into the session's retrieval scope. A half-parsed row would scope retrieval to
 * the wrong unit's manuals — the mis-citation the unit gate exists to prevent —
 * so a row missing any of `manufacturer`, `family`, `label` or a non-empty
 * `documentIds` is dropped, and a response that is not an array of rows yields
 * `[]`.
 *
 * ## And the label is never composed here
 *
 * `label` is rendered as the server sent it. The app does not build a display
 * string out of the parts, because a label assembled client-side is a second
 * place where the corpus is described and the two would drift. Same reason the
 * matching itself is not reimplemented in TypeScript (OQ-F3).
 */

/** One row of `{suggestions}`. Shapes `lib/units.mjs`'s `suggestUnits` output. */
export type UnitSuggestion = {
  /** As the corpus spells it — "Trane", "Goodman / Amana". */
  manufacturer: string;
  /** The coverage string of the family, verbatim from the documents table. */
  family: string;
  /**
   * The retrieval scope for this unit, identical to what `/resolve-unit` returns
   * for the same manufacturer + family. Pass it verbatim into `requestDiagnosis`;
   * never re-derive it, and never trim it.
   */
  documentIds: string[];
  /** Ready to render: `"<manufacturer> — <family>"`. Server-authored. */
  label: string;
  /** Why this row matched. `model` sorts ahead of `manufacturer`. */
  matchedOn: 'model' | 'manufacturer';
};

/** Minimal fetch shape, so tests can inject one. Mirrors identify.ts. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Below this the server suggests nothing, so there is no point asking. */
export const MIN_QUERY_CHARS = 3;

/**
 * Debounce for the type-ahead. 250ms is the story's proposal: long enough that a
 * technician typing a model number does not fire a request per character, short
 * enough that the list has arrived by the time they stop to look at it.
 */
export const SUGGEST_DEBOUNCE_MS = 250;

/**
 * Short on purpose. A type-ahead that is still thinking when the technician has
 * finished typing is worse than one that gave up: the answer would be stale, and
 * `requestSuggestUnits` resolves to `[]` rather than showing an error.
 */
export const SUGGEST_TIMEOUT_MS = 4_000;

/** Is this worth a round trip at all? Mirrors `units.mjs`'s MIN_PREFIX floor. */
export function worthSuggesting(query: string): boolean {
  return query.trim().length >= MIN_QUERY_CHARS;
}

function isSuggestion(row: unknown): row is UnitSuggestion {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.manufacturer === 'string' && r.manufacturer.length > 0 &&
    typeof r.family === 'string' && r.family.length > 0 &&
    typeof r.label === 'string' && r.label.length > 0 &&
    Array.isArray(r.documentIds) &&
    r.documentIds.length > 0 &&
    r.documentIds.every((id) => typeof id === 'string' && id.length > 0) &&
    (r.matchedOn === 'model' || r.matchedOn === 'manufacturer')
  );
}

/**
 * Parse `{suggestions: [...]}`.
 *
 * Anything unexpected becomes `[]` or a shorter list — never a throw and never a
 * partially-populated row. There is no error outcome to render: an absent
 * suggestion list is indistinguishable, to the technician, from a corpus that had
 * nothing to suggest, and neither is something they can act on.
 */
export function parseSuggestResponse(json: unknown): UnitSuggestion[] {
  if (!json || typeof json !== 'object') return [];
  const raw = (json as Record<string, unknown>).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSuggestion).map((s) => ({
    manufacturer: s.manufacturer,
    family: s.family,
    documentIds: [...s.documentIds],
    label: s.label,
    matchedOn: s.matchedOn,
  }));
}

/**
 * `POST /suggest-units`, resolving to `[]` on every failure.
 *
 * Deliberately resolving rather than throwing, on the precedent
 * `requestResolveUnit` sets: a failed coverage lookup must not block the
 * technician from typing. Free text has always worked without this route and
 * still does.
 */
export async function postSuggestUnits(
  fetchFn: FetchLike,
  baseUrl: string,
  query: string,
  signal?: AbortSignal,
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
): Promise<UnitSuggestion[]> {
  if (!worthSuggesting(query)) return [];
  try {
    const res = await fetchFn(`${baseUrl}/suggest-units`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: query.trim() }),
      signal,
    });
    if (!res.ok) return [];
    return parseSuggestResponse(await res.json().catch(() => null));
  } catch {
    // Includes the abort a newer keystroke causes, which is not a failure at all.
    return [];
  }
}
