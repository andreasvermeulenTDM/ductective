/**
 * ST-09 — the day ledger, tested against real files in a temp directory.
 *
 *   npm test
 *
 * No network, no keys. The properties that matter: counts persist across
 * "process restarts" (fresh reads of the same file), days roll over on the
 * injected clock, a corrupt file is preserved rather than crashed on, and the
 * remaining-count math is honest past the limit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FREE_TIER_REQUESTS_PER_DAY,
  dayKey,
  readLedger,
  budget,
  recordModelCall,
  appendRequestLog,
} from './ledger.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'ductective-ledger-'));

test('dayKey is a local YYYY-MM-DD', () => {
  assert.equal(dayKey(new Date(2026, 7, 6, 14, 30)), '2026-08-06');
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('a missing file is an empty ledger and a zero budget', () => {
  const file = join(dir(), 'ledger.json');
  assert.deepEqual(readLedger(file), { days: {} });
  const b = budget(file, new Date(2026, 7, 6));
  assert.deepEqual(b, { day: '2026-08-06', used: 0, limit: FREE_TIER_REQUESTS_PER_DAY, remaining: FREE_TIER_REQUESTS_PER_DAY });
});

test('recordModelCall increments, accumulates tokens, and persists across fresh reads', (t) => {
  const d = dir();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'ledger.json');
  const now = new Date(2026, 7, 6, 10);

  const first = recordModelCall(file, { now, usage: { inputTokens: 3500, outputTokens: 900, cachedContentTokenCount: 2000 } });
  assert.deepEqual(first, { day: '2026-08-06', used: 1, limit: 20, remaining: 19 });

  const second = recordModelCall(file, { now, usage: { inputTokens: 4000, outputTokens: 1000, cachedContentTokenCount: 0 } });
  assert.equal(second.used, 2);

  // A "restarted server" — a fresh read of the same file — sees the same day.
  const rec = readLedger(file).days['2026-08-06'];
  assert.deepEqual(rec, { requests: 2, inputTokens: 7500, outputTokens: 1900, cachedContentTokenCount: 2000 });
  assert.equal(budget(file, now).used, 2);
});

test('the ledger rolls over at the day boundary without losing the previous day', (t) => {
  const d = dir();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'ledger.json');

  recordModelCall(file, { now: new Date(2026, 7, 6, 23, 59), usage: { inputTokens: 100 } });
  const nextDay = recordModelCall(file, { now: new Date(2026, 7, 7, 0, 1), usage: { inputTokens: 200 } });

  assert.deepEqual(nextDay, { day: '2026-08-07', used: 1, limit: 20, remaining: 19 });
  const days = readLedger(file).days;
  assert.equal(days['2026-08-06'].requests, 1); // history kept, not overwritten
  assert.equal(days['2026-08-07'].requests, 1);
});

test('remaining goes negative on an overrun day rather than clamping the truth away', (t) => {
  const d = dir();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'ledger.json');
  const now = new Date(2026, 7, 6);
  let last;
  for (let i = 0; i < FREE_TIER_REQUESTS_PER_DAY + 1; i++) last = recordModelCall(file, { now });
  assert.equal(last.used, 21);
  assert.equal(last.remaining, -1);
});

test('a corrupt ledger is preserved as .corrupt and counting starts fresh', (t) => {
  const d = dir();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'ledger.json');
  writeFileSync(file, '{ this is not JSON');

  const b = recordModelCall(file, { now: new Date(2026, 7, 6), usage: { inputTokens: 10 } });
  assert.equal(b.used, 1);
  assert.ok(existsSync(`${file}.corrupt`), 'the corrupt original is evidence, not garbage');
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{ this is not JSON');
});

test('appendRequestLog writes parseable JSONL lines, one per request', (t) => {
  const d = dir();
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'requests.jsonl');

  appendRequestLog(file, { route: '/diagnose', kind: 'answer', latencyMs: 8000 });
  appendRequestLog(file, { route: '/identify-unit', kind: 'identify', latencyMs: 20000 });

  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { route: '/diagnose', kind: 'answer', latencyMs: 8000 });
  assert.deepEqual(JSON.parse(lines[1]), { route: '/identify-unit', kind: 'identify', latencyMs: 20000 });
});
