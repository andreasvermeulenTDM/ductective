/**
 * diagnose.mjs — the diagnostic core. Symptom in, ranked cited steps out.
 *
 * Deliberately transport-agnostic: this module knows nothing about HTTP. The local
 * dev server (`scripts/serve.mjs`) and the Edge Function wrapper both call
 * `diagnose()`, so the acceptance path and the development path cannot drift into
 * two different behaviours.
 *
 * The pipeline, and why it is in this order:
 *
 *   1. Safety gate      — deterministic, before a token is spent. A refusal must
 *                         not depend on the model agreeing to refuse.
 *   2. Retrieve         — pgvector over the ingested corpus, in-scope only.
 *   3. No documentation — if retrieval comes back empty, answer that, and do not
 *                         call the model. An ungrounded model call here is exactly
 *                         how a confident invention gets produced (criterion 8).
 *   4. Generate         — structured JSON, every step citing a source *by index*.
 *   5. Validate         — indices resolve against the retrieved set, or the step is
 *                         dropped. The model never supplies a document name or a
 *                         page number; it only points at one it was given.
 *
 * Step 5 is the load-bearing one. `00-brief-run-b.md` moved citation plumbing to us
 * when the provider changed, and the failure it exists to prevent is a fabricated
 * page number that looks perfectly plausible. The model cannot fabricate one here,
 * because it is never in a position to write one down.
 */

import { supabaseAdmin, embed } from './clients.mjs';
import { complete, ProviderError, imagePart } from './providers/gemini.mjs';
import { classifyHazard, refusalBody, refusalLeaksProcedure, HAZARD_DOMAIN_PATTERNS } from './safety.mjs';
import { classifyConversational, conversationalBody, classifyMeta, META_BODIES } from './conversation.mjs';
import { summariseScope, scopedNoDocumentationBody, capabilityBody } from './coverage.mjs';
import { normalizeUsage, zeroUsage } from './metrics.mjs';

const TOP_K = 8;

/** OQ-R7 — the capability answer may name up to six; the chips show at most four. */
const CAPABILITY_SUGGESTIONS = 6;

/**
 * OQ-R11 — the continuation-query window.
 *
 * A reply of twelve words or fewer to the model's own question is a *fragment*,
 * not a query: "yes", "3 flashes", "about 38". Longer than that and the reply
 * stands on its own and merging would dilute it.
 */
const CONTINUATION_MAX_WORDS = 12;

/** Normalised failure. `status` mirrors S4's documented error shape. */
export class DiagnoseError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'DiagnoseError';
    this.status = status;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieval mode. **Vector-only by default, deliberately** — this is a measurement,
 * not a preference.
 *
 * `sql/004` adds RRF fusion over a lexical arm, and its rationale is sound: vector
 * search cannot separate "high head pressure on a rooftop unit" in Trane prose from
 * the same sentence in Carrier prose, so the manufacturer token needs lexical
 * matching. But measured on the live corpus the day it was applied, hybrid made
 * manufacturer precision **worse**, not better:
 *
 *   "Trane Precedent rooftop unit tripping on high head pressure"
 *     vector-only : 2 Trane documents in the top 5 (both real Precedent IOMs)
 *     hybrid RRF  : 1
 *
 * The cause is upstream of the ranking. The parser stripped word boundaries during
 * ingest, and it did most damage to exactly the tokens the lexical arm depends on:
 * only **25% of chunks containing "trane"** and **20% of those containing
 * "precedent"** carry it as a delimited word — the rest is glued into a longer
 * token that `to_tsvector` never emits. So the lexical arm cannot see the
 * discriminating terms, ranks on common ones instead, and fusing it with a working
 * vector arm dilutes a good result with a bad one.
 *
 * Set `RETRIEVAL_MODE=hybrid` to opt in. Make it the default again when the parse
 * defect is fixed and the smoke set shows hybrid ahead — measured, not assumed,
 * which is what `sql/004`'s own comment asks for when it keeps `match_chunks` in
 * place "so the two can be measured against each other".
 */
const MODE = process.env.RETRIEVAL_MODE === 'hybrid' ? 'hybrid' : 'vector';

/**
 * PostgREST errors that mean "the live function does not have this signature".
 * PGRST202: signature not found in the schema cache — what firing
 * `filter_document_ids` at a pre-`sql/007` database produces. PGRST203: ambiguous
 * overload — what a `create or replace` without the `drop function` produces
 * (the R1 gotcha). Matched on code, not message text, per Knowledge's contract.
 */
const isMissingFilterParam = (error) =>
  error?.code === 'PGRST202' || error?.code === 'PGRST203';

/**
 * @param {string} symptom
 * @param {{topK?: number, mode?: string, db?: object, documentIds?: string[],
 *          embedFn?: Function}} opts — `db` and `embedFn` are injectable for
 *          tests; production callers pass neither.
 * @returns {Promise<{chunks: Array, scopeFallback: boolean, queryEmbedTokens: number}>}
 */
