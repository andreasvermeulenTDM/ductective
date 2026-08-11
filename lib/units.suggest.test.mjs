/**
 * ST-F10 — `suggestUnits`, the type-ahead's correctness.
 *
 *   npm test
 *
 * The criterion this file exists for is AC 2: **every suggestion is answerable**.
 * A suggestion is a coverage claim, and offering one the corpus cannot answer on
 * is worse than offering nothing, because the technician has now been told we
 * hold it. So the truthfulness check below is not run against a fixture sample —
 * it is run against **every family in the whole manifest, from every 3-character
 * prefix that occurs in it**, and each surviving suggestion is put back through
 * `classifyUnit` and required to come out `covered` with at least one document.
 *
 * The manifest is read rather than hardcoded for the same reason the function
 * itself contains no manufacturer string: a fixed list is correct the day it is
 * written and silently wrong the day a document is ingested or re-scoped.
 * (The live-`documents`-table version of this check is ST-F12, Stage 5.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyUnit, coveredFamilies, norm, suggestUnits } from './units.mjs';
import { parseCsv } from '../tests/lib/csv.mjs';
import { blankComments } from '../tests/lib/jsx.mjs';

// --- the whole manifest, in the shape the `documents` table hands over -------

const MANIFEST = parseCsv(
  readFileSync(new URL('../data/manifest.csv', import.meta.url), 'utf8')
);

/**
 * `ingest/reconcile.mjs`'s two scope rules, applied to the manifest rows:
 * `OUT-OF-SCOPE` is ingested-but-not-answered-on, `EXCLUDED` never enters the
 * knowledge base at all.
 */
const LIVE_DOCS = MANIFEST.rows
  .filter((r) => !/^\s*EXCLUDED/i.test(r['Legal Status'] ?? ''))
  .map((r, i) => ({
    id: `doc_${i}`,
    manufacturer: r.Manufacturer,
    coverage: r['Model / Coverage'],
    doc_type: r.DocType,
    in_scope: !/^\s*OUT-OF-SCOPE/i.test(r['Legal Status'] ?? ''),
  }));

// --- small fixtures, sharing units.test.mjs's shape --------------------------

const DOCS = [
  { id: 'c-48-50lc', manufacturer: 'Carrier', coverage: '48/50LC single package rooftop 4-6 ton', doc_type: 'Install/Service', in_scope: true },
  { id: 'c-48tc', manufacturer: 'Carrier', coverage: '48TC packaged rooftop 3-15 ton', doc_type: 'Service/Maintenance', in_scope: true },
  { id: 't-precedent', manufacturer: 'Trane', coverage: 'Precedent rooftop (heat/cool)', doc_type: 'IOM + diagnostics', in_scope: true },
  { id: 't-ysc', manufacturer: 'Trane', coverage: 'Packaged rooftop (YHC, YSC)', doc_type: 'IOM + diagnostics', in_scope: true },
  { id: 'd-rebel', manufacturer: 'Daikin Applied', coverage: 'Rebel applied rooftop (MicroTech)', doc_type: 'Operations', in_scope: false },
  { id: 'pt-honeywell', manufacturer: 'Honeywell', coverage: 'R-454B', doc_type: 'PT Chart', in_scope: true },
];

// ---------------------------------------------------------------------------
// AC 2 — every suggestion is answerable. Over the whole manifest.
// ---------------------------------------------------------------------------

/** Every 3-character prefix that actually occurs in the corpus's vocabulary. */
function corpusPrefixes(docs) {
  const prefixes = new Set();
  for (const { manufacturer, families } of coveredFamilies(docs)) {
    for (const token of norm(manufacturer).split(' ')) {
      if (token.length >= 3) prefixes.add(token.slice(0, 3));
    }
    for (const family of families) {
      for (const token of norm(family).split(' ')) {
        if (token.length >= 3) prefixes.add(token.slice(0, 3));
      }
    }
  }
  return [...prefixes].sort();
}

