/**
 * capture-answers.mjs — phone frames of the app returning answers.
 *
 *   npm run capture:answers
 *
 * Sibling of `capture-ad.mjs`. That one walks the whole first-run story and
 * spends exactly one model call; this one is about the part a technician
 * actually buys — a question going in and a cited answer coming back — and
 * spends one call per answer.
 *
 * ## The framing rules, learned by getting them wrong
 *
 * The 17 Aug pass shot its answer at the message list's **scroll bottom**, so the
 * visible text was the answer's tail — a "Not applicable" row and the advice-only
 * footer — while the figures sat above the fold. A correct answer photographed to
 * read "Not applicable" is worse than no photograph.
 *
 * Three rules, each enforced below rather than hoped for:
 *
 *  1. **Scroll to the question, not to the bottom.** Putting the technician's own
 *     bubble at the top of the viewport frames the turn the way it reads —
 *     question above, answer beneath. Framing on the answer alone loses what was
 *     asked, which is half the story.
 *  2. **Clear the composer before the shutter.** The previous set shipped a frame
 *     with leftover text sitting in the input.
 *  3. **Shoot only what is actually cited.** A turn that comes back uncited or as
 *     a withhold is reported and skipped, never relabelled. The corpus is honest
 *     about what it does not hold and the screenshots have to be too.
 *
 * ## Quota
 *
 * One Gemini call per answer, two if the model clarifies first. The run prints the
 * ledger at both ends and refuses to start a set the day cannot pay for.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { budget } from '../lib/ledger.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const OUT = args.out ?? 'docs/ad-screenshots';
const PORT = Number(args.port ?? 9222);
const URL_BASE = args.url ?? 'http://localhost:8081';
const LEDGER = 'scripts/quota-ledger.json';
const WIDTH = 393, HEIGHT = 852, SCALE = 3;

mkdirSync(OUT, { recursive: true });

/**
 * The turns. Each is a real question against a real unit.
 *
 * `chip` means "tap the suggestion the app itself offered" rather than typing —
 * the flow N4 built, and the one worth showing: the app proposes a question it
 * has already proved it can answer, then answers it.
 */
const TURNS = [
  {
    name: '06-answer-fault-code',
    unit: 'Bosch IDS Ultra',
    chip: 'A11',
    caption: 'Tap a suggestion the app has already proved it can answer — and it answers it, cited.',
  },
  {
    name: '07-answer-trane-fault',
    unit: 'Trane YSC072E3',
    chip: 'Flashes',
    caption: 'A blink code on a single-manual unit, answered from that manual.',
  },
  {
    name: '08-answer-with-sources',
    unit: 'Bosch IDS Ultra',
    chip: '1L52',
    // Framed low on purpose: this is the frame that has to show the source chips,
    // so it scrolls past the prose rather than starting at the question.
    frame: 'citations',
    caption: 'Every claim carries the document and page behind it.',
  },
];

let nextId = 1;
const pending = new Map();

const connect = (u) => new Promise((res, rej) => {
  const ws = new WebSocket(u);
  ws.addEventListener('open', () => res(ws));
  ws.addEventListener('error', rej);
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
});

const send = (ws, method, params = {}) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 90000);
  });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ev = async (ws, expr) => {
  const { result, exceptionDetails } = await send(ws, 'Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
  return result.value;
};

async function shot(ws, name) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buf = Buffer.from(data, 'base64');
  const kb = Math.round(buf.length / 1024);
  // Emulation is per CDP session; an undersized frame means it was not applied.
  if (kb < 100) throw new Error(`${name} is ${kb} KB — emulation not applied, refusing to write`);
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`  ok  ${name}.png (${kb} KB)`);
}

const click = (label) => `
(() => {
  const w = ${JSON.stringify(label)}.toLowerCase();
  const el = [...document.querySelectorAll('[role=button],[role=tab],button')]
    .find(e => ((e.getAttribute('aria-label') || e.textContent || '')).toLowerCase().includes(w));
  if (!el) return 'NOT_FOUND: ' + w;
  el.click();
  return 'clicked: ' + (el.getAttribute('aria-label') || el.textContent || '').slice(0, 52);
})()`;

