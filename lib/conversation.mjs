/**
 * conversation.mjs — F2. An ordinary message gets an ordinary reply.
 *
 * `02-user-stories-fixes.md` §2.2 (ST-F04/ST-F05). Every `/diagnose` call used to
 * run retrieval and prompt the model with SOURCES, so "that worked" was answered as
 * though it were a symptom: either an irrelevant cited answer or no-documentation.
 * Both read as the app not listening, and both cost quota.
 *
 * ## Two decisions, and neither is a first cut
 *
 * **The classifier is deterministic and the reply body is a server-side constant.**
 * The model is never asked whether something is small talk, and never authors the
 * reply. That is not a performance choice — it is what closes the hole *by
 * construction*. A model-declared `kind: 'conversational'` would be a channel
 * through which uncited diagnostic prose could reach the screen under a label that
 * exempts it from citation, exactly as `clarify` is exempted (`diagnose.mjs`
 * `validateAnswer`). Because no model is called on this path, there is no such
 * channel to police. The same construction already ships three times over:
 * `refusalBody` (safety.mjs), `NO_DOCUMENTATION` and `UNIT_REQUIRED`
 * (diagnose.mjs).
 *
 * **The classifier is tuned for precision, and fails toward today's behaviour.**
 * The two error directions are not symmetric:
 *
 *   - *False positive* (a real question answered as small talk): the technician
 *     gets a short routing sentence, rephrases, and loses one turn. No citation
 *     and no safety guarantee is touched, because the reply makes no claim.
 *   - *False negative* (small talk routed into diagnosis): **this is precisely
 *     today's behaviour.** It costs quota and reads badly. It is not a regression.
 *
 * So every rule below narrows. If this ever swallows real questions, the correct
 * response is to **shrink** the allow-list, not to widen it: narrowing degrades
 * toward the status quo, widening degrades toward an uncited hole (§7.5).
 *
 * ## The six narrowing rules (§2.2)
 *
 *   C1  `classifyHazard` runs first and its verdict is absolute. Enforced at the
 *       call site in `diagnose()`; also re-checked here so a future caller that
 *       forgets the ordering still cannot get small talk out of a hazardous
 *       request.
 *   C2  ≤ 6 words and ≤ 48 characters after normalisation. The single strongest
 *       false-positive guard: a long message is a real message.
 *   C3  Whole-utterance anchored match, never substring.
 *   C4  No `?`, and no leading interrogative — a question is a request for a claim.
 *   C5  No hazard-domain noun (reused from `safety.mjs`, never re-listed) and no
 *       equipment noun.
 *   C6  The bodies are constants, and `refusalLeaksProcedure` must be false on
 *       each of them.
 *
 * Pure: no network, no model, no database, no clock.
 */

import { classifyHazard, HAZARD_DOMAIN_PATTERNS } from './safety.mjs';

/** @typedef {'acknowledgement'|'greeting'|'farewell'} ConversationalIntent */

// ---------------------------------------------------------------------------
// C2 — the ceilings
// ---------------------------------------------------------------------------

/** Words. "Thanks, that's all" is conversation; six words of symptom is not. */
export const MAX_WORDS = 6;
/** Characters, after normalisation. Belt to C2's braces for long compound words. */
export const MAX_CHARS = 48;

// ---------------------------------------------------------------------------
// C4 — a question is a request for a claim, and claims need citations
// ---------------------------------------------------------------------------

/**
 * Leading words that open a question even with no question mark.
 *
 * The first twelve are §2.2's list verbatim; the rest are auxiliaries that open a
 * question the same way. Adding to this list can only *narrow* the classifier,
 * which is the safe direction.
 */
const INTERROGATIVE_OPENERS = new Set([
  'what', 'why', 'how', 'when', 'where', 'which', 'is', 'does', 'should', 'can',
  'could', 'do',
  'who', 'whom', 'whose', 'are', 'am', 'was', 'were', 'did', 'has', 'have', 'had',
  'will', 'would', 'shall', 'may', 'might', 'any', 'anyone',
]);

// ---------------------------------------------------------------------------
// C5 — equipment vocabulary
// ---------------------------------------------------------------------------

/**
 * Nouns that place an utterance on the equipment, not on the conversation.
 *
 * Deliberately *not* a hazard list — `HAZARD_DOMAIN_PATTERNS` is imported from
 * `safety.mjs` for that half, so there is exactly one definition of "hazardous
 * domain" in the tree and this file cannot drift from it.
 *
 * Meta-words a reply may legitimately use — "manual", "document", "page" — are
 * absent on purpose: they are how the system describes *itself*, and banning them
 * would make the canned bodies unwritable (ST-F04 AC 5 runs this same list over
 * the bodies).
 */
