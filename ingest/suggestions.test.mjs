/**
 * suggestions.test.mjs — ST-R14 (N4), against fixtures rather than the corpus.
 *
 *   npm test
 *
 * The mining rules are pure and structural, so they are tested here without a
 * database. The corpus-scale numbers — candidates per document, per category,
 * and the named line for the Bosch scope — come from
 * `npm run suggestions:build --dry`, which needs the service key and is reported
 * rather than asserted.
 *
 * The load-bearing test is `the safety gate runs on every candidate`. The corpus
 * contains ignition, rollout and charge-verification sections, and a one-tap chip
 * the app offers and then refuses is worse than no chip at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyHazard } from '../lib/safety.mjs';
import { blankComments } from '../tests/lib/jsx.mjs';
import { parseCsv } from './reconcile.mjs';
import {
  mineCandidates, mineDocument, isHeading, faultRow, categoryOf, toTopic,
  TEMPLATES, CODE_TEMPLATE, norm,
} from './suggestions.mjs';

const chunk = (text, over = {}) => ({
  document_id: 'doc_b8', page_number: 12, chunk_index: 0, chunk_id: 'c1', text, ...over,
});

// ---------------------------------------------------------------------------
// AC 1 / AC 2 — the shape and the rules
// ---------------------------------------------------------------------------

test('AC 1 — a candidate carries the chunk and page it came from', () => {
  const [c] = mineCandidates(chunk('Minimum Service Clearances'));
  assert.deepEqual(Object.keys(c).sort(), ['category', 'chunkId', 'chunkIndex', 'documentId', 'page', 'text', 'topic'].sort());
  assert.equal(c.chunkId, 'c1');
  assert.equal(c.page, 12);
  assert.equal(c.documentId, 'doc_b8');
  assert.ok(['fault', 'reference', 'sequence', 'commissioning'].includes(c.category));
});

test('AC 2 — headings are matched per category', () => {
  const cases = [
    ['Troubleshooting', 'fault'],
    ['FAULT CODES', 'fault'],
    ['Minimum Service Clearances', 'reference'],
    ['Electrical Data', 'reference'],
    ['Torque Specifications', 'reference'],
    ['Refrigerant Charge', 'reference'],
    ['Airflow Requirements', 'reference'],
    ['Sequence of Operation', 'sequence'],
    ['Start-Up Checklist', 'commissioning'],
    ['Commissioning', 'commissioning'],
  ];
  for (const [heading, category] of cases) {
    const found = mineCandidates(chunk(heading));
    assert.equal(found.length, 1, `no candidate mined from "${heading}"`);
    assert.equal(found[0].category, category, `"${heading}" landed in ${found[0].category}`);
  }
});

test('AC 2 — fault-table rows yield a code candidate, in the shapes the corpus uses', () => {
  const table = [
    'E4  Outdoor temperature sensor open circuit',
    'A6  Indoor fan motor feedback abnormal',
    'P0  Compressor low pressure protection',
    'BCC110  Gateway communication interrupted',
    '3 flashes  Low pressure switch open',
  ].join('\n');
  const found = mineCandidates(chunk(table));
  assert.equal(found.length, 5);
  assert.deepEqual(found.map((c) => c.topic), ['E4', 'A6', 'P0', 'BCC110', '3 flashes']);
  for (const c of found) {
    assert.equal(c.category, 'fault');
    assert.equal(c.text, CODE_TEMPLATE(c.topic));
  }
});

test('AC 2 — a bare acronym is not a fault code, and that is a measured decision', () => {
  /*
   * Run over the live corpus on 16 Aug 2026 an earlier version accepted any
   * two-or-three-letter uppercase token and produced chips reading "What does
   * the OK code indicate?", "What does the CAN code indicate?", "What does the
   * AIR code indicate?" — plus IDS, TXV, DO, PQ, ON and RF. Every one is an
   * acronym in running text.
   *
   * Requiring a digit loses a genuinely alpha-only code if the corpus has one.
   * That is the right way round: a missing suggestion costs nothing, and a
   * nonsense one costs the trust this whole round is about.
   */
  for (const line of [
    'OK  The system is operating normally',
    'CAN  Controller area network bus wiring',
    'TXV  Thermostatic expansion valve position',
    'AIR  Airflow through the indoor coil',
  ]) {
    assert.equal(faultRow(line), null, `"${line}" was mined as a fault code`);
  }
});

