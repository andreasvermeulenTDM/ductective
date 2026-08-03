/**
 * Epic 5 — Safety guardrails. Runs in EVERY round.
 * Stories E5.1–E5.3 · Run C brief AC 5.
 *
 * CLAUDE.md: the system advises, never instructs through gas/combustion, live
 * electrical, or refrigerant work, and no stage may weaken this to make a story
 * pass. E5.1 puts it plainly — a single leak blocks the round.
 *
 * Whether a refusal *holds under pressure* is Stage 5.5's measurement and is not
 * duplicated here. What this suite owns is the mechanical half: that the refusal
 * path exists, that it renders unmistakably, and that no bypass affordance has
 * been added. A core that refuses correctly can still leak through a UI that
 * lets a technician click past the refusal.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';
import { contrastRatio, extractHexTokens } from '../lib/contrast.mjs';

const TOKENS = 'app/theme/tokens.ts';
const MESSAGE = 'app/components/Message.tsx';

/** Every phrasing that would let a technician proceed past a refusal. */
const BYPASS_PATTERNS = [
  /show\s+me\s+anyway/i,
  /continue\s+anyway/i,
  /proceed\s+anyway/i,
  /i\s+understand\s+the\s+risks?/i,
  /override\s+(the\s+)?(safety|refusal|warning)/i,
  /dismiss\s+(the\s+)?refusal/i,
  /skip\s+(the\s+)?(safety|warning)/i,
];

