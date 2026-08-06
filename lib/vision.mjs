/**
 * vision.mjs — ST-05. A nameplate photo in, {manufacturer, model, confidence}
 * and the resolved unit out.
 *
 * Lives beside units.mjs (OQ2 default) and composes with it rather than
 * duplicating it: the model reads the plate, `resolveUnit` — the single home of
 * coverage matching — turns the reading into a verdict with `documentIds`, which
 * is exactly the scope ST-04 feeds to retrieval. One mechanism serves brief
 * criterion 7's "identified model demonstrably narrows retrieval" and U5 both.
 *
 * The provider call uses the shipped `imagePart()` (`lib/providers/gemini.mjs`)
 * via `inlineData`, with **server-side downscaling first** (M11, the brief's own
 * note). Why downscale here and not trust the client: the server is the only
 * place the cap is enforceable, and the cost is real —
 *
 *   - Gemini bills vision by 768×768 tile (258 tokens/tile) and *itself*
 *     downscales anything beyond 3072×3072, so pixels above that are pure upload
 *     latency with zero model benefit.
 *   - A 4032×3024 phone photo is a 4×5 = 20-tile grid ≈ 5,160 image tokens.
 *     Capped at 1536 on the long edge it is a 2×2 grid ≈ 1,032 — a 5× cut, on a
 *     20-requests/day budget where M12 measured ~3.5k tokens for a whole text
 *     diagnosis.
 *   - The inline-data request ceiling is 20 MB; 8 MiB of JPEG is ~10.9 MiB as
 *     base64, inside the ceiling with headroom for prompt and JSON.
 *
 * The 1536 px figure is provider-economics evidence, not an accuracy
 * measurement: live vision verification is quota-gated to ST-07's window (owner
 * decision — zero Gemini calls today). If ST-07's photos miss at 1536, raise
 * MAX_EDGE_PX on that measurement, not on instinct.
 *
 * Codec choice: `jpeg-js` (pure JS, zero deps). Node has no built-in image
 * codec, so downscaling needs *something*; `sharp` was rejected because its
 * native binding forecloses the Deno/Edge Function path (ST-11) that the
 * transport-agnostic core exists to keep open. JPEG only — the camera capture
 * path produces JPEG, and one codec is one attack surface.
 */

import jpeg from 'jpeg-js';
import { complete, ProviderError, imagePart } from './providers/gemini.mjs';
import { DiagnoseError } from './diagnose.mjs';
import { resolveUnit } from './units.mjs';
import { normalizeUsage } from './metrics.mjs';

/** Binary size cap — see the header note. Enforced before any decode. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Longest-edge cap — see the header note. ≤ 2×2 Gemini tiles. */
export const MAX_EDGE_PX = 1536;
/**
 * Re-encode quality. Nameplate text is high-contrast print; 80 keeps stamped
 * characters legible while roughly halving bytes vs 95. Quota-gated to ST-07's
 * measurement like MAX_EDGE_PX.
 */
export const JPEG_QUALITY = 80;

// ---------------------------------------------------------------------------
// Pure functions — testable without a key, a decode, or a network
// ---------------------------------------------------------------------------

/**
 * Width/height from JPEG headers without decoding pixels. Walks the marker
 * stream to the first frame header (SOF0–SOF15, excluding DHT/JPG/DAC which
 * share the range). Returns null for anything that is not a parseable JPEG —
 * the caller turns that into a 400, never a provider call.
 */
