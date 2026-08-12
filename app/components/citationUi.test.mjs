/**
 * ST-F14 — the whole-page view, checked the way this repo checks screens.
 *
 *   npm test
 *
 * There is **no component test runner in this repo** — no React Testing Library,
 * no react-test-renderer, no jest — and this run does not add one. So the
 * structural criteria are asserted by reading the source, exactly as
 * `accountUi.test.mjs` and `tests/suites/e6-app.mjs` already do, and the criteria
 * that need a rendered tree stay marked [H] rather than being dressed up as
 * passing here. What cannot be proven from source: that the expansion is legible
 * on a phone, that the cited block is findable at a glance, and that the link
 * opens. Those are ST-F14 AC 10.
 *
 * The behavioural half — the queries, the null paths, the cited-block flag — is
 * `app/lib/pageText.test.mjs`, and it runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments } from '../../tests/lib/jsx.mjs';
import { PAGE_TEXT_COPY } from '../lib/citations.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = blankComments(readFileSync(join(HERE, 'Citation.tsx'), 'utf8'));

// ---------------------------------------------------------------------------
// AC 1 — the snippet keeps its place; the page goes below it
// ---------------------------------------------------------------------------

test('AC 1: the whole-page control sits below the FROM THE PAGE snippet, not instead of it', () => {
  const snippet = SRC.indexOf('FROM THE PAGE');
  const whole = SRC.indexOf('<WholePage');
  assert.ok(snippet > 0, 'the stored snippet is gone');
  assert.ok(whole > 0, 'no whole-page view is rendered');
  assert.ok(snippet < whole, 'the page text was placed above the passage the claim rests on');
  // The snippet block itself is untouched: it is still the retrieved chunk, with
  // its own provenance line.
  assert.match(SRC, /citation\.snippet \?/);
  assert.match(SRC, /snippetProvenance/);
});

test('AC 1: it is collapsed by default, so the sheet still opens on the evidence', () => {
  assert.match(SRC, /const \[open, setOpen\] = useState\(false\)/);
});

// ---------------------------------------------------------------------------
// AC 2 — blocks in order, with the cited one marked in place
// ---------------------------------------------------------------------------

test('AC 2: the cited block is marked, using existing tokens only', () => {
  assert.match(SRC, /block\.cited && s\.pageBlockCited/, 'the cited block is not marked');
  const rule = /pageBlockCited:\s*\{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(rule, 'no pageBlockCited style');
  assert.match(rule[1], /color\.accentSurface/);
  assert.match(rule[1], /color\.accentBorder/);
  // E6.8: no hex outside the token module, in this file or in the new copy.
  assert.deepEqual([...SRC.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]), []);
});

test('AC 2: blocks render in the order the fetch returned them', () => {
  // `fetchPageText` orders by `chunk_index`, which is the page's reading order.
  // The component must not re-sort or filter, or the marked block ends up in the
  // wrong place on the page.
  assert.match(SRC, /page\.blocks\.map\(/);
  assert.doesNotMatch(SRC, /page\.blocks\.(sort|filter|reverse|slice)/);
});

// ---------------------------------------------------------------------------
// AC 3 / AC 4 — the honesty line
// ---------------------------------------------------------------------------

test('AC 3: the honesty line precedes the text and is not collapsible', () => {
  const honesty = SRC.indexOf('PAGE_TEXT_COPY.honesty');
  const scroll = SRC.indexOf('s.pageScroll');
  assert.ok(honesty > 0, 'the extraction-honesty line is missing');
  assert.ok(honesty < scroll, 'the honesty line renders after the page text');
  // It is inside the expanded branch — it appears whenever the text does — and it
  // has no toggle of its own.
  assert.doesNotMatch(SRC, /honestyOpen|showHonesty|collapsedHonesty/);
});

test('AC 4: the copy lives in a constants module and says what extraction loses', () => {
  const honesty = PAGE_TEXT_COPY.honesty.toLowerCase();
  assert.match(honesty, /extracted/, 'the line does not say this is extracted text');
  assert.match(honesty, /figure|diagram|table/, 'the line does not name what may not survive');
  assert.match(honesty, /not a picture|not an image|not a photo/, 'it does not say what it is not');
  // In the module, not inline in the JSX.
  assert.doesNotMatch(SRC, /extracted text of the page/);
});

test('AC 4: the copy module carries no React Native import', () => {
  const copy = readFileSync(join(HERE, '..', 'lib', 'citations.ts'), 'utf8');
  assert.doesNotMatch(copy, /react-native/);
});

// ---------------------------------------------------------------------------
// AC 5 — a failure is a sentence, never an error card, never an empty expansion
// ---------------------------------------------------------------------------

test('AC 5: an unavailable page renders one plain line and no error card', () => {
  assert.match(SRC, /PAGE_TEXT_COPY\.unavailable/);
  // No refusal or alert language on this path: the refusal card is Message.tsx's
  // alone, and this is not even an error.
  const block = SRC.slice(SRC.indexOf('function WholePage'), SRC.indexOf('export function CitationSheet'));
  assert.doesNotMatch(block, /color\.refusal/, 'the failure path borrows the refusal styling');
  assert.doesNotMatch(block, /ErrorState|Try again|retry/i, 'a failure offers a retry the technician cannot act on');
  // And the expansion cannot render empty: `fetchPageText` returns null for a
  // page with no blocks, and the control is only offered in the ready state.
  assert.match(block, /state === 'ready'|state === 'unavailable' \|\| !page/);
});

test('AC 5: a citation with no chunk_id offers nothing at all', () => {
  const block = SRC.slice(SRC.indexOf('function WholePage'), SRC.indexOf('export function CitationSheet'));
  assert.match(block, /citation\.chunk_id \? 'loading' : 'unavailable'/);
  assert.match(block, /if \(!citation\.chunk_id\) return;/);
});

// ---------------------------------------------------------------------------
// AC 6 — the unresolved-citation path is untouched
// ---------------------------------------------------------------------------

test('AC 6: an unresolved citation still explains itself and stops', () => {
  const unresolved = SRC.indexOf('if (!resolution.resolvable)');
  const whole = SRC.indexOf('<WholePage');
  assert.ok(unresolved > 0 && unresolved < whole, 'the unresolved branch no longer returns early');
  const branch = SRC.slice(unresolved, SRC.indexOf('return (', unresolved + 40));
  assert.doesNotMatch(branch, /WholePage/, 'a citation that does not resolve is offered a page view');
  assert.match(branch, /brokenNotice/, 'the unresolved explanation is gone');
});

// ---------------------------------------------------------------------------
// AC 7 — the manufacturer's own copy, without overclaiming
// ---------------------------------------------------------------------------

test('AC 7: the link renders only when there is a real URL, and opens via Linking', () => {
  assert.match(SRC, /\{page\.sourceUrl && \(/, 'the link is not gated on there being one');
  assert.match(SRC, /Linking\.openURL\(withPageAnchor\(/);
});

test('AC 7: the link copy says it leaves the app and does not promise the page', () => {
  const note = PAGE_TEXT_COPY.linkNote.toLowerCase();
  assert.match(note, /leaves ductective|opens .* site/);
  assert.match(note, /whole document/, 'it does not say it opens the whole document');
  assert.match(note, /may not land|might not land/, 'it promises to land on the page');
  assert.match(PAGE_TEXT_COPY.link.toLowerCase(), /manufacturer/);
});

// ---------------------------------------------------------------------------
// AC 8 / AC 9 — it fits, and both surfaces get it
// ---------------------------------------------------------------------------

test('AC 8: the expansion is height-capped like the snippet, so the close button stays reachable', () => {
  const page = /pageScroll:\s*\{([\s\S]*?)\n {2}\}/.exec(SRC);
  const snippet = /snippetScroll:\s*\{([^}]*)\}/.exec(SRC);
  assert.ok(page && snippet);
  const cap = (rule) => Number(/maxHeight:\s*(\d+)/.exec(rule)?.[1]);
  assert.equal(cap(page[1]), cap(snippet[1]), 'the page expansion is capped differently from the snippet');
});

test('AC 9: both the phone sheet and the tablet panel render it, because both render SourceBody', () => {
  const uses = [...SRC.matchAll(/<SourceBody/g)];
  assert.equal(uses.length, 2, 'SourceBody is no longer the single body for both surfaces');
  assert.match(SRC, /export function CitationSheet/);
  assert.match(SRC, /export function SourcePanel/);
});

// ---------------------------------------------------------------------------
// The two domain rules, on this surface
// ---------------------------------------------------------------------------

test('the page view never becomes the citation — document and page still lead', () => {
  // E6.4: a claim is verified by a document name and a page number. The whole-page
  // text is context, and it must not displace the reference at the top of the
  // sheet.
  const head = SRC.indexOf('sourceHead');
  const whole = SRC.indexOf('<WholePage');
  assert.ok(head > 0 && head < whole);
  assert.match(SRC, /Page \{citation\.page\}/);
});

test('every control the page view adds is labelled and reaches the 48dp floor', () => {
  const block = SRC.slice(SRC.indexOf('function WholePage'), SRC.indexOf('export function CitationSheet'));
  const controls = [...block.matchAll(/<Pressable/g)];
  assert.equal(controls.length, 2, 'expected exactly the toggle and the link');
  assert.equal([...block.matchAll(/accessibilityLabel=/g)].length, 3, 'a control or block is unlabelled');
  for (const rule of ['pageToggle', 'pageLink']) {
    const style = new RegExp(`${rule}:\\s*\\{([\\s\\S]*?)\\n {2}\\}`).exec(SRC);
    assert.ok(style, `no ${rule} style`);
    assert.match(style[1], /minHeight:\s*MIN_TOUCH/, `${rule} is under the 48dp floor`);
  }
});
