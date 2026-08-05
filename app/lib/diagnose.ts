/**
 * diagnose.ts — the client for the real diagnostic core.
 *
 * Reads `EXPO_PUBLIC_DIAGNOSE_URL`. When it is unset the app keeps using
 * mockDiagnostics, so a checkout with no backend running still renders and the
 * design prototype keeps working — `isLive` is what the rest of the app asks.
 *
 * Only the URL crosses into the bundle. The Gemini key, the Voyage key and the
 * service-role key all stay in the server process, which is the whole reason this
 * indirection exists rather than the app calling a provider directly.
 *
 * The response shape mirrors mockDiagnostics deliberately: swapping the source of
 * an answer must not become a rendering change. `store.ts` is the only caller.
 */

export type DiagnoseCitation = {
  source_document: string;
  page: number;
  claim: string;
  ordinal: number;
};

export type DiagnoseReply = {
  kind: 'answer' | 'clarify' | 'refusal';
  body: string;
  citations: DiagnoseCitation[];
};

/**
 * A failure from the core. `providerBlocked` distinguishes the model's own safety
 * filter from a transport failure — the brief treats a provider block as an error
 * with a retry, never as one of our refusals, and the UI needs to be able to tell.
 */
export class DiagnoseError extends Error {
  status: number;
  providerBlocked: boolean;
  constructor(status: number, message: string, providerBlocked = false) {
    super(message);
    this.name = 'DiagnoseError';
    this.status = status;
    this.providerBlocked = providerBlocked;
  }
}

const BASE = process.env.EXPO_PUBLIC_DIAGNOSE_URL?.replace(/\/+$/, '');

/** True when a backend is configured. `store.ts` falls back to mocks when false. */
export const isLive = Boolean(BASE);

/**
 * Reasoning over retrieved IOM context is not fast. The brief measures against a
 * 150s Edge Function ceiling, so the client must not give up well before the
 * server would — a timeout shorter than the work turns a slow answer into a
 * phantom failure.
 */
const TIMEOUT_MS = 60_000;

export async function requestDiagnosis(
  symptom: string,
  equipment?: string | null
): Promise<DiagnoseReply> {
  if (!BASE) throw new DiagnoseError(0, 'No EXPO_PUBLIC_DIAGNOSE_URL configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symptom, equipment: equipment ?? undefined }),
      signal: controller.signal,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new DiagnoseError(
        json?.status ?? res.status,
        json?.message ?? `Diagnosis failed (${res.status})`,
        Boolean(json?.providerBlocked)
      );
    }

    // A malformed success is still a failure. Rendering `undefined` as an answer
    // is worse than an error card, because it looks like the system had nothing
    // to say rather than that it broke.
    if (!json || typeof json.body !== 'string' || !Array.isArray(json.citations)) {
      throw new DiagnoseError(502, 'Malformed response from the diagnostic core');
    }

    return { kind: json.kind, body: json.body, citations: json.citations };
  } finally {
    clearTimeout(timer);
  }
}
