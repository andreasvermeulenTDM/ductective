/**
 * contrastMatrix.mjs — every foreground/backdrop pairing the app actually draws.
 *
 * ST-F16. The check this replaces measured six *palette* pairs behind semantic
 * labels, so it could not detect the one change F5 makes (stories §1f). Two things
 * fix that, and both matter:
 *
 *   1. Every row names a **semantic role** — `textSecondary`, `surfaceRaised` —
 *      and `extractColorRoles` resolves it from `export const color`. Change
 *      `color.background` and this table measures the new value.
 *   2. Every row carries the `file:line` where the pairing renders, so the table
 *      is auditable against the screens rather than trusted.
 *
 * `coverageGaps()` is the guard on the guard: it greps the shipped screens for
 * every role used as a text colour or as a background and fails if one is drawn
 * but not measured here. A matrix that silently goes stale is the defect this
 * story exists to remove, so the matrix is not allowed to go stale silently.
 *
 * FLOOR is 4.5:1, from E6.7 ("body text clears 4.5:1 on every surface it is drawn
 * on") and E5.2 (refusal contrast must pass on dark).
 *
 * OPEN QUESTION — borders and other non-text pairings.
 *   WCAG 2.1 §1.4.11 sets 3:1 for non-text UI boundaries, but no criterion in this
 *   project has adopted it: `color.border` (#24405E) on `color.surface` is 1.40:1
 *   today, and scoring it would turn a dozen shipped, deliberate hairlines into
 *   failures against a bar nobody set. Default taken: non-text pairings are
 *   **measured and printed, never scored**, and are listed separately below so the
 *   numbers are visible if the owner does want to adopt 1.4.11.
 */

import { contrastRatio } from './contrast.mjs';
import { extractColorRoles, resolveBackdrop, resolveForeground, asHex } from './colorRoles.mjs';

export const FLOOR = 4.5;

/**
 * Text pairings. `on` is the backdrop stack, innermost first; it bottoms out on
 * an opaque role. Every screen root is `color.background` (app/App.tsx:334).
 *
 * `state` marks a pairing that only exists in a transient state. It is recorded,
 * not excused: a pressed row is on screen while a gloved finger is on it, and a
 * disabled button still renders its label.
 */
