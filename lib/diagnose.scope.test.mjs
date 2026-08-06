/**
 * ST-04 — unit scope threaded through diagnose()/retrieve().
 *
 *   npm test
 *
 * Built against the sql/007 contract (`.pipeline/025-knowledge.md` §5 addendum):
 * `filter_document_ids text[] default null`, where null AND the empty array mean
 * "no filter" at the function. The consequences pinned here:
 *
 *   - a scope reaches the RPC arguments verbatim (the story's own criterion)
 *   - an UNSCOPED call must not carry the key at all (the live pre-007 function
 *     would reject the signature and take every caller down with it)
 *   - documentIds: [] short-circuits to no-documentation BEFORE any RPC —
 *     at the function [] silently means unscoped, the exact trap named in §5
 *   - unknown ids fail loudly (400), never silently unscoped
 *   - pre-migration PGRST202/PGRST203 degrades to unscoped retrieval with a
 *     warning AND meta.scopeFallback, so a transcript cannot pass as scoped
 *
 * No key, no network — injected stubs throughout.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, DiagnoseError } from './diagnose.mjs';

const ROW = {
  chunk_id: 'chunk-1',
  out_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
  out_document_id: 'doc_trane1',
  out_page: 84,
  out_text: 'Compressor short cycles when the low-pressure control trips…',
  out_manufacturer: 'Trane',
  out_similarity: 0.91,
  out_in_scope: true,
};

const ANSWER = {
  json: { kind: 'answer', steps: [{ action: 'Check the low-pressure control setpoint', reading: 'Cut-out psi', source: 1 }] },
  blocked: false,
  blockReason: null,
  model: 'stub-model',
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  finishReason: 'STOP',
};

/**
 * @param {object} opts
 *   knownIds  — what the documents table admits to knowing
 *   rpc       — (fn, args, call#) => {data, error}; default returns [ROW]
 */
function makeDeps({ knownIds = ['doc_trane1'], rpc } = {}) {
  const rpcCalls = [];
  const calls = { complete: 0, embed: 0 };
  const deps = {
    completeFn: async () => {
      calls.complete++;
      return ANSWER;
    },
    embedFn: async () => {
      calls.embed++;
      return { embeddings: [[0.1, 0.2]] };
    },
    db: {
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (rpc) return rpc(fn, args, rpcCalls.length);
        return { data: [ROW], error: null };
      },
      from: () => ({
        select: () => ({
          in: async (_col, ids) => ({
            data: knownIds.filter((id) => ids.includes(id)).map((id) => ({ id })),
            error: null,
          }),
        }),
      }),
    },
  };
  return { calls, rpcCalls, deps };
}

test('documentIds reach the RPC arguments as filter_document_ids', async () => {
  const { rpcCalls, deps } = makeDeps();
  const out = await diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, deps);

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'match_chunks');
  assert.deepEqual(rpcCalls[0].args.filter_document_ids, ['doc_trane1']);
  // Scoped retrieval flows through to a normal cited answer.
  assert.equal(out.kind, 'answer');
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].source_document, ROW.out_document);
  assert.equal(out.citations[0].page, 84);
  assert.equal(out.meta.scopedTo, 1);
  assert.equal(out.meta.scopeFallback, undefined);
});

test('an unscoped call does NOT carry the filter key at all', async () => {
  const { rpcCalls, deps } = makeDeps();
  await diagnose({ symptom: 'compressor short cycling', equipment: 'Trane Precedent' }, deps);
  assert.equal(rpcCalls.length, 1);
  assert.equal('filter_document_ids' in rpcCalls[0].args, false);
});

test('documentIds: [] short-circuits to no-documentation before any RPC or model call', async () => {
  const { calls, rpcCalls, deps } = makeDeps();
  const out = await diagnose({ symptom: 'compressor short cycling', documentIds: [] }, deps);

  assert.equal(out.kind, 'answer');
  assert.equal(out.meta.noDocumentation, true);
  assert.match(out.body, /don't have documentation/i);
  assert.equal(out.citations.length, 0);
  assert.equal(out.meta.scopedTo, 0);
  // The trap §5 names: [] at the function means UNFILTERED. It must never get there.
  assert.equal(rpcCalls.length, 0);
  assert.equal(calls.embed, 0);
  assert.equal(calls.complete, 0);
});

test('unknown document ids fail loudly with the error shape, never silently unscoped', async () => {
  const { calls, rpcCalls, deps } = makeDeps({ knownIds: ['doc_trane1'] });
  await assert.rejects(
    () => diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1', 'doc_bogus'] }, deps),
    (e) => e instanceof DiagnoseError && e.status === 400 && /doc_bogus/.test(e.message)
  );
  assert.equal(rpcCalls.length, 0, 'fail-closed: retrieval must not run');
  assert.equal(calls.complete, 0);
});

test('a malformed documentIds value is a 400', async () => {
  const { deps } = makeDeps();
  for (const bad of ['doc_trane1', [42], ['']]) {
    await assert.rejects(
      () => diagnose({ symptom: 'x', documentIds: bad }, deps),
      (e) => e instanceof DiagnoseError && e.status === 400 && /documentIds/.test(e.message)
    );
  }
});

for (const code of ['PGRST202', 'PGRST203']) {
  test(`pre-sql/007 ${code} degrades to unscoped retrieval with a warning and meta.scopeFallback`, async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { rpcCalls, deps } = makeDeps({
      rpc: (fn, args) =>
        'filter_document_ids' in args
          ? { data: null, error: { code, message: 'Could not find the function' } }
          : { data: [ROW], error: null },
    });

    const out = await diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, deps);

    assert.equal(rpcCalls.length, 2, 'one scoped attempt, one unscoped fallback');
    assert.equal('filter_document_ids' in rpcCalls[1].args, false);
    assert.equal(out.kind, 'answer');
    assert.equal(out.meta.scopeFallback, true, 'the degradation must be visible in the transcript');
    assert.equal(out.meta.scopedTo, 1);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /sql\/007|filter_document_ids/);
  });
}

test('any other retrieval error still fails as a 502 — the fallback is only for the missing signature', async () => {
  const { deps } = makeDeps({
    rpc: () => ({ data: null, error: { code: 'XX000', message: 'boom' } }),
  });
  await assert.rejects(
    () => diagnose({ symptom: 'compressor short cycling', documentIds: ['doc_trane1'] }, deps),
    (e) => e instanceof DiagnoseError && e.status === 502
  );
});

test('empty-after-filter produces the no-documentation shape, not an invented answer', async () => {
  const { calls, deps } = makeDeps({ rpc: () => ({ data: [], error: null }) });
  const out = await diagnose({ symptom: 'symptom the scoped docs do not cover', documentIds: ['doc_trane1'] }, deps);

  assert.equal(out.kind, 'answer');
  assert.equal(out.meta.noDocumentation, true);
  assert.equal(out.citations.length, 0);
  assert.equal(out.meta.scopedTo, 1);
  assert.equal(calls.complete, 0, 'an empty scoped corpus must never reach the model');
});
