/**
 * Epic 6 — Chat & camera experience. Run C, machine-checkable half.
 * Stories E6.4, E6.7, E6.8, E6.10 · Run C brief AC 4, 7, 9, 10.
 *
 * Everything in E6 that needs a phone — streaming, time-to-first-token, tablet
 * layout, the 10 nameplate photos, the nine-state screenshot set — is in
 * suites/human-only.mjs and is never claimed here.
 *
 * These run in every round rather than only in Run C: E6.4 and E6.8 guard the
 * citation contract and the token module, and both are exactly the kind of thing
 * a later refactor breaks quietly.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';
import { extractHexTokens } from '../lib/contrast.mjs';
import { evaluateMatrix, coverageGaps, TEXT_PAIRS, NON_TEXT_PAIRS, FLOOR } from '../lib/contrastMatrix.mjs';
import { findTags, attributeValue, blankComments } from '../lib/jsx.mjs';

const TOKENS = 'app/theme/tokens.ts';
const MESSAGE = 'app/components/Message.tsx';
const CITATION = 'app/components/Citation.tsx';

/** Every .ts/.tsx under app/, excluding node_modules. */
function appSources(c) {
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
  return files;
}

/** Offsets are preserved, so reported line numbers point at the real file. */
const stripComments = blankComments;

