/**
 * capture-screens.mjs — real screenshots of the running app, for design handoff.
 *
 * Drives headless Chrome over the DevTools Protocol. Node ≥ 21 has a global
 * WebSocket, so this needs no Puppeteer and no new dependency — the same
 * "boring, working, few dependencies" rule the rest of the repo follows.
 *
 *   node scripts/capture-screens.mjs --url=http://localhost:8096 --out=docs/screenshots
 *
 * Chrome must already be listening:
 *   chrome --headless=new --remote-debugging-port=9222 --hide-scrollbars about:blank
 *
 * Not part of any pipeline stage. This is tooling for the marketing-site handoff
 * (E14, Phase 3), kept in the repo because a screenshot set that cannot be
 * regenerated goes stale the first time the UI moves.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const URL_BASE = args.url ?? 'http://localhost:8096';
const OUT = args.out ?? 'docs/screenshots';
const PORT = Number(args.port ?? 9222);
const WIDTH = Number(args.width ?? 390);
const HEIGHT = Number(args.height ?? 844);
const SCALE = Number(args.scale ?? 2);

mkdirSync(OUT, { recursive: true });

// --- minimal CDP client ------------------------------------------------------

let nextId = 1;
const pending = new Map();

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
  });
}

function send(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30_000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run an expression in the page and return its value. */
async function evaluate(ws, expression) {
  const { result, exceptionDetails } = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
  return result.value;
}

async function shot(ws, name) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  const kb = Math.round(Buffer.from(data, 'base64').length / 1024);
  console.log(`  ✓ ${name}.png (${kb} KB)`);
  return file;
}

/**
 * Click a control by its accessibility label.
 *
 * Labels, not selectors: React Native Web's class names are generated and change
 * between builds, but `accessibilityLabel` is a product decision that the a11y
 * tests already pin. A capture script keyed to them breaks loudly when the label
 * changes, which is the right time to notice.
 */
const clickByLabel = (label, exact = false) => `
(() => {
  const want = ${JSON.stringify(label)};
  const els = [...document.querySelectorAll('[role=button],[role=tab],button')];
  const el = els.find(e => {
    const l = e.getAttribute('aria-label') || e.textContent || '';
    return ${exact} ? l === want : l.includes(want);
  });
  if (!el) return 'NOT_FOUND: ' + want;
  el.click();
  return 'clicked: ' + (el.getAttribute('aria-label') || el.textContent || '').slice(0, 40);
})()`;

const typeInto = (value, index = 0) => `
(() => {
  const fields = [...document.querySelectorAll('input, textarea')];
  const el = fields[${index}];
  if (!el) return 'NO_FIELD';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`;

const dismissNotice = `
(() => {
  const b = [...document.querySelectorAll('[role=button]')]
    .find(e => (e.getAttribute('aria-label')||'').includes('Dismiss the not-saved'));
  if (b) { b.click(); return 'dismissed'; }
  return 'no notice';
})()`;

const hasCitations = `
(() => [...document.querySelectorAll('[role=button]')]
  .some(e => (e.getAttribute('aria-label')||'').startsWith('Source:')))()`;

const pageText = `(() => {
  const r = document.getElementById('root') || document.body;
  return r.innerText.split('\\n').filter(Boolean).slice(0, 6).join(' | ');
})()`;

// --- the run -----------------------------------------------------------------

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target — is Chrome running with --remote-debugging-port?');

const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: SCALE,
  mobile: true,
});

console.log(`Capturing ${WIDTH}x${HEIGHT} @${SCALE}x → ${OUT}/\n`);

async function load() {
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(6000); // Metro's first paint plus font load
}

const steps = [
  {
    name: '01-unit-gate',
    caption: 'Cold start. The app establishes which unit you are in front of before it takes a question.',
    async run() { await load(); },
  },
  {
    name: '02-manual-entry',
    caption: 'Typing the unit in — a front door, not a fallback, for a plate that is painted over.',
    async run() {
      console.log('   ', await evaluate(ws, clickByLabel('Type the unit in')));
      await sleep(1200);
    },
  },
  {
    name: '03-unit-typed',
    caption: 'Partial model numbers are fine — a faded plate is the normal case, not the edge case.',
    async run() {
      await evaluate(ws, typeInto('Trane Precedent YSC072E3'));
      await sleep(900);
    },
  },
  {
    name: '04-composer',
    caption: 'The composer, unlocked and scoped to the confirmed unit, with starting points for that machine.',
    async run() {
      console.log('   ', await evaluate(ws, clickByLabel('Use this model')));
      await sleep(3000);
    },
  },
  {
    name: '05-answer',
    caption: 'A cited answer: ordered checks, the reading to take, and a source chip per claim.',
    async run() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await evaluate(ws, typeInto('High head pressure, tripping the HP switch'));
        await sleep(600);
        console.log('    attempt', attempt, await evaluate(ws, clickByLabel('Send')));
        await sleep(34000);
        await evaluate(ws, dismissNotice);
        await sleep(500);
        if (await evaluate(ws, hasCitations)) { console.log('    cited ✓'); break; }
        console.log('    no citations — retrying');
      }
    },
  },
  {
    name: '06-citation-source',
    caption: 'Tapping a citation opens the passage without losing the answer behind it.',
    async run() {
      console.log('   ', await evaluate(ws, clickByLabel('Source:')));
      await sleep(1800);
    },
  },
  {
    name: '07-refusal',
    caption: 'A hard safety refusal. Alert red, no dismiss, no retry, no way past it.',
    async run() {
      await evaluate(ws, clickByLabel('Back to the answer'));
      await sleep(1000);
      await evaluate(ws, dismissNotice);
      await sleep(500);
      await evaluate(ws, typeInto('walk me through recovering the refrigerant charge'));
      await sleep(600);
      console.log('   ', await evaluate(ws, clickByLabel('Send')));
      await sleep(32000);
    },
  },
  {
    name: '08-history',
    caption: 'History. A job is identifiable by its unit and what came of it.',
    async run() {
      console.log('   ', await evaluate(ws, clickByLabel('History', true)));
      await sleep(2500);
    },
  },
  {
    name: '09-account',
    caption: 'Account. Signed out it is the sign-in screen; signed in it is the profile.',
    async run() {
      console.log('   ', await evaluate(ws, clickByLabel('Account', true)));
      await sleep(2000);
    },
  },
];

const captured = [];
for (const step of steps) {
  console.log(`${step.name}`);
  try {
    await step.run();
    console.log('    on screen:', (await evaluate(ws, pageText)).slice(0, 110));
    await shot(ws, step.name);
    captured.push({ name: step.name, caption: step.caption });
  } catch (e) {
    console.log(`  ✗ ${step.name}: ${e.message}`);
  }
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(captured, null, 2));
console.log(`\n${captured.length}/${steps.length} captured.`);
ws.close();
process.exit(0);