export async function retrieve(symptom, { topK = TOP_K, mode = MODE, db = supabaseAdmin(), documentIds, embedFn = embed } = {}) {
  // `query`, not `document` — Voyage embeds asymmetrically and mismatching the two
  // costs recall measurably. Ingestion embeds chunks as documents; this is a search.
  // ST-09: `tokens` is the Voyage spend for this query — surfaced so the cost
  // projection covers both providers. Stubs that omit it read as 0.
  const { embeddings, tokens: queryEmbedTokens = 0 } = await embedFn([symptom], { inputType: 'query' });
  const vector = embeddings[0];

  // R1 / sql/007 contract: `filter_document_ids` treats [] the same as null — no
  // filter. So an empty array must NEVER reach the RPC as "this unit has no
  // documents"; diagnose() short-circuits that case to no-documentation before
  // calling here. Only a non-empty array is a scope.
  const scoped = Array.isArray(documentIds) && documentIds.length > 0;

  const call = (withFilter) => {
    const args = mode === 'hybrid'
      ? { query_embedding: vector, query_text: symptom, match_count: topK }
      : { query_embedding: vector, match_count: topK };
    // The key is only present when scoping — including it as null against the
    // pre-007 function signature would fail every unscoped call too.
    if (withFilter) args.filter_document_ids = documentIds;
    return db.rpc(mode === 'hybrid' ? 'match_chunks_hybrid' : 'match_chunks', args);
  };

  // No silent fallback between modes: asking for hybrid and quietly getting vector
  // means measuring one thing while believing you measured another, which is the
  // whole reason this setting exists. A missing migration should say so.
  let { data, error } = await call(scoped);

  // ADAPTER at the retrieval boundary — CONTRACT MISMATCH, owner: Knowledge.
  // `sql/007` (stage/knowledge-r1) adds `filter_document_ids`; until the owner
  // applies it to the live instance, the scoped signature does not exist and
  // PostgREST returns PGRST202. Per ST-04's build instruction this degrades to
  // UNSCOPED retrieval with a logged warning rather than crashing — and the
  // degradation is surfaced in `meta.scopeFallback` so a transcript can never
  // pass as scoped when it was not. Delete this block once sql/007 is applied.
  let scopeFallback = false;
  if (error && scoped && isMissingFilterParam(error)) {
    console.warn(
      `[retrieve] ${mode === 'hybrid' ? 'match_chunks_hybrid' : 'match_chunks'} does not accept ` +
        `filter_document_ids yet (${error.code} — sql/007 not applied). ` +
        'Falling back to UNSCOPED retrieval; citations may cross manufacturers.'
    );
    scopeFallback = true;
    ({ data, error } = await call(false));
  }

  if (error) throw new DiagnoseError(502, `retrieval failed (${mode}): ${error.message}`);

  const chunks = (data ?? [])
    .filter((r) => r.out_in_scope !== false)
    .map((r) => ({
      chunkId: r.chunk_id,
      document: r.out_document,
      documentId: r.out_document_id,
      page: r.out_page,
      text: r.out_text,
      manufacturer: r.out_manufacturer,
      similarity: r.out_similarity,
    }));

  return { chunks, scopeFallback, queryEmbedTokens };
}

// ---------------------------------------------------------------------------
// Prompt assembly — pure, so it is testable without a key
// ---------------------------------------------------------------------------

/**
 * The system instruction is a constant and goes first, which is what makes
 * Gemini's implicit prefix caching able to hit at all. Retrieved context varies per
 * request and follows it.
 */
export const SYSTEM = [
  'You are Ductective, a diagnostic assistant for HVAC technicians working on',
  'light-commercial packaged rooftop units.',
  '',
  'RULES, in order of precedence:',
  '1. Every diagnostic claim you make must be supported by one of the numbered',
  '   SOURCES provided. Cite it by its number. If the sources do not support a',
  '   claim, do not make the claim. Never cite a source number you were not given.',
  '2. You advise; you do not instruct through hazardous work. Never give',
  '   step-by-step procedure for gas or combustion work, live electrical work, or',
  '   refrigerant handling. Point to standard safety procedure instead.',
  '3. Order steps the way a competent technician would actually work them: most',
  '   likely and cheapest to check first. A correct step in the wrong position is',
  '   a wrong answer.',
  '4. Every step states the reading to take and what its result rules in or out.',
  '5. If the symptom is too vague to rank causes, ask exactly one targeted',
  '   question rather than guessing. Ask for something measurable on site.',
  '   Prefer this over saying you have no documentation whenever the sources do',
  '   not support a ranked diagnosis but the symptom is under-specified: a',
  '   question continues the job, a withhold ends it. Ask only a question — no',
  '   list, no reading, no diagnosis inside it.',
  '6. If the sources do not cover the equipment or symptom, say so plainly.',
  '7. If the question asks for a published specification rather than a diagnosis',
  '   — a clearance, a dimension, a weight, an electrical rating, a torque or',
  '   charge value, a line size, an airflow or static requirement, a control or',
  '   dip-switch setting, a sequence of operation, or a commissioning criterion',
  '   — answer with kind "reference" and a list of specs, not with ranked steps.',
  '   A reference answer carries values and criteria ONLY: every item is a',
  '   number, a range, a limit or a setting read off a page, each citing its',
  '   source. It contains no instruction, no procedure and no step. Rule 2',
  '   outranks this rule: if answering would take someone through gas,',
  '   live-electrical or refrigerant work, do not answer.',
].join('\n');

/** Numbered sources. The index is the only citation handle the model ever sees. */
export function buildSources(chunks) {
  return chunks.map((c, i) => ({ n: i + 1, ...c }));
}

/**
 * Reduce a client-supplied `history` array to turns that are safe to trust.
 *
 * `history` arrives over the wire and is used two ways that both need it clean:
 * `buildPrompt` spreads it into the model's turn list, and the Gemini adapter
 * (`toContents`) lifts any `role:'system'` turn into the top-level system
 * instruction — so a forged `{role:'system'}` entry would let a caller append to
 * SYSTEM. This is the trust boundary, and the only place that can make the
 * distinction: the adapter receives the real SYSTEM as a `role:'system'` message
 * too, so it cannot itself tell a wire turn from the internal one.
 *
 * Keeps only `user`/`assistant` turns with string content; drops everything else,
 * including structured `parts` (a vision-only shape that has no business arriving
 * on `/diagnose`).
 */
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Photos one question may carry, and the cap on them.
 *
 * Accepts `images: []` (the wire form) and a single `image` for the one-photo case.
 * Three is the ceiling: a fault is usually one or two pictures — the board's code
 * and the component it points at — and each is real tokens on every retry of that
 * turn, so an unbounded array is a bill and a latency cost with no diagnostic gain.
 */
export const MAX_PHOTOS = 3;

