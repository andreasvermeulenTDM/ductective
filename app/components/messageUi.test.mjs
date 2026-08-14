/**
 * ST-F07 — a conversational reply renders as conversation, not as a diagnosis.
 *
 *   npm test
 *
 * There is **no component test runner in this repo** — no React Testing Library,
 * no react-test-renderer, no jest — and this run does not add one, for the same
 * reason `citationUi.test.mjs` gives. So the structural criteria are asserted by
 * reading the source, and the criteria that need a rendered tree stay [H] rather
 * than being dressed up as passing here. What cannot be proven from source: that
 * the turn reads as conversation at arm's length on a roof, and that it arrives
 * in under a second with no spinner theatre. That is ST-F07 AC 7.
 *
 * AC 4 is the one worth reading twice. The uncited-defect net is not asserted by
 * trusting the comment that describes it — it is asserted as an *ordering* over
 * the dispatch in `Message`, so a refactor that hoists the empty-citations check
 * above the conversational branch, or drops the branch below it, fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments } from '../../tests/lib/jsx.mjs';
import { functionBodyOrNull as functionBody } from '../../tests/lib/density.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// `core.autocrlf` is on, so the working tree is CRLF and a pattern anchored on a
// bare \n silently matches nothing. Normalised once, here, rather than in seven
// regexes.
const read = (rel) =>
  blankComments(readFileSync(join(HERE, rel), 'utf8').replace(/\r\n/g, '\n'));

const SRC = read('Message.tsx');


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

// ---------------------------------------------------------------------------
// AC 1 / AC 4 — the branch exists, and it sits in the one place that is safe
// ---------------------------------------------------------------------------

test('AC 1: Message dispatches conversational explicitly, before the empty-citations check', () => {
  const branch = SRC.indexOf("kind === 'conversational'");
  const uncited = SRC.indexOf('citations.length === 0');
  assert.ok(branch > 0, 'no conversational branch — the kind still falls through to the answer renderer');
  assert.ok(uncited > 0, 'the empty-citations check is gone');
  assert.ok(
    branch < uncited,
    'the conversational branch is below the empty-citations check, so a conversational reply renders as UncitedDefect'
  );
});

test('AC 4: the fail-safe behind it is an ordering, not a hope', () => {
  // The net: every kind that is *not* explicitly dispatched above, and arrives
  // with no citation, still reaches UncitedDefect. Proven by the order of the
  // three landmarks in the dispatcher, so a future refactor that moves any of
  // them cannot quietly remove it.
  const dispatch = functionBody(SRC, 'Message');
  assert.ok(dispatch, 'the Message dispatcher is gone');

  /*
   * Each landmark must be FOUND before its position means anything.
   *
   * `indexOf` returns -1 when absent, and -1 is less than every real index — so
   * `conversational < emptyCheck` passed when the conversational branch was
   * **deleted outright**. A mutation test caught it: removing the branch left all
   * fifteen checks green. An ordering assertion that a deletion satisfies is not
   * an ordering assertion, and this file's own comment claims it pins three
   * landmarks "so a future refactor cannot quietly remove it" — which was exactly
   * what it could not do.
   */
  const at = (needle, what) => {
    const i = dispatch.indexOf(needle);
    assert.notEqual(i, -1, `${what} is gone from the dispatcher — not moved, missing`);
    return i;
  };

  const conversational = at("kind === 'conversational'", 'the conversational branch');
  const emptyCheck = at('citations.length === 0', 'the empty-citations check');
  const defect = at('<UncitedDefect', 'the uncited-defect render');
  const answer = at('<AnswerTurn', 'the answer render');

  assert.ok(conversational < emptyCheck, 'conversational must be handled before the empty-citations check');
  // Was `emptyCheck < defect || defect > 0`, where the second clause passed
  // whenever UncitedDefect appeared anywhere at all, order be damned.
  assert.ok(emptyCheck < defect, 'the empty-citations check no longer reaches UncitedDefect');
  assert.ok(emptyCheck < answer, 'an answer can now be rendered without passing the empty-citations check');
  // And the check itself is unguarded by anything about the kind: it applies to
  // every kind that reaches it, which is what makes it a net rather than a case.
  assert.match(dispatch, /if \(citations\.length === 0\) return <UncitedDefect body=\{body\} \/>;/);
});