const EQUIPMENT_LEXICON = [
  'unit', 'units', 'rtu', 'rtus', 'rooftop', 'ac', 'hvac', 'furnace', 'boiler',
  'chiller', 'heat', 'heater', 'heating', 'cool', 'cooling', 'cools',
  'condenser', 'evaporator', 'coil', 'coils', 'filter', 'filters', 'fan', 'fans',
  'blower', 'motor', 'belt', 'damper', 'economizer', 'economiser', 'duct', 'ducts',
  'ductwork', 'thermostat', 'stat', 'sensor', 'sensors', 'board', 'boards',
  'relay', 'relays', 'fuse', 'breaker', 'terminal', 'terminals', 'plate',
  'code', 'codes', 'fault', 'faults', 'error', 'errors', 'alarm', 'alarms',
  'flash', 'blink', 'blinking', 'lockout',
  'pressure', 'pressures', 'psi', 'psig', 'amps', 'amp', 'amperage', 'volt',
  'volts', 'voltage', 'ohm', 'ohms', 'temp', 'temps', 'temperature', 'reading',
  'readings', 'superheat', 'subcool', 'subcooling', 'suction', 'discharge',
  'static', 'airflow', 'delta',
  'cycling', 'tripping', 'tripped', 'trips', 'freezing', 'frozen', 'icing', 'iced',
  'leak', 'leaking', 'leaks', 'noise', 'noisy', 'vibration', 'smell', 'smoke',
  'short', 'defrost', 'reset', 'startup', 'shutdown', 'runs', 'running',
];

const EQUIPMENT_PATTERNS = EQUIPMENT_LEXICON.map(
  (word) => new RegExp(`\\b${word}\\b`, 'i')
);

/** Exported so ST-F04 AC 5 can run the same list over the canned bodies. */
export const equipmentTokensIn = (text) =>
  EQUIPMENT_LEXICON.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(String(text ?? '')));

// ---------------------------------------------------------------------------
// C3 — the allow-list, anchored whole-utterance
// ---------------------------------------------------------------------------

/**
 * Deliberately tiny, and every pattern anchored at both ends.
 *
 * Excluded on purpose:
 *
 *  - **Bare affirmations** — "yes", "yeah", "yep", "ok", "sure", "right". Those
 *    are what a technician types to answer a `clarify` question, and routing one
 *    to a canned pleasantry would break the clarification loop mid-diagnosis.
 *    Cheaper to leave them on today's path.
 *  - **Capability questions** — "what can you do", "what units do you cover".
 *    Coverage is `/resolve-unit`'s answer, derived from the live corpus; a
 *    constant string answering it would be a coverage claim that cannot go stale
 *    because it never knew the inventory in the first place (§8).
 */
