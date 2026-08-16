/**
 * serve.mjs — a local HTTP front door for the diagnostic core.
 *
 *   npm run serve            # binds 0.0.0.0:8787
 *
 * Why this exists, and what it is not:
 *
 * `00-brief.md` criterion 3 wants the round trip through a **deployed serverless
 * function on a physical device**. This is not that, and does not discharge it.
 * H5/H6 (Deno, Docker) are deferred by decision and there is no Supabase access
 * token in the environment, so an Edge Function can neither run locally nor deploy
 * from here — see SETUP-BLOCKERS. Rather than let that block the app from ever
 * seeing a real answer, this exposes the same `diagnose()` over plain Node http.
 *
 * The Edge Function, when it lands, is a wrapper around the same module. Keeping
 * all reasoning in `lib/diagnose.mjs` is what stops the development path and the
 * acceptance path from becoming two different systems.
 *
 * Binds 0.0.0.0 so Expo Go on a phone on the same network can reach it. The
 * service-role key stays in this process; the device only ever sees the response.
 */

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diagnose, DiagnoseError, MAX_PHOTOS } from '../lib/diagnose.mjs';
import { resolveUnit, suggestUnitsLive } from '../lib/units.mjs';
import { identifyUnit, MAX_IMAGE_BYTES } from '../lib/vision.mjs';
import { budget, recordModelCall, appendRequestLog } from '../lib/ledger.mjs';
import {
  estimateCostUsd, modelCallHappened, quotaConsumedByError,
  diagnoseLogFields, diagnoseLogLine,
} from '../lib/metrics.mjs';

/**
 * The commit this process is actually running, resolved once at start.
 *
 * Twice now a probe run has measured a `serve.mjs` started days earlier and reported
 * confident nonsense — 429s and refusal "leaks" against a tree that no longer
 * existed, and the run was believed until the process start time was checked by
 * hand. The prober records its *own* HEAD in the transcript, which is exactly the
 * number that looks right and is not.
 *
 * So the server states its own tree and probes assert the two match before scoring
 * anything. Read at start rather than per request: a server that reported the
 * working tree's current commit would claim code it is not running, which is the
 * same lie in a newer coat.
 */
const COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: dirname(dirname(fileURLToPath(import.meta.url))),
      encoding: 'utf8',
    }).trim();
  } catch {
    // Deployed copies may have no git directory. Unknown is honest; a fabricated
    // commit would defeat the point of the field.
    return null;
  }
})();
const STARTED_AT = new Date().toISOString();

const PORT = Number(process.env.DIAGNOSE_PORT || 8787);

/**
 * Optional shared-secret gate. **Off by default**, so the device-test flow — a
 * phone reaching this over the LAN with no credential — is unchanged.
 *
 * Set `DIAGNOSE_AUTH_TOKEN` and every state-changing route requires
 * `Authorization: Bearer <token>`; the app sends it from `EXPO_PUBLIC_DIAGNOSE_TOKEN`
 * (see `app/lib/diagnose.ts`). This is the shared-secret the security review asked
 * for before the listener is exposed beyond a trusted LAN, without forcing it on the
 * dev loop that needs the open `0.0.0.0` bind. `/health` stays open: it carries only
 * a git commit and the model name, and the wire probes assert against it.
 *
 * `DIAGNOSE_HOST` makes the bind interface a knob too (default `0.0.0.0`, which the
 * phone needs); an operator locking this down can bind `127.0.0.1` and add the token.
 */
const AUTH_TOKEN = process.env.DIAGNOSE_AUTH_TOKEN || null;
const HOST = process.env.DIAGNOSE_HOST || '0.0.0.0';

/**
 * Constant-time bearer check. Length is compared first because `timingSafeEqual`
 * throws on unequal-length buffers; leaking length alone does not help an attacker
 * guess a secret of the same length.
 */
