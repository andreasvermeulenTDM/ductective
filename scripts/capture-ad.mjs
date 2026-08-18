/**
 * capture-ad.mjs — five phone screenshots for marketing use.
 *
 *   node scripts/capture-ad.mjs --url=http://localhost:8081 --out=docs/ad-screenshots
 *
 * Chrome must already be listening:
 *   chrome --headless=new --remote-debugging-port=9222 --hide-scrollbars about:blank
 *
 * Sibling of `capture-screens.mjs`, which captures nine states for design
 * handoff. This one is deliberately separate rather than a flag on that script,
 * for two reasons that both bite:
 *
 *  1. **Quota.** The design script retries the answer step up to three times,
 *     and every attempt is one Gemini generation against a 20/day free tier.
 *     An ad set that can cost three calls cannot be run on a day that has three
 *     left. This makes **exactly one** model call, and the question it asks was
 *     measured returning four citations earlier today, so the one call is not a
 *     gamble.
 *  2. **The refusal is free.** `classifyHazard` refuses before any provider is
 *     reached, so the safety shot — the most differentiated image in the set —
 *     costs nothing. Worth knowing before deciding what a capture run "costs".
 *
 * ## Honesty rules for a marketing asset
 *
 * Nothing here stages, mocks or dresses the product. It drives the real app
 * against the real server and the real corpus, and every citation in shot 3 is
 * a real page of a real Trane IOM. If a shot cannot be captured truthfully it is
 * reported missing rather than substituted — `index.json` lists only what was
 * actually written, which is the bug the previous set had: it named nine
 * captures while seven PNGs existed on disk.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const URL_BASE = args.url ?? 'http://localhost:8081';
const OUT = args.out ?? 'docs/ad-screenshots';
const PORT = Number(args.port ?? 9222);
// iPhone 14/15 logical size at 3x — the aspect ratio an App Store shot wants.
const WIDTH = Number(args.width ?? 393);
const HEIGHT = Number(args.height ?? 852);
const SCALE = Number(args.scale ?? 3);

/** The unit. One IOM, and it is the corpus this question was measured against. */
const UNIT = args.unit ?? 'Trane YSC072E3';
/**
 * The question for the single paid shot.
 *
 * Measured today by `tests/probes/installation-boundary-probe.mjs` (probe P3):
 * four citations, and every numeric token in each claim verified present on the
 * page it was attributed to. Chosen over a fault-diagnosis phrasing precisely
 * because it is proven — a prettier question that withholds would spend the
 * call and produce nothing to photograph.
 */
const QUESTION = args.question ?? 'what is the manifold pressure specification for natural gas';
/** Costs nothing: refused by the gate before any provider call. */
const REFUSAL_QUESTION = args.refusal ?? 'walk me through recovering the refrigerant charge';

mkdirSync(OUT, { recursive: true });

// --- minimal CDP client, same shape as capture-screens.mjs -------------------

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

async function shot(ws, name) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(OUT, `${name}.png`);
  const buf = Buffer.from(data, 'base64');
  writeFileSync(file, buf);
  console.log(`  ✓ ${name}.png (${Math.round(buf.length / 1024)} KB)`);
  return true;
}

/**
 * Click by accessibility label, substring, **case-insensitively**.
 *
 * The case-insensitivity is not incidental. `capture-screens.mjs` matches
 * case-sensitively and looks for "Back to the answer"; the citation sheet's
 * label is now "Close and go back to the answer", so that step silently found
 * nothing — which is part of why the 12 Aug set is missing its citation shot.
 */
const clickByLabel = (label) => `
(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const els = [...document.querySelectorAll('[role=button],[role=tab],button')];
  const el = els.find(e => ((e.getAttribute('aria-label') || e.textContent || '')).toLowerCase().includes(want));
  if (!el) return 'NOT_FOUND: ' + want;
  el.click();
  return 'clicked: ' + (el.getAttribute('aria-label') || el.textContent || '').slice(0, 50);
})()`;

const typeInto = (value, index = 0) => `
(() => {
  const fields = [...document.querySelectorAll('input, textarea')];
  const el = fields[${index}];
  if (!el) return 'NO_FIELD';
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed: ' + ${JSON.stringify(value)}.slice(0, 40);
})()`;

/** The guest banner is honest and correct — and it is chrome, not product. */
const dismissNotice = `
(() => {
  const b = [...document.querySelectorAll('[role=button]')]
    .find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes('dismiss the not-saved'));
  if (b) { b.click(); return 'dismissed'; }
  return 'no notice';
})()`;

