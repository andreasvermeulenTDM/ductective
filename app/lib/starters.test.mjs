/**
 * ST-R16 — the suggestion wire contract, and the one assertion that survived the
 * taxonomy's deletion.
 *
 *   npm test
 *
 * The old file's load-bearing test ran the real `classifyHazard` over every
 * hardcoded starter, so that adding "gas heat won't ignite" to the list failed
 * here rather than on a roof. **The list is gone; the property is not.** ST-R16
 * AC 9 requires it to be re-asserted over *server payloads* instead of over
 * literals, which is a slightly weaker claim about a much better mechanism —
 * the server gates on the same `classifyHazard` at mining time (ST-R14/ST-R15),
 * and this is the client-side net under it.
 *
 * The rest of this file is the parser, and the rule it exists for: a malformed
 * row is discarded, never repaired. `suggest.ts` states the same rule for the
 * same reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_LIMIT,
  coverageStatement,
  parseSuggestionsResponse,
  postUnitSuggestions,
  NOTHING_TO_SUGGEST_INVITATION,
} from './starters.ts';
import { classifyHazard } from '../../lib/safety.mjs';

/** A well-formed row, so each test can spoil exactly one field. */
const row = (over = {}) => ({
  text: 'What are the minimum service clearances for this unit?',
  category: 'reference',
  documentId: 'doc-bosch-ids-ultra',
  page: 12,
  source_document: 'B06_Bosch_IDS-Ultra-Series-Condenser-Installation-Manual.pdf',
  ...over,
});

// ---------------------------------------------------------------------------
// AC 9 — the assertion that mattered, over payloads rather than over literals
// ---------------------------------------------------------------------------

test('AC 9: no suggestion the app would render is one the safety gate refuses', () => {
  // A fixture of the shapes ST-R15 serves, spanning all four mining categories
  // and deliberately including the installation-reference wording N2 makes
  // answerable — that is the half most likely to drift toward procedure, because
  // "how do I…" is one word away from a walkthrough.
  const PAYLOAD = {
    suggestions: [
      row({ text: 'What are the minimum service clearances for this unit?', category: 'reference' }),
      row({ text: 'What is the MCA and MOCP for this unit?', category: 'reference' }),
      row({ text: 'What is the specified lug torque?', category: 'reference' }),
      row({ text: 'What is the factory refrigerant charge?', category: 'reference' }),
    ],
  };
  const MORE = {
    suggestions: [
      row({ text: 'The control board is flashing an error code', category: 'fault' }),
      row({ text: 'What is the sequence of operation in cooling?', category: 'sequence' }),
      row({ text: 'What are the start-up acceptance criteria?', category: 'commissioning' }),
      row({ text: 'What does the curb weigh?', category: 'reference' }),
    ],
  };

  for (const payload of [PAYLOAD, MORE]) {
    const parsed = parseSuggestionsResponse(payload);
    assert.ok(parsed.length > 0, 'the fixture parsed to nothing — the test would be vacuous');
    for (const s of parsed) {
      const hazard = classifyHazard(s.text);
      assert.equal(
        hazard,
        null,
        `"${s.text}" would be refused as ${hazard?.category} — the app must not offer a question it declines`
      );
    }
  }
});

test('AC 9: the net is real — a procedural suggestion is one the gate does refuse', () => {
  // The guard on the guard. Without this, the test above would pass just as
  // happily against a `classifyHazard` that returned null for everything, which
  // is exactly the vacuous-green failure this codebase has been bitten by.
  for (const text of [
    'How do I braze the line set?',
    'How do I land the conductors?',
    'How do I weigh in the charge?',
    'How do I light the burner?',
  ]) {
    assert.notEqual(classifyHazard(text), null, `the gate no longer refuses "${text}"`);
  }
  // Two notes for whoever reads this next, both about phrasings deliberately
  // **not** asserted here because they return `null` on the tree as merged:
  //
  //  - "how do I torque the lugs to 35 in-lb" — ST-R04 adds `\blug(s)?\b` to the
  //    live_electrical DOMAIN axis, which is what makes it refuse. Asserting it
  //    from a frontend branch would be asserting against code that has not
  //    landed.
  //  - "how do I land the line-voltage conductors" — measured `null` today.
  //    `\bland(ing)? .{0,16}(wire|conductor)s?\b` allows 16 characters between
  //    the verb and the noun, and "the line-voltage " is 17. The bare "land the
  //    conductors" above does refuse. Reported as a cross-stage finding against
  //    Backend in `.pipeline/04-frontend-round4.md`; it is not this story's to
  //    fix and widening the gate from here would be editing another stage's file.
});

// ---------------------------------------------------------------------------
// The parser — discard, never repair
// ---------------------------------------------------------------------------

test('a well-formed payload parses to rows, in the server\'s order, unrewritten', () => {
  const rows = parseSuggestionsResponse({
    suggestions: [row({ text: 'first' }), row({ text: 'second', category: 'fault' })],
  });
  assert.deepEqual(rows.map((r) => r.text), ['first', 'second']);
  assert.deepEqual(rows.map((r) => r.category), ['reference', 'fault']);
  assert.equal(rows[0].page, 12);
  assert.equal(rows[0].documentId, 'doc-bosch-ids-ultra');
});

