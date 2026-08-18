/**
 * suggestions.test.mjs — ST-R15 (serving) and ST-R17 ("what can you help with?").
 *
 *   npm test
 *
 * The build half (`scripts/build-suggestions.mjs`) needs the service key and is
 * a check, not a test. What is testable without one is the contract:
 *
 *  - the ordering and the caps (OQ-R7), deterministically;
 *  - `[]` for every failure, including `sql/018` not being applied — never an
 *    error, and never the old hardcoded taxonomy;
 *  - **the capability answer and the route cannot name different things**, which
 *    is the property that makes both of them coverage claims we can keep.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  selectSuggestions, suggestionsForScope, MAX_SUGGESTIONS, MAX_PER_CATEGORY, CATEGORY_ORDER,
} from './suggestions.mjs';
import { diagnose } from './diagnose.mjs';
import { zeroUsage } from './metrics.mjs';

const row = (over = {}) => ({
  text: 'What does the manual specify for minimum service clearances?',
  category: 'reference',
  document_id: 'doc_a',
  page_number: 12,
  similarity: 0.7,
  source_document: 'Bosch_IDS-Ultra-Condenser-Install',
  ...over,
});

// ---------------------------------------------------------------------------
// OQ-R7 — the ordering and the caps
// ---------------------------------------------------------------------------

test('categories are ordered fault → reference → sequence → commissioning', () => {
  assert.deepEqual(CATEGORY_ORDER, ['fault', 'reference', 'sequence', 'commissioning']);
  const out = selectSuggestions([
    row({ text: 'commissioning?', category: 'commissioning' }),
    row({ text: 'sequence?', category: 'sequence' }),
    row({ text: 'reference?', category: 'reference' }),
    row({ text: 'fault?', category: 'fault' }),
  ]);
  assert.deepEqual(out.map((s) => s.category), ['fault', 'reference', 'sequence', 'commissioning']);
});

test('at most two from any one category, so a big fault table cannot fill the screen', () => {
  const faults = Array.from({ length: 10 }, (_, i) => row({ text: `What does the E${i} code indicate?`, category: 'fault' }));
  const refs = Array.from({ length: 10 }, (_, i) => row({ text: `Reference question ${i}?`, category: 'reference' }));
  const out = selectSuggestions([...faults, ...refs]);
  assert.equal(out.length, MAX_SUGGESTIONS);
  assert.equal(out.filter((s) => s.category === 'fault').length, MAX_PER_CATEGORY);
  assert.equal(out.filter((s) => s.category === 'reference').length, MAX_PER_CATEGORY);
});

test('the cap fills rather than under-offers when only one category exists', () => {
  // Four clearance questions beat two chips and a gap.
  const refs = Array.from({ length: 9 }, (_, i) => row({ text: `Reference question ${i}?`, category: 'reference' }));
  assert.equal(selectSuggestions(refs).length, MAX_SUGGESTIONS);
});

test('four is the ceiling, and zero is legal', () => {
  assert.equal(MAX_SUGGESTIONS, 4, 'ST-F18\'s density baseline must not move');
  assert.deepEqual(selectSuggestions([]), []);
  assert.deepEqual(selectSuggestions(undefined), []);
});

test('the same text mined from six documents is one suggestion, not six', () => {
  // A family of manuals shares headings, so this is the common case rather than
  // an edge one.
  const shared = Array.from({ length: 6 }, (_, i) => row({ document_id: `doc_${i}` }));
  const out = selectSuggestions(shared);
  assert.equal(out.length, 1);
  assert.equal(out[0].documentId, 'doc_0', 'and which copy survives is deterministic');
});

test('deduplication is on normalised text — casing and punctuation do not duplicate', () => {
  const out = selectSuggestions([
    row({ text: 'What are the clearances?', document_id: 'doc_a' }),
    row({ text: 'What are the CLEARANCES?', document_id: 'doc_b' }),
  ]);
  assert.equal(out.length, 1);
});

test('the same scope always yields the same list, in the same order', () => {
  const rows = [
    row({ text: 'a?', category: 'reference', similarity: 0.6, document_id: 'doc_b' }),
    row({ text: 'b?', category: 'fault', similarity: 0.8, document_id: 'doc_a' }),
    row({ text: 'c?', category: 'reference', similarity: 0.9, document_id: 'doc_c' }),
  ];
  const a = selectSuggestions(rows);
  const b = selectSuggestions([...rows].reverse());
  assert.deepEqual(a, b, 'a technician reopening a job must not see the list reshuffle');
  assert.deepEqual(a.map((s) => s.text), ['b?', 'c?', 'a?'], 'category first, then similarity');
});

test('a row with no text is dropped rather than rendered blank', () => {
  assert.deepEqual(selectSuggestions([row({ text: '   ' }), row({ text: null })]), []);
});

test('the served shape is the wire contract the app parses', () => {
  const [s] = selectSuggestions([row()]);
  assert.deepEqual(Object.keys(s).sort(), ['category', 'documentId', 'page', 'source_document', 'text']);
  assert.equal(s.page, 12);
  assert.equal(s.documentId, 'doc_a');
});

// ---------------------------------------------------------------------------
// AC 8 / AC 12 — empty is a 200, and sql/018 being unapplied is empty
// ---------------------------------------------------------------------------

const dbWith = (result) => ({
  from: () => ({
    select: () => ({
      in: () => ({ eq: async () => result }),
    }),
  }),
});

test('an empty scope resolves to [] without touching the database', async () => {
  const boom = { from: () => { throw new Error('must not be called'); } };
  assert.deepEqual(await suggestionsForScope([], { db: boom }), []);
  assert.deepEqual(await suggestionsForScope(null, { db: boom }), []);
});

test('AC 12 — a missing document_suggestions table degrades to [], never to an error', async () => {
  // The expected state until the owner applies sql/018.
  const missing = dbWith({ data: null, error: { code: '42P01', message: 'relation "document_suggestions" does not exist' } });
  assert.deepEqual(await suggestionsForScope(['doc_a'], { db: missing }), []);

  const thrown = { from: () => { throw new Error('PGRST205'); } };
  assert.deepEqual(await suggestionsForScope(['doc_a'], { db: thrown }), []);
});

test('a live table returns the selected, ordered list with the document label attached', async () => {
  const db = dbWith({
    data: [
      { text: 'What does the E4 code indicate?', category: 'fault', document_id: 'doc_a', page_number: 41, similarity: 0.71, documents: { label: 'Bosch_IDS-Gateway-Troubleshooting-Guide', in_scope: true } },
      { text: 'What does the manual specify for electrical data?', category: 'reference', document_id: 'doc_b', page_number: 18, similarity: 0.66, documents: { label: 'Bosch_IDS-Ultra-Condenser-Install', in_scope: true } },
    ],
    error: null,
  });
  const out = await suggestionsForScope(['doc_a', 'doc_b'], { db });
  assert.equal(out.length, 2);
  assert.equal(out[0].category, 'fault');
  assert.equal(out[0].source_document, 'Bosch_IDS-Gateway-Troubleshooting-Guide');
  assert.equal(out[1].page, 18);
});

test('the in-scope filter is in the query, not in the caller', () => {
  // A filter the caller has to remember is a filter someone will forget, and
  // forgetting it means offering questions about a retired duplicate.
  const src = readFileSync(new URL('./suggestions.mjs', import.meta.url), 'utf8');
  assert.match(src, /documents!inner/, 'the join must be the filter');
  assert.match(src, /\.eq\('documents\.in_scope', true\)/);
});

/**
 * ST-R15 AC 7 / hard constraint 2 — the scope the caller asked for is the scope
 * the query filters on.
 *
 * Added by Stage 5, round 4. Every other test in this file drives
 * `suggestionsForScope` through a stub whose `.in()` and `.eq()` **ignore their
 * arguments** (`dbWith` above), so the assertions below could not have failed:
 * passing the wrong column, passing a stale scope, or dropping the `.in()`
 * entirely would have left the whole file green while the route served another
 * unit's manual. A suggestion is a coverage claim; the claim is only true if the
 * rows came from the documents this unit resolved to.
 *
 * Source-grepping this would not do either — `suggestions.mjs` names
 * `documentIds`, and a grep cannot tell that the *value* reaching PostgREST is
 * the caller's array rather than a truncated or re-derived one. So the arguments
 * are recorded and compared.
 */