const countCitations = `
(() => [...document.querySelectorAll('[role=button]')]
  .filter(e => (e.getAttribute('aria-label')||'').startsWith('Source:')).length)()`;

const countSuggestions = `
(() => [...document.querySelectorAll('[role=button]')]
  .filter(e => (e.getAttribute('aria-label')||'').startsWith('Ask about:')).length)()`;

const isRefusal = `
(() => (document.getElementById('root')||document.body).innerText.toLowerCase()
  .includes('your company'))()`;

const pageText = `(() => {
  const r = document.getElementById('root') || document.body;
  return r.innerText.split('\\n').filter(Boolean).slice(0, 5).join(' | ');
})()`;

// --- run ---------------------------------------------------------------------

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target — is Chrome running with --remote-debugging-port?');

const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
});

console.log(`\nAd capture — ${WIDTH}x${HEIGHT} @${SCALE}x → ${OUT}/`);
console.log(`unit: ${UNIT}\nbudget: exactly one model call (shot 3); shots 1, 2, 4 and 5 are free\n`);

const captured = [];
const missing = [];

async function step(name, caption, fn) {
  console.log(name);
  try {
    await fn();
    console.log('    on screen:', String(await evaluate(ws, pageText)).slice(0, 100));
    await shot(ws, name);
    captured.push({ name, caption, file: `${name}.png` });
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    missing.push({ name, reason: e.message });
  }
}

// 1 — the unit gate. Free.
await step('01-unit-gate', 'Every answer is tied to the machine in front of you, so the app asks which one before it takes a question.', async () => {
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(9000);
});

// 2 — the confirmed unit with its suggestion chips. Free, and it is the round-4 feature.
await step('02-suggestions', 'Suggestions mined from that unit’s own manuals — each one validated as answerable before it is offered.', async () => {
  console.log('   ', await evaluate(ws, clickByLabel('type the unit in')));
  await sleep(1500);
  console.log('   ', await evaluate(ws, typeInto(UNIT)));
  await sleep(1000);
  console.log('   ', await evaluate(ws, clickByLabel('use this model')));
  await sleep(6000);
  await evaluate(ws, dismissNotice);
  await sleep(800);
  const n = await evaluate(ws, countSuggestions);
  console.log(`    suggestion chips on screen: ${n}`);
  if (!n) throw new Error('no suggestion chips rendered — not shipping a shot of the empty state as the feature');
});

// 3 — the cited answer. THE one model call.
await step('03-cited-answer', 'A cited answer: the figure, and a source chip per claim naming the document and page it came from.', async () => {
  console.log('   ', await evaluate(ws, typeInto(QUESTION, 0)));
  await sleep(800);
  console.log('   ', await evaluate(ws, clickByLabel('send')));
  await sleep(40000);
  await evaluate(ws, dismissNotice);
  await sleep(1000);
  const n = await evaluate(ws, countCitations);
  console.log(`    citations on screen: ${n}`);
  if (!n) throw new Error('answer came back uncited — refusing to photograph it as a cited answer');
});

// 4 — the source passage. Free; it reuses shot 3's answer.
await step('04-source-passage', 'Tapping a citation opens the passage it came from, without losing the answer behind it.', async () => {
  console.log('   ', await evaluate(ws, clickByLabel('source:')));
  await sleep(2500);
});

// 5 — the refusal. Free, and the most differentiated image in the set.
await step('05-safety-refusal', 'It advises; it never talks you through gas, live electrical or refrigerant work. The refusal has no dismiss and no way past it.', async () => {
  await evaluate(ws, clickByLabel('back to the answer'));
  await sleep(1500);
  await evaluate(ws, dismissNotice);
  await sleep(600);
  console.log('   ', await evaluate(ws, typeInto(REFUSAL_QUESTION, 0)));
  await sleep(800);
  console.log('   ', await evaluate(ws, clickByLabel('send')));
  await sleep(6000);
  if (!(await evaluate(ws, isRefusal))) throw new Error('expected a refusal on screen and did not find one');
});

// `index.json` names only files that exist — the previous set's manifest listed
// nine captures against seven PNGs, which is how a stale asset gets shipped.
const verified = captured.filter((c) => existsSync(join(OUT, c.file)));
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  unit: UNIT, question: QUESTION, viewport: `${WIDTH}x${HEIGHT}@${SCALE}x`,
  captured: verified, missing,
}, null, 2));

console.log(`\n${verified.length}/5 captured.`);
if (missing.length) {
  console.log('missing (reported, never substituted):');
  for (const m of missing) console.log(`  ${m.name} — ${m.reason}`);
}
ws.close();
process.exit(missing.length ? 1 : 0);
