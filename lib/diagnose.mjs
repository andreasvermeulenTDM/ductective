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
import { complete, ProviderError } from './providers/gemini.mjs';
import { classifyHazard, refusalBody, refusalLeaksProcedure } from './safety.mjs';

const TOP_K = 8;

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

export async function retrieve(symptom, { topK = TOP_K, mode = MODE, db = supabaseAdmin() } = {}) {
  // `query`, not `document` — Voyage embeds asymmetrically and mismatching the two
  // costs recall measurably. Ingestion embeds chunks as documents; this is a search.
  const { embeddings } = await embed([symptom], { inputType: 'query' });
  const vector = embeddings[0];

  let data, error;
  if (mode === 'hybrid') {
    ({ data, error } = await db.rpc('match_chunks_hybrid', {
      query_embedding: vector,
      query_text: symptom,
      match_count: topK,
    }));
    // PGRST202 / 42883 = the migration isn't applied. Fall back rather than fail;
    // anything else is a real error and should surface.
    if (error && !/PGRST202|42883|does not exist|could not find/i.test(`${error.code} ${error.message}`)) {
      throw new DiagnoseError(502, `retrieval failed: ${error.message}`);
    }
  }

  if (mode !== 'hybrid' || error) {
    ({ data, error } = await db.rpc('match_chunks', {
      query_embedding: vector,
      match_count: topK,
    }));
    if (error) throw new DiagnoseError(502, `retrieval failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((r) => r.out_in_scope !== false)
    .map((r) => ({
      document: r.out_document,
      documentId: r.out_document_id,
      page: r.out_page,
      text: r.out_text,
      manufacturer: r.out_manufacturer,
      similarity: r.out_similarity,
    }));
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
  '6. If the sources do not cover the equipment or symptom, say so plainly.',
].join('\n');

/** Numbered sources. The index is the only citation handle the model ever sees. */
export function buildSources(chunks) {
  return chunks.map((c, i) => ({ n: i + 1, ...c }));
}

export function buildPrompt({ symptom, equipment, sources, history = [] }) {
  const context = sources
    .map((s) => `[${s.n}] ${s.document} — page ${s.page}\n${s.text}`)
    .join('\n\n');

  const preamble = equipment ? `EQUIPMENT: ${equipment}\n\n` : '';
  const user =
    `${preamble}SOURCES:\n\n${context}\n\n` +
    `TECHNICIAN'S SYMPTOM: ${symptom}\n\n` +
    'Respond using the required JSON schema. Cite only the source numbers above.';

  return { system: SYSTEM, messages: [...history, { role: 'user', content: user }] };
}

/** Gemini structured-output schema. Keeps the parser honest — no free-text parsing. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['answer', 'clarify', 'no_documentation'] },
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
  },
  required: ['kind'],
};

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
export function validateAnswer(json, sources) {
  const byIndex = new Map(sources.map((s) => [s.n, s]));

  if (json?.kind === 'clarify' && json.question) {
    // A question makes no claim, so it needs no citation.
    return { kind: 'clarify', body: String(json.question).trim(), citations: [], dropped: 0 };
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
    return {
      kind: 'answer',
      body: noDocumentationBody(sources),
      citations: [],
      dropped,
      noDocumentation: true,
    };
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
  }));

  return { kind: 'answer', body, citations, dropped };
}

function noDocumentationBody(sources) {
  const covered = [...new Set(sources.map((s) => s.manufacturer).filter(Boolean))];
  return (
    "I don't have documentation covering that.\n\n" +
    'Phase 1 covers Trane Precedent and Carrier 48/50 light-commercial rooftop ' +
    'units, plus the pressure-temperature charts' +
    (covered.length ? ` (closest matches in the corpus: ${covered.join(', ')})` : '') +
    ".\n\nI'd rather tell you I don't know than guess at equipment I can't cite."
  );
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * @param {{symptom: string, equipment?: string, history?: Array, topK?: number}} req
 * @returns {Promise<{kind:'answer'|'clarify'|'refusal', body:string,
 *                    citations:Array<{source_document:string,page:number,claim:string,ordinal:number}>,
 *                    meta:object}>}
 */
export async function diagnose({ symptom, equipment, history = [], topK = TOP_K } = {}) {
  const started = Date.now();
  if (!symptom || !String(symptom).trim()) {
    throw new DiagnoseError(400, 'symptom is required');
  }

  // 1. Safety gate, before retrieval and before the model.
  const hazard = classifyHazard(symptom);
  if (hazard) {
    const body = refusalBody(hazard);
    if (refusalLeaksProcedure(body)) {
      throw new DiagnoseError(500, 'refusal body contained procedure — refusing to emit it');
    }
    return {
      kind: 'refusal',
      body,
      citations: [],
      meta: { category: hazard.category, trigger: hazard.trigger, noDocumentation: false, mode: MODE, latencyMs: Date.now() - started, model: null },
    };
  }

  // 2 & 3. Retrieve, and admit an empty corpus rather than inventing around it.
  const chunks = await retrieve(symptom, { topK });
  const sources = buildSources(chunks);
  if (!sources.length) {
    return {
      kind: 'answer',
      body: noDocumentationBody([]),
      citations: [],
      meta: { retrieved: 0, dropped: 0, noDocumentation: true, mode: MODE, latencyMs: Date.now() - started, model: null },
    };
  }

  // 4. Generate.
  const { system, messages } = buildPrompt({ symptom, equipment, sources, history });
  let res;
  try {
    // 2048 (the adapter's default) truncates a five-step answer mid-JSON, and a
    // truncated structured response surfaces as an unhelpful parse error rather
    // than "the answer was too long". Measured: a full ranked answer runs
    // 700–1200 output tokens, so this is headroom, not extravagance.
    res = await complete({
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
        truncated ? `${e.message} (most likely truncated — raise maxOutputTokens)` : e.message
      );
    }
    throw e;
  }

  // A provider safety block is an ERROR, never a refusal (brief, Amendment 1).
  // Ours is deliberate and cited; theirs is the system failing to answer.
  if (res.blocked) {
    throw new DiagnoseError(502, `provider safety block (${res.blockReason})`, {
      providerBlocked: true,
      blockReason: res.blockReason,
    });
  }

  // 5. Validate.
  const validated = validateAnswer(res.json, sources);

  // Destructured rather than spread on purpose. `noDocumentation` and `dropped`
  // are diagnostics about the answer, not part of it, and an earlier version
  // leaked them at the top level here while the empty-retrieval path above put
  // them in `meta` — two places for one fact, which is exactly the kind of thing
  // Run C would build against and then have break under it.
  const { kind, body, citations, dropped, noDocumentation } = validated;

  return {
    kind,
    body,
    citations,
    meta: {
      retrieved: sources.length,
      dropped,
      noDocumentation: Boolean(noDocumentation),
      mode: MODE,
      model: res.model,
      usage: res.usage,
      finishReason: res.finishReason,
      latencyMs: Date.now() - started,
    },
  };
}