const recordingDb = (calls, result = { data: [], error: null }) => ({
  from: (table) => {
    calls.push(['from', table]);
    return {
      select: (cols) => {
        calls.push(['select', cols]);
        return {
          in: (col, values) => {
            calls.push(['in', col, values]);
            return { eq: async (col2, value) => { calls.push(['eq', col2, value]); return result; } };
          },
        };
      },
    };
  },
});

test('the query filters on exactly the document ids the caller passed', async () => {
  const calls = [];
  const scope = ['doc_a', 'doc_b', 'doc_c'];
  await suggestionsForScope(scope, { db: recordingDb(calls) });

  assert.deepEqual(calls.find((c) => c[0] === 'from'), ['from', 'document_suggestions']);

  const inCall = calls.find((c) => c[0] === 'in');
  assert.ok(inCall, 'the scope filter never reached the query');
  assert.equal(inCall[1], 'document_id', 'the scope must filter on document_id');
  assert.deepEqual(inCall[2], scope, 'the query must filter on the caller’s scope, verbatim');

  const eqCall = calls.find((c) => c[0] === 'eq');
  assert.deepEqual(eqCall, ['eq', 'documents.in_scope', true], 'the in-scope join filter must still be applied');
});

test('a different scope produces a different filter — the scope is not cached or re-derived', async () => {
  // The failure this catches: a module-level scope, a memoised query, or a
  // filter built from anything other than the argument. Two calls, two filters.
  const first = [];
  const second = [];
  await suggestionsForScope(['doc_a'], { db: recordingDb(first) });
  await suggestionsForScope(['doc_z', 'doc_y'], { db: recordingDb(second) });

  assert.deepEqual(first.find((c) => c[0] === 'in')[2], ['doc_a']);
  assert.deepEqual(second.find((c) => c[0] === 'in')[2], ['doc_z', 'doc_y']);
});

