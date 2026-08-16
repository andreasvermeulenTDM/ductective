/**
 * suggestions.mjs — ST-R14 (N4). Candidate questions, mined from the corpus.
 *
 * ## The defect this replaces
 *
 * `app/lib/starters.ts` returned `BY_CLASS[classifyEquipment(...)]` — four
 * hardcoded strings per equipment class, with a comment claiming *"Always four,
 * always answerable"*. The second half was asserted and false. For a Bosch IDS
 * the taxonomy offered generic heat-pump faults while that corpus is mostly
 * *installation* manuals and a gateway troubleshooting guide, so every tap
 * returned no-documentation. **That is the direct cause of the four dead turns
 * the round exists to fix**, and a suggestion that fails is worse than no
 * suggestion: the technician concludes the app is broken rather than that the
 * question was off-corpus.
 *
 * ## The rule already existed elsewhere and was simply not applied here
 *
 * `suggestUnits` (`lib/units.mjs`) was built to *a suggestion is a coverage
 * claim* — it proposes a candidate, puts it back through **the same function
 * that will later judge it for real** (`classifyUnit`), and drops it unless the
 * verdict is `covered`. This module is the analogue for questions:
 *
 *   MINE      chunks in scope → headings and fault-table rows → candidates,
 *             each carrying the chunk and page it came from   ← this file
 *   PHRASE    a fixed template per category. No model authors a suggestion.
 *   GATE      `classifyHazard(text)` must be null              ← the real gate
 *   VALIDATE  embed it, run `match_chunks` scoped to its own document, and keep
 *             it only if the chunk it was mined from comes back at rank 1
 *                                       ← `scripts/build-suggestions.mjs`
 *
 * Mining is deliberately **not diagnosis-only**. A troubleshooting table yields
 * `fault`; a clearance, electrical-data or torque table yields `reference`; a
 * sequence-of-operation section yields `sequence`; a start-up section yields
 * `commissioning`. On an installation corpus that produces installation-reference
 * suggestions — which is exactly what ST-R05 made answerable. N2 and N4 are the
 * same fix seen from two ends.
 *
 * Everything here is **pure, structural and deterministic**: no model, no
 * network, no randomness. Same input, same output, asserted by running it twice.
 */

import { classifyHazard } from '../lib/safety.mjs';

/** @typedef {'fault'|'reference'|'sequence'|'commissioning'} SuggestionCategory */
/**
 * @typedef {{topic: string, category: SuggestionCategory, text: string,
 *            chunkId: string|null, page: number, documentId: string,
 *            chunkIndex: number}} Candidate
 */

// ---------------------------------------------------------------------------
// The category lexicon — what a heading has to be about
// ---------------------------------------------------------------------------

/**
 * Ordered, and the order is the tie-break: a heading matching two categories
 * takes the first. `fault` leads because a troubleshooting section that also
 * mentions a setting is still a troubleshooting section.
 *
 * These are **section-title vocabulary**, not equipment vocabulary. There is no
 * manufacturer, model or product name here and there must never be one — a
 * literal would be correct the day it was written and wrong the day a document
 * was ingested. Grep-asserted in `suggestions.test.mjs`.
 */
const CATEGORY_LEXICON = [
  ['fault', [/troubleshoot/i, /\bfault/i, /\balarm/i, /diagnos/i, /error code/i, /\bcodes?\b/i]],
  ['reference', [
    /clearance/i, /dimension/i, /\bweight/i, /electrical data/i, /torque/i,
    /\bcharge\b/i, /wire siz/i, /airflow/i, /static pressure/i, /\bcapacit(y|ies)\b/i,
    /line siz/i, /\bratings?\b/i, /specification/i, /physical data/i,
  ]],
  ['sequence', [/sequence of operation/i, /operating sequence/i, /modes? of operation/i]],
  ['commissioning', [/start-?up/i, /commission/i, /checkout/i, /pre-?start/i]],
];

// ---------------------------------------------------------------------------
// The template library — the only place a suggestion's words come from
// ---------------------------------------------------------------------------

/**
 * A fixed template per category. **No model authors a suggestion**, and the only
 * variable content is the mined topic string.
 *
 * Every one is a **question or a noun phrase, never a procedural ask** — *"What
 * are the minimum service clearances?"*, not *"How do I set the clearances?"*.
 * That is not politeness: `safety.mjs`'s PROCEDURAL patterns are what turn a
 * domain noun into a refusal, so a procedurally-phrased template would make every
 * suggestion about hazardous equipment refuse itself. Asserted: no template
 * contains a PROCEDURAL pattern.
 */