export function jpegDimensions(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null; // marker stream lost sync — not decodable
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; } // standalone
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * The resize decision, pure (ST-05's unit-testable requirement).
 *
 * @param {{width:number, height:number, bytes:number}} img
 * @returns {{ok:false, status:number, message:string} |
 *           {ok:true, resize:boolean, targetWidth:number, targetHeight:number}}
 */
export function resizeDecision({ width, height, bytes }) {
  if (bytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `image is ${bytes} bytes; the limit is ${MAX_IMAGE_BYTES} (8 MiB). Capture at lower resolution or recompress.`,
    };
  }
  const edge = Math.max(width, height);
  if (edge <= MAX_EDGE_PX) return { ok: true, resize: false, targetWidth: width, targetHeight: height };
  const scale = MAX_EDGE_PX / edge;
  return {
    ok: true,
    resize: true,
    targetWidth: Math.max(1, Math.round(width * scale)),
    targetHeight: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Box-average RGBA downsample. Averaging (not nearest-neighbour) because
 * decimating a plate photo 2–3× with point sampling aliases exactly the thin
 * stamped strokes the model needs to read.
 */
export function downsampleRgba(src, srcWidth, srcHeight, targetWidth, targetHeight) {
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor((y * srcHeight) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcHeight) / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor((x * srcWidth) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcWidth) / targetWidth));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * srcWidth + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const o = (y * targetWidth + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * Decode → downsample → re-encode. Only called when resizeDecision said so.
 * The decode caps guard against pixel-bomb JPEGs (small file, huge canvas).
 */
export function downscaleJpeg(buf, targetWidth, targetHeight) {
  const decoded = jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 100, maxMemoryUsageInMB: 512 });
  const data = downsampleRgba(decoded.data, decoded.width, decoded.height, targetWidth, targetHeight);
  const encoded = jpeg.encode({ data, width: targetWidth, height: targetHeight }, JPEG_QUALITY);
  return { data: encoded.data, width: targetWidth, height: targetHeight };
}

// ---------------------------------------------------------------------------
// The identification call
// ---------------------------------------------------------------------------

/**
 * Constant and first, like diagnose's SYSTEM, for the same caching reason.
 * "Do not guess" is the domain rule wearing a vision hat: a fabricated model
 * number would scope retrieval to the wrong manual, which is worse than no
 * scope. Confidence is a class, never a decimal — the app renders the word
 * (CaptureScreen's departure note), so the wire carries the word.
 */
export const VISION_SYSTEM = [
  'You read equipment nameplates (data plates) for HVAC technicians.',
  '',
  'RULES:',
  '1. Report ONLY what is printed on the plate in the photo. Never guess or',
  '   complete a partially readable value from your general knowledge.',
  '2. `manufacturer` is the brand printed on the plate. `model` is the model',
  '   number exactly as printed, including dashes and digits.',
  '3. If the photo is not a nameplate, or the manufacturer or model number is',
  '   not clearly readable, set legible to false and leave the field empty.',
  '4. confidence: "high" only when every reported character is clearly',
  '   readable; "medium" when readable but degraded (glare, angle, wear);',
  '   "low" when partially readable.',
].join('\n');

/** Structured output — the parser never touches free text. */
export const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    legible: { type: 'boolean' },
    manufacturer: { type: 'string' },
    model: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['legible', 'confidence'],
};

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const clean = (s) => (typeof s === 'string' ? s.trim() : '');

const UNREADABLE =
  "I couldn't read a nameplate in that photo.\n\n" +
  'Try again square-on and closer, with the model number in frame and glare off the plate.';

/**
 * @param {{image: string, mimeType?: string}} req
 *        `image` — base64 JPEG (a `data:image/jpeg;base64,` prefix is accepted
 *        and stripped). JPEG only; the codec note in the header says why.
 * @param {{completeFn?: Function, resolveFn?: Function, db?: object}} deps
 *        Test injection only, mirroring diagnose().
 * @returns {Promise<{identified:boolean, manufacturer:string|null,
 *           model:string|null, confidence:'high'|'medium'|'low',
 *           unit:object|null, message:string, meta:object}>}
 *        `unit` is /resolve-unit's verdict verbatim when identified, else null.
 *        A provider block or transport failure THROWS (theirs/transport error
 *        shapes) — it is never returned as an identification.
 */