test('AC 2 — every suggestion from every corpus prefix resolves covered with ≥ 1 document', () => {
  const prefixes = corpusPrefixes(LIVE_DOCS);
  assert.ok(prefixes.length > 50, `only ${prefixes.length} prefixes — is the manifest loaded?`);

  let checked = 0;
  for (const prefix of prefixes) {
    for (const s of suggestUnits(prefix, LIVE_DOCS)) {
      const verdict = classifyUnit({ manufacturer: s.manufacturer, model: s.family }, LIVE_DOCS);
      assert.equal(verdict.status, 'covered', `"${prefix}" → ${s.label} is not covered`);
      assert.ok(s.documentIds.length >= 1, `"${prefix}" → ${s.label} carries no documents`);
      assert.deepEqual(s.documentIds, verdict.documentIds, `${s.label}: scope differs from /resolve-unit`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} suggestions checked`);
});

test('AC 2 — no suggestion is ever drawn from an out-of-scope or PT-chart document', () => {
  const answerable = new Set(
    LIVE_DOCS.filter((d) => d.in_scope && d.doc_type !== 'PT Chart').map((d) => d.id)
  );
  for (const prefix of corpusPrefixes(LIVE_DOCS)) {
    for (const s of suggestUnits(prefix, LIVE_DOCS)) {
      for (const id of s.documentIds) {
        assert.ok(answerable.has(id), `${s.label} offered ${id}, which is not answerable`);
      }
    }
  }
});

test('the corpus this is measured against is the real one', () => {
  // Not an assertion about suggestions — an assertion that the fixture is the
  // live manifest, so a corpus that silently shrank shows up here.
  const families = coveredFamilies(LIVE_DOCS);
  assert.ok(families.length >= 10, `${families.length} manufacturers in scope`);
  assert.ok(LIVE_DOCS.length >= 80, `${LIVE_DOCS.length} documents`);
});

// ---------------------------------------------------------------------------
// AC 3 — derived from the corpus, never from a literal
// ---------------------------------------------------------------------------

test('AC 3 — no manufacturer name from the corpus appears in suggestUnits\' code', () => {
  const source = readFileSync(new URL('./units.mjs', import.meta.url), 'utf8');
  // Comments are blanked, not stripped, so offsets survive: the prose above the
  // function names Carrier and Trane on purpose, to explain the matching rules.
  const code = blankComments(source);
  const start = code.indexOf('export function suggestUnits');
  const end = code.indexOf('export async function suggestUnitsLive');
  assert.ok(start > 0 && end > start);
  const body = code.slice(start, end);

  const names = [...new Set(MANIFEST.rows.map((r) => r.Manufacturer).filter(Boolean))];
  assert.ok(names.length >= 14, `${names.length} manufacturers in the manifest`);
  for (const name of names) {
    for (const word of name.split(/[^A-Za-z]+/).filter((w) => w.length >= 4)) {
      assert.equal(
        new RegExp(`\\b${word}\\b`, 'i').test(body),
        false,
        `"${word}" is hardcoded in suggestUnits — suggestions must come from the corpus`
      );
    }
  }
});

test('AC 3 — suggestions come through coveredFamilies, so PT charts cannot appear', () => {
  const source = blankComments(readFileSync(new URL('./units.mjs', import.meta.url), 'utf8'));
  const body = source.slice(
    source.indexOf('export function suggestUnits'),
    source.indexOf('export async function suggestUnitsLive')
  );
  assert.match(body, /coveredFamilies\(/);
  assert.match(body, /classifyUnit\(/);
});

// ---------------------------------------------------------------------------
// AC 4, 5 — partial manufacturer and partial model, both directions
// ---------------------------------------------------------------------------

test('AC 4 — a partial manufacturer suggests that manufacturer\'s families', () => {
  const trane = suggestUnits('tra', DOCS);
  assert.ok(trane.length >= 2, `got ${trane.length}`);
  assert.ok(trane.every((s) => s.manufacturer === 'Trane'), trane.map((s) => s.label).join(' | '));

  const carrier = suggestUnits('car', DOCS);
  assert.ok(carrier.length >= 2);
  assert.ok(carrier.every((s) => s.manufacturer === 'Carrier'));
});

test('AC 5 — both halves of Carrier\'s 48/50XX notation reach the same document', () => {
  for (const query of ['48LC', '50LC', '48/50LC']) {
    const hit = suggestUnits(query, DOCS);
    assert.ok(hit.length >= 1, `"${query}" suggested nothing`);
    assert.ok(
      hit.some((s) => s.documentIds.includes('c-48-50lc')),
      `"${query}" → ${hit.map((s) => s.label).join(' | ') || 'nothing'}`
    );
  }
});

test('AC 5 — a nameplate prefix longer than the family name still lands', () => {
  // The plate says YSC072E3RHB0000; the manual's coverage says YSC.
  for (const query of ['YSC0', 'YSC072E3', 'YSC072E3RHB0000']) {
    const hit = suggestUnits(query, DOCS);
    assert.ok(hit.some((s) => s.documentIds.includes('t-ysc')), `"${query}" missed the YSC manual`);
  }
});

test('AC 5 — the real corpus answers a partial model the same way', () => {
  const hit = suggestUnits('48TC', LIVE_DOCS);
  assert.ok(hit.length >= 1);
  assert.ok(hit.some((s) => /48TC/i.test(s.family)), hit.map((s) => s.label).join(' | '));
});

// ---------------------------------------------------------------------------
// AC 6, 7, 8 — the floors, the empty answer, and the ordering
// ---------------------------------------------------------------------------

test('AC 6 — a query shorter than MIN_PREFIX suggests nothing', () => {
  for (const query of ['4', '48', 't', 'tr', '  ', '']) {
    assert.deepEqual(suggestUnits(query, DOCS), [], `"${query}" suggested something`);
  }
});

test('AC 6 — a bare "48" cannot claim every Carrier manual, on the real corpus either', () => {
  assert.deepEqual(suggestUnits('48', LIVE_DOCS), []);
});

test('AC 7 — a query matching nothing returns [], never a nearest guess', () => {
  for (const query of ['zzz', 'mitsubishi', 'XR13ACONT', 'quokka']) {
    assert.deepEqual(suggestUnits(query, LIVE_DOCS), [], `"${query}" guessed`);
  }
});

test('AC 7 — an out-of-scope manufacturer produces no suggestions', () => {
  // Daikin Applied's Rebel is in the fixture with in_scope: false.
  const hit = suggestUnits('rebel', DOCS);
  assert.deepEqual(hit, []);
});

test('AC 7 — a PT chart never becomes a suggestion', () => {
  assert.deepEqual(suggestUnits('R-454B', DOCS), []);
  assert.deepEqual(suggestUnits('honeywell', DOCS), []);
});

test('AC 8 — results are capped at 8 and deterministically ordered', () => {
  const first = suggestUnits('roof', LIVE_DOCS);
  assert.ok(first.length <= 8, `${first.length} suggestions`);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(suggestUnits('roof', LIVE_DOCS), first, 'ordering is not deterministic');
  }
});

test('AC 8 — a model match sorts ahead of a manufacturer-only match', () => {
  const hits = suggestUnits('carrier 48TC', DOCS);
  assert.ok(hits.length >= 2);
  assert.equal(hits[0].matchedOn, 'model');
  assert.match(hits[0].family, /48TC/);
});

// ---------------------------------------------------------------------------
// Payload shape — what the frontend renders
// ---------------------------------------------------------------------------

test('every suggestion carries manufacturer, family, label and documentIds', () => {
  for (const s of suggestUnits('tra', DOCS)) {
    assert.equal(typeof s.manufacturer, 'string');
    assert.equal(typeof s.family, 'string');
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.includes(s.manufacturer) && s.label.includes(s.family));
    assert.ok(Array.isArray(s.documentIds) && s.documentIds.length >= 1);
    assert.ok(['model', 'manufacturer'].includes(s.matchedOn));
  }
});

test('bad input is [] rather than a throw — a type-ahead must never break the field', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.deepEqual(suggestUnits(bad, DOCS), []);
  }
  assert.deepEqual(suggestUnits('trane', null), []);
  assert.deepEqual(suggestUnits('trane', undefined), []);
});
