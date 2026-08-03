/**
 * run-all.mjs — the Stage 5 verification run.
 *
 *   node --env-file=.env tests/run-all.mjs
 *   node --env-file=.env tests/run-all.mjs --run=all
 *   node --env-file=.env tests/run-all.mjs --out=.pipeline/05-test-report.md
 *
 * Without --env-file, every check that needs Supabase reports BLOCKED rather
 * than FAIL. That distinction is the point: a missing credential is not a defect,
 * and reporting it as one sends the iterate-until-done loop chasing something
 * that isn't broken.
 *
 * Exit code is 1 if and only if something FAILED. BLOCKED and HUMAN-ONLY do not
 * fail the run — they are reported, loudly, and they are never counted as PASS.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSuite, printResult, ROOT, stages, stageLanded, PASS, FAIL, HUMAN, BLOCKED } from './harness.mjs';

import e0 from './suites/e0-rails.mjs';
import e1 from './suites/e1-ingestion.mjs';
import e2 from './suites/e2-retrieval.mjs';
import e5 from './suites/e5-safety.mjs';
import e6 from './suites/e6-app.mjs';
import e78 from './suites/e7-e8-operability.mjs';
import humanOnly from './suites/human-only.mjs';

const SUITES = [e0, e1, e2, e5, e6, e78, humanOnly];
const STATE = 'tests/last-run.json';

// --- args -------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const activeRun = (args.run ?? 'A').toUpperCase();
const outPath = args.out ?? 'tests/last-run.md';

// --- precondition gate ------------------------------------------------------

// test.md opens with this: confirm the artifact for every stage this round
// touched is committed before running anything. Not landing is not an error —
// it decides whether a red check means "broken" or "not built yet".
const landed = Object.fromEntries(Object.keys(stages).map((k) => [k, stageLanded(k)]));

console.log('\nDuctective — Stage 5 verification\n');
console.log(`Active run: ${activeRun}`);
console.log('Pipeline stages landed:');
for (const [k, s] of Object.entries(stages)) {
  console.log(`  ${landed[k] ? '\x1b[32m✓\x1b[0m' : '\x1b[90m·\x1b[0m'} ${s.label.padEnd(26)} ${s.artifact}`);
}

// --- run --------------------------------------------------------------------

const selected = SUITES.filter((s) => s.run === '*' || activeRun === 'ALL' || s.run === activeRun);
const skipped = SUITES.filter((s) => !selected.includes(s));
const results = [];

for (const suite of selected) {
  console.log(`\n${suite.epic} — ${suite.title}`);
  const rs = await runSuite(suite);
  rs.forEach(printResult);
  results.push(...rs);
}

// --- run integrity ----------------------------------------------------------

// lib/clients.mjs is explicit that Stage 5 must assert this is empty. A scored
// run that unknowingly graded fabricated data is worse than a run that failed
// outright, so this is checked after every suite rather than trusted.
let stubNote = 'no stub was activated during this run';
try {
  const { usedMocks } = await import('../lib/clients.mjs');
  const stubs = usedMocks();
  if (stubs.length) {
    stubNote = `⚠ STUBS ACTIVE: ${stubs.join(', ')} — no result above them is a real result`;
    console.log(`\n\x1b[33m${stubNote}\x1b[0m`);
    results.push({
      epic: 'INTEGRITY',
      run: activeRun,
      story: '—',
      ac: 'CLAUDE.md',
      what: 'no stubbed service was used to produce a result',
      verdict: FAIL,
      evidence: { command: 'usedMocks()', exitCode: null, output: stubs.join(', ') },
      note: 'a stub answered during verification — re-run against the real services before trusting any result above',
    });
  }
} catch {
  stubNote = 'lib/clients.mjs was never loaded — no stub could have activated';
}

// --- tally ------------------------------------------------------------------

const tally = (v) => results.filter((r) => r.verdict === v).length;
const counts = { [PASS]: tally(PASS), [FAIL]: tally(FAIL), [HUMAN]: tally(HUMAN), [BLOCKED]: tally(BLOCKED) };

// --- regressions against the prior run --------------------------------------

// test.md duty 7: a regression is the headline, not a footnote inside a summary
// count. A run that improves overall while a previously-passing check breaks is
// still a regression.
let prior = null;
try {
  prior = JSON.parse(readFileSync(join(ROOT, STATE), 'utf8'));
} catch {
  /* first run */
}

const key = (r) => `${r.story}::${r.what}`;
const priorByKey = new Map((prior?.results ?? []).map((r) => [key(r), r]));
const regressions = results.filter((r) => priorByKey.get(key(r))?.verdict === PASS && r.verdict === FAIL);
const fixed = results.filter((r) => priorByKey.get(key(r))?.verdict === FAIL && r.verdict === PASS);

if (regressions.length) {
  console.log(`\n\x1b[31mREGRESSIONS (${regressions.length}) — passed on the previous run, failing now\x1b[0m`);
  for (const r of regressions) console.log(`  ${r.story}  ${r.what}`);
}

