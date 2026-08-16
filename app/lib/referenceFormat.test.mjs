/**
 * ST-R06 — the reference parser, including the case where it must refuse.
 *
 *   npm test
 *
 * `parseReference` is the half of ST-R06 that does not need a renderer, and it
 * is also the half carrying the safety-shaped decision: a body with a numbered
 * line is a *procedure*, and re-drawing a procedure as inert data strips the
 * qualification that makes a procedure safe to read. The parser declines rather
 * than launders, and the third block below is what pins that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseReference } from './referenceFormat.ts';

// ---------------------------------------------------------------------------
// The documented shape (ST-R05 AC 5): `spec — value (condition)`
// ---------------------------------------------------------------------------

test('a body of spec/value lines parses into rows, in order', () => {
  const { lead, items, note } = parseReference(
    'Minimum service clearance, condenser coil side — 36 in\n' +
    'Minimum clearance, control panel side — 42 in\n' +
    'MCA — 41.2 A'
  );
  assert.equal(lead, '');
  assert.equal(note, '');
  assert.deepEqual(items.map((i) => i.spec), [
    'Minimum service clearance, condenser coil side',
    'Minimum clearance, control panel side',
    'MCA',
  ]);
  assert.deepEqual(items.map((i) => i.value), ['36 in', '42 in', '41.2 A']);
  assert.deepEqual(items.map((i) => i.condition), [null, null, null]);
});

test('a trailing parenthesis is the manual\'s qualifier, not part of the value', () => {
  const { items } = parseReference('Compressor lug torque — 35 in-lb (dry, 8 AWG)');
  assert.deepEqual(items, [
    { spec: 'Compressor lug torque', value: '35 in-lb', condition: 'dry, 8 AWG' },
  ]);
});

test('a hyphen inside a spec or a value does not split the row', () => {
  // "in-lb", "48/50-series", "Rev-B" — the separator is the first em dash, and
  // the ladder never reaches the hyphen rung while an em dash is present.
  const { items } = parseReference('Line-set length, pre-charged — 25 ft max');
  assert.equal(items.length, 1);
  assert.equal(items[0].spec, 'Line-set length, pre-charged');
  assert.equal(items[0].value, '25 ft max');
});

test('prose above the rows is the lead, prose below is the note', () => {
  const { lead, items, note } = parseReference(
    'From the installation manual for this unit:\n' +
    'MOCP — 50 A\n' +
    'This is a published value, not an instruction to work in the panel. ' +
    'Follow your own lockout/tagout procedure and your certification training.'
  );
  assert.equal(lead, 'From the installation manual for this unit:');
  assert.equal(items.length, 1);
  assert.match(note, /^This is a published value/);
  assert.match(note, /certification training\.$/);
});

test('the note keeps every word — it is server copy and is never trimmed to fit', () => {
  const sentence =
    'Torquing a lug is work inside an electrical enclosure; this is the specified ' +
    'value only, and the standard de-energise-and-verify procedure applies.';
  const { note } = parseReference(`Lug torque — 35 in-lb\n${sentence}`);
  assert.equal(note, sentence);
});

// ---------------------------------------------------------------------------
// The refusal to launder — the block that matters most
// ---------------------------------------------------------------------------

test('a numbered line disqualifies the whole body, whatever meta.shape said', () => {
  // Not "the numbered line is dropped". The *whole* parse returns no items, so
  // Message.tsx falls back to the ordinary answer turn and the body is drawn as
  // the ordered checklist it evidently is — under CHECK IN THIS ORDER, with the
  // advise-only footer. Stripping the "1." and drawing the rest as spec rows
  // would present a procedure as inert data, which is the failure ST-R06's user
  // story names, pointed the other way.
  for (const body of [
    '1. Isolate the unit — at the disconnect',
    'MCA — 41.2 A\n2. Land the conductors — per the wiring diagram',
    '  3) Purge the line — 5 minutes',
  ]) {
    assert.deepEqual(parseReference(body).items, [], `not disqualified: ${body}`);
  }
});

test('a Reading: marker disqualifies the body too', () => {
  // `Reading:` is the diagnostic answer's own marker (`answerFormat.ts`). Its
  // presence means this is a check with a measurement, not a published datum.
  assert.deepEqual(
    parseReference('Suction pressure — 118 psig\nReading: 118 psig at 45F ambient').items,
    []
  );
});

test('a row with no value is dropped rather than rendered as a bare label', () => {
  // ST-R05 AC 3 drops value-less items server-side; this is the same rule on the
  // client, because a label with nothing beside it reads as a heading and a
  // heading is not a citable datum.
  const { items } = parseReference('Terminate the conductors — \nMCA — 41.2 A');
  assert.deepEqual(items.map((i) => i.spec), ['MCA']);
});

test('nothing parseable yields no items, never a half-row', () => {
  for (const body of ['', '   ', 'I have documentation covering that but no value for it.']) {
    assert.deepEqual(parseReference(body).items, []);
  }
});

// ---------------------------------------------------------------------------
// The separator ladder (the ADAPTER — see the module header)
// ---------------------------------------------------------------------------

test('ADAPTER: an en dash or a spaced hyphen is tolerated when no em dash is present', () => {
  // ST-R05 AC 5 documents the em dash. Backend had not landed when this was
  // written, so two near-misses a server-side join plausibly produces are
  // tolerated. Additive only: the em dash always wins where it appears.
  assert.equal(parseReference('MCA – 41.2 A').items[0].value, '41.2 A');
  assert.equal(parseReference('MCA - 41.2 A').items[0].value, '41.2 A');
});

test('ADAPTER: the em dash wins outright, so a hyphen inside a value stays inside it', () => {
  const { items } = parseReference('Lug torque — 35 in-lb');
  assert.equal(items.length, 1);
  assert.equal(items[0].value, '35 in-lb');
});

test('ADAPTER: one separator is chosen for the whole body, not per line', () => {
  // Mixed separators would otherwise let a hyphenated *spec* on one line become
  // a row while the em-dash rows on the others already had. One ladder rung per
  // body keeps the row set deterministic.
  const { items } = parseReference('Charge, factory — 11 lb 4 oz\nPre-charged length - 25 ft');
  assert.equal(items.length, 1);
  assert.equal(items[0].spec, 'Charge, factory');
});

// ---------------------------------------------------------------------------
// There is no imperative slot, and the type cannot grow one by accident
// ---------------------------------------------------------------------------

test('a parsed item carries exactly spec, value and condition — no action field', () => {
  // ST-R05 AC 1: the whole construction is that a reference item has no
  // imperative slot for a model to fill. Asserted on the parsed object, so a
  // future field named `action` fails here rather than in review.
  const [item] = parseReference('MCA — 41.2 A (208/230V, 3ph)').items;
  assert.deepEqual(Object.keys(item).sort(), ['condition', 'spec', 'value']);
});
