/**
 * contrast.mjs — WCAG 2.1 relative luminance and contrast ratio.
 *
 * Exists because E6.7 sets a 4.5:1 body-text floor and E5.2 requires the refusal
 * to pass contrast on dark. app/theme/tokens.ts states measured ratios in its
 * comments (5.31 / 5.49 / 4.59 for refusal text, 6.91 for white on DuctBlue).
 * A number in a comment is an assertion; this makes it a check.
 *
 * Formula: WCAG 2.1 §1.4.3, (L1 + 0.05) / (L2 + 0.05).
 */

/** '#5CD0F5' → [92, 208, 245]. Accepts 3- or 6-digit hex. */
export function parseHex(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** 'rgba(92, 208, 245, 0.10)' composited over an opaque backdrop. */
export function parseRgba(value, backdrop) {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgba colour: ${value}`);
  const parts = m[1].split(',').map((s) => Number(s.trim()));
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  const [br, bg, bb] = backdrop;
  return [r, g, b].map((c, i) => Math.round(c * a + [br, bg, bb][i] * (1 - a)));
}

export function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** @returns {number} ratio, 1–21, rounded to 2dp. */
export function contrastRatio(fg, bg) {
  const a = relativeLuminance(typeof fg === 'string' ? parseHex(fg) : fg);
  const b = relativeLuminance(typeof bg === 'string' ? parseHex(bg) : bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Resolve every colour name in a TypeScript token module to a hex literal.
 *
 * Deliberately a parse over source rather than an import: tokens.ts is TypeScript
 * with `as const`, and this suite runs on bare Node with no transpiler. Reading
 * the source is also closer to what E6.8's "no hardcoded hex outside this file"
 * rule actually asserts.
 *
 * Three declaration forms have to be handled, because tokens.ts uses all three
 * and the most safety-critical colour in the app — the refusal text — happens to
 * use the least obvious one:
 *
 *   const alertRedText = '#D1746D';    standalone const
 *   ink: '#0C1826',                    literal object property
 *   refusalText: alertRedText,         property aliasing a const or palette entry
 *
 * Missing the third form made this reader report the refusal colour as undefined,
 * which surfaced as a failing contrast check rather than as the reader bug it was.
 */
export function extractHexTokens(source) {
  const out = {};

  // Pass 1 — anything bound directly to a hex literal.
  for (const m of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    out[m[1]] = m[2];
  }
  for (const m of source.matchAll(/(\w+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    out[m[1]] = m[2];
  }

  // Pass 2 — properties aliasing something already resolved. Repeated until it
  // stops changing, so a chain (palette.x → y → z) settles rather than depending
  // on declaration order.
  for (let i = 0; i < 5; i++) {
    let changed = false;
    for (const m of source.matchAll(/(\w+)\s*:\s*(?:palette\.)?(\w+)\s*,/g)) {
      const [, key, ref] = m;
      if (out[key] === undefined && out[ref] !== undefined) {
        out[key] = out[ref];
        changed = true;
      }
    }
    if (!changed) break;
  }

  return out;
}
