/**
 * starters.ts — the suggested symptoms on an empty session, chosen for the unit.
 *
 * The old list was four hardcoded strings written when the corpus was two rooftop
 * families. On a Goodman furnace it offered "High head pressure on a Precedent",
 * which is worse than offering nothing: it suggests the app has not registered what
 * the technician is standing in front of.
 *
 * Two rules shape this list, and the second one is easy to get wrong:
 *
 *  1. **Match the equipment class**, read from the coverage strings of the documents
 *     the unit actually resolved to — the same manifest text the server matched on,
 *     so the suggestion and the retrieval scope cannot disagree. The typed equipment
 *     label is the fallback when no verdict exists (manual entry offline).
 *
 *  2. **Never suggest something the safety gate will refuse.** `lib/safety.mjs`
 *     refuses gas/combustion, refrigerant-handling and live-electrical *procedure*,
 *     and three of the top-15 faults (F11 ignition, F12 rollout, F14 charge
 *     verification) sit squarely there. Offering one as a one-tap suggestion means
 *     the app invites a question and then declines it — training technicians that
 *     the suggestions are decoration. Every entry below is an interpretive symptom,
 *     which is exactly what the system is good at.
 *
 * Wording is symptom-first and unit-agnostic: the unit is already established by the
 * gate, so repeating it in the chip ("...on a Precedent") is noise that also goes
 * stale the moment the unit changes.
 */

/** Equipment classes we tailor for. `general` is the honest fallback, not a failure. */
export type EquipmentClass =
  | 'rooftop' | 'furnace' | 'heatpump' | 'airhandler' | 'ductless' | 'boiler' | 'general';

/**
 * Ordered most-specific first: a packaged rooftop *is* also a heat pump sometimes,
 * and "rooftop" is the more useful frame when both match.
 */
const CLASS_PATTERNS: [EquipmentClass, RegExp][] = [
  ['rooftop', /rooftop|packaged|rtu|precedent|weathermaker|48\/?50|intellipak|airfinity|voyager/i],
  ['ductless', /ductless|mini-?split|vrf|vrv|cassette|wall-?mount|slim duct/i],
  ['boiler', /boiler|hydronic|combi/i],
  ['furnace', /furnace/i],
  ['airhandler', /air handler|air handling|fan coil|blower/i],
  ['heatpump', /heat pump|heatpump/i],
];

/** Symptom suggestions per class. All interpretive — none trips the safety gate. */
const BY_CLASS: Record<EquipmentClass, string[]> = {
  rooftop: [
    'Not cooling — compressor won\'t start',
    'Low suction pressure',
    'High head pressure',
    'Economizer not modulating',
  ],
  furnace: [
    'Blower runs constantly and won\'t shut off',
    'Control board is flashing an error code',
    'Low airflow across the heat exchanger',
    'Unit short cycles on the thermostat',
  ],
  heatpump: [
    'Not heating — stuck in defrost',
    'Reversing valve not changing over',
    'Low suction pressure',
    'Unit short cycles',
  ],
  airhandler: [
    'Low airflow / high static pressure',
    'Supply fan won\'t start',
    'Evaporator coil icing up',
    'Blower speed doesn\'t match the nameplate',
  ],
  ductless: [
    'Indoor unit blinking an error code',
    'Not cooling on one zone',
    'Communication fault between indoor and outdoor',
    'Unit short cycles',
  ],
  boiler: [
    'Circulator isn\'t running',
    'Control is showing a lockout code',
    'Not reaching setpoint',
    'Short cycling on the aquastat',
  ],
  general: [
    'Not cooling',
    'Unit is short cycling',
    'Low airflow',
    'Control board is showing an error code',
  ],
};

/**
 * Classify from the resolved documents' coverage text, falling back to the typed
 * equipment label. Returns `general` rather than guessing when nothing matches —
 * a wrong class is worse than a neutral one.
 */
export function classifyEquipment(equipment?: string | null, coverage: string[] = []): EquipmentClass {
  // Coverage first: it is the manifest's own words about what the manual covers,
  // where the label is whatever the plate or the technician said.
  const haystacks = [coverage.join(' '), equipment ?? ''];
  for (const hay of haystacks) {
    if (!hay.trim()) continue;
    for (const [cls, re] of CLASS_PATTERNS) if (re.test(hay)) return cls;
  }
  return 'general';
}

/** The suggestions to show for this unit. Always four, always answerable. */
export function startersFor(equipment?: string | null, coverage: string[] = []): string[] {
  return BY_CLASS[classifyEquipment(equipment, coverage)];
}
