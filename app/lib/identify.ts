/**
 * identify.ts — the wire contract for `POST /identify-unit`, kept pure.
 *
 * Everything here is `03-backend.md`'s ST-05 addendum turned into types and
 * checks, with no React Native import so `node --test` can run it — the same
 * split `citations.ts` uses. The fetch wrapper with the timeout and the
 * loopback rewrite lives in `diagnose.ts` beside `requestDiagnosis`; this file
 * owns what goes on the wire and what is accepted back off it.
 *
 * The rule that shapes the parser: **a response that doesn't match the
 * contract is a failure, never a guess.** A half-parsed identification would
 * scope retrieval to the wrong unit's manuals, which is the mis-citation the
 * whole unit gate exists to prevent. So `parseIdentifyResponse` returns `null`
 * for anything malformed and the caller treats that as a 502, exactly like
 * `requestDiagnosis` does for a malformed diagnosis.
 */

// --- the response shapes, from 03-backend.md § POST /identify-unit ----------

/** One row of `unit.documents` — `/resolve-unit`'s select, verbatim. */
export type UnitDocument = {
  id: string;
  manufacturer: string;
  coverage: string;
  doc_type: string;
  in_scope: boolean;
  disposition?: string | null;
};

/**
 * `/resolve-unit`'s verdict, carried verbatim inside an identification.
 * `documentIds` is empty unless `status === 'covered'` — and empty is
 * meaningful downstream: `POST /diagnose` treats `[]` as "unit resolved to
 * zero documents" (honest no-documentation) and *absent* as unitless. Do not
 * collapse one into the other.
 */
export type UnitVerdict = {
  status: 'covered' | 'out_of_scope' | 'unrecognised';
  documentIds: string[];
  documents: UnitDocument[];
  covered: { manufacturer: string; families: string[] }[];
  message: string;
};

/** Always a class, never a decimal — CaptureScreen renders the word. */
export type Confidence = 'high' | 'medium' | 'low';

export type IdentifyResult = {
  identified: boolean;
  /** May be non-null on a partial read even when `identified` is false. */
  manufacturer: string | null;
  model: string | null;
  confidence: Confidence;
  /** The coverage verdict when identified; null on an unreadable plate. */
  unit: UnitVerdict | null;
  /** Ready-to-render copy: the coverage message, or fixed re-take copy. */
  message: string;
};

/** The standard wire error shape `{status, message, providerBlocked?}`. */
export type IdentifyFailure = {
  ok: false;
  status: number;
  message: string;
  /** Gemini's own safety filter — an error with a retry, never a reading. */
  providerBlocked: boolean;
};

export type IdentifyOutcome = { ok: true; result: IdentifyResult } | IdentifyFailure;

/** What the capture flow hands back to the session — the unit gate's payload. */
export type ConfirmedUnit = {
  /** The label the session is filed under: "Trane YSC060A4". */
  equipment: string;
  /**
   * Retrieval scope for `/diagnose`. The verdict's array verbatim — `[]` for a
   * non-covered unit (server answers "no documentation", honestly) and `null`
   * only on the manual-entry path, where no verdict exists and the server
   * falls back to gating on the equipment text alone.
   */
  documentIds: string[] | null;
  /**
   * The coverage verdict's status, carried so the app can *say* whether it holds
   * documentation for this unit before the first question — rather than letting the
   * technician discover it in the answer. `null` when no verdict was obtained
   * (offline manual entry), which renders as "not checked", never as "covered".
   */
  status?: UnitVerdict['status'] | null;
  /**
   * The resolved documents' coverage strings — the manifest's own words about what
   * each manual covers. Rendered by `CoverageLine`; no longer used to pick
   * suggestions, since ST-R16 deleted the class taxonomy that read it.
   */
  coverage?: string[];
  /**
   * The resolved documents' `doc_type` values — "Install", "IOM", "Service
   * Manual", "Troubleshooting Guide" — the manifest's own `DocType` column,
   * carried verbatim.
   *
   * ST-R16 AC 2. When a unit's manuals support no validated suggestion, the
   * screen says what it *does* hold instead of showing chips that fail, and this
   * is what makes that sentence a statement of record rather than a guess.
   *
   * Optional, and one path genuinely cannot supply it: the type-ahead hands back
   * a family string and no document rows, so it arrives empty and
   * `coverageStatement` states the count alone rather than a breakdown whose
   * numbers would not add up.
   */
  docTypes?: string[];
};

