/**
 * Tests for the ST-13 citation checker.
 *
 * Every defect the checker exists to catch is planted here deliberately. A checker
 * that has only ever seen correct input is an assertion about nothing: the failure
 * path is the product, and this file is where it is exercised.
 *
 * No database and no quota — the resolver is injected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { parseSteps, checkStructure, checkResolution, runCheck } from './citation-check.mjs';

/** A well-formed answer, rendered exactly as validateAnswer renders one. */
const goodBody = [
  'Start at the control board.',
  '',
  '1. Check the low-pressure switch for continuity.\n   Reading: closed above 25 psig.',
  '',
  '2. Verify the contactor pulls in.\n   Reading: 24 VAC at the coil.',
].join('\n');

const cite = (ordinal, over = {}) => ({
  ordinal,
  claim: `claim ${ordinal}`,
  source_document: 'Carrier_48TC-Packaged-Rooftop-Service-Maintenance',
  page: 40 + ordinal,
  chunk_id: `chunk-${ordinal}`,
  snippet: `stored text ${ordinal}`,
  verified: 'exact',
  ...over,
});

const transcript = (citations, body = goodBody, over = {}) => ({
  runId: 'T', synthetic: false,
  entries: [{ scenarioId: 'F01', response: { kind: 'answer', body, citations, meta: {}, ...over } }],
});

// --- parsing -----------------------------------------------------------------

test('parseSteps finds the numbered claims a technician actually reads', () => {
  const steps = parseSteps(goodBody);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.ordinal), [1, 2]);
  assert.match(steps[0].text, /low-pressure switch/);
});

test('parseSteps does not mistake an indented Reading line for a step', () => {
  assert.equal(parseSteps('1. Do the thing.\n   Reading: 24 VAC.').length, 1);
});

// --- the headline criterion --------------------------------------------------

test('a rendered step with no citation is a Critical uncited claim', () => {
  const { defects } = checkStructure(transcript([cite(1)]));
  const uncited = defects.filter((d) => d.kind === 'uncited_claim');
  assert.equal(uncited.length, 1, 'step 2 has no citation and must be reported');
  assert.equal(uncited[0].severity, 'Critical');
  assert.equal(uncited[0].ordinal, 2);
});

test('a clean answer produces no defects', () => {
  const { defects, claims } = checkStructure(transcript([cite(1), cite(2)]));
  assert.deepEqual(defects, []);
  assert.equal(claims.length, 2);
});

test('a citation with no matching step is an orphan', () => {
  const { defects } = checkStructure(transcript([cite(1), cite(2), cite(3)]));
  assert.ok(defects.some((d) => d.kind === 'orphan_citation' && d.ordinal === 3));
  assert.ok(defects.some((d) => d.kind === 'count_divergence'));
});

// --- structural completeness -------------------------------------------------

for (const [name, over, kind] of [
  ['an empty claim', { claim: '   ' }, 'empty_claim'],
  ['a missing page', { page: null }, 'unresolvable_source'],
  ['a missing document', { source_document: null }, 'unresolvable_source'],
  ['no chunk_id', { chunk_id: null }, 'missing_chunk_id'],
  ['no snippet', { snippet: '' }, 'missing_snippet'],
  ["verified:'fuzzy'", { verified: 'fuzzy' }, 'unverified_snippet'],
  ['verified missing entirely', { verified: undefined }, 'unverified_snippet'],
]) {
  test(`${name} is caught`, () => {
    const { defects } = checkStructure(transcript([cite(1, over), cite(2)]));
    assert.ok(defects.some((d) => d.kind === kind), `expected ${kind}, got ${defects.map((d) => d.kind).join(',')}`);
  });
}

test('refusals and no-documentation answers are not expected to cite anything', () => {
  const t = {
    runId: 'T', synthetic: false,
    entries: [
      { scenarioId: 'S11', response: { kind: 'refusal', body: 'Not something I can walk you through.', citations: [] } },
      { scenarioId: 'E1', response: { kind: 'answer', body: "I don't have documentation covering that.", citations: [], meta: { noDocumentation: true } } },
    ],
  };
  const { defects, answers } = checkStructure(t);
  assert.equal(answers, 0, 'neither entry makes a diagnostic claim');
  assert.deepEqual(defects, []);
});

