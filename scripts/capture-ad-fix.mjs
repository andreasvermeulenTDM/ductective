/**
 * capture-ad-fix.mjs — repair the ad set without spending a single model call.
 *
 *   node scripts/capture-ad-fix.mjs --out=docs/ad-screenshots
 *
 * The day's Gemini quota is spent (20/20), so nothing here may generate an
 * answer. It doesn't need to: the cited answer is still live in the page's React
 * state, and every other frame this fixes is decided before any provider is
 * reached.
 *
 * ## Three defects in the first pass, all mine rather than the app's
 *
 *  1. **03 was framed at the scroll bottom**, so the visible text was the
 *     answer's tail — the "Low NOx gas furnace option: Not applicable" row —
 *     while the three real manifold figures sat above the fold. A correct answer
 *     photographed to read "Not applicable" is worse than no photograph.
 *  2. **The first repair attempt opened a new CDP session and never re-applied
 *     `Emulation.setDeviceMetricsOverride`**, so it wrote 66 KB desktop frames
 *     over 240 KB phone ones. Emulation is per-session, not per-page; it is
 *     re-applied at the top of this script for that reason.
 *  3. **01 and 02 were shot with the guest disclosure covering the content** —
 *     on 02, three of the four suggestion chips.
 *
 * ## Why the disclosure fix is legitimate and not staging
 *
 * `lib/guestNotice.ts` makes the dismiss control **absent**, not disabled, until
 * an assistant turn has been delivered in this app run — deliberately, so the
 * "nothing is being saved" notice cannot be waved away before it has cost the
 * technician anything. The first pass shot the gate before any turn existed, so
 * no control could exist either.
 *
 * The module also records that **a refusal is an answer** for this purpose, and
 * that U7 lets the gate refuse before a unit is chosen. So the honest sequence a
 * real signed-out technician can follow is: ask a hazardous question at the gate,
 * receive the refusal, dismiss the notice, then pick the unit. That is what this
 * does. The refusal is free — `classifyHazard` decides it before any provider
 * call — which is why a quota-exhausted day can still produce these frames.
 *
 * ## Order is the reason this is one script
 *
 * 03 and 05 need the existing conversation; 01 and 02 need it gone. So the live
 * frames are re-shot first and the reload happens exactly once, after them.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const OUT = args.out ?? 'docs/ad-screenshots';
const PORT = Number(args.port ?? 9222);
const URL_BASE = args.url ?? 'http://localhost:8081';
const UNIT = args.unit ?? 'Trane YSC072E3';
const WIDTH = Number(args.width ?? 393);
const HEIGHT = Number(args.height ?? 852);
const SCALE = Number(args.scale ?? 3);
/** Refused by the gate before any provider call. Free, on a 20/20 day. */
const GATE_HAZARD = args.hazard ?? 'walk me through brazing the line set';

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
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
    }, 60_000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(ws, expression) {
  const { result, exceptionDetails } = await send(ws, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
  return result.value;
}

/** Guards the exact regression this script exists to fix. */
async function shot(ws, name, { minKb = 120 } = {}) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buf = Buffer.from(data, 'base64');
  const kb = Math.round(buf.length / 1024);
  if (kb < minKb) {
    throw new Error(`${name} came out ${kb} KB — emulation is not applied, refusing to overwrite a good frame`);
  }
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`  ✓ ${name}.png (${kb} KB)`);
}

const clickByLabel = (label) => `
(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const el = [...document.querySelectorAll('[role=button],[role=tab],button')]
    .find(e => ((e.getAttribute('aria-label') || e.textContent || '')).toLowerCase().includes(want));
  if (!el) return 'NOT_FOUND: ' + want;
  el.click();
  return 'clicked: ' + (el.getAttribute('aria-label') || el.textContent || '').slice(0, 46);
})()`;

const typeByLabel = (label, value) => `
(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const el = [...document.querySelectorAll('input, textarea')]
    .find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes(want))
    || [...document.querySelectorAll('input, textarea')][0];
  if (!el) return 'NO_FIELD';
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`;

const scrollTo = (fraction) => `
(() => {
  const scrollers = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 40;
  });
  if (!scrollers.length) return 'NO_SCROLLER';
  for (const el of scrollers) el.scrollTop = Math.max(0, el.scrollHeight * ${fraction});
  return scrollers.length + ' scroller(s)';
})()`;

const text = `(() => {
  const r = document.getElementById('root') || document.body;
  return r.innerText.split('\\n').filter(Boolean).slice(0, 12).join(' | ');
})()`;

