/**
 * Epics 7 & 8 — Evaluation scaffolding and operability. Every round.
 * Stories E7.1, E8.1, E8.2.
 *
 * E7.2/E7.3/E7.5 are Stage 5.5's scoring work and are not duplicated here. What
 * Stage 5 owns is that the scenario set E7.1 promises actually exists and covers
 * the plan's fault list — Run A's brief makes standing it up Eval's only job, and
 * an absent scenario set means Run B is scored against nothing.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';

const SCENARIO_SET = 'tests/fixtures/scenario-set.json';
const FAULTS = 'tests/fixtures/top-15-faults.json';

export default defineSuite({
  epic: 'E7/E8',
  title: 'Evaluation scaffolding & operability',
  run: '*',
  checks: [
    {
      story: 'E7.1',
      ac: 'brief §Verification',
      what: 'the scenario set exists and is version-controlled',
      async run(c) {
        const raw = c.read(SCENARIO_SET);
        if (!raw) {
          return fail(
            c.fromFile(SCENARIO_SET, 'absent'),
            `no scenario set — Run A's brief makes standing this up Stage 5.5's only deliverable; routes to Eval`
          );
        }
        const tracked = await c.git('ls-files', SCENARIO_SET);
        const ev = c.fromCheck(`git ls-files ${SCENARIO_SET}`, tracked.stdout.trim() || '(untracked)');
        return tracked.stdout.trim()
          ? pass(ev)
          : fail(ev, 'the scenario set is untracked — it must only ever grow, which requires history');
      },
    },

    {
      story: 'E7.1',
      what: 'the scenario set covers all 15 faults from the plan',
      async run(c) {
        const raw = c.read(SCENARIO_SET);
        if (!raw) return blocked(`${SCENARIO_SET} does not exist — Eval (Stage 5.5) owns it`);

        const set = JSON.parse(raw);
        const { faults } = JSON.parse(c.read(FAULTS));
        const covered = new Set((set.scenarios ?? []).map((s) => s.fault));
        const missing = faults.filter((f) => !covered.has(f.id));

        const ev = c.fromCheck(
          `cross-reference ${SCENARIO_SET} against ${FAULTS}`,
          faults.map((f) => `${covered.has(f.id) ? 'ok  ' : 'MISS'}  ${f.id}  ${f.name}`).join('\n')
        );
        return missing.length === 0
          ? pass(ev, `all ${faults.length} faults covered`)
          : fail(ev, `${missing.length} fault(s) uncovered: ${missing.map((f) => f.id).join(', ')}`);
      },
    },

    {
      story: 'E7.1',
      what: 'every advise-only fault is marked as a hard-refusal scenario',
      async run(c) {
        const raw = c.read(SCENARIO_SET);
        if (!raw) return blocked(`${SCENARIO_SET} does not exist — Eval (Stage 5.5) owns it`);

        const set = JSON.parse(raw);
        const { faults } = JSON.parse(c.read(FAULTS));
        const mustRefuse = faults.filter((f) => f.refusal);
        const byFault = new Map((set.scenarios ?? []).map((s) => [s.fault, s]));

        const wrong = mustRefuse.filter((f) => byFault.get(f.id)?.expectRefusal !== true);
        const ev = c.fromCheck(
          'assert expectRefusal on every advise-only fault',
          mustRefuse
            .map((f) => `${byFault.get(f.id)?.expectRefusal === true ? 'ok  ' : 'MISS'}  ${f.id}  ${f.name} (${f.category})`)
            .join('\n')
        );
        return wrong.length === 0
          ? pass(ev, `${mustRefuse.length} refusal scenarios marked`)
          : fail(ev, `not marked as hard refusals: ${wrong.map((f) => f.id).join(', ')} — a refusal scenario scored as an answer is a guardrail hole`);
      },
    },

    {
      story: 'E8.1',
      what: 'SETUP-BLOCKERS.md lists every human-only step, with what it blocks',
      async run(c) {
        const src = c.read('SETUP-BLOCKERS.md');
        if (!src) return fail(c.fromFile('SETUP-BLOCKERS.md', 'absent'), 'the human-only critical path is not written down');

        const required = [
          { label: 'Supabase project', re: /supabase.*(account|project)/i },
          { label: 'Anthropic key', re: /anthropic/i },
          { label: 'Voyage key', re: /voyage/i },
          { label: 'physical device', re: /(physical|real).*(ios|android|device)|expo go/i },
          { label: 'tech recruitment', re: /(recruit|technician|tech).*(validat|review)|commercial.*tech/i },
        ];
        const missing = required.filter((r) => !r.re.test(src)).map((r) => r.label);
        // Each entry must state what unblocks it and what it blocks — the table's
        // "Needed for" column is that second half.
        const hasNeededFor = /needed for/i.test(src);

        const ev = c.fromFile(
          'SETUP-BLOCKERS.md',
          required.map((r) => `${r.re.test(src) ? 'ok  ' : 'MISS'}  ${r.label}`).join('\n') +
            `\n"Needed for" column present: ${hasNeededFor}`
        );
        if (missing.length) return fail(ev, `unlisted human-only steps: ${missing.join(', ')}`);
        return hasNeededFor ? pass(ev) : fail(ev, 'entries do not state what each blocker blocks');
      },
    },

    {
      story: 'E8.2',
      ac: 'brief AC 8',
      what: 'cumulative spend is tracked in one place against the ~$1,000 ceiling',
      requires: 'knowledge',
      async run(c) {
        const candidates = ['docs/spend.md', '.pipeline/025-knowledge.md', 'SETUP-BLOCKERS.md'];
        const found = candidates.filter((f) => /\$\s?\d/.test(c.read(f) ?? ''));
        const ev = c.fromCheck(
          'search for a cost record',
          found.length ? `cost figures found in: ${found.join(', ')}` : '(no cost figures recorded anywhere)'
        );
        return found.length > 0
          ? pass(ev, `spend recorded in ${found[0]}`)
          : fail(ev, 'no run has reported its cost — brief AC 8 requires re-ingest cost and runtime');
      },
    },
  ],
});
