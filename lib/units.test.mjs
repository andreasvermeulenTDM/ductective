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
  // Coverage kept verbatim from the live manifest. The PM half was written as a bare
  // "PM" and so expanded to nothing a plate could match; it now carries its own
  // family notation, which is what makes 48PM028 resolve.
  { id: 'c-48-50pg', manufacturer: 'Carrier', coverage: '48/50PG (3-14 ton) & 48/50PM (16-28 ton)', doc_type: 'Install/Service', in_scope: true },
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

// --- nameplate model numbers (the defect found 7 Aug 2026) -------------------
//
// A technician types, or a camera reads, the model printed on the plate. Coverage
// strings name the family. Those are never equal, so exact matching resolved a
// covered unit as unrecognised — and it sat on the camera path, because vision.mjs
// returns the plate's model number verbatim and U4 resolves before the first
// question. Every fixture above uses a family name, which is exactly why none of
// them caught it.

const PLATED = [
  { manufacturer: 'Carrier', model: '48TCA06', doc: 'c-48tc' },
  { manufacturer: 'Carrier', model: '48TCED14', doc: 'c-48tc' },
  { manufacturer: 'Carrier', model: '50LC024', doc: 'c-48-50lc' },
  { manufacturer: 'Carrier', model: '48PM028', doc: 'c-48-50pg' },
  { manufacturer: 'Trane', model: 'YSC072E3RHB0000', doc: 't-ysc' },
  { manufacturer: 'Trane', model: 'YHC092F3', doc: 't-ysc' },
];

const PLATE_DOCS = [
  ...DOCS,
  { id: 'c-48tc', manufacturer: 'Carrier', coverage: '48TC packaged rooftop 3-15 ton', doc_type: 'Service/Maintenance', in_scope: true },
  { id: 't-ysc', manufacturer: 'Trane', coverage: 'Packaged rooftop (YHC, YSC)', doc_type: 'IOM', in_scope: true },
];

for (const p of PLATED) {
  test(`nameplate "${p.model}" resolves to its family manual`, () => {
    const r = classifyUnit({ manufacturer: p.manufacturer, model: p.model }, PLATE_DOCS);
    assert.equal(r.status, 'covered', `a covered unit read off the plate must not resolve unrecognised`);
    assert.ok(r.documentIds.includes(p.doc), `got ${r.documentIds.join(',') || 'none'}`);
  });
}

test('the family name still resolves — the fix is additive', () => {
  for (const model of ['48TC', '48LC', 'Precedent']) {
    const r = classifyUnit({ manufacturer: model === 'Precedent' ? 'Trane' : 'Carrier', model }, PLATE_DOCS);
    assert.equal(r.status, 'covered', `${model} regressed`);
  }
});

test('prefix matching does not let a manufacturer prefix alone claim a unit', () => {
  // "48" is two characters and must never match; otherwise every Carrier unit ever
  // built is covered by whichever 48-series manual sorts first.
  const r = classifyUnit({ manufacturer: 'Carrier', model: '48' }, PLATE_DOCS);
  assert.notEqual(r.status, 'covered');
});

test('a different family from a manufacturer we carry is still unrecognised', () => {
  // The load-bearing case for coverage honesty now that the corpus is broad: we hold
  // Carrier and Trane manuals, but not these families.
  for (const [manufacturer, model] of [
    ['Carrier', '58MVC080'],   // residential furnace, not in these fixtures
    ['Trane', 'YCAL0045'],     // a chiller model — must not prefix-match YHC/YSC
    ['Trane', 'XR13ACONT'],
  ]) {
    const r = classifyUnit({ manufacturer, model }, PLATE_DOCS);
    assert.equal(r.documentIds.length, 0, `${manufacturer} ${model} must resolve to no documents`);
  }
});

test('matching anchors at the left, so an interior fragment cannot claim a unit', () => {
  // The old implementation used coverage.includes(token): a Daikin "VRV IV"
  // contributed the token "iv", and any coverage containing "drive" or "five" would
  // have matched it. Anchored prefixes make that unrepresentable.
  const docs = [
    { id: 'x', manufacturer: 'Daikin', coverage: 'variable speed drive, five ton', doc_type: 'IOM', in_scope: true },
  ];
  const r = classifyUnit({ manufacturer: 'Daikin', model: 'VRV IV' }, docs);
  assert.equal(r.documentIds.length, 0, '"iv" matched inside a word');
});
