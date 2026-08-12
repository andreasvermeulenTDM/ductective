/**
 * ST-F16 — the guard on the contrast guard.
 *
 *   npm test
 *
 * A guard nobody has seen fail is a guess. Everything here mutates a *fixture*
 * copy of tokens.ts — never the real file — and asserts that the matrix goes red.
 * If any of these stops failing, the contrast suite has stopped measuring the
 * thing it claims to measure, which is exactly the state this story was written
 * to end (stories §1f: the old table read palette constants behind semantic
 * labels, so `color.background` could have been set to white with the suite
 * still green).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateMatrix,
  refusalRows,
  coverageGaps,
  TEXT_PAIRS,
  NON_TEXT_PAIRS,
  NON_TEXT_FILLS,
  FLOOR,
} from './contrastMatrix.mjs';
import { extractColorRoles, resolveBackdrop, resolveForeground, composite, asHex } from './colorRoles.mjs';
import { contrastRatio } from './contrast.mjs';
import { blankComments } from './jsx.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS_PATH = join(ROOT, 'app/theme/tokens.ts');
const TOKENS = readFileSync(TOKENS_PATH, 'utf8');

/** Rewrite one role's value in a *copy* of the source. tokens.ts is never touched. */
function withRole(source, role, value) {
  const re = new RegExp(`(\\n\\s*${role}\\s*:\\s*)(?:'[^']*'|palette\\.\\w+|\\w+)(\\s*,)`);
  const out = source.replace(re, `$1'${value}'$2`);
  assert.notEqual(out, source, `fixture did not rewrite color.${role} — the mutation would prove nothing`);
  return out;
}

const labelsOf = (failures) => failures.join(' | ');

// ---------------------------------------------------------------------------
// The §1f defect itself: semantic roles, not palette names
// ---------------------------------------------------------------------------

test('the matrix reads color.background, not palette.ink', () => {
  const { roles, palette } = extractColorRoles(TOKENS);
  // They were the same value when this test was written, which is precisely why
  // the old palette-name check could not tell them apart. ST-F17's lift moved
  // `color.background` to Steel900 and left `palette.ink` alone, so the two are
  // now different values and the distinction is load-bearing rather than
  // theoretical.
  assert.equal(roles.background, palette.steel900);
  assert.notEqual(roles.background, palette.ink);
  assert.equal(palette.ink, '#0C1826', 'the brand palette is verbatim and does not move');

  const lightened = withRole(TOKENS, 'background', '#FFFFFF');
  const after = extractColorRoles(lightened);

  // The palette is untouched — this is precisely the condition under which the
  // old check kept reporting mist-on-ink and stayed green.
  assert.equal(after.palette.ink, '#0C1826');
  assert.equal(after.roles.background, '#FFFFFF');
});

test('changing color.background to white fails the matrix', () => {
  const before = evaluateMatrix(TOKENS);
  const after = evaluateMatrix(withRole(TOKENS, 'background', '#FFFFFF'));

  assert.ok(
    after.failures.length > before.failures.length,
    `white background produced no new failure — the matrix is not reading color.background.\n${labelsOf(after.failures)}`
  );
  assert.match(
    labelsOf(after.failures),
    /textPrimary → background/,
    'Mist on white must be reported as unreadable'
  );
});

test('changing color.surface to white fails the matrix', () => {
  const after = evaluateMatrix(withRole(TOKENS, 'surface', '#FFFFFF'));
  assert.match(labelsOf(after.failures), /textPrimary → surface/);
});

test('an illegible textSecondary fails the matrix', () => {
  // One step off the current background: legible to nobody, and the kind of
  // change a palette lift can make by accident (stories §1g).
  const after = evaluateMatrix(withRole(TOKENS, 'textSecondary', '#101F30'));
  assert.match(labelsOf(after.failures), /textSecondary → background/);
});

test('an illegible refusalText fails both the matrix and E5.2\'s own rows', () => {
  const mutated = withRole(TOKENS, 'refusalText', '#31201E');
  assert.match(labelsOf(evaluateMatrix(mutated).failures), /refusalText → refusalSurface/);

  const rows = refusalRows(mutated);
  assert.ok(rows.failures.length > 0, 'E5.2 must fail on an unreadable refusal label');
  assert.ok(rows.worst < FLOOR);
});

test('an illegible accent fails the matrix even though the palette entry is intact', () => {
  const mutated = withRole(TOKENS, 'accent', '#0E1B2B');
  assert.equal(extractColorRoles(mutated).palette.cyanRead, '#5CD0F5');
  assert.match(labelsOf(evaluateMatrix(mutated).failures), /accent → /);
});

// ---------------------------------------------------------------------------
// rgba roles are composited, not skipped
// ---------------------------------------------------------------------------