/** Grab a named function's source so a check can assert on its body alone. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      started = true;
    } else if (source[i] === '}') {
      depth--;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

export default defineSuite({
  epic: 'E5',
  title: 'Safety guardrails',
  run: '*',
  checks: [
    {
      story: 'E5.2',
      ac: 'Run C AC 5',
      what: 'all three refusal categories have a reachable refusal path',
      async run(c) {
        // Against the prototype's answer source today; against the Run B core
        // once it lands. Either way the assertion is the same: a technician
        // asking about any of the three categories must hit a refusal.
        const source = c.read('app/lib/mockDiagnostics.ts') ?? c.read('app/lib/diagnostics.ts');
        if (!source) return blocked('no answer source found in app/lib — neither mockDiagnostics.ts nor diagnostics.ts');

        const categories = [
          { name: 'gas/combustion', re: /gas|combustion|ignit|flame|burner|rollout|heat exchanger/i },
          { name: 'live electrical', re: /electric|volt|megger|capacitor|contactor|live/i },
          { name: 'refrigerant handling', re: /refrigerant|charge|superheat|subcool|recover|braze/i },
        ];

        // A category counts only if its matcher sits on a block that refuses.
        const blocks = source.split(/\{\s*match:/).slice(1);
        const covered = categories.filter((cat) =>
          blocks.some((b) => cat.re.test(b.split('\n')[0]) && /kind:\s*'refusal'/.test(b))
        );
        const missing = categories.filter((cat) => !covered.includes(cat)).map((c) => c.name);

        const ev = c.fromCheck(
          'match each refusal category against blocks whose reply kind is refusal',
          categories.map((cat) => `${covered.includes(cat) ? 'ok  ' : 'MISS'}  ${cat.name}`).join('\n')
        );
        return missing.length === 0
          ? pass(ev, 'all three categories refuse')
          : fail(ev, `no refusal path for: ${missing.join(', ')} — this is a guardrail leak, Critical`);
      },
    },

    {
      story: 'E5.2',
      ac: 'Run C AC 5',
      what: 'the refusal renders in alert red drawn from the token module',
      async run(c) {
        const msg = c.read(MESSAGE);
        if (!msg) return blocked(`${MESSAGE} not found`);
        const usesToken = /color\.refusal\b/.test(msg) && /color\.refusalText\b/.test(msg);
        const hardcoded = /#C0453C/i.test(msg.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' ')));
        const ev = c.fromFile(
          MESSAGE,
          `uses color.refusal + color.refusalText: ${usesToken}\nhardcodes #C0453C outside comments: ${hardcoded}`
        );
        if (hardcoded) return fail(ev, 'the refusal colour is hardcoded rather than taken from the token module');
        return usesToken ? pass(ev) : fail(ev, 'refusal does not use the refusal tokens');
      },
    },

    {
      story: 'E5.2',
      ac: 'Run C AC 5, AC 7',
      what: 'refusal text clears 4.5:1 on every surface it lands on',
      async run(c) {
        const src = c.read(TOKENS);
        if (!src) return blocked(`${TOKENS} not found`);
        const tokens = extractHexTokens(src);

        // tokens.ts states these ratios in a comment. A number in a comment is an
        // assertion; this turns it into a check — and this is the single most
        // safety-critical label in the app, so it is the one that must not drift.
        const pairs = [
          ['refusalText', 'refusalSurface'],
          ['refusalText', 'ink'],
          ['refusalText', 'steel900'],
        ];
        const rows = [];
        let worst = Infinity;
        for (const [fg, bg] of pairs) {
          if (!tokens[fg] || !tokens[bg]) {
            return fail(
              c.fromFile(TOKENS, `token missing: ${!tokens[fg] ? fg : bg}`),
              `${!tokens[fg] ? fg : bg} is no longer defined as a hex literal`
            );
          }
          const ratio = contrastRatio(tokens[fg], tokens[bg]);
          worst = Math.min(worst, ratio);
          rows.push(`${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}): ${ratio.toFixed(2)}:1 ${ratio >= 4.5 ? 'ok' : 'FAIL'}`);
        }

        const ev = c.fromCheck('WCAG 2.1 contrast over app/theme/tokens.ts', rows.join('\n'));
        return worst >= 4.5
          ? pass(ev, `worst pair ${worst.toFixed(2)}:1`)
          : fail(ev, `refusal text falls to ${worst.toFixed(2)}:1 — under the 4.5:1 floor E5.2 requires on dark`);
      },
    },

    {
      story: 'E5.2',
      ac: 'Run C AC 5',
      what: 'the refusal card is not dismissible, collapsible, or retryable',
      async run(c) {
        const msg = c.read(MESSAGE);
        if (!msg) return blocked(`${MESSAGE} not found`);

        const card = functionBody(msg, 'RefusalCard');
        if (!card) return fail(c.fromFile(MESSAGE, 'RefusalCard not found'), 'no RefusalCard component to check');

        // Comments in this file discuss the affordances that are deliberately
        // absent, so they are stripped before asserting — otherwise the file's
        // own explanation of what it does not do would fail the check.
        const code = card.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
        const interactive = [
          ['Pressable', /\bPressable\b/],
          ['onPress', /\bonPress\b/],
          ['TouchableOpacity', /\bTouchableOpacity\b/],
          ['Button', /\bButton\b/],
          ['collapse toggle', /collaps|expand|toggle/i],
        ].filter(([, re]) => re.test(code)).map(([name]) => name);

        const ev = c.fromCheck(
          'RefusalCard body, comments stripped',
          `interactive affordances found: ${interactive.join(', ') || '(none)'}\n\n${code.trim().slice(0, 600)}`
        );
        return interactive.length === 0
          ? pass(ev, 'no way to click past the refusal')
          : fail(ev, `the refusal carries ${interactive.join(', ')} — a refusal a technician can click past is not a refusal`);
      },
    },

    {
      story: 'E5.2',
      ac: 'Run C AC 5',
      what: 'no bypass affordance exists anywhere in the app',
      async run(c) {
        const files = [];
        const walk = (dir) => {
          for (const entry of c.list(dir)) {
            if (entry === 'node_modules' || entry.startsWith('.')) continue;
            const rel = `${dir}/${entry}`;
            if (/\.(ts|tsx)$/.test(entry)) files.push(rel);
            else if (!entry.includes('.')) walk(rel);
          }
        };
        walk('app');

        const hits = [];
        for (const f of files) {
          const code = (c.read(f) ?? '').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
          for (const re of BYPASS_PATTERNS) {
            const m = code.match(re);
            if (m) hits.push(`${f}: ${m[0]}`);
          }
        }

        const ev = c.fromCheck(
          `scanned ${files.length} app source files for bypass phrasing`,
          hits.join('\n') || '(no bypass affordance found)'
        );
        return hits.length === 0
          ? pass(ev)
          : fail(ev, `${hits.length} bypass affordance(s) — E5.2 forbids any "continue anyway" path`);
      },
    },

    {
      story: 'E5.1',
      what: 'refusals hold across rephrasing and pressure',
      run: async () =>
        blocked(
          'scored by Stage 5.5 (eval), not Stage 5 — probing refusal robustness is a measurement, not a code check'
        ),
    },

    {
      story: 'E5.3',
      what: 'guidance is framed as advise-only, not step-by-step through hazardous work',
      run: async () =>
        blocked('scored by Stage 5.5 (eval) — framing is a judgment about answer content'),
    },
  ],
});
