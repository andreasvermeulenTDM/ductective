/**
 * citation-reachability-probe.mjs — ST-13, criterion 3.
 *
 *   node --env-file=.env tests/probes/citation-reachability-probe.mjs [--server URL]
 *
 * **The validator must not be bypassable on the path the app actually uses.**
 * `lib/diagnose.test.mjs` proves `validateAnswer` drops uncited steps, but a unit
 * test cannot prove the serve path *calls* it. This asks the running server one real
 * question and asserts the answer it returns carries the structural marks only
 * `validateAnswer` produces — `verified: 'exact'` on every citation, a chunk_id, a
 * snippet, and one citation per rendered step.
 *
 * **This spends Gemini quota** — one request, two if the model asks a clarifying
 * question first. That is deliberate and small, and it buys something the scored run
 * cannot: proof that the ST-13 checker parses *real* output before a quota day is
 * spent producing fifteen transcripts for it. A checker that has only ever seen
 * fixtures is a guess about the format.
 *
 * The transcript it writes is real (`synthetic: false`) and is the checker's first
 * genuine input.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runCheck, supabaseResolver } from '../checkers/citation-check.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const SERVER = arg('server', 'http://localhost:8787');

const AUTH = process.env.DIAGNOSE_AUTH_TOKEN;
const headers = AUTH
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH}` }
  : { 'Content-Type': 'application/json' };

const post = async (route, body) => {
  const res = await fetch(`${SERVER}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

// The server must be the tree we think it is — the same guard the safety probes use.
const proberCommit = execSync('git rev-parse --short HEAD').toString().trim();
const health = await (await fetch(`${SERVER}/health`)).json();
check('server tree matches the prober tree', health.commit === proberCommit, `server=${health.commit} prober=${proberCommit}`);
if (failures) { console.log('\nrefusing to measure a server running different code\n'); process.exit(1); }

/*
 * A deliberately well-specified symptom on a unit with real coverage. ST-08(c)
 * names this shape as the one that should answer directly rather than clarify —
 * which keeps this probe to a single request.
 */
const UNIT = { manufacturer: 'Carrier', model: '48LC' };
const SYMPTOM = 'low suction pressure and the compressor is short cycling on the low pressure switch';

console.log(`\nST-13 criterion 3 — validator reachability on the serve path\n`);

const resolved = await post('/resolve-unit', UNIT);
check('unit resolves to real coverage', resolved.json.status === 'covered' && resolved.json.documentIds.length > 0,
  `${resolved.json.status}, ${resolved.json.documentIds?.length ?? 0} doc(s)`);

const entries = [];
let turn = await post('/diagnose', { symptom: SYMPTOM, equipment: `${UNIT.manufacturer} ${UNIT.model}`, documentIds: resolved.json.documentIds });
entries.push({ scenarioId: 'ST13-reach', fault: 'low suction / short cycling', turn: 1, request: { symptom: SYMPTOM }, httpStatus: turn.status, response: turn.json });

// If it asks first, answer it. Costs a second request; the alternative is a probe
// that silently proves nothing whenever the model chooses to clarify.
if (turn.json.kind === 'clarify') {
  console.log(`  ·    model asked: "${String(turn.json.body).slice(0, 80)}" — answering it (second request)`);
  const answer = 'Suction is 58 psig on R-410A, liquid line is warm, and the outdoor coil is clean.';
  turn = await post('/diagnose', {
    symptom: SYMPTOM, equipment: `${UNIT.manufacturer} ${UNIT.model}`, documentIds: resolved.json.documentIds,
    history: [{ role: 'assistant', content: turn.json.body }, { role: 'user', content: answer }],
  });
  entries.push({ scenarioId: 'ST13-reach', fault: 'low suction / short cycling', turn: 2, request: { symptom: SYMPTOM, answered: answer }, httpStatus: turn.status, response: turn.json });
}

const r = turn.json;
check('serve path returned a diagnostic answer', r.kind === 'answer' && !r.meta?.noDocumentation, `kind=${r.kind}`);
check('the answer is cited at all', (r.citations ?? []).length > 0, `${(r.citations ?? []).length} citation(s)`);

// The structural signature of validateAnswer. If the serve path ever emitted a
// model's raw JSON, every one of these would be absent.
const cites = r.citations ?? [];
check("every citation carries verified:'exact'", cites.length > 0 && cites.every((c) => c.verified === 'exact'),
  [...new Set(cites.map((c) => c.verified))].join(','));
check('every citation carries a chunk_id', cites.every((c) => c.chunk_id));
check('every citation carries a snippet from the database', cites.every((c) => String(c.snippet ?? '').trim()));
check('every citation carries document and page', cites.every((c) => c.source_document && c.page != null));
check('meta.dropped is reported', typeof r.meta?.dropped === 'number', String(r.meta?.dropped));

const transcript = {
  format: 'ductective-eval-transcript/1',
  runId: `B-st13-reachability-${new Date().toISOString().slice(0, 10)}`,
  synthetic: false,
  generatedAt: new Date().toISOString(),
  quotaDay: 'ST-13 reachability (1-2 requests)',
  gitCommit: proberCommit,
  serverCommit: health.commit,
  server: { runtime: 'node scripts/serve.mjs', model: r.meta?.model ?? null, retrievalMode: 'vector' },
  requestsUsed: { gemini: entries.length, voyage: entries.length, retries: 0 },
  entries,
};
mkdirSync('eval/transcripts', { recursive: true });
const out = `eval/transcripts/${transcript.runId}.json`;
writeFileSync(out, JSON.stringify(transcript, null, 2));

// Now run the ST-13 checker over what we just captured — the point of the exercise.
console.log(`\n  running the ST-13 checker over this real answer:\n`);
const report = await runCheck([out], { resolve: supabaseResolver });
check('checker parsed a real cited answer', report.realClaimsChecked > 0, `${report.realClaimsChecked} claim(s)`);
check('zero uncited claims', report.uncitedClaims === 0, String(report.uncitedClaims));
check('every citation resolved to a stored chunk', report.resolution.checked && report.resolution.resolved === report.realClaimsChecked,
  `${report.resolution.resolved}/${report.realClaimsChecked}`);
check('checker verdict is PASS', report.verdict === 'PASS', report.verdict);
for (const d of report.defects) console.log(`       ${d.severity} ${d.kind}: ${d.detail}`);

writeFileSync('eval/reports/citation-check-st13-reachability.json', JSON.stringify(report, null, 2));

console.log(`\n  model: ${r.meta?.model ?? '?'}  requests: ${entries.length}  ` +
  `tokens: ${r.meta?.usage?.totalTokens ?? '?'}  latency: ${r.meta?.latencyMs ?? '?'}ms`);
console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED'}`);
console.log(`transcript: ${out}\nreport    : eval/reports/citation-check-st13-reachability.json\n`);
process.exitCode = failures === 0 ? 0 : 1;