test('AC 2 — a table-of-contents entry is not a heading', () => {
  // Measured on the live corpus: contents entries look exactly like headings
  // with page numbers stapled on, and each produced a chip asking about a page.
  for (const line of [
    'unit Preparation 19 18 System Operation and Troubleshooting 45',
    'Required Refrigerant Line Length 21 18 Fault Code Table 47',
    'Capacity 25 50 75 100 125 150',
  ]) {
    assert.equal(isHeading(line), false, `"${line}" was read as a heading`);
  }
});

test('AC 2 — a worksheet field and a truncated heading are both rejected', () => {
  assert.equal(isHeading('Factory Charge (nameplate) = _________'), false);
  assert.equal(isHeading('REFRIGERANT CHARGE for'), false, 'a heading cut off mid-phrase');
  assert.equal(isHeading('Torque | Value | Notes'), false, 'a table row');
});

test('AC 2 — a table-of-contents line is not a fault row', () => {
  // "A6 .......... 41" is a page reference. Mining it would produce a chip that
  // asks about a page number.
  for (const line of ['A6 .......... 41', 'E4    41', 'E4 . . . . . 12']) {
    assert.equal(faultRow(line), null, `"${line}" was mined as a fault`);
  }
});

test('AC 2 — prose is not a heading', () => {
  for (const line of [
    'The unit must be installed on a level surface before the electrical connections are made.',
    'refer to table 12 for clearances',
    'Page 41',
    '12',
    'See https://example.com/manual for details',
  ]) {
    assert.equal(isHeading(line), false, `"${line}" was read as a heading`);
  }
});

test('AC 2 — the same input gives the same output, twice', () => {
  const text = [
    'Minimum Service Clearances',
    'E4  Outdoor temperature sensor open circuit',
    'Sequence of Operation',
  ].join('\n');
  assert.deepEqual(mineCandidates(chunk(text)), mineCandidates(chunk(text)));
});

// ---------------------------------------------------------------------------
// AC 3 / AC 4 — the templates
// ---------------------------------------------------------------------------

test('AC 3 — no manufacturer from data/manifest.csv appears in the templates', () => {
  // Comments blanked: the module header names the Bosch case on purpose, because
  // it is the defect this module exists to fix. A test that forbade writing down
  // why the code exists would be a strange kind of progress.
  const src = blankComments(readFileSync(new URL('./suggestions.mjs', import.meta.url), 'utf8'));
  const rows = parseCsv(readFileSync(new URL('../data/manifest.csv', import.meta.url), 'utf8'));
  const [header, ...data] = rows;
  const at = header.indexOf('Manufacturer');
  const makers = [...new Set(data.map((r) => (r[at] ?? '').trim()).filter(Boolean))]
    .filter((m) => !/^unknown$/i.test(m));
  assert.ok(makers.length >= 10);

  const hits = [];
  for (const name of makers) {
    for (const part of name.split('/').map((s) => s.trim()).filter((s) => s.length >= 4)) {
      if (new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(src)) hits.push(part);
    }
  }
  assert.deepEqual(hits, [], `suggestions.mjs names ${hits.join(', ')}`);
});

test('AC 4 — no template contains a PROCEDURAL pattern from safety.mjs', () => {
  // A procedurally-phrased template would make every suggestion about hazardous
  // equipment refuse itself — the app offering a chip and then declining it.
  const probes = ['refrigerant charge', 'the gas line', 'the lugs', 'the disconnect switch'];
  for (const [category, template] of Object.entries(TEMPLATES)) {
    for (const topic of probes) {
      const text = template(topic);
      assert.equal(
        classifyHazard(text), null,
        `the ${category} template refuses itself on "${topic}": ${text}`
      );
    }
  }
  for (const code of ['E4', '3 flashes']) {
    assert.equal(classifyHazard(CODE_TEMPLATE(code)), null);
  }
});

test('AC 4 — every template is a question, never an instruction', () => {
  for (const t of Object.values(TEMPLATES)) {
    const text = t('the thing');
    assert.ok(text.endsWith('?'), `not a question: ${text}`);
    assert.doesNotMatch(text, /^(how|set|check|adjust|install|connect)/i, `procedural opener: ${text}`);
  }
  assert.ok(CODE_TEMPLATE('E4').endsWith('?'));
});

// ---------------------------------------------------------------------------
// AC 5 — the safety gate, on every candidate
// ---------------------------------------------------------------------------