function authorized(req) {
  if (!AUTH_TOKEN) return true; // gate disabled
  const header = req.headers['authorization'] || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(AUTH_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LIMIT = 32 * 1024;
// /identify-unit carries a base64 JPEG: 8 MiB binary ≈ 10.9 MiB base64, plus
// JSON envelope. Every other route keeps the tight text limit.
const IMAGE_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;
/**
 * /diagnose can carry up to MAX_PHOTOS images in one question (ST-17), so its body
 * ceiling is a multiple of the single-image one. The per-image rules are unchanged
 * and still enforced individually — this only stops a legitimate three-photo
 * question being cut off at the transport before `normalizePhotos` can judge it.
 */
const DIAGNOSE_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) * MAX_PHOTOS + 64 * 1024;

// ---------------------------------------------------------------------------
// ST-09 — cost/cache/latency instrumentation. Observes, never alters: no
// response kind, gate, or retrieval semantics change here, and a ledger
// failure is a warning, never a failed diagnosis.
//
// State lives in two files beside the server — the dev path ST-09 allows
// (the Edge Function, when H9 unblocks it, needs its own durable store):
//   quota-ledger.json   — model calls per day against the 20/day free tier
//   request-log.jsonl   — one line of numbers per request; `npm run metrics`
//                         (scripts/summarize-metrics.mjs) turns a batch into
//                         p50/p95 and mean cost with/without cache hits.
// Neither file ever carries symptom text or image bytes.
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = process.env.QUOTA_LEDGER_FILE || join(HERE, 'quota-ledger.json');
const REQUEST_LOG_FILE = process.env.REQUEST_LOG_FILE || join(HERE, 'request-log.jsonl');

/**
 * Attach `meta.budget` (the day ledger line), count the model call if one
 * happened, and append the request-log entry. Mutating `result.meta` is the
 * point: every /diagnose and /identify-unit response carries the running
 * day-count against the 20/day budget.
 */
function instrument(route, result, extra = {}) {
  const cost = estimateCostUsd(result.meta?.usage);
  try {
    const spent = modelCallHappened(result);
    const b = spent ? recordModelCall(LEDGER_FILE, { usage: result.meta.usage }) : budget(LEDGER_FILE);
    result.meta.budget = b;
    appendRequestLog(REQUEST_LOG_FILE, {
      ts: new Date().toISOString(),
      route,
      status: 200,
      latencyMs: result.meta.latencyMs,
      retrievalMs: result.meta.latency?.retrievalMs ?? null,
      generationMs: result.meta.latency?.generationMs ?? null,
      usage: result.meta.usage,
      attempts: result.meta.attempts ?? 0,
      modelCall: spent,
      costUsd: cost.withCacheUsd,
      costNoCacheUsd: cost.withoutCacheUsd,
      day: b.day,
      dayUsed: b.used,
      ...extra,
    });
    return { b, cost };
  } catch (e) {
    console.warn(`[instrumentation] ${e.message}`);
    return { b: null, cost };
  }
}

/** The log-line tail: tokens, cache hits, retries, projected cost, day count. */
function usageSuffix(meta, cost, b) {
  const u = meta?.usage ?? {};
  return (
    `  tok=${u.inputTokens ?? 0}+${u.outputTokens ?? 0}` +
    (u.cachedContentTokenCount ? ` cached=${u.cachedContentTokenCount}` : '') +
    ((meta?.attempts ?? 0) > 1 ? ` retries=${meta.attempts - 1}` : '') +
    ` ~$${cost.withCacheUsd.toFixed(4)}` +
    (b ? ` day=${b.used}/${b.limit}` : '')
  );
}

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // Dev-only origin policy. The Edge Function sets its own; this is a LAN
    // service on a developer's machine, not a deployed surface.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(payload);
};

