/**
 * jsx.mjs — extract JSX opening tags without a parser.
 *
 * A regex like /<Pressable[\s\S]*?>/ stops at the first '>' in the source, which
 * in real component code is almost never the end of the tag — it lands inside an
 * arrow function (`onPress={() => …}`) or a nested expression. That misreading
 * made an accessibility check report 15 unlabelled controls in a file where 15 of
 * 16 were labelled: a broken reader reporting as a product defect, which is the
 * specific failure Stage 5 must not commit.
 *
 * This walks the tag instead, tracking string and brace depth, and ends on the
 * first '>' that is at depth zero and is not the tail of '=>'.
 */

/**
 * Blank out comments while preserving every character offset and newline.
 *
 * Deleting them instead would shift every index after the first comment, and the
 * line numbers reported as evidence would point at the wrong code — evidence a
 * reader cannot follow back to the source is not evidence.
 */
export function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

/** @returns {string} the opening tag source, starting at `from`. */
export function openingTagAt(code, from) {
  let depth = 0;
  let inString = null;

  for (let i = from; i < code.length; i++) {
    const ch = code[i];

    if (inString) {
      if (ch === inString && code[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0 && code[i - 1] !== '=') return code.slice(from, i + 1);
  }
  return code.slice(from);
}

/** Every opening tag for the named components. */
export function findTags(code, names) {
  const out = [];
  const re = new RegExp(`<\\s*(${names.join('|')})\\b`, 'g');
  let m;
  while ((m = re.exec(code))) {
    out.push({ name: m[1], index: m.index, source: openingTagAt(code, m.index) });
  }
  return out;
}

/** The full value of a JSX attribute, braces balanced. `null` if absent. */
export function attributeValue(tagSource, attr) {
  const at = tagSource.indexOf(`${attr}=`);
  if (at === -1) return null;

  const start = at + attr.length + 1;
  if (tagSource[start] === '"' || tagSource[start] === "'") {
    const quote = tagSource[start];
    const end = tagSource.indexOf(quote, start + 1);
    return tagSource.slice(start + 1, end === -1 ? undefined : end);
  }
  if (tagSource[start] !== '{') return null;

  let depth = 0;
  let inString = null;
  for (let i = start; i < tagSource.length; i++) {
    const ch = tagSource[i];
    if (inString) {
      if (ch === inString && tagSource[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return tagSource.slice(start + 1, i);
    }
  }
  return null;
}
