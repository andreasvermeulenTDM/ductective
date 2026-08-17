/**
 * coverage.test.mjs — ST-R08 AC 9, ST-R09 AC 1–3, ST-R17 AC 2/5.
 *
 *   npm test
 *
 * Every sentence in `coverage.mjs` is a **coverage claim**, and hard constraint 2
 * of `00-brief-round4.md` says a coverage claim must be derived from documents
 * actually in scope. So the tests are of two kinds:
 *
 *  - **provably database-derived**: build a fake scope of known rows, render the
 *    body, and assert every number and every document-type word in it came from
 *    those rows;
 *  - **provably not hardcoded**: grep the comment-blanked source against every
 *    manufacturer in `data/manifest.csv`. This is the check
 *    `03-backend-fixes.md` §1 established for `suggestUnits`, applied to the
 *    module that replaced its job for documents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankComments } from '../tests/lib/jsx.mjs';
import { parseCsv } from '../ingest/reconcile.mjs';
import { refusalLeaksProcedure } from './safety.mjs';
import { equipmentTokensIn } from './conversation.mjs';
import {
  summariseScope, describeTypes, coverageStatement,
  scopedNoDocumentationBody, capabilityBody, unresolvedUnitBody,
} from './coverage.mjs';

const SRC = blankComments(readFileSync(new URL('./coverage.mjs', import.meta.url), 'utf8'));

/** The Bosch-sized scope from the 16 Aug session, in the shape the table hands over. */
const BOSCH_SCOPE_ROWS = [
  ...Array.from({ length: 28 }, (_, i) => ({ id: `d${i}`, doc_type: 'Install', in_scope: true })),
  { id: 'd28', doc_type: 'IOM', in_scope: true },
  { id: 'd29', doc_type: 'IOM', in_scope: true },
  { id: 'd30', doc_type: 'Troubleshooting Guide', in_scope: true },
  { id: 'd31', doc_type: 'Quick Start', in_scope: true },
  { id: 'd32', doc_type: 'User Guide', in_scope: true },
];

// ---------------------------------------------------------------------------
// summariseScope
// ---------------------------------------------------------------------------

test('summariseScope counts only in-scope rows — a retired duplicate is not held', () => {
  const s = summariseScope([
    { doc_type: 'Install', in_scope: true },
    { doc_type: 'IOM', in_scope: false },   // ST-R13's retired duplicate
    { doc_type: 'Install', in_scope: true },
  ]);
  assert.equal(s.count, 2);
  assert.deepEqual(s.types, [{ type: 'Install', n: 2 }]);
});

test('summariseScope is deterministic — count descending, then alphabetical', () => {
  const rows = [
    { doc_type: 'User Guide' }, { doc_type: 'Install' }, { doc_type: 'Install' },
    { doc_type: 'IOM' }, { doc_type: 'IOM' }, { doc_type: 'Quick Start' },
  ];
  const a = summariseScope(rows);
  const b = summariseScope([...rows].reverse());
  assert.deepEqual(a.types, b.types, 'the same scope must render the same sentence twice');
  assert.deepEqual(a.types.map((t) => t.n), [2, 2, 1, 1], 'count descending');
  assert.deepEqual(a.types.map((t) => t.type).slice(2), ['Quick Start', 'User Guide'], 'then alphabetical');
});

test('a row with no doc_type still counts, so the total is never understated', () => {
  const s = summariseScope([{ doc_type: 'IOM' }, { id: 'x' }, { doc_type: '' }]);
  assert.equal(s.count, 3);
  assert.deepEqual(s.types, [{ type: 'IOM', n: 1 }]);
});

// ---------------------------------------------------------------------------
// ST-R09 AC 1/2 — the scoped withhold
// ---------------------------------------------------------------------------

test('the scoped withhold does not ask for a nameplate it was already given', () => {
  // The exact failure of the session's third turn: it asked for something
  // already provided, to a technician who had resolved a unit to 33 documents.
  const body = scopedNoDocumentationBody(summariseScope(BOSCH_SCOPE_ROWS));
  assert.doesNotMatch(body, /nameplate/i);
  assert.doesNotMatch(body, /make and model/i);
});

