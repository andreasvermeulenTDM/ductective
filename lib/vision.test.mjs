/**
 * ST-05 — the nameplate vision path, stub-tested.
 *
 *   npm test
 *
 * Zero live Gemini calls by owner decision (today's quota is spent): every
 * provider interaction here is a stub, and the live ≥8/10 accuracy measurement
 * is ST-07's, in the next quota window. What CAN be proven without quota is
 * proven here: the downscaling math, the size gates, the response shapes, and
 * the two invariants that must not wait for quota —
 *
 *   - a provider block or transport failure is an ERROR (theirs/transport),
 *     never a fabricated identification
 *   - an unreadable plate is a deliberate identified:false, not a guess
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import {
  jpegDimensions,
  resizeDecision,
  downsampleRgba,
  downscaleJpeg,
  identifyUnit,
  MAX_IMAGE_BYTES,
  MAX_EDGE_PX,
} from './vision.mjs';
import { DiagnoseError } from './diagnose.mjs';
import { ProviderError } from './providers/gemini.mjs';

// --- fixtures ----------------------------------------------------------------

/** Encode a real JPEG in-memory — the tests never touch the filesystem. */
function makeJpeg(width, height, rgba = [128, 128, 128, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }
  return jpeg.encode({ data, width, height }, 90).data;
}

const READING = { legible: true, manufacturer: 'Trane', model: 'YSC060A4', confidence: 'high' };

function stubComplete(json, { blocked = false, blockReason = null } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return {
      json,
      text: JSON.stringify(json ?? {}),
      blocked,
      blockReason,
      model: 'stub-model',
      usage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 },
      finishReason: blocked ? 'SAFETY' : 'STOP',
    };
  };
  return { fn, calls };
}

const COVERED = {
  status: 'covered',
  documentIds: ['doc_trane1', 'doc_trane2'],
  documents: [],
  covered: [],
  message: 'Covered — 2 documents for this unit.',
};

// --- pure halves -------------------------------------------------------------

test('jpegDimensions reads width/height from a real JPEG without decoding it', () => {
  const buf = makeJpeg(64, 48);
  assert.deepEqual(jpegDimensions(buf), { height: 48, width: 64 });
});

test('jpegDimensions returns null for non-JPEG bytes', () => {
  assert.equal(jpegDimensions(Buffer.from('definitely not a jpeg')), null);
  assert.equal(jpegDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null); // PNG magic
  assert.equal(jpegDimensions(Buffer.alloc(0)), null);
});

test('resizeDecision passes a small image through untouched', () => {
  const d = resizeDecision({ width: 1024, height: 768, bytes: 200_000 });
  assert.deepEqual(d, { ok: true, resize: false, targetWidth: 1024, targetHeight: 768 });
});

test('resizeDecision caps the long edge at MAX_EDGE_PX preserving aspect', () => {
  const d = resizeDecision({ width: 4032, height: 3024, bytes: 3_000_000 });
  assert.equal(d.ok, true);
  assert.equal(d.resize, true);
  assert.equal(d.targetWidth, MAX_EDGE_PX);
  assert.equal(d.targetHeight, Math.round((3024 / 4032) * MAX_EDGE_PX));
  // Portrait orientation caps the other edge.
  const p = resizeDecision({ width: 3024, height: 4032, bytes: 3_000_000 });
  assert.equal(p.targetHeight, MAX_EDGE_PX);
});

test('resizeDecision rejects an over-cap payload as 413', () => {
  const d = resizeDecision({ width: 8000, height: 6000, bytes: MAX_IMAGE_BYTES + 1 });
  assert.equal(d.ok, false);
  assert.equal(d.status, 413);
});

test('downsampleRgba box-averages, not point-samples', () => {
  // 2×1 → 1×1: the output pixel must be the mean of both inputs, which
  // nearest-neighbour would never produce.
  const src = new Uint8Array([0, 0, 0, 255, 100, 200, 50, 255]);
  const out = downsampleRgba(src, 2, 1, 1, 1);
  assert.deepEqual([...out], [50, 100, 25, 255]);
});

test('downscaleJpeg produces a decodable JPEG at the target size', () => {
  const wide = makeJpeg(3200, 200);
  const out = downscaleJpeg(wide, 1536, 96);
  assert.equal(out.width, 1536);
  const decoded = jpeg.decode(out.data, { useTArray: true });
  assert.equal(decoded.width, 1536);
  assert.equal(decoded.height, 96);
});

// --- identifyUnit ------------------------------------------------------------

const asBase64 = (buf) => Buffer.from(buf).toString('base64');

