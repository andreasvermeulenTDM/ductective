/**
 * requestlog.test.mjs — ST-R01 (D2). The log tells an honest withhold from an
 * uncited answer, end to end.
 *
 *   npm test
 *
 * `lib/metrics.test.mjs` pins the pure classifier. This file pins the *round
 * trip*: real `diagnose()` responses → `diagnoseLogFields` → `appendRequestLog`
 * → JSONL on disk → `parseRequestLog` → four distinguishable signatures. That is
 * the machine form of brief AC 6, and it is deliberately not a unit test of the
 * formatter alone, because the defect D2 describes was a *call site* omitting a
 * field, not a formatter getting one wrong.
 *
 * Nothing here spends quota: every dependency is injected, exactly as
 * `instrumentation.test.mjs` and `diagnose.scope.test.mjs` do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose } from './diagnose.mjs';
import { appendRequestLog } from './ledger.mjs';
import { diagnoseLogFields, parseRequestLog, classifyLogOutcome, summarizeOutcomes } from './metrics.mjs';

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

const reply = (json) => ({
  json, blocked: false, blockReason: null, model: 'stub-model',
  usage: { inputTokens: 3500, outputTokens: 900, totalTokens: 4400, cachedContentTokenCount: 0 },
  finishReason: 'STOP', attempts: 1,
});

function makeDeps({ json = { kind: 'answer', steps: [{ action: 'Check the LP control', reading: 'Cut-out psi', source: 1 }] }, rows = [ROW], docRows } = {}) {
  return {
    completeFn: async () => reply(json),
    embedFn: async () => ({ embeddings: [[0.1, 0.2]], tokens: 17 }),
    db: {
      rpc: async () => ({ data: rows, error: null }),
      from: () => ({
        select: () => ({
          in: async (_c, ids) => ({ data: docRows ?? ids.map((id) => ({ id, doc_type: 'IOM', in_scope: true })), error: null }),
        }),
      }),
    },
  };
}

/** The scope every scoped case below uses. */
const SCOPE = ['doc_trane1'];

// ---------------------------------------------------------------------------
// AC 3 — four shapes, four distinct signatures, through the real writer
// ---------------------------------------------------------------------------