export const TEMPLATES = Object.freeze({
  fault: (topic) => `What does the manual say about ${topic}?`,
  reference: (topic) => `What does the manual specify for ${topic}?`,
  sequence: (topic) => `What is the ${topic}?`,
  commissioning: (topic) => `What are the ${topic} checks and acceptance criteria?`,
});

/** Fault-table rows get their own template, because a code is not a topic. */
export const CODE_TEMPLATE = (code) => `What does the ${code} code indicate?`;

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/** Normalise for comparison — the same shape `units.mjs`'s `norm` takes. */
export const norm = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Headings are short. Beyond this it is a sentence that happens to be capitalised. */
const MAX_HEADING_CHARS = 64;
const MIN_HEADING_CHARS = 6;

/**
 * Is this line a heading rather than prose?
 *
 * Structural, so it behaves the same on every manual: short, carries letters,
 * does not end in sentence punctuation, and is either upper case or title case.
 * Page furniture — a bare number, a bare page marker — is excluded.
 */
/**
 * Words a real heading does not end on. A line ending here is a heading that the
 * parser truncated mid-phrase — "REFRIGERANT CHARGE for" — and wrapping a
 * template around it produces a question that reads as broken.
 */
const DANGLING = new Set([
  'for', 'and', 'or', 'the', 'of', 'to', 'with', 'in', 'on', 'at', 'a', 'an',
  'by', 'from', 'per', 'is', 'are', 'if', 'when', 'as', 'that', 'this',
]);

export function isHeading(line) {
  const t = String(line ?? '').trim();
  if (t.length < MIN_HEADING_CHARS || t.length > MAX_HEADING_CHARS) return false;
  if (/[.;:!?]$/.test(t)) return false;                 // a sentence, not a heading
  if (!/[A-Za-z]{3}/.test(t)) return false;             // needs real words
  if (/^page\b/i.test(t) || /^\d+$/.test(t)) return false;
  if (/\bhttps?:/i.test(t)) return false;
  if (t.includes('|')) return false;                    // a table row, not a heading
  // A commissioning form's blank-fill line — "Factory Charge (nameplate) =
  // _________(f)". It reads as a title and is a worksheet field.
  if (/[_]{3,}|=/.test(t)) return false;

  /*
   * **Table-of-contents rejection.** A contents entry looks exactly like a
   * heading with page numbers stapled to it: "unit Preparation 19 18 System
   * Operation and Troubleshooting 45". Measured on the live corpus (16 Aug 2026)
   * these were a large share of everything mined, and each produced a chip that
   * asked about a page number. Two or more free-standing numbers is the signal;
   * one is legitimate ("R-410A Charge", "Table 17 Values").
   */
  const standaloneNumbers = (t.match(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g) ?? []).length;
  if (standaloneNumbers >= 2) return false;

  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length < 1 || words.length > 8) return false;
  if (DANGLING.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) return false;

  const upper = t === t.toUpperCase();
  // Title case: most words that carry letters start with a capital. "of", "the"
  // and "and" are legitimately lower in a title, so a majority is the test.
  const capitalised = words.filter((w) => /^[A-Z(]/.test(w)).length;
  return upper || capitalised / words.length >= 0.6;
}

/**
 * A fault/alarm-table row: a code token followed by a description.
 *
 * ## The code must carry a digit, and that is a measurement not a guess
 *
 * An earlier version also accepted a bare two-or-three-letter uppercase token.
 * Run over the live corpus on 16 Aug 2026 it produced chips reading *"What does
 * the OK code indicate?"*, *"What does the CAN code indicate?"*, *"What does the
 * AIR code indicate?"* — `IDS`, `TXV`, `DO`, `PQ`, `ON`, `RF`. Those are
 * acronyms in running text, not fault codes, and a one-tap chip asking about one
 * is exactly the "the app is broken" impression this round exists to remove.
 *
 * Real codes in this corpus are letter-plus-digit (`E4`, `A6`, `P0`, `H1`) or a
 * flash count. Requiring a digit loses a genuinely alpha-only code if one exists;
 * that is the right way round, because a missing suggestion costs nothing and a
 * nonsense one costs trust.
 *
 * @returns {{code: string, description: string}|null}
 */
export function faultRow(line) {
  const t = String(line ?? '').trim();
  if (t.length > 120) return null;
  const m = /^([A-Z]{1,3}-?\d{1,3}|\d{1,2}\s+(?:flash(?:es)?|blinks?))\s*[-–—:.|\t]?\s+(\S.*)$/.exec(t);
  if (!m) return null;
  const code = m[1].replace(/\s+/g, ' ').trim();
  const description = m[2].trim();
  // A dot-leader row in a table of contents is a reference to a page, not a fault.
  if (/^[.\s]*\d+$/.test(description) || /\.{4,}/.test(description)) return null;
  if (description.replace(/[^A-Za-z]/g, '').length < 8) return null;
  return { code, description };
}

