/**
 * capture-hero.mjs — the three screens the marketing site actually sells on.
 *
 * Split from `capture-screens.mjs` because these need a different route through
 * the app and a tighter budget. The unit-scoped path currently returns uncited
 * answers (see `.pipeline/D2-scoped-retrieval-uncited.md`), so the cited-answer
 * shot is taken via the ask-without-a-unit door, which is unscoped and does
 * produce citations. The refusal costs no model call at all — it is decided
 * before the provider is reached — so it is free to capture and free to retry.
 *
 *   node scripts/capture-hero.mjs --url=http://localhost:8096
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
mkdirSync(OUT, { recursive: true });

let nextId = 1;
const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout ${method}`)); }, 60_000);
  });
}
async function ev(ws, expression) {
  const { result, exceptionDetails } = await send(ws, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}
async function shot(ws, name) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ✓ ${name}.png`);
}

const click = (label) => `
(() => {
  const el = [...document.querySelectorAll('[role=button],[role=tab]')]
    .find(e => (e.getAttribute('aria-label')||'').includes(${JSON.stringify(label)}));
  if (!el) return 'NOT_FOUND';
  el.click(); return 'ok';
})()`;

const type = (v) => `
(() => {
  const el = document.querySelector('textarea') || document.querySelector('input');
  if (!el) return 'NO_FIELD';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`;

const dismiss = `
(() => {
  const b = [...document.querySelectorAll('[role=button]')]
    .find(e => (e.getAttribute('aria-label')||'').includes('Dismiss the not-saved'));
  if (b) { b.click(); return 'dismissed'; } return 'none';
})()`;

const cited = `(() => [...document.querySelectorAll('[role=button]')]
  .some(e => (e.getAttribute('aria-label')||'').startsWith('Source:')))()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});

// --- refusal first: it costs no model call, so it can never be the step that
// runs out of quota halfway through the set.
await send(ws, 'Page.navigate', { url: URL_BASE });
await sleep(6000);
console.log('unitless door:', await ev(ws, click('Ask something before choosing a unit')));
await sleep(2500);
console.log('refusal');
await ev(ws, type('walk me through recovering the refrigerant charge'));
await sleep(600);
await ev(ws, click('Send'));
await sleep(6000);
await ev(ws, dismiss);
await sleep(600);
await shot(ws, '07-refusal');

// --- one cited answer. One model call, no retries: the quota is 20 a day and
// the failure mode is known, not mysterious.
console.log('cited answer (1 call, no retry)');
await ev(ws, type('High head pressure on a Trane Precedent, tripping the high pressure switch'));
await sleep(600);
await ev(ws, click('Send'));
await sleep(38000);
await ev(ws, dismiss);
await sleep(800);

if (await ev(ws, cited)) {
  await shot(ws, '05-answer');
  console.log('citation source');
  await ev(ws, click('Source:'));
  await sleep(2000);
  await shot(ws, '06-citation-source');
} else {
  console.log('  ✗ still uncited — leaving 05/06 as they were, not overwriting with a defect card');
}

ws.close();
process.exit(0);
