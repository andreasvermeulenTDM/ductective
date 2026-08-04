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
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'Voyage key', re: /\bpa-[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase JWT', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
  { name: 'generic secret assignment', re: /(SERVICE_ROLE|SECRET|PRIVATE)_KEY\s*=\s*\S{20,}/ },
];

/**
 * Variables that must never reach the client. Expo inlines only `EXPO_PUBLIC_*`,
 * so these are server-side by construction — this list is what proves it stayed
 * that way.
 */
export const SERVER_ONLY = [
  'ANTHROPIC_API_KEY',
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
export function scanText(text, { forbidden = [], allowed = [], names = [] } = {}) {
  if (!text) return [];
  const findings = [];

  let haystack = text;
  for (const { value } of allowed) haystack = haystack.split(value).join('«client-safe»');

  for (const { name, value } of forbidden) {
    if (haystack.includes(value)) findings.push({ kind: 'literal', name });
  }
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(haystack)) findings.push({ kind: 'shape', name: p.name });
  }
  for (const name of names) {
    if (haystack.includes(name)) findings.push({ kind: 'reference', name });
  }
  return findings;
}
