/**
 * density.mjs — count what a technician meets on the unit-entry screen.
 *
 * ST-F18. "Over-complicated" is an opinion until there is a number, and the point
 * of this module is to make the before/after of ST-F19 a table rather than two
 * impressions a week apart.
 *
 * **What it counts, exactly: rendered-in-branch. Not visible-without-scrolling.**
 * It resolves which JSX a given render branch produces and counts that. It knows
 * nothing about viewport height, font scale, or where the fold lands, so a screen
 * that got shorter and a screen that got scrollier are indistinguishable to it.
 * The without-scrolling half is human-only and is ST-F20 AC 7. Nothing here may be
 * reported as covering it.
 *
 * Four figures, per ST-F18 AC 1:
 *   D1  tappable controls        Pressable / ScalePressable / Touchable*
 *   D2  non-empty Text elements
 *   D3  words of literal copy    JSX text nodes + resolved copy constants
 *   D4  bordered or filled containers
 *
 * Built on tests/lib/jsx.mjs (`findTags`, `attributeValue`, `blankComments`) —
 * the same tag walker the accessibility checks use, for the same reason: a naive
 * `/<Tag[\s\S]*?>/` stops at the first '>' inside an arrow function and miscounts.
 */

import { findTags, attributeValue, blankComments, openingTagAt } from './jsx.mjs';

// ---------------------------------------------------------------------------
// Source extraction
// ---------------------------------------------------------------------------

/**
 * Contraction apostrophes → U+2019, one character for one, so every offset holds.
 *
 * Without this, `unit's manuals` in a JSX text node opens a string literal that
 * never closes and brace matching walks off the end of the file. A real single
 * quoted literal never has a letter on both sides of its delimiter, so the rule
 * is safe: `'chat'` and `foo('a')` are untouched, `I'll` and `isn't` are not.
 * Word counts are unaffected — U+2019 is already an in-word character here.
 */
export function normalizeApostrophes(source) {
  return source.replace(/([A-Za-z])'([A-Za-z])/g, '$1’$2');
}

/** The body of `function name(…) { … }`, brace-balanced. */
export function functionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*[(<]`);
  const m = re.exec(source);
  if (!m) throw new Error(`no function ${name} in this source`);

  // The parameter list must be matched, not searched for its first ')'. Props
  // are destructured with an inline type, and `onCapture: (mode: 'camera') =>
  // void` puts a ')' well before the end of the signature — following that one
  // opened a "body" 39 characters long and reported no render at all.
  const paramStart = source.indexOf('(', m.index);
  const paramEnd = paramStart + parenAt(source, paramStart).length + 1;
  const open = source.indexOf('{', paramEnd);
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
  throw new Error(`unbalanced body for ${name}`);
}

/** The parenthesised expression starting at the '(' at `from`. */
function parenAt(code, from) {
  let depth = 0;
  let inString = null;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === inString && code[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return code.slice(from + 1, i);
    }
  }
  throw new Error('unbalanced parenthesis');
}

/**
 * Inline `const name = ( <jsx> );` so that a `{name}` reference in the return
 * counts what it renders. ChatScreen builds its scroll view this way.
 */