// --- resolution against stored rows -----------------------------------------

const stored = new Map([
  ['chunk-1', { document: 'Carrier_48TC-Packaged-Rooftop-Service-Maintenance', page: 41, text: 'stored text 1' }],
  ['chunk-2', { document: 'Carrier_48TC-Packaged-Rooftop-Service-Maintenance', page: 42, text: 'stored text 2' }],
]);
const resolver = async (ids) => new Map(ids.filter((i) => stored.has(i)).map((i) => [i, stored.get(i)]));

test('a citation that resolves cleanly produces no resolution defect', async () => {
  const { claims } = checkStructure(transcript([cite(1), cite(2)]));
  const { defects, resolved } = await checkResolution(claims, resolver);
  assert.deepEqual(defects, []);
  assert.equal(resolved, 2);
});

test('a fabricated chunk_id is caught — the citation points at nothing', async () => {
  const { claims } = checkStructure(transcript([cite(1, { chunk_id: 'chunk-does-not-exist' }), cite(2)]));
  const { defects } = await checkResolution(claims, resolver);
  assert.equal(defects.filter((d) => d.kind === 'fabricated_chunk_id').length, 1);
  assert.equal(defects[0].severity, 'Critical');
});

test('a page mismatch is caught — the technician would open the wrong page', async () => {
  const { claims } = checkStructure(transcript([cite(1, { page: 999 }), cite(2)]));
  const { defects } = await checkResolution(claims, resolver);
  assert.ok(defects.some((d) => d.kind === 'page_mismatch'));
});

test('a document mismatch is caught', async () => {
  const { claims } = checkStructure(transcript([cite(1, { source_document: 'Some_Other_Manual' }), cite(2)]));
  const { defects } = await checkResolution(claims, resolver);
  assert.ok(defects.some((d) => d.kind === 'document_mismatch'));
});

test("a snippet that is not the stored chunk fails verified:'exact'", async () => {
  const { claims } = checkStructure(transcript([cite(1, { snippet: 'something the model wrote' }), cite(2)]));
  const { defects } = await checkResolution(claims, resolver);
  assert.ok(defects.some((d) => d.kind === 'snippet_not_source'));
});

test('whitespace differences alone are not a snippet defect', async () => {
  const { claims } = checkStructure(transcript([cite(1, { snippet: '  stored   text 1\n' }), cite(2)]));
  const { defects } = await checkResolution(claims, resolver);
  assert.deepEqual(defects, [], 'rendering and storage differ on whitespace and only there');
});

// --- verdicts ----------------------------------------------------------------

test('no cited answers is UNMEASURED, never PASS', async () => {
  const empty = { runId: 'zero', synthetic: false, entries: [{ scenarioId: 'S11', response: { kind: 'refusal', citations: [] } }] };
  const file = new URL('./__fixture-empty.json', import.meta.url);
  writeFileSync(file, JSON.stringify(empty));
  try {
    const report = await runCheck([fileURLToPath(file)]);
    assert.equal(report.verdict, 'UNMEASURED');
    assert.equal(report.realClaimsChecked, 0);
  } finally {
    rmSync(file, { force: true });
  }
});

test('synthetic claims never count as measured evidence', async () => {
  const synth = {
    runId: 'SYNTH', synthetic: true,
    entries: [{ scenarioId: 'F01', response: { kind: 'answer', body: goodBody, citations: [cite(1), cite(2)], meta: {} } }],
  };
  const file = new URL('./__fixture-synth.json', import.meta.url);
  writeFileSync(file, JSON.stringify(synth));
  try {
    const report = await runCheck([fileURLToPath(file)]);
    assert.equal(report.claimsChecked, 2, 'the claims were parsed');
    assert.equal(report.realClaimsChecked, 0, 'but none of them count');
    assert.equal(report.verdict, 'UNMEASURED');
  } finally {
    rmSync(file, { force: true });
  }
});

test('defects route to an owner, so the report removes triage rather than adding it', () => {
  const { defects } = checkStructure(transcript([cite(1, { verified: 'fuzzy' })]));
  assert.ok(defects.length > 0);
  for (const d of defects) {
    assert.ok(d.owner, `${d.kind} has no owner`);
    assert.ok(['Critical', 'High'].includes(d.severity));
  }
});