const ALLOW_LIST = [
  {
    intent: /** @type {ConversationalIntent} */ ('acknowledgement'),
    patterns: [
      /^(that|this|it) (worked|helped|did it|did the trick|fixed it|sorted it|was it)$/,
      /^(that|it) (worked|works)( now| great| well| perfectly)$/,
      /^(thanks|thank you|thanks a lot|thanks very much|many thanks|cheers|ta|much appreciated|appreciate it)$/,
      /^(thanks|cheers) (mate|pal|man|again|for that|for the help|a million)$/,
      /^(that('s| is)|this('s| is)) (great|perfect|brilliant|spot on|helpful)$/,
      /^(got it|understood|makes sense|noted|good to know|fair enough)$/,
      /^(sorted|all sorted|all good|all set|perfect|great|excellent|brilliant|magic|nice one|good stuff|spot on|lovely|fantastic|beautiful)$/,
    ],
  },
  {
    intent: /** @type {ConversationalIntent} */ ('greeting'),
    patterns: [
      /^(hi|hello|hey|hiya|yo|howdy)( there| again| mate)?$/,
      /^(good )?(morning|afternoon|evening)$/,
      /^(hi|hello|hey) (good )?(morning|afternoon|evening)$/,
    ],
  },
  {
    intent: /** @type {ConversationalIntent} */ ('farewell'),
    patterns: [
      /^(bye|bye bye|goodbye|good bye|see you|see ya|see you later|catch you later|later|cheers bye)$/,
      /^(that('s| is) (all|everything|it for now))$/,
      /^(all done|we're done|i'm done|done for the day|that'll do|no more for now|nothing else)$/,
      /^(thanks,? )?(that('s| is) all|bye|goodbye)$/,
    ],
  },
];

// ---------------------------------------------------------------------------
// The canned bodies (C6)
// ---------------------------------------------------------------------------

/**
 * Server-authored, constant, and never near a model.
 *
 * Three rules they are written to:
 *
 *  1. **No diagnostic claim.** No step, no reading, no number, no equipment noun
 *     — so there is nothing in them that could need a citation. ST-F04 AC 5 asserts
 *     this structurally rather than trusting the wording.
 *  2. **Forward-looking, not closing.** The acknowledgement invites the next
 *     symptom rather than implying the last one is handled, because the cheap
 *     failure direction is a real question landing here and the technician needs
 *     the recovery to be obvious (§2.2, false-positive column).
 *  3. **No coverage promise.** "the manuals I hold" — never "I have that unit".
 *     Coverage is the unit gate's statement to make, from the live corpus.
 */
export const CONVERSATIONAL_BODIES = Object.freeze({
  acknowledgement:
    'Good — glad that helped.\n\n' +
    'If anything else comes up, tell me what you are seeing and I will answer from ' +
    'the manuals I hold, with the document and page behind it.',
  greeting:
    'Hello.\n\n' +
    'Tell me what you are working on and what it is doing, and I will answer from ' +
    'the manuals I hold — with the document and page behind every claim.',
  farewell:
    'Take care out there.\n\n' +
    'Whenever the next one comes up, tell me what you are seeing and I will pick it ' +
    'up from the manuals I hold.',
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Lowercase, straighten smart punctuation, collapse whitespace.
 *
 * Curly apostrophes matter: iOS substitutes them as you type, so `that’s all`
 * arrives with U+2019 and would miss an ASCII-anchored pattern on a phone while
 * passing every test written on a laptop.
 */
export const normaliseUtterance = (text) =>
  String(text ?? '')
    .replace(/[‘’ʼʹ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Trailing sentence punctuation only. Internal punctuation is left to fail C3. */
const stripTrailing = (s) => s.replace(/[.!,;:\s-]+$/, '').trim();

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * Is this utterance small talk?
 *
 * @param {string} text
 * @returns {{intent: ConversationalIntent}|null} null means "not small talk" —
 *          which routes to the ordinary diagnostic pipeline, i.e. today's
 *          behaviour. Null is always the safe answer.
 */
export function classifyConversational(text) {
  if (!text || typeof text !== 'string') return null;

  const normalised = normaliseUtterance(text);
  if (!normalised) return null;

  // C4a — an explicit question, whatever else it looks like.
  if (normalised.includes('?')) return null;

  // C2 — the ceilings, measured before anything is stripped.
  const words = normalised.split(' ').filter(Boolean);
  if (words.length > MAX_WORDS || normalised.length > MAX_CHARS) return null;

  // C4b — a leading interrogative opens a question with no question mark.
  const firstWord = words[0].replace(/[^a-z']/g, '');
  if (INTERROGATIVE_OPENERS.has(firstWord)) return null;

  // C5 — equipment vocabulary, hazardous or otherwise, disqualifies outright.
  if (HAZARD_DOMAIN_PATTERNS.some((re) => re.test(normalised))) return null;
  if (EQUIPMENT_PATTERNS.some((re) => re.test(normalised))) return null;

  // C1, defensively. `diagnose()` runs the hazard gate first and its verdict is
  // absolute; this second check means a future caller that wires the order wrong
  // still cannot get a pleasantry out of a hazardous request.
  if (classifyHazard(text)) return null;

  // C3 — anchored, whole-utterance.
  const core = stripTrailing(normalised);
  if (!core) return null;
  for (const { intent, patterns } of ALLOW_LIST) {
    if (patterns.some((re) => re.test(core))) return { intent };
  }
  return null;
}

/**
 * The reply for a classified intent. Always a constant; never a lookup that can
 * miss, because an unknown intent here would mean the classifier and the bodies
 * had drifted apart.
 *
 * @param {{intent: ConversationalIntent}} verdict
 * @returns {string}
 */
export function conversationalBody({ intent } = {}) {
  const body = CONVERSATIONAL_BODIES[intent];
  if (!body) throw new Error(`no conversational body for intent: ${intent}`);
  return body;
}
