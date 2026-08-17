/**
 * suggestion-truthfulness-probe.mjs — ST-R18. Brief AC 4, over the wire.
 *
 *   node --env-file=.env tests/probes/suggestion-truthfulness-probe.mjs \
 *     [--limit N] [--units "Bosch IDS Ultra,Trane YSC072E3"] [--server URL]
 *
 * The owner tapped four suggestions and got nothing back. This taps them for him
 * and fails the round if any one comes back uncited.
 *
 * ## The gap this closes, stated precisely
 *
 * `suggestions:build` already proves every stored suggestion retrieves **its own
 * chunk at rank 1** — corpus-wide, 693 of 693, and it costs no generation quota.
 * That is the retrieval half. It does not prove the *generation* half: that the
 * server, handed that question and that scope, produces an answer carrying a
 * citation. `starters.ts:108` asserted exactly that in a comment and it was false
 * for four consecutive taps.
 *
 * **So the two claims that may be made are:** every suggestion in the corpus
 * passed retrieval validation, and every suggestion *in the sample* returned a
 * cited answer. Not "every suggestion works". §7.1 of the stories forbids rounding
 * that up and this probe's own output is worded to make the rounding hard.
 *
 * ## Coverage accumulates rather than repeating
 *
 * Each run appends to `eval/reports/suggestion-truthfulness.jsonl`, and units
 * already covered are reported so successive days extend the sample instead of
 * re-testing the same two units. `--force` re-tests anyway.
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../lib/clients.mjs';
import {
  arg, post, tally, requireMatchingServer, requireBudget, ledgerDelta,
  resolveOrSkip, citationsWellFormed, citedDocumentsInScope, ROOT,
} from './harness.mjs';

const LIMIT = Number(arg('limit', 6));
const FORCE = arg('force', false) === true;
const ARTIFACT = join(ROOT, 'eval', 'reports', 'suggestion-truthfulness.jsonl');

/**
 * The sample. **The Bosch unit from the session is mandatory** (AC 4) — it is the
 * unit that produced the four dead turns, so a run that skipped it would prove
 * the fix somewhere other than where the defect was seen.
 */
const DEFAULT_UNITS = ['Bosch IDS Ultra', 'Trane YSC072E3'];
const UNITS = String(arg('units', DEFAULT_UNITS.join(','))).split(',').map((s) => s.trim()).filter(Boolean);
if (!UNITS.some((u) => /bosch/i.test(u))) {
  console.error('\n  refusing to run without the Bosch unit — ST-R18 AC 4 requires it in every sample.\n');
  process.exit(2);
}

const t = tally();
console.log('\nST-R18 — every offered suggestion returns a cited answer\n');

await requireMatchingServer(t);
// Worst case: LIMIT suggestions plus one negative control per unit.
const before = requireBudget(LIMIT + UNITS.length, { label: `${LIMIT} suggestion(s) plus ${UNITS.length} negative control(s)` });

const db = supabaseAdmin();

const covered = (() => {
  if (FORCE) return new Set();
  try {
    return new Set(readFileSync(ARTIFACT, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l).unit; } catch { return null; } })
      .filter(Boolean));
  } catch { return new Set(); }
})();
if (covered.size) console.log(`  previously covered: ${[...covered].join(', ')}  (--force to re-test)`);

let asked = 0;
let offered = 0;
const results = [];

for (const label of UNITS) {
  const cut = label.indexOf(' ');
  const unit = cut < 0
    ? { manufacturer: label, model: label }
    : { manufacturer: label.slice(0, cut), model: label.slice(cut + 1) };

  console.log(`\n  ${label}\n`);
  const resolved = await resolveOrSkip(t, unit);
  if (!resolved) continue;
  const scope = resolved.documentIds;

  const { json: sug } = await post('/unit-suggestions', { documentIds: scope });
  const suggestions = sug?.suggestions ?? [];
  offered += suggestions.length;

  // AC 4 — an empty list is asserted and recorded, never silently skipped. On an
  // installation corpus this is a designed outcome, not a failure.
  if (!suggestions.length) {
    t.check(`${label}: EMPTY (by design) — the screen shows its empty state`, true,
      `${scope.length} document(s) in scope, 0 validated suggestions`);
    results.push({ unit: label, suggestions: 0, asked: 0, empty: true });
    continue;
  }
  console.log(`  ·    ${suggestions.length} suggestion(s) offered`);

  for (const s of suggestions) {
    const short = String(s.text).slice(0, 52);
    if (asked >= LIMIT) { t.skip(`${label}: "${short}"`, 'over --limit for today'); continue; }
    asked++;

    const { json } = await post('/diagnose', {
      symptom: s.text,
      equipment: label,
      documentIds: scope,
    });

    // AC 2 — a single no-documentation is a failure. This is the whole property.
    const answered = t.check(`"${short}": answered`, json?.kind === 'answer', `kind=${json?.kind}`);
    const documented = t.check(`"${short}": not a withhold`, json?.meta?.noDocumentation === false,
      `noDocumentation=${json?.meta?.noDocumentation}`);

    let scoped = { ok: false, why: 'not reached' };
    let wf = { ok: false, why: 'not reached' };
    if (answered && documented) {
      wf = citationsWellFormed(json.citations);
      t.check(`"${short}": citations well-formed`, wf.ok, wf.why);
      // AC 3 — resolved through the database, because the wire carries no
      // document_id on a citation. An answer from another unit's manual is a
      // worse pass than a failure.
      scoped = await citedDocumentsInScope(db, json.citations, scope);
      t.check(`"${short}": every citation inside the unit's scope`, scoped.ok, scoped.why);
    }

    results.push({
      unit: label, text: s.text, category: s.category,
      kind: json?.kind, noDocumentation: json?.meta?.noDocumentation,
      citations: (json?.citations ?? []).length,
      wellFormed: wf.ok, inScope: scoped.ok,
    });
  }

  // AC 8 — the negative control. A probe that can only pass is not a probe.
  const { json: neg } = await post('/diagnose', {
    symptom: 'what is the recommended ballast weight for the tail rotor assembly',
    equipment: label, documentIds: scope,
  });
  t.check(`${label}: off-corpus question still withholds`, neg?.meta?.noDocumentation === true,
    `noDocumentation=${neg?.meta?.noDocumentation}`);
  results.push({ unit: label, negativeControl: true, noDocumentation: neg?.meta?.noDocumentation });
}

// --- the artifact, and the honest coverage sentence -------------------------

mkdirSync(join(ROOT, 'eval', 'reports'), { recursive: true });
const stamp = new Date().toISOString();
for (const r of results) appendFileSync(ARTIFACT, JSON.stringify({ at: stamp, ...r }) + '\n');

const total = ledgerDelta(before);
console.log(`\n  model calls this run: ${total.spent}`);
console.log(`  ledger: ${total.after}/${total.budget.limit} used today, ${total.budget.remaining} remaining`);
console.log(`\n  COVERAGE: ${asked} of ${offered} suggestion(s) exercised across ${UNITS.length} unit(s).`);
console.log('  This run proves the sample returned cited answers. Corpus-wide, what is');
console.log('  proven is retrieval validation (suggestions:build), not generation.');
console.log(`  appended: ${ARTIFACT.replace(ROOT, '.')}`);

process.exit(t.report('ST-R18 — suggestion truthfulness'));
