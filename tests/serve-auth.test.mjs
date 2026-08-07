/**
 * serve-auth.test.mjs — the optional shared-secret gate, over the wire.
 *
 * Closes the security review's Finding 2 recommendation. The gate is enforced in
 * `scripts/serve.mjs`, which starts a listener on import, so it is tested the honest
 * way: spawn the real server with `DIAGNOSE_AUTH_TOKEN` set on a loopback port and
 * assert the actual HTTP behaviour. No Supabase env is needed — the auth check runs
 * before body parsing and before `diagnose()`, so the boundary is observable without
 * a working backend.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const TOKEN = 'test-secret-value';
const PORT = 18789;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

const post = (path, init = {}) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...init });

before(async () => {
  child = spawn('node', ['scripts/serve.mjs'], {
    env: { ...process.env, DIAGNOSE_AUTH_TOKEN: TOKEN, DIAGNOSE_PORT: String(PORT), DIAGNOSE_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  // Wait for readiness by polling the open /health endpoint.
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start within 15s');
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(() => { child?.kill(); });

test('/health stays open — no token required for the liveness/version check', async () => {
  const r = await fetch(`${BASE}/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
});

test('a POST with no Authorization header is 401', async () => {
  const r = await post('/diagnose');
  assert.equal(r.status, 401);
});

test('a POST with the wrong token is 401', async () => {
  const r = await post('/diagnose', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' } });
  assert.equal(r.status, 401);
});

test('a token of a different length is 401, not a crash (timingSafeEqual length guard)', async () => {
  const r = await post('/diagnose', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' } });
  assert.equal(r.status, 401);
});

test('the correct token passes the gate — the request is no longer rejected as unauthorized', async () => {
  // Body is {} so diagnose() will reject with 400 (symptom required); the point is
  // that it got PAST auth. Anything other than 401 proves the gate opened.
  const r = await post('/diagnose', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } });
  assert.notEqual(r.status, 401, 'the correct token must clear the gate');
});

test('an unknown route is still 404 before auth matters', async () => {
  const r = await post('/nope');
  assert.equal(r.status, 404);
});