test('a readable plate returns the identification plus the resolved unit and its documentIds', async () => {
  const { fn, calls } = stubComplete(READING);
  const resolved = [];
  const out = await identifyUnit(
    { image: asBase64(makeJpeg(640, 480)) },
    { completeFn: fn, resolveFn: async (q) => { resolved.push(q); return COVERED; } }
  );

  assert.equal(out.identified, true);
  assert.equal(out.manufacturer, 'Trane');
  assert.equal(out.model, 'YSC060A4');
  assert.equal(out.confidence, 'high');
  // Composition with /resolve-unit, verbatim — the narrowing seam for ST-04.
  assert.deepEqual(resolved, [{ manufacturer: 'Trane', model: 'YSC060A4' }]);
  assert.deepEqual(out.unit.documentIds, ['doc_trane1', 'doc_trane2']);
  assert.equal(out.message, COVERED.message);
  // Confidence is a class on the wire — never a decimal anywhere in the body.
  assert.doesNotMatch(JSON.stringify({ ...out, meta: null }), /0\.\d/);
  // The provider got inlineData plus the structured schema.
  const parts = calls[0].messages[0].parts;
  assert.ok(parts[0].inlineData?.data.length > 0);
  assert.equal(parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(calls[0].json.properties.confidence.enum.length, 3);
  assert.equal(out.meta.image.resized, false);
});

test('an oversized image is downscaled before the provider sees it', async () => {
  const { fn, calls } = stubComplete(READING);
  const big = makeJpeg(3200, 2400);
  const out = await identifyUnit(
    { image: asBase64(big) },
    { completeFn: fn, resolveFn: async () => COVERED }
  );

  assert.equal(out.meta.image.resized, true);
  assert.equal(out.meta.image.width, MAX_EDGE_PX);
  assert.equal(out.meta.image.height, 1152);
  assert.equal(out.meta.image.originalBytes, big.length);
  assert.ok(out.meta.image.sentBytes < big.length);
  const sentBytes = Buffer.from(calls[0].messages[0].parts[0].inlineData.data, 'base64');
  assert.deepEqual(jpegDimensions(sentBytes), { width: MAX_EDGE_PX, height: 1152 });
});

test('an unreadable plate is identified:false with no unit — a deliberate answer, not an error', async () => {
  const { fn } = stubComplete({ legible: false, confidence: 'low' });
  const resolveCalls = [];
  const out = await identifyUnit(
    { image: asBase64(makeJpeg(640, 480)) },
    { completeFn: fn, resolveFn: async (q) => { resolveCalls.push(q); return COVERED; } }
  );

  assert.equal(out.identified, false);
  assert.equal(out.manufacturer, null);
  assert.equal(out.model, null);
  assert.equal(out.unit, null);
  assert.equal(resolveCalls.length, 0, 'nothing to resolve — resolveUnit must not be called');
  assert.match(out.message, /couldn't read/i);
});

test('legible but missing model number is not an identification either', async () => {
  const { fn } = stubComplete({ legible: true, manufacturer: 'Trane', model: '', confidence: 'medium' });
  const out = await identifyUnit(
    { image: asBase64(makeJpeg(640, 480)) },
    { completeFn: fn, resolveFn: async () => COVERED }
  );
  assert.equal(out.identified, false);
  assert.equal(out.unit, null);
  assert.equal(out.manufacturer, 'Trane', 'partial reading is surfaced, not laundered into an identification');
});

test('a provider safety block is an ERROR with providerBlocked — never a fabricated identification', async () => {
  const { fn } = stubComplete(null, { blocked: true, blockReason: 'candidate:SAFETY' });
  await assert.rejects(
    () => identifyUnit({ image: asBase64(makeJpeg(640, 480)) }, { completeFn: fn, resolveFn: async () => COVERED }),
    (e) =>
      e instanceof DiagnoseError &&
      e.status === 502 &&
      e.providerBlocked === true &&
      e.blockReason === 'candidate:SAFETY'
  );
});

test('a transport failure surfaces as the wire error shape, without providerBlocked', async () => {
  const boom = async () => { throw new ProviderError(429, 'Gemini 429: quota'); };
  await assert.rejects(
    () => identifyUnit({ image: asBase64(makeJpeg(640, 480)) }, { completeFn: boom }),
    (e) => e instanceof DiagnoseError && e.status === 429 && !e.providerBlocked
  );
});

test('input gates run before any provider call', async () => {
  const { fn, calls } = stubComplete(READING);
  const deps = { completeFn: fn, resolveFn: async () => COVERED };

  // Missing image.
  await assert.rejects(() => identifyUnit({}, deps), (e) => e.status === 400);
  // Not base64.
  await assert.rejects(() => identifyUnit({ image: '!!not-base64!!' }, deps), (e) => e.status === 400);
  // Base64 but not a JPEG.
  await assert.rejects(
    () => identifyUnit({ image: Buffer.from('plain text').toString('base64') }, deps),
    (e) => e.status === 400
  );
  // Wrong declared type.
  await assert.rejects(
    () => identifyUnit({ image: asBase64(makeJpeg(64, 64)), mimeType: 'image/png' }, deps),
    (e) => e.status === 415
  );
  // Over the byte cap — padded JPEG so the size gate, not the parser, fires.
  const padded = Buffer.concat([makeJpeg(64, 64), Buffer.alloc(MAX_IMAGE_BYTES)]);
  await assert.rejects(() => identifyUnit({ image: asBase64(padded) }, deps), (e) => e.status === 413);

  assert.equal(calls.length, 0, 'no gate failure may reach the provider');
});

test('a data: URI prefix is accepted and stripped', async () => {
  const { fn } = stubComplete(READING);
  const out = await identifyUnit(
    { image: `data:image/jpeg;base64,${asBase64(makeJpeg(320, 240))}` },
    { completeFn: fn, resolveFn: async () => COVERED }
  );
  assert.equal(out.identified, true);
});