export const TEXT_PAIRS = [
  // --- on the screen background ------------------------------------------------
  { fg: 'textPrimary', on: ['background'], at: 'app/components/Chrome.tsx:615', what: 'session header unit' },
  { fg: 'textSecondary', on: ['background'], at: 'app/components/Chrome.tsx:616', what: 'session header symptom' },
  { fg: 'accent', on: ['background'], at: 'app/screens/AccountScreen.tsx:511', what: 'back link' },
  { fg: 'refusalText', on: ['background'], at: 'app/components/Message.tsx:495', what: 'uncited-defect label' },
  { fg: 'textSecondary', on: ['background'], at: 'app/components/Message.tsx:466', what: 'reference answer overline (ST-R06)' },
  { fg: 'textPrimary', on: ['background'], at: 'app/components/Message.tsx:468', what: 'reference answer value (ST-R06)' },

  // --- on a card / sheet surface -----------------------------------------------
  { fg: 'textPrimary', on: ['surface'], at: 'app/components/Chrome.tsx:658', what: 'error card title' },
  { fg: 'textSecondary', on: ['surface'], at: 'app/components/Chrome.tsx:681', what: 'inline notice detail' },
  { fg: 'accent', on: ['surface'], at: 'app/components/Chrome.tsx:757', what: 'active tab label' },
  { fg: 'refusalText', on: ['surface'], at: 'app/components/Chrome.tsx:657', what: 'error card glyph' },
  { fg: 'textSecondary', on: ['surface'], at: 'app/components/Message.tsx:481', what: 'reference hazard-adjacent note (ST-R06)' },

  // --- on the raised surface ---------------------------------------------------
  { fg: 'textPrimary', on: ['surfaceRaised'], at: 'app/screens/HistoryScreen.tsx:280', what: 'history unit badge' },
  { fg: 'accent', on: ['surfaceRaised'], at: 'app/components/Chrome.tsx:603', what: 'prototype banner text' },
  {
    fg: 'textSecondary', on: ['surfaceRaised'], state: 'pressed',
    at: 'app/screens/HistoryScreen.tsx:264', what: 'history row timestamp, row pressed',
    also: ['app/components/Chrome.tsx:756 tab label while the tab is pressed'],
  },
  {
    fg: 'refusalText', on: ['surfaceRaised'], state: 'pressed',
    at: 'app/screens/HistoryScreen.tsx:282', what: 'history "refused" chip, row pressed',
  },

  // --- on the refusal surface — the most safety-critical label in the app ------
  { fg: 'refusalText', on: ['refusalSurface'], at: 'app/components/Chrome.tsx:695', what: 'guest disclosure label' },
  { fg: 'textPrimary', on: ['refusalSurface'], at: 'app/components/Chrome.tsx:696', what: 'guest disclosure body' },
  // ST-R02. The dismiss mark is drawn on the notice, so it is measured on the
  // notice — and it deliberately does **not** take a `refusal*` role: red here
  // would read as "this is the dangerous thing" rather than "this closes it".
  { fg: 'textPrimary', on: ['refusalSurface'], at: 'app/components/Chrome.tsx:369', what: 'guest notice dismiss glyph (ST-R02)' },
  { fg: 'statusOffline', on: ['refusalSurface'], at: 'app/components/Chrome.tsx:630', what: 'offline chip text' },

  // --- on filled controls ------------------------------------------------------
  { fg: 'textOnInteractive', on: ['interactiveFill'], at: 'app/components/Chrome.tsx:738', what: 'primary button label' },
  {
    fg: 'textOnInteractive', on: ['pressed'], state: 'pressed',
    at: 'app/components/Chrome.tsx:738', what: 'primary button label, pressed',
  },
  { fg: 'textOnInteractive', on: ['pressed'], at: 'app/components/Message.tsx:399', what: 'the technician’s own message bubble' },
  {
    fg: 'textOnInteractive', on: ['border'], state: 'disabled',
    at: 'app/screens/ChatScreen.tsx:1041', what: 'retry / send label while disabled',
  },

  // --- on the translucent accent wash, composited over its real backdrop -------
  { fg: 'textPrimary', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:970', what: 'chosen-unit card' },
  { fg: 'accent', on: ['accentSurface', 'background'], at: 'app/components/Message.tsx:420', what: 'step number' },
  { fg: 'refusalText', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:985', what: 'not-covered verdict' },
  { fg: 'textSecondary', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:986', what: 'unknown-coverage verdict' },
  { fg: 'accent', on: ['accentSurface', 'surface'], at: 'app/components/Citation.tsx:498', what: 'source sheet icon glyph' },
  // ST-R16. The coverage statement that replaces the chips when a unit's
  // documents support no validated suggestion — drawn inside the unit card, on
  // the same accent wash the verdict lines above sit on.
  { fg: 'textPrimary', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:991', what: 'nothing-to-suggest coverage statement (ST-R16)' },
  { fg: 'textSecondary', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:992', what: 'nothing-to-suggest invitation (ST-R16)' },

  // --- the camera viewfinder and the tablet nav rail ---------------------------
  { fg: 'textPrimary', on: ['backgroundSunken'], at: 'app/screens/CaptureScreen.tsx:815', what: 'viewfinder hint' },
  { fg: 'textSecondary', on: ['backgroundRail'], at: 'app/components/Chrome.tsx:756', what: 'rail tab label' },
  { fg: 'accent', on: ['backgroundRail'], at: 'app/components/Chrome.tsx:757', what: 'rail active tab label' },
  {
    fg: 'textSecondary', on: ['accentSurface', 'backgroundRail'],
    at: 'app/components/Chrome.tsx:756', what: 'rail label on the selected item',
    also: ['app/components/Chrome.tsx:776 railItemOn supplies the accentSurface wash'],
  },
  {
    fg: 'accent', on: ['accentSurface', 'backgroundRail'],
    at: 'app/components/Chrome.tsx:757', what: 'rail label on the selected item, active',
    also: ['app/components/Chrome.tsx:776 railItemOn supplies the accentSurface wash'],
  },
  { fg: 'textOnInteractive', on: ['interactiveFill'], at: 'app/components/Chrome.tsx:789', what: 'rail capture glyph' },
];

/**
 * Non-text pairings — printed, not scored. See the OPEN QUESTION in the header.
 * `scrim` is here because it is an rgba role that must still be resolvable; it
 * carries no text, it darkens the screen behind a modal sheet.
 */
export const NON_TEXT_PAIRS = [
  { fg: 'border', on: ['surface'], at: 'app/components/Chrome.tsx:653', what: 'card hairline' },
  { fg: 'border', on: ['background'], at: 'app/components/Chrome.tsx:612', what: 'session header rule' },
  { fg: 'borderStrong', on: ['background'], at: 'app/components/Chrome.tsx:725', what: 'secondary button outline' },
  { fg: 'borderStrong', on: ['surface'], at: 'app/components/Citation.tsx:471', what: 'sheet grabber' },
  { fg: 'borderStrong', on: ['accentSurface', 'background'], at: 'app/screens/ChatScreen.tsx:979', what: 'change-unit outline' },
  { fg: 'accentBorder', on: ['accentSurface', 'background'], at: 'app/components/Message.tsx:415', what: 'step number ring' },
  { fg: 'accentBorder', on: ['accentSurface', 'surface'], at: 'app/components/Citation.tsx:494', what: 'source icon ring' },
  { fg: 'refusalBorder', on: ['refusalSurface'], at: 'app/components/Chrome.tsx:691', what: 'guest disclosure outline' },
  { fg: 'refusal', on: ['refusalSurface'], at: 'app/components/Message.tsx:468', what: 'refusal card outline' },
  { fg: 'accent', on: ['surfaceRaised'], at: 'app/components/Chrome.tsx:599', what: 'banner underline' },
  { fg: 'scrim', on: ['background'], at: 'app/components/Citation.tsx:457', what: 'modal scrim over the screen' },
];

/**
 * @param {string} tokensSource contents of app/theme/tokens.ts
 * @returns {{rows: string[], failures: string[], worst: {label: string, ratio: number}|null}}
 */
export function evaluateMatrix(tokensSource) {
  const { roles } = extractColorRoles(tokensSource);

  const rows = [];
  const failures = [];
  let worst = null;

  const measure = (p) => {
    const backdrop = resolveBackdrop(roles, p.on);
    const fg = resolveForeground(roles, p.fg, backdrop);
    return { ratio: contrastRatio(fg, backdrop), backdrop, fg };
  };

  rows.push(`TEXT — floor ${FLOOR.toFixed(1)}:1`);
  for (const p of TEXT_PAIRS) {
    const label = `${p.fg} → ${p.on.join(' over ')}${p.state ? ` [${p.state}]` : ''}`;
    const { ratio, backdrop, fg } = measure(p);
    const ok = ratio >= FLOOR;
    rows.push(
      `  ${label.padEnd(52)} ${ratio.toFixed(2)}:1 ${ok ? 'ok  ' : 'FAIL'}` +
      `  ${asHex(fg)} on ${asHex(backdrop)}  ${p.at}  (${p.what})`
    );
    for (const extra of p.also ?? []) rows.push(`  ${' '.repeat(52)}          also ${extra}`);
    if (!ok) failures.push(`${label} at ${ratio.toFixed(2)}:1 — ${p.at} (${p.what})`);
    if (!worst || ratio < worst.ratio) worst = { label, ratio, at: p.at };
  }

  rows.push('');
  rows.push('NON-TEXT — measured, not scored (no adopted 1.4.11 floor; see module header)');
  for (const p of NON_TEXT_PAIRS) {
    const label = `${p.fg} → ${p.on.join(' over ')}`;
    const { ratio, backdrop, fg } = measure(p);
    rows.push(`  ${label.padEnd(52)} ${ratio.toFixed(2)}:1      ${asHex(fg)} on ${asHex(backdrop)}  ${p.at}  (${p.what})`);
  }

  return { rows, failures, worst };
}

/** Only the refusal-text rows, for E5.2's own check. */
export function refusalRows(tokensSource) {
  const { roles } = extractColorRoles(tokensSource);
  const pairs = TEXT_PAIRS.filter((p) => p.fg === 'refusalText' || p.fg === 'statusOffline');
  const rows = [];
  const failures = [];
  let worst = Infinity;
  for (const p of pairs) {
    const backdrop = resolveBackdrop(roles, p.on);
    const fg = resolveForeground(roles, p.fg, backdrop);
    const ratio = contrastRatio(fg, backdrop);
    worst = Math.min(worst, ratio);
    const label = `${p.fg} (${asHex(fg)}) on ${p.on.join(' over ')} (${asHex(backdrop)})${p.state ? ` [${p.state}]` : ''}`;
    rows.push(`${label}: ${ratio.toFixed(2)}:1 ${ratio >= FLOOR ? 'ok' : 'FAIL'}  ${p.at}`);
    if (ratio < FLOOR) failures.push(`${label} at ${ratio.toFixed(2)}:1 — ${p.at}`);
  }
  return { rows, failures, worst };
}

const TEXT_PROPS = /(?:^|[^\w.])(color|tintColor)\s*:\s*color\.(\w+)/g;
const BG_PROPS = /\bbackgroundColor\s*:\s*color\.(\w+)/g;

/**
 * Backgrounds that are fills of decorative elements, not surfaces text sits on.
 *
 * Each entry is the exact `file:line` of the fill and why nothing is measured
 * against it. This is a named exemption, not a silent one: a role is only exempt
 * where *every* site that uses it as a background is listed here, so the moment
 * one of these fills starts carrying a label the coverage check fails again.
 */
export const NON_TEXT_FILLS = {
  'app/components/Chrome.tsx:594': 'bannerHairline — a 3dp accent rule above the prototype banner, no child',
  'app/components/Chrome.tsx:629': 'offlineDot — a 6dp status dot beside the offline chip label, no child',
  'app/components/Chrome.tsx:714': 'boundaryRule — a 1dp accentBorder rule above the saved-from-here marker, no child',
  'app/components/Citation.tsx:457': 'backdrop — the modal scrim; the sheet on top of it is opaque `surface`',
  'app/components/Citation.tsx:471': 'grabber — the 40×4 sheet handle, no child',
  'app/screens/ChatScreen.tsx:1091': 'thumb — a 64dp attachment image placeholder, covered by the image',
  'app/screens/SignInScreen.tsx:260': 'divider — a 1dp rule between the sign-in modes, no child',
};

/**
 * Roles a screen draws that the matrix does not measure.
 *
 * Without this the table is only as current as the last person who edited it.
 * With it, adding a new text colour to a screen and not adding a row here is a
 * failing check with the offending `file:line` in the evidence.
 *
 * @param {Array<{file: string, source: string}>} sources shipped .tsx, comments blanked
 */
export function coverageGaps(sources) {
  const measuredFg = new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].map((p) => p.fg));
  const measuredBg = new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].flatMap((p) => p.on));

  const gaps = [];
  const seenFg = new Map();
  const seenBg = new Map();
  const push = (map, role, at) => map.set(role, [...(map.get(role) ?? []), at]);

  for (const { file, source } of sources) {
    const lineOf = (i) => source.slice(0, i).split('\n').length;
    for (const m of source.matchAll(TEXT_PROPS)) push(seenFg, m[2], `${file}:${lineOf(m.index)}`);
    for (const m of source.matchAll(BG_PROPS)) push(seenBg, m[1], `${file}:${lineOf(m.index)}`);
  }

  for (const [role, at] of seenFg) {
    if (!measuredFg.has(role)) {
      gaps.push(`color.${role} is drawn as text at ${at[0]} but no matrix row measures it`);
    }
  }
  for (const [role, sites] of seenBg) {
    if (measuredBg.has(role)) continue;
    const unexplained = sites.filter((at) => !NON_TEXT_FILLS[at]);
    if (unexplained.length) {
      gaps.push(
        `color.${role} is drawn as a background at ${unexplained.join(', ')} but no matrix row sits on it ` +
        `(add a TEXT_PAIRS row, or a NON_TEXT_FILLS entry saying why nothing is drawn on it)`
      );
    }
  }

  // An exemption for a site that no longer exists is a stale exemption, and a
  // stale exemption is how an allowlist turns into a hole.
  const liveSites = new Set([...seenBg.values()].flat());
  for (const at of Object.keys(NON_TEXT_FILLS)) {
    if (!liveSites.has(at)) gaps.push(`NON_TEXT_FILLS names ${at}, which is no longer a background fill — the exemption is stale`);
  }

  return { gaps, foregrounds: [...seenFg.keys()].sort(), backgrounds: [...seenBg.keys()].sort() };
}
