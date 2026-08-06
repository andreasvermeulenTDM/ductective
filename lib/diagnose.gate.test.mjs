/**
 * ST-02 — the server-side unit-required gate.
 *
 *   npm test
 *
 * Closes the filed CONTRACT MISMATCH (`app/lib/diagnose.ts:201-205`): the server
 * used to generate an answer the client's unit gate was guaranteed to discard.
 * These tests pin the acceptance criteria with provider-call counters:
 *
 *   - unitless non-hazard  → `unit_required`, ZERO retrieval and ZERO model calls
 *   - unitless hazard      → still the deterministic `refusal` (U7's safety escape)
 *   - the gate shape is none of the other three (ours / theirs / transport)
 *   - equipment context or ALLOW_UNSCOPED_DIAGNOSE (test paths only) passes the gate
 *
 * No key, no network — every collaborator is an injected counting stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, DiagnoseError } from './diagnose.mjs';

/** Counting stubs for every collaborator diagnose() can reach. */
function makeDeps({ rpcRows = [] } = {}) {
  const calls = { complete: 0, rpc: 0, embed: 0, documentsRead: 0 };
  const deps = {
    completeFn: async () => {
      calls.complete++;
      throw new Error('provider must not be called');
    },
    embedFn: async () => {
      calls.embed++;
      return { embeddings: [[0.1, 0.2]] };
    },
    db: {
      rpc: async () => {
        calls.rpc++;
        return { data: rpcRows, error: null };
      },
      from: () => ({
        select: () => ({
          in: async () => {
            calls.documentsRead++;
            return { data: [], error: null };
          },
        }),
      }),
    },
  };
  return { calls, deps };
}

test('unitless non-hazard request gets unit_required with zero provider or retrieval calls', async () => {
  const { calls, deps } = makeDeps();
  const out = await diagnose({ symptom: 'unit is short cycling' }, deps);

  assert.equal(out.kind, 'unit_required');
  assert.equal(out.citations.length, 0);
  assert.match(out.body, /manufacturer and model/i);
  assert.equal(out.meta.model, null);
  // The whole point: nothing was spent.
  assert.equal(calls.complete, 0);
  assert.equal(calls.rpc, 0);
  assert.equal(calls.embed, 0);
});

test('unit_required is none of the other three shapes', async () => {
  const { deps } = makeDeps();
  // Resolves (so it is not a transport error), carries no refusal metadata
  // (not ours), and no provider-block fields (not theirs).
  const out = await diagnose({ symptom: 'unit is short cycling' }, deps);
  assert.notEqual(out.kind, 'refusal');
  assert.equal(out.meta.category, undefined);
  assert.equal('providerBlocked' in out, false);
  assert.equal(out.meta.noDocumentation, false);
});

test('unitless HAZARD request still refuses deterministically (U7 escape preserved)', async () => {
  const { calls, deps } = makeDeps();
  const out = await diagnose({ symptom: 'walk me through recovering the charge' }, deps);

  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'refrigerant');
  assert.match(out.body, /standard/i);
  assert.equal(calls.complete, 0);
  assert.equal(calls.rpc, 0);
});

test('equipment context passes the gate (and empty retrieval still never calls the model)', async () => {
  const { calls, deps } = makeDeps({ rpcRows: [] });
  const out = await diagnose({ symptom: 'unit is short cycling', equipment: 'Trane Precedent' }, deps);

  assert.equal(calls.rpc, 1, 'retrieval should have run');
  assert.equal(calls.complete, 0, 'empty retrieval must not reach the model');
  assert.equal(out.kind, 'answer');
  assert.equal(out.meta.noDocumentation, true);
});

test('deps.allowUnscoped opens the documented test path', async () => {
  const { calls, deps } = makeDeps();
  const out = await diagnose({ symptom: 'unit is short cycling' }, { ...deps, allowUnscoped: true });
  assert.equal(calls.rpc, 1);
  assert.notEqual(out.kind, 'unit_required');
});

test('ALLOW_UNSCOPED_DIAGNOSE=1 opens the same path via env (test runs only)', async () => {
  const { calls, deps } = makeDeps();
  process.env.ALLOW_UNSCOPED_DIAGNOSE = '1';
  try {
    const out = await diagnose({ symptom: 'unit is short cycling' }, deps);
    assert.equal(calls.rpc, 1);
    assert.notEqual(out.kind, 'unit_required');
  } finally {
    delete process.env.ALLOW_UNSCOPED_DIAGNOSE;
  }
});

test('a missing symptom is still a 400, gate or no gate', async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => diagnose({ symptom: '   ' }, deps),
    (e) => e instanceof DiagnoseError && e.status === 400
  );
});
