/**
 * ST-F18 — the density instrument, and the baseline it produced.
 *
 *   npm test
 *
 * Two jobs. The first half tests the tool: a branch counter that guesses a branch
 * produces a number that looks exactly as authoritative as a right one, so every
 * way it could guess is closed here. The second half pins the baseline and the
 * fenced copy, so ST-F19's reduction has to move both deliberately and in the
 * open rather than drift.
 *
 * Nothing here claims anything about what is visible without scrolling. That is
 * ST-F20 AC 7 and it is human-only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evalCondition, pruneBranches, countWords, countFragment, styleRules,
  renderJsx, normalizeApostrophes, measureScene,
} from './density.mjs';
import { blankComments } from './jsx.mjs';
import { SCENES, FENCED_COPY } from './densityScenes.mjs';
import { resolveCopy, fencedInventory } from './copyInventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
};
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/density-baseline.json'), 'utf8'));

// ---------------------------------------------------------------------------
// The tool must never guess a branch
// ---------------------------------------------------------------------------

test('an undeclared condition throws rather than defaulting', () => {
  assert.throws(() => evalCondition('mysteryFlag', {}), /no value declared for `mysteryFlag`/);
  assert.throws(
    () => pruneBranches('<View>{whoKnows && <Text>hi</Text>}</View>', {}),
    /no value declared/
  );
});

test('a guarded block is kept when true and dropped when false', () => {
  const jsx = '<View>{shown && (<Text>visible</Text>)}</View>';
  assert.match(pruneBranches(jsx, { shown: true }), /visible/);
  assert.doesNotMatch(pruneBranches(jsx, { shown: false }), /visible/);
});

test('a chained guard evaluates both conditions, and counts neither as copy', () => {
  // `{a && b && (<jsx>)}` used to resolve only `a` and then hand `b && (<jsx>)`
  // to the counter as text, so the block survived a false `b` and the word "b"
  // was counted as visible copy. Both screens gate the guest disclosure on two
  // conditions (ST-F02), so this is a live shape, not a hypothetical.
  const jsx = '<View>{!signedIn && !dismissed && (<Text>notice</Text>)}</View>';
  assert.match(pruneBranches(jsx, { signedIn: false, dismissed: false }), /notice/);
  assert.doesNotMatch(pruneBranches(jsx, { signedIn: false, dismissed: true }), /notice/);
  assert.doesNotMatch(pruneBranches(jsx, { signedIn: true, dismissed: false }), /notice/);
  assert.equal(countWords(pruneBranches(jsx, { signedIn: false, dismissed: false }), {}), 1);
  // And an undeclared second condition still throws rather than being guessed.
  assert.throws(() => pruneBranches(jsx, { signedIn: false }), /no value declared for `dismissed`/);
});

test('a ternary keeps exactly one arm', () => {
  const jsx = '<View>{expanded ? (<Text>full</Text>) : (<View style={s.hairline} />)}</View>';
  const on = pruneBranches(jsx, { expanded: true });
  const off = pruneBranches(jsx, { expanded: false });
  assert.match(on, /full/);
  assert.doesNotMatch(on, /hairline/);
  assert.doesNotMatch(off, /full/);
  assert.match(off, /hairline/);
});

test('a .map over a declared list repeats its body', () => {
  const jsx = '<View>{TABS.map((t) => (<Text key={t.id}>{t.label}</Text>))}</View>';
  const out = pruneBranches(jsx, { 'repeat.TABS': 3 });
  assert.equal((out.match(/<Text/g) ?? []).length, 3);
  assert.throws(() => pruneBranches(jsx, {}), /repeat\.TABS/);
});

test('a brace inside an opening tag is an attribute, not a branch', () => {
  // `style={[s.tab, on && s.tabOn]}` must not be read as a render condition, or
  // the scene is asked to declare a value for a style flag it knows nothing about.
  const jsx = '<Text style={[s.tab, on && s.tabOn]}>Ask</Text>';
  assert.equal(pruneBranches(jsx, {}), jsx);
});

test('a render-prop child is unwrapped and counted', () => {
  const jsx = '<Touch>{({ pressed }) => (<View style={s.send}><Text>Go</Text></View>)}</Touch>';
  const out = pruneBranches(jsx, {});
  assert.equal(countWords(out, {}), 1);
});

test('contraction apostrophes do not open a string literal', () => {
  const src = "<Text>the unit's manuals — I'll cite them</Text>";
  const norm = normalizeApostrophes(src);
  assert.equal(norm.length, src.length, 'offsets must be preserved');
  assert.doesNotMatch(norm, /unit's/);
  assert.equal(countWords(norm, {}), 6);
});

test('accessibilityLabel is announced, not drawn, and is not counted', () => {
  const jsx = '<Pressable accessibilityLabel="Sign in or create an account"><Text>Go</Text></Pressable>';
  assert.equal(countWords(jsx, {}), 1);
});

test('placeholder copy is drawn, and is counted', () => {
  assert.equal(countWords('<TextInput placeholder="What\'s happening?" />', {}), 2);
});

test('a copy constant behind an expression is counted at its real length', () => {
  const copy = { 'GUEST_DISCLOSURE.body': 'one two three four five' };
  assert.equal(countWords('<Text>{GUEST_DISCLOSURE.body}</Text>', copy), 5);
});

test('styleRules survives a rule containing a nested object', () => {
  const src = `const s = StyleSheet.create({
    a: { backgroundColor: color.surface, shadowOffset: { width: 0, height: 2 } },
    b: { borderWidth: 1 },
    c: { flex: 1 },
  });`;
  const rules = styleRules(src);
  assert.deepEqual(Object.keys(rules).sort(), ['a', 'b', 'c']);
  const counts = countFragment('<View style={s.a} /><View style={s.b} /><View style={s.c} />', { rules });
  assert.equal(counts.D4, 2, 'only the filled and the bordered container count');
});

test('renderJsx picks the render, not an early error return', () => {
  const src = read('app/screens/ChatScreen.tsx');
  const jsx = renderJsx(normalizeApostrophes(blankComments(src)), 'ChatScreen', 's.composer');
  assert.match(jsx, /s\.composer/);
  assert.doesNotMatch(jsx.slice(0, 80), /ErrorState/);
});

// ---------------------------------------------------------------------------
// The baseline, and the copy that may not be shortened
// ---------------------------------------------------------------------------

test('every scene still measures, and matches the committed baseline', () => {
  const copy = resolveCopy(read);
  for (const scene of SCENES) {
    const got = measureScene(scene, read, copy).totals;
    const want = BASELINE.scenes[scene.name];
    assert.ok(want, `no committed baseline for scene "${scene.name}"`);
    assert.deepEqual(
      got, want,
      `density moved for "${scene.name}": ${JSON.stringify(got)} vs baseline ${JSON.stringify(want)}.\n` +
      'If this is ST-F19\'s reduction, regenerate the fixture and put both numbers in .pipeline/04-*.md:\n' +
      '  node tests/density-baseline.mjs --json > tests/fixtures/density-baseline.json'
    );
  }
});

test('ST-F19: the unit-entry reduction holds, and did not buy it with a control', () => {
  // The fixture carries both columns: `supersedes.correctedBaseline` is the gate
  // as it was, `scenes` is the gate as it is. Pinned as a test rather than left in
  // an artifact so that re-inflating the first screen fails a gate instead of
  // being noticed a round later.
  //
  // ST-F19 AC 2's floor is 10% on D2, D3 and D4 for state (a), and the artifact
  // has to say plainly why a larger number is not available: GUEST_DISCLOSURE is
  // 56 of the 93 words left on that screen and is fenced (AC 3, hard constraint 1).
  const before = BASELINE.supersedes.correctedBaseline.scenes;
  for (const name of Object.keys(BASELINE.scenes)) {
    if (!name.startsWith('(a)')) continue;
    const was = before[name];
    const now = BASELINE.scenes[name];
    for (const k of ['D2', 'D3', 'D4']) {
      const cut = (was[k] - now[k]) / was[k];
      assert.ok(cut >= 0.1, `${name} ${k}: ${was[k]} → ${now[k]} is only ${(cut * 100).toFixed(1)}%`);
    }
    // AC 1's other half, applied to the scene the owner actually named: density
    // must not be bought by removing a way to do something.
    assert.ok(now.D1 <= was.D1, `${name} gained a control: ${was.D1} → ${now.D1}`);
  }
});

test('ST-F19 AC 4: both front doors, the safety escape and the History tab all survive', () => {
  // A reduction that removed the only route to a capability would be a worse
  // screen with a better number. Checked at the source rather than inferred from
  // the counts, because the counts cannot tell a merged card from a deleted door.
  const gate = read('app/screens/UnitGate.tsx');
  assert.match(gate, /onIdentify\('camera'\)/, 'the camera door is gone');
  assert.match(gate, /onIdentify\('manual'\)/, 'manual entry is gone — the only offline route');
  assert.match(gate, /setUrgentOpen/, 'U7\'s safety escape is gone');
  assert.match(gate, /refusalCheck/, 'the gate can no longer return a refusal');
  assert.match(read('app/components/Chrome.tsx'), /id: 'history'/, 'the guest History tab is gone');
});

test('no fenced copy has been shortened', () => {
  // ST-F18 AC 5 / brief hard constraint 1. A density reduction that reaches the
  // disclosures or the refusal bodies is a failure, not a win, and this is where
  // that stops being a policy and becomes a check.
  const inventory = fencedInventory(FENCED_COPY, read);
  for (const item of inventory) {
    assert.notEqual(item.words, null, `${item.name} could not be resolved from ${item.file}`);
    const was = BASELINE.fencedWords[item.name];
    assert.ok(was !== undefined, `${item.name} has no committed word count`);
    assert.ok(
      item.words >= was,
      `${item.name} lost ${was - item.words} word(s) (${was} → ${item.words}) in ${item.file}. ` +
      'Fenced copy may not be shortened to reduce density.'
    );
  }
});

test('the fenced inventory resolves real copy, not a truncated first literal', () => {
  // The parser once read only the first segment of a multi-line concatenation and
  // reported the no-documentation body as eight words. A floor here means that
  // class of reader bug fails loudly instead of quietly under-counting.
  const inventory = fencedInventory(FENCED_COPY, read);
  for (const item of inventory) {
    assert.ok(item.words > 15, `${item.name} resolved to only ${item.words} words — suspect the reader, not the copy`);
  }
});
