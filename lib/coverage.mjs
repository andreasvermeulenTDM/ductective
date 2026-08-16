/**
 * coverage.mjs — what we hold, said in words, composed only from database columns.
 *
 * N3 / N4, round 4. Three places now have to state what the corpus holds for the
 * unit in hand: the capability answer ("what can you help with?", ST-R08/ST-R17),
 * the scoped withhold (ST-R09), and the first-screen empty state (ST-R16, served
 * from here so the app renders a server string rather than composing one).
 *
 * They live in one module because **a coverage claim is the thing this round
 * exists to stop being wrong** (`00-brief-round4.md` hard constraint 2). Three
 * copies of "how we describe what we hold" is three chances for one of them to
 * name a document that is not in scope, or a count that is stale, and the copy
 * that drifted would be the one the technician read.
 *
 * ## Two rules, and they are structural rather than editorial
 *
 * 1. **Every fact comes from a `documents` row.** There is not one manufacturer,
 *    model, family or document-type literal in this file. `doc_type` strings are
 *    lifted verbatim from the rows handed in — they are the manifest's own words
 *    — and counts are counted. A literal list would be correct the day it was
 *    written and quietly wrong the day a document was ingested, re-scoped or
 *    retired, and wrong in the direction that promises coverage we do not have.
 *    Asserted by `coverage.test.mjs` against every manufacturer in
 *    `data/manifest.csv`.
 *
 * 2. **Out-of-scope rows are dropped here, not by the caller.** `in_scope:false`
 *    is how ST-R13 retires a duplicate and how the Phase-1 boundary is drawn; a
 *    composer that counted them would re-introduce the very document retrieval
 *    was just told to ignore.
 *
 * Pure: no network, no model, no database, no clock. The callers do the reading.
 */

/** Beyond this the list stops being read and starts being scrolled past. */
const MAX_NAMED_TYPES = 4;

/**
 * Reduce `documents` rows to the two facts every body below is built from.
 *
 * @param {Array<{doc_type?: string, in_scope?: boolean}>} rows
 * @returns {{count: number, types: Array<{type: string, n: number}>}}
 *          `types` is ordered by count descending, then alphabetically — so the
 *          same scope always renders the same sentence. A technician who asks
 *          twice must not see the list reshuffle for reasons they cannot see.
 */