test('AC 5 — a hazardous section never becomes a chip, and the drop is recorded', () => {
  /*
   * The headings below are the interesting case, not the obvious one: each of
   * them matches the category lexicon, so each IS mined — and each is then
   * dropped by `classifyHazard`. A heading that matched no category was never a
   * candidate and proves nothing about the gate.
   *
   * Note *how* they are dropped. The templates are non-procedural by design, so
   * a DOMAIN noun alone ("Refrigerant Charge") does not refuse — correctly: what
   * the manual *specifies* for the charge is a published quantity, and ST-R05
   * made exactly that answerable. What refuses is an ACTION verb in the topic
   * itself, which is the section describing the act rather than the figure.
   */
  const dropped = [];
  const found = mineCandidates(
    chunk([
      'Brazing Torque Values',
      'Evacuation and Charge Weight',
      'Recovery and Charge Data',
      'Minimum Service Clearances',
    ].join('\n')),
    { onDrop: (reason, text) => dropped.push([reason, text]) }
  );
  assert.deepEqual(found.map((c) => c.topic), ['minimum Service Clearances']);
  assert.equal(dropped.length, 3, 'every hazardous heading must be dropped');
  for (const [reason] of dropped) assert.match(reason, /^hazard:.*\/action$/);
});

test('AC 5 — a domain noun alone is kept, because a published quantity is not an act', () => {
  // The N2 boundary, arriving through N4's door. "What does the manual specify
  // for refrigerant charge?" is a reference question and ST-R05 answers it.
  const [c] = mineCandidates(chunk('Refrigerant Charge'));
  assert.ok(c, 'a charge-quantity section must still yield a suggestion');
  assert.equal(classifyHazard(c.text), null);
});

test('AC 5 — every candidate mined from a realistic page passes classifyHazard', () => {
  const page = [
    'TROUBLESHOOTING',
    'E4  Outdoor temperature sensor open circuit',
    'Brazing Procedure',
    'Electrical Data',
    'Refrigerant Charge',
    'Evacuating the System',
    'Sequence of Operation',
    'Start-Up Checklist',
    'Lighting the Pilot',
  ].join('\n');
  for (const c of mineCandidates(chunk(page))) {
    assert.equal(classifyHazard(c.text), null, `a hazardous candidate survived: ${c.text}`);
  }
});

// ---------------------------------------------------------------------------
// AC 6 — collapse, deterministically
// ---------------------------------------------------------------------------

test('AC 6 — a heading repeated on twelve pages yields one candidate, from the earliest page', () => {
  const chunks = Array.from({ length: 12 }, (_, i) =>
    chunk('Electrical Data', { page_number: 40 - i, chunk_index: 0, chunk_id: `c${40 - i}` })
  );
  const found = mineDocument(chunks);
  assert.equal(found.length, 1);
  assert.equal(found[0].page, 29, 'the lowest (page, chunk_index) wins');
  assert.equal(found[0].chunkId, 'c29');
});

test('AC 6 — collapse is on normalised text, so casing and punctuation do not duplicate', () => {
  const found = mineDocument([
    chunk('ELECTRICAL DATA', { page_number: 5 }),
    chunk('Electrical Data:', { page_number: 9 }),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].page, 5);
  assert.equal(norm('ELECTRICAL DATA'), norm('Electrical Data'));
});

test('AC 6 — mineDocument is deterministic under a shuffled input', () => {
  const chunks = [
    chunk('Sequence of Operation', { page_number: 30, chunk_index: 1 }),
    chunk('Electrical Data', { page_number: 12, chunk_index: 0 }),
    chunk('Start-Up Checklist', { page_number: 44, chunk_index: 2 }),
  ];
  const a = mineDocument(chunks);
  const b = mineDocument([...chunks].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((c) => c.page), [12, 30, 44]);
});

// ---------------------------------------------------------------------------
// Topic trimming
// ---------------------------------------------------------------------------

test('toTopic strips numbering and reads inside a sentence', () => {
  assert.equal(toTopic('4.2 Electrical Data'), 'electrical Data');
  assert.equal(toTopic('MINIMUM SERVICE CLEARANCES'), 'minimum service clearances');
  assert.equal(toTopic('Sequence of Operation:'), 'sequence of Operation');
  assert.equal(toTopic('• Torque Specifications'), 'torque Specifications');
});

test('categoryOf returns null for a heading about nothing we can answer', () => {
  assert.equal(categoryOf('Table of Contents'), null);
  assert.equal(categoryOf('Limited Warranty'), null);
  assert.equal(mineCandidates(chunk('Limited Warranty')).length, 0);
});

test('AC 9 — no dependency, and nothing here touches chunking or a stored hash', () => {
  const src = readFileSync(new URL('./suggestions.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../lib/safety.mjs'], 'the miner must reuse the real gate and nothing else');
  assert.equal(/content_hash|contentHash|splitPage|chunkDocument/.test(src), false);
});