// --- report -----------------------------------------------------------------

const md = renderReport({ results, counts, regressions, fixed, activeRun, landed, skipped, stubNote, prior });
writeFileSync(join(ROOT, outPath), md, 'utf8');
writeFileSync(
  join(ROOT, STATE),
  JSON.stringify({ ranAt: new Date().toISOString(), activeRun, results }, null, 2),
  'utf8'
);

console.log(
  `\n${counts[PASS]} PASS · ${counts[FAIL]} FAIL · ${counts[BLOCKED]} BLOCKED · ${counts[HUMAN]} HUMAN-ONLY`
);
if (skipped.length) {
  console.log(`Not run this round: ${skipped.map((s) => `${s.epic} (Run ${s.run})`).join(', ')}`);
}
console.log(`Report: ${outPath}\n`);

process.exitCode = counts[FAIL] === 0 ? 0 : 1;

// ---------------------------------------------------------------------------

function renderReport({ results, counts, regressions, fixed, activeRun, landed, skipped, stubNote, prior }) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const row = (r) =>
    `| ${r.story} | ${esc(r.ac)} | ${esc(r.what)} | **${r.verdict}** | ${esc(r.note ?? '')} |`;

  const evidenceBlock = (r) =>
    [
      `#### ${r.story} — ${r.what}`,
      ``,
      `**${r.verdict}**${r.note ? ` — ${r.note}` : ''}`,
      ``,
      '```',
      `$ ${r.evidence?.command ?? '(none)'}`,
      r.evidence?.exitCode !== null && r.evidence?.exitCode !== undefined
        ? `exit ${r.evidence.exitCode}`
        : '',
      r.evidence?.output ?? '',
      '```',
      ``,
    ].join('\n');

  return [
    `# 05 — Test report`,
    ``,
    `Generated by \`tests/run-all.mjs\`. Re-run: \`node --env-file=.env tests/run-all.mjs --run=${activeRun}\``,
    ``,
    `**${counts[PASS]} PASS · ${counts[FAIL]} FAIL · ${counts[BLOCKED]} BLOCKED · ${counts[HUMAN]} HUMAN-ONLY**`,
    ``,
    `Run integrity: ${stubNote}.`,
    ``,
    `## Verdicts`,
    ``,
    `| Verdict | Meaning |`,
    `|---|---|`,
    `| PASS | A command or test was executed and demonstrates the criterion. |`,
    `| FAIL | It was executed and the criterion did not hold. |`,
    `| BLOCKED | It could not be executed. The note names exactly what was missing. |`,
    `| HUMAN-ONLY | It needs a device, an external service, or a human eye. No agent may claim it. |`,
    ``,
    `A criterion that was not mechanically executed is never reported as PASS.`,
    ``,
    `## Pipeline preconditions`,
    ``,
    `| Stage | Artifact | Landed |`,
    `|---|---|---|`,
    ...Object.entries(stages).map(([k, s]) => `| ${s.label} | \`${s.artifact}\` | ${landed[k] ? 'yes' : 'no'} |`),
    ``,
    `Checks owned by a stage that has not landed report BLOCKED against that stage`,
    `rather than FAIL against the code.`,
    ``,
    ...(regressions.length
      ? [
          `## ⚠ Regressions (${regressions.length})`,
          ``,
          `Passed on the previous run, failing now. These take priority over everything else in this report.`,
          ``,
          `| Story | Check |`,
          `|---|---|`,
          ...regressions.map((r) => `| ${r.story} | ${esc(r.what)} |`),
          ``,
        ]
      : prior
        ? [`## Regressions`, ``, `None. ${fixed.length} check(s) went FAIL → PASS since the previous run.`, ``]
        : [`## Regressions`, ``, `No previous run to compare against — this is the baseline.`, ``]),
    `## Every criterion`,
    ``,
    `| Story | AC | Check | Verdict | Note |`,
    `|---|---|---|---|---|`,
    ...results.map(row),
    ``,
    ...(skipped.length
      ? [
          `## Not run this round`,
          ``,
          ...skipped.map((s) => `- **${s.epic}** — ${s.title} (Run ${s.run}), not the active run`),
          ``,
          `Scope, not a verdict. Nothing above claims coverage of these.`,
          ``,
        ]
      : []),
    `## Human-only checklist`,
    ``,
    `No agent can complete these. Each is listed rather than claimed.`,
    ``,
    ...results
      .filter((r) => r.verdict === HUMAN)
      .map((r) => [`### ${r.story} — ${r.what}`, ``, '```', r.note, '```', ``].join('\n')),
    `## Evidence`,
    ``,
    `The exact command, its exit code, and the relevant output — enough to re-run and get the same answer.`,
    ``,
    ...results.filter((r) => r.verdict !== HUMAN).map(evidenceBlock),
  ].join('\n');
}