/**
 * Split a typed unit into the manufacturer and model the server matches on.
 *
 * `/resolve-unit` matches the two fields independently, and its manufacturer test is
 * containment in either direction. Sending the whole typed string as both fields
 * therefore *looks* fine and quietly fails for any multi-word manufacturer: the
 * corpus carries "Goodman / Amana" and "Daikin Applied", and neither contains nor is
 * contained by "Goodman AMEC960603". Measured — "Trane YSC072E3" resolved and
 * "Goodman AMEC960603" came back unrecognised with its manual sitting in the corpus.
 *
 * First token is the make, the rest is the model, which is how a data plate reads and
 * how the input's own placeholder asks for it. A single token is used for both, since
 * a lone "48TCA06" is a model and a lone "Trane" is a make and we cannot tell which.
 */
export function splitUnitText(typed: string): { manufacturer: string; model: string } {
  const text = typed.trim().replace(/\s+/g, ' ');
  const cut = text.indexOf(' ');
  if (cut < 0) return { manufacturer: text, model: text };
  return { manufacturer: text.slice(0, cut), model: text.slice(cut + 1) };
}

// --- client-side resize target ----------------------------------------------

/**
 * Mirror of the server's `MAX_EDGE_PX` (`lib/vision.mjs`), same evidence:
 * Gemini reads nothing above ~2×2 768px tiles that a plate photo needs, and
 * the server re-downscales anything larger anyway. Resizing on the phone is
 * not about the 8 MiB cap — it's that shipping a 4 MB capture over rooftop
 * LTE to be thrown away server-side is a latency bug.
 */
export const MAX_EDGE_PX = 1536;

/** The server's hard input cap (8 MiB binary). A post-resize photo is ~50×
    smaller; this guard exists so a pathological one fails before upload. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Photos a single question may carry. Mirrors `MAX_PHOTOS` in `lib/diagnose.mjs`,
 * which is the enforcing copy — this one exists to stop the picker offering a
 * selection the server will reject.
 *
 * Three, because a fault is usually one or two pictures (the board's code and the
 * component it points at) and each one is real tokens on every retry of that turn.
 */
export const MAX_PHOTOS_PER_TURN = 3;

/**
 * What to resize a capture to before upload. Pure; never upscales.
 * Width alone is returned because expo-image-manipulator preserves aspect
 * ratio when given a single dimension.
 */
export function resizeTarget(width: number, height: number): { resize: boolean; width: number } {
  // Dimensions unknown (some picker paths report 0): resize to the cap rather
  // than risk shipping a full 4032px capture. A smaller image scaled up to
  // 1536 costs a little blur; an unresized 4 MB upload costs the whole wait.
  if (!(width > 0) || !(height > 0)) return { resize: true, width: MAX_EDGE_PX };
  const edge = Math.max(width, height);
  if (edge <= MAX_EDGE_PX) return { resize: false, width };
  return { resize: true, width: Math.max(1, Math.round((width * MAX_EDGE_PX) / edge)) };
}

