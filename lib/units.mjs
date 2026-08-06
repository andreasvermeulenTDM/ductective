/**
 * units.mjs — U4. Resolve a confirmed unit to its coverage, before any question.
 *
 * `docs/phase1-story-map.md` calls U4 the most valuable story in Addendum C: it
 * converts fluent guidance about a unit with no backing documentation from a
 * runtime risk into an unreachable state. The whole point is that this runs
 * *before* the tech asks anything, so "I don't have documentation for that" is the
 * first thing they hear rather than the fourth.
 *
 * Needs nothing from Stage 2.5. `public.documents` already carries `manufacturer`,
 * `coverage`, `doc_type` and `in_scope` — resolution is an ordinary select. The one
 * thing Backend does need from Knowledge is the retrieval filter for U5, filed
 * separately as R1.
 *
 * Two properties of the real corpus drive the matching, and neither is a guess:
 *
 *  - **Carrier names families as `48/50XX`** — six of nine Carrier documents. A tech
 *    types "48LC"; the coverage string reads "48/50LC single package rooftop 4-6
 *    ton". Stripping punctuation gives `4850lc`, which contains `50lc` and not
 *    `48lc`, so the obvious normalisation silently fails on most of the Carrier
 *    corpus. Expanded explicitly below.
 *  - **PT charts are `in_scope` but are not units.** Their coverage is a refrigerant
 *    ("R-454B"), not a model. They must never make a unit "covered" — otherwise
 *    asking about a Daikin while holding R-454B gauges would resolve as supported.
 *    They stay available to retrieval; they just don't answer "is this unit covered".
 */

/** Lowercase, punctuation to spaces, collapse. */
export const norm = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Expand shared-suffix family notation before normalising.
 *
 * "48/50LC single package" → "48LC 50LC 48/50LC single package"
 *
 * Both halves are emitted and the original kept, so a tech typing either "48LC" or
 * "50LC" or the full "48/50LC" resolves to the same document.
 */
export const expandFamilies = (s) =>
  String(s ?? '').replace(/(\d+)\s*\/\s*(\d+)\s*([A-Za-z]+)/g, '$1$3 $2$3 $&');

/** Documents that describe equipment. A refrigerant chart describes a refrigerant. */
export const isUnitDocument = (doc) => doc?.doc_type !== 'PT Chart';

/**
 * Does this document cover this unit?
 *
 * Manufacturer matching is containment in either direction so "Daikin" finds
 * "Daikin Applied" — which is how an out-of-scope unit gets recognised as
 * out-of-scope rather than unrecognised. The distinction matters: U4 requires
 * "ingested but out of Phase 1 scope" to read differently from "never heard of it".
 */
export function unitMatches({ manufacturer, model }, doc) {
  if (!isUnitDocument(doc)) return { manufacturer: false, model: false };

  const q = norm(manufacturer);
  const d = norm(doc.manufacturer);
  const mfr = Boolean(q && d && (d.includes(q) || q.includes(d)));

  const coverage = norm(expandFamilies(doc.coverage));
  const tokens = norm(expandFamilies(model)).split(' ').filter((t) => t.length >= 2);
  // Any token is enough: "Precedent eFlex" should match "Precedent with eFlex" and
  // also plain "Precedent rooftop". Requiring all of them would make a more
  // specific answer from the tech resolve to less.
  const mdl = tokens.length > 0 && tokens.some((t) => coverage.split(' ').includes(t) || coverage.includes(t));

  return { manufacturer: mfr, model: mdl };
}

/**
 * The families this corpus can actually answer for, for the "what IS covered"
 * half of U4's out-of-scope and unrecognised states.
 */
export function coveredFamilies(docs) {
  const byManufacturer = new Map();
  for (const d of docs) {
    if (!d.in_scope || !isUnitDocument(d)) continue;
    if (!byManufacturer.has(d.manufacturer)) byManufacturer.set(d.manufacturer, new Set());
    byManufacturer.get(d.manufacturer).add(d.coverage);
  }
  return [...byManufacturer].map(([manufacturer, families]) => ({
    manufacturer,
    families: [...families].sort(),
  }));
}

/**
 * Classify a unit against the corpus. Pure — `docs` is the documents table.
 *
 * @returns {{status:'covered'|'out_of_scope'|'unrecognised', documentIds:string[],
 *            documents:Array, covered:Array, message:string}}
 */
export function classifyUnit({ manufacturer, model }, docs) {
  const scored = docs.map((doc) => ({ doc, hit: unitMatches({ manufacturer, model }, doc) }));

  // A match needs the manufacturer AND something model-shaped. Manufacturer alone
  // would make every Carrier unit ever built "covered" by the 48/50LC manual.
  const matched = scored.filter((s) => s.hit.manufacturer && s.hit.model).map((s) => s.doc);
  const manufacturerKnown = scored.some((s) => s.hit.manufacturer);
  const covered = coveredFamilies(docs);

  const inScope = matched.filter((d) => d.in_scope);
  const list = (fams) =>
    fams.map((f) => `${f.manufacturer} (${f.families.join('; ')})`).join(', ');

  if (inScope.length) {
    return {
      status: 'covered',
      documentIds: inScope.map((d) => d.id),
      documents: inScope,
      covered,
      message: `Covered — ${inScope.length} document${inScope.length === 1 ? '' : 's'} for this unit.`,
    };
  }

  if (matched.length) {
    return {
      status: 'out_of_scope',
      documentIds: [],
      documents: matched,
      covered,
      message:
        `I have documentation for that unit, but it's outside what this version answers on. ` +
        `Phase 1 covers ${list(covered)}.`,
    };
  }

  // "Nearest" is done honestly rather than fuzzily: if the manufacturer is one we
  // carry, lead with that manufacturer's families. Otherwise say what's covered and
  // stop. Guessing a nearest model is exactly what U4 forbids.
  const nearest = manufacturerKnown
    ? covered.filter((f) => norm(f.manufacturer).includes(norm(manufacturer)) || norm(manufacturer).includes(norm(f.manufacturer)))
    : [];

  return {
    status: 'unrecognised',
    documentIds: [],
    documents: [],
    covered,
    message: nearest.length
      ? `I don't have documentation for that model. For ${nearest[0].manufacturer} I cover: ${nearest[0].families.join('; ')}.`
      : `I don't have documentation for that unit. Phase 1 covers ${list(covered)}.`,
  };
}

/**
 * Live resolution against the documents table.
 *
 * Reads every document once — 24 rows. Paging or caching this would be complexity
 * bought with nothing.
 */
export async function resolveUnit({ manufacturer, model }, { db } = {}) {
  const client = db ?? (await import('./clients.mjs')).supabaseAdmin();
  const { data, error } = await client
    .from('documents')
    .select('id, manufacturer, coverage, doc_type, in_scope, disposition');
  if (error) throw new Error(`unit resolution failed: ${error.message}`);
  return classifyUnit({ manufacturer, model }, data ?? []);
}
