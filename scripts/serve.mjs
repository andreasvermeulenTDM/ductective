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
import { diagnose, DiagnoseError } from '../lib/diagnose.mjs';

const PORT = Number(process.env.DIAGNOSE_PORT || 8787);
const LIMIT = 32 * 1024;

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // Dev-only origin policy. The Edge Function sets its own; this is a LAN
    // service on a developer's machine, not a deployed surface.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(payload);
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > LIMIT) throw new DiagnoseError(413, 'request too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new DiagnoseError(400, 'body is not valid JSON');
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/health') return send(res, 200, { ok: true, model: process.env.GEMINI_MODEL ?? 'default' });
  if (req.method !== 'POST' || !req.url.startsWith('/diagnose')) {
    return send(res, 404, { status: 404, message: 'POST /diagnose' });
  }

  try {
    const { symptom, equipment, history } = await readBody(req);
    const result = await diagnose({ symptom, equipment, history });
    console.log(
      `${result.kind.padEnd(8)} ${result.meta.latencyMs}ms  ` +
        `retrieved=${result.meta.retrieved ?? '-'} cites=${result.citations.length}` +
        (result.meta.dropped ? ` dropped=${result.meta.dropped}` : '')
    );
    send(res, 200, result);
  } catch (e) {
    const status = e instanceof DiagnoseError ? e.status : 500;
    // The documented error shape: {status, message}. A provider safety block is
    // flagged as such so the client renders an error with a retry — never as a
    // refusal, which would put Google's content policy in Ductective's voice.
    const body = { status, message: e.message };
    if (e.providerBlocked) { body.providerBlocked = true; body.blockReason = e.blockReason; }
    console.error(`ERROR ${status}: ${e.message}`);
    send(res, status, body);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`diagnose listening on http://0.0.0.0:${PORT}`);
  console.log('For a phone on the same network, set EXPO_PUBLIC_DIAGNOSE_URL to');
  console.log(`your machine's LAN address, e.g. http://192.168.1.x:${PORT}`);
});
