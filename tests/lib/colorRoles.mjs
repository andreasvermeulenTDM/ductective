/**
 * colorRoles.mjs — resolve the *semantic* colour roles the app actually draws with.
 *
 * Why this exists, and why `extractHexTokens` was not enough (ST-F16, stories §1f).
 *
 * `extractHexTokens` flattens every name in tokens.ts into one namespace, so
 * `palette.ink` and `color.background` land side by side as `t.ink` and
 * `t.background`. The contrast check then read the *palette* names —
 * `['textPrimary → background', t.mist, t.ink]` — and asserted that Mist on Ink
 * clears the floor. That stays true no matter what `color.background` is set to.
 * The suite that was supposed to guard the palette could not see the palette
 * change. This module reads `export const color = { … }` and nothing else, so a
 * pairing named `background` is measured against `color.background` by
 * construction rather than by the author remembering to.
 *
 * It also keeps the rgba roles. `accentSurface`, `accentBorder` and `scrim` are
 * `'rgba(…)'` strings, which `parseHex` throws on, so the old reader dropped them
 * — and `accentSurface` is the backdrop of the citation chip, the step number, the
 * unit card and the starter rows. Those are composited over their real backdrop
 * here (`compose`) rather than skipped.
 *
 * A parse over source, not an import, for the same reason contrast.mjs is: this
 * suite runs on bare Node and tokens.ts is TypeScript with `as const`.
 */

/** Every `name: '#hex'` / `name: 'rgba(…)'` inside a braced object literal. */
function objectBody(source, declaration) {
  const at = source.indexOf(declaration);
  if (at === -1) return null;
  const open = source.indexOf('{', at);
  if (open === -1) return null;

  let depth = 0;
  let inString = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && source[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Comments blanked in place, so nothing inside a rationale note is read as a value. */
function blank(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

const LITERAL = /^'(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))'$/;

/**
 * @param {string} source contents of app/theme/tokens.ts
 * @returns {{roles: Record<string,string>, palette: Record<string,string>}}
 *   `roles` is `export const color`, resolved to literal colour strings.
 */
export function extractColorRoles(source) {
  const src = blank(source);

  // Standalone consts first — `const alertRedText = '#D1746D';` is how the most
  // safety-critical colour in the app is declared.
  const consts = {};
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*('(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))')/g)) {
    consts[m[1]] = m[2].slice(1, -1);
  }

  const paletteBody = objectBody(src, 'const palette') ?? '';
  const palette = {};
  for (const m of paletteBody.matchAll(/(\w+)\s*:\s*('[^']*')\s*,/g)) {
    if (LITERAL.test(m[2])) palette[m[1]] = m[2].slice(1, -1);
  }

  const colorBody = objectBody(src, 'const color');
  if (colorBody === null) throw new Error('tokens.ts: `export const color = { … }` not found');

  const roles = {};
  // The value alternation is explicit rather than `[^,]+` because `scrim` is
  // `'rgba(12, 24, 38, 0.6)'` — a value with commas inside it.
  for (const m of colorBody.matchAll(/(\w+)\s*:\s*('[^']*'|palette\.\w+|\w+)\s*,/g)) {
    const key = m[1];
    const raw = m[2].trim();
    if (LITERAL.test(raw)) roles[key] = raw.slice(1, -1);
    else if (/^palette\.(\w+)$/.test(raw)) roles[key] = palette[RegExp.$1];
    else if (consts[raw] !== undefined) roles[key] = consts[raw];
    else if (roles[raw] !== undefined) roles[key] = roles[raw];
  }

  return { roles, palette };
}

/** '#5CD0F5' → [92, 208, 245]. */
export function toRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function isTranslucent(value) {
  return /^rgba?\(/.test(String(value));
}

/** 'rgba(92, 208, 245, 0.10)' over an opaque [r,g,b] backdrop. */
export function composite(value, backdrop) {
  const m = String(value).match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgba colour: ${value}`);
  const parts = m[1].split(',').map((s) => Number(s.trim()));
  const a = parts.length > 3 ? parts[3] : 1;
  return [0, 1, 2].map((i) => Math.round(parts[i] * a + backdrop[i] * (1 - a)));
}

/**
 * Flatten a backdrop stack to one opaque colour.
 *
 * The chain is written innermost-first, the way the screen nests: the citation
 * chip's `['accentSurface', 'surface']` means a 10%-cyan pill drawn on the sheet.
 * The outermost entry must be opaque — every screen bottoms out on
 * `color.background` (App.tsx `root`), `backgroundSunken` or `backgroundRail`.
 *
 * @param {Record<string,string>} roles
 * @param {string[]} chain
 * @returns {number[]} rgb
 */
export function resolveBackdrop(roles, chain) {
  const layers = chain.map((name) => {
    const v = roles[name];
    if (v === undefined) throw new Error(`no such colour role: ${name}`);
    return { name, value: v };
  });

  const base = layers[layers.length - 1];
  if (isTranslucent(base.value)) {
    throw new Error(`backdrop chain must bottom out on an opaque role, got ${base.name}`);
  }

  let out = toRgb(base.value);
  for (let i = layers.length - 2; i >= 0; i--) {
    const { value } = layers[i];
    out = isTranslucent(value) ? composite(value, out) : toRgb(value);
  }
  return out;
}

/** The foreground, resolved to rgb, composited if it is itself translucent. */
export function resolveForeground(roles, name, backdropRgb) {
  const v = roles[name];
  if (v === undefined) throw new Error(`no such colour role: ${name}`);
  return isTranslucent(v) ? composite(v, backdropRgb) : toRgb(v);
}

export const asHex = (rgb) =>
  `#${rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