// ---------------------------------------------------------------------------
// ST-R17 — the capability answer and the route cannot diverge
// ---------------------------------------------------------------------------

const SCOPE = ['doc_a', 'doc_b'];
const SUGGESTION_ROWS = [
  { text: 'What does the E4 code indicate?', category: 'fault', document_id: 'doc_a', page_number: 41, similarity: 0.71, documents: { label: 'A', in_scope: true } },
  { text: 'What does the manual specify for electrical data?', category: 'reference', document_id: 'doc_b', page_number: 18, similarity: 0.66, documents: { label: 'B', in_scope: true } },
];
const DOC_ROWS = [
  { id: 'doc_a', doc_type: 'Troubleshooting Guide', in_scope: true },
  { id: 'doc_b', doc_type: 'Install', in_scope: true },
];

/**
 * One stub serving both tables, because that is how the real server works: the
 * capability path reads `documents` for the coverage statement and
 * `document_suggestions` for the list.
 */
function capabilityDeps({ suggestions = SUGGESTION_ROWS, docs = DOC_ROWS } = {}) {
  const boom = () => { throw new Error('the capability path must never reach the model or retrieval'); };
  return {
    completeFn: boom,
    embedFn: boom,
    db: {
      rpc: boom,
      from: (table) => ({
        select: () => {
          const inFn = async (_c, ids) => ({ data: docs.filter((d) => ids.includes(d.id)), error: null });
          if (table === 'document_suggestions') {
            return { in: () => ({ eq: async () => ({ data: suggestions, error: null }) }) };
          }
          return { in: inFn };
        },
      }),
    },
  };
}