test('the scoped withhold does not claim the corpus lacks the unit', () => {
  const body = scopedNoDocumentationBody(summariseScope(BOSCH_SCOPE_ROWS));
  assert.doesNotMatch(body, /none of them cover this unit/i);
  assert.doesNotMatch(body, /don’t have documentation covering that|don't have documentation covering that/i);
});

test('the scoped withhold ends in a question, so the turn continues', () => {
  const body = scopedNoDocumentationBody(summariseScope(BOSCH_SCOPE_ROWS));
  assert.equal(body.trim().endsWith('?'), true, 'a withhold that ends in a full stop ends the conversation');
});

test('every number and every document-type word in the body is in the rows', () => {
  // AC 2, the load-bearing one: provably database-derived, not asserted to be.
  const scope = summariseScope(BOSCH_SCOPE_ROWS);
  const body = scopedNoDocumentationBody(scope);

  const allowedNumbers = new Set([String(scope.count), ...scope.types.map((t) => String(t.n))]);
  for (const n of body.match(/\d+/g) ?? []) {
    assert.ok(allowedNumbers.has(n), `the body states ${n}, which is in no row`);
  }
  assert.match(body, new RegExp(`\\b${scope.count}\\b`), 'the document count must appear');

  // Every capitalised word that is not sentence-initial must be a doc_type word.
  const typeWords = new Set(scope.types.flatMap((t) => t.type.split(/[\s/]+/)));
  for (const w of body.match(/(?<![.\n]\s|^)\b[A-Z][A-Za-z]+\b/g) ?? []) {
    assert.ok(typeWords.has(w) || w === 'I', `the body names "${w}", which is in no row's doc_type`);
  }
});

test('the scoped withhold makes no diagnostic claim', () => {
  // AC 3 — the structural rule `lib/conversation.test.mjs` already uses.
  const scope = summariseScope(BOSCH_SCOPE_ROWS);
  const body = scopedNoDocumentationBody(scope);
  assert.equal(refusalLeaksProcedure(body), false, 'no numbered or bulleted line');
  assert.doesNotMatch(body, /\breading\s*:/i);

  // No equipment noun beyond the doc_type words lifted from the database.
  const fromTypes = new Set(scope.types.flatMap((t) => equipmentTokensIn(t.type)));
  const leaked = equipmentTokensIn(body).filter((tok) => !fromTypes.has(tok));
  assert.deepEqual(leaked, [], `the withhold names equipment: ${leaked.join(', ')}`);
});

test('a one-document scope reads as one document, not as "1 documents"', () => {
  const body = scopedNoDocumentationBody(summariseScope([{ doc_type: 'IOM' }]));
  assert.match(body, /\b1 document\b/);
  assert.doesNotMatch(body, /1 documents/);
});

test('a scope whose rows carry no doc_type degrades to the count alone', () => {
  // The shape an older stub hands over: `{id}` only. It must still compose.
  const body = scopedNoDocumentationBody(summariseScope([{ id: 'a' }, { id: 'b' }]));
  assert.match(body, /\b2 documents\b/);
  assert.equal(body.trim().endsWith('?'), true);
});

// ---------------------------------------------------------------------------
// describeTypes / coverageStatement
// ---------------------------------------------------------------------------

test('describeTypes caps the named kinds and folds the rest honestly', () => {
  const scope = summariseScope(BOSCH_SCOPE_ROWS);
  const detail = describeTypes(scope.types);
  assert.match(detail, /28 Install/);
  assert.match(detail, /of other kinds/, 'the tail is stated, never silently dropped');
  // The counts in the sentence add up to the whole scope — nothing goes missing.
  const total = (detail.match(/(\d+) /g) ?? []).reduce((a, s) => a + Number(s), 0);
  assert.equal(total, scope.count);
});

test('describeTypes is null when nothing has a type, so the caller can degrade', () => {
  assert.equal(describeTypes([]), null);
  assert.equal(describeTypes(undefined), null);
});

test('coverageStatement says what is held, and says nothing when nothing is', () => {
  assert.match(coverageStatement(summariseScope(BOSCH_SCOPE_ROWS)), /33 documents/);
  assert.match(coverageStatement({ count: 0, types: [] }), /don’t have anything in scope/);
});

// ---------------------------------------------------------------------------
// ST-R08 AC 9 / ST-R17 — the capability body's three degradation steps
// ---------------------------------------------------------------------------

test('step 1: suggestions available — they are listed', () => {
  const body = capabilityBody({
    scope: summariseScope(BOSCH_SCOPE_ROWS),
    suggestions: [
      { text: 'What are the minimum service clearances?' },
      { text: 'What is the MCA and MOCP?' },
    ],
  });
  assert.match(body, /33 documents/);
  assert.match(body, /minimum service clearances/);
  assert.match(body, /MCA and MOCP/);
});

test('step 1: the capability answer names at most six suggestions', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ text: `Question ${i}?` }));
  const body = capabilityBody({ scope: summariseScope(BOSCH_SCOPE_ROWS), suggestions: many });
  assert.equal((body.match(/^Question \d+\?$/gm) ?? []).length, 6);
  assert.doesNotMatch(body, /Question 6\?/);
});

