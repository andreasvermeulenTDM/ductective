/**
 * copyInventory.mjs — resolve the copy constants the density count has to see.
 *
 * Two jobs, both ST-F18:
 *
 *  - `resolveCopy` gives the word counter the actual text behind
 *    `{GUEST_DISCLOSURE.body}`. Counting that as one `{expression}` would put the
 *    densest thing on the first screen at one word, and the whole point of the
 *    baseline is that it is honest about which words are there.
 *  - `fencedInventory` snapshots the copy ST-F19 may not shorten (AC 5), so a
 *    later run can tell "the screen got lighter" from "the disclosure got quieter".
 *    Those are not the same thing and brief hard constraint 1 forbids the second.
 */

const CONST_FILES = ['app/lib/accountCopy.ts', 'lib/diagnose.mjs', 'lib/safety.mjs'];

/** `\n` in a source literal is a line break, not the word "n". */
const unescape = (s) => String(s).replace(/\\[nrt]/g, ' ').replace(/\\(['"`\\])/g, '$1');
const wordsIn = (s) => (unescape(s).trim().match(/[A-Za-z0-9][A-Za-z0-9'’·—-]*/g) ?? []).length;

/** From `at` to the `;` that ends the statement, ignoring strings and brackets. */
function statementValue(src, at) {
  let depth = 0;
  let inString = null;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (inString) { if (c === inString && src[i - 1] !== '\\') inString = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) return src.slice(at, i);
  }
  return src.slice(at);
}

/** Balanced `{ … }` or backtick/quoted string starting at `from`. */
function valueAt(src, from) {
  const ch = src[from];
  if (ch === '`' || ch === "'" || ch === '"') {
    for (let i = from + 1; i < src.length; i++) {
      if (src[i] === ch && src[i - 1] !== '\\') return src.slice(from + 1, i);
    }
    return null;
  }
  if (ch !== '{') return null;
  let depth = 0;
  let inString = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inString) { if (c === inString && src[i - 1] !== '\\') inString = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(from + 1, i); }
  }
  return null;
}

function declarationValue(source, name) {
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*`).exec(source);
  if (m) {
    let at = m.index + m[0].length;
    while (/\s/.test(source[at])) at++;
    // The whole initialiser, not the first literal in it. NO_DOCUMENTATION and
    // UNIT_REQUIRED are multi-line `'…' + '…' + '…'` concatenations, and reading
    // only the first segment reported an 8-word refusal body.
    return statementValue(source, at);
  }

  // `refusalBody` is a function that returns a concatenation of literals, not a
  // constant. It is still fenced copy — it is the refusal the technician reads —
  // so it is resolved from the function body rather than reported as missing.
  const f = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(source);
  if (!f) return null;
  // Past the parameter list, not into it: `refusalBody({ label })` destructures,
  // so the first '{' after the name is the parameter, not the body.
  let depth = 0;
  let at = source.indexOf('(', f.index);
  for (; at < source.length; at++) {
    if (source[at] === '(') depth++;
    else if (source[at] === ')') { depth--; if (depth === 0) break; }
  }
  return valueAt(source, source.indexOf('{', at));
}

/** Every string literal inside an object/template body, concatenated. */
function textOf(body) {
  if (body === null) return null;
  const parts = [...body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  return parts.length ? parts.join(' ') : body;
}

/**
 * `{ 'GUEST_DISCLOSURE.body': '…', GUEST_DISCLOSURE: '…' }` — keyed by the exact
 * expression a screen writes, so the counter can look it up without evaluating.
 */
export function resolveCopy(read) {
  const out = {};
  for (const file of CONST_FILES) {
    const src = read(file);
    if (!src) continue;
    for (const m of src.matchAll(/\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*/g)) {
      const name = m[1];
      let at = m.index + m[0].length;
      while (/\s/.test(src[at])) at++;
      const body = valueAt(src, at);
      if (body === null) continue;
      out[name] = textOf(body) ?? '';
      if (src[at] === '{') {
        for (const k of body.matchAll(/(\w+)\s*:\s*(?:\n\s*)?('((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)) {
          out[`${name}.${k[1]}`] = k[3] ?? k[4] ?? '';
        }
      }
    }
  }
  return out;
}

/** @returns {Array<{name: string, file: string, words: number|null, text: string|null}>} */
export function fencedInventory(fenced, read) {
  return fenced.map((f) => {
    const src = read(f.file);
    if (!src) return { ...f, words: null, text: null };

    if (f.lines) {
      // A verdict written inline in JSX rather than hoisted to a constant. Cited
      // by line so it is checkable, and flagged as inline so ST-F19 knows it is
      // fenced even though it does not look like a constant.
      const lines = src.split('\n');
      const text = f.lines.map((n) => lines[n - 1] ?? '').join(' ');
      return { name: f.name, file: f.file, words: wordsIn(text.replace(/<[^>]*>/g, ' ')), text: text.trim(), inline: true };
    }

    const body = declarationValue(src, f.name);
    if (body === null) return { name: f.name, file: f.file, words: null, text: null };
    const text = textOf(body) ?? '';
    return { name: f.name, file: f.file, words: wordsIn(text), text };
  });
}
