/**
 * harness.mjs — the four-verdict check runner.
 *
 * Stage 5 reports PASS / FAIL / HUMAN-ONLY / BLOCKED, never a bare pass/fail.
 * See .claude/agents/test.md: a criterion this process did not mechanically
 * execute may never be reported as PASS, and a check that could not run because
 * a credential or a stage is missing is BLOCKED — not FAIL. Reporting a missing
 * environment as a defect sends the iterate-until-done loop chasing something
 * that isn't broken.
 *
 * No test framework, by choice. The repo has no test toolchain yet (story E0.7)
 * and the brief's constraints are "boring, working, few dependencies". This
 * mirrors scripts/verify-connection.mjs, which is the convention already here.
 */

import { execFile } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const HUMAN = 'HUMAN-ONLY';
export const BLOCKED = 'BLOCKED';

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Evidence is the exact command, its exit code, and the relevant output — enough
 * that a reader can re-run it and get the same answer. Prose asserting that
 * something works is not evidence, and this shape is what stops it becoming one.
 */
function evidence({ command, exitCode, output }) {
  return { command, exitCode, output: truncate(output ?? '') };
}

function truncate(s, max = 1400) {
  const t = String(s).trimEnd();
  return t.length <= max ? t : `${t.slice(0, max)}\n… (${t.length - max} more chars)`;
}

// ---------------------------------------------------------------------------
// Verdict builders — what a check's run() returns
// ---------------------------------------------------------------------------

export const pass = (ev, note) => ({ verdict: PASS, evidence: ev, note });
export const fail = (ev, note) => ({ verdict: FAIL, evidence: ev, note });

/** Could not execute. `missing` must name exactly what was absent. */
export const blocked = (missing, ev) => ({
  verdict: BLOCKED,
  evidence: ev ?? evidence({ command: '(not run)', exitCode: null, output: '' }),
  note: missing,
});

/** Needs a device, an external account, or a human eye. No agent may claim it. */
export const human = (steps) => ({
  verdict: HUMAN,
  evidence: evidence({ command: '(human verification)', exitCode: null, output: steps }),
  note: steps,
});

// ---------------------------------------------------------------------------
// Context handed to every check
// ---------------------------------------------------------------------------

export const ctx = {
  ROOT,

  /** Run a binary with no shell, so the same check works on Windows and POSIX. */
  async sh(bin, args = [], opts = {}) {
    const cwd = opts.cwd ? join(ROOT, opts.cwd) : ROOT;
    const command = `${opts.cwd ? `cd ${opts.cwd} && ` : ''}${bin} ${args.join(' ')}`.trim();
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, {
        cwd,
        shell: process.platform === 'win32',
        maxBuffer: 20 * 1024 * 1024,
      });
      return { ...evidence({ command, exitCode: 0, output: stdout || stderr }), stdout, stderr };
    } catch (e) {
      const output = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message;
      return {
        ...evidence({ command, exitCode: e.code ?? 1, output }),
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
      };
    }
  },

  git(...args) {
    return ctx.sh('git', args);
  },

  exists: (rel) => existsSync(join(ROOT, rel)),

  read(rel) {
    try {
      return readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      return null;
    }
  },

  list(rel) {
    try {
      return readdirSync(join(ROOT, rel));
    } catch {
      return [];
    }
  },

  /** Every git-tracked path. The basis for "no secret is in a tracked file". */
  async tracked() {
    const r = await ctx.git('ls-files');
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  /** Evidence from reading a file rather than running a command. */
  fromFile: (rel, output) => evidence({ command: `read ${rel}`, exitCode: 0, output }),

  /** Evidence from a computation over files already read. */
  fromCheck: (label, output) => evidence({ command: label, exitCode: 0, output }),

  env: (name) => process.env[name] || null,
};

// ---------------------------------------------------------------------------
// Preconditions — which pipeline stages have actually landed
// ---------------------------------------------------------------------------

/**
 * .claude/agents/test.md opens with a precondition: confirm the artifact for
 * every stage this round touched is committed before running anything. A green
 * suite run against a tree missing a stage's code is worse than no run at all,
 * so a check whose owning stage has not landed reports BLOCKED against that
 * stage rather than FAIL against the code.
 */
export const stages = {
  knowledge: { artifact: '.pipeline/025-knowledge.md', label: 'Stage 2.5 (Knowledge)' },
  backend: { artifact: '.pipeline/03-backend.md', label: 'Stage 3 (Backend)' },
  frontend: { artifact: '.pipeline/04-frontend.md', label: 'Stage 4 (Frontend)' },
  research: { artifact: '.pipeline/01-research.md', label: 'Stage 1 (Research)' },
  stories: { artifact: '.pipeline/02-user-stories.md', label: 'Stage 2 (User stories)' },
};

export function stageLanded(name) {
  return ctx.exists(stages[name].artifact);
}

/** `requires: 'knowledge'` on a check turns into this BLOCKED verdict. */
export function stageBlocked(name) {
  const s = stages[name];
  return blocked(`${s.label} has not landed — ${s.artifact} is absent`);
}

// ---------------------------------------------------------------------------
// Suite definition
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   epic: string, title: string, run: 'A'|'B'|'C',
 *   checks: Array<{
 *     story: string, ac?: string, what: string,
 *     requires?: 'knowledge'|'backend'|'frontend'|'research'|'stories',
 *     needsEnv?: string[],
 *     run: (c: typeof ctx) => Promise<object>
 *   }>
 * }} def
 */
export function defineSuite(def) {
  return def;
}

export async function runSuite(suite) {
  const results = [];

  for (const check of suite.checks) {
    let outcome;

    if (check.requires && !stageLanded(check.requires)) {
      outcome = stageBlocked(check.requires);
    } else if (check.needsEnv?.some((k) => !ctx.env(k))) {
      const missing = check.needsEnv.filter((k) => !ctx.env(k));
      outcome = blocked(
        `environment: ${missing.join(', ')} not set — re-run with --env-file=.env`
      );
    } else {
      try {
        outcome = await check.run(ctx);
      } catch (e) {
        // A check that throws is a broken check, not a failing criterion. Say so
        // plainly rather than letting a harness bug read as a product defect.
        outcome = blocked(`check errored: ${e.message}`, {
          command: `${check.story} run()`,
          exitCode: null,
          output: e.stack ?? e.message,
        });
      }
    }

    results.push({
      epic: suite.epic,
      run: suite.run,
      story: check.story,
      ac: check.ac ?? '—',
      what: check.what,
      ...outcome,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Console output — same visual language as scripts/verify-connection.mjs
// ---------------------------------------------------------------------------

const COLOR = {
  [PASS]: '\x1b[32m',
  [FAIL]: '\x1b[31m',
  [BLOCKED]: '\x1b[33m',
  [HUMAN]: '\x1b[36m',
};

export function printResult(r) {
  const pad = r.verdict.padEnd(10);
  console.log(`  ${COLOR[r.verdict]}${pad}\x1b[0m ${r.story}  ${r.what}`);
  if (r.note) console.log(`             → ${r.note}`);
}