export function normalizePhotos({ image, images }) {
  const list = Array.isArray(images) ? images : image ? [image] : [];
  if (list.length > MAX_PHOTOS) {
    throw new DiagnoseError(400, `at most ${MAX_PHOTOS} photos per question (got ${list.length})`);
  }
  if (list.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new DiagnoseError(400, 'images must be an array of base64 JPEG strings');
  }
  return list;
}

export function buildPrompt({ symptom, equipment, sources, history = [], photos = [] }) {
  const context = sources
    .map((s) => `[${s.n}] ${s.document} — page ${s.page}\n${s.text}`)
    .join('\n\n');

  const preamble = equipment ? `EQUIPMENT: ${equipment}\n\n` : '';
  /*
   * ST-17 — a photo of the part, not the plate.
   *
   * The instruction is deliberately narrow, because a photo is the one input that
   * can produce a claim with nothing to cite. `CLAUDE.md`'s rule is that every
   * diagnostic statement traces to a source document and page, and a photograph is
   * not a source document. So the photo may inform *what the technician is looking
   * at* — which is an observation they made, restated — while every ranked step
   * still has to come from, and cite, a manual. `validateAnswer` enforces the second
   * half structurally: a step with no resolvable source index is dropped whatever
   * the model saw.
   */
  const n = photos.length;
  const photoNote = n
    ? `\n\nThe technician has attached ${n === 1 ? 'a photo' : `${n} photos`} of what they are ` +
      'looking at. Use ' + (n === 1 ? 'it' : 'them') + ' to understand the symptom and to tell them ' +
      'what you can see. Do NOT treat ' + (n === 1 ? 'the photo' : 'the photos') + ' as a source: ' +
      'every numbered step must still come from, and cite, one of the numbered sources above. If ' +
      (n === 1 ? 'the photo shows' : 'the photos show') + ' something the sources do not cover, say ' +
      'so plainly rather than inferring a procedure from the image.'
    : '';

  const user =
    `${preamble}SOURCES:\n\n${context}\n\n` +
    `TECHNICIAN'S SYMPTOM: ${symptom}${photoNote}\n\n` +
    'Respond using the required JSON schema. Cite only the source numbers above.';

  // A turn carries `parts` only when there are images; the string form stays the
  // common path so nothing about the text-only prompt changes shape. Images lead,
  // then the text — the same order the nameplate route uses.
  const turn = n
    ? { role: 'user', parts: [...photos.map((p) => imagePart(p.base64, 'image/jpeg')), { text: user }] }
    : { role: 'user', content: user };

  return { system: SYSTEM, messages: [...history, turn] };
}

/**
 * Gemini structured-output schema. Keeps the parser honest — no free-text parsing.
 *
 * ST-R05 adds `reference` and `specs`. Read the constraint before adding a third
 * shape: **no value in this enum is citation-exempt.** `answer` and `reference`
 * both resolve every emitted item through `byIndex` or are dropped; an emission
 * with nothing left degrades to no-documentation. `clarify` is the only
 * citation-free kind, it is unchanged, and ST-R10 puts a structural guard in
 * front of it rather than widening it.
 *
 * A `specs` item has **no `action` field**, deliberately and structurally. That
 * is what keeps a reference answer from becoming a procedure with citations
 * stapled to it: there is no imperative slot for the model to fill. `value` is
 * required for the same reason — "terminate the conductors" has no value, "35
 * in-lb" does, and `validateAnswer` drops any item that arrives without one.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['answer', 'clarify', 'no_documentation', 'reference'] },
    question: { type: 'string' },
    preamble: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          reading: { type: 'string' },
          rules_out: { type: 'string' },
          source: { type: 'integer' },
        },
        required: ['action', 'reading', 'source'],
      },
    },
    specs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          /** What is being specified — "minimum service clearance, coil side". */
          spec: { type: 'string' },
          /** The published figure, verbatim — "36 in", "35 in-lb", "4.2 lb". */
          value: { type: 'string' },
          /** When it applies — "single-phase 208V", "with economiser". Optional. */
          condition: { type: 'string' },
          source: { type: 'integer' },
        },
        required: ['spec', 'value', 'source'],
      },
    },
  },
  required: ['kind'],
};

/**
 * ST-R05 AC 6 — the hazard-adjacent note.
 *
 * Appended, as a **constant**, when a surviving spec item names hazardous
 * equipment. A torque figure for a set of lugs is a published datum and stays
 * answerable (that is the whole N2 boundary); what the technician also needs to
 * see is that the *work* the figure belongs to is not ours to talk them through.
 *
 * Written with no imperative verb and no numbered or bulleted line, so it is a
 * pointer rather than a procedure — and so `refusalLeaksProcedure` is false on
 * it. It is deliberately **not** refusal styling downstream either: a technician
 * who reads this as a refusal will assume the values were withheld, and they
 * were not.
 */
export const HAZARD_ADJACENT_NOTE =
  'Some of these figures belong to work that is governed by certification training, ' +
  'company procedure and the manufacturer’s published sequence — those govern the ' +
  'work itself, whatever the numbers say.';

// ---------------------------------------------------------------------------
// Validation — the part that makes a fabricated citation impossible
// ---------------------------------------------------------------------------

/**
 * Turn the model's JSON into the response shape the app renders, dropping anything
 * it cannot prove.
 *
 * A step whose `source` does not resolve is dropped, not repaired: a claim we
 * cannot attach to a page is precisely the defect the brief calls acceptance-
 * critical. If every step is dropped, the answer degrades to "no documentation"
 * rather than being emitted uncited.
 *
 * @returns {{kind:string, body:string, citations:Array, dropped:number}}
 */
