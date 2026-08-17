/**
 * harness.mjs — what every wire probe needs and none of them should re-derive.
 *
 * ST-R07, ST-R11 and ST-R18 each require the same four disciplines, and three of
 * the four exist because a measurement was once taken wrongly and believed:
 *
 *   - **the `/health` commit guard** — two runs were scored against a server four
 *     days stale before `serve.mjs:34-47` started reporting its commit. A probe
 *     that measures a different tree than it reads is worse than no probe, so
 *     this refuses to score rather than warn.
 *   - **the ledger delta** — "no model call happened" is the load-bearing claim
 *     of every refusal and every conversational turn. Asserting it from
 *     `meta.model === null` alone trusts the same code under test to report on
 *     itself; reading the day ledger before and after is an independent witness.
 *   - **the budget gate** — the Gemini free tier is 20/day (owner decision,
 *     standing). A probe that starts a 12-call sample with 4 calls left does not
 *     fail honestly, it fails halfway and leaves an artifact that looks like a
 *     partial pass. So it refuses to start.
 *   - **SKIPPED as a first-class verdict** — a pair that was never exercised must
 *     never be printed as a pass. Exit 2 means "did not measure", which is a
 *     different fact from exit 1's "measured and failed".
 *
 * Nothing here asserts anything about *content*: each probe owns its own claims.
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budget } from '../../lib/ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const LEDGER_FILE = process.env.QUOTA_LEDGER_FILE || join(ROOT, 'scripts', 'quota-ledger.json');
export const REQUEST_LOG_FILE = process.env.REQUEST_LOG_FILE || join(ROOT, 'scripts', 'request-log.jsonl');

/** `--name value`, or the default. `--flag` alone reads as boolean true. */
export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return next;
}

export const SERVER = String(arg('server', 'http://localhost:8787'));

const AUTH = process.env.DIAGNOSE_AUTH_TOKEN;
export const headers = AUTH
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH}` }
  : { 'Content-Type': 'application/json' };

export async function post(route, body) {
  const res = await fetch(`${SERVER}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* reported by the caller's assertions */ }
  return { status: res.status, json };
}

// --- verdict accumulation ---------------------------------------------------

/**
 * A run's tally. `skipped` is deliberately not a failure and deliberately not a
 * pass: it is the third outcome, and `exitCode` maps it to 2.
 */
export function tally() {
  const rows = [];
  let failures = 0;
  let skipped = 0;

  const check = (name, ok, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
    if (!ok) failures++;
    return ok;
  };

  const skip = (name, why) => {
    console.log(`  SKIP ${name}  — ${why}`);
    skipped++;
  };

  /**
   * Measured, and the corpus legitimately had no source.
   *
   * Distinct from both `check(false)` and `skip`: the call *was* made and the
   * system behaved correctly — an honest withhold is the designed answer when
   * the manuals do not hold the datum. Counting it as a failure would make the
   * probe measure the corpus rather than the boundary, and counting it as a pass
   * would let a total-coverage collapse read as green. It rolls into the same
   * incomplete-coverage verdict as a skip (exit 2), so it can never be a pass.
   */
  const miss = (name, why) => {
    console.log(`  MISS ${name}  — ${why}`);
    skipped++;
  };

  return {
    rows,
    check,
    skip,
    miss,
    get failures() { return failures; },
    get skipped() { return skipped; },
    /** 0 = all measured and passed · 1 = something failed · 2 = nothing failed but coverage is incomplete. */
    exitCode() { return failures > 0 ? 1 : skipped > 0 ? 2 : 0; },
    report(title) {
      console.log(`\n${title}`);
      if (failures) console.log(`  ${failures} CHECK(S) FAILED`);
      if (skipped) console.log(`  ${skipped} check(s) SKIPPED or MISSED — coverage is incomplete, this is not a pass`);
      if (!failures && !skipped) console.log('  ALL CHECKS PASS');
      return this.exitCode();
    },
  };
}

// --- the four disciplines ---------------------------------------------------

/**
 * Refuse to score a server running different code. Returns the health payload.
 * Exits 1 rather than returning a flag: every caller would have to remember to
 * check it, and the one that forgot would publish a number.
 */
export async function requireMatchingServer(t) {
  const proberCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  let health;
  try {
    health = await (await fetch(`${SERVER}/health`)).json();
  } catch (e) {
    console.error(`\n  cannot reach ${SERVER}/health — is \`npm run serve\` running?  (${e.message})\n`);
    process.exit(1);
  }
  const ok = t.check('server tree matches the prober tree', health.commit === proberCommit,
    `server=${health.commit} prober=${proberCommit}`);
  if (!ok) {
    console.error('\n  refusing to measure a server running different code — restart `npm run serve`\n');
    process.exit(1);
  }
  return health;
}

/**
 * Refuse to start a sample the day cannot pay for.
 *
 * `need` is the worst case, not the expected case: a clarify turn costs a second
 * request, and a probe that budgeted for the happy path is the probe that dies
 * halfway. Overestimating costs a deferred run; underestimating costs a bad
 * artifact.
 */
