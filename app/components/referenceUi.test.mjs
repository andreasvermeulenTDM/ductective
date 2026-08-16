/**
 * ST-R06 — a reference answer renders as data, and the citation net stays in
 * front of it.
 *
 *   npm test
 *
 * No component test runner in this repo (see `messageUi.test.mjs` for why, and
 * for why round 4 does not add one), so the structural criteria are asserted by
 * reading the source. AC 7 — readable at 200% font scale on a real phone — stays
 * [H] rather than being dressed up as passing here.
 *
 * AC 4 is the one to read twice, and it is asserted the same way ST-F07's was:
 * as an **ordering** over `Message`'s dispatcher. `meta.shape` rides on
 * `kind: 'answer'` precisely so the uncited-defect net catches a reference
 * answer with no usable citation — and that only remains true while the shape
 * check sits below both nets. A refactor that hoists it fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments } from '../../tests/lib/jsx.mjs';
import { functionBodyOrNull as functionBody } from '../../tests/lib/density.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => blankComments(readFileSync(join(HERE, rel), 'utf8').replace(/\r\n/g, '\n'));

const SRC = read('Message.tsx');
const TURN = functionBody(SRC, 'ReferenceAnswer');
const DISPATCH = functionBody(SRC, 'Message');

/** A named entry of the StyleSheet at the foot of the file, braces balanced. */
function styleRule(source, name) {
  const at = source.search(new RegExp(`\\n  ${name}:\\s*\\{`));
  if (at === -1) return null;
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

test('assumption check: both bodies parse, so every check below reads real source', () => {
  assert.ok(TURN && TURN.length > 400, `ReferenceAnswer parsed to ${TURN?.length} chars`);
  assert.ok(DISPATCH && DISPATCH.length > 200, `Message parsed to ${DISPATCH?.length} chars`);
});

// ---------------------------------------------------------------------------
// AC 1 — its own overline, and not the checklist's
// ---------------------------------------------------------------------------

test('AC 1: the overline is FROM THE MANUAL, and CHECK IN THIS ORDER is not in this branch', () => {
  assert.match(TURN, /FROM THE MANUAL/);
  assert.doesNotMatch(TURN, /CHECK IN THIS ORDER/,
    'the reference branch draws the checklist overline — the exact confusion the story exists to prevent');
  // And the checklist overline still exists where it belongs, so this was not
  // bought by deleting it from the answer turn.
  assert.match(functionBody(SRC, 'AnswerTurn'), /CHECK IN THIS ORDER/);
});

// ---------------------------------------------------------------------------
// AC 2 — data, not steps
// ---------------------------------------------------------------------------

test('AC 2: no row is numbered — there is no ordinal in the branch at all', () => {
  assert.doesNotMatch(TURN, /\{i \+ 1\}/, 'rows are numbered');
  assert.doesNotMatch(TURN, /stepNumber|stepHeadline|stepBody|s\.steps\b/, 'the branch borrows the step treatment');
  assert.doesNotMatch(TURN, /Reading:/, 'the branch draws the diagnostic reading marker');
  assert.doesNotMatch(TURN, /parseAnswer|splitReading/, 'the branch parses the answer as a procedure');
});

test('AC 2: values are separated from labels, and stacked rather than columned', () => {
  // Two distinct roles for the two things, so "separated" is structural and not
  // a matter of the reader squinting.
  assert.match(TURN, /s\.referenceSpec/);
  assert.match(TURN, /s\.referenceValue/);
  const spec = styleRule(SRC, 'referenceSpec');
  const value = styleRule(SRC, 'referenceValue');
  assert.notEqual(spec, value, 'label and value share one style, so nothing distinguishes them');
  assert.match(value, /type\.bodyStrong/, 'the value is not the emphasised half of the pair');
  assert.match(spec, /type\.caption/, 'the label is not the quieter half of the pair');

  // AC 7's structural half: a row is a column stack, so a long spec cannot wrap
  // the value out of reach of its label at 200% scale. A `flexDirection: row`
  // here would be exactly that failure.
  const row = styleRule(SRC, 'referenceRow');
  assert.doesNotMatch(row, /flexDirection:\s*'row'/, 'rows are columned, which is what breaks at 200% font scale');
});

// ---------------------------------------------------------------------------
// AC 3 — a reference answer is a cited answer and loses nothing
// ---------------------------------------------------------------------------

test('AC 3: every row carries a tappable citation chip, opening the same sheet', () => {
  assert.match(TURN, /<CitationChip/, 'the reference turn draws no citation chip');
  assert.match(TURN, /onPress=\{\(x\) => onCitationPress\?\.\(x\)\}/,
    'the chip is not wired to the shared citation handler, so it opens nothing');
  // The same handler ChatScreen passes to every other turn — one sheet, not a
  // second implementation for this shape.
  const chat = read('../screens/ChatScreen.tsx');
  assert.match(chat, /onCitationPress=\{setCitation\}/);
  assert.match(chat, /<CitationSheet citation=\{citation\}/);
});

test('AC 3: a broken citation is shown beside the good ones, never dropped', () => {
  assert.match(TURN, /<UnresolvedCitationChip/,
    'broken citations are discarded, which makes the sheet look better sourced than it is');
});

test('AC 3: per-row pairing is refused unless the correspondence is exact', () => {
  // CLAUDE.md: a citation that does not support the claim attached to it is
  // worse than an uncited one. So the pairing is conditional on the counts
  // agreeing, and the fallback is the undifferentiated chip row.
  assert.match(TURN, /const perRow = citations\.length === items\.length && broken\.length === 0;/);
  assert.match(TURN, /\{perRow &&/, 'the per-row chip is drawn unconditionally');
  assert.match(TURN, /\{\(!perRow \|\| broken\.length > 0\) &&/, 'there is no fallback chip row');
});

// ---------------------------------------------------------------------------
// AC 4 — the uncited-defect net, asserted as an ordering
// ---------------------------------------------------------------------------

test('AC 4: the shape check sits below BOTH citation nets', () => {
  const at = (needle, what) => {
    const i = DISPATCH.indexOf(needle);
    assert.notEqual(i, -1, `${what} is gone from the dispatcher — not moved, missing`);
    return i;
  };

  const emptyCheck = at('citations.length === 0', 'the empty-citations check');
  const allBroken = at('usable.length === 0', 'the all-broken check');
  const shape = at("shape === 'reference'", 'the reference shape branch');
  const referenceRender = at('<ReferenceAnswer', 'the reference render');
  const answerRender = at('<AnswerTurn', 'the ordinary answer render');

  assert.ok(emptyCheck < shape,
    'a reference answer with no citations would render as a spec sheet instead of a defect');
  assert.ok(allBroken < shape,
    'a reference answer whose every citation is broken would render as a spec sheet');
  assert.ok(shape < referenceRender);
  assert.ok(shape < answerRender, 'the fallback to the ordinary answer turn is not below the shape check');
});

test('AC 4: shape can only ever pick a renderer — it can never skip one', () => {
  // The failure this forbids is a `kind`-like escape: a shape value that returns
  // early, before the nets, or that suppresses the citation row. Both nets are
  // unguarded `if`s applying to every kind that reaches them, and the shape
  // branch's own miss falls *through* to AnswerTurn rather than returning.
  assert.match(DISPATCH, /if \(citations\.length === 0\) return <UncitedDefect body=\{body\} \/>;/);
  assert.match(DISPATCH, /if \(usable\.length === 0\) return <UncitedDefect body=\{body\} allBroken=\{broken\} \/>;/);
  assert.match(DISPATCH, /if \(reference\.items\.length > 0\) \{/,
    'an unparseable reference body no longer falls through to the ordinary answer turn');
  // ST-F07's branch is untouched and still above the nets, where it belongs.
  const conversational = DISPATCH.indexOf("kind === 'conversational'");
  assert.ok(conversational > 0 && conversational < DISPATCH.indexOf('citations.length === 0'));
});

test('AC 4: the wire parser admits one shape value and drops everything else', () => {
  // The other end of the same guarantee. An unrecognised `meta.shape` must not
  // survive to the renderer, where an unhandled value would fall through to the
  // ordinary answer turn anyway — but the narrowing is asserted at the boundary
  // so a future shape cannot arrive half-supported.
  const client = read('../lib/diagnose.ts');
  assert.match(client, /shape === 'reference' \? \{ shape \} : undefined/);
});

// ---------------------------------------------------------------------------
// AC 5 — the hazard-adjacent note is a pointer, not a refusal
// ---------------------------------------------------------------------------

test('AC 5: the note is visually distinct from the values and is not styled as a refusal', () => {
  assert.match(TURN, /s\.referenceNote\b/, 'the hazard-adjacent note has no treatment of its own');
  for (const name of ['referenceNote', 'referenceNoteText', 'reference', 'referenceRow',
    'referenceSpec', 'referenceValue', 'referenceCondition', 'referenceOverline', 'referenceSource']) {
    const rule = styleRule(SRC, name);
    assert.ok(rule !== null, `no ${name} style`);
    assert.doesNotMatch(rule, /color\.refusal/,
      `${name} borrows the refusal palette — read as a refusal, the note implies the values were withheld`);
  }
  assert.doesNotMatch(TURN, /color\.refusal/, 'the branch draws a refusal colour inline');
  assert.doesNotMatch(TURN, /accessibilityRole="alert"/, 'a pointer to standard procedure is announced as an alert');

  // Distinct from the values it follows: its own surface, and a glyph.
  assert.match(styleRule(SRC, 'referenceNote'), /backgroundColor: color\.surface/);
  assert.match(TURN, /information-circle-outline/);
});

test('AC 5: the note carries no bypass phrasing', () => {
  // The same patterns tests/suites/e5-safety.mjs greps the app for. A sentence
  // that sits beside hazard vocabulary is exactly where one would appear.
  const BYPASS = [
    /show\s+me\s+anyway/i, /continue\s+anyway/i, /proceed\s+anyway/i,
    /i\s+understand\s+the\s+risks?/i, /override\s+(the\s+)?(safety|refusal|warning)/i,
    /dismiss\s+(the\s+)?refusal/i, /skip\s+(the\s+)?(safety|warning)/i,
  ];
  for (const re of BYPASS) assert.doesNotMatch(TURN, re, `the reference turn matches ${re}`);
});

test('AC 5: the advise-only footer is still attached — these are values, not a licence', () => {
  assert.match(TURN, /s\.adviseOnly\b/, 'a reference answer drops the advise-only qualification');
  assert.match(TURN, /verify them against/i);
});

// ---------------------------------------------------------------------------
// AC 6 — tokens only, and every pairing measured
// ---------------------------------------------------------------------------

test('AC 6: no hex reaches this component, and every reference role is a token', () => {
  assert.deepEqual([...SRC.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
  for (const name of ['referenceOverline', 'referenceSpec', 'referenceValue', 'referenceCondition', 'referenceNoteText']) {
    assert.match(styleRule(SRC, name), /color: color\.\w+/, `${name} draws text without a semantic role`);
  }
});

test('AC 6: every pairing this branch introduces is measured, and the matrix is green', async () => {
  const { TEXT_PAIRS, evaluateMatrix, coverageGaps } = await import('../../tests/lib/contrastMatrix.mjs');
  const tokens = readFileSync(join(HERE, '../theme/tokens.ts'), 'utf8');

  // The three pairings the reference sheet draws: overline and label on the
  // screen background, value on the screen background, note text on `surface`.
  const has = (fg, on) => TEXT_PAIRS.some((p) => p.fg === fg && p.on.length === on.length && p.on.every((r, i) => r === on[i]));
  assert.ok(has('textSecondary', ['background']), 'the reference label/overline pairing is unmeasured');
  assert.ok(has('textPrimary', ['background']), 'the reference value pairing is unmeasured');
  assert.ok(has('textSecondary', ['surface']), 'the hazard-note pairing is unmeasured');

  assert.deepEqual(evaluateMatrix(tokens).failures, [], 'the matrix is not green');
  const { gaps } = coverageGaps([{ file: 'app/components/Message.tsx', source: SRC }]);
  assert.deepEqual(gaps.filter((g) => !/stale/.test(g)), [], gaps.join('\n'));
});

// ---------------------------------------------------------------------------
// The neighbours this branch must not have disturbed
// ---------------------------------------------------------------------------

test('the transient shape never reaches a database column', () => {
  // OQ-R2: no `messages.kind` migration, and no new column either. The insert
  // names its columns, so this is asserted at the insert rather than hoped for.
  const store = read('../lib/store.ts');
  assert.match(store, /\.insert\(\{ session_id: sessionId, kind, body, seq \}\)/,
    'the message insert has grown a field');
  assert.doesNotMatch(store, /shape:\s*result|insert\([^)]*shape/, 'shape is being persisted');
  // And the store still has no opinion about rendering, exactly as ST-F07 left it.
  assert.doesNotMatch(store, /shape === 'reference'/, 'the store grew a special case for the new shape');
});

test('the conversational and refusal turns are untouched by this story', () => {
  const conversational = functionBody(SRC, 'ConversationalTurn');
  assert.match(conversational, /NOT A DIAGNOSIS/);
  assert.doesNotMatch(conversational, /reference/i);
  const refusal = functionBody(SRC, 'RefusalCard');
  assert.ok(refusal && refusal.length > 100);
  assert.match(refusal, /accessibilityRole="alert"/);
  for (const re of [/\bPressable\b/, /\bonPress\b/, /collaps|expand|toggle/i]) {
    assert.doesNotMatch(refusal, re, 'the refusal grew something to click past');
  }
});