export function validateAnswer(json, sources, { noDocumentationBody = NO_DOCUMENTATION } = {}) {
  const byIndex = new Map(sources.map((s) => [s.n, s]));

  /**
   * The one degradation, used by every branch below.
   *
   * ST-R09 AC 8: the empty-retrieval path and this one must produce the *same*
   * body, so a technician cannot tell which internal path they hit — and neither
   * reads as an error. `noDocumentationBody` is the scoped variant when there is
   * a scope, and today's byte-unchanged constant when there is not.
   */
  const withhold = (dropped) => ({
    kind: 'answer',
    body: noDocumentationBody,
    citations: [],
    dropped,
    noDocumentation: true,
  });

  /*
   * ST-R10 — the guard, which is the price of the widening.
   *
   * SYSTEM rule 5 now *prefers* a question to a withhold when the symptom is
   * under-specified, which increases traffic through the one channel that is
   * citation-free by design. That is a real widening, and it is paid for here: a
   * question that has grown a claim has stopped being a question.
   *
   * Three structural requirements, and a failure degrades to no-documentation
   * rather than being emitted:
   *
   *   - no numbered or bulleted line (`refusalLeaksProcedure`, the same check the
   *     refusal path runs);
   *   - no `Reading:` marker, which is the shape a smuggled step takes here;
   *   - ends with `?` after trimming.
   *
   * What this cannot catch is a claim smuggled *inside* the phrasing — "Is the
   * 3-flash code on the ignition board indicating flame-sense failure?" is a
   * question by punctuation that asserts a diagnosis. That is not structurally
   * detectable, only scored, and it is routed to ST-R19 AC 4 rather than
   * pretended to be a unit test here. The structural guard catches the shape;
   * the eval catches the content.
   */
  if (json?.kind === 'clarify' && json.question) {
    const question = String(json.question).trim();
    const shaped =
      question.endsWith('?') &&
      !refusalLeaksProcedure(question) &&
      !/\breading\s*:/i.test(question);
    // A question makes no claim, so it needs no citation — provided it is still
    // a question. Steps arriving alongside a clarify are discarded either way.
    if (shaped) return { kind: 'clarify', body: question, citations: [], dropped: 0 };
    return withhold(0);
  }

  /*
   * ST-R05 — the reference shape.
   *
   * Citation-**bound**, not citation-exempt. Every item resolves through the same
   * `byIndex` map a step does, an unresolvable item is dropped exactly as a step
   * is, and an answer with zero surviving items degrades exactly as today. It
   * does not widen the F2 channel by one byte.
   *
   * The extra drop rule is the one that keeps it a datum rather than a procedure:
   * **an item with no `value` is dropped.** "Terminate the conductors" has no
   * value; "35 in-lb" does. Combined with the schema having no `action` field,
   * there is no slot in which an instruction could arrive.
   */
  if (json?.kind === 'reference') {
    const items = Array.isArray(json?.specs) ? json.specs : [];
    const kept = [];
    let dropped = 0;

    for (const item of items) {
      const source = byIndex.get(Number(item?.source));
      const spec = String(item?.spec ?? '').trim();
      const value = String(item?.value ?? '').trim();
      if (!source || !spec || !value) { dropped++; continue; }
      kept.push({ spec, value, condition: String(item?.condition ?? '').trim(), source });
    }

    if (kept.length === 0) return withhold(dropped);

    const lines = kept.map((s) => `${s.spec} — ${s.value}${s.condition ? ` (${s.condition})` : ''}`);
    // When any surviving spec names hazardous equipment, one constant sentence is
    // appended. Server text, no model, no steps — and the list it is appended to
    // is still the cited data.
    const hazardAdjacent = kept.some((s) => HAZARD_DOMAIN_PATTERNS.some((re) => re.test(s.spec)));

    const body = [
      json.preamble ? String(json.preamble).trim() : null,
      lines.join('\n'),
      hazardAdjacent ? HAZARD_ADJACENT_NOTE : null,
    ].filter(Boolean).join('\n\n');

    return {
      kind: 'answer',
      shape: 'reference',
      body,
      // Byte-identical citation contract — the same seven fields, built the same
      // way. `03-backend-fixes.md` §2.2 is unchanged by this story.
      citations: kept.map((s, i) => ({
        source_document: s.source.document,
        page: s.source.page,
        // The claim is the whole datum, spec and value together. A citation whose
        // claim was the spec alone would not let ST-R07 AC 4 check that the cited
        // page actually contains the number that was reported.
        claim: `${s.spec} — ${s.value}`,
        ordinal: i + 1,
        chunk_id: s.source.chunkId ?? null,
        snippet: s.source.text,
        verified: 'exact',
      })),
      dropped,
    };
  }

  const steps = Array.isArray(json?.steps) ? json.steps : [];
  const kept = [];
  let dropped = 0;

  for (const step of steps) {
    const source = byIndex.get(Number(step?.source));
    if (!source || !step?.action) { dropped++; continue; }
    kept.push({ ...step, source });
  }

  if (json?.kind === 'no_documentation' || kept.length === 0) {
    return withhold(dropped);
  }

  const body = [
    json.preamble ? String(json.preamble).trim() : null,
    ...kept.map((s, i) => {
      const rules = s.rules_out ? ` ${String(s.rules_out).trim()}` : '';
      return `${i + 1}. ${s.action.trim()}\n   Reading: ${String(s.reading ?? '').trim()}${rules}`;
    }),
  ]
    .filter(Boolean)
    .join('\n\n');

  const citations = kept.map((s, i) => ({
    source_document: s.source.document,
    page: s.source.page,
    claim: s.action.trim(),
    ordinal: i + 1,
    // M9 — the supporting passage, persisted so tapping a citation shows the
    // text without the PDF on the device. In this design the snippet is the
    // retrieved chunk itself: it comes from the database, never from the model,
    // so 'exact' here means "IS the source", stronger than a copy that survived
    // comparison. If a model-copied-span design ever replaces source-index
    // anchoring, spans that only fuzzy-match must persist as 'fuzzy' instead.
    chunk_id: s.source.chunkId ?? null,
    snippet: s.source.text,
    verified: 'exact',
  }));

  return { kind: 'answer', body, citations, dropped };
}