export default defineSuite({
  epic: 'E6',
  title: 'Chat & camera experience (machine-checkable half)',
  run: '*',
  checks: [
    {
      story: 'E6.4',
      ac: 'Run C AC 4',
      what: 'an answer with no citation cannot render as a claim',
      async run(c) {
        const src = c.read(MESSAGE);
        if (!src) return blocked(`${MESSAGE} not found`);
        const code = stripComments(src);

        // E6.4 calls this a rendering contract, not a nicety: the component must
        // refuse to draw an uncited claim, so that no upstream bug can produce
        // one. Checking the guard exists is checking the contract itself.
        const guard = /citations\.length\s*===\s*0/.test(code);
        const routesElsewhere = /citations\.length\s*===\s*0\s*\)\s*return\s*<\s*(\w+)/.exec(code);
        const target = routesElsewhere?.[1];
        const rendersAsAnswer = target && /answer/i.test(target);

        const ev = c.fromFile(
          MESSAGE,
          `zero-citation guard present: ${guard}\nroutes to: ${target ?? '(nothing)'}`
        );
        if (!guard) return fail(ev, 'no zero-citation guard — an uncited claim can render as an answer');
        if (rendersAsAnswer) return fail(ev, `zero-citation answers route to ${target}, which renders as an answer`);
        return pass(ev, `uncited answers route to ${target}`);
      },
    },

    {
      story: 'E6.4',
      ac: 'Run C AC 4',
      what: 'a citation cannot exist without a document name and a page',
      async run(c) {
        const src = c.read('app/lib/supabase.ts');
        if (!src) return blocked('app/lib/supabase.ts not found');

        const m = /export type Citation = \{([\s\S]*?)\}/.exec(src);
        if (!m) return fail(c.fromFile('app/lib/supabase.ts', 'Citation type not found'), 'no Citation type');

        const body = m[1];
        const required = [
          { field: 'source_document', re: /source_document\s*:\s*string\s*;/ },
          { field: 'page', re: /page\s*:\s*number\s*;/ },
        ];
        const optional = required.filter((r) => !r.re.test(body)).map((r) => r.field);

        const ev = c.fromFile('app/lib/supabase.ts', `type Citation = {${body}}`);
        return optional.length === 0
          ? pass(ev, 'source_document and page are both required and non-nullable')
          : fail(ev, `${optional.join(', ')} is optional or nullable — a citation that cannot name its page is unverifiable`);
      },
    },

    {
      story: 'E6.4',
      ac: 'Run C AC 4, AC 7',
      what: 'the citation chip announces its document and page to a screen reader',
      async run(c) {
        const src = c.read(CITATION);
        if (!src) return blocked(`${CITATION} not found`);
        const code = stripComments(src);
        const labels = findTags(code, ['Pressable', 'TouchableOpacity'])
          .map((t) => attributeValue(t.source, 'accessibilityLabel'))
          .filter(Boolean);

        // Some control in this file must announce both halves. Which control it
        // is does not matter; that a screen-reader user hears the document and
        // the page does.
        const label = labels.find((l) => /source_document/.test(l) && /page/i.test(l));
        const namesDoc = Boolean(label);
        const namesPage = Boolean(label);

        const ev = c.fromFile(
          CITATION,
          labels.length ? labels.map((l) => `accessibilityLabel: ${l}`).join('\n') : '(no labelled control)'
        );
        return namesDoc && namesPage
          ? pass(ev)
          : fail(ev, 'the citation chip label does not announce both the document and the page');
      },
    },

    {
      story: 'E6.7',
      ac: 'Run C AC 7',
      what: 'the touch-target floor is 48dp and is defined once',
      async run(c) {
        const src = c.read(TOKENS);
        if (!src) return blocked(`${TOKENS} not found`);
        const m = /MIN_TOUCH\s*=\s*(\d+)/.exec(src);
        const value = m ? Number(m[1]) : null;
        const ev = c.fromFile(TOKENS, m?.[0] ?? '(MIN_TOUCH not defined)');
        if (value === null) return fail(ev, 'MIN_TOUCH is not defined in the token module');
        return value >= 48 ? pass(ev, `MIN_TOUCH = ${value}`) : fail(ev, `MIN_TOUCH is ${value}, under the 48dp floor`);
      },
    },

    {
      story: 'E6.7',
      ac: 'Run C AC 7 · ST-F16',
      what: 'body text clears 4.5:1 on every surface it is actually drawn on',
      async run(c) {
        // ST-F16. This check used to build its pairs out of *palette* constants
        // (`['textPrimary → background', t.mist, t.ink]`) behind semantic labels,
        // so it asserted Mist-on-Ink and would have kept passing if
        // `color.background` were changed to white. It now resolves the semantic
        // roles from `export const color`, composites the rgba roles over their
        // real backdrop, and carries the file:line of every pairing.
        const src = c.read(TOKENS);
        if (!src) return blocked(`${TOKENS} not found`);

        const { rows, failures } = evaluateMatrix(src);
        const ev = c.fromCheck(
          `WCAG 2.1 contrast over ${TEXT_PAIRS.length} semantic text pairings ` +
          `+ ${NON_TEXT_PAIRS.length} non-text, resolved from ${TOKENS}`,
          rows.join('\n')
        );
        return failures.length === 0
          ? pass(ev, `every one of ${TEXT_PAIRS.length} text pairings clears ${FLOOR.toFixed(1)}:1`)
          : fail(ev, `under ${FLOOR.toFixed(1)}:1 — ${failures.join('; ')}`);
      },
    },

    {
      story: 'E6.7',
      ac: 'Run C AC 7 · ST-F16',
      what: 'every colour role a screen draws is covered by the contrast matrix',
      async run(c) {
        // The guard on the guard. A matrix is only as current as the last person
        // who edited it, and the defect ST-F16 exists to remove was a table that
        // had quietly stopped describing the app. A role that starts being drawn
        // and is not measured fails here, with the file:line that introduced it.
        const sources = appSources(c)
          .filter((f) => f !== TOKENS)
          .map((f) => ({ file: f, source: stripComments(c.read(f) ?? '') }));

        const { gaps, foregrounds, backgrounds } = coverageGaps(sources);
        const ev = c.fromCheck(
          `scan ${sources.length} app sources for color/backgroundColor roles`,
          [
            `foreground roles drawn: ${foregrounds.join(', ')}`,
            `background roles drawn: ${backgrounds.join(', ')}`,
            '',
            gaps.join('\n') || '(every drawn role appears in the matrix)',
          ].join('\n')
        );
        return gaps.length === 0
          ? pass(ev, `${foregrounds.length} foreground and ${backgrounds.length} background roles, all measured`)
          : fail(ev, `${gaps.length} colour role(s) drawn but not measured`);
      },
    },

    {
      story: 'E6.7',
      ac: 'Run C AC 7',
      what: 'every interactive element carries an accessibility label',
      async run(c) {
        const offenders = [];
        let total = 0;
        for (const f of appSources(c)) {
          const code = stripComments(c.read(f) ?? '');
          for (const tag of findTags(code, ['Pressable', 'TouchableOpacity', 'TouchableHighlight'])) {
            total++;
            const label = attributeValue(tag.source, 'accessibilityLabel');
            // A control whose child *is* the label (a text button) is announced
            // by its content, so an explicit label is redundant rather than
            // missing. Only flag controls with neither.
            const labelledByRole = /accessibilityRole=/.test(tag.source) && /accessibilityLabel/.test(tag.source);
            if (!label && !labelledByRole) {
              const line = code.slice(0, tag.index).split('\n').length;
              offenders.push(`${f}:${line} <${tag.name}> with no accessibilityLabel`);
            }
          }
        }
        const ev = c.fromCheck(
          `scan ${total} Pressable/Touchable tags across app sources`,
          offenders.join('\n') || `(all ${total} interactive elements are labelled)`
        );
        return offenders.length === 0
          ? pass(ev, `${total} interactive elements, all labelled`)
          : fail(ev, `${offenders.length} of ${total} interactive element(s) unlabelled`);
      },
    },

    {
      story: 'E6.8',
      ac: 'Run C AC 9',
      what: 'no hardcoded hex outside the token module',
      async run(c) {
        // E6.8 states the rule is greppable and is meant to be grepped, and that
        // the grep result is reported. Comments are stripped first: tokens.ts's
        // provenance notes and Message.tsx's rationale both cite hex values in
        // prose, and prose is not a style value.
        const offenders = [];
        for (const f of appSources(c)) {
          if (f === TOKENS) continue;
          const code = stripComments(c.read(f) ?? '');
          for (const m of code.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)) {
            offenders.push(`${f}: ${m[1]}`);
          }
        }
        const ev = c.fromCheck(
          `grep ${appSources(c).length - 1} app sources for hex literals, comments stripped`,
          offenders.join('\n') || '(no hex literal outside the token module)'
        );
        return offenders.length === 0
          ? pass(ev)
          : fail(ev, `${offenders.length} hardcoded hex value(s) outside ${TOKENS}`);
      },
    },

    {
      story: 'E6.8',
      ac: 'Run C AC 9',
      what: 'Outfit is the UI typeface and the cyan accent is not recoloured',
      async run(c) {
        const src = c.read(TOKENS);
        if (!src) return blocked(`${TOKENS} not found`);
        const t = extractHexTokens(src);
        const outfit = /Outfit_\d{3}\w+/.test(src);
        const cyan = t.cyanRead?.toUpperCase() === '#5CD0F5';

        const ev = c.fromFile(
          TOKENS,
          `Outfit families declared: ${outfit}\ncyanRead: ${t.cyanRead ?? '(absent)'} (brand value #5CD0F5)`
        );
        if (!outfit) return fail(ev, 'the token module does not declare the Outfit families');
        return cyan ? pass(ev) : fail(ev, `cyanRead is ${t.cyanRead} — the brand accent has been recoloured`);
      },
    },

    {
      story: 'E6.8',
      ac: 'Run C AC 9',
      what: 'the token module stays liftable — no React Native imports',
      async run(c) {
        const src = c.read(TOKENS);
        if (!src) return blocked(`${TOKENS} not found`);
        // The file's own header commits to this so the Phase 3 marketing site
        // (E14) can consume the same tokens without a rewrite.
        const rn = /from\s+'react-native'/.test(stripComments(src));
        const ev = c.fromFile(TOKENS, `imports react-native: ${rn}`);
        return rn ? fail(ev, 'the token module imports react-native and is no longer liftable') : pass(ev);
      },
    },

    {
      story: 'E6.10',
      ac: 'Run C AC 10',
      what: 'component tests cover message, citation, and refusal rendering',
      requires: 'frontend',
      async run(c) {
        // Run-aware gate. The frontend artifact existing is not the same thing as
        // Run C's frontend having landed: Run A's Stage 4 is a prescribed
        // nothing-to-do handoff, and opening this Run C criterion against it
        // would manufacture a FAIL for work no run has started.
        const artifact = c.read('.pipeline/04-frontend.md') ?? '';
        if (/nothing to do/i.test(artifact) && /Run A/i.test(artifact)) {
          return blocked('Run C AC — Stage 4 in Run A is a nothing-to-do handoff; component tests are Run C frontend work');
        }
        const found = appSources(c).filter((f) => /\.(test|spec)\.tsx?$/.test(f));
        const ev = c.fromCheck(
          'scan app/ for component test files',
          found.join('\n') || '(no component test files)'
        );
        return found.length > 0
          ? pass(ev, `${found.length} component test file(s)`)
          : fail(ev, 'no component tests — E6.10 routes to Frontend');
      },
    },
  ],
});