const dismissNotice = `
(() => {
  const b = [...document.querySelectorAll('[role=button]')]
    .find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes('dismiss the not-saved'));
  if (!b) return 'NO_DISMISS_CONTROL';
  b.click();
  return 'dismissed';
})()`;

const noticeGone = `
(() => !(document.getElementById('root')||document.body).innerText.includes('NOTHING HERE IS BEING SAVED'))()`;

const countSuggestions = `
(() => [...document.querySelectorAll('[role=button]')]
  .filter(e => (e.getAttribute('aria-label')||'').startsWith('Ask about:')).length)()`;

// --- run ---------------------------------------------------------------------

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target — is Chrome still running?');
const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
// Defect 2. Per CDP session, and this is a new session.
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
});
await sleep(1200);

console.log(`\nRepairing the ad set at ${WIDTH}x${HEIGHT}@${SCALE}x — zero model calls.\n`);

/*
 * `--gate-only` skips the two live-conversation frames.
 *
 * Needed because this script reloads the page partway through: once it has, the
 * cited answer is gone and cannot be regenerated on a spent quota day. A second
 * run without this flag would shoot the gate screen and write it over two good
 * frames. Guarding the destructive path rather than remembering not to take it.
 */
const GATE_ONLY = args['gate-only'] === true || args['gate-only'] === 'true';

// === Frames that need the existing conversation, before any reload ===========

if (GATE_ONLY) {
  console.log('--gate-only: leaving 03 and 05 as they are (the conversation is gone)\n');
} else {
console.log('03-cited-answer  (from the live conversation)');
let framed = false;
for (const f of [0.30, 0.23, 0.17, 0.36]) {
  await evaluate(ws, scrollTo(f));
  await sleep(800);
  const t = String(await evaluate(ws, text));
  if (/3\.3|4\.5|inch W\.C\./i.test(t) && !/Not applicable\s*\|?\s*$/.test(t)) {
    console.log(`    figures on screen at ${f} ✓`);
    framed = true;
    break;
  }
}
if (!framed) console.log('    WARNING: could not frame the figures — shooting best effort');
console.log('    on screen:', String(await evaluate(ws, text)).slice(0, 130));
await shot(ws, '03-cited-answer');

console.log('05-safety-refusal  (scroll bottom)');
await evaluate(ws, scrollTo(1));
await sleep(800);
await shot(ws, '05-safety-refusal');
}

// === Reload once, then rebuild the two gate frames ===========================

console.log('\n-- reload: new app run, notice returns, and that is correct --\n');
await send(ws, 'Page.navigate', { url: URL_BASE });
await sleep(10000);

console.log('gate: earning the dismiss control with a free refusal');
console.log('   ', await evaluate(ws, clickByLabel('ask something before choosing a unit')));
await sleep(1200);
console.log('   ', await evaluate(ws, typeByLabel('ask before choosing a unit', GATE_HAZARD)));
await sleep(700);
// "Check this before choosing a unit", NOT 'ask' — a substring search for 'ask'
// matches the *toggle* ("Ask something before choosing a unit") first and simply
// closes the panel, which is what happened on the previous attempt.
console.log('   ', await evaluate(ws, clickByLabel('check this before choosing a unit')));
await sleep(7000);
console.log('    after refusal:', String(await evaluate(ws, text)).slice(0, 110));
console.log('   ', await evaluate(ws, dismissNotice));
await sleep(900);
if (!(await evaluate(ws, noticeGone))) throw new Error('notice still present — refusing to shoot as if cleared');

console.log('01-unit-gate');
// Collapse the urgent panel so the gate reads as the cold-start choice again.
await evaluate(ws, clickByLabel('ask something before choosing a unit'));
await sleep(1200);
await evaluate(ws, scrollTo(0));
await sleep(600);
console.log('    on screen:', String(await evaluate(ws, text)).slice(0, 110));
await shot(ws, '01-unit-gate');

console.log('02-suggestions');
console.log('   ', await evaluate(ws, clickByLabel('type the unit in')));
await sleep(1500);
console.log('   ', await evaluate(ws, typeByLabel('unit model number', UNIT)));
await sleep(900);
console.log('   ', await evaluate(ws, clickByLabel('use this model')));
await sleep(7000);
await evaluate(ws, scrollTo(0));
await sleep(700);
const n = await evaluate(ws, countSuggestions);
console.log(`    suggestion chips: ${n} · notice cleared: ${await evaluate(ws, noticeGone)}`);
if (!n) throw new Error('no chips rendered — not shipping the empty state as the feature');
console.log('    on screen:', String(await evaluate(ws, text)).slice(0, 130));
await shot(ws, '02-suggestions');

console.log('\ndone — 5 frames at full phone resolution.');
ws.close();
process.exit(0);