const typeByLabel = (label, value) => `
(() => {
  const w = ${JSON.stringify(label)}.toLowerCase();
  const fields = [...document.querySelectorAll('input, textarea')];
  const el = fields.find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes(w)) || fields[0];
  if (!el) return 'NO_FIELD';
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`;

/** Rule 2 — the composer must be empty when the shutter opens. */
const CLEAR_COMPOSER = `
(() => {
  const el = [...document.querySelectorAll('input, textarea')]
    .find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes('symptom'));
  if (!el) return 'no composer';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.blur();
  return 'cleared';
})()`;

/**
 * Rule 1 — put the technician's own bubble at the top of the viewport.
 *
 * Matches on a prefix of the question text and takes the *last* match, because
 * the question also appears in the header subtitle; the bubble is the later node
 * in document order.
 */
const frameOnQuestion = (needle) => `
(() => {
  const want = ${JSON.stringify(needle)}.toLowerCase().slice(0, 26);
  const els = [...document.querySelectorAll('div,span')]
    .filter(e => (e.innerText || '').toLowerCase().includes(want) && e.children.length <= 3);
  if (!els.length) return 'QUESTION_NOT_FOUND';
  els[els.length - 1].scrollIntoView({ block: 'start' });
  return 'framed on the question';
})()`;

/** Frame the citation row — used by the shot whose subject IS the sources. */
const FRAME_ON_CITATIONS = `
(() => {
  const chips = [...document.querySelectorAll('[role=button]')]
    .filter(e => (e.getAttribute('aria-label')||'').startsWith('Source:'));
  if (!chips.length) return 'NO_CITATIONS_TO_FRAME';
  chips[0].scrollIntoView({ block: 'center' });
  return 'framed on ' + chips.length + ' citation(s)';
})()`;

const DISMISS_NOTICE = `
(() => {
  const b = [...document.querySelectorAll('[role=button]')]
    .find(e => (e.getAttribute('aria-label')||'').toLowerCase().includes('dismiss the not-saved'));
  if (!b) return 'NO_DISMISS_CONTROL';
  b.click();
  return 'dismissed';
})()`;

const NOTICE_GONE = `
(() => !(document.getElementById('root') || document.body).innerText
  .includes('NOTHING HERE IS BEING SAVED'))()`;

const CITATION_LABELS = `
(() => [...document.querySelectorAll('[role=button]')]
  .map(e => e.getAttribute('aria-label') || '')
  .filter(l => l.startsWith('Source:')))()`;

const CHIP_LABELS = `
(() => [...document.querySelectorAll('[role=button]')]
  .map(e => e.getAttribute('aria-label') || '')
  .filter(l => l.startsWith('Ask about:')))()`;

const IS_WITHHOLD = `
(() => {
  const t = (document.getElementById('root') || document.body).innerText.toLowerCase();
  return t.includes('have documentation covering') || t.includes('hold a manual for that unit');
})()`;

const PAGE_TEXT = `
(() => {
  const r = document.getElementById('root') || document.body;
  return r.innerText.split('\\n').filter(Boolean).slice(0, 8).join(' | ');
})()`;

// --- budget ------------------------------------------------------------------

const need = TURNS.length * 2; // worst case: every turn clarifies before answering
const before = budget(LEDGER);
console.log(`\nAnswer frames — ${WIDTH}x${HEIGHT}@${SCALE}x -> ${OUT}/`);
console.log(`  ledger: ${before.used}/${before.limit} used, ${before.remaining} remaining · worst case ${need}\n`);
if (before.remaining < need) {
  console.error(`  needs up to ${need}, ${before.remaining} remain. Refusing to start half a set.\n`);
  process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target — is Chrome running with --remote-debugging-port?');
const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
});

const captured = [];
const skipped = [];

/** Re-shoot one frame without re-spending on the others. */
const ONLY = typeof args.only === 'string' ? args.only : null;