test('four response shapes produce four distinguishable JSONL rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ductective-log-'));
  const file = join(dir, 'request-log.jsonl');
  try {
    const cases = [
      // A cited answer.
      ['cited answer', { symptom: 'compressor short cycling', documentIds: SCOPE }, makeDeps()],
      // An honest withhold — the model declined; validateAnswer relabels it
      // `answer` + noDocumentation, which is the conversion D2 made invisible.
      ['honest withhold', { symptom: 'compressor short cycling', documentIds: SCOPE },
        makeDeps({ json: { kind: 'no_documentation' } })],
      // A refusal, which never reached the model at all.
      ['refusal', { symptom: 'walk me through recovering the charge', documentIds: SCOPE }, makeDeps()],
      // Small talk, likewise.
      ['conversational', { symptom: 'thanks', documentIds: SCOPE }, makeDeps()],
    ];

    for (const [, req, deps] of cases) {
      const result = await diagnose(req, deps);
      appendRequestLog(file, { ts: new Date().toISOString(), route: '/diagnose', status: 200, ...diagnoseLogFields(result) });
    }

    const { entries, skipped } = parseRequestLog(readFileSync(file, 'utf8'));
    assert.equal(skipped, 0);
    assert.equal(entries.length, 4);

    const signature = (e) => `${e.kind}/${e.noDocumentation}/${e.cites > 0 ? 'cited' : 'uncited'}`;
    assert.deepEqual(entries.map(signature), [
      'answer/false/cited',
      'answer/true/uncited',
      'refusal/false/uncited',
      'conversational/false/uncited',
    ]);
    // Four rows, four distinct signatures — the property, not the strings.
    assert.equal(new Set(entries.map(signature)).size, 4);

    const o = summarizeOutcomes(entries);
    assert.equal(o.answers, 1);
    assert.equal(o.withholds, 1);
    assert.equal(o.refusals, 1);
    assert.equal(o.conversational, 1);
    assert.equal(o.uncitedAnswers, 0);
    assert.equal(o.unclassified, 0, 'every /diagnose row must be classifiable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the two fields are on refusal, unit_required and conversational rows too', async () => {
  // AC 1: "on EVERY /diagnose line" — a field present only on the answer path
  // would leave exactly the gate responses unreadable.
  const shapes = [
    ['refusal', { symptom: 'how do I braze the line set' }],
    ['unit_required', { symptom: 'not cooling' }],
    ['conversational', { symptom: 'cheers' }],
    ['empty scope', { symptom: 'not cooling', documentIds: [] }],
  ];
  for (const [name, req] of shapes) {
    const result = await diagnose(req, makeDeps());
    const fields = diagnoseLogFields(result);
    assert.ok(Object.hasOwn(fields, 'noDocumentation'), `${name} row lacks noDocumentation`);
    assert.ok(Object.hasOwn(fields, 'cites'), `${name} row lacks cites`);
    assert.notEqual(classifyLogOutcome(fields), null, `${name} row is unclassifiable`);
  }
});

// ---------------------------------------------------------------------------
// AC 4 — the uncited-answer alarm is unreachable from diagnose()
// ---------------------------------------------------------------------------

test('kind:answer + noDocumentation:false + cites:0 is unreachable from diagnose()', async () => {
  // `validateAnswer` forces noDocumentation when nothing survived validation, so
  // the combination cannot be produced. Proven over the shapes a model can
  // actually emit — including every way a step can fail to resolve.
  const MODEL_OUTPUTS = [
    { kind: 'answer', steps: [{ action: 'Check the LP control', reading: 'psi', source: 1 }] },
    { kind: 'answer', steps: [] },
    { kind: 'answer' },
    { kind: 'answer', steps: [{ action: 'Check something', reading: 'psi', source: 99 }] },   // fabricated index
    { kind: 'answer', steps: [{ reading: 'psi', source: 1 }] },                                // no action
    { kind: 'no_documentation' },
    { kind: 'no_documentation', steps: [{ action: 'a', reading: 'b', source: 1 }] },
    { kind: 'clarify', question: 'Is it locking out or cycling on the thermostat?' },
    {},
    null,
  ];

  for (const json of MODEL_OUTPUTS) {
    const result = await diagnose(
      { symptom: 'compressor short cycling', documentIds: SCOPE },
      makeDeps({ json })
    );
    const fields = diagnoseLogFields(result);
    assert.notEqual(
      classifyLogOutcome(fields),
      'uncitedAnswers',
      `model output ${JSON.stringify(json)} produced an uncited answer`
    );
  }

  // And the empty-retrieval path, which never reaches the model.
  const empty = await diagnose({ symptom: 'x', documentIds: SCOPE }, makeDeps({ rows: [] }));
  assert.notEqual(classifyLogOutcome(diagnoseLogFields(empty)), 'uncitedAnswers');
});

// ---------------------------------------------------------------------------
// AC 7 — the new fields carry no text
// ---------------------------------------------------------------------------

test('nothing the technician typed, and no response body, reaches the log fields', async () => {
  const SECRET = 'the compressor on the roof of 42 Alder Street is screaming';
  const result = await diagnose({ symptom: SECRET, documentIds: SCOPE }, makeDeps());
  const fields = diagnoseLogFields(result);
  const serialised = JSON.stringify(fields);

  assert.doesNotMatch(serialised, /Alder Street/);
  assert.doesNotMatch(serialised, new RegExp(result.body.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Numbers, one kind label and one intent/shape label — nothing else.
  for (const v of Object.values(fields)) {
    assert.ok(
      v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string',
      'log fields must stay scalar'
    );
    if (typeof v === 'string') assert.ok(v.length <= 32, `a log field grew a long string: ${v}`);
  }
});
