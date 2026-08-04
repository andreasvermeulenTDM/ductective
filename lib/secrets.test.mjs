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
import { scanText, envLiterals, SERVER_ONLY } from './secrets.mjs';

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
