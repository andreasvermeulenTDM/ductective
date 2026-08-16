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
/** @typedef {'capability'|'installation_scope'|'presence'} MetaIntent */

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

// ===========================================================================
// N3 / ST-R08 — meta turns: capability, installation scope, presence
// ===========================================================================
//
// The owner's rule, from `00-brief-round4.md` N3, is the whole spec:
//
//   **Withhold guidance that is not in a manual; do not answer a non-guidance
//   turn with a no-source error.**
//
// `classifyConversational` above covers acknowledgements, greetings and
// farewells. It does not cover the turn the 16 Aug session actually broke on:
// "what can you help with?" and "how do I install this thing" both fell into the
// diagnostic pipeline and came back as *"I don't have documentation covering
// that"* — a no-source error about a question nobody asked.
//
// ## This widens who authors the words, not what the model may author
//
// `02-user-stories-fixes.md` §2.2 closed the F2 citation hole **by
// construction**: the model is never asked whether a turn is conversational and
// never authors a conversational reply, so there is no channel to police. Every
// pattern below widens the *deterministic classifier*, whose only failure mode
// is a lost turn — never what the model may say uncited. `RESPONSE_SCHEMA` gains
// nothing for these intents and `validateAnswer` gains no branch for them; the
// model is never in a position to declare one.
//
// ## The one relaxation, and the three guards that bound it
//
// Rule C4 disqualifies anything with a `?` or a leading interrogative, because
// "a question is a request for a claim". **C4 is relaxed for `capability` and
// `presence` only.** A capability question *is* a question — but a request for a
// claim about **our own inventory**, not about equipment. Inventory claims are
// already citation-free everywhere in this codebase (`classifyUnit`'s `message`,
// `CoverageLine`, `/suggest-units`): they are answered from the `documents`
// table, which is the thing being described, so a citation would be circular.
//
// The relaxation is bounded by three rules that do not move:
//
//   M1  patterns are anchored whole-utterance, never substring;
//   M2  the equipment lexicon and `HAZARD_DOMAIN_PATTERNS` disqualify a
//       capability or presence turn outright — so "what can you tell me about
//       the compressor" is a diagnostic question, not an inventory question;
//   M3  the body is composed from database columns, never from chunk text and
//       never from a model.
//
// `installation_scope` is exempt from the equipment half of M2 and cannot be
// otherwise: "how do I install this rooftop unit" names a rooftop unit by
// necessity. Its bound is that its patterns are anchored on an explicit *ask for
// installation guidance*, plus `HAZARD_DOMAIN_PATTERNS` and a `classifyHazard`
// re-check — so "how do I install the gas line" is a refusal, never a redirect.
//
// Pure: no network, no model, no database, no clock. Same contract as
// `classifyConversational`.

/** Meta turns get more room than small talk — a question is longer than "cheers". */
export const META_MAX_WORDS = 10;
export const META_MAX_CHARS = 72;

/**
 * "What can you help with?" and its neighbours.
 *
 * Every pattern is anchored at both ends. Adding one widens the set of turns
 * that get a **server-authored** reply, which is the safe direction; the unsafe
 * direction would be widening what a *model* may author, and nothing here does
 * that.
 */
const CAPABILITY_PATTERNS = [
  /^what can (you|this|the app|ductective) (help|do|answer|handle)( with| on| about| for me)?$/,
  /^what can (you|this|the app) help (me )?(with|on)$/,
  /^what can you help (me )?(diagnose|solve)( and (diagnose|solve|fix))?$/,
  /^what can you help diagnose and solve$/,
  /^what (do|can) you (know|cover|answer|handle)( about it| here)?$/,
  /^what (are you|can you be) (good |useful )?(for|at)$/,
  /^what can i ask( you)?( about)?$/,
  /^what (else )?can you (do|help with|tell me)$/,
  /^what (have|do) you (got|have)( for me| in there)?$/,
  /^how can you help( me)?( here| with this)?$/,
  /^what are you able to (do|help with|answer)$/,
  /^what sort of (things|questions) can (you|i) (help with|ask)$/,
  /^(what|which) (things|questions) can you answer$/,
  /^tell me what you can (do|help with)$/,
  /^what do you (do|cover)$/,
];

/**
 * The N2 turn. Anchored on an explicit request for installation *guidance* —
 * not on the word "install" appearing anywhere, which would swallow "the
 * installation manual says 35 in-lb, is that right".
 */
const INSTALLATION_SCOPE_PATTERNS = [
  /^how (do|would|should|can) (i|you|we) install\b.{0,42}$/,
  /^how (do i|to) install\b.{0,42}$/,
  /^(can|could|would) you (help|walk|take)( me)? (with |through |to )?(a |an |the )?(new )?install(ation|ing)?\b.{0,34}$/,
  /^(can|could) you help( me)? install\b.{0,42}$/,
  /^help me install\b.{0,42}$/,
  /^(do|can) you (do|help with|cover|support) (new )?(unit )?install(ation|s|ing)?\b.{0,28}$/,
  /^(the app should|you should|it should) help with (new )?(unit )?install(ation|s)?\b.{0,28}$/,
  /^(i|we) (need|want) (help )?(to |with )?install\w*\b.{0,34}$/,
  /^(what|anything) about (new )?(unit )?install(ation|s)?\b.{0,28}$/,
  /^(is there|do you have) (anything|help|guidance) (for|on|about) install(ation|ing|s)?\b.{0,24}$/,
];

