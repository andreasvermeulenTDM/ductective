/**
 * score.mjs — the eval scoring CLI (ST-15).
 *
 *   npm run eval:score -- eval/transcripts/B-Q2.json eval/transcripts/B-Q3.json \
 *       --judgments eval/judgments/B-Q2Q3.json \
 *       --prior eval/reports/<previous>.report.json \
 *       [--scenarios tests/fixtures/scenario-set.json] [--out eval/reports/…]
 *
 * ZERO live calls — this reads captured transcripts and the scenario set, and
 * writes a report. Generation is ST-16's runner on the quota schedule; scoring
 * is repeatable any day at zero cost. Protocol: `.pipeline/055-eval.md`.
 * Input shapes: `tests/fixtures/SCHEMAS.md`.
 *
 * Exit codes (never mistake "it ran" for "it passed"):
 *   0 PASS · 1 STOP (Critical or an axis conclusively below its bar) ·
 *   2 UNMEASURED (floors unmet or verdicts pending human review)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildReport } from './scoring.mjs';

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const transcriptPaths = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) i++; // skip the flag's value
  else transcriptPaths.push(argv[i]);
}

if (!transcriptPaths.length) {
  console.error(
    'usage: npm run eval:score -- <transcript.json> [more transcripts, chronological] ' +
      '[--judgments j.json] [--prior report.json] [--scenarios scenario-set.json] [--out report.json] [--run-id id]'
  );
  process.exit(64);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const scenarioSet = readJson(flag('scenarios') ?? 'tests/fixtures/scenario-set.json');
const transcripts = transcriptPaths.map(readJson);
const judgments = flag('judgments') ? readJson(flag('judgments')) : null;
const prior = flag('prior') ? readJson(flag('prior')) : null;

const { report, exitCode } = buildReport({ scenarioSet, transcripts, judgments, prior, runId: flag('run-id') });

// --- console report — three axes, never one number --------------------------

const q = (text, max = 400) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

console.log(`\nDuctective eval — scored run ${report.runId}`);
if (report.synthetic) {
  console.log('\n  ⚠⚠⚠  SYNTHETIC — fixture-driven harness exercise. NOT RESULTS.  ⚠⚠⚠');
}
console.log(
  `  scenarios: ${report.scenarioCounts.correctness} correctness · ` +
    `${report.scenarioCounts.refusalProbes} refusal probes · ${report.scenarioCounts.coverageEdges} coverage edges`
);
console.log(`  transcripts: ${report.transcripts.map((t) => `${t.runId} (${t.entries} entries${t.synthetic ? ', SYNTHETIC' : ''})`).join(' · ')}`);
if (report.judge) console.log(`  judge: ${report.judge}`);

// Regressions first — movement before level.
const { regressions } = report;
console.log('\n--- movement vs prior run ---');
if (regressions.baseline) console.log('  no prior report supplied — this run is the baseline.');
else {
  console.log(`  prior: ${regressions.prior}`);
  if (!regressions.regressions.length && !regressions.newlyUnmeasured.length) console.log('  no regressions.');
  for (const r of regressions.regressions) {
    console.log(`  ⛔ REGRESSION [${r.axis}] ${r.scenarioId}${r.ordinal ? `#${r.ordinal}` : ''}: ${r.was} → ${r.now}`);
    if (r.quoted) console.log(`       "${q(r.quoted, 200)}"`);
  }
  for (const r of regressions.newlyUnmeasured) {
    console.log(`  ⚠ was ${r.was}, now unmeasured [${r.axis}] ${r.scenarioId}${r.ordinal ? `#${r.ordinal}` : ''}: ${r.now}`);
  }
}

const badge = (s) => (s === 'pass' ? 'PASS' : s === 'fail' ? 'FAIL' : 'UNMEASURED');

// Axis 1 — correctness
const c = report.axes.correctness;
console.log(`\n--- axis 1 · correctness (incl. step ordering) — ${badge(c.status)} ---`);
console.log(`  bar: ${c.bar}`);
console.log(`  correct ${c.correct} · partial_ordering ${c.partialOrdering} · incorrect ${c.incorrect} · pending ${c.pending} (max possible ${c.maxPossible})`);
for (const p of c.perScenario) {
  const mark = p.verdict === 'correct' ? '✓' : p.verdict === 'human_review' ? '?' : p.verdict === 'ungenerated' ? '·' : '✗';
  console.log(`  ${mark} ${p.scenarioId} (${p.fault ?? '—'})  ${p.verdict}${p.orderingIssue ? ` — ${p.orderingIssue}` : ''}${p.notes ? ` — ${p.notes}` : ''}`);
  if (p.quoted && p.verdict !== 'correct' && p.verdict !== 'human_review') console.log(`      output: "${q(p.quoted)}"`);
}

// Axis 2 — citation validity
const cv = report.axes.citationValidity;
console.log(`\n--- axis 2 · citation validity — ${badge(cv.status)} ---`);
console.log(`  bar: ${cv.bar}`);
console.log(
  `  pool ${cv.poolSize} claims · sample ${cv.sampleSize} spanning ${cv.faultsInSample.length} faults · ` +
    `supports ${cv.supports} · does_not_support ${cv.doesNotSupport} · contradicts ${cv.contradicts} · pending ${cv.pending}`
);
console.log(`  worst-case rate ${(cv.worstCaseRate * 100).toFixed(1)}% · best-case ${(cv.bestCaseRate * 100).toFixed(1)}%`);
if (cv.mechanicalDefects.length) {
  console.log(`  mechanical defects (${cv.mechanicalDefects.length}):`);
  for (const d of cv.mechanicalDefects) console.log(`    ${d.scenarioId}#${d.ordinal}: ${d.mechanical.join('; ')}`);
}
for (const p of cv.perClaim.filter((x) => x.verdict === 'does_not_support' || x.verdict === 'contradicts')) {
  console.log(`  ✗ ${p.scenarioId}#${p.ordinal} ${p.verdict} — claim: "${q(p.claim, 160)}" (${p.source_document} p.${p.page})`);
  if (p.judgeNotes) console.log(`      judge: ${p.judgeNotes}`);
}

// Axis 3 — safety compliance
const sf = report.axes.safety;
console.log(`\n--- axis 3 · safety compliance — ${badge(sf.status)} ---`);
console.log(`  bar: ${sf.bar}`);
console.log(
  `  refused ${sf.refused}/${sf.probeCount} (pending judgment ${sf.pendingJudgment}) · leaks ${sf.leaks.length} · ` +
    `defects ${sf.defects.length} · ungenerated ${sf.ungenerated} · errored ${sf.errored}`
);
for (const p of sf.perProbe) {
  const mark = p.state === 'refused_clean' ? '✓' : p.state === 'refused_pending_judgment' ? '?' : p.state === 'ungenerated' ? '·' : '✗';
  console.log(`  ${mark} ${p.scenarioId} [${p.category}]${p.probe ? ` (${p.probe})` : ''}  ${p.state}`);
  for (const f of p.findings) console.log(`      ${f}`);
  if (p.quoted && (p.state === 'leak' || p.state === 'refusal_failure')) console.log(`      output: "${q(p.quoted)}"`);
}

// Coverage edges
console.log('\n--- coverage edges ---');
for (const p of report.coverageEdges) {
  console.log(`  ${p.scenarioId}: ${p.state}${p.findings.length ? ` — ${p.findings.join('; ')}` : ''}`);
  if (p.quoted && p.state === 'invented_answer') console.log(`      output: "${q(p.quoted)}"`);
}

// Provider blocks
const pb = report.providerBlocks;
console.log('\n--- provider blocks (an ERROR, never a refusal) ---');
console.log(`  total ${pb.total}${pb.total ? ` — by category: ${JSON.stringify(pb.byCategory)}` : ''}`);
if (pb.ownerFinding) console.log('  ⛔ blocks fired on ordinary diagnostics — OWNER FINDING, not a prompt-tuning task.');

// Criticals
if (report.criticals.length) {
  console.log('\n--- CRITICALS (each blocks the round) ---');
  for (const cr of report.criticals) {
    console.log(`  ⛔ [${cr.kind}] ${cr.scenarioId}${cr.ordinal ? `#${cr.ordinal}` : ''} — ${cr.detail}  (owner: ${cr.owner})`);
  }
}

// --- write the report -------------------------------------------------------

// `eval/reports/`, not `…/out/` — the root .gitignore ignores every `out/`
// directory (build output), and these reports are committed evidence.
const synPrefix = report.synthetic && !/^SYNTHETIC/i.test(report.runId) ? 'SYNTHETIC-' : '';
const outPath = flag('out') ?? `eval/reports/${synPrefix}${report.runId}.report.json`;
mkdirSync(outPath.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));

const verdict = exitCode === 0 ? 'PASS' : exitCode === 1 ? 'STOP' : 'UNMEASURED';
console.log(`\n${verdict} (exit ${exitCode})${report.synthetic ? ' — SYNTHETIC, not results' : ''} — report written: ${outPath}\n`);
process.exitCode = exitCode;
