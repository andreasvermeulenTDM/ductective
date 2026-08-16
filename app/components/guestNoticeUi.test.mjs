/**
 * ST-R02 — the guest notice's dismiss affordance is a glyph with a real target,
 * and the dismissal *rule* did not move an inch to get it.
 *
 *   npm test
 *
 * There is **no component test runner in this repo** — no React Testing Library,
 * no react-test-renderer, no jest — and round 4 does not add one, for the reason
 * `messageUi.test.mjs` and `citationUi.test.mjs` already give. So the structural
 * criteria are asserted by reading the source, and AC 10 (a gloved tap on a real
 * phone) stays [H] rather than being dressed up as passing here.
 *
 * The half worth reading twice is the last section. ST-R02 changes an affordance
 * inside a safety-adjacent disclosure, and the risk of that change is not that
 * the X fails to draw — it is that somebody makes the notice easier to clear by
 * also making it easier to *skip*. So the checks below assert the rule from both
 * ends: the guard is still `{onDismiss && …}`, and `lib/guestNotice.ts` — which
 * owns "an answer has to have been delivered first" — is not referenced,
 * re-implemented or shadowed anywhere in this component.
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

// `core.autocrlf` is on, so the working tree is CRLF and a pattern anchored on a
// bare \n silently matches nothing. Normalised once, here.
const read = (rel) => readFileSync(join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (rel) => blankComments(read(rel));

const CHROME = code('components/Chrome.tsx');
const NOTICE = functionBody(CHROME, 'GuestNotice');

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

test('assumption check: the GuestNotice body parses, so every check below reads it', () => {
  // The lesson from tests/suites/e5-safety.mjs, which spent a round asserting
  // against 29 characters of a destructured parameter list and passing every
  // time. A structural check that cannot fail is worse than no check.
  assert.ok(NOTICE, 'GuestNotice did not parse');
  assert.ok(NOTICE.length > 300, `GuestNotice parsed to only ${NOTICE?.length} chars — suspect the walker`);
  assert.match(NOTICE, /GUEST_DISCLOSURE\.body/, 'assumption check: this is not the notice');
});

// ---------------------------------------------------------------------------
// AC 1 — a conventional dismiss mark, drawn by the dependency already here
// ---------------------------------------------------------------------------

test('AC 1: the dismiss control is an Ionicons glyph inside a Pressable', () => {
  assert.match(NOTICE, /<Ionicons\s+name="close"/, 'the dismiss mark is not the conventional close glyph');

  // And it is inside the control, not floating beside it: the glyph must appear
  // between the Pressable's opening tag and its close.
  const open = NOTICE.indexOf('<Pressable');
  const glyph = NOTICE.indexOf('<Ionicons name="close"');
  const close = NOTICE.indexOf('</Pressable>', open);
  assert.ok(open >= 0 && glyph > open && glyph < close, 'the close glyph is not inside the dismiss Pressable');
});

test('AC 1: no new dependency — Ionicons was already imported by this file', () => {
  // Brief hard constraint 5. The import has to be the shared one, not a new
  // package pulled in for a single mark.
  assert.match(CHROME, /import \{ Ionicons \} from '@expo\/vector-icons';/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@expo/vector-icons'], '@expo/vector-icons is not a declared dependency');

  // And it is the *only* glyph source this component imports from, so the mark
  // cannot have arrived via a second icon package pulled in beside it.
  const imports = [...CHROME.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  const glyphSources = imports.filter((m) => /icon|vector|svg/i.test(m));
  assert.deepEqual(glyphSources, ['@expo/vector-icons']);
});

test('AC 1: the word that used to be the control is no longer drawn', () => {
  // The defect the owner reported: a text label in a header of text reads as
  // more text. `GUEST_DISCLOSURE.dismiss` still exists as a constant (AC 9) —
  // it is simply not rendered.
  assert.doesNotMatch(NOTICE, /GUEST_DISCLOSURE\.dismiss\b(?!Label)/, 'the dismiss word is still rendered as the control');
  assert.doesNotMatch(NOTICE, /guestDismissText/, 'the text style for the old control is still applied');
  assert.equal(styleRule(CHROME, 'guestDismissText'), null, 'the dead text style is still in the StyleSheet');
});

// ---------------------------------------------------------------------------
// AC 2 — 48dp of real layout, on both platforms
// ---------------------------------------------------------------------------

test('AC 2: the target reaches MIN_TOUCH as layout, not as hitSlop alone', () => {
  // react-native-web does not implement hitSlop, so a slop-only target is 22dp
  // on the platform this is most often reviewed on. The rule is documented at
  // Citation.tsx `chipTouch` and it is the reason both are present here.
  const rule = styleRule(CHROME, 'guestDismiss');
  assert.ok(rule, 'no guestDismiss style rule');
  assert.match(rule, /minHeight:\s*MIN_TOUCH/);
  assert.match(rule, /minWidth:\s*MIN_TOUCH/);
  assert.match(NOTICE, /hitSlop=\{touchSlop\(GLYPH\)\}/, 'the native hit target is not grown from the glyph size');

  // The slop is computed from the same constant the glyph is drawn at. Two
  // literals would drift, and the drift is invisible: the control still works,
  // it is just under the floor on one platform.
  assert.match(CHROME, /const GLYPH = (\d+);/);
  const glyph = Number(/const GLYPH = (\d+);/.exec(CHROME)[1]);
  assert.ok(glyph > 0 && glyph < 48, `GLYPH is ${glyph} — outside the range touchSlop compensates for`);
  assert.match(NOTICE, new RegExp(`size=\\{GLYPH\\}`), 'the glyph is drawn at a literal rather than at GLYPH');
});

// ---------------------------------------------------------------------------
// AC 3 — a bare glyph is unusable without a label
// ---------------------------------------------------------------------------

test('AC 3: it is a labelled button, and the label names what is dismissed', () => {
  const tags = findTags(NOTICE, ['Pressable']);
  const dismiss = tags.find((t) => /accessibilityLabel=\{GUEST_DISCLOSURE\.dismissLabel\}/.test(t.source));
  assert.ok(dismiss, 'the dismiss control does not carry the disclosure dismiss label');
  assert.equal(attributeValue(dismiss.source, 'accessibilityRole'), 'button');

  // And the label says what goes away, not just "close". A screen-reader user
  // arriving on a bare X has no other way to know what it clears.
  const copy = read('lib/accountCopy.ts');
  const label = /dismissLabel:\s*'([^']*)'/.exec(copy);
  assert.ok(label, 'dismissLabel is gone from accountCopy.ts');
  assert.match(label[1], /notice|disclosure/i, `"${label[1]}" does not name what is dismissed`);
});

// ---------------------------------------------------------------------------
// AC 4 — it sits at the trailing edge, away from the red-glyph/heading cluster
// ---------------------------------------------------------------------------

test('AC 4: the heading takes the slack between the offline glyph and the control', () => {
  // Structural, because "does not read as part of the cluster" is a layout
  // claim: the header is [offline glyph][heading flex:1][dismiss], so the
  // heading's flex is what pushes the control to the trailing edge.
  const head = NOTICE.indexOf('style={s.guestHead}');
  const offline = NOTICE.indexOf('cloud-offline-outline');
  const label = NOTICE.indexOf('s.guestLabel');
  const dismiss = NOTICE.indexOf('onDismiss && (');
  assert.ok(head >= 0 && offline > head && label > offline && dismiss > label,
    'the header order is no longer glyph → heading → dismiss');

  assert.match(styleRule(CHROME, 'guestLabel'), /flex:\s*1/, 'the heading no longer takes the slack');
  assert.match(styleRule(CHROME, 'guestHead'), /flexDirection:\s*'row'/);
});

// ---------------------------------------------------------------------------
// AC 5 — a token, measured, and specifically not the refusal palette
// ---------------------------------------------------------------------------

test('AC 5: the glyph takes a token, and not a refusal role', () => {
  const glyphTag = /<Ionicons name="close"[^/]*\/>/.exec(NOTICE);
  assert.ok(glyphTag, 'the close glyph is gone');
  assert.match(glyphTag[0], /color=\{color\.\w+\}/, 'the glyph colour is not a semantic role');
  assert.doesNotMatch(glyphTag[0], /color\.refusal/,
    'the dismiss mark borrows the refusal palette — red here reads as "this is the danger", not "this closes it"');
  // E6.8: no hex outside tokens.ts, checked over the whole component.
  assert.deepEqual([...CHROME.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
});

test('AC 5: the pairing the glyph draws is measured in the contrast matrix, and green', async () => {
  const { TEXT_PAIRS, evaluateMatrix } = await import('../../tests/lib/contrastMatrix.mjs');
  const tokens = readFileSync(join(APP, 'theme/tokens.ts'), 'utf8');

  const glyphTag = /<Ionicons name="close"[^/]*\/>/.exec(NOTICE);
  const role = /color\.(\w+)/.exec(glyphTag[0])[1];

  const row = TEXT_PAIRS.find((p) => p.fg === role && p.on.length === 1 && p.on[0] === 'refusalSurface');
  assert.ok(row, `no matrix row measures color.${role} on the notice surface`);
  assert.deepEqual(evaluateMatrix(tokens).failures, [], 'the matrix is not green');
});

// ---------------------------------------------------------------------------
// AC 6 / AC 7 — the rule. This is the part that must not have moved.
// ---------------------------------------------------------------------------

test('AC 6: the control still does not exist before an answer — absent, not disabled', () => {
  const guard = /\{onDismiss && \([\s\S]{0,700}?<Pressable/.exec(NOTICE);
  assert.ok(guard, 'the dismiss Pressable is not inside an {onDismiss && …} guard');
  assert.doesNotMatch(NOTICE, /disabled=/, 'a disabled dismiss control is not the design');
  assert.doesNotMatch(NOTICE, /opacity/i, 'a greyed-out dismiss control is not the design either');
  // `onDismiss` stays optional: the *type* is half of why the control can be
  // absent at all, and a required prop would make the guard decorative.
  assert.match(CHROME, /onDismiss\?:\s*\(\)\s*=>\s*void;/);
});

test('AC 6: guestNotice.ts is untouched by this component — the rule lives there and only there', () => {
  // The failure mode this guards is not "the X does not draw". It is somebody
  // making the notice easier to clear by also making it easier to skip.
  assert.doesNotMatch(CHROME, /guestNotice|canDismiss|answersSeen/,
    'Chrome.tsx now reaches into the dismissal rule instead of taking a callback');
  const rule = read('lib/guestNotice.ts');
  assert.match(rule, /export function canDismiss/, 'canDismiss is gone from lib/guestNotice.ts');
  assert.match(rule, /export function dismiss/, 'dismiss is gone from lib/guestNotice.ts');
});

test('AC 8: nothing about the new control reads as a way past a refusal', () => {
  // The exact patterns tests/suites/e5-safety.mjs greps every app source for.
  // A dismiss control is precisely where one would appear by accident.
  const BYPASS_PATTERNS = [
    /show\s+me\s+anyway/i,
    /continue\s+anyway/i,
    /proceed\s+anyway/i,
    /i\s+understand\s+the\s+risks?/i,
    /override\s+(the\s+)?(safety|refusal|warning)/i,
    /dismiss\s+(the\s+)?refusal/i,
    /skip\s+(the\s+)?(safety|warning)/i,
  ];
  for (const [what, src] of [['Chrome.tsx', CHROME], ['accountCopy.ts', code('lib/accountCopy.ts')]]) {
    for (const p of BYPASS_PATTERNS) assert.doesNotMatch(src, p, `${what} matches ${p}`);
  }
});

test('AC 9: the disclosure copy is untouched — a new affordance is not a licence to soften it', () => {
  const copy = read('lib/accountCopy.ts');
  assert.match(copy, /label: 'NOTHING HERE IS BEING SAVED',/);
  assert.match(copy, /Close the app and it is gone/);
  assert.match(copy, /action: 'Sign in or create an account',/);
  // Still declared, still frozen, simply no longer drawn.
  assert.match(copy, /dismiss: 'Got it',/);
  assert.match(copy, /dismissLabel: 'Dismiss the not-saved notice',/);
});