test('suggestions are listed without a bullet, so the body is not a list of things to do', () => {
  // `refusalLeaksProcedure` treats a numbered or bulleted line as a leaked
  // procedure, and `diagnose()` runs it over this body before emitting it. These
  // are questions to ask, not steps to take.
  const body = capabilityBody({
    scope: summariseScope(BOSCH_SCOPE_ROWS),
    suggestions: [{ text: 'What are the minimum service clearances?' }],
  });
  assert.equal(refusalLeaksProcedure(body), false);
  assert.doesNotMatch(body, /^\s*[-*•]\s/m);
});

test('step 2: scope but no suggestions — the coverage statement alone, no invented chips', () => {
  const body = capabilityBody({ scope: summariseScope(BOSCH_SCOPE_ROWS), suggestions: [] });
  assert.match(body, /33 documents/);
  assert.doesNotMatch(body, /Questions I can answer/, 'inventing a suggestion is the exact defect this round fixes');
  assert.match(body, /document and page/);
});

test('step 3: no scope — the manufacturer list, capped, from coveredFamilies', () => {
  const families = Array.from({ length: 15 }, (_, i) => ({ manufacturer: `Maker${i}`, families: [] }));
  const body = capabilityBody({ scope: null, families });
  assert.match(body, /Maker0/);
  assert.match(body, /and 7 more/, 'capped with an honest remainder, exactly as classifyUnit does');
  assert.doesNotMatch(body, /Maker8/);
});

test('step 3 with nothing at all still says something true', () => {
  const body = capabilityBody({});
  assert.ok(body.length > 80);
  assert.doesNotMatch(body, /\d/, 'with no rows there is no number that could be true');
});

test('the capability body makes no diagnostic claim of its own', () => {
  // ST-R17 AC 5 — no numbered step, no Reading:, no value beyond the counts.
  for (const body of [
    capabilityBody({ scope: summariseScope(BOSCH_SCOPE_ROWS), suggestions: [{ text: 'What is the charge quantity?' }] }),
    capabilityBody({ scope: summariseScope(BOSCH_SCOPE_ROWS) }),
    capabilityBody({ families: [{ manufacturer: 'Bosch' }] }),
    capabilityBody({}),
  ]) {
    assert.equal(refusalLeaksProcedure(body), false);
    assert.doesNotMatch(body, /\breading\s*:/i);
    assert.doesNotMatch(body, /^\s*\d+\.\s/m, 'no numbered step');
  }
});

test('the capability body states the refusal boundary rather than implying it does everything', () => {
  const body = capabilityBody({ scope: summariseScope(BOSCH_SCOPE_ROWS) });
  assert.match(body, /gas/i);
  assert.match(body, /electrical/i);
  assert.match(body, /refrigerant/i);
});