for (const turn of TURNS) {
  if (ONLY && !turn.name.includes(ONLY)) continue;
  console.log(`${turn.name}  (${turn.unit})`);

  // A fresh app run per turn, so every frame is one clean question and one answer
  // rather than the tail of a growing transcript.
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(9000);

  console.log('   ', await ev(ws, click('type the unit in')));
  await sleep(1500);
  console.log('   ', await ev(ws, typeByLabel('unit model number', turn.unit)));
  await sleep(900);
  console.log('   ', await ev(ws, click('use this model')));
  await sleep(6500);

  let asked = turn.ask;
  if (turn.chip) {
    const chips = await ev(ws, CHIP_LABELS);
    const match = (chips ?? []).find((c) => c.includes(turn.chip)) ?? (chips ?? [])[0];
    if (!match) { console.log('  skip — no suggestion chips rendered'); skipped.push({ ...turn, why: 'no chips' }); continue; }
    asked = match.replace(/^Ask about:\s*/, '');
    console.log(`    chip: ${asked.slice(0, 62)}`);
    console.log('   ', await ev(ws, click(match)));
  } else {
    console.log('   ', await ev(ws, typeByLabel('symptom', asked)));
    await sleep(700);
    console.log('   ', await ev(ws, click('send')));
  }

  await sleep(42000);

  /*
   * Dismiss with retries, not once.
   *
   * The control is absent until an assistant turn lands (`lib/guestNotice.ts`),
   * and "lands" is a render, not the moment the fetch resolves. A single attempt
   * fired too early returns NO_DISMISS_CONTROL and the notice then appears —
   * which is how the 08 frame first came back with the disclosure sitting over
   * the citation row it was supposed to be showing.
   */
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await ev(ws, NOTICE_GONE)) break;
    console.log(`    dismiss attempt ${attempt}:`, await ev(ws, DISMISS_NOTICE));
    await sleep(1500);
  }

  if (await ev(ws, IS_WITHHOLD)) {
    console.log('  skip — came back a withhold; reported, never relabelled');
    skipped.push({ ...turn, why: 'withhold' });
    continue;
  }
  const labels = await ev(ws, CITATION_LABELS);
  if (!labels?.length) {
    console.log('  skip — uncited');
    skipped.push({ ...turn, why: 'uncited' });
    continue;
  }
  const pages = new Set(labels.map((l) => l.replace(/^.*page\s*/i, '')));
  console.log(`    ${labels.length} citation(s) across ${pages.size} page(s)`);

  console.log('   ', await ev(ws, CLEAR_COMPOSER));
  await sleep(500);
  if (turn.frame === 'citations') {
    // Put the first source chip at the top of the viewport, so the frame is the
    // citation row and the advice-only footer rather than the prose above it.
    console.log('   ', await ev(ws, FRAME_ON_CITATIONS));
  } else {
    console.log('   ', await ev(ws, frameOnQuestion(asked)));
  }
  await sleep(1200);
  if (!(await ev(ws, NOTICE_GONE))) {
    console.log('  skip — the disclosure is still on screen; not shooting over it');
    skipped.push({ ...turn, why: 'notice not dismissed' });
    continue;
  }
  console.log('    on screen:', String(await ev(ws, PAGE_TEXT)).slice(0, 118));
  await shot(ws, turn.name);
  captured.push({
    name: turn.name, unit: turn.unit, asked,
    citations: labels.length, distinctPages: pages.size, caption: turn.caption,
  });
}

const after = budget(LEDGER);
console.log(`\n  ledger: ${after.used}/${after.limit} used · this run spent ${after.used - before.used}`);
console.log(`  ${captured.length}/${TURNS.length} captured${skipped.length ? `, ${skipped.length} skipped` : ''}`);
for (const s of skipped) console.log(`    skipped ${s.name}: ${s.why}`);
writeFileSync(join(OUT, 'answers.json'), JSON.stringify({ captured, skipped }, null, 2));
ws.close();
process.exit(captured.length === TURNS.length ? 0 : 1);