async function readBody(req, limit = LIMIT) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new DiagnoseError(413, 'request too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new DiagnoseError(400, 'body is not valid JSON');
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/health') {
    return send(res, 200, { ok: true, model: process.env.GEMINI_MODEL ?? 'default', commit: COMMIT, startedAt: STARTED_AT });
  }
  const route = req.method === 'POST' ? (req.url ?? '').split('?')[0] : null;
  if (route !== '/diagnose' && route !== '/resolve-unit' && route !== '/suggest-units' && route !== '/identify-unit') {
    return send(res, 404, { status: 404, message: 'POST /diagnose, /resolve-unit, /suggest-units or /identify-unit' });
  }

  // Shared-secret gate, when enabled. Before body parsing, so an unauthenticated
  // caller cannot even push a payload. 401 is intentionally terse.
  if (!authorized(req)) {
    return send(res, 401, { status: 401, message: 'unauthorized' });
  }

  try {
    // Three ceilings, one per route's actual payload: /resolve-unit is text only,
    // /identify-unit carries one plate photo, /diagnose up to MAX_PHOTOS of the part.
    const limit =
      route === '/resolve-unit' || route === '/suggest-units'
        ? LIMIT
        : route === '/identify-unit'
          ? IMAGE_LIMIT
          : DIAGNOSE_LIMIT;
    const body = await readBody(req, limit);

    // U4 — coverage before any question. Deliberately its own call rather than a
    // field on /diagnose: the app has to be able to state coverage at unit
    // selection, which is before there is a symptom to diagnose.
    if (route === '/resolve-unit') {
      const verdict = await resolveUnit({ manufacturer: body.manufacturer, model: body.model });
      console.log(`resolve  ${verdict.status.padEnd(14)} ${body.manufacturer ?? '?'} / ${body.model ?? '?'}  docs=${verdict.documentIds.length}`);
      return send(res, 200, verdict);
    }

    /*
     * F3 / ST-F10 — type-ahead on the manual-entry field.
     *
     * Its own route rather than a mode on /resolve-unit: that one answers "is
     * this unit covered" about a unit already typed in full, and its verdict
     * shape (status, message, covered[]) is a contract the camera path also
     * carries. A prefix has no verdict.
     *
     * On the server rather than in the app for the reason OQ-F3 records: the
     * matching rules ARE the correctness of this feature, and a second
     * implementation in TypeScript would be a second definition of "covered"
     * that drifts from the one `/resolve-unit` and `/identify-unit` use. The app
     * degrades to no suggestions when this is unreachable — free typing never
     * depends on it.
     *
     * Costs no model quota and no embedding: one select and pure matching. It is
     * deliberately NOT instrumented into the day ledger for that reason, exactly
     * as /resolve-unit is not.
     */
    if (route === '/suggest-units') {
      const query = typeof body.query === 'string' ? body.query : '';
      const suggestions = await suggestUnitsLive(query);
      console.log(`suggest ${String(suggestions.length).padStart(2)} for ${JSON.stringify(query.slice(0, 40))}`);
      return send(res, 200, { suggestions });
    }

    // ST-05 — nameplate photo in, identification + coverage verdict out.
    // The log line carries sizes and the verdict only: image bytes never touch
    // the log, per the story's no-image-in-logs criterion.
    if (route === '/identify-unit') {
      const out = await identifyUnit({ image: body.image, mimeType: body.mimeType });
      const { b, cost } = instrument(route, out, { kind: 'identify', identified: out.identified });
      const plate = out.identified ? `${out.manufacturer} / ${out.model}` : 'unreadable';
      console.log(
        `identify ${plate}  conf=${out.confidence} ${out.meta.latencyMs}ms  ` +
          `in=${Math.round(out.meta.image.originalBytes / 1024)}kB sent=${Math.round(out.meta.image.sentBytes / 1024)}kB` +
          (out.meta.image.resized ? ' (downscaled)' : '') +
          (out.unit ? `  unit=${out.unit.status} docs=${out.unit.documentIds.length}` : '') +
          usageSuffix(out.meta, cost, b)
      );
      return send(res, 200, out);
    }

    // ST-04 (OQ1 default): the client supplies documentIds from /resolve-unit's
    // verdict. No deps are ever passed here — the unscoped test path cannot be
    // reached from the wire.
    const { symptom, equipment, history, documentIds, image, images, mimeType } = body;
    const result = await diagnose({ symptom, equipment, history, documentIds, image, images, mimeType });
    // ST-R01 — `kind`, `noDocumentation` and `cites` on EVERY /diagnose row,
    // refusal and conversational included. Built by a pure helper so the four
    // outcome signatures are pinned by a unit test rather than by this call site.
    const { b, cost } = instrument(route, result, diagnoseLogFields(result));
    console.log(diagnoseLogLine(result) + usageSuffix(result.meta, cost, b));
    send(res, 200, result);
  } catch (e) {
    const status = e instanceof DiagnoseError ? e.status : 500;
    // The documented error shape: {status, message}. A provider safety block is
    // flagged as such so the client renders an error with a retry — never as a
    // refusal, which would put Google's content policy in Ductective's voice.
    const body = { status, message: e.message };
    if (e.providerBlocked) { body.providerBlocked = true; body.blockReason = e.blockReason; }
    // ST-09: a provider block or a failed provider call still spent quota —
    // the day ledger counts it, and the error log line shows the day count.
    let daySuffix = '';
    try {
      const spent = quotaConsumedByError(e);
      if (spent) {
        const b = recordModelCall(LEDGER_FILE, { usage: e.usage });
        daySuffix = `  day=${b.used}/${b.limit}`;
      }
      appendRequestLog(REQUEST_LOG_FILE, {
        ts: new Date().toISOString(),
        route: req.url ?? null,
        status,
        error: true,
        quotaSpent: spent,
        ...(e.usage ? { usage: e.usage } : {}),
        ...(e.attempts ? { attempts: e.attempts } : {}),
        ...(e.providerBlocked ? { providerBlocked: true, blockReason: e.blockReason } : {}),
      });
    } catch (instrErr) {
      console.warn(`[instrumentation] ${instrErr.message}`);
    }
    console.error(`ERROR ${status}: ${e.message}${daySuffix}`);
    send(res, status, body);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`diagnose listening on http://${HOST}:${PORT}${AUTH_TOKEN ? '  (auth: bearer token required)' : ''}`);
  console.log('For a phone on the same network, set EXPO_PUBLIC_DIAGNOSE_URL to');
  console.log(`your machine's LAN address, e.g. http://192.168.1.x:${PORT}`);
});
