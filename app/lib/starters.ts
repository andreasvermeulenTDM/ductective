/**
 * starters.ts — the wire contract for `POST /unit-suggestions` (N4 / ST-R15).
 *
 * ## What this file used to be, and why none of it survived
 *
 * It held `BY_CLASS` — four hardcoded symptom strings per equipment class — and
 * `classifyEquipment`, which picked a class from the resolved documents' coverage
 * text. Its own comment claimed *"Always four, always answerable"*. The first
 * half was true. **The second half was asserted and false**, and it is the direct
 * cause of the four dead turns in the 16 Aug 2026 device session: on a Bosch IDS
 * the taxonomy offered generic heat-pump faults while that unit's corpus is
 * mostly installation manuals and a gateway troubleshooting guide, so every tap
 * returned no-documentation.
 *
 * A suggestion is a **coverage claim** (`00-brief-round4.md` hard constraint 2).
 * A list of them written down in the client is a coverage claim that cannot go
 * stale, because it never knew the inventory in the first place. So the list is
 * gone — `BY_CLASS`, `CLASS_PATTERNS` and the class classifier are **deleted**,
 * not deprecated — and what replaces it is a parser for a server response whose
 * every row was mined from that unit's own manuals, gated by `classifyHazard`,
 * and proved by running the same retrieval that will answer it.
 *
 * `startersFor` survives as a named seam returning nothing, for the one reason
 * given at its declaration below. ST-R16 removes it.
 *
 * The rule this file now keeps is `app/lib/suggest.ts`'s, for the same reason:
 * **a malformed row is discarded, never repaired.** A half-parsed suggestion
 * would put a string in front of a technician as a one-tap question with no
 * evidence behind it, which is exactly what was just removed.
 *
 * No React Native import, so `node --test` can run it — the split `suggest.ts`,
 * `identify.ts` and `citations.ts` already use.
 */

/** Which kind of question this is. Mirrors `document_suggestions.category`. */
export type SuggestionCategory = 'fault' | 'reference' | 'sequence' | 'commissioning';

/** One row of `{suggestions}`. Shapes `lib/suggestions.mjs`'s output. */
export type UnitQuestionSuggestion = {
  /**
   * The question, ready to render and ready to send **verbatim** as the symptom.
   * Server-composed from a fixed template; the app never builds one of its own.
   */
  text: string;
  category: SuggestionCategory;
  /** The document it was mined from — always inside the unit's own scope. */
  documentId: string;
  /** The page it was mined from, 1-based. */
  page: number;
  /** The citable document name, for a UI that wants to say where it came from. */
  source_document: string | null;
};

const CATEGORIES: readonly string[] = ['fault', 'reference', 'sequence', 'commissioning'];

function isSuggestion(row: unknown): row is UnitQuestionSuggestion {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.text === 'string' && r.text.trim().length > 0 &&
    typeof r.category === 'string' && CATEGORIES.includes(r.category) &&
    typeof r.documentId === 'string' && r.documentId.length > 0 &&
    typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 1
  );
}

/**
 * Parse `{suggestions: [...]}`.
 *
 * Anything unexpected becomes `[]` or a shorter list — never a throw and never a
 * partially-populated row. There is no error outcome to render: an absent
 * suggestion list is indistinguishable, to the technician, from a unit whose
 * manuals had nothing pre-canned to offer, and neither is something they can act
 * on. `parseSuggestResponse` in `suggest.ts` sets exactly this precedent.
 */
export function parseSuggestionsResponse(json: unknown): UnitQuestionSuggestion[] {
  if (!json || typeof json !== 'object') return [];
  const raw = (json as Record<string, unknown>).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSuggestion).map((s) => ({
    text: s.text,
    category: s.category,
    documentId: s.documentId,
    page: s.page,
    source_document: typeof s.source_document === 'string' ? s.source_document : null,
  }));
}

/**
 * **DEPRECATED — a seam, and Frontend deletes it. Do not call this.**
 *
 * `ST-R15 AC 10` deletes `startersFor` outright, and everything it stood on
 * (`BY_CLASS`, `CLASS_PATTERNS`, the class classifier) **is** deleted above: the
 * hardcoded coverage claim is gone from this tree and cannot come back.
 *
 * What survives is the name, returning **the empty list, always**. It exists for
 * exactly one reason: `app/screens/ChatScreen.tsx:17` still imports it, that file
 * belongs to ST-R16 (Frontend, running in parallel), and shipping a red `tsc` on
 * a branch the owner may be running on a phone is not a trade worth making.
 * Returning `[]` degrades `EmptyAsk` to the state ST-R16 is building anyway —
 * no chips — which is also the correct state while `sql/018` is unapplied.
 *
 * **ST-R16 removes the import and then removes this function.** Until it does,
 * this is the one place in the app that could have offered an unproven
 * suggestion, and it offers none.
 */
export function startersFor(_equipment?: string | null, _coverage?: string[]): string[] {
  return [];
}

/**
 * Short on purpose. These decorate an empty session; a chip that arrives after
 * the technician has already typed is worse than one that never came, and
 * `requestUnitSuggestions` resolves to `[]` rather than showing an error.
 */
export const UNIT_SUGGESTIONS_TIMEOUT_MS = 4_000;

/** Ceiling the server already applies (OQ-R7); restated so the UI can reserve space. */
export const MAX_UNIT_SUGGESTIONS = 4;

/**
 * `POST /unit-suggestions`, as a pure function over an injected fetch.
 *
 * Resolves to `[]` for **every** failure there is: no scope, non-200, malformed
 * body, timeout, abort, transport error, and the `sql/018`-not-applied case the
 * server turns into an empty list. It never throws.
 */
export async function postUnitSuggestions(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  documentIds: string[],
  signal?: AbortSignal,
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
): Promise<UnitQuestionSuggestion[]> {
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
    return [];
  }
}
