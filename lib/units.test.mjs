/**
 * Unit tests for U4 coverage resolution.
 *
 *   npm test
 *
 * Fixtures are copied from the real `documents` table, including the two cases the
 * matching exists to survive: Carrier's `48/50XX` family notation, and PT charts
 * that are `in_scope` without being units.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUnit, unitMatches, coveredFamilies, expandFamilies } from './units.mjs';

const DOCS = [
  { id: 'c-48-50lc', manufacturer: 'Carrier', coverage: '48/50LC single package rooftop 4-6 ton', doc_type: 'Install/Service', in_scope: true },
  { id: 'c-48-50pg', manufacturer: 'Carrier', coverage: '48/50PG (3-14 ton) & PM (16-28 ton)', doc_type: 'Install/Service', in_scope: true },
  { id: 't-precedent', manufacturer: 'Trane', coverage: 'Precedent rooftop (heat/cool)', doc_type: 'IOM + diagnostics', in_scope: true },
  { id: 't-eflex', manufacturer: 'Trane', coverage: 'Precedent with eFlex', doc_type: 'IOM + diagnostics', in_scope: true },
  { id: 'd-rebel', manufacturer: 'Daikin Applied', coverage: 'Rebel applied rooftop (MicroTech)', doc_type: 'Operations', in_scope: false },
  { id: 'pt-honeywell', manufacturer: 'Honeywell', coverage: 'R-454B', doc_type: 'PT Chart', in_scope: true },
  { id: 'pt-goodman', manufacturer: 'Goodman / Daikin', coverage: 'R-22 / R-410A / R-32 / R-454B', doc_type: 'PT Chart', in_scope: true },
];

// --- the Carrier family-notation case ---------------------------------------

test('expandFamilies emits both halves and keeps the original', () => {
  const out = expandFamilies('48/50LC single package');
  assert.match(out, /48LC/);
  assert.match(out, /50LC/);
  assert.match(out, /48\/50LC/);
});

for (const model of ['48LC', '50LC', '48/50LC']) {
  test(`"${model}" resolves to the 48/50LC manual`, () => {
    const r = classifyUnit({ manufacturer: 'Carrier', model }, DOCS);
    assert.equal(r.status, 'covered');
    assert.ok(r.documentIds.includes('c-48-50lc'), `got ${r.documentIds.join(',')}`);
  });
}

// --- PT charts are in_scope but are not units -------------------------------

test('a PT chart never makes a unit covered', () => {
  // Holding R-454B gauges on a Daikin must not resolve as supported.
  const r = classifyUnit({ manufacturer: 'Daikin', model: 'R-454B' }, DOCS);
  assert.notEqual(r.status, 'covered');
});

test('unitMatches ignores PT charts outright', () => {
  const pt = DOCS.find((d) => d.id === 'pt-honeywell');
  assert.deepEqual(unitMatches({ manufacturer: 'Honeywell', model: 'R-454B' }, pt), {
    manufacturer: false,
    model: false,
  });
});

test('coveredFamilies lists equipment only, never refrigerants', () => {
  const fams = coveredFamilies(DOCS);
  assert.equal(fams.some((f) => f.families.some((c) => /R-454B/.test(c))), false);
  assert.ok(fams.some((f) => f.manufacturer === 'Trane'));
});

// --- the three U4 states ------------------------------------------------------

test('in scope → covered', () => {
  const r = classifyUnit({ manufacturer: 'Trane', model: 'Precedent' }, DOCS);
  assert.equal(r.status, 'covered');
  assert.ok(r.documentIds.length >= 1);
});

test('ingested but out of Phase 1 scope → says so, and names what is covered', () => {
  const r = classifyUnit({ manufacturer: 'Daikin Applied', model: 'Rebel' }, DOCS);
  assert.equal(r.status, 'out_of_scope');
  assert.equal(r.documentIds.length, 0, 'out-of-scope docs must not be offered for retrieval');
  assert.match(r.message, /Trane|Carrier/);
});

test('"Daikin" alone still recognises the out-of-scope manufacturer', () => {
  // Containment both ways — otherwise this reads as "never heard of it", and U4
  // requires the two states to be distinguishable.
  const r = classifyUnit({ manufacturer: 'Daikin', model: 'Rebel' }, DOCS);
  assert.equal(r.status, 'out_of_scope');
});

test('unknown manufacturer → unrecognised, and does not guess', () => {
  const r = classifyUnit({ manufacturer: 'Lennox', model: 'KGA092' }, DOCS);
  assert.equal(r.status, 'unrecognised');
  assert.equal(r.documentIds.length, 0);
  assert.match(r.message, /don't have documentation/i);
});

test('known manufacturer, unknown model → leads with that manufacturer families', () => {
  const r = classifyUnit({ manufacturer: 'Trane', model: 'Voyager' }, DOCS);
  assert.equal(r.status, 'unrecognised');
  assert.match(r.message, /For Trane I cover/);
  assert.match(r.message, /Precedent/);
});

test('manufacturer alone never counts as covered', () => {
  // Otherwise every Carrier unit ever built is "covered" by the 48/50LC manual.
  const r = classifyUnit({ manufacturer: 'Carrier', model: '' }, DOCS);
  assert.notEqual(r.status, 'covered');
});

test('a more specific model still resolves', () => {
  const r = classifyUnit({ manufacturer: 'Trane', model: 'Precedent eFlex' }, DOCS);
  assert.equal(r.status, 'covered');
  assert.ok(r.documentIds.includes('t-eflex'));
});

test('every covered result carries the document ids U5 will filter on', () => {
  const r = classifyUnit({ manufacturer: 'Carrier', model: '48LC' }, DOCS);
  assert.equal(r.status, 'covered');
  assert.ok(r.documentIds.every((id) => typeof id === 'string' && id.length > 0));
});