test('accentSurface is composited over its real backdrop rather than dropped', () => {
  const { roles } = extractColorRoles(TOKENS);
  assert.match(roles.accentSurface, /^rgba\(/, 'accentSurface is an rgba role');

  const overBackground = resolveBackdrop(roles, ['accentSurface', 'background']);
  const overSurface = resolveBackdrop(roles, ['accentSurface', 'surface']);
  assert.notDeepEqual(overBackground, overSurface, 'the same wash over two backdrops must differ');
  assert.deepEqual(overBackground, composite(roles.accentSurface, resolveBackdrop(roles, ['background'])));
});

test('lifting the background moves every accentSurface pairing with it', () => {
  const { roles: before } = extractColorRoles(TOKENS);
  const { roles: after } = extractColorRoles(withRole(TOKENS, 'background', '#1D3450'));
  assert.notEqual(
    asHex(resolveBackdrop(before, ['accentSurface', 'background'])),
    asHex(resolveBackdrop(after, ['accentSurface', 'background']))
  );
});

test('a backdrop chain must bottom out on an opaque role', () => {
  const { roles } = extractColorRoles(TOKENS);
  assert.throws(() => resolveBackdrop(roles, ['accentSurface']), /opaque/);
});

test('every rgba role in the token module is reachable by the matrix', () => {
  const { roles } = extractColorRoles(TOKENS);
  const translucent = Object.entries(roles).filter(([, v]) => /^rgba?\(/.test(v)).map(([k]) => k);
  assert.deepEqual(translucent.sort(), ['accentBorder', 'accentSurface', 'scrim']);

  const named = new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].flatMap((p) => [p.fg, ...p.on]));
  for (const role of translucent) {
    assert.ok(named.has(role), `${role} is an rgba role no pairing mentions — it would be silently skipped`);
  }
});

// ---------------------------------------------------------------------------
// The table has to keep describing the app
// ---------------------------------------------------------------------------

test('every pairing cites a file:line that really draws that role', () => {
  for (const p of [...TEXT_PAIRS, ...NON_TEXT_PAIRS]) {
    const [file, lineNo] = p.at.split(':');
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    const line = lines[Number(lineNo) - 1];
    assert.ok(line !== undefined, `${p.at} is past the end of ${file}`);
    assert.match(
      line,
      new RegExp(`color\\.${p.fg}\\b`),
      `${p.at} is cited for color.${p.fg} but that line does not draw it: ${line?.trim()}`
    );
  }
});

test('a role drawn as text but absent from the matrix is a coverage gap', () => {
  const { gaps } = coverageGaps([
    { file: 'app/screens/Fake.tsx', source: 'const s = { x: { color: color.somethingNew } };' },
  ]);
  assert.match(gaps.join(' '), /color\.somethingNew is drawn as text/);
});

test('a role drawn as a background but absent from the matrix is a coverage gap', () => {
  const { gaps } = coverageGaps([
    { file: 'app/screens/Fake.tsx', source: 'const s = { x: { backgroundColor: color.brandNewSurface } };' },
  ]);
  assert.match(gaps.join(' '), /color\.brandNewSurface is drawn as a background/);
});

test('a stale non-text-fill exemption is itself a gap', () => {
  const { gaps } = coverageGaps([{ file: 'app/screens/Fake.tsx', source: '' }]);
  const first = Object.keys(NON_TEXT_FILLS)[0];
  assert.match(gaps.join('\n'), new RegExp(`${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*stale`));
});

test('the shipped tree has no coverage gap', () => {
  // The same scan the E6.7 suite runs, so a screen that introduces an unmeasured
  // colour role fails `npm test` too, not only the Stage-5 run.
  const files = [
    'app/components/Chrome.tsx', 'app/components/Citation.tsx', 'app/components/Form.tsx',
    'app/components/Message.tsx', 'app/components/Skeleton.tsx', 'app/components/Tactile.tsx',
    'app/screens/AccountScreen.tsx', 'app/screens/CaptureScreen.tsx', 'app/screens/ChatScreen.tsx',
    'app/screens/CompanyScreen.tsx', 'app/screens/HistoryScreen.tsx', 'app/screens/SignInScreen.tsx',
    'app/screens/UnitGate.tsx', 'app/App.tsx',
  ];
  const sources = files.map((f) => ({ file: f, source: blankComments(readFileSync(join(ROOT, f), 'utf8')) }));
  const { gaps } = coverageGaps(sources);
  assert.deepEqual(gaps, [], gaps.join('\n'));
});

// ---------------------------------------------------------------------------
// What the matrix says about the tree as it stands
// ---------------------------------------------------------------------------

test('every pairing the app draws clears the floor', () => {
  // This test used to pin **two failures** — `textSecondary → surfaceRaised` at
  // 4.00:1 and `refusalText → surfaceRaised` at 3.88:1 — which the shipped dark
  // palette had never cleared and which the old six-pair check could not see
  // (ST-F16 AC 5). ST-F17 fixed both by moving the colours in `tokens.ts`: the
  // pressed history row is now 4.72 and 4.71. The pin is replaced by the stronger
  // statement rather than deleted, so a regression is a failing test again.
  const { failures } = evaluateMatrix(TOKENS);
  assert.deepEqual(failures, [], `pairings under the ${FLOOR}:1 floor:\n${failures.join('\n')}`);
});

test('the two pairings ST-F17 fixed stay fixed, with their margin visible', () => {
  // Named individually because they are the two the instrument caught, and
  // because `refusalText` on a pressed row is the safety-critical one: E5.2
  // requires the refusal label to clear the floor on dark, and a technician
  // holding a gloved finger on a history row containing a refusal is exactly the
  // state that was failing. Asserted above 4.5 rather than at it, so a later
  // tweak that shaves the margin to the line is visible here.
  const { roles } = extractColorRoles(TOKENS);
  const raised = resolveBackdrop(roles, ['surfaceRaised']);
  for (const role of ['refusalText', 'textSecondary']) {
    const ratio = contrastRatio(resolveForeground(roles, role, raised), raised);
    assert.ok(
      ratio >= FLOOR,
      `${role} on surfaceRaised is ${ratio.toFixed(2)}:1 — under the ${FLOOR}:1 floor`
    );
    assert.ok(
      ratio >= 4.6,
      `${role} on surfaceRaised is ${ratio.toFixed(2)}:1 — clears the floor with no margin left`
    );
  }
});
