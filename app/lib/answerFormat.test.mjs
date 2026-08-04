/**
 * Unit tests for the prose→structure parser.
 *
 *   node --test app/lib/
 *
 * This is the piece most likely to break silently: it reads structure out of
 * phrasing, and Run B's phrasing is not fixed. A regression here degrades a
 * numbered checklist into a wall of prose without failing anything else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer } from './answerFormat.ts';

test('prose with no numbered steps is all lead', () => {
  const r = parseAnswer('Heat is not leaving the condenser coil.');
  assert.equal(r.lead, 'Heat is not leaving the condenser coil.');
  assert.deepEqual(r.steps, []);
  assert.equal(r.reading, '');
});

test('lead, steps, and trailing reading are separated', () => {
  const r = parseAnswer(
    'High head pressure resolves to one of two things:\n' +
      '\n' +
      '1. Condenser coil loading. Check the full face.\n' +
      '2. Condenser fan operation. Confirm rotation.\n' +
      '\n' +
      'Take a liquid-line reading before and after.'
  );

  assert.equal(r.lead, 'High head pressure resolves to one of two things:');
  assert.equal(r.steps.length, 2);
  assert.equal(r.reading, 'Take a liquid-line reading before and after.');
});

test('a short opening clause becomes the bolded headline', () => {
  const [step] = parseAnswer('1. Coil face, entering side. Debris packs the inlet.').steps;
  assert.equal(step.headline, 'Coil face, entering side.');
  assert.equal(step.rest, 'Debris packs the inlet.');
});

test('a long opening clause is not bolded', () => {
  // Emphasising half a sentence reads worse than emphasising none of it.
  const long =
    '1. Check whether the condenser coil is loaded across its entire face rather than only where you can reach. Then move on.';
  const [step] = parseAnswer(long).steps;
  assert.equal(step.headline, null);
  assert.match(step.rest, /^Check whether/);
});

test('a step with no sentence break has no headline', () => {
  const [step] = parseAnswer('1. Confirm all fans run and rotate the correct way').steps;
  assert.equal(step.headline, null);
  assert.equal(step.rest, 'Confirm all fans run and rotate the correct way');
});

test('both "1." and "1)" are recognised', () => {
  assert.equal(parseAnswer('1) First thing\n2) Second thing').steps.length, 2);
});

test('wrapped continuation lines attach to the step above', () => {
  const r = parseAnswer(
    '1. Coil face. Debris packs the inlet\n' +
      'and leaves the outside looking clean.\n' +
      '2. Fan rotation. Both turning is not both working.'
  );

  assert.equal(r.steps.length, 2);
  assert.match(r.steps[0].rest, /leaves the outside looking clean/);
  // The continuation must not be mistaken for the trailing reading.
  assert.equal(r.reading, '');
});

test('steps at the very end leave no reading', () => {
  const r = parseAnswer('Lead line.\n\n1. Only step.');
  assert.equal(r.reading, '');
  assert.equal(r.lead, 'Lead line.');
});

test('an answer that opens straight into steps has an empty lead', () => {
  const r = parseAnswer('1. First. Do this.\n2. Second. Do that.');
  assert.equal(r.lead, '');
  assert.equal(r.steps.length, 2);
});

test('a numbered value inside prose does not start a step list', () => {
  // "630 psig" and similar must not be mistaken for step numbering — the pattern
  // is anchored to the start of a line for exactly this reason.
  const body = 'The switch opens at 630 psig and resets at 505.';
  const r = parseAnswer(body);
  assert.deepEqual(r.steps, []);
  assert.equal(r.lead, body);
});
