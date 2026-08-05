/**
 * secrets.mjs — one definition of "what a secret looks like", shared by the
 * bundle verifier (scripts/verify-bundle.mjs) and the Stage 5 rails suite.
 *
 * Two kinds of check live here and they are not interchangeable:
 *
 *   Shape  — a string that *looks* like a key (`sk-ant-…`). Catches a secret
 *            nobody has told us about, including one from a future provider.
 *   Literal— the exact value currently in `.env`. Catches the case shape misses:
 *            a key that got inlined into a bundle in a form the regex doesn't
 *            match, or one that was re-encoded on the way in.
 *
 * The literal check is the stronger of the two and is the one brief criterion 3
 * actually turns on. It is also why nothing here ever prints a matched value —
 * findings name the *variable*, never its contents. A verifier that leaks the
 * secret it found would be worse than no verifier.
 */

/** Key prefixes that must never appear in a tracked file or a client bundle. */
export const SECRET_PATTERNS = [
  // Kept permanently, not "until the migration finishes". A stale Anthropic key
  // committed here is still a leak, whoever the current provider is.
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'Voyage key', re: /\bpa-[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase JWT', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
  // Bound left open-ended, matching the {8,}/{20,} convention above, so a change
  // to Google's key length cannot silently disarm the rule.
  { name: 'Google AI Studio key', re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  // Newer AI Studio format: `AQ.` + url-safe base64. Added 4 Aug 2026 after the
  // key actually issued to this project matched none of the rules above — the
  // scanner could not have caught our own live key. `AIza` is kept: both formats
  // are in circulation, and dropping the old one would blind the check to any key
  // issued before the change.
  { name: 'Google AI Studio key (AQ format)', re: /\bAQ\.[A-Za-z0-9_-]{20,}/ },
  // A Google service-account JSON matches none of the patterns above and is the
  // most damaging credential that could land in this repo.
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'generic secret assignment', re: /(SERVICE_ROLE|SECRET|PRIVATE)_KEY\s*=\s*\S{20,}/ },
];

/**
 * Variables that must never reach the client. Expo inlines only `EXPO_PUBLIC_*`,
 * so these are server-side by construction — this list is what proves it stayed
 * that way.
 *
 * ANTHROPIC_API_KEY stays through the transition and beyond. This list is also
 * passed as `names` to scripts/verify-bundle.mjs, so a stale variable name left
 * in a bundle remains a finding rather than becoming invisible on the day the
 * provider changes.
 */
export const SERVER_ONLY = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'VOYAGE_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

/**
 * The anon key is *supposed* to ship. It is RLS-protected by design, and the
 * privilege split proving that is asserted by `npm run verify` (anon gets 401 /
 * 42501 on `ductective_health`). Without this exemption the JWT shape rule would
 * fail the bundle for doing exactly what it should.
 */
export const CLIENT_SAFE = ['EXPO_PUBLIC_SUPABASE_ANON_KEY'];

/**
 * Files exempt from the **shape** rules only.
 *
 * The scanner's own unit tests must contain key-shaped strings — that is what they
 * test. Without this, `verify:secrets` and Stage 5's E0.2 fail permanently on
 * synthetic fixtures, and a check that is always red is a check nobody reads. That
 * is the failure mode this exemption exists to prevent, not a convenience.
 *
 * The exemption is deliberately narrow in two ways:
 *
 *  - **Literal and reference rules still apply.** If a real value from `.env` is
 *    ever pasted into this file, it is still a finding. Only the heuristics that
 *    cannot tell a fixture from a key are suppressed.
 *  - **It is a fixed path list, not a magic comment.** A comment could be added to
 *    any file to silence the scanner; a path list cannot be extended without a
 *    reviewable diff to this file.
 */
export const SHAPE_EXEMPT_PATHS = ['lib/secrets.test.mjs'];

export const isShapeExempt = (path) =>
  SHAPE_EXEMPT_PATHS.some((p) => path === p || path.endsWith(`/${p}`));

const MIN_LITERAL = 12;

/**
 * Pull the real values out of an env object, split into what must never ship and
 * what legitimately may. Empty and placeholder values are skipped — matching on a
 * short or absent value would flag every file in the repo.
 */
export function envLiterals(env = process.env) {
  const usable = (name) => {
    const v = env[name];
    return typeof v === 'string' && v.trim().length >= MIN_LITERAL && !/^YOUR-/.test(v) ? v.trim() : null;
  };
  return {
    forbidden: SERVER_ONLY.map((name) => ({ name, value: usable(name) })).filter((l) => l.value),
    allowed: CLIENT_SAFE.map((name) => ({ name, value: usable(name) })).filter((l) => l.value),
  };
}

/**
 * Scan one text body. Returns a list of `{ kind, name }` findings — never the
 * matched text.
 *
 * `allowed` literals are blanked out *before* the shape rules run, so a
 * legitimately-shipped anon key cannot trip the JWT pattern.
 */
export function scanText(text, { forbidden = [], allowed = [], names = [], skipShape = false } = {}) {
  if (!text) return [];
  const findings = [];

  let haystack = text;
  for (const { value } of allowed) haystack = haystack.split(value).join('«client-safe»');

  for (const { name, value } of forbidden) {
    if (haystack.includes(value)) findings.push({ kind: 'literal', name });
  }
  // `skipShape` suppresses only the heuristics — the literal loop above and the
  // reference loop below run regardless. See SHAPE_EXEMPT_PATHS.
  if (!skipShape) {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(haystack)) findings.push({ kind: 'shape', name: p.name });
    }
  }
  for (const name of names) {
    if (haystack.includes(name)) findings.push({ kind: 'reference', name });
  }
  return findings;
}