test('AC 4: the all-broken strict reading survives too', () => {
  // E6.4's stricter half — an answer whose every citation is broken is still an
  // uncited claim. ST-F07 must not have relaxed it on the way past.
  const dispatch = functionBody(SRC, 'Message');
  assert.match(dispatch, /usable\.length === 0/);
  assert.match(dispatch, /<UncitedDefect body=\{body\} allBroken=\{broken\} \/>/);
});

// ---------------------------------------------------------------------------
// AC 2 — it carries no claim, so it draws nothing that carries one
// ---------------------------------------------------------------------------

test('AC 2: no citation row, no overline of the answer kind, no step numbering', () => {
  const turn = functionBody(SRC, 'ConversationalTurn');
  assert.ok(turn, 'ConversationalTurn is missing');

  assert.doesNotMatch(turn, /CitationChip|UnresolvedCitationChip|citationRow/, 'it draws a citation affordance');
  assert.doesNotMatch(turn, /CHECK IN THIS ORDER/, 'it draws the answer overline');
  assert.doesNotMatch(turn, /stepNumber|parseAnswer|steps\b/, 'it draws numbered steps');
  assert.doesNotMatch(turn, /adviseOnly/, 'it draws the advise-only footer, which qualifies a claim it does not make');
  // Not even an empty one: a "no sources" placeholder would be an affordance
  // implying sources were expected.
  assert.doesNotMatch(turn, /no sources?|uncited|UncitedDefect/i);
});

test('AC 2: it receives no citations prop at all, so there is nothing to render', () => {
  const dispatch = functionBody(SRC, 'Message');
  const call = /<ConversationalTurn ([^>]*)\/>/.exec(dispatch);
  assert.ok(call, 'ConversationalTurn is not rendered by the dispatcher');
  assert.equal(call[1].trim(), 'body={body}', 'it is passed more than the body');
});

// ---------------------------------------------------------------------------
// AC 3 — visually distinct from a refusal
// ---------------------------------------------------------------------------

test('AC 3: it uses no refusal colour, and no alert role', () => {
  const turn = functionBody(SRC, 'ConversationalTurn');
  assert.doesNotMatch(turn, /color\.refusal/, 'the conversational turn borrows the refusal palette');
  assert.doesNotMatch(turn, /accessibilityRole="alert"/, 'a pleasantry is announced as an alert');

  for (const name of ['conversational', 'conversationalLabel']) {
    const rule = styleRule(SRC, name);
    assert.ok(rule !== null, `no ${name} style`);
    assert.doesNotMatch(rule, /color\.refusal/, `${name} borrows the refusal palette`);
  }
});

test('AC 3: it is distinct from the clarify turn as well — no cyan ring or wash', () => {
  const rule = styleRule(SRC, 'conversational');
  assert.doesNotMatch(rule, /accentSurface|accentBorder/, 'it borrows the clarification treatment');
  assert.doesNotMatch(rule, /borderWidth/, 'it draws a card, which is the answer/clarify language');
});

