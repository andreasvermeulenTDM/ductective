/**
 * mockDiagnostics.ts — canned responses for the design prototype.
 *
 * ⚠️  NONE OF THIS IS REAL DIAGNOSTIC GUIDANCE, AND NONE OF THE CITATIONS ARE
 *     VERIFIED. The document names and page numbers are plausible-looking
 *     placeholders drawn from the corpus manifest; nobody has opened those pages
 *     to confirm they say what these answers claim.
 *
 * That is exactly the defect .claude/agents/eval.md calls the most dangerous in
 * the system — a real-looking citation attached to a claim it does not support.
 * It exists here only so the *rendering* can be designed, and every one of these
 * is replaced by Run B output before anything is scored.
 *
 * The UI marks all of it with a persistent PROTOTYPE banner. Do not remove that
 * banner while this file is still the answer source.
 */

export type MockCitation = { source_document: string; page: number; claim: string };

export type MockReply = {
  kind: 'answer' | 'clarify' | 'refusal';
  body: string;
  citations: MockCitation[];
};

/** Matched loosely on keywords, so typing a real symptom shows a plausible shape. */
const REPLIES: { match: RegExp; reply: MockReply }[] = [
  {
    match: /refrigerant|charge|superheat|subcool|recover|braze|line ?set/i,
    reply: {
      kind: 'refusal',
      body:
        'I can\'t walk you through refrigerant handling.\n\n' +
        'Recovery, charging, and any work that breaks into the sealed system is ' +
        'EPA Section 608 regulated work. Follow your company\'s standard procedure ' +
        'and your certification training for this step.\n\n' +
        'I can help with what happens either side of it — reading the pressures you ' +
        'measure, or interpreting the diagnostic codes afterward.',
      citations: [],
    },
  },
  {
    match: /gas|combustion|ignit|flame|burner|rollout|heat exchanger/i,
    reply: {
      kind: 'refusal',
      body:
        'I can\'t guide you through gas or combustion work.\n\n' +
        'Ignition faults, burner service, and anything touching the heat exchanger ' +
        'carry a risk I won\'t advise around. Use your company\'s standard procedure ' +
        'and the unit\'s IOM sequence.\n\n' +
        'I can help you interpret the board\'s fault code once you\'ve read it safely.',
      citations: [],
    },
  },
  {
    match: /electric|volt|megger|capacitor|contactor|live|240|480/i,
    reply: {
      kind: 'refusal',
      body:
        'I can\'t advise on live electrical work.\n\n' +
        'Follow your lockout/tagout procedure and your company\'s standard practice ' +
        'for anything inside the control panel with power applied.\n\n' +
        'Tell me the readings once you have them safely and I can help interpret them.',
      citations: [],
    },
  },
  {
    match: /short.?cycl/i,
    reply: {
      kind: 'clarify',
      body:
        'Before I narrow this down — is it cycling on the thermostat, or tripping ' +
        'a safety and locking out?\n\n' +
        'If the board is showing a code, that tells us a lot faster than symptoms will.',
      citations: [],
    },
  },
  {
    match: /head pressure|high pressure|condens/i,
    reply: {
      kind: 'answer',
      body:
        'High head pressure on a Precedent usually resolves to one of four things. ' +
        'Work them in this order — cheapest to check first:\n\n' +
        '1. Condenser coil loading. Check for restriction across the full face, not ' +
        'just the accessible side.\n' +
        '2. Condenser fan operation. Confirm all fans run and rotate the correct way.\n' +
        '3. Outdoor ambient against the design envelope. Compare measured ambient to ' +
        'the unit\'s rated maximum.\n' +
        '4. Airflow path obstruction — recirculation from a nearby wall or curb.\n\n' +
        'Take a liquid-line pressure and temperature reading at the service port ' +
        'before and after whatever you correct, so you can tell whether it moved.',
      citations: [
        {
          source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
          page: 84,
          claim: 'High head pressure causes, ordered by likelihood',
        },
        {
          source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
          page: 91,
          claim: 'Condenser fan rotation and staging check',
        },
      ],
    },
  },
  {
    match: /low suction|suction pressure|low pressure|freez|frozen|evaporator/i,
    reply: {
      kind: 'answer',
      body:
        'Low suction on a 48/50 series points at airflow before it points at charge — ' +
        'and airflow is faster to rule out.\n\n' +
        '1. Filters. Check restriction, not just appearance.\n' +
        '2. Evaporator coil face, both sides.\n' +
        '3. Total external static across the coil, measured against the unit\'s ' +
        'design value rather than a rule of thumb.\n' +
        '4. Blower speed tap or VFD command versus what the unit is nameplated for.\n\n' +
        'If all four are clean, the next step involves the sealed system and I\'ll ' +
        'hand that to your standard procedure.',
      citations: [
        {
          source_document: '48-50LC-4-6-C01T — Carrier 48/50 LC Service',
          page: 42,
          claim: 'Airflow-first diagnostic order for low suction',
        },
        {
          source_document: 'R-454B-Pressure-Temperature-Chart',
          page: 1,
          claim: 'Saturation reference for measured suction pressure',
        },
      ],
    },
  },
  {
    match: /economizer|damper|outside air/i,
    reply: {
      kind: 'answer',
      body:
        'Economizer not modulating is usually control signal, not mechanism — but ' +
        'check the mechanism first because it is visible.\n\n' +
        '1. Watch the damper travel through its full range on a commanded change.\n' +
        '2. Confirm the actuator is getting its control signal.\n' +
        '3. Check the outdoor air sensor reading against actual conditions.\n' +
        '4. Verify the changeover setpoint matches the sequence the job was ' +
        'commissioned to.',
      citations: [
        {
          source_document: 'RT-SVX21AD-EN — Precedent Economizer',
          page: 27,
          claim: 'Economizer actuator and damper travel verification',
        },
      ],
    },
  },
];

const FALLBACK: MockReply = {
  kind: 'clarify',
  body:
    'I don\'t have documentation covering that yet.\n\n' +
    'Phase 1 covers Trane Precedent and Carrier 48/50 rooftop units. Tell me the ' +
    'unit and the symptom and I\'ll tell you whether it\'s in scope — I\'d rather say ' +
    'I don\'t know than guess at equipment I can\'t cite.',
  citations: [],
};

export function mockReply(input: string): MockReply {
  return REPLIES.find((r) => r.match.test(input))?.reply ?? FALLBACK;
}

/** Suggestions surfaced on the empty state, drawn from the plan's top-15 faults. */
export const STARTERS = [
  'High head pressure on a Precedent',
  'Low suction, 48/50 LC not cooling',
  'Economizer not modulating',
  'Unit is short cycling',
];