export function requireBudget(need, { label = 'this run' } = {}) {
  const b = budget(LEDGER_FILE);
  console.log(`  ledger: day ${b.day}, used ${b.used}/${b.limit}, remaining ${b.remaining}`);
  if (b.remaining < need) {
    console.error(`\n  ${label} needs up to ${need} model call(s); ${b.remaining} remain today.`);
    console.error('  Refusing to start rather than fail halfway and leave a partial artifact.');
    console.error('  Re-run tomorrow, or narrow the sample with --limit.\n');
    process.exit(2);
  }
  return b;
}

/** Model calls recorded in the day ledger since `before`. The independent witness. */
export function ledgerDelta(before) {
  const after = budget(LEDGER_FILE);
  return { before: before.used, after: after.used, spent: after.used - before.used, budget: after };
}

/**
 * Assert a turn spent nothing — from the ledger *and* from the reported meta.
 * Both, because either alone can be wrong in a way the other catches: meta is
 * self-report, and the ledger cannot attribute a call to a specific turn.
 */
export function assertNoModelCall(t, name, meta, delta) {
  t.check(`${name}: no model call in the day ledger`, delta.spent === 0, `ledger +${delta.spent}`);
  t.check(`${name}: meta.model is null`, (meta?.model ?? null) === null, String(meta?.model));
  t.check(`${name}: zero input tokens`, (meta?.usage?.inputTokens ?? 0) === 0, String(meta?.usage?.inputTokens));
}

/** Resolve a unit and require real coverage, or record why the probe cannot proceed. */
export async function resolveOrSkip(t, unit) {
  const { json } = await post('/resolve-unit', unit);
  const label = `${unit.manufacturer} ${unit.model}`;
  if (json?.status !== 'covered' || !(json.documentIds?.length > 0)) {
    t.skip(`resolve ${label}`, `status=${json?.status ?? 'no response'}, ${json?.documentIds?.length ?? 0} doc(s)`);
    return null;
  }
  console.log(`  ·    ${label} → ${json.documentIds.length} document(s) in scope`);
  return json;
}

/**
 * The structural half of the citation contract, checked identically everywhere.
 *
 * **Deliberately does not check scope.** A citation on the wire carries seven
 * fields (`lib/diagnose.mjs:496`) and `document_id` is not among them — only
 * `chunk_id`. Testing `c.document_id` here would have been a check that silently
 * passed on every citation ever emitted, which is worse than no check. Scope is
 * `citedDocumentsInScope` below, and it costs a database read because there is
 * no honest way to get it for free.
 */
export function citationsWellFormed(citations) {
  const cites = citations ?? [];
  if (!cites.length) return { ok: false, why: 'no citations' };
  for (const c of cites) {
    if (!String(c.source_document ?? '').trim()) return { ok: false, why: 'a citation has an empty source_document' };
    if (!Number.isInteger(c.page) || c.page < 1) return { ok: false, why: `a citation has page=${c.page}` };
  }
  return { ok: true, why: `${cites.length} citation(s)` };
}

/**
 * Resolve each citation's `chunk_id` to its document and confirm every one lies
 * inside the unit's scope — ST-R18 AC 3. "A suggestion answered out of another
 * unit's manual is a worse pass than a failure."
 *
 * A citation with a null `chunk_id` cannot be scope-checked at all, and is
 * reported as unresolvable rather than assumed good.
 */
export async function citedDocumentsInScope(db, citations, scope) {
  const ids = (citations ?? []).map((c) => c.chunk_id).filter(Boolean);
  const missing = (citations ?? []).length - ids.length;
  if (missing) return { ok: false, why: `${missing} citation(s) carry no chunk_id — scope cannot be verified` };
  if (!ids.length) return { ok: false, why: 'no citations to check' };

  const { data, error } = await db.from('chunks').select('id, document_id').in('id', ids);
  if (error) return { ok: false, why: `chunk lookup failed: ${error.message}` };

  const found = new Map((data ?? []).map((r) => [r.id, r.document_id]));
  const unresolved = ids.filter((id) => !found.has(id));
  if (unresolved.length) return { ok: false, why: `${unresolved.length} cited chunk(s) not in the database` };

  const outside = [...new Set([...found.values()])].filter((d) => !scope.includes(d));
  if (outside.length) return { ok: false, why: `cites ${outside.join(', ')} — outside the unit's scope` };
  return { ok: true, why: `${ids.length} citation(s) all inside scope` };
}

/**
 * Does the cited page's stored text actually contain the numbers the answer
 * reported? ST-R07 AC 4 — the cheapest machine check of `CLAUDE.md`'s "a
 * citation that does not support its claim is the worse defect".
 *
 * Numeric-token containment, and the limits are worth stating: it cannot catch a
 * wrong *unit* ("35 in-lb" cited to a page saying "35 ft-lb"), and a claim with
 * no numbers in it is unverifiable this way and reported as such rather than
 * passed. It catches the failure it is aimed at — a value that appears nowhere
 * on the page it is attributed to.
 */
export function claimNumbersAppearInSnippet(citation) {
  const claim = String(citation?.claim ?? '');
  const snippet = String(citation?.snippet ?? '');
  if (!snippet.trim()) return { ok: false, why: 'no snippet to check against' };

  const nums = claim.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!nums.length) return { ok: null, why: 'claim carries no numeric token — not checkable this way' };

  const absent = nums.filter((n) => !snippet.includes(n));
  if (absent.length) return { ok: false, why: `${absent.join(', ')} absent from the cited page` };
  return { ok: true, why: `${nums.length} numeric token(s) present on the cited page` };
}