export function summariseScope(rows) {
  const inScope = (Array.isArray(rows) ? rows : []).filter((r) => r && r.in_scope !== false);
  const byType = new Map();
  for (const r of inScope) {
    const t = String(r.doc_type ?? '').trim();
    if (!t) continue;                       // a row with no doc_type contributes to the count only
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const types = [...byType]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
  return { count: inScope.length, types };
}

/**
 * "9 Install, 2 IOM and 1 Troubleshooting Guide" — or `null` when the rows carry
 * no usable `doc_type` at all, in which case the caller says the count alone.
 *
 * The type names are **verbatim** `doc_type` values. They read a little like a
 * catalogue rather than like prose, and that is the trade taken deliberately:
 * prettifying them would mean a mapping table in this file, which is a literal
 * list of things the corpus contains — the exact defect being fixed.
 */
export function describeTypes(types, { max = MAX_NAMED_TYPES } = {}) {
  const list = (types ?? []).filter((t) => t && t.type && t.n > 0);
  if (!list.length) return null;

  const named = list.slice(0, max).map((t) => `${t.n} ${t.type}`);
  const remaining = list.slice(max);
  if (remaining.length) {
    const n = remaining.reduce((sum, t) => sum + t.n, 0);
    named.push(`${n} of other kinds`);
  }
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/**
 * "I'm holding 12 documents for this job: 9 Install, 2 IOM and 1 Quick Start."
 *
 * The one sentence three surfaces share. Everything in it is counted or lifted.
 */
export function coverageStatement(scope) {
  const { count, types } = scope ?? { count: 0, types: [] };
  if (!count) return 'I don’t have anything in scope for this job yet.';
  const noun = count === 1 ? 'document' : 'documents';
  const detail = describeTypes(types);
  return detail
    ? `I’m holding ${count} ${noun} for this job: ${detail}.`
    : `I’m holding ${count} ${noun} for this job.`;
}

/**
 * ST-R09 — the scoped withhold.
 *
 * ## What was wrong with the message this replaces
 *
 * The unscoped `NO_DOCUMENTATION` constant says *"none of them cover this unit.
 * If you tell me the make and model off the nameplate I can say straight away
 * whether I have it."* On the 16 Aug session's third turn that was said to a
 * technician who **had already resolved a unit to 33 documents**. It asked for
 * something already given, and it stated something false. Worse, it was
 * terminal: it ended the conversation rather than continuing it.
 *
 * ## What is still true, and must stay true
 *
 * A clarify continuation is a **guidance turn**. If the corpus does not support
 * the guidance, withholding is correct and this changes none of it —
 * `meta.noDocumentation` stays `true` on this path, so ST-R01's log still counts
 * it as an honest withhold. **Only the words changed.**
 *
 * ## The rules this text is written to
 *
 *  - no "nameplate", and no claim that the corpus lacks the unit;
 *  - every number and every document-type word is lifted from the rows;
 *  - it ends in a question, so the turn continues;
 *  - no numbered or bulleted line, no `Reading:` marker, and no equipment noun
 *    beyond the `doc_type` words themselves — it makes no diagnostic claim,
 *    which is what keeps a withhold from becoming an uncited answer.
 */
export function scopedNoDocumentationBody(scope) {
  const { count } = scope ?? { count: 0 };
  const detail = describeTypes(scope?.types);
  const noun = count === 1 ? 'document' : 'documents';

  return (
    'I can’t answer that from the documents I have open for this job.\n\n' +
    `I’m holding ${count} ${noun} here` + (detail ? ` — ${detail} —` : '') +
    ' and nothing in them speaks to what you just asked. I’d rather say so than ' +
    'answer from something that doesn’t cover it.\n\n' +
    'What else are you seeing, or which section of the manual should I look in?'
  );
}

/**
 * ST-R08 AC 9 / ST-R17 — the capability answer.
 *
 * Three named degradation steps, each of which is a real state and each of which
 * is tested:
 *
 *   1. **suggestions available** → list them. They are the same validated rows
 *      `/unit-suggestions` serves, so the capability answer cannot name a
 *      question the chips would not offer, and vice versa. One definition of
 *      what we can answer, queried twice.
 *   2. **scope but no suggestions** → the coverage statement alone, plus the
 *      invitation. Honest: we hold documents, we have nothing pre-canned.
 *   3. **no scope at all** → the manufacturer list, capped, exactly as
 *      `classifyUnit` builds it. Never a family enumeration — that ran to
 *      several hundred characters at fifteen manufacturers.
 *
 * The body is **an inventory claim, not a diagnostic claim**, and that is why it
 * carries no citation. The precedent is `classifyUnit`'s `message` and
 * `CoverageLine`: they are answered from the `documents` table, which is the
 * thing being described, so a citation would be circular. Saying so here
 * explicitly, because "an uncited list" is exactly the shape a future reviewer
 * will challenge — and should.
 *
 * @param {{scope?: {count:number, types:Array}, families?: Array<{manufacturer:string}>,
 *          suggestions?: Array<{text:string}>, maxSuggestions?: number}} input
 */
export function capabilityBody({ scope, families = [], suggestions = [], maxSuggestions = 6 } = {}) {
  const invitation =
    'Ask me anything in them and I’ll answer with the document and page behind it. ' +
    'What I won’t do is talk you through gas, live electrical or refrigerant work — ' +
    'that goes to your training and your company’s procedure.';

  if (scope?.count) {
    const offered = suggestions.slice(0, maxSuggestions).filter((s) => s?.text);
    if (offered.length) {
      /*
       * One question per line, and **no bullet or number in front of it**.
       *
       * Not a style choice. `refusalLeaksProcedure` treats a numbered or bulleted
       * line as the shape a leaked procedure takes, and `diagnose()` runs that
       * check over this body before emitting it. A bulleted list of questions is
       * indistinguishable, to that check and to a technician skimming on a roof,
       * from a list of things to go and do. These are questions to ask, not steps
       * to take, and they are formatted as such.
       */
      return (
        `${coverageStatement(scope)}\n\n` +
        'Questions I can answer on it right now, straight out of those pages:\n\n' +
        offered.map((s) => s.text).join('\n') +
        `\n\n${invitation}`
      );
    }
    return `${coverageStatement(scope)}\n\n${invitation}`;
  }

  // No unit resolved. `coveredFamilies`' manufacturer list, capped — the same
  // shape and the same ceiling `classifyUnit` uses, for the same reason.
  const names = (families ?? []).map((f) => f?.manufacturer).filter(Boolean);
  if (!names.length) {
    return (
      'I answer from a library of manufacturers’ own manuals — and only from ' +
      'them, so every figure I give you has a document and a page behind it.\n\n' +
      'Tell me what you are working on and I’ll say straight away whether I hold ' +
      'anything for it.'
    );
  }
  const MAX_NAMED = 8;
  const list = names.length <= MAX_NAMED
    ? names.join(', ')
    : `${names.slice(0, MAX_NAMED).join(', ')} and ${names.length - MAX_NAMED} more`;

  return (
    `I answer from the manufacturers’ own manuals, and right now that means ${list}.\n\n` +
    'Tell me which machine you are at — or capture the plate — and I’ll say what I ' +
    'hold for it and what I can answer on. Every figure comes with a document and a page.\n\n' +
    'What I won’t do is talk you through gas, live electrical or refrigerant work.'
  );
}
