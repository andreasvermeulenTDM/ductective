/**
 * diagnose.photo.test.mjs — ST-17, a photo of the part rather than the plate.
 *
 * The technician asked to photograph what they are looking at mid-diagnosis. The
 * design question that gates it is the citation rule: `CLAUDE.md` requires every
 * diagnostic statement to trace to a source document and page, and a photograph is
 * not a source document.
 *
 * The answer encoded here is that a photo is an *observation*, not a source. It may
 * inform what the model says it can see; it may never be the authority for a step.
 * These tests assert that boundary from both sides — the prompt says it, and
 * `validateAnswer` enforces it structurally regardless of what the model saw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, validateAnswer, diagnose, DiagnoseError } from './diagnose.mjs';

const SOURCES = [
  { n: 1, document: 'RT-SVX23R-EN_Precedent-Rooftop-IOM', page: 84, text: 'Condenser fan rotation check.', chunkId: 'c1' },
];
const PHOTO = { base64: 'AAAA', width: 800, height: 600 };

// --- the prompt boundary ------------------------------------------------------

test('a text-only turn keeps the plain string shape — nothing changes without a photo', () => {
  const { messages } = buildPrompt({ symptom: 'fan not spinning', sources: SOURCES });
  const last = messages.at(-1);
  assert.equal(typeof last.content, 'string');
  assert.equal(last.parts, undefined);
  assert.doesNotMatch(last.content, /photo/i, 'no photo instruction when there is no photo');
});

test('a photo turn carries the image as a part, alongside the text', () => {
  const { messages } = buildPrompt({ symptom: 'fan not spinning', sources: SOURCES, photo: PHOTO });
  const last = messages.at(-1);
  assert.ok(Array.isArray(last.parts), 'photo turns use parts');
  assert.equal(last.parts.length, 2);
  assert.equal(last.parts[0].inlineData.data, 'AAAA');
  assert.equal(last.parts[0].inlineData.mimeType, 'image/jpeg');
  assert.match(last.parts[1].text, /fan not spinning/);
});

test('the photo instruction forbids the photo being treated as a source', () => {
  const { messages } = buildPrompt({ symptom: 'x', sources: SOURCES, photo: PHOTO });
  const text = messages.at(-1).parts[1].text;
  assert.match(text, /Do NOT treat the photo as a source/i);
  assert.match(text, /every numbered step must still come from, and cite/i);
});

test('a photo does not add itself to the numbered sources', () => {
  const { messages } = buildPrompt({ symptom: 'x', sources: SOURCES, photo: PHOTO });
  const text = messages.at(-1).parts[1].text;
  // Exactly one numbered source, the document — the photo is never [2].
  assert.match(text, /\[1\] RT-SVX23R/);
  assert.doesNotMatch(text, /\[2\]/);
});

// --- the structural enforcement ----------------------------------------------

test('a step the model justified by the photo alone is still dropped', () => {
  // `source: 9` does not exist — this is what "the photo told me" looks like on the
  // wire. validateAnswer drops it whatever the model saw, so a photo can never
  // produce an uncited claim.
  const out = validateAnswer(
    {
      kind: 'answer',
      steps: [
        { action: 'Replace the contactor — it looks pitted in your photo.', source: 9, reading: '' },
        { action: 'Check condenser fan rotation.', source: 1, reading: 'Correct direction.' },
      ],
    },
    SOURCES
  );
  assert.equal(out.dropped, 1);
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].source_document, 'RT-SVX23R-EN_Precedent-Rooftop-IOM');
  assert.doesNotMatch(out.body, /pitted/, 'the uncited photo claim must not render');
});

test('an answer that is ONLY photo-justified degrades to no-documentation', () => {
  const out = validateAnswer(
    { kind: 'answer', steps: [{ action: 'From the photo, replace the board.', source: 9, reading: '' }] },
    SOURCES
  );
  assert.equal(out.noDocumentation, true);
  assert.equal(out.citations.length, 0);
});

// --- ordering: safety and coverage come first --------------------------------

const explode = () => { throw new Error('MODEL CALLED'); };

test('a hazardous question with a photo attached still refuses, without decoding it', async () => {
  // The image is deliberate garbage: if prepareImage ran, it would throw a 400 and
  // this would fail. Refusing first is the point.
  const out = await diagnose(
    { symptom: 'walk me through recovering the refrigerant charge', documentIds: ['d'], image: 'not-base64!!' },
    { completeFn: explode }
  );
  assert.equal(out.kind, 'refusal');
  assert.equal(out.meta.category, 'refrigerant');
});

test('an uncovered unit with a photo answers no-documentation without decoding it', async () => {
  const out = await diagnose(
    { symptom: 'what is this part', documentIds: [], image: 'not-base64!!' },
    { completeFn: explode }
  );
  assert.equal(out.meta.noDocumentation, true);
  assert.notEqual(out.kind, 'refusal');
});

test('a malformed photo on an otherwise valid request is a clean 400, not a crash', async () => {
  // Uses the documented unscoped test path (ST-02/OQ1) so the request reaches
  // retrieval and then image preparation without needing a documents-table mock.
  await assert.rejects(
    diagnose(
      { symptom: 'fan not spinning', image: 'not-base64!!' },
      {
        allowUnscoped: true,
        completeFn: explode,
        embedFn: async () => ({ embeddings: [[0.1]], tokens: 1 }),
        db: {
          rpc: async () => ({
            data: [{ chunk_id: 'c1', out_document: 'D', out_page: 1, out_text: 't', out_similarity: 0.9 }],
            error: null,
          }),
        },
      }
    ),
    (e) => e instanceof DiagnoseError && e.status === 400 && /base64/i.test(e.message)
  );
});
