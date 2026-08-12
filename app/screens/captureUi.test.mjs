/**
 * ST-F11 — the type-ahead on manual unit entry, checked the way this repo checks
 * screens.
 *
 *   npm test
 *
 * No component test runner exists here — no React Testing Library, no
 * react-test-renderer, no jest — and this run does not add one, for the reasons
 * `accountUi.test.mjs` and `citationUi.test.mjs` both set out. So the structure
 * the criteria name is asserted by reading the source, and what needs a rendered
 * tree stays [H]: that the list is readable in sunlight at 200% font scale, that
 * a gloved tap lands on the right row, and that `48` → `48L` → `48LC` narrows on
 * a real corpus (ST-F11 AC 8).
 *
 * The behavioural half already runs and is not duplicated here: `suggest.test.mjs`
 * owns the wire contract, the parser and every failure resolving to `[]`.
 *
 * The assertions that matter most are AC 5, AC 6 and AC 7 — the three that keep a
 * coverage claim honest. A suggestion tells the technician the corpus can answer
 * on that unit, so a list that outlived its source, an error card standing in for
 * an empty list, or a confirm button that stopped working when the server did
 * would each be worse than having built nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments, findTags, attributeValue } from '../../tests/lib/jsx.mjs';
import { MIN_QUERY_CHARS, SUGGEST_DEBOUNCE_MS } from '../lib/suggest.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// core.autocrlf is on, so anchor patterns on a normalised copy.
const read = (rel) =>
  blankComments(readFileSync(join(HERE, rel), 'utf8').replace(/\r\n/g, '\n'));

const SRC = read('CaptureScreen.tsx');

/** The named function's source, braces balanced, parameter list skipped. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  let paren = 0;
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (paren > 0) continue;
    else if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return source.slice(start, i + 1); }
  }
  return source.slice(start);
}

// ---------------------------------------------------------------------------
// AC 1 — the list is under the field, and it comes from the server
// ---------------------------------------------------------------------------

test('AC 1: the suggestion list renders under the model field, in the manual branch', () => {
  const input = SRC.indexOf('accessibilityLabel="Unit model number"');
  const list = SRC.indexOf('<SuggestionList');
  const actions = SRC.indexOf('<View style={s.actions}>', input);
  assert.ok(input > 0, 'the manual-entry field is gone');
  assert.ok(list > 0, 'no suggestion list is rendered');
  assert.ok(input < list, 'the list renders above the field it belongs to');
  assert.ok(list < actions, 'the list renders below the confirm action rather than under the field');
});

test('AC 1: it is populated from POST /suggest-units, through the one client that exists', () => {
  assert.match(SRC, /requestSuggestUnits\(/, 'the screen does not call the suggest client');
  // No second fetch, and no import of the server-side matcher into the app —
  // both are 03-backend-fixes.md §7's explicit instructions, and either would be
  // a second definition of "covered".
  assert.doesNotMatch(SRC, /fetch\(/, 'the screen fetches directly instead of using requestSuggestUnits');
  assert.doesNotMatch(SRC, /lib\/units\.mjs|from '\.\.\/\.\.\/lib/, 'the screen imports server-side matching');
});

// ---------------------------------------------------------------------------
// AC 2 — debounced, aborted, and using the module's own constants
// ---------------------------------------------------------------------------

test('AC 2: the debounce and the minimum are the exported constants, not new literals', () => {
  assert.match(SRC, /SUGGEST_DEBOUNCE_MS/, 'the debounce is not the exported constant');
  assert.match(SRC, /worthSuggesting\(/, 'the minimum query length is not the exported rule');
  // A re-declared 250 or 3 would be a second copy of a rule that already has one
  // place to live (`units.mjs`'s MIN_PREFIX is mirrored by MIN_QUERY_CHARS).
  assert.doesNotMatch(SRC, /setTimeout\([^)]*,\s*\d+\s*\)/, 'a numeric debounce literal is back');
  assert.doesNotMatch(SRC, /trim\(\)\.length\s*[<>]=?\s*\d/, 'a numeric query-length floor is back');
  assert.equal(SUGGEST_DEBOUNCE_MS, 250);
  assert.equal(MIN_QUERY_CHARS, 3);
});

test('AC 2: the in-flight request is aborted when the query changes', () => {
  const effect = /useEffect\(\(\) => \{\n\s*if \(state !== 'manual'\)([\s\S]*?)\n {2}\}, \[model, state\]\);/.exec(SRC);
  assert.ok(effect, 'the suggest effect is gone, or no longer keyed on the query');
  assert.match(effect[1], /new AbortController\(\)/, 'no AbortController on the suggest path');
  assert.match(effect[1], /clearTimeout\(timer\)/, 'the pending debounce is not cancelled');
  assert.match(effect[1], /controller\.abort\(\)/, 'the in-flight request is not aborted');
  assert.match(effect[1], /controller\.signal\.aborted/, 'a stale response can still overwrite a newer one');
});

// ---------------------------------------------------------------------------
// AC 3 — a tapped suggestion and typed text produce the same scope
// ---------------------------------------------------------------------------

test('AC 3: choosing a suggestion sets the field and carries documentIds verbatim', () => {
  const choose = functionBody(SRC, 'chooseSuggestion');
  assert.ok(choose, 'chooseSuggestion is missing');
  assert.match(choose, /setModel\(suggestion\.label\)/, 'the field is not set from the suggestion');
  assert.match(choose, /documentIds: suggestion\.documentIds/, 'the scope is not the server\'s array');
});

test('AC 3: it does not re-derive scope — no second resolve, no reshaping of the array', () => {
  const choose = functionBody(SRC, 'chooseSuggestion');
  assert.doesNotMatch(choose, /requestResolveUnit/, 'the scope is re-resolved, so the two paths can disagree');
  assert.doesNotMatch(
    choose,
    /documentIds[^,]*\.(slice|filter|map|sort|concat)/,
    'the scope array is reshaped on the way through'
  );
  assert.doesNotMatch(choose, /splitUnitText/, 'the label is re-parsed instead of being taken as sent');
});

test('AC 3: the typed path is untouched — it still resolves coverage the way it did', () => {
  const typed = functionBody(SRC, 'confirmTyped');
  assert.match(typed, /requestResolveUnit\(manufacturer, modelPart\)/);
  assert.match(typed, /documentIds: verdict\?\.documentIds \?\? null/);
});

// ---------------------------------------------------------------------------
// AC 4 — reachable, tappable, and announced
// ---------------------------------------------------------------------------

test('AC 4: every suggestion row clears the 48dp floor', () => {
  const rule = /\n {2}suggestion:\s*\{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(rule, 'no suggestion row style');
  assert.match(rule[1], /minHeight: MIN_TOUCH/, 'a suggestion row can be smaller than the touch floor');
});

test('AC 4: every row is a labelled button naming manufacturer and family', () => {
  const list = functionBody(SRC, 'SuggestionList');
  const [row] = findTags(list, ['Pressable']);
  assert.ok(row, 'the suggestion row is not a Pressable, so it is not reachable as a control');
  assert.equal(attributeValue(row.source, 'accessibilityRole'), 'button');
  const label = attributeValue(row.source, 'accessibilityLabel');
  assert.ok(label, 'a suggestion row has no accessibility label');
  assert.match(label, /suggestion\.manufacturer/, 'the label does not name the manufacturer');
  assert.match(label, /suggestion\.family/, 'the label does not name the family');
});

test('AC 4: the keyboard does not eat the first tap', () => {
  // Without keyboardShouldPersistTaps the tap that lands while the keyboard is up
  // only dismisses it, and the list reads as broken.
  const manual = SRC.slice(SRC.indexOf("if (state === 'manual')"));
  const [scroll] = findTags(manual, ['ScrollView']);
  assert.equal(attributeValue(scroll.source, 'keyboardShouldPersistTaps'), 'handled');
});

// ---------------------------------------------------------------------------
// AC 5 — free typing is never blocked
// ---------------------------------------------------------------------------

test('AC 5: the confirm button\'s disabled state does not depend on the suggestion list', () => {
  const manual = SRC.slice(SRC.indexOf("if (state === 'manual')"));
  const confirm = findTags(manual, ['Pressable'])
    .map((t) => t.source)
    .find((t) => /accessibilityLabel="Use this model and continue"/.test(t));
  assert.ok(confirm, 'the confirm button is gone');
  const disabled = attributeValue(confirm, 'disabled');
  assert.equal(disabled, '!model.trim() || resolving', 'the confirm button now depends on something new');
  assert.doesNotMatch(disabled, /suggest/i, 'the confirm button depends on the suggestion list');
});

test('AC 5: the field itself is unchanged — nothing gates typing on a lookup', () => {
  const [input] = findTags(SRC, ['TextInput']);
  assert.match(input.source, /onChangeText=\{setModel\}/, 'typing no longer sets the value directly');
  assert.doesNotMatch(input.source, /editable=/, 'the field can now be made read-only');
  assert.equal(attributeValue(input.source, 'accessibilityLabel'), 'Unit model number');
});

// ---------------------------------------------------------------------------
// AC 6 — a failed lookup renders nothing at all
// ---------------------------------------------------------------------------

test('AC 6: with no suggestions and nothing in flight, the list renders null', () => {
  const list = functionBody(SRC, 'SuggestionList');
  assert.match(
    list,
    /if \(suggestions\.length === 0\) \{\n\s*return loading \? [\s\S]*? : null;/,
    'the empty case does not render nothing'
  );
});

test('AC 6: there is no error state on the suggest path — nothing to catch, nothing to dismiss', () => {
  // `requestSuggestUnits` resolves `[]` for every failure there is, so an error
  // branch here could only be dead code that looked like a promise to the reader.
  const effect = /useEffect\(\(\) => \{\n\s*if \(state !== 'manual'\)([\s\S]*?)\n {2}\}, \[model, state\]\);/.exec(SRC);
  assert.doesNotMatch(effect[1], /catch|setFailure|setError|OfflineState|ErrorState/);
  const list = functionBody(SRC, 'SuggestionList');
  assert.doesNotMatch(list, /errorCard|ErrorState|Try again|retry/i, 'the empty list offers a retry');
  assert.doesNotMatch(list, /no matches|nothing found|couldn't find/i, 'the empty list says something reassuring');
});

test('AC 6: the loading line promises a lookup, not a result', () => {
  const list = functionBody(SRC, 'SuggestionList');
  const hint = /<Text style=\{s\.suggestHint\}>([^<]*)<\/Text>/.exec(list);
  assert.ok(hint, 'the in-flight line is gone');
  assert.doesNotMatch(hint[1], /found|matches|results/i, 'the in-flight line implies a match is coming');
  // And it is only ever the fallback for an empty list, so a visible list does not
  // blink out under a finger while the next lookup runs.
  assert.match(list, /return loading \?/);
});

// ---------------------------------------------------------------------------
// AC 7 — nothing about the corpus is written in this file
// ---------------------------------------------------------------------------

test('AC 7: no manufacturer or family string is invented client-side', () => {
  // The 14 manufacturers in the corpus. If one of these ever appears in this
  // screen outside the placeholder, the app has begun describing the corpus in a
  // second place — the exact staleness ST-F10 AC 3 forbids on the server.
  const MAKERS = [
    'Trane', 'Carrier', 'Lennox', 'York', 'Daikin', 'Rheem', 'Goodman', 'Amana',
    'Bosch', 'Mitsubishi', 'AAON', 'Nortek', 'Johnson Controls', 'Bard',
  ];
  // The placeholder is the one deliberate exception and predates this story: it
  // is an example of *how to type*, not a claim about coverage. Pinned by exact
  // text so it cannot quietly grow into a list.
  const placeholder = 'placeholder="e.g. Trane YSC072E3 or Carrier 50HC"';
  assert.ok(SRC.includes(placeholder), 'the field placeholder changed — re-check the exemption below');
  const withoutPlaceholder = SRC.replace(placeholder, '');
  for (const maker of MAKERS) {
    assert.doesNotMatch(
      withoutPlaceholder,
      new RegExp(`\\b${maker}\\b`),
      `${maker} is written into CaptureScreen.tsx — the corpus is being described in a second place`
    );
  }
});

test('AC 7: the row renders the server\'s label, and does not compose one', () => {
  const list = functionBody(SRC, 'SuggestionList');
  const drawn = [...list.matchAll(/<Text style=\{s\.suggestionText\}>([\s\S]*?)<\/Text>/g)].map((m) => m[1]);
  assert.deepEqual(drawn, ['{suggestion.label}'], 'the row draws something other than the label as sent');
});

test('E6.8: no hex reaches this screen', () => {
  assert.deepEqual([...SRC.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
});