// Listing the manufacturers of whatever happened to be retrieved read as
// "closest matches in the corpus: Trane, Carrier" on a Daikin question — which
// implies a relationship that does not exist. A fixed sentence is both shorter
// and more honest.
/*
 * The middle sentence used to name the scope: "Phase 1 covers Trane Precedent and
 * Carrier 48/50 light-commercial rooftop units". That went **false** on 7 Aug 2026
 * when the manufacturer limit was dropped and the corpus grew to fifteen makers —
 * a technician holding a Lennox unit was being told, in the app, that we only cover
 * Trane and Carrier. Worse than unhelpful: it is the kind of sentence that sends
 * someone away from a manual we actually hold.
 *
 * It is now written so it cannot go stale, because a hardcoded inventory in a
 * response string has no way of knowing the inventory changed. The unit gate is
 * where coverage is stated, and `classifyUnit` builds that from the live documents
 * table — one place that knows, rather than two where one is guessing.
 */
const NO_DOCUMENTATION =
  "I don't have documentation covering that.\n\n" +
  'I can only answer from the manuals in my library, and none of them cover this ' +
  'unit. If you tell me the make and model off the nameplate I can say straight ' +
  'away whether I have it.\n\n' +
  "I'd rather tell you I don't know than guess at equipment I can't cite.";

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * ST-02 — the unit-required gate copy. Ready to render, like NO_DOCUMENTATION.
 * The app's client-side gate (`app/lib/diagnose.ts:201-205`) used to be the only
 * thing standing between a unitless request and an unscoped answer; this makes
 * the server refuse to spend retrieval and model quota on an answer the client
 * is guaranteed to discard — and removes the "one client bug from rendering
 * ungrounded output" failure mode. Run C adopts this shape; no app change now.
 */
/*
 * ST-R20 — the third sentence used to read:
 *
 *   "Phase 1 covers Trane Precedent and Carrier 48/50 light-commercial rooftop
 *    units."
 *
 * It went **false** on 7 Aug 2026 when the corpus grew to fifteen manufacturers.
 * `NO_DOCUMENTATION` was rewritten that day so it could not go stale; this one
 * was missed and kept the claim for nine days, telling a technician holding a
 * unit we hold the manual for that we do not cover it.
 *
 * It is **dropped**, not rewritten. The alternative — deriving it from
 * `coveredFamilies` the way `classifyUnit` does — needs the documents table, and
 * this gate is reached precisely when there is no unit and no database round trip
 * has happened yet; buying a select to name a list the very next screen states
 * properly would be two places that know the inventory instead of one.
 *
 * The unit gate's job is to ask the question. `classifyUnit`'s verdict answers
 * "what is covered" from the live corpus a moment later, and that is the single
 * place a coverage claim is made (hard constraint 2).
 */
const UNIT_REQUIRED =
  'Which unit are you working on?\n\n' +
  'Tell me the manufacturer and model — or capture the nameplate — and I’ll ' +
  'ground every step in that unit’s own documentation.\n\n' +
  'I’ll tell you straight away whether I hold anything for that unit — and if I ' +
  'don’t, I’ll say so rather than answer from a manual for something else.';

/**
 * ST-04, fail-closed half: a scope containing ids the corpus does not know is an
 * error, never a silent widening. The alternative — letting unknown ids ride
 * into the RPC — would return rows for whatever known ids remain (or none), and
 * a mistyped id would quietly produce an unscoped-looking-but-wrong diagnosis.
 */