test('every missing or wrong-typed field drops its row rather than repairing it', () => {
  const spoiled = [
    { text: '' }, { text: '   ' }, { text: 42 }, { text: undefined },
    { category: 'trivia' }, { category: '' }, { category: undefined },
    { documentId: '' }, { documentId: undefined }, { documentId: 7 },
    { page: 0 }, { page: -1 }, { page: 1.5 }, { page: '12' }, { page: undefined },
    { source_document: '' }, { source_document: undefined },
  ];
  for (const over of spoiled) {
    const rows = parseSuggestionsResponse({ suggestions: [row(over)] });
    assert.deepEqual(rows, [], `row survived with ${JSON.stringify(over)}`);
  }
});

test('a broken row is dropped without taking the good ones with it', () => {
  const rows = parseSuggestionsResponse({
    suggestions: [row({ text: 'keep me' }), row({ page: 0 }), row({ text: 'keep me too' })],
  });
  assert.deepEqual(rows.map((r) => r.text), ['keep me', 'keep me too']);
});

test('an unrecognised category drops the row rather than guessing where it goes', () => {
  // Ordering is per-category (OQ-R7). A row whose category this build does not
  // know cannot be placed, and placing it arbitrarily would make the offer's
  // order a lie. The four categories are pinned so a fifth is a deliberate act.
  assert.deepEqual([...SUGGESTION_CATEGORIES], ['fault', 'reference', 'sequence', 'commissioning']);
  assert.deepEqual(parseSuggestionsResponse({ suggestions: [row({ category: 'safety' })] }), []);
});

test('anything that is not the contract shape yields [] — never a throw', () => {
  for (const json of [null, undefined, 0, '', 'suggestions', [], {}, { suggestions: null },
    { suggestions: {} }, { suggestions: 'none' }, { rows: [row()] }]) {
    assert.deepEqual(parseSuggestionsResponse(json), [], `threw or repaired on ${JSON.stringify(json)}`);
  }
  assert.deepEqual(parseSuggestionsResponse({ suggestions: [null, 1, 'x', []] }), []);
});

test('the client caps the list even if the server does not', () => {
  // The server applies OQ-R7's cap (ST-R15 AC 7). This is the second one, so a
  // server bug cannot re-inflate the first screen past the density baseline. It
  // truncates and never reorders — reordering would be a second opinion about
  // what to offer first, and the two would drift.
  const many = Array.from({ length: 9 }, (_, i) => row({ text: `q${i}` }));
  const rows = parseSuggestionsResponse({ suggestions: many });
  assert.equal(rows.length, SUGGESTION_LIMIT);
  assert.deepEqual(rows.map((r) => r.text), ['q0', 'q1', 'q2', 'q3']);
});

// ---------------------------------------------------------------------------
// The request — every failure is [], including the one that ships today
// ---------------------------------------------------------------------------

const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json });

test('a 200 with the contract shape comes back parsed', async () => {
  const rows = await postUnitSuggestions(ok({ suggestions: [row()] }), 'http://x', ['doc-1']);
  assert.equal(rows.length, 1);
});

test('an empty list is a normal answer, not an error (ST-R15 AC 8)', async () => {
  assert.deepEqual(await postUnitSuggestions(ok({ suggestions: [] }), 'http://x'), []);
});

test('every failure resolves to [] — including the 404 that ships until sql/018 lands', async () => {
  const failures = [
    // ST-R15 AC 12: the route does not exist until the migration is applied.
    async () => ({ ok: false, status: 404, json: async () => ({ message: 'POST /diagnose, …' }) }),
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
    async () => ({ ok: true, status: 200, json: async () => ({ oops: true }) }),
    async () => { throw new Error('Network request failed'); },
    async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; },
  ];
  for (const fetchFn of failures) {
    assert.deepEqual(await postUnitSuggestions(fetchFn, 'http://x', ['doc-1']), []);
  }
});

test('a 404 is not distinguished from an empty answer, on purpose', async () => {
  // ST-R15 AC 12 read strictly: until `sql/018` is applied the route 404s, and
  // the screen must degrade to the designed empty state — **not** to an error
  // card and **not** to the taxonomy that caused this round. Both paths below
  // produce the same value, which is what makes that true by construction
  // rather than by the screen remembering to treat them alike.
  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.deepEqual(
    await postUnitSuggestions(missing, 'http://x', ['doc-1']),
    await postUnitSuggestions(ok({ suggestions: [] }), 'http://x', ['doc-1'])
  );
});

test('an empty scope is not asked about at all', async () => {
  // `documentIds: []` means the unit resolved to zero documents. There is
  // nothing to mine a suggestion from, and a round trip to be told so is latency
  // spent on a known answer.
  const never = () => { throw new Error('the route was called with an empty scope'); };
  assert.deepEqual(await postUnitSuggestions(never, 'http://x', []), []);
  assert.deepEqual(await postUnitSuggestions(never, 'http://x', null), []);
});

