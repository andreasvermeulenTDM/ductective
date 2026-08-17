/**
 * conversation-round4-probe.mjs — ST-R11. Brief AC 3, over the wire.
 *
 *   node --env-file=.env tests/probes/conversation-round4-probe.mjs [--server URL]
 *
 * The four-turn session from 16 Aug 2026 replayed against a running server, with
 * `history` carried forward exactly as `ChatScreen` does. That session is the
 * reason the round exists: four taps, four dead turns, and a log that could not
 * distinguish an honest withhold from an uncited answer.
 *
 * ## What each turn is actually testing
 *
 *   T1  a real symptom            — an answer *or* a clarify passes. Both are
 *                                   honest responses to a symptom; only
 *                                   `noDocumentation:true` is the failure.
 *   T2  the reply to that clarify — **the load-bearing turn.** This is where the
 *                                   session broke: the continuation went back
 *                                   unscoped and returned the "which unit is
 *                                   this?" withhold to a technician who had
 *                                   already named the unit two turns earlier.
 *   T3  "what can you help with?" — conversational, server-authored, free.
 *   T4  "how do I install this"   — the installation_scope redirect, free, and
 *                                   NOT a refusal: it carries no hazard category.
 *
 * Then three more calls that prove the round softened nothing:
 *   T5  a guidance question with no source still withholds (AC 2)
 *   T6  a refrigerant walkthrough is still refused (AC 3)
 *   T7  the request log those calls wrote is classifiable end to end (AC 6)
 *
 * ## Quota
 *
 * T3, T4 and T6 must cost **zero** — they are decided before any provider is
 * reached, and the ledger is read between turns to prove it rather than trusting
 * `meta.model`. T1, T2 and T5 cost one call each.
 */

import { readFileSync } from 'node:fs';
import { classifyLogOutcome, parseRequestLog } from '../../lib/metrics.mjs';
import {
  post, tally, requireMatchingServer, requireBudget, ledgerDelta, assertNoModelCall,
  resolveOrSkip, citationsWellFormed, REQUEST_LOG_FILE,
} from './harness.mjs';

const UNIT = { manufacturer: 'Bosch', model: 'IDS Ultra' };

const t = tally();
console.log('\nST-R11 — the four-turn session, replayed over the wire\n');

await requireMatchingServer(t);
const before = requireBudget(4, { label: 'T1, T2 and T5 (plus one for a second clarify)' });

const resolved = await resolveOrSkip(t, UNIT);
if (!resolved) {
  console.error('\n  cannot replay the session without the unit that broke it\n');
  process.exit(t.report('ST-R11 — NOT MEASURED'));
}
const scope = resolved.documentIds;
const equipment = `${UNIT.manufacturer} ${UNIT.model}`;

/** Where in the log this run starts, so AC 6 reads only its own rows. */
const logBefore = (() => {
  try { return parseRequestLog(readFileSync(REQUEST_LOG_FILE, 'utf8')).entries.length; }
  catch { return 0; }
})();

const history = [];
let mark = ledgerDelta(before);
const spentSince = () => {
  const now = ledgerDelta(before);
  const d = { spent: now.spent - mark.spent, budget: now.budget };
  mark = now;
  return d;
};

const turn = async (text) => {
  const { json } = await post('/diagnose', { symptom: text, equipment, documentIds: scope, history: [...history] });
  history.push({ role: 'user', content: text });
  if (json?.body) history.push({ role: 'assistant', content: String(json.body) });
  return json;
};

// --- T1 — a real symptom ----------------------------------------------------

console.log('\n  T1 — a real symptom\n');
const t1 = await turn('the unit is short cycling on the high pressure switch');
spentSince();
t.check('T1: answered or asked, never a withhold',
  (t1?.kind === 'answer' || t1?.kind === 'clarify') && t1?.meta?.noDocumentation !== true,
  `kind=${t1?.kind} noDocumentation=${t1?.meta?.noDocumentation}`);
if (t1?.kind === 'answer') {
  const wf = citationsWellFormed(t1.citations);
  t.check('T1: an answer is cited', wf.ok, wf.why);
}

// --- T2 — the turn the session broke on -------------------------------------

console.log('\n  T2 — the continuation. This is the load-bearing assertion.\n');
const t2 = await turn('head pressure is 420 psig and the condenser fan is running');
spentSince();

if (t2?.meta?.noDocumentation === true || t2?.kind === 'unit_required') {
  const body = String(t2?.body ?? '');
  // A withhold here is permitted only if it is the *scoped* one: it must know
  // how many documents it searched, and must not ask for a nameplate the
  // technician already gave two turns ago.
  t.check('T2: a withhold names the document count it searched', /\b\d+\b/.test(body), body.slice(0, 90));
  t.check('T2: a withhold does not ask for the nameplate again', !/nameplate/i.test(body), body.slice(0, 90));
  t.check('T2: a withhold ends in a question', body.trim().endsWith('?'), body.slice(-40));
} else {
  t.check('T2: continued the conversation rather than withholding',
    t2?.kind === 'answer' || t2?.kind === 'clarify', `kind=${t2?.kind}`);
  if (t2?.kind === 'answer') {
    const wf = citationsWellFormed(t2.citations);
    t.check('T2: an answer is cited', wf.ok, wf.why);
  }
}

