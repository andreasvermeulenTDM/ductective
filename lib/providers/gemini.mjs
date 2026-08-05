/**
 * gemini.mjs — the Gemini adapter. M11.
 *
 * Raw `fetch`, not `@google/genai`. Voyage already works this way
 * (`lib/clients.mjs`), the repo root has exactly one runtime dependency,
 * `00-brief.md` asks for few dependencies, and the Supabase Edge Function needs a
 * Deno-compatible path regardless. The SDK buys nothing here.
 *
 * Nothing above `complete()` learns the provider's name. That is S4's criterion —
 * Stage 3 replaces a function body, it does not rewire callers.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Pinned, not `gemini-flash-latest`.
 *
 * `-latest` is a moving alias. Stage 5.5 compares each round's scores against the
 * previous one, and a model that changes underneath makes a regression
 * indistinguishable from a model swap — which is the one thing that reporting
 * exists to catch. Bump this deliberately, and re-baseline when you do.
 *
 * Verified callable on this account 4 Aug 2026. Note that *listed* is not
 * *callable*: `gemini-2.5-flash` appears in the model list and returns NOT_FOUND
 * ("no longer available to new users"), and `gemini-2.0-flash` returns
 * RESOURCE_EXHAUSTED. Do not trust the model list as a capability check.
 */
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/** 429/5xx are retried; everything else fails fast. Bounded — never unlimited. */
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A provider failure. Normalised to S4's `{status, message}` so callers never
 * pattern-match on Google's error envelope.
 */
export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/**
 * Map our message list onto Gemini's `contents`.
 *
 * Three things this owns, none of them cosmetic:
 *
 *  - `assistant` → `model`. Gemini's role name.
 *  - `system` is **lifted out** to top-level `systemInstruction`. Leaving it as a
 *    turn changes both caching and safety behaviour, so this is functional.
 *  - Consecutive same-role turns are **merged**. Gemini expects roles to
 *    alternate, and the clarify path (ask → answer → continue) naturally produces
 *    two user turns in a row.
 */
export function toContents(messages = []) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');

  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';

    // `parts` may already be structured (vision); a string is the common case.
    const parts = Array.isArray(m.parts)
      ? m.parts
      : [{ text: typeof m.content === 'string' ? m.content : String(m.content ?? '') }];

    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else contents.push({ role, parts });
  }

  return { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined };
}

/** A nameplate photo. Callers downscale server-side before this. */
export const imagePart = (base64, mimeType = 'image/jpeg') => ({
  inlineData: { mimeType, data: base64 },
});

/**
 * Was this response stopped by Google's safety filter?
 *
 * `00-brief-run-b.md` makes this a hard constraint: a provider block is an
 * **error**, never a refusal. Ours is a deliberate, cited safety answer rendered
 * in alert red; theirs is the system failing to answer. Collapsing them would put
 * Google's content policy behind Ductective's safety voice, and a technician
 * would read a filter artifact as considered guidance.
 *
 * Probed 4 Aug 2026 across gas/combustion, live electrical and refrigerant
 * prompts: no blocks. That is four prompts, not a measurement — M12 owns the real
 * block rate. This exists because it costs nothing and the failure is silent.
 */
function blockOf(json) {
  const promptBlock = json?.promptFeedback?.blockReason;
  if (promptBlock) return { blocked: true, reason: `prompt:${promptBlock}` };
  const finish = json?.candidates?.[0]?.finishReason;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
    return { blocked: true, reason: `candidate:${finish}` };
  }
  return { blocked: false, reason: null };
}

const textOf = (json) =>
  (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('');

async function post(path, body, apiKey) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(`${ENDPOINT}${path}`, {
        method: 'POST',
        // Header, never a query param: a key in a URL lands in logs and proxies.
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new ProviderError(0, `network: ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await sleep(BASE_DELAY_MS * 2 ** (attempt - 1)); continue; }
      throw lastErr;
    }

    if (res.ok) return res.json();

    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    lastErr = new ProviderError(res.status, `Gemini ${res.status}: ${detail.slice(0, 300)}`);
    if (retryable && attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

/**
 * @param {{system?: string, messages: any[], model?: string, json?: object,
 *          maxOutputTokens?: number, temperature?: number}} args
 * @returns {Promise<{text: string, json: any, model: string, stub: false,
 *                    usage: object, finishReason: string, blocked: boolean,
 *                    blockReason: string|null}>}
 */
export async function complete({
  system,
  messages = [],
  model = DEFAULT_MODEL,
  json: schema,
  maxOutputTokens = 2048,
  temperature,
} = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError(0, 'GEMINI_API_KEY is not set');

  const all = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const { contents, systemInstruction } = toContents(all);

  const generationConfig = { maxOutputTokens };
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }

  const body = { contents, generationConfig };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const res = await post(`/models/${model}:generateContent`, body, apiKey);

  const { blocked, reason } = blockOf(res);
  const text = textOf(res);
  const finishReason = res?.candidates?.[0]?.finishReason ?? null;

  let parsed = null;
  if (schema && text) {
    // A schema was requested and the response did not parse. Returning half an
    // object as if it were an answer is how a malformed response becomes a
    // confidently wrong one — surface it instead.
    try { parsed = JSON.parse(text); }
    catch { throw new ProviderError(502, 'structured output requested but response was not valid JSON'); }
  }

  return {
    text,
    json: parsed,
    model: res?.modelVersion ?? model,
    stub: false,
    usage: {
      inputTokens: res?.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res?.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: res?.usageMetadata?.totalTokenCount ?? 0,
    },
    finishReason,
    blocked,
    blockReason: reason,
  };
}
