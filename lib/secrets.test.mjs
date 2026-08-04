/**
 * Unit tests for the S2 secret scanner.
 *
 *   npm test
 *
 * The cases that matter here are the two the scanner exists to get right: a
 * service-role key in a bundle must fail, and the anon key in the same bundle
 * must not. Getting the second one wrong is how a check gets disabled for being
 * noisy, which is worse than not having written it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, envLiterals, SERVER_ONLY, isShapeExempt } from './secrets.mjs';

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig-anon-aaaaaaaa';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZSJ9.sig-svc-bbbbbbbb';

const literals = {
  forbidden: [{ name: 'SUPABASE_SERVICE_ROLE_KEY', value: SERVICE }],
  allowed: [{ name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', value: ANON }],
};

test('a clean bundle produces no findings', () => {
  assert.deepEqual(scanText('const url = "https://x.supabase.co";', literals), []);
});

test('the anon key is allowed to ship and does not trip the JWT shape rule', () => {
  assert.deepEqual(scanText(`const k="${ANON}";`, literals), []);
});

test('the service-role key fails on its literal value', () => {
  const hits = scanText(`const k="${SERVICE}";`, literals);
  assert.ok(hits.some((h) => h.kind === 'literal' && h.name === 'SUPABASE_SERVICE_ROLE_KEY'));
});

test('both keys present still fails — the exemption is per value, not per file', () => {
  const hits = scanText(`a="${ANON}";b="${SERVICE}";`, literals);
  assert.ok(hits.some((h) => h.kind === 'literal'));
});

test('an unknown key is still caught by shape alone', () => {
  const hits = scanText('const k = "sk-ant-api03-abcdefghijklmnop";', { forbidden: [], allowed: [] });
  assert.deepEqual(hits, [{ kind: 'shape', name: 'Anthropic key' }]);
});

// One fixture per provider, each chosen so no other pattern can also match it —
// otherwise a second finding appears and the deepEqual breaks for the wrong reason.
test('a Google AI Studio key is caught by shape', () => {
  const hits = scanText('const k = "AIzaSyA0123456789abcdefghijklmnopqrstuv";', {});
  assert.deepEqual(hits, [{ kind: 'shape', name: 'Google AI Studio key' }]);
});

test('a PEM private key is caught by shape', () => {
  const hits = scanText('-----BEGIN PRIVATE KEY-----\nMIIEv...\n', {});
  assert.deepEqual(hits, [{ kind: 'shape', name: 'PEM private key' }]);
});

test('an RSA and an EC PEM header are both caught', () => {
  for (const header of ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN EC PRIVATE KEY-----']) {
    assert.deepEqual(scanText(header, {}), [{ kind: 'shape', name: 'PEM private key' }]);
  }
});

test('GEMINI_API_KEY is server-only, and ANTHROPIC_API_KEY stays so through the transition', () => {
  assert.ok(SERVER_ONLY.includes('GEMINI_API_KEY'));
  assert.ok(SERVER_ONLY.includes('ANTHROPIC_API_KEY'));
});

// --- the shape exemption ----------------------------------------------------
// This file necessarily contains key-shaped fixtures. Without the exemption the
// scanner fails on it forever, and a permanently-red security check gets ignored.

test('this test file is shape-exempt, by repo path and by nested path', () => {
  assert.ok(isShapeExempt('lib/secrets.test.mjs'));
  assert.ok(isShapeExempt('some/worktree/lib/secrets.test.mjs'));
});

test('nothing else is exempt', () => {
  for (const p of ['lib/secrets.mjs', 'app/lib/store.ts', 'secrets.test.mjs.bak']) {
    assert.equal(isShapeExempt(p), false);
  }
});

test('skipShape suppresses heuristics but NEVER a real value', () => {
  const text = `fixture="sk-ant-api03-abcdefghijklmnop"; real="${SERVICE}";`;
  const hits = scanText(text, { ...literals, skipShape: true });
  assert.equal(hits.some((h) => h.kind === 'shape'), false);
  // The whole point: an exempt file that gains a real key is still a finding.
  assert.ok(hits.some((h) => h.kind === 'literal' && h.name === 'SUPABASE_SERVICE_ROLE_KEY'));
});

test('skipShape does not suppress a server-only variable reference', () => {
  const hits = scanText('process.env.GEMINI_API_KEY', { names: SERVER_ONLY, skipShape: true });
  assert.ok(hits.some((h) => h.kind === 'reference' && h.name === 'GEMINI_API_KEY'));
});

test('a server-only variable name in the bundle is a finding on its own', () => {
  const hits = scanText('process.env.ANTHROPIC_API_KEY', { names: SERVER_ONLY });
  assert.ok(hits.some((h) => h.kind === 'reference' && h.name === 'ANTHROPIC_API_KEY'));
});

test('no finding ever carries the matched value', () => {
  const hits = scanText(`const k="${SERVICE}";`, literals);
  assert.ok(hits.length > 0);
  for (const h of hits) assert.equal(JSON.stringify(h).includes(SERVICE), false);
});

test('empty and placeholder env values are not treated as literals', () => {
  const { forbidden } = envLiterals({
    ANTHROPIC_API_KEY: '',
    VOYAGE_API_KEY: '   ',
    SUPABASE_SERVICE_ROLE_KEY: 'YOUR-PROJECT-REF',
  });
  assert.deepEqual(forbidden, []);
});

test('a short value is not matched — it would flag the whole repo', () => {
  const { forbidden } = envLiterals({ ANTHROPIC_API_KEY: 'abc' });
  assert.deepEqual(forbidden, []);
});