/**
 * "Are you there?" — a `?` and a leading interrogative, so `classifyConversational`
 * cannot take it, and no equipment in it, so the diagnostic pipeline should not
 * either. Today it retrieves eight chunks and withholds.
 */
const PRESENCE_PATTERNS = [
  /^(are|r) (you|u) (still )?(there|with me|listening|alive|awake|around)$/,
  /^(you|u) (there|still there|still with me|around)$/,
  /^still (there|with me|around)$/,
  /^(can|do) (you|u) (hear|read|see) me$/,
  /^is (this|it|anyone|anybody|someone) (there|on|working|listening)$/,
  /^(hello|hey|hi|anyone|anybody)\?*$/,
  /^(you|are you) (working|online|up|running)$/,
];

/**
 * The three intents, in the order they are tried.
 *
 * `equipmentDisqualifies` is the M2 half that `installation_scope` cannot carry
 * — and the exemption is a field rather than a special case in the loop, so it
 * is visible at the point where someone would be tempted to add a fourth intent.
 */
const META_LIST = [
  { intent: /** @type {MetaIntent} */ ('capability'), patterns: CAPABILITY_PATTERNS, equipmentDisqualifies: true },
  { intent: /** @type {MetaIntent} */ ('installation_scope'), patterns: INSTALLATION_SCOPE_PATTERNS, equipmentDisqualifies: false },
  { intent: /** @type {MetaIntent} */ ('presence'), patterns: PRESENCE_PATTERNS, equipmentDisqualifies: true },
];

/**
 * Is this a meta turn — about what the app can do, rather than about equipment?
 *
 * @param {string} text
 * @returns {{intent: MetaIntent}|null} null routes to the ordinary diagnostic
 *          pipeline, i.e. today's behaviour. Null is always the safe answer.
 */
export function classifyMeta(text) {
  if (!text || typeof text !== 'string') return null;

  const normalised = normaliseUtterance(text);
  if (!normalised) return null;

  // M-ceilings, measured before anything is stripped. A long message is a real
  // message, exactly as C2 argues for small talk.
  const words = normalised.split(' ').filter(Boolean);
  if (words.length > META_MAX_WORDS || normalised.length > META_MAX_CHARS) return null;

  // A hazardous domain noun disqualifies every intent, including the one that is
  // exempt from the equipment lexicon. "How do I install the gas piping" must
  // reach the refusal, never the redirect.
  if (HAZARD_DOMAIN_PATTERNS.some((re) => re.test(normalised))) return null;

  // C1, defensively — the same second check `classifyConversational` runs, for
  // the same reason: a future caller that wires the gate order wrong still
  // cannot get a redirect out of a hazardous request.
  if (classifyHazard(text)) return null;

  const namesEquipment = EQUIPMENT_PATTERNS.some((re) => re.test(normalised));
  const core = stripTrailing(normalised.replace(/\?+/g, ''));
  if (!core) return null;

  for (const { intent, patterns, equipmentDisqualifies } of META_LIST) {
    if (equipmentDisqualifies && namesEquipment) continue;
    if (patterns.some((re) => re.test(core))) return { intent };
  }
  return null;
}

/**
 * The `installation_scope` body — a **server constant**, never a model's words.
 *
 * Written to `refusalBody`'s established pattern: decline the walkthrough, name
 * what governs the work, and say what is still on offer — because a refusal that
 * ends the conversation trains technicians to stop asking. What it adds is the
 * second half of the N2 boundary, said out loud: the reference categories it
 * *will* answer, with citations.
 *
 * Three properties this text is written to, each asserted in
 * `conversation.meta.test.mjs`:
 *
 *  1. **No numbered or bulleted line, no digit.** A "here's roughly the order"
 *     preamble is a leaked procedure with a disclaimer on it.
 *  2. **No coverage promise.** "the manuals I hold" — never "I have that unit".
 *     Coverage is `classifyUnit`'s claim to make, from the live corpus.
 *  3. **No equipment noun beyond the category names.** The categories are the
 *     boundary's own vocabulary (`docs/installation-boundary.md` §3); anything
 *     more would be this constant making a claim about a unit it cannot see.
 *
 * It is a **redirect, not a refusal**: it carries no `meta.category` and no
 * `meta.trigger`, so nothing downstream counts it as a refusal or renders it in
 * refusal styling.
 */
export const INSTALLATION_SCOPE_BODY =
  'I won’t walk you through the install itself.\n\n' +
  'Putting a new machine in is governed by your certification training, your ' +
  'company’s standard procedure and the manufacturer’s own published sequence — ' +
  'follow those, not me.\n\n' +
  'What I can do is answer from the manuals I hold, with the document and page ' +
  'behind every figure: clearances and dimensions, electrical service ' +
  'requirements, torque values, charge quantities and line sizing, airflow and ' +
  'static requirements, sequence of operation, control and dip-switch settings, ' +
  'and commissioning criteria.\n\n' +
  'Ask me for any of those and I’ll cite the page it came from.';

/** Short, and it invites the next real turn rather than closing one. */
export const PRESENCE_BODY =
  'Still here.\n\n' +
  'Tell me what you are looking at and I will answer from the manuals I hold, ' +
  'with the document and page behind every claim.';

export const META_BODIES = Object.freeze({
  installation_scope: INSTALLATION_SCOPE_BODY,
  presence: PRESENCE_BODY,
});
