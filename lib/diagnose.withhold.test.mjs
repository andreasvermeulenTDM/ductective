/**
 * diagnose.withhold.test.mjs — ST-R09 and ST-R10 (N3).
 *
 *   npm test
 *
 * The session's third turn, mechanically:
 *
 *   T1  a symptom              → the model asked a clarifying question
 *   T2  the technician answered it
 *   T3  the continuation       → "I don't have documentation covering that…
 *                                 none of them cover this unit. If you tell me
 *                                 the make and model off the nameplate…"
 *
 * — said to someone who had **already resolved a unit to 33 documents**. Two
 * separate defects met there and both are fixed here:
 *
 *  1. **The query.** `retrieve()` embedded `symptom` and only `symptom`, so the
 *     continuation embedded a bare "yes" or "3 flashes" — close to no query at
 *     all. ST-R09 AC 5 merges the preceding assistant question into the
 *     **embedding input only**.
 *  2. **The words.** The withhold asked for something already given and stated
 *     something false. ST-R09 replaces the body when there is a scope — and
 *     **only the body**: `meta.noDocumentation` stays `true`, so ST-R01's log
 *     still records an honest withhold.
 *
 * ST-R10 is the other half: prefer a question to a withhold, and guard what a
 * question may contain. The widening is paid for structurally.
 *
 * Zero quota: every dependency is injected.
 */

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildSources, validateAnswer, diagnose, SYSTEM } from './diagnose.mjs';
import { equipmentTokensIn } from './conversation.mjs';
import { refusalLeaksProcedure } from './safety.mjs';

const SOURCES = buildSources([
  { chunkId: 'c1', document: 'Bosch_IDS-Ultra-Condenser-Install', documentId: 'doc_b8', page: 12, text: 'Clearances.' },
]);

const ROW = {
  chunk_id: 'c1', out_document: 'Bosch_IDS-Ultra-Condenser-Install', out_document_id: 'doc_b8',
  out_page: 12, out_text: 'Clearances.', out_manufacturer: 'Bosch', out_similarity: 0.62, out_in_scope: true,
};

/** A 33-document Bosch scope, as `/resolve-unit` would have handed it over. */
const SCOPE_IDS = Array.from({ length: 33 }, (_, i) => `doc_${i}`);
const SCOPE_ROWS = SCOPE_IDS.map((id, i) => ({
  id,
  doc_type: i < 30 ? 'Install' : i < 32 ? 'IOM' : 'Troubleshooting Guide',
  in_scope: true,
}));

function makeDeps({ json = { kind: 'no_documentation' }, rows = [ROW], capture = {} } = {}) {
  return {
    completeFn: async () => ({
      json, blocked: false, blockReason: null, model: 'stub',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedContentTokenCount: 0 },
      finishReason: 'STOP', attempts: 1,
    }),
    embedFn: async (texts, opts) => {
      capture.embedded = texts[0];
      capture.opts = opts;
      return { embeddings: [[0.1]], tokens: 5 };
    },
    db: {
      rpc: async () => ({ data: rows, error: null }),
      from: () => ({
        select: () => ({
          in: async (_c, ids) => ({ data: SCOPE_ROWS.filter((r) => ids.includes(r.id)), error: null }),
        }),
      }),
    },
  };
}

const ASKED = 'Is it locking out on a safety, or cycling on the thermostat?';

// ---------------------------------------------------------------------------
// ST-R09 AC 1 — two bodies, selected on scope
// ---------------------------------------------------------------------------

