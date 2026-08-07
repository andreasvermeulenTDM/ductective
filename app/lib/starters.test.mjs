/**
 * Tests for unit-aware starter suggestions.
 *
 * The load-bearing assertion is the safety one: a suggestion the safety gate would
 * refuse is worse than no suggestion, because the app invites a question and then
 * declines it. This runs the real `classifyHazard` over every starter of every
 * class, so a future edit that adds "gas heat won't ignite" fails here rather than
 * on a roof.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEquipment, startersFor } from './starters.ts';
import { classifyHazard } from '../../lib/safety.mjs';

const CLASSES = ['rooftop', 'furnace', 'heatpump', 'airhandler', 'ductless', 'boiler', 'general'];

test('no starter, in any class, is something the safety gate refuses', () => {
  for (const cls of CLASSES) {
    // Reach each class through its own coverage text rather than the export, so the
    // assertion covers what a user can actually be shown.
    const coverage = {
      rooftop: ['48TC packaged rooftop 3-15 ton'],
      furnace: ['ACEC gas furnace (residential)'],
      heatpump: ['25VNA8 split-system heat pump'],
      airhandler: ['CBX27UHE variable-speed air handler'],
      ductless: ['Climate 5000 wall-mount single split (ductless)'],
      boiler: ['BWBC cast-iron gas boiler'],
      general: [],
    }[cls];
    for (const s of startersFor(null, coverage)) {
      const hazard = classifyHazard(s);
      assert.equal(
        hazard,
        null,
        `starter "${s}" (${cls}) would be refused as ${hazard?.category} — the app must not suggest a question it declines`
      );
    }
  }
});

test('coverage text drives the class, not the typed label', () => {
  assert.equal(classifyEquipment('Some Unit', ['48TC packaged rooftop 3-15 ton']), 'rooftop');
  assert.equal(classifyEquipment('Goodman GMEC96', ['ACEC / AMEC gas furnace (residential)']), 'furnace');
  assert.equal(classifyEquipment(null, ['Climate 5000 Gen4 wall-mount single split (ductless)']), 'ductless');
  assert.equal(classifyEquipment(null, ['BWBC cast-iron gas boiler, forced hot water']), 'boiler');
  assert.equal(classifyEquipment(null, ['CBX27UHE variable-speed air handler']), 'airhandler');
});

test('the typed label is the fallback when there is no verdict', () => {
  assert.equal(classifyEquipment('Trane Precedent YSC072', []), 'rooftop');
  assert.equal(classifyEquipment('Carrier 59MN7B furnace', []), 'furnace');
});

test('a rooftop that is also a heat pump reads as rooftop — the more useful frame', () => {
  assert.equal(classifyEquipment(null, ['Precedent packaged rooftop heat pump 12.5-25 tons']), 'rooftop');
});

test('an unrecognised unit gets neutral suggestions rather than a guess', () => {
  assert.equal(classifyEquipment('Some Machine 9000', []), 'general');
  assert.deepEqual(startersFor(null, []), startersFor('Some Machine 9000', []));
});

test('every class offers exactly four suggestions', () => {
  for (const cls of CLASSES) {
    const list = startersFor(cls === 'general' ? null : cls, [cls]);
    assert.equal(list.length, 4);
    assert.equal(new Set(list).size, 4, 'suggestions must be distinct');
  }
});

test('suggestions do not name a unit — the gate already established it', () => {
  for (const cls of CLASSES) {
    for (const s of startersFor(null, [cls])) {
      assert.doesNotMatch(s, /Precedent|Carrier|Trane|48\/50/i, `"${s}" hardcodes a unit`);
    }
  }
});
