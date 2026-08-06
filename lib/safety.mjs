/**
 * safety.mjs — the advise-only guardrail, enforced before the model is called.
 *
 * `00-brief-run-b.md` criterion 5: three categories, ≥4 phrasings each, 12 of 12
 * must refuse, and **any leak is a Critical that blocks the run**. That bar rules
 * out asking the model nicely and hoping. The model is *also* instructed to refuse
 * (see diagnose.mjs), but a deterministic gate runs first so a refusal cannot be
 * argued out of the system by the phrasing of a request.
 *
 * The hard part is not refusing — it is refusing without destroying the product.
 * "Take a liquid-line pressure reading and tell me what it means" is the core use
 * case; "walk me through recovering the charge" is a refusal. Both mention
 * refrigerant. So this classifies on two axes:
 *
 *   ACTION  — verbs that only appear when someone is *performing* the hazardous
 *             work (recover, braze, evacuate, megger, light the pilot). These
 *             refuse on sight, whatever the surrounding framing.
 *   DOMAIN  — nouns that place a request in a hazardous area (gas valve, burner,
 *             capacitor, charge). These refuse only when paired with procedural
 *             intent ("how do I", "walk me through", "steps to").
 *
 * A bare domain mention with interpretive intent ("what does a 3-flash code on the
 * ignition board mean") is answerable, and deliberately so — refusing it would
 * make the system useless on exactly the equipment it covers.
 *
 * Framing never unlocks anything. "I'm certified", "hypothetically", "just
 * explain the theory" are all explicitly listed in the brief as attempts that must
 * fail, so they are not consulted at all: intent is read from the *request*, not
 * from the requester's claims about themselves.
 */

/** @typedef {'gas_combustion'|'live_electrical'|'refrigerant'} HazardCategory */

const CATEGORIES = [
  {
    id: 'gas_combustion',
    label: 'gas and combustion work',
    action: [
      /\blight(ing)? the pilot\b/i, /\bre-?light\b/i, /\bbleed(ing)? the gas\b/i,
      /\badjust(ing)? (the )?(gas|manifold) pressure\b/i, /\bclock(ing)? the meter\b/i,
      /\breplace .{0,24}(gas valve|heat exchanger|burner)\b/i,
      /\bconvert .{0,16}(to )?(lp|propane|natural gas)\b/i,
      /\bdrill(ing)? .{0,20}orifice\b/i,
    ],
    domain: [
      /\bgas valve\b/i, /\bcombustion\b/i, /\bignit(er|ion|e)\b/i, /\bflame (sensor|rod)\b/i,
      /\bburner\b/i, /\broll ?out\b/i, /\bheat exchanger\b/i, /\bmanifold pressure\b/i,
      /\bpilot\b/i, /\bpropane\b/i, /\bflue\b/i,
    ],
  },
  {
    id: 'live_electrical',
    label: 'live electrical work',
    action: [
      /\bmegger(ing)?\b/i, /\bdischarg(e|ing) .{0,20}capacitor\b/i,
      /\b(jump|jumper|bypass)(ing)? .{0,24}(the )?(safety|limit|switch|interlock|contactor)\b/i,
      /\bwork(ing)? (it |on it )?(live|hot|energi[sz]ed)\b/i,
      /\b(with (the )?power (on|applied)|while energi[sz]ed|under load)\b/i,
      /\bland(ing)? .{0,16}(wire|conductor)s?\b/i, /\bpull(ing)? .{0,12}disconnect\b/i,
      /\bbypass(ing)? .{0,16}lockout\b/i,
    ],
    domain: [
      /\bcapacitor\b/i, /\bcontactor\b/i, /\b(480|240|208|277)\s?v(olt)?\b/i,
      /\bline voltage\b/i, /\bbus ?bar\b/i, /\bcontrol panel\b/i, /\btransformer\b/i,
      /\bwiring\b/i, /\blockout|tagout|loto\b/i,
    ],
  },
  {
    id: 'refrigerant',
    label: 'refrigerant handling',
    action: [
      /\brecover(ing|y)?\b/i, /\bevacuat(e|ing|ion)\b/i, /\bpull(ing)? (a )?vacuum\b/i,
      /\bbraz(e|ing)\b/i, /\bsolder(ing)?\b/i, /\bweigh(ing)? in\b/i,
      /\b(add|adding|charg(e|ing)|top(ping)? off|dump(ing)? in) .{0,24}(refrigerant|charge|r-?\d{2,3}[a-z]?)\b/i,
      /\bcharge (it|the (unit|system))\b/i,
      /\b(hook|hooking|put|putting) .{0,16}gauges? (on|up)\b/i,
      /\bbreak(ing)? (in)?to the (sealed )?system\b/i, /\bopen(ing)? the (sealed )?system\b/i,
      /\breplace .{0,24}(compressor|txv|metering device|drier)\b/i,
    ],
    domain: [
      /\brefrigerant\b/i, /\br-?(22|410a?|454b?|32|407c?)\b/i, /\bsealed system\b/i,
      /\bcompressor\b/i, /\btxv\b/i, /\bline ?set\b/i, /\bdrier\b/i, /\breceiver\b/i,
    ],
  },
];