async function assertKnownDocumentIds(documentIds, db) {
  const client = db ?? supabaseAdmin();
  // ST-R09: `doc_type` and `in_scope` ride along on the round trip that was
  // already happening. The scoped withhold has to say what the scope actually
  // holds, and buying a second select to learn it would be a second place that
  // knows the inventory. A stub that returns only `id` still works — the
  // composer degrades to the count alone.
  const { data, error } = await client.from('documents').select('id, doc_type, in_scope').in('id', documentIds);
  if (error) throw new DiagnoseError(502, `document id check failed: ${error.message}`);
  const known = new Set((data ?? []).map((r) => r.id));
  const unknown = documentIds.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new DiagnoseError(400, `unknown document id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  }
  return data ?? [];
}

/**
 * ST-R08 AC 9 — the `documents` facts the capability answer is composed from.
 *
 * Read here rather than at 1d because `classifyMeta` runs **before** the unit
 * gate (a capability question is not a request for a diagnosis and must not be
 * answered with "which unit are you working on?"), so the scope check has not
 * happened yet.
 *
 * **Every failure degrades to the unscoped body, never to an error.** A
 * technician asking what the app can do has asked the one question that must
 * never come back as a transport failure, and there is a truthful thing to say
 * without the database — the whole point of the third degradation step.
 */
async function readCoverageFacts(documentIds, db) {
  const client = db ?? supabaseAdmin();
  const scoped = Array.isArray(documentIds) && documentIds.length > 0;
  try {
    if (scoped) {
      const { data, error } = await client.from('documents').select('id, doc_type, in_scope').in('id', documentIds);
      if (error) return { scope: null, families: [] };
      return { scope: summariseScope(data ?? []), families: [] };
    }
    const { data, error } = await client
      .from('documents').select('id, manufacturer, coverage, doc_type, in_scope');
    if (error) return { scope: null, families: [] };
    const { coveredFamilies } = await import('./units.mjs');
    return { scope: null, families: coveredFamilies(data ?? []) };
  } catch {
    return { scope: null, families: [] };
  }
}

/**
 * ST-R17 — the validated suggestions for this scope, or `[]`.
 *
 * The capability answer and the `/unit-suggestions` route read the **same**
 * rows, so neither can name a question the other would not serve: a capability
 * answer is a coverage claim, and two definitions of "what we can answer" is two
 * chances for one of them to be wrong.
 *
 * `sql/018` is BLOCKED on the owner. Until it is applied the select fails and
 * this returns `[]`, which degrades the capability answer to step 2 — the
 * coverage statement alone. Never an error, and never the old hardcoded
 * taxonomy.
 */
async function readSuggestions(documentIds, db, limit) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return [];
  try {
    const { suggestionsForScope } = await import('./suggestions.mjs');
    return await suggestionsForScope(documentIds, { db, limit });
  } catch {
    return [];
  }
}

/**
 * @param {{symptom: string, equipment?: string, history?: Array,
 *          documentIds?: string[], topK?: number}} req
 *        `documentIds` is the resolved unit's scope from POST /resolve-unit
 *        (OQ1 default). Absent/undefined ⇒ unitless; [] ⇒ "unit resolved to
 *        zero documents" and short-circuits to no-documentation before any RPC,
 *        because the sql/007 contract treats [] as UNFILTERED at the function.
 * @param {{db?: object, completeFn?: Function, embedFn?: Function,
 *          allowUnscoped?: boolean}} deps
 *        Test injection only — the serve path never passes deps, so a client
 *        cannot reach the unscoped path through the wire. `allowUnscoped`
 *        defaults from ALLOW_UNSCOPED_DIAGNOSE=1 (documented test-path flag,
 *        per ST-02/OQ1: absent scope is legal only on test paths).
 * @returns {Promise<{kind:'answer'|'clarify'|'refusal'|'unit_required'|'conversational', body:string,
 *                    citations:Array<{source_document:string,page:number,claim:string,ordinal:number}>,
 *                    meta:object}>}
 */
export async function diagnose(
  { symptom, equipment, history = [], documentIds, topK = TOP_K, image, images, mimeType } = {},
  { db, completeFn = complete, embedFn, allowUnscoped = process.env.ALLOW_UNSCOPED_DIAGNOSE === '1' } = {}
) {
  const started = Date.now();
  if (!symptom || !String(symptom).trim()) {
    throw new DiagnoseError(400, 'symptom is required');
  }
  if (documentIds !== undefined &&
      (!Array.isArray(documentIds) || documentIds.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new DiagnoseError(400, 'documentIds must be an array of document id strings');
  }

  // The wire's `history` is client-controlled; sanitize it before it is read by
  // anything. This strips forged `role:'system'` turns (which the Gemini adapter
  // would otherwise lift into the system instruction) and any structured `parts`,
  // leaving only user/assistant string turns.
  const cleanHistory = sanitizeHistory(history);

  // 1. Safety gate, before retrieval and before the model — and before the unit
  // gate, deliberately: U7's safety escape sends unitless hazard requests here
  // and must keep getting the deterministic refusal (ST-02).
  //
  // Over every user-authored turn, not just `symptom`: the gate is the advise-only
  // guardrail's non-negotiable layer, and a hazardous request placed in a history
  // turn used to route straight around it. Each text is classified independently so
  // a procedural verb in one turn cannot fuse with a domain noun in another into a
  // refusal neither earned; `symptom` stays first, so its verdict wins unchanged
  // when there is no history.
  const hazard =
    [symptom, ...cleanHistory.filter((m) => m.role === 'user').map((m) => m.content)]
      .map(classifyHazard)
      .find(Boolean) ?? null;
  if (hazard) {
    const body = refusalBody(hazard);
    if (refusalLeaksProcedure(body)) {
      throw new DiagnoseError(500, 'refusal body contained procedure — refusing to emit it');
    }
    return {
      kind: 'refusal',
      body,
      citations: [],
      // ST-09: every meta carries usage/latency/attempts, with explicit zeros
      // on paths that never spend a token — absent would read as
      // "uninstrumented", and the ledger keys off `model: null` to know this
      // response cost no quota.
      meta: {
        category: hazard.category, trigger: hazard.trigger, noDocumentation: false, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs: 0, generationMs: 0 },
        usage: zeroUsage(), attempts: 0, model: null,
      },
    };
  }

  /*
   * 1a. Conversational reply (F2, ST-F05).
   *
   * Position is the whole design and it is not adjustable: **after** the hazard
   * gate, **before** the unit gate and everything downstream of it.
   *
   *  - After the gate, because "thanks, I'll just jumper the safety out" is small
   *    talk with a hazard inside it. A conversational path that ran first would be
   *    a way around a refusal, which is a guardrail regression, not a feature.
   *    `diagnose.conversation.test.mjs` proves this with `completeFn` and
   *    `embedFn` rigged to throw: the refusal must be reached with no model call
   *    and no retrieval, not merely look right.
   *  - Before the unit gate, because "that worked" is not a request for a
   *    diagnosis and must not be answered with "which unit are you working on?".
   *    It also means zero retrieval, zero embedding and zero model quota — the
   *    cost half of what the owner reported.
   *
   * Only `symptom` is classified, never history: history is what the *hazard*
   * gate reads (a hazardous turn anywhere still refuses, above), whereas the
   * conversational verdict is about the message actually being sent now.
   *
   * The body is a constant. The model is never asked to author it and
   * `RESPONSE_SCHEMA` is deliberately not extended with this kind, so there is no
   * route by which uncited diagnostic prose could arrive wearing this label.
   */
  const conversational = classifyConversational(symptom);
  if (conversational) {
    const body = conversationalBody(conversational);
    // The same post-check the refusal path runs. A canned body cannot grow a
    // procedure today; this is what notices if someone later makes it dynamic.
    if (refusalLeaksProcedure(body)) {
      throw new DiagnoseError(500, 'conversational body contained procedure — refusing to emit it');
    }
    return {
      kind: 'conversational',
      body,
      citations: [],
      // ST-09's zeroed shape, key for key: `serve.mjs`'s ledger reads every one
      // of these, and `model: null` is how it knows this response cost no quota.
      meta: {
        intent: conversational.intent, retrieved: 0, dropped: 0,
        noDocumentation: false, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs: 0, generationMs: 0 },
        usage: zeroUsage(), attempts: 0, model: null,
      },
    };
  }

  /*
   * 1a′. Meta turns — capability, installation scope, presence (N3, ST-R08).
   *
   * Position is as load-bearing as 1a's and for the same reasons, one step
   * further along:
   *
   *  - **After the hazard gate**, absolutely. "How do I install it and braze the
   *    line set" is an installation request with a refusal inside it, and a
   *    redirect that ran first would be a way around the guardrail.
   *    `classifyMeta` re-checks `classifyHazard` itself, so a caller that wires
   *    the order wrong still cannot get a redirect out of a hazardous request.
   *  - **After `classifyConversational`**, because "hey" is a greeting before it
   *    is a presence check, and the narrower classifier should win.
   *  - **Before the unit gate**, because "what can you help with?" is not a
   *    request for a diagnosis and must not be answered with "which unit are you
   *    working on?" — which is exactly what it gets today, or worse, the
   *    no-documentation message for a question nobody asked.
   *
   * The model authors none of this. `RESPONSE_SCHEMA` is not extended and
   * `validateAnswer` gains no branch for these intents, so there is no route by
   * which uncited diagnostic prose could arrive wearing one of these labels. The
   * only variable content in a capability body comes from `documents` columns.
   */
  const meta = classifyMeta(symptom);
  if (meta) {
    let body = META_BODIES[meta.intent];
    if (meta.intent === 'capability') {
      const { scope, families } = await readCoverageFacts(documentIds, db);
      // ST-R17: the same validated rows /unit-suggestions serves. [] until
      // sql/018 is applied, which degrades to the coverage statement alone.
      const suggestions = scope?.count ? await readSuggestions(documentIds, db, CAPABILITY_SUGGESTIONS) : [];
      body = capabilityBody({ scope, families, suggestions, maxSuggestions: CAPABILITY_SUGGESTIONS });
    }
    if (refusalLeaksProcedure(body)) {
      throw new DiagnoseError(500, 'meta body contained procedure — refusing to emit it');
    }
    return {
      kind: 'conversational',
      body,
      citations: [],
      // ST-R08 AC 8/10 — the zeroed shape key for key, and **no `category` and no
      // `trigger`**: this is a redirect, not a refusal, and nothing downstream may
      // count it as one or render it in refusal styling.
      meta: {
        intent: meta.intent, retrieved: 0, dropped: 0,
        noDocumentation: false, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs: 0, generationMs: 0 },
        usage: zeroUsage(), attempts: 0, model: null,
      },
    };
  }

  // 1b. Unit gate (ST-02). A non-hazard request with no equipment context gets
  // the fourth deliberate shape — not a refusal, not a provider block, not a
  // transport error — and costs zero retrieval and zero model quota.
  const scoped = Array.isArray(documentIds);
  const hasEquipment = Boolean(equipment && String(equipment).trim());
  if (!scoped && !hasEquipment && !allowUnscoped) {
    return {
      kind: 'unit_required',
      body: UNIT_REQUIRED,
      citations: [],
      meta: {
        retrieved: 0, dropped: 0, noDocumentation: false, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs: 0, generationMs: 0 },
        usage: zeroUsage(), attempts: 0, model: null,
      },
    };
  }

  // 1c. Empty scope (ST-04). documentIds: [] means the unit resolved to zero
  // documents. The sql/007 contract is explicit that [] at the RPC means
  // *unfiltered*, so this must never reach retrieval: it is the honest
  // no-documentation answer, decided before any RPC or model call.
  if (scoped && documentIds.length === 0) {
    return {
      kind: 'answer',
      body: NO_DOCUMENTATION,
      citations: [],
      meta: {
        retrieved: 0, dropped: 0, noDocumentation: true, scopedTo: 0, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs: 0, generationMs: 0 },
        usage: zeroUsage(), attempts: 0, model: null,
      },
    };
  }

  // 1d. Fail closed on ids the corpus does not know (ST-04).
  const scopeRows = scoped ? await assertKnownDocumentIds(documentIds, db) : [];

  /*
   * ST-R09 — the withhold, scoped.
   *
   * `NO_DOCUMENTATION` stays byte-unchanged for the unscoped case. When there IS
   * a scope, it is replaced by a body composed from the `documents` rows just
   * read, because the constant is *wrong* on this path and was wrong on the third
   * turn of the 16 Aug session: it says "none of them cover this unit" and asks
   * for a nameplate, to a technician who had already resolved a unit to 33
   * documents. It asked for something already given and stated something false.
   *
   * The withhold is still a withhold. `meta.noDocumentation` stays `true`, which
   * is what keeps ST-R01's log honest — only the words changed.
   */
  const scopeFacts = scoped && scopeRows.length ? summariseScope(scopeRows) : null;
  const withholdBody = scopeFacts?.count ? scopedNoDocumentationBody(scopeFacts) : NO_DOCUMENTATION;

  /*
   * OQ-R11 — the continuation query.
   *
   * `retrieve()` embedded `symptom` and only `symptom`. `history` reached the
   * model but never the embedder, so the turn after a `clarify` embedded the
   * technician's bare reply — "yes", "3 flashes", "about 38" — which is close to
   * no query at all. Eight chunks came back at ~0.62 because *something* always
   * comes back, and the model then correctly declined to build a diagnosis from
   * them. That is the mechanism behind the session's third turn.
   *
   * The merge is deliberately narrow: only when the immediately preceding turn is
   * the assistant's, and only when the reply is short enough to be a fragment.
   * **Only the embedding input changes.** `buildPrompt` still receives the
   * technician's own words as TECHNICIAN'S SYMPTOM, the scope is untouched, the
   * gates are untouched, and the citation rules are untouched. If a later stage
   * measures this making retrieval worse, delete the branch — the fallback is
   * today's behaviour exactly.
   */
  const lastTurn = cleanHistory[cleanHistory.length - 1];
  const isContinuation =
    lastTurn?.role === 'assistant' &&
    String(symptom).trim().split(/\s+/).filter(Boolean).length <= CONTINUATION_MAX_WORDS;
  const retrievalQuery = isContinuation ? `${lastTurn.content} ${symptom}` : symptom;

  // 2 & 3. Retrieve, and admit an empty corpus rather than inventing around it.
  // ST-09: the retrieval phase (query embedding + RPC, including any sql/007
  // fallback retry) is timed separately from generation so criterion 9's
  // latency numbers say where the time went. The id check above rides outside
  // both phases; it is visible as latencyMs minus the two.
  const tRetrieve = Date.now();
  const { chunks, scopeFallback, queryEmbedTokens } = await retrieve(retrievalQuery, { topK, db, documentIds: scoped ? documentIds : undefined, embedFn });
  const retrievalMs = Date.now() - tRetrieve;
  const scopeMeta = scoped ? { scopedTo: documentIds.length, ...(scopeFallback ? { scopeFallback: true } : {}) } : {};
  const sources = buildSources(chunks);
  if (!sources.length) {
    return {
      kind: 'answer',
      // ST-R09 AC 8: the same body the `validateAnswer` degradation produces, so
      // a technician cannot tell which internal path they hit — and neither of
      // them reads as an error.
      body: withholdBody,
      citations: [],
      meta: {
        retrieved: 0, dropped: 0, noDocumentation: true, ...scopeMeta, mode: MODE,
        latencyMs: Date.now() - started, latency: { retrievalMs, generationMs: 0 },
        // The query WAS embedded — that spend is real even when nothing came back.
        usage: { ...zeroUsage(), embedTokens: queryEmbedTokens }, attempts: 0, model: null,
      },
    };
  }

  /*
   * ST-17 — validate and downscale the attached photo, if there is one.
   *
   * Deliberately here, *after* the safety gate and the coverage short-circuit: a
   * hazardous question with a photo attached must still refuse without decoding
   * anything, and an uncovered unit must not pay image processing to be told there
   * is no documentation. `prepareImage` is the same routine `/identify-unit` uses,
   * so there is one implementation of the decode and size rules, not two.
   */
  const attached = normalizePhotos({ image, images });
  let photos = [];
  if (attached.length) {
    // Imported lazily, and that is not laziness: `vision.mjs` imports DiagnoseError
    // from this module, so a static import back would close a cycle between the two
    // core modules. Resolved at call time — by which point both are fully evaluated
    // — and only on turns that actually carry a photo.
    const { prepareImage } = await import('./vision.mjs');
    photos = attached.map((one) => {
      const { sent } = prepareImage(one, mimeType ?? 'image/jpeg');
      return { base64: Buffer.from(sent.data).toString('base64'), width: sent.width, height: sent.height };
    });
  }

  // 4. Generate. Uses the sanitized history — the raw wire array never reaches the
  // model's turn list.
  const { system, messages } = buildPrompt({ symptom, equipment, sources, history: cleanHistory, photos });
  const tGenerate = Date.now();
  let res;
  try {
    // 2048 (the adapter's default) truncates a five-step answer mid-JSON, and a
    // truncated structured response surfaces as an unhelpful parse error rather
    // than "the answer was too long". Measured: a full ranked answer runs
    // 700–1200 output tokens, so this is headroom, not extravagance.
    res = await completeFn({
      system,
      messages,
      json: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 4096,
    });
  } catch (e) {
    if (e instanceof ProviderError) {
      const truncated = /not valid JSON/i.test(e.message);
      throw new DiagnoseError(
        e.status || 502,
        truncated ? `${e.message} (most likely truncated — raise maxOutputTokens)` : e.message,
        // ST-09: a call that failed here still burned quota attempts — the
        // serve ledger counts it via this flag (metrics.quotaConsumedByError).
        { modelCallAttempted: true, attempts: e.attempts ?? 1 }
      );
    }
    throw e;
  }
  const generationMs = Date.now() - tGenerate;

  // A provider safety block is an ERROR, never a refusal (brief, Amendment 1).
  // Ours is deliberate and cited; theirs is the system failing to answer.
  if (res.blocked) {
    throw new DiagnoseError(502, `provider safety block (${res.blockReason})`, {
      providerBlocked: true,
      blockReason: res.blockReason,
      // ST-09: a blocked call consumed quota and tokens; surface both so the
      // ledger and the block-rate report (M12) read off real numbers.
      modelCallAttempted: true,
      usage: normalizeUsage({ ...res.usage, embedTokens: queryEmbedTokens }),
      model: res.model,
      modelFallback: res.fallback ?? false,
      attempts: res.attempts ?? 1,
    });
  }

  // 5. Validate.
  const validated = validateAnswer(res.json, sources, { noDocumentationBody: withholdBody });

  // Destructured rather than spread on purpose. `noDocumentation` and `dropped`
  // are diagnostics about the answer, not part of it, and an earlier version
  // leaked them at the top level here while the empty-retrieval path above put
  // them in `meta` — two places for one fact, which is exactly the kind of thing
  // Run C would build against and then have break under it.
  const { kind, body, citations, dropped, noDocumentation, shape } = validated;

  return {
    kind,
    body,
    citations,
    meta: {
      retrieved: sources.length,
      dropped,
      noDocumentation: Boolean(noDocumentation),
      // OQ-R2 — a reference answer rides on `kind:'answer'` and says what it is
      // in `meta.shape`. It IS an answer: cited, validated, degradable, so
      // `Message.tsx`'s uncited-defect net must stay in front of it, and reusing
      // the kind is what guarantees that. Absent on every other shape.
      ...(shape ? { shape } : {}),
      ...scopeMeta,
      mode: MODE,
      model: res.model,
      modelFallback: res.fallback ?? false,
      // ST-09: normalised so the four token fields (input/output/total/
      // cachedContentTokenCount) are always present, plus the Voyage query
      // spend — the serve ledger and cost projection read this block as-is.
      usage: normalizeUsage({ ...res.usage, embedTokens: queryEmbedTokens }),
      attempts: res.attempts ?? 1,
      finishReason: res.finishReason,
      latencyMs: Date.now() - started,
      latency: { retrievalMs, generationMs },
    },
  };
}
