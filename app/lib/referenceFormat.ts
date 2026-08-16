/**
 * referenceFormat.ts — reading a reference answer's rows out of its body.
 *
 * ST-R06, against ST-R05's contract. A `reference` answer is the shape N2 adds:
 * a technician asks what the manual *specifies* — clearances, MCA, torque,
 * charge, dip switches — and gets the published number with the page it came
 * from. It arrives as `kind: 'answer'` with `meta.shape: 'reference'`, and its
 * body is `spec — value (condition)` lines (ST-R05 AC 5).
 *
 * ---------------------------------------------------------------------------
 * Why this file is not `answerFormat.ts`
 * ---------------------------------------------------------------------------
 *
 * `parseAnswer` recovers *procedure* — a lead, numbered checks, and a reading.
 * This recovers *data*. Keeping them apart is not tidiness: ST-R05's whole
 * construction is that a reference item has no imperative slot, and a parser
 * that could emit a `ParsedStep` from a reference body would be a place for one
 * to grow back. Nothing here produces a step, a number, or an ordering.
 *
 * ---------------------------------------------------------------------------
 * The guard that matters, and why it fails closed
 * ---------------------------------------------------------------------------
 *
 * **A body containing a numbered line is not a reference answer, whatever
 * `meta.shape` says.** If one appears, `parseReference` returns no items and the
 * renderer falls back to the ordinary answer turn — which draws it as the
 * ordered checklist it evidently is, under `CHECK IN THIS ORDER`, with the
 * advise-only footer attached.
 *
 * The alternative — stripping the numbers and drawing the lines as spec rows —
 * would take a procedure the model wrote and present it as inert data. That is
 * the exact failure ST-R06's user story names ("these are not steps and reading
 * them as steps is how someone does them in order"), pointed the other way, and
 * it is worse: a procedure disguised as data loses the qualification that makes
 * a procedure safe to read. So the parser never launders; it declines.
 *
 * ---------------------------------------------------------------------------
 * ADAPTER — the separator ladder (see `.pipeline/04-frontend-round4.md`)
 * ---------------------------------------------------------------------------
 *
 * ST-R05 AC 5 documents the separator as an em dash. Backend had not landed when
 * this was written, so `SEPARATORS` tries the documented form first and then two
 * near-misses a server-side `join` plausibly produces. It is a ladder, not a
 * guess: the first separator that yields at least one row wins, and if none does
 * the answer degrades to the ordinary answer turn rather than to a blank card.
 * If Backend confirms the em dash, the lower rungs can be deleted with no other
 * change — they are additive tolerance, not a second contract.
 */

/** One published datum. There is no `action` field, and there must never be. */
export type ReferenceItem = {
  /** What is being specified — "Service clearance, coil side", "MCA". */
  spec: string;
  /** The number, range, setting or limit. Never empty: ST-R05 AC 3 drops those. */
  value: string;
  /** The qualifier a manual attaches to a value, when it carries one. */
  condition: string | null;
};

export type ParsedReference = {
  /** Anything above the first row — usually one framing sentence, often empty. */
  lead: string;
  items: ReferenceItem[];
  /**
   * Anything below the last row. In practice this is ST-R05 AC 6's constant
   * hazard-adjacent sentence, which is server text, carries no step and no
   * value, and is rendered as a pointer rather than as a refusal (ST-R06 AC 5).
   */
  note: string;
};

/** `1. `, `2) `, indented or not — the same shape `answerFormat.ts` looks for. */
const NUMBERED = /^\s*\d+[.)]\s+/;

/** The step marker a diagnostic answer carries. Its presence disqualifies too. */
const READING = /\bReading:/;

/** See the ADAPTER note in the header. Documented form first. */
const SEPARATORS = [' — ', ' – ', ' - '];

/** A trailing `(…)` on a value is the manual's qualifier, not part of the number. */
const CONDITION = /^(.*?)\s*\(([^()]*)\)\s*$/;

function rowsFor(lines: string[], separator: string): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  for (const line of lines) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const spec = line.slice(0, at).trim();
    const tail = line.slice(at + separator.length).trim();
    if (!spec || !tail) continue;

    const m = CONDITION.exec(tail);
    const value = (m ? m[1] : tail).trim();
    const condition = m ? m[2].trim() : '';
    // ST-R05 AC 3: an item with no value is dropped server-side. Dropped here
    // too, so a row can never render as a bare label — a label with nothing
    // beside it reads as a heading, and a heading is not a citable datum.
    if (!value) continue;
    items.push({ spec, value, condition: condition || null });
  }
  return items;
}

/**
 * Split a reference body into its rows.
 *
 * Returns `items: []` for anything that is not unambiguously data — an empty
 * body, a body with no separator, or a body carrying a numbered line or a
 * `Reading:` marker. The caller renders the ordinary answer turn in that case,
 * so the failure mode is "drawn as a normal cited answer", never "drawn blank"
 * and never "a procedure drawn as a spec sheet".
 */
export function parseReference(body: string): ParsedReference {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const empty: ParsedReference = { lead: text.trim(), items: [], note: '' };

  // Fail closed. See the header: a numbered or reading-marked body is a
  // procedure, and a procedure is never re-drawn as inert data.
  if (lines.some((l) => NUMBERED.test(l)) || READING.test(text)) return empty;

  for (const separator of SEPARATORS) {
    const items = rowsFor(lines, separator);
    if (items.length === 0) continue;

    const isRow = (l: string) => rowsFor([l], separator).length === 1;
    const first = lines.findIndex(isRow);
    let last = first;
    for (let i = first; i < lines.length; i++) if (isRow(lines[i])) last = i;

    return {
      lead: lines.slice(0, first).join('\n').trim(),
      items,
      note: lines.slice(last + 1).join('\n').trim(),
    };
  }

  return empty;
}