test('AC 3: tokens only — no hex reaches this component', () => {
  // E6.8, checked over the whole file rather than the branch, because a new hex
  // anywhere in it is the same defect.
  assert.deepEqual([...SRC.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
  const rule = styleRule(SRC, 'conversationalLabel');
  assert.match(rule, /color\.textSecondary/);
});

test('AC 3: the label says what the turn is, and is not a bypass affordance', () => {
  // The same patterns tests/suites/e5-safety.mjs greps the app for. New copy on
  // an assistant turn is exactly where one could appear by accident.
  const BYPASS = [
    /show\s+me\s+anyway/i, /continue\s+anyway/i, /proceed\s+anyway/i,
    /i\s+understand\s+the\s+risks?/i, /override\s+(the\s+)?(safety|refusal|warning)/i,
    /dismiss\s+(the\s+)?refusal/i, /skip\s+(the\s+)?(safety|warning)/i,
  ];
  const turn = functionBody(SRC, 'ConversationalTurn');
  for (const re of BYPASS) assert.doesNotMatch(turn, re, `the conversational turn matches ${re}`);
  assert.match(turn, /NOT A DIAGNOSIS/, 'the turn no longer says it is not a diagnosis');
});

test('AC 3: nothing in it is tappable — there is nothing to inspect and no retry to offer', () => {
  const turn = functionBody(SRC, 'ConversationalTurn');
  assert.doesNotMatch(turn, /Pressable|onPress|TouchableOpacity|\bButton\b/);
});

// ---------------------------------------------------------------------------
// The neighbours this branch must not have disturbed
// ---------------------------------------------------------------------------

test('the refusal card still has nothing to click past — checked with a walker that reads it', () => {
  // Not strictly ST-F07, and deliberately here anyway. E5.2's own version of this
  // check (tests/suites/e5-safety.mjs:150) uses a brace-only walker, so on
  // `function RefusalCard({ body }: { body: string })` it closes on the parameter
  // list and inspects 29 characters. Every one of its `filter` patterns then finds
  // nothing and the check passes without reading the component — a safety
  // guardrail check that cannot fail. Reported as a cross-stage finding against
  // Test in `.pipeline/04-frontend-fixes.md` §W2; this run adds a version that
  // actually reads the card rather than editing another stage's suite.
  const card = functionBody(SRC, 'RefusalCard');
  assert.ok(card && card.length > 100, 'the RefusalCard body did not parse');
  for (const [what, re] of [
    ['Pressable', /\bPressable\b/], ['onPress', /\bonPress\b/],
    ['TouchableOpacity', /\bTouchableOpacity\b/], ['Button', /\bButton\b/],
    ['a collapse toggle', /collaps|expand|toggle/i],
  ]) {
    assert.doesNotMatch(card, re, `the refusal carries ${what} — a refusal a technician can click past is not a refusal`);
  }
  assert.match(card, /accessibilityRole="alert"/, 'the refusal is no longer announced as an alert');
  // The colour lives in the StyleSheet, not the component body — checked there.
  assert.match(styleRule(SRC, 'refusal'), /color\.refusal\b/);
  assert.match(styleRule(SRC, 'refusalLabel'), /color\.refusalText\b/);
});

// ---------------------------------------------------------------------------
// AC 5 / AC 6 — the two things that already hold, asserted rather than assumed
// ---------------------------------------------------------------------------

test('AC 5: the unanswered retry path keys off a trailing user turn, so a reply clears it', () => {
  const chat = read('../screens/ChatScreen.tsx');
  const m = /const unanswered =([\s\S]*?);\n/.exec(chat);
  assert.ok(m, 'the unanswered derivation is gone');
  assert.match(m[1], /kind === 'user'/, 'unanswered no longer derives from a trailing user turn');
  // It must not have grown a list of assistant kinds that count as an answer: a
  // list is a place to forget one, and the trailing-user rule needs no list.
  assert.doesNotMatch(m[1], /conversational|clarify|refusal|answer'/);
});

test('AC 5: the conversational reply is appended and reported like every other assistant turn', () => {
  const chat = read('../screens/ChatScreen.tsx');
  // No kind filter around either call — a suppressed conversational reply would
  // leave the technician's own turn looking dropped (OQ-F2).
  assert.match(chat, /setMessages\(\(prev\) => \[\.\.\.prev, reply\]\);/);
  assert.match(chat, /onAnswerDelivered\?\.\(reply\.kind\);/);
});

test('AC 6: the history counters count refusals and real citation rows, not this', () => {
  const store = read('../lib/store.ts');
  const m = /citationCount: ([\s\S]*?),\n\s*refused: ([\s\S]*?),\n/.exec(store);
  assert.ok(m, 'the derived session counters are gone');
  assert.match(m[1], /m\.citations\?\.length/, 'citationCount no longer counts citation rows');
  assert.match(m[2], /m\.kind === 'refusal'/, 'refused no longer keys off the refusal kind alone');
  assert.doesNotMatch(m[1] + m[2], /conversational/, 'a conversational turn now feeds a derived counter');
});

test('AC 6: store passes the wire kind through untouched — no allow-list to fall out of', () => {
  const store = read('../lib/store.ts');
  assert.doesNotMatch(store, /kind === 'conversational'/, 'the store grew a special case for the new kind');
});