test('AC 1 — unscoped keeps today\'s constant, byte-unchanged', async () => {
  const out = await diagnose(
    { symptom: 'not cooling', equipment: 'Some Unit' },
    makeDeps({ rows: [] })
  );
  assert.equal(out.meta.noDocumentation, true);
  // The exact three claims of the original copy, still made when they are true.
  assert.match(out.body, /I don’t have documentation covering that\.|I don't have documentation covering that\./);
  assert.match(out.body, /nameplate/);
  assert.match(out.body, /rather tell you I don’t know than guess|rather tell you I don't know than guess/);
});

test('AC 1 — scoped replaces it with a body composed from the rows in scope', async () => {
  const out = await diagnose(
    { symptom: 'not cooling', documentIds: SCOPE_IDS },
    makeDeps({ rows: [] })
  );
  assert.equal(out.meta.noDocumentation, true);
  assert.doesNotMatch(out.body, /nameplate/i, 'it asked for a nameplate it had already been given');
  assert.doesNotMatch(out.body, /none of them cover this unit/i, 'it said something false');
  assert.match(out.body, /\b33 documents\b/);
  assert.equal(out.body.trim().endsWith('?'), true, 'a withhold that ends in a full stop ends the conversation');
});

// ---------------------------------------------------------------------------
// ST-R09 AC 2/3 — provably database-derived, and no diagnostic claim
// ---------------------------------------------------------------------------

test('AC 2 — every number in the scoped body appears in the rows', async () => {
  const out = await diagnose({ symptom: 'not cooling', documentIds: SCOPE_IDS }, makeDeps({ rows: [] }));
  const counts = new Set(['33', '30', '2', '1']);   // total, and the three doc_type tallies
  for (const n of out.body.match(/\d+/g) ?? []) {
    assert.ok(counts.has(n), `the body states ${n}, which is in no row`);
  }
  assert.match(out.body, /30 Install/);
  assert.match(out.body, /2 IOM/);
});

test('AC 2 — a different scope produces a different body, so nothing is hardcoded', async () => {
  const smallIds = ['doc_0', 'doc_32'];
  const out = await diagnose({ symptom: 'not cooling', documentIds: smallIds }, makeDeps({ rows: [] }));
  assert.match(out.body, /\b2 documents\b/);
  assert.doesNotMatch(out.body, /\b33\b/);
});

test('AC 3 — the scoped withhold makes no diagnostic claim', async () => {
  const out = await diagnose({ symptom: 'not cooling', documentIds: SCOPE_IDS }, makeDeps({ rows: [] }));
  assert.equal(refusalLeaksProcedure(out.body), false);
  assert.doesNotMatch(out.body, /\breading\s*:/i);
  // No equipment noun beyond the doc_type words lifted from the database.
  const fromTypes = new Set(['Install', 'IOM', 'Troubleshooting Guide'].flatMap(equipmentTokensIn));
  assert.deepEqual(equipmentTokensIn(out.body).filter((t) => !fromTypes.has(t)), []);
});

// ---------------------------------------------------------------------------
// ST-R09 AC 4 / AC 8 — it is still a withhold, on both internal paths
// ---------------------------------------------------------------------------

test('AC 4 — meta.noDocumentation stays true: the withhold is still a withhold', async () => {
  for (const deps of [makeDeps({ rows: [] }), makeDeps({ json: { kind: 'no_documentation' } })]) {
    const out = await diagnose({ symptom: 'not cooling', documentIds: SCOPE_IDS }, deps);
    assert.equal(out.meta.noDocumentation, true, 'only the words were supposed to change');
    assert.deepEqual(out.citations, []);
  }
});

test('AC 8 — the empty-retrieval path and the validateAnswer degradation say the same thing', async () => {
  const empty = await diagnose({ symptom: 'not cooling', documentIds: SCOPE_IDS }, makeDeps({ rows: [] }));
  const degraded = await diagnose({ symptom: 'not cooling', documentIds: SCOPE_IDS }, makeDeps({ json: { kind: 'no_documentation' } }));
  assert.equal(empty.body, degraded.body, 'a technician must not be able to tell which internal path they hit');
  // And an all-steps-dropped answer lands in the same place.
  const dropped = await diagnose(
    { symptom: 'not cooling', documentIds: SCOPE_IDS },
    makeDeps({ json: { kind: 'answer', steps: [{ action: 'x', reading: 'y', source: 99 }] } })
  );
  assert.equal(dropped.body, empty.body);
  assert.equal(dropped.meta.noDocumentation, true);
});

// ---------------------------------------------------------------------------
// ST-R09 AC 5–7 — the continuation query
// ---------------------------------------------------------------------------

test('AC 5 — a short reply after an assistant turn is merged into the EMBEDDING', async () => {
  const capture = {};
  await diagnose(
    {
      symptom: '3 flashes',
      documentIds: SCOPE_IDS,
      history: [{ role: 'user', content: 'not cooling' }, { role: 'assistant', content: ASKED }],
    },
    makeDeps({ capture, json: { kind: 'answer', steps: [{ action: 'a', reading: 'b', source: 1 }] } })
  );
  assert.equal(capture.embedded, `${ASKED} 3 flashes`);
  assert.equal(capture.opts.inputType, 'query', 'still embedded as a query, not as a document');
});

test('AC 5 — the prompt still receives the technician\'s own words, unchanged', async () => {
  let prompted = null;
  const deps = makeDeps({ json: { kind: 'answer', steps: [{ action: 'a', reading: 'b', source: 1 }] } });
  deps.completeFn = async ({ messages }) => {
    prompted = messages.at(-1).content;
    return {
      json: { kind: 'answer', steps: [{ action: 'a', reading: 'b', source: 1 }] },
      blocked: false, model: 'stub', usage: {}, finishReason: 'STOP', attempts: 1,
    };
  };
  await diagnose(
    { symptom: '3 flashes', documentIds: SCOPE_IDS, history: [{ role: 'assistant', content: ASKED }] },
    deps
  );
  assert.match(prompted, /TECHNICIAN'S SYMPTOM: 3 flashes/);
  assert.doesNotMatch(prompted, /TECHNICIAN'S SYMPTOM: Is it locking out/, 'the merge is for the embedder only');
});

test('AC 6 — the merge is off for a long reply, an empty history, and a trailing user turn', async () => {
  const long = 'it is locking out on the low pressure safety about four minutes after it starts and the head is climbing';
  const cases = [
    ['long symptom', { symptom: long, history: [{ role: 'assistant', content: ASKED }] }, long],
    ['no history', { symptom: 'yes', history: [] }, 'yes'],
    ['last turn is the user\'s', { symptom: 'yes', history: [{ role: 'assistant', content: ASKED }, { role: 'user', content: 'ok' }] }, 'yes'],
  ];
  for (const [name, req, expected] of cases) {
    const capture = {};
    await diagnose(
      { ...req, documentIds: SCOPE_IDS },
      makeDeps({ capture, json: { kind: 'answer', steps: [{ action: 'a', reading: 'b', source: 1 }] } })
    );
    assert.equal(capture.embedded, expected, `merge fired for: ${name}`);
  }
});

test('AC 7 — the hazard gate still reads history and still wins over the merge', async () => {
  const boom = () => { throw new Error('the merge must not become a route around the hazard gate'); };
  const out = await diagnose(
    {
      symptom: 'yes',
      documentIds: SCOPE_IDS,
      history: [{ role: 'user', content: 'walk me through recovering the charge' }, { role: 'assistant', content: ASKED }],
    },
    { completeFn: boom, embedFn: boom, db: { rpc: boom, from: boom } }
  );
  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'refrigerant');
  assert.equal(out.meta.model, null);
});

// ---------------------------------------------------------------------------
// ST-R10 — prefer a question, and guard what a question may contain
// ---------------------------------------------------------------------------

test('AC 1 — SYSTEM rule 5 prefers a question to a withhold; rule 6 keeps its meaning', () => {
  const lines = SYSTEM.split('\n');
  const at = (n) => lines.findIndex((l) => l.startsWith(`${n}. `));
  assert.ok(at(5) > 0 && at(6) > at(5) && at(7) > at(6));
  const rule5 = lines.slice(at(5), at(6)).join(' ');
  assert.match(rule5, /Prefer this over saying you have no documentation/i);
  assert.match(rule5, /under-specified/i);
  assert.match(rule5, /no\s+list, no reading, no diagnosis inside it/i, 'the shape constraint must reach the model too');
  assert.match(lines[at(6)], /do not cover the equipment or symptom, say so plainly/);
});

test('AC 2 — a well-formed question passes through citation-free', () => {
  const out = validateAnswer({ kind: 'clarify', question: '  Is it locking out, or cycling on the thermostat?  ' }, SOURCES);
  assert.equal(out.kind, 'clarify');
  assert.equal(out.body, 'Is it locking out, or cycling on the thermostat?');
  assert.deepEqual(out.citations, []);
});

test('AC 2 — each of the three violations degrades to no-documentation, separately', () => {
  const violations = [
    ['no trailing question mark', 'Tell me whether it is locking out.'],
    ['a numbered line', '1. Check the LP control.\nIs it locking out?'],
    ['a bulleted line', '- Check the LP control\nIs it locking out?'],
    ['a Reading: marker', 'Reading: 38 psi suction. Is that what you see?'],
  ];
  for (const [name, question] of violations) {
    const out = validateAnswer({ kind: 'clarify', question }, SOURCES, { noDocumentationBody: 'SCOPED?' });
    assert.equal(out.kind, 'answer', `a clarify with ${name} was emitted`);
    assert.equal(out.noDocumentation, true);
    assert.equal(out.body, 'SCOPED?', 'it must degrade to the scoped body, not to the raw constant');
    assert.deepEqual(out.citations, []);
  }
});

test('AC 3 — a clarify still discards steps arriving alongside it', () => {
  const out = validateAnswer({
    kind: 'clarify',
    question: 'Is it locking out?',
    steps: [{ action: 'Check the LP control', reading: 'psi', source: 1 }],
  }, SOURCES);
  assert.equal(out.kind, 'clarify');
  assert.deepEqual(out.citations, []);
  assert.doesNotMatch(out.body, /Check the LP control/);
});

test('AC 4 — the residual risk is named in the module, and routed rather than faked', () => {
  // A question by punctuation that asserts a diagnosis: "Is the 3-flash code on
  // the ignition board indicating flame-sense failure?" It is structurally a
  // question, so the guard passes it — correctly, because the guard checks shape.
  const smuggled = 'Is the 3-flash code on the ignition board indicating flame-sense failure?';
  const out = validateAnswer({ kind: 'clarify', question: smuggled }, SOURCES);
  assert.equal(out.kind, 'clarify', 'the structural guard cannot catch content — that is the point');

  const src = readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8');
  assert.match(src, /ST-R19 AC 4/, 'the residual risk must be routed to the eval in the source, not left implicit');
  assert.match(src, /structural guard catches the shape/i);
});

test('AC 5 — a clarify is never counted as a withhold', async () => {
  const out = await diagnose(
    { symptom: 'it is not right', documentIds: SCOPE_IDS },
    makeDeps({ json: { kind: 'clarify', question: 'Is it locking out, or cycling?' } })
  );
  assert.equal(out.kind, 'clarify');
  assert.equal(out.meta.noDocumentation, false, 'a question is not a withhold, and the log must not say it was');
});

test('AC 6 — no new citation-exempt kind was minted for any of this', () => {
  const src = readFileSync(new URL('./diagnose.mjs', import.meta.url), 'utf8');
  const schema = src.slice(src.indexOf('export const RESPONSE_SCHEMA'), src.indexOf('// Validation'));
  const kinds = /enum: \[([^\]]*)\]/.exec(schema)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(kinds.sort(), ['answer', 'clarify', 'no_documentation', 'reference']);
});

// ---------------------------------------------------------------------------
// The session's third turn, replayed
// ---------------------------------------------------------------------------

test("the session's third turn now ends in a question about the job in hand", async () => {
  const capture = {};
  const out = await diagnose(
    {
      symptom: 'yes',
      documentIds: SCOPE_IDS,
      history: [
        { role: 'user', content: 'the outdoor unit is not running' },
        { role: 'assistant', content: ASKED },
      ],
    },
    makeDeps({ capture, rows: [] })
  );
  // The query was no longer a bare "yes".
  assert.equal(capture.embedded, `${ASKED} yes`);
  // The reply is still an honest withhold…
  assert.equal(out.meta.noDocumentation, true);
  // …and it is a continuation rather than a terminal error.
  assert.equal(out.body.trim().endsWith('?'), true);
  assert.doesNotMatch(out.body, /nameplate/i);
  assert.match(out.body, /33 documents/);
});