export async function identifyUnit(
  { image, mimeType = 'image/jpeg' } = {},
  { completeFn = complete, resolveFn = resolveUnit, db } = {}
) {
  const started = Date.now();

  if (!image || typeof image !== 'string') {
    throw new DiagnoseError(400, 'image (base64 JPEG) is required');
  }
  let payload = image;
  const dataUri = image.match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s);
  if (dataUri) {
    mimeType = dataUri[1];
    payload = dataUri[2];
  }
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
    throw new DiagnoseError(415, `unsupported image type '${mimeType}' — send image/jpeg`);
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) {
    throw new DiagnoseError(400, 'image is not valid base64');
  }
  const buf = Buffer.from(payload, 'base64');
  if (buf.length === 0) throw new DiagnoseError(400, 'image is empty');

  const dims = jpegDimensions(buf);
  if (!dims) throw new DiagnoseError(400, 'image is not a decodable JPEG');

  const decision = resizeDecision({ ...dims, bytes: buf.length });
  if (!decision.ok) throw new DiagnoseError(decision.status, decision.message);

  let sent = { data: buf, width: dims.width, height: dims.height };
  if (decision.resize) {
    sent = downscaleJpeg(buf, decision.targetWidth, decision.targetHeight);
  }

  // ST-09: generation timed separately, like diagnose()'s split — vision has
  // no vector retrieval, so its `latency.retrievalMs` is the resolveUnit
  // database lookup below; the remainder of latencyMs is image preprocessing.
  const tGenerate = Date.now();
  let res;
  try {
    res = await completeFn({
      system: VISION_SYSTEM,
      messages: [{
        role: 'user',
        parts: [
          imagePart(Buffer.from(sent.data).toString('base64'), 'image/jpeg'),
          { text: 'Read this nameplate. Respond using the required JSON schema.' },
        ],
      }],
      json: IDENTIFY_SCHEMA,
      temperature: 0,
      maxOutputTokens: 256,
    });
  } catch (e) {
    // Same normalisation as diagnose(): the wire error shape is
    // {status, message} — a transport failure, never a fabricated reading.
    // ST-09: the failed call still burned quota attempts; flag it for the ledger.
    if (e instanceof ProviderError) {
      throw new DiagnoseError(e.status || 502, e.message, { modelCallAttempted: true, attempts: e.attempts ?? 1 });
    }
    throw e;
  }
  const generationMs = Date.now() - tGenerate;

  // A provider safety block is an ERROR (theirs), never an identification and
  // never our refusal — brief Amendment 1, same as the diagnose path.
  if (res.blocked) {
    throw new DiagnoseError(502, `provider safety block (${res.blockReason})`, {
      providerBlocked: true,
      blockReason: res.blockReason,
      // ST-09: quota and tokens were spent — the ledger counts this error.
      modelCallAttempted: true,
      usage: normalizeUsage(res.usage),
      model: res.model,
      attempts: res.attempts ?? 1,
    });
  }

  const j = res.json ?? {};
  const manufacturer = clean(j.manufacturer);
  const model = clean(j.model);
  const confidence = CONFIDENCE.has(j.confidence) ? j.confidence : 'low';
  const identified = j.legible !== false && Boolean(manufacturer) && Boolean(model);

  // Composition, not duplication: coverage matching stays in units.mjs. The
  // verdict's documentIds are ST-04's retrieval scope.
  const tResolve = Date.now();
  const unit = identified ? await resolveFn({ manufacturer, model }, db ? { db } : undefined) : null;
  const resolveMs = identified ? Date.now() - tResolve : 0;

  return {
    identified,
    manufacturer: manufacturer || null,
    model: model || null,
    confidence,
    unit,
    message: identified ? unit.message : UNREADABLE,
    meta: {
      latencyMs: Date.now() - started,
      // ST-09: same phase names as /diagnose so one summarizer reads both
      // routes. retrievalMs here is the unit-resolution database lookup.
      latency: { retrievalMs: resolveMs, generationMs },
      model: res.model,
      usage: normalizeUsage(res.usage),
      attempts: res.attempts ?? 1,
      image: {
        originalBytes: buf.length,
        sentBytes: sent.data.length,
        width: sent.width,
        height: sent.height,
        resized: Boolean(decision.resize),
      },
    },
  };
}