/** The category a heading belongs to, or null. */
export function categoryOf(text) {
  for (const [category, patterns] of CATEGORY_LEXICON) {
    if (patterns.some((re) => re.test(text))) return category;
  }
  return null;
}

/**
 * Trim a heading down to the topic a template can be wrapped around.
 *
 * Numbering ("4.2 Electrical Data"), trailing colons and surrounding quotes go;
 * the words stay as the manual wrote them, lower-cased at the front only when it
 * is not an acronym, so the template reads as a sentence.
 */
export function toTopic(heading) {
  let t = String(heading ?? '').trim()
    .replace(/^[\d.]+\s+/, '')
    .replace(/^[-–—•*]\s*/, '')
    .replace(/[:\s]+$/, '')
    .replace(/^["'“”]|["'“”]$/g, '')
    .trim();
  if (!t) return '';
  // ALL-CAPS headings read as shouting inside a sentence; title case does not.
  if (t === t.toUpperCase() && /[A-Z]{4}/.test(t)) t = t.toLowerCase();
  else if (/^[A-Z][a-z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
  return t;
}

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------

/**
 * Every candidate one chunk yields.
 *
 * @param {{document_id: string, page_number: number, chunk_index: number,
 *          text: string, id?: string, chunk_id?: string}} chunk
 * @param {{onDrop?: (reason: string, text: string) => void}} [hooks]
 * @returns {Candidate[]}
 */
export function mineCandidates(chunk, { onDrop } = {}) {
  const out = [];
  const lines = String(chunk?.text ?? '').split('\n');
  const base = {
    chunkId: chunk?.chunk_id ?? chunk?.id ?? null,
    page: chunk?.page_number,
    documentId: chunk?.document_id,
    chunkIndex: chunk?.chunk_index ?? 0,
  };

  for (const line of lines) {
    /** @type {{topic: string, category: SuggestionCategory, text: string}|null} */
    let candidate = null;

    const row = faultRow(line);
    if (row) {
      candidate = { topic: row.code, category: 'fault', text: CODE_TEMPLATE(row.code) };
    } else if (isHeading(line)) {
      const category = categoryOf(line);
      const topic = toTopic(line);
      if (category && topic) candidate = { topic, category, text: TEMPLATES[category](topic) };
    }
    if (!candidate) continue;

    /*
     * **The safety gate runs on every candidate.** This is
     * `starters.test.mjs`'s existing discipline carried forward rather than
     * reinvented: the corpus contains ignition, rollout and charge-verification
     * sections, and they must never become one-tap chips. A chip the app offers
     * and then refuses trains technicians that the suggestions are decoration.
     *
     * The drop is recorded rather than silent, so the build report can say how
     * many candidates the gate removed and from where.
     */
    const hazard = classifyHazard(candidate.text);
    if (hazard) {
      onDrop?.(`hazard:${hazard.category}/${hazard.trigger}`, candidate.text);
      continue;
    }

    out.push({ ...base, ...candidate });
  }
  return out;
}

/**
 * Every candidate a document yields, collapsed.
 *
 * A heading repeated on twelve pages yields **one** candidate, and the winner is
 * the lowest `(page_number, chunk_index)` — deterministic, so two runs over the
 * same corpus produce the same rows and `validated_at` does not churn.
 *
 * @param {Array} chunks every chunk of one document
 * @param {{onDrop?: Function}} [hooks]
 * @returns {Candidate[]} ordered by (page, chunkIndex, text)
 */
export function mineDocument(chunks, { onDrop } = {}) {
  const ordered = [...(chunks ?? [])].sort(
    (a, b) => (a.page_number - b.page_number) || (a.chunk_index - b.chunk_index)
  );

  /** normalised text → the earliest candidate carrying it. */
  const byText = new Map();
  let collapsed = 0;
  for (const chunk of ordered) {
    for (const c of mineCandidates(chunk, { onDrop })) {
      const key = norm(c.text);
      if (!key) continue;
      if (byText.has(key)) { collapsed++; continue; }
      byText.set(key, c);
    }
  }
  if (collapsed) onDrop?.('collapsed', `${collapsed} repeat(s)`);

  return [...byText.values()].sort(
    (a, b) => (a.page - b.page) || (a.chunkIndex - b.chunkIndex) || a.text.localeCompare(b.text)
  );
}