function inlineJsxConsts(body) {
  let out = body;
  for (const m of [...body.matchAll(/\bconst\s+(\w+)\s*=\s*\(\s*(?=<)/g)]) {
    const jsx = parenAt(body, body.indexOf('(', m.index));
    out = out.split(`{${m[1]}}`).join(jsx);
  }
  return out;
}

/**
 * The JSX a component returns.
 *
 * `anchor` picks between several `return ( … )` blocks in one function — the
 * early-return error states in ChatScreen are returns too, and measuring one of
 * those instead of the real render would be a silent wrong answer.
 */
export function renderJsx(source, fn, anchor) {
  const body = inlineJsxConsts(functionBody(source, fn));
  const blocks = [];
  for (const m of body.matchAll(/\breturn\s*\(\s*(?=<)/g)) {
    blocks.push(parenAt(body, body.indexOf('(', m.index)));
  }
  if (!blocks.length) throw new Error(`no parenthesised JSX return in ${fn}`);
  if (!anchor) return blocks[0];
  const hit = blocks.find((b) => b.includes(anchor));
  if (!hit) throw new Error(`no return in ${fn} containing ${anchor}`);
  return hit;
}

// ---------------------------------------------------------------------------
// Branch pruning
// ---------------------------------------------------------------------------

/** The balanced `{ … }` expression starting at `from`. */
function braceAt(code, from) {
  let depth = 0;
  let inString = null;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === inString && code[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { inner: code.slice(from + 1, i), end: i + 1 };
    }
  }
  throw new Error('unbalanced brace');
}

/** Split on a top-level operator, ignoring strings, braces, parens and JSX tags. */
function splitTop(expr, token) {
  let depth = 0;
  let angle = 0;
  let inString = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (ch === inString && expr[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === '<' && /[A-Za-z/]/.test(expr[i + 1] ?? '')) angle++;
    else if (ch === '>' && expr[i - 1] !== '=' && angle > 0) angle--;
    if (depth !== 0 || angle !== 0) continue;
    if (expr.startsWith(token, i)) return [expr.slice(0, i), expr.slice(i + token.length)];
  }
  return null;
}

/**
 * Evaluate a render condition against a declared scene state.
 *
 * Deliberately tiny and deliberately strict: `!x`, `x`, `x && y`, `x.length === 0`
 * and `x.length > 0`. An expression it does not recognise throws rather than
 * defaulting, because a branch silently assumed present or absent is a wrong
 * number that looks like a right one.
 */
export function evalCondition(expr, state) {
  const e = expr.trim().replace(/^\((.*)\)$/s, '$1').trim();

  const and = splitTop(e, '&&');
  if (and) return evalCondition(and[0], state) && evalCondition(and[1], state);
  const or = splitTop(e, '||');
  if (or) return evalCondition(or[0], state) || evalCondition(or[1], state);

  if (e.startsWith('!')) return !evalCondition(e.slice(1), state);

  const cmp = /^([\w.?[\]]+)\s*(===|!==|>|<|>=|<=)\s*(.+)$/.exec(e);
  if (cmp) {
    const left = lookup(cmp[1], state, e);
    const right = cmp[3].trim().replace(/^['"](.*)['"]$/, '$1');
    const rv = /^-?\d+$/.test(right) ? Number(right) : right;
    switch (cmp[2]) {
      case '===': return left === rv;
      case '!==': return left !== rv;
      case '>': return left > rv;
      case '<': return left < rv;
      case '>=': return left >= rv;
      case '<=': return left <= rv;
      default: break;
    }
  }

  return Boolean(lookup(e, state, e));
}

function lookup(path, state, whole) {
  if (Object.hasOwn(state, path)) return state[path];
  const dot = /^(\w+)\.length$/.exec(path);
  if (dot && Object.hasOwn(state, `${dot[1]}.length`)) return state[`${dot[1]}.length`];
  throw new Error(
    `density: no value declared for \`${path}\` (in \`${whole}\`). ` +
    'Add it to the scene state rather than letting the branch be guessed.'
  );
}

/**
 * Resolve every `{cond && …}`, `{cond ? a : b}` and `{list.map(…)}` in the JSX
 * against the scene state, so what is left is exactly what this branch renders.
 *
 * @param {string} jsx
 * @param {Record<string, unknown>} state condition values and `repeat.<list>` counts
 */
export function pruneBranches(jsx, state) {
  let out = '';
  let i = 0;
  while (i < jsx.length) {
    const ch = jsx[i];

    // Opening and closing tags are copied verbatim. Braces inside a tag are
    // attribute values — `style={[s.tab, on && s.tabOn]}` — and resolving those
    // as if they were render branches asks for a value for `on` that no scene
    // has any business declaring.
    if (ch === '<' && /[A-Za-z/]/.test(jsx[i + 1] ?? '')) {
      const tag = openingTagAt(jsx, i);
      out += tag;
      i += tag.length;
      continue;
    }

    if (ch !== '{') { out += ch; i++; continue; }

    const { inner, end } = braceAt(jsx, i);
    out += resolveExpression(inner, state);
    i = end;
  }
  return out;
}

function resolveExpression(inner, state) {
  const trimmed = inner.trim();

  const mapped = /^([\w.]+)\.map\(/.exec(trimmed);
  if (mapped) {
    const times = state[`repeat.${mapped[1]}`];
    if (times === undefined) {
      throw new Error(`density: no \`repeat.${mapped[1]}\` declared for ${mapped[1]}.map(…)`);
    }
    const body = parenAt(trimmed, trimmed.indexOf('('));
    const jsxStart = body.search(/<[A-Za-z]/);
    if (jsxStart === -1) return '';
    const item = pruneBranches(body.slice(jsxStart), state);
    return Array.from({ length: times }, () => item).join('\n');
  }

  const ternary = splitTop(trimmed, '?');
  if (ternary && !/^[\w.]+\?\./.test(trimmed)) {
    const arms = splitTop(ternary[1], ':');
    if (arms) {
      const taken = evalCondition(ternary[0], state) ? arms[0] : arms[1];
      return pruneBranches(stripWrap(taken), state);
    }
  }

  const guard = splitTop(trimmed, '&&');
  if (guard && /<[A-Za-z]/.test(guard[1])) {
    if (!evalCondition(guard[0], state)) return '';
    const rest = guard[1].trim();
    // `{a && b && (<jsx>)}` — the right-hand side is another guard, not the JSX.
    // `stripWrap` would hand the whole `b && (<jsx>)` string to the counter,
    // which then reads `b` as a word of visible copy and keeps the block whether
    // `b` is true or not. Both halves of a chained condition have to be
    // evaluated, so recurse rather than strip. `ChatScreen` and `UnitGate` both
    // gate the guest disclosure on two conditions (`!signedIn &&
    // !noticeDismissed`), which is where this surfaced.
    return rest.startsWith('<') || rest.startsWith('(')
      ? pruneBranches(stripWrap(rest), state)
      : resolveExpression(rest, state);
  }

  // A render-prop child — `{({ pressed }) => (<View …/>)}`. What it returns is
  // drawn, so it is unwrapped and counted rather than left inside braces where
  // the word counter would step over it.
  const arrow = splitTop(trimmed, '=>');
  if (arrow && /<[A-Za-z]/.test(arrow[1])) return pruneBranches(stripWrap(arrow[1]), state);

  // A plain expression child — `{equipment}`, `{GUEST_DISCLOSURE.body}`. Kept in
  // braces so the copy resolver can see it and the text counter can tell it from
  // a literal.
  return `{${inner}}`;
}

/** `( … )` or a bare JSX element → the JSX. */
function stripWrap(s) {
  const t = s.trim();
  if (t.startsWith('(')) return parenAt(t, 0);
  return t;
}

// ---------------------------------------------------------------------------
// Style tables — what counts as a bordered or filled container
// ---------------------------------------------------------------------------

/** `StyleSheet.create({ … })` → name → rule source. Brace-balanced, not regex. */
export function styleRules(source) {
  const at = source.indexOf('StyleSheet.create');
  if (at === -1) return {};
  const open = source.indexOf('{', at);
  const { inner } = braceAt(source, open);

  const rules = {};
  let i = 0;
  while (i < inner.length) {
    const m = /(\w+)\s*:\s*\{/g;
    m.lastIndex = i;
    const hit = m.exec(inner);
    if (!hit) break;
    const braceStart = inner.indexOf('{', hit.index + hit[1].length);
    const { inner: body, end } = braceAt(inner, braceStart);
    rules[hit[1]] = body;
    i = end;
  }
  return rules;
}

const CONTAINERISH = /\b(backgroundColor|borderWidth|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth)\s*:/;

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const TAPPABLE = ['Pressable', 'ScalePressable', 'TouchableOpacity', 'TouchableHighlight'];

/**
 * @param {string} jsx pruned JSX for one branch
 * @param {{rules: Record<string,string>, copy: Record<string,string>}} ctx
 */
export function countFragment(jsx, ctx) {
  const rules = ctx.rules ?? {};
  const copy = ctx.copy ?? {};

  // --- D1 -------------------------------------------------------------------
  const controls = findTags(jsx, TAPPABLE);

  // --- D2 -------------------------------------------------------------------
  // A <Text> with no children renders nothing; a <Text>{x}</Text> renders
  // whatever x is. Both are distinguished here rather than assumed.
  const texts = [];
  for (const tag of findTags(jsx, ['Text'])) {
    if (tag.source.trimEnd().endsWith('/>')) continue;
    const after = jsx.slice(tag.index + tag.source.length);
    const close = after.indexOf('</Text>');
    const body = close === -1 ? after : after.slice(0, close);
    if (body.replace(/\s+/g, '')) texts.push(body.trim());
  }

  // --- D3 -------------------------------------------------------------------
  const words = countWords(jsx, copy);

  // --- D4 -------------------------------------------------------------------
  let containers = 0;
  const containerNames = [];
  for (const tag of findTags(jsx, ['View', 'ScrollView', ...TAPPABLE])) {
    const style = attributeValue(tag.source, 'style') ?? '';
    const named = [...style.matchAll(/\bs\.(\w+)/g)].map((m) => m[1]);
    const hit = named.find((n) => rules[n] && CONTAINERISH.test(rules[n]));
    if (hit) { containers++; containerNames.push(`${tag.name}(s.${hit})`); }
  }

  return {
    D1: controls.length,
    D2: texts.length,
    D3: words,
    D4: containers,
    detail: { controls: controls.map((t) => t.name), texts, containers: containerNames },
  };
}

/**
 * Words of literal copy.
 *
 * Two sources, both explicit: literal text nodes between tags, and expression
 * children whose value is a declared copy constant. `GUEST_DISCLOSURE.body` is 40
 * words the technician reads; counting it as one `{expression}` would understate
 * the densest thing on the screen, and it is the constant ST-F18 AC 5 fences.
 */
export function countWords(jsx, copy) {
  let total = 0;
  let buf = '';
  let i = 0;

  while (i < jsx.length) {
    const ch = jsx[i];

    if (ch === '<' && /[A-Za-z/]/.test(jsx[i + 1] ?? '')) {
      total += wordsIn(buf);
      buf = '';
      const tag = openingTagAt(jsx, i);
      // Only the props a technician actually reads. `accessibilityLabel` is
      // announced, not drawn, and counting it put the guest disclosure's action
      // in twice — 62 words for a 56-word notice.
      for (const m of tag.matchAll(/\bplaceholder=(?:"([^"]*)"|'([^']*)')/g)) {
        total += wordsIn(m[1] ?? m[2]);
      }
      i += tag.length;
      continue;
    }

    if (ch === '{') {
      total += wordsIn(buf);
      buf = '';
      const { inner, end } = braceAt(jsx, i);
      const path = inner.trim();
      if (copy[path] !== undefined) total += wordsIn(copy[path]);
      i = end;
      continue;
    }

    buf += ch;
    i++;
  }

  total += wordsIn(buf);
  return total;
}

const wordsIn = (s) => (String(s).trim().match(/[A-Za-z0-9][A-Za-z0-9'’·—-]*/g) ?? []).length;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * Measure a declared scene: an ordered list of fragments, each naming the file,
 * the component, the render branch state, and why it is in this scene.
 *
 * @param {{name: string, note: string, fragments: Array<object>}} scene
 * @param {(rel: string) => string|null} read
 */
export function measureScene(scene, read, copy) {
  const totals = { D1: 0, D2: 0, D3: 0, D4: 0 };
  const parts = [];

  for (const f of scene.fragments) {
    const source = read(f.file);
    if (source === null) throw new Error(`density: cannot read ${f.file}`);
    const clean = normalizeApostrophes(blankComments(source));
    const jsx = pruneBranches(renderJsx(clean, f.fn, f.anchor), f.state ?? {});
    const counts = countFragment(jsx, { rules: styleRules(clean), copy });

    for (const k of ['D1', 'D2', 'D3', 'D4']) totals[k] += counts[k];
    parts.push({ label: f.label ?? `${f.file} · ${f.fn}`, why: f.why, ...counts });
  }

  return { name: scene.name, note: scene.note, totals, parts };
}