// ---------------------------------------------------------------------------
// Not hardcoded — the check that stops this module going stale
// ---------------------------------------------------------------------------

test('no manufacturer from data/manifest.csv appears as a literal in coverage.mjs', () => {
  const rows = parseCsv(readFileSync(new URL('../data/manifest.csv', import.meta.url), 'utf8'));
  const [header, ...data] = rows;
  const at = header.indexOf('Manufacturer');
  const makers = [...new Set(data.map((r) => (r[at] ?? '').trim()).filter(Boolean))]
    .filter((m) => !/^unknown$/i.test(m));
  assert.ok(makers.length >= 10, 'the manifest did not load');

  const hits = [];
  for (const name of makers) {
    for (const part of name.split('/').map((s) => s.trim()).filter((s) => s.length >= 4)) {
      if (new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(SRC)) hits.push(part);
    }
  }
  assert.deepEqual(hits, [], `coverage.mjs names ${hits.join(', ')} — every fact here must come from a row`);
});

test('no document-type literal is written into coverage.mjs either', () => {
  // A `doc_type` list here would be the same defect wearing a different hat: it
  // would be correct until the manifest gained a kind.
  for (const t of ['IOM', 'Install', 'Quick Start', 'Troubleshooting Guide', 'PT Chart', 'Service Manual']) {
    assert.doesNotMatch(SRC, new RegExp(`['"\`]${t}`), `coverage.mjs writes down the doc_type "${t}"`);
  }
});

// ---------------------------------------------------------------------------
// E-1 (Stage 5.5, round 4) — the withhold for a unit that resolved to nothing
// ---------------------------------------------------------------------------
//
// The eval measured this on four adjacent units — Rheem RKNL-B073CL, AAON
// RN-020, Reznor UDAP-100, Trane CVHE Centravac. Each sent `equipment` on the
// request, resolved to zero documents, and was asked for the nameplate it had
// just supplied. ST-R09 fixed the sibling path and could not fix this one.

/** `coveredFamilies`-shaped rows. Manufacturers only; nothing else is read. */
const FAMILIES = [
  { manufacturer: 'Trane' }, { manufacturer: 'Carrier' }, { manufacturer: 'Bosch' },
  { manufacturer: 'Lennox' }, { manufacturer: 'Daikin Applied' },
];

test('the unresolved-unit withhold does not ask for a nameplate it was already given', () => {
  const body = unresolvedUnitBody(FAMILIES);
  assert.doesNotMatch(body, /nameplate/i);
  assert.doesNotMatch(body, /make and model/i);
});

test('the unresolved-unit withhold ends in a question, so the turn continues', () => {
  assert.equal(unresolvedUnitBody(FAMILIES).trim().endsWith('?'), true);
  // Including the degraded form — a failed read must not also end the conversation.
  assert.equal(unresolvedUnitBody([]).trim().endsWith('?'), true);
});

test('the unresolved-unit withhold names only manufacturers it was handed', () => {
  // Hard constraint 2: a coverage claim is derived, never written down. Anything
  // named that is not in the rows is a promise of coverage we may not have.
  const body = unresolvedUnitBody(FAMILIES);
  for (const f of FAMILIES) assert.match(body, new RegExp(f.manufacturer));
  assert.doesNotMatch(body, /Rheem|AAON|Reznor|Goodman|York/i);
});

test('the unresolved-unit withhold degrades to a truthful body with no rows', () => {
  // The database read failed. It must still be honest and must invent no list.
  const body = unresolvedUnitBody([]);
  assert.match(body, /don’t hold a manual for that unit/i);
  assert.doesNotMatch(body, /Trane|Carrier|Bosch/i);
});

test('neither unresolved-unit body reads as a leaked procedure', () => {
  // `diagnose()` runs this check over meta bodies before emitting them; a
  // bulleted or numbered line here would be indistinguishable from steps to take.
  assert.equal(refusalLeaksProcedure(unresolvedUnitBody(FAMILIES)), false);
  assert.equal(refusalLeaksProcedure(unresolvedUnitBody([])), false);
});
