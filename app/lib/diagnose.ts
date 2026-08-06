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

import { NativeModules, Platform } from 'react-native';

export type DiagnoseCitation = {
  source_document: string;
  page: number;
  claim: string;
  ordinal: number;
  /** M9 — see Citation in supabase.ts. The server always sends these; older
      persisted rows may lack them, so consumers treat them as optional. */
  snippet?: string | null;
  chunk_id?: string | null;
  verified?: 'exact' | 'fuzzy' | null;
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

  /**
   * What a technician on a roof should be told.
   *
   * `message` carries the provider's own words, which for a quota failure is 600
   * characters of JSON naming the vendor and linking to a billing console. That
   * is useful in a log and actively harmful on a phone: it is unactionable, it
   * leaks which model is behind the product, and on a safety tool it reads as
   * broken rather than busy. The raw text stays on the error for logging; this is
   * what gets rendered.
   */
  get userMessage(): string {
    if (this.status === 429) {
      return "The diagnostic service is over its rate limit right now. Nothing is wrong with your question — give it a moment and send it again.";
    }
    if (this.status === 0 || /network|fetch|abort/i.test(this.message)) {
      return "Couldn't reach the diagnostic service. Check your signal and try again.";
    }
    if (this.providerBlocked) {
      return 'The model declined to answer that one. Rephrasing the symptom usually gets past it.';
    }
    if (this.status >= 500) {
      return 'The diagnostic service hit an error on its side. Your question is unchanged — try again.';
    }
    return 'That request was rejected by the diagnostic service.';
  }
}

/** Raised when the technician cancels a request themselves — not a failure. */
export class DiagnoseCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'DiagnoseCancelled';
  }
}

/**
 * The dev machine's address, as the *device* can reach it.
 *
 * `EXPO_PUBLIC_DIAGNOSE_URL` is written on the laptop, so it naturally says
 * `localhost`. On a phone `localhost` is the phone — the core would be
 * unreachable and every diagnosis would fail, on hardware only, which is the
 * worst place to discover it.
 *
 * React Native already knows the answer: the bundle it is running was fetched
 * from the dev server, and `SourceCode.scriptURL` carries that host. Reusing it
 * costs no dependency and no configuration, and it is only consulted when the
 * configured host is a loopback address — an explicit LAN or remote URL is left
 * exactly as written.
 */
function loopbackToDevHost(rawUrl: string): string {
  if (Platform.OS === 'web') return rawUrl; // on web, localhost is correct

  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(rawUrl);
  if (!isLoopback) return rawUrl;

  const scriptURL: unknown = (NativeModules as { SourceCode?: { scriptURL?: string } })
    ?.SourceCode?.scriptURL;
  if (typeof scriptURL !== 'string') return rawUrl;

  const host = scriptURL.match(/^https?:\/\/([^/:]+)/)?.[1];
  if (!host || /^(localhost|127\.0\.0\.1)$/i.test(host)) return rawUrl;

  return rawUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])/i, `$1${host}`);
}

const CONFIGURED = process.env.EXPO_PUBLIC_DIAGNOSE_URL?.replace(/\/+$/, '');
const BASE = CONFIGURED ? loopbackToDevHost(CONFIGURED) : undefined;

/** True when a backend is configured. `store.ts` falls back to mocks when false. */
export const isLive = Boolean(BASE);

/** Where requests are actually going, for the connection detail in error states. */
export const diagnoseHost = BASE ?? null;

/**
 * Reasoning over retrieved IOM context is not fast. The brief measures against a
 * 150s Edge Function ceiling, so the client must not give up well before the
 * server would — a timeout shorter than the work turns a slow answer into a
 * phantom failure.
 */
const TIMEOUT_MS = 60_000;

export async function requestDiagnosis(
  symptom: string,
  equipment?: string | null,
  /** Lets the technician give up on a long request instead of watching it. */
  cancel?: AbortSignal
): Promise<DiagnoseReply> {
  if (!BASE) throw new DiagnoseError(0, 'No EXPO_PUBLIC_DIAGNOSE_URL configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onCancel = () => controller.abort();
  cancel?.addEventListener('abort', onCancel);

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
  } catch (e) {
    // A cancel and a timeout both surface as AbortError; only one of them is a
    // failure, and telling a technician their own cancel "failed" is noise.
    if (cancel?.aborted) throw new DiagnoseCancelled();
    if (e instanceof DiagnoseError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new DiagnoseError(0, `Timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw new DiagnoseError(0, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener('abort', onCancel);
  }
}