test('AC 1 — the capability answer lists the same texts the route would serve', async () => {
  const db = capabilityDeps().db;
  const fromRoute = await suggestionsForScope(SCOPE, { db, limit: 6 });
  const out = await diagnose({ symptom: 'what can you help with?', documentIds: SCOPE }, capabilityDeps());

  assert.equal(out.kind, 'conversational');
  assert.equal(out.meta.intent, 'capability');
  for (const s of fromRoute) {
    assert.ok(out.body.includes(s.text), `the capability answer omits "${s.text}" that the route serves`);
  }
  // And it names nothing the route would not.
  const listed = out.body.split('\n').filter((l) => l.trim().endsWith('?') && l.includes('?'));
  for (const line of listed) {
    if (!line.startsWith('What')) continue;
    assert.ok(
      fromRoute.some((s) => s.text === line.trim()),
      `the capability answer names "${line.trim()}", which the suggestions route would not serve`
    );
  }
});

test('AC 2 — the three degradation steps, each with its own state', async () => {
  // 1. suggestions available → listed
  const withList = await diagnose({ symptom: 'what can you help with?', documentIds: SCOPE }, capabilityDeps());
  assert.match(withList.body, /E4 code/);

  // 2. scope but no suggestions → the coverage statement alone
  const noList = await diagnose(
    { symptom: 'what can you help with?', documentIds: SCOPE },
    capabilityDeps({ suggestions: [] })
  );
  assert.match(noList.body, /2 documents/);
  assert.doesNotMatch(noList.body, /E4 code/);
  assert.doesNotMatch(noList.body, /Questions I can answer/);

  // 3. no scope → coveredFamilies' capped manufacturer list. The unscoped read
  // is a different select, so it degrades to the honest generic statement here.
  const noScope = await diagnose({ symptom: 'what can you help with?', equipment: 'Some Unit' }, capabilityDeps());
  assert.equal(noScope.meta.intent, 'capability');
  assert.ok(noScope.body.length > 80);
  assert.doesNotMatch(noScope.body, /E4 code/);
});

test('AC 4 — with no validated suggestions the capability answer offers none of its own', async () => {
  // The suggestions rows are the single source. If the route is empty, the
  // capability answer names nothing — it must not fall back to a list of its own,
  // which is precisely what the deleted taxonomy did.
  const out = await diagnose(
    { symptom: 'what can you help with?', documentIds: SCOPE },
    capabilityDeps({ suggestions: [] })
  );
  assert.doesNotMatch(out.body, /^What .*\?$/m, 'a question was offered that nothing validated');
  assert.doesNotMatch(out.body, /^\s*[-*•]\s/m, 'nor a bulleted list of them');
});

test('AC 4 — and a suggestion whose document went out of scope is named by neither', async () => {
  // The join is the filter, so a retired duplicate (ST-R13) or a re-scoped
  // document drops out of both surfaces at once with no second action.
  const retired = SUGGESTION_ROWS.map((r) => ({ ...r, documents: { ...r.documents, in_scope: false } }));
  // PostgREST's `!inner` + `.eq` would return nothing for these; the stub models
  // that by returning the empty set the real query would.
  const db = capabilityDeps({ suggestions: [] }).db;
  assert.deepEqual(await suggestionsForScope(SCOPE, { db }), []);
  assert.ok(retired.every((r) => r.documents.in_scope === false));
});

test('AC 6 — the capability lookup spends no model quota', async () => {
  const out = await diagnose({ symptom: 'what can you help with?', documentIds: SCOPE }, capabilityDeps());
  assert.equal(out.meta.model, null);
  assert.deepEqual(out.meta.usage, zeroUsage());
  assert.equal(out.meta.usage.inputTokens, 0);
  assert.equal(out.meta.attempts, 0);
});

test('AC 3 — it stays kind:conversational with no citations', async () => {
  const out = await diagnose({ symptom: 'what can you help with?', documentIds: SCOPE }, capabilityDeps());
  assert.equal(out.kind, 'conversational');
  assert.deepEqual(out.citations, []);
  const src = readFileSync(new URL('./coverage.mjs', import.meta.url), 'utf8');
  assert.match(src, /inventory claim, not a diagnostic claim/i,
    'the module must say why an uncited list is legitimate — a reviewer will challenge it');
});
