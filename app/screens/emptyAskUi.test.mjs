/**
 * ST-R16 — the first screen offers what the manual supports, or offers nothing
 * and says why.
 *
 *   npm test
 *
 * No component test runner in this repo (see `accountUi.test.mjs` for the
 * reasoning, unchanged this round), so these are structural: the branches exist,
 * they are ordered the way the criteria require, and nothing in the empty state
 * reaches a control. AC 10 — the Bosch unit from the session, on a real device —
 * is explicitly [H] and stays [H]. **Nothing in this file has rendered a pixel**
 * and none of it should be read as visual verification.
 *
 * The point of the round is one sentence: *a suggestion is a coverage claim.*
 * So the assertions that matter most are the ones proving the screen cannot
 * make one on its own — no composed text, no fallback list, no re-derived scope.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments, findTags, attributeValue } from '../../tests/lib/jsx.mjs';
import { functionBodyOrNull as functionBody } from '../../tests/lib/density.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const read = (rel) => blankComments(readFileSync(join(APP, rel), 'utf8').replace(/\r\n/g, '\n'));

const CHAT = read('screens/ChatScreen.tsx');
const EMPTY = functionBody(CHAT, 'EmptyAsk');

test('assumption check: EmptyAsk parses, so every check below reads real source', () => {
  assert.ok(EMPTY && EMPTY.length > 800, `EmptyAsk parsed to ${EMPTY?.length} chars`);
  assert.match(EMPTY, /s\.emptyTitle/, 'assumption check: this is not the empty state');
  assert.match(EMPTY, /s\.starters\b/, 'assumption check: the chip block is not in this body');
});

// ---------------------------------------------------------------------------
// AC 1 — the chips come from the corpus, and the taxonomy is unreachable
// ---------------------------------------------------------------------------

test('AC 1: chips are sourced from requestUnitSuggestions, not from startersFor', () => {
  assert.match(EMPTY, /requestUnitSuggestions\(documentIds, controller\.signal\)/,
    'the empty state does not ask the corpus what it can answer');
  assert.doesNotMatch(CHAT, /startersFor|classifyEquipment|BY_CLASS/,
    'the class taxonomy is still reachable from this screen');
  // And the import is gone, not merely unused — `npm run build` catches a
  // survivor, but a stale import is the shape the mistake takes first.
  assert.doesNotMatch(CHAT, /import \{[^}]*startersFor/);
});

test('AC 1: the lookup is keyed on the scope, so it re-asks when the unit changes', () => {
  assert.match(EMPTY, /const scopeKey = \(documentIds \?\? \[\]\)\.join\(','\);/);
  assert.match(EMPTY, /\}, \[scopeKey\]\);/, 'the effect does not depend on the scope');
  // In-flight results from a previous scope must not land on the new unit.
  assert.match(EMPTY, /if \(!live\) return;/, 'a stale response can still be applied');
  assert.match(EMPTY, /controller\.abort\(\);/, 'the previous lookup is not aborted');
});

// ---------------------------------------------------------------------------
// AC 2 — the empty state is designed, and the heading cannot outlive the list
// ---------------------------------------------------------------------------

test('AC 2: no chips and no heading when there is nothing to offer', () => {
  // The heading is *inside* the guard, not above it. An empty "Common on this
  // unit" is worse than an absent one, and the only way to guarantee it cannot
  // be drawn alone is for it to live inside the same conditional as the list.
  const guard = /\{suggestions\.length > 0 && \(([\s\S]*?)\n {6}\)\}/.exec(EMPTY);
  assert.ok(guard, 'the chip block is not guarded on there being suggestions');
  assert.match(guard[1], /Common on this unit/, 'the heading is outside the guard that hides the chips');
  assert.match(guard[1], /suggestions\.map/);
  // Nothing else in the component draws that heading.
  assert.equal([...EMPTY.matchAll(/Common on this unit/g)].length, 1);
});

test('AC 2: in their place, the statement composed from the unit\'s own verdict', () => {
  assert.match(EMPTY, /const statement = coverageStatement\(coverage\?\.docs\.length \?\? 0, coverage\?\.types \?\? \[\]\);/);
  assert.match(EMPTY, /const nothingToSuggest = !looking && suggestions\.length === 0;/);
  assert.match(EMPTY, /\{nothingToSuggest && statement !== '' && \(/,
    'the coverage statement is not gated on there being nothing to suggest and something to say');
  assert.match(EMPTY, /\{statement\}/);
  assert.match(EMPTY, /\{NOTHING_TO_SUGGEST_INVITATION\}/, 'the empty state ends without the invitation');
});

test('AC 2: the statement is composed from columns, not from a sentence written here', () => {
  // `coverageStatement` is a pure function over (count, docTypes) and is unit
  // tested in `lib/starters.test.mjs`. What is asserted here is that the screen
  // does not compose an alternative beside it.
  const block = /\{nothingToSuggest && statement !== '' && \(([\s\S]*?)\n {10}\)\}/.exec(EMPTY);
  assert.ok(block, 'the empty-state block did not parse');
  const literals = [...block[1].matchAll(/>([^<>{}]*[A-Za-z]{4}[^<>{}]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(literals, [], `the empty state hardcodes copy: ${literals.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// AC 3 — nothing is disabled because a list came back empty
// ---------------------------------------------------------------------------

test('AC 3: neither door, the change-unit control nor the composer depends on the list', () => {
  // Checked as an absence of coupling rather than as a presence of controls: the
  // failure being forbidden is a screen that quietly gates a capability on a
  // lookup nobody can retry.
  // Each control lives inside exactly one render guard, and that guard is about
  // the unit — never about the lookup. Checked by naming the guard rather than
  // by scanning a window, so the assertion says what it means.
  const doors = /\{!equipment && \(([\s\S]*?)\n {6}\)\}/.exec(EMPTY);
  assert.ok(doors, 'the two front doors are no longer guarded on `!equipment` alone');
  assert.match(doors[1], /onIdentify\('camera'\)/, 'the camera door is gone');
  assert.match(doors[1], /onIdentify\('manual'\)/, 'manual entry is gone — the only offline route');
  assert.doesNotMatch(doors[1], /suggestions|looking|nothingToSuggest/);

  const card = /\{equipment && \(([\s\S]*?)\n {6}\)\}/.exec(EMPTY);
  assert.ok(card, 'the unit card is no longer guarded on `equipment` alone');
  assert.match(card[1], /accessibilityLabel=\{`Change the unit/, 'the change-unit control is gone');
  // The card *contains* the empty-state block, so `nothingToSuggest` appears in
  // it legitimately — what must not appear is a gate on the change-unit control
  // itself. Asserted on that control's own guard chain.
  const change = card[1].indexOf('onPress={() => onIdentify(\'manual\')}');
  assert.ok(change > 0);
  assert.doesNotMatch(card[1].slice(0, change), /suggestions|looking|nothingToSuggest/,
    'the change-unit control is gated on the suggestion lookup');
  // The composer lives on ChatScreen, outside EmptyAsk entirely, and neither it
  // nor anything else in that body may have learned about the lookup — the
  // suggestion state is EmptyAsk's alone.
  const screen = functionBody(CHAT, 'ChatScreen');
  assert.ok(screen && screen.includes('style={s.composer}'), 'the composer is not in the ChatScreen body');
  // Identifier-shaped, not word-shaped: existing copy on this screen legitimately
  // contains the word "looking" ("say what I'm looking at").
  assert.doesNotMatch(screen, /\bsuggestions\b|\bnothingToSuggest\b|\bsetLooking\b|\{looking|looking &&/,
    'ChatScreen itself now reads the suggestion state, so the composer can be gated on it');
});

// ---------------------------------------------------------------------------
// AC 4 / AC 5 — loading draws nothing; a failure is the empty state, not a card
// ---------------------------------------------------------------------------

test('AC 4: while looking, the chip area draws nothing at all', () => {
  // `looking` starts true and both branches are false while it holds, so there
  // is no third thing to draw. A skeleton would be a shape promising a chip that
  // may never come, which on this screen is the exact defect being fixed.
  assert.match(EMPTY, /useState\(true\)/, 'the looking state does not start true');
  assert.doesNotMatch(EMPTY, /Skeleton|ActivityIndicator|placeholder/i,
    'the chip area draws a loading affordance');
  // Neither branch can render while `looking` is true: the chips need a
  // non-empty list (cleared on every new lookup) and the statement needs
  // `!looking`.
  assert.match(EMPTY, /setSuggestions\(\[\]\);/, 'the previous unit\'s chips survive into a new lookup');
});

test('AC 5: a failed lookup renders the empty state — there is no error path here', () => {
  assert.doesNotMatch(EMPTY, /ErrorState|InlineNotice|setError|catch\b/,
    'the empty state renders a failure the technician cannot act on');
  // The guarantee is upstream: `requestUnitSuggestions` resolves to [] for every
  // failure it has, so there is nothing here to catch. Asserted at the source.
  const client = read('lib/diagnose.ts');
  const fn = functionBody(client, 'requestUnitSuggestions');
  assert.ok(fn, 'requestUnitSuggestions is gone');
  assert.doesNotMatch(fn, /throw\b/, 'the suggestion lookup can throw at the screen');
  assert.match(fn, /if \(!BASE \|\| !documentIds\?\.length\) return \[\];/);
});

// ---------------------------------------------------------------------------
// AC 6 — no suggestion text is composed client-side
// ---------------------------------------------------------------------------

test('AC 6: the chip renders the server\'s text, whole', () => {
  assert.match(EMPTY, /<Text style=\{s\.starterText\}>\{sug\.text\}<\/Text>/,
    'the chip label is composed rather than rendered');
  // No symptom or manufacturer string anywhere in the screen. The old file's
  // "High head pressure" / "Precedent" literals are the shape being forbidden.
  for (const re of [
    /Trane|Carrier|Precedent|Goodman|Bosch|48\/50/i,
    /head pressure|short cycl|suction pressure|reversing valve|economizer/i,
  ]) {
    assert.doesNotMatch(CHAT, re, `ChatScreen hardcodes a symptom or unit matching ${re}`);
  }
});

// ---------------------------------------------------------------------------
// AC 7 — a real target, a label, and the session's own scope
// ---------------------------------------------------------------------------

test('AC 7: every chip is labelled and clears the 48dp floor', () => {
  const chip = findTags(EMPTY, ['ScalePressable']).find((t) => /s\.starter\b/.test(t.source));
  assert.ok(chip, 'the suggestion chip is gone');
  assert.equal(attributeValue(chip.source, 'accessibilityRole'), 'button');
  assert.match(chip.source, /accessibilityLabel=\{`Ask about: \$\{sug\.text\}`\}/,
    'the chip label does not name the question it would ask');

  const rule = /\n {2}starter:\s*\{([\s\S]*?)\n {2}\}/.exec(CHAT);
  assert.ok(rule, 'no starter style rule');
  assert.match(rule[1], /minHeight:\s*MIN_TOUCH/, 'the chip is under the 48dp floor');
});

test('AC 7: a tapped chip sends the session\'s documentIds verbatim, never re-derived', () => {
  // The chip hands back only the text. Scope comes from the screen's own prop,
  // through `send` → `answerExisting`, which is the same array the composer uses.
  assert.match(EMPTY, /onPress=\{\(\) => onPick\(sug\.text\)\}/);
  assert.match(CHAT, /onPick=\{\(sug\) => send\(sug\)\}/);
  assert.match(CHAT, /sid, seq \+ 1, body, equipment, documentIds, controller\.signal/,
    'the answer no longer sends the session scope verbatim');
  // And the chip carries no scope of its own to be tempted by.
  assert.doesNotMatch(EMPTY, /onPick\([^)]*documentId/, 'the chip re-derives the retrieval scope');
});

// ---------------------------------------------------------------------------
// The design system, and the states this screen already had
// ---------------------------------------------------------------------------

test('every colour the empty state adds is a token, and the matrix covers it', async () => {
  const { evaluateMatrix, coverageGaps } = await import('../../tests/lib/contrastMatrix.mjs');
  const tokens = readFileSync(join(APP, 'theme/tokens.ts'), 'utf8');
  assert.deepEqual([...CHAT.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
  assert.deepEqual(evaluateMatrix(tokens).failures, []);
  const { gaps } = coverageGaps([{ file: 'app/screens/ChatScreen.tsx', source: CHAT }]);
  assert.deepEqual(gaps.filter((g) => !/stale/.test(g)), [], gaps.join('\n'));
});

test('CoverageLine is untouched — its three verdicts are still the ones fenced', () => {
  const line = functionBody(CHAT, 'CoverageLine');
  assert.match(line, /Coverage not checked for this one/);
  assert.match(line, /manuals for this unit/);
  assert.match(line, /No documentation for this unit/);
});

test('the guest disclosure is still gated on auth and the shared flag only', () => {
  // ST-F03 AC 1/2, re-asserted here because this story edits the same screen and
  // adds a second piece of state to it. A `looking`-shaped gate creeping onto the
  // disclosure would be the regression.
  const notice = CHAT.indexOf('<GuestNotice');
  const preamble = CHAT.slice(Math.max(0, notice - 200), notice);
  assert.match(preamble, /!signedIn &&/);
  assert.match(preamble, /!noticeDismissed/);
  assert.doesNotMatch(preamble, /messages\b|suggestions|looking/);
});