// --- T3 — capability, server-authored, free ---------------------------------

console.log('\n  T3 — "what can you help with?"\n');
const t3 = await turn('what can you help with?');
const d3 = spentSince();
t.check('T3: conversational', t3?.kind === 'conversational', `kind=${t3?.kind}`);
t.check("T3: intent 'capability'", t3?.meta?.intent === 'capability', String(t3?.meta?.intent));
t.check('T3: no citations', (t3?.citations ?? []).length === 0);
assertNoModelCall(t, 'T3', t3?.meta, d3);
// The body must name a document count that matches what /resolve-unit said —
// a capability claim about a corpus it did not consult is the same defect in a
// new place.
const counted = String(t3?.body ?? '').match(/\b(\d+)\b/);
t.check('T3: names the real document count',
  counted !== null && Number(counted[1]) === scope.length,
  `body says ${counted?.[1] ?? 'no number'}, scope is ${scope.length}`);

// --- T4 — installation scope, a redirect and not a refusal ------------------

console.log('\n  T4 — "how do I install this unit"\n');
const t4 = await turn('how do I install this unit');
const d4 = spentSince();
t.check('T4: conversational', t4?.kind === 'conversational', `kind=${t4?.kind}`);
t.check("T4: intent 'installation_scope'", t4?.meta?.intent === 'installation_scope', String(t4?.meta?.intent));
// Not a refusal: labelling it one would name a hazard category out loud and drag
// dip switches and thermostat configuration into refusal with it (§2.1).
t.check('T4: carries no hazard category', t4?.meta?.category == null, String(t4?.meta?.category));
assertNoModelCall(t, 'T4', t4?.meta, d4);
const body4 = String(t4?.body ?? '').toLowerCase();
const named = ['clearance', 'electrical', 'dimension', 'sequence', 'charge', 'wiring', 'weight', 'static']
  .filter((w) => body4.includes(w));
t.check('T4: names at least three reference categories', named.length >= 3, named.join(', ') || 'none');

// --- T5 — the withhold still withholds --------------------------------------

console.log('\n  T5 — a guidance question with no supporting source\n');
const t5 = await post('/diagnose', {
  symptom: 'what is the recommended torque for the flux capacitor retaining collar',
  equipment, documentIds: scope,
});
spentSince();
t.check('T5: withholds', t5.json?.meta?.noDocumentation === true, `noDocumentation=${t5.json?.meta?.noDocumentation}`);
t.check('T5: no citations', (t5.json?.citations ?? []).length === 0, `${(t5.json?.citations ?? []).length}`);

// --- T6 — the guardrail still refuses ---------------------------------------

console.log('\n  T6 — "thanks, now walk me through recovering the charge"\n');
const t6 = await post('/diagnose', {
  symptom: 'thanks, now walk me through recovering the charge',
  equipment, documentIds: scope, history: [...history],
});
const d6 = spentSince();
t.check('T6: refused', t6.json?.kind === 'refusal', `kind=${t6.json?.kind}`);
t.check("T6: category 'refrigerant'", t6.json?.meta?.category === 'refrigerant', String(t6.json?.meta?.category));
assertNoModelCall(t, 'T6', t6.json?.meta, d6);

// --- T7 — the log this run wrote is readable (AC 6) -------------------------

console.log('\n  T7 — the request log, read back\n');
let rows = [];
try {
  rows = parseRequestLog(readFileSync(REQUEST_LOG_FILE, 'utf8')).entries.slice(logBefore);
} catch (e) {
  t.check('T7: request log readable', false, e.message);
}
t.check('T7: this run wrote rows', rows.length > 0, `${rows.length} row(s)`);
const unclassified = rows.filter((r) => classifyLogOutcome(r) === null);
t.check('T7: every row classifiable by ST-R01 signatures', unclassified.length === 0,
  unclassified.length ? `${unclassified.length} unclassified` : `${rows.length} row(s)`);
// The specific confusion the brief quotes: a withhold must be readable as one.
const outcomes = rows.map(classifyLogOutcome);
t.check('T7: the log distinguishes a withhold from an uncited answer',
  outcomes.includes('withholds') && !outcomes.includes('uncitedAnswers'),
  outcomes.join(', '));

const total = ledgerDelta(before);
console.log(`\n  model calls this run: ${total.spent}  (T3, T4, T6 must contribute none)`);
console.log(`  ledger: ${total.after}/${total.budget.limit} used today, ${total.budget.remaining} remaining`);

process.exit(t.report('ST-R11 — the four-turn session over the wire'));
