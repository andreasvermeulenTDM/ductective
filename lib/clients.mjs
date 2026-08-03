// lib/clients.mjs — one place that decides real client vs. stub.
//
// Provisional rails for Run A (P1.1). The Backend agent (Stage 3) owns the real
// Anthropic and Voyage clients; this file exists so nothing downstream has to be
// rewritten when they land — only the two `TODO(Stage 3)` bodies get replaced.
//
// Design rule: a stub must never activate silently. Answer accuracy is this
// project's #1 stated risk, and a scored run that unknowingly graded canned text
// is worse than a run that failed outright. So stubs are opt-in, announce
// themselves once, and are recorded for later assertion via usedMocks().

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const STUBS_ALLOWED = process.env.ALLOW_STUBS === 'true';
const used = new Set();
const announced = new Set();

function announce(name) {
  used.add(name);
  if (announced.has(name)) return;
  announced.add(name);
  console.warn(
    `\n  ⚠  STUB ACTIVE: ${name} is returning fabricated data.\n` +
    `     Nothing produced from it is a real result. Set ${name.toUpperCase()}_API_KEY\n` +
    `     in .env to use the real service. See SETUP-BLOCKERS.md.\n`
  );
}

/** Names of every stub exercised this process. Stage 5/5.5 must assert this is empty. */
export function usedMocks() {
  return [...used];
}

function require_(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Run with --env-file=.env, or see .env.example.`);
  return v;
}

// ---------------------------------------------------------------------------
// Supabase — real, and the only client wired to a live service in Run A.
// ---------------------------------------------------------------------------

/**
 * Server-side client. Uses service_role, which bypasses row-level security —
 * never import this from anything that ships to the device.
 */
export function supabaseAdmin() {
  return createClient(
    require_('EXPO_PUBLIC_SUPABASE_URL'),
    require_('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ---------------------------------------------------------------------------
// Voyage — stubbed. Interface mirrors the real embeddings call.
// ---------------------------------------------------------------------------

/**
 * Model default. Verified live against the API, not assumed: voyage-3-large,
 * voyage-3.5, voyage-3.5-lite, voyage-4, voyage-4-lite and voyage-4-large all
 * return 1024 dimensions.
 *
 * voyage-4-large is the default on two grounds. It is the newer generation, and
 * retrieval accuracy is this project's #1 stated risk. It also carries 200M free
 * tokens where the voyage-3 family has none — the whole corpus embeds inside that
 * allowance, against a brief that caps a full re-ingest at $20. Choosing
 * voyage-3-large would mean paying $0.18/1M for an older model.
 *
 * **Stage 2.5 owns the final call** and must justify it against the smoke set.
 * Override with VOYAGE_MODEL to compare; re-embed everything when you switch,
 * because vectors from different models are not comparable.
 */
export const EMBED_MODEL = process.env.VOYAGE_MODEL || 'voyage-4-large';

/**
 * Vector width. Must match the live model exactly — a stored vector of the wrong
 * width is silent corruption, not a degraded case. Verified 1024 for all three
 * voyage-3 family models; re-check before switching to any other family.
 */
export const EMBED_DIM = 1024;

/** Voyage caps a request at 128 inputs. Larger batches are chunked, not rejected. */
const MAX_BATCH = 128;

/** Tokens billed this process, so ingestion can report real cost. */
let embedTokens = 0;
export function embedTokensUsed() {
  return embedTokens;
}

/**
 * @param {string[]} texts
 * @param {{inputType?: 'document'|'query'}} [opts]
 *   `inputType` is not cosmetic. Voyage embeds asymmetrically: corpus chunks go in
 *   as 'document' and searches as 'query', and mismatching them measurably costs
 *   recall. Ingestion must pass 'document'; the smoke set must pass 'query'.
 * @returns {Promise<{embeddings: number[][], model: string, stub: boolean, tokens: number}>}
 */
export async function embed(texts, { inputType = 'document' } = {}) {
  const key = process.env.VOYAGE_API_KEY;

  if (!key) {
    if (!STUBS_ALLOWED) {
      throw new Error(
        'VOYAGE_API_KEY is empty. Set it, or pass ALLOW_STUBS=true to run against the stub.'
      );
    }
    announce('voyage');

    // Deterministic from content, so the same chunk embeds identically across runs
    // and idempotency tests mean something. Cosine-normalised. Carries no semantics
    // whatsoever — retrieval quality measured against this is noise, by design.
    const embeddings = texts.map((t) => {
      const seed = createHash('sha256').update(t).digest();
      const v = Array.from({ length: EMBED_DIM }, (_, i) => (seed[i % seed.length] - 127.5) / 127.5);
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
    return { embeddings, model: 'stub-not-a-real-model', stub: true, tokens: 0 };
  }

  const embeddings = [];
  let tokens = 0;

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: batch, model: EMBED_MODEL, input_type: inputType }),
    });

    if (!res.ok) {
      // Surface the API's own message — a 400 here usually means a chunk exceeded
      // the token limit, and "embedding failed" would send Stage 2.5 hunting.
      const detail = await res.text().catch(() => '');
      throw new Error(`Voyage ${res.status} on batch ${i / MAX_BATCH}: ${detail.slice(0, 300)}`);
    }

    const json = await res.json();
    // Voyage returns results with an explicit index; do not assume input order.
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const d of ordered) {
      if (d.embedding.length !== EMBED_DIM) {
        throw new Error(
          `Voyage returned ${d.embedding.length} dims, expected ${EMBED_DIM}. ` +
            `Storing this would silently corrupt the index — fix EMBED_DIM and re-embed.`
        );
      }
      embeddings.push(d.embedding);
    }
    tokens += json.usage?.total_tokens ?? 0;
  }

  embedTokens += tokens;
  return { embeddings, model: EMBED_MODEL, stub: false, tokens };
}

// ---------------------------------------------------------------------------
// Anthropic — stubbed. Interface mirrors messages.create.
// ---------------------------------------------------------------------------

/**
 * @param {{system?: string, messages: {role: string, content: string}[]}} args
 * @returns {Promise<{text: string, model: string, stub: boolean}>}
 */
export async function complete({ messages }) {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error('TODO(Stage 3): real Anthropic client not implemented — key is set but unused.');
  }
  if (!STUBS_ALLOWED) {
    throw new Error(
      'ANTHROPIC_API_KEY is empty. Set it, or pass ALLOW_STUBS=true to run against the stub.'
    );
  }
  announce('anthropic');

  const last = messages.at(-1)?.content ?? '';
  return {
    text:
      `[STUB RESPONSE — not generated by Claude, contains no real diagnostic guidance]\n` +
      `Received ${last.length} characters. The round trip works; the answer does not exist yet.`,
    model: 'stub-not-a-real-model',
    stub: true,
  };
}