test('the scope goes on the wire verbatim, and nothing else does', async () => {
  let seen = null;
  const capture = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), headers: init.headers };
    return { ok: true, status: 200, json: async () => ({ suggestions: [] }) };
  };
  await postUnitSuggestions(capture, 'http://x', ['a', 'b'], undefined, { Authorization: 'Bearer t' });
  assert.equal(seen.url, 'http://x/unit-suggestions');
  assert.deepEqual(seen.body, { documentIds: ['a', 'b'] });
  assert.equal(seen.headers.Authorization, 'Bearer t');
});

// ---------------------------------------------------------------------------
// The empty state's sentence — every word of it a database column
// ---------------------------------------------------------------------------

test('the statement names the count and the kind mix, most common first', () => {
  const types = ['Install', 'Install', 'Install', 'IOM', 'IOM', 'Troubleshooting Guide'];
  assert.equal(
    coverageStatement(6, types),
    'For this unit I hold 6 documents — 3 Install, 2 IOM and 1 Troubleshooting Guide.'
  );
});

test('the statement is deterministic — same unit, same sentence, every time', () => {
  // Ties break alphabetically, so a Map insertion order cannot change the words.
  const a = coverageStatement(4, ['IOM', 'Install', 'Install', 'IOM']);
  const b = coverageStatement(4, ['Install', 'IOM', 'IOM', 'Install']);
  assert.equal(a, b);
  assert.equal(a, 'For this unit I hold 4 documents — 2 Install and 2 IOM.');
});

test('past three kinds the tail is grouped, and the numbers still add up', () => {
  const types = ['Install', 'Install', 'IOM', 'IOM', 'Service Manual', 'Product Data', 'Regulation'];
  const said = coverageStatement(7, types);
  assert.equal(said, 'For this unit I hold 7 documents — 2 Install, 2 IOM, 1 Product Data and 2 others.');
  // Everything after the em dash is the breakdown; the head carries the total.
  const breakdown = said.slice(said.indexOf('—'));
  const counted = [...breakdown.matchAll(/(\d+)\s/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(counted, 7, `the breakdown sums to ${counted}, not 7`);
});

test('one document reads as one document', () => {
  assert.equal(coverageStatement(1, ['IOM']), 'For this unit I hold 1 document — 1 IOM.');
});

test('a partial kind list states the count alone rather than a mix that does not add up', () => {
  // The type-ahead path reaches this screen with a family string and no document
  // rows, so `types` is empty while the count is not. Less said, nothing wrong.
  assert.equal(coverageStatement(12, []), 'For this unit I hold 12 documents.');
  assert.equal(coverageStatement(12, ['Install', 'IOM']), 'For this unit I hold 12 documents.');
  assert.equal(coverageStatement(3, ['Install', '', '  ']), 'For this unit I hold 3 documents.');
});

test('zero documents says nothing — CoverageLine has already said it', () => {
  for (const n of [0, -1, 1.5, NaN]) assert.equal(coverageStatement(n, ['IOM']), '');
});

test('the invitation claims no capability, and carries no bypass phrasing', () => {
  // Hard constraint 2: a capability claim must be derived from documents in
  // scope. This sentence deliberately makes none — it promises only the thing
  // the system guarantees by construction, that a claim is cited or withheld.
  const BYPASS = [
    /show\s+me\s+anyway/i, /continue\s+anyway/i, /proceed\s+anyway/i,
    /i\s+understand\s+the\s+risks?/i, /override\s+(the\s+)?(safety|refusal|warning)/i,
    /dismiss\s+(the\s+)?refusal/i, /skip\s+(the\s+)?(safety|warning)/i,
  ];
  for (const re of BYPASS) assert.doesNotMatch(NOTHING_TO_SUGGEST_INVITATION, re);
  assert.match(NOTHING_TO_SUGGEST_INVITATION, /cited to a page/);
  // No named capability, no named manufacturer, no count of anything — those are
  // the shapes a hardcoded coverage claim takes.
  assert.doesNotMatch(NOTHING_TO_SUGGEST_INVITATION, /Trane|Carrier|Bosch|Goodman|rooftop/i);
  assert.doesNotMatch(NOTHING_TO_SUGGEST_INVITATION, /\b(I can|I will) (diagnose|help you|walk)/i);
});

// ---------------------------------------------------------------------------
// The taxonomy is gone, and stays gone
// ---------------------------------------------------------------------------

test('the class taxonomy is deleted, not merely unused', async () => {
  // ST-R15 AC 10 / ST-R16 AC 1. A dormant export is a thing a later round wires
  // back up "just for the offline case", which is how the defect returns.
  const mod = await import('./starters.ts');
  for (const gone of ['BY_CLASS', 'CLASS_PATTERNS', 'classifyEquipment', 'startersFor']) {
    assert.equal(mod[gone], undefined, `${gone} is still exported`);
  }
});