/** Decoded size of a base64 payload, for the pre-upload guard. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/[\r\n=]+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

// --- parsing ----------------------------------------------------------------

const CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);
const UNIT_STATUS = new Set(['covered', 'out_of_scope', 'unrecognised']);

function parseUnit(u: unknown): UnitVerdict | null {
  if (!u || typeof u !== 'object') return null;
  const unit = u as Record<string, unknown>;
  if (!UNIT_STATUS.has(unit.status as string)) return null;
  if (!Array.isArray(unit.documentIds) || unit.documentIds.some((d) => typeof d !== 'string')) return null;
  if (!Array.isArray(unit.documents)) return null;
  if (typeof unit.message !== 'string') return null;
  return {
    status: unit.status as UnitVerdict['status'],
    documentIds: unit.documentIds as string[],
    documents: unit.documents as UnitDocument[],
    covered: Array.isArray(unit.covered) ? (unit.covered as UnitVerdict['covered']) : [],
    message: unit.message,
  };
}

/**
 * Accept a 200 body only if it is the contract's identification shape.
 * Returns null for anything else — the caller renders that as a failure, not
 * as a reading.
 */
export function parseIdentifyResponse(json: unknown): IdentifyResult | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  if (typeof r.identified !== 'boolean') return null;
  if (!CONFIDENCE.has(r.confidence as Confidence)) return null;
  if (typeof r.message !== 'string') return null;

  const manufacturer = typeof r.manufacturer === 'string' && r.manufacturer ? r.manufacturer : null;
  const model = typeof r.model === 'string' && r.model ? r.model : null;

  if (r.identified) {
    // An identification without its unit verdict (or its names) is not an
    // identification — the contract sends all of them together.
    const unit = parseUnit(r.unit);
    if (!unit || !manufacturer || !model) return null;
    return { identified: true, manufacturer, model, confidence: r.confidence as Confidence, unit, message: r.message };
  }

  // Unreadable: a deliberate answer. Partial fields surface but no unit is
  // ever attached — a partial read is never laundered into an identification.
  if (r.unit !== null && r.unit !== undefined) return null;
  return { identified: false, manufacturer, model, confidence: r.confidence as Confidence, unit: null, message: r.message };
}

/** The confirmed-unit payload the capture flow passes to the session. */
export function confirmedUnitFrom(result: IdentifyResult): ConfirmedUnit | null {
  if (!result.identified || !result.unit || !result.manufacturer || !result.model) return null;
  return {
    equipment: `${result.manufacturer} ${result.model}`,
    documentIds: result.unit.documentIds,
    status: result.unit.status,
    coverage: (result.unit.documents ?? []).map((d) => d.coverage).filter(Boolean),
    docTypes: (result.unit.documents ?? []).map((d) => d.doc_type).filter(Boolean),
  };
}

// --- the request, with fetch injected so tests never need a server ----------

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * POST the photo and classify the outcome. Network-level throws (offline,
 * abort) propagate to the caller — only responses are classified here.
 */
export async function postIdentify(
  fetchFn: FetchLike,
  baseUrl: string,
  base64Jpeg: string,
  signal?: AbortSignal,
  /** Injected by the caller so the shared-secret header lives in one place (diagnose.ts). */
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
): Promise<IdentifyOutcome> {
  const res = await fetchFn(`${baseUrl}/identify-unit`, {
    method: 'POST',
    headers,
    // The contract accepts a data-URI prefix and strips it; sending the bare
    // payload with the explicit mimeType is the byte-for-byte documented form.
    body: JSON.stringify({ image: base64Jpeg, mimeType: 'image/jpeg' }),
    signal,
  });

  const json = await res.json().catch(() => null) as Record<string, unknown> | null;

  if (!res.ok) {
    return {
      ok: false,
      status: typeof json?.status === 'number' ? json.status : res.status,
      message: typeof json?.message === 'string' ? json.message : `Identification failed (${res.status})`,
      providerBlocked: Boolean(json?.providerBlocked),
    };
  }

  const result = parseIdentifyResponse(json);
  if (!result) {
    return { ok: false, status: 502, message: 'Malformed response from the vision endpoint', providerBlocked: false };
  }
  return { ok: true, result };
}