/** Asking to be taken through the doing of something, rather than told what it means. */
const PROCEDURAL = [
  /\bhow (do|would|should|can) (i|you|we)\b/i,
  /\bwalk me through\b/i, /\bstep[- ]by[- ]step\b/i, /\bwhat('s| is) the (procedure|process)\b/i,
  /\bsteps? (to|for)\b/i, /\bguide me\b/i, /\bshow me how\b/i, /\btalk me through\b/i,
  /\bprocedure for\b/i, /\bhow to\b/i, /\bteach me\b/i, /\btell me how\b/i,
  /\bcan i just\b/i, /\bwhat do i do\b/i, /\binstructions?\b/i,
];

const any = (patterns, text) => patterns.some((re) => re.test(text));

/**
 * Classify a request.
 *
 * @param {string} text
 * @returns {{category: HazardCategory, label: string, trigger: 'action'|'procedural'}|null}
 *          null when the request is answerable.
 */
export function classifyHazard(text) {
  if (!text || typeof text !== 'string') return null;
  const procedural = any(PROCEDURAL, text);

  for (const c of CATEGORIES) {
    if (any(c.action, text)) return { category: c.id, label: c.label, trigger: 'action' };
  }
  // Domain-only requires procedural intent. Checked in a second pass so an action
  // term anywhere in the request wins over a domain term earlier in it.
  for (const c of CATEGORIES) {
    if (procedural && any(c.domain, text)) {
      return { category: c.id, label: c.label, trigger: 'procedural' };
    }
  }
  return null;
}

/**
 * The refusal body.
 *
 * Deliberately contains no steps and no partial procedure — criterion 5 requires
 * the refusal to point at standard safety procedure, and a "well, broadly you
 * would…" preamble is a leak with a disclaimer on it. It does say what the system
 * *can* still help with, because a refusal that ends the conversation trains
 * technicians to stop asking.
 */
export function refusalBody({ label }) {
  return (
    `I can't advise on ${label}.\n\n` +
    'That work is governed by your certification training, your company\'s standard ' +
    'procedure, and the equipment manufacturer\'s published sequence — follow those ' +
    'rather than anything I could tell you here.\n\n' +
    'I can still help either side of it: tell me the readings or fault codes once ' +
    'you have them safely, and I\'ll help you interpret what they rule in or out.'
  );
}

/**
 * Post-check: a refusal that grew a procedure is a leak.
 *
 * Cheap, and it guards the case where a future change routes model-authored text
 * into a refusal body. Numbered or bulleted imperative lists are the shape a
 * leaked procedure takes.
 */
export function refusalLeaksProcedure(body) {
  return /^\s*(\d+[.)]|[-*•])\s+\S/m.test(body ?? '');
}
