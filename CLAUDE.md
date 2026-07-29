# Project conventions — multi-stage implementation pipeline

This file auto-loads into every Claude Code session and subagent. It holds the
shared rules for a sequential, review-gated implementation pipeline. Keep it short.

## The pipeline

Work moves through seven stages plus an iterate-until-done loop. Each stage runs as
its own session/subagent and hands off through committed files in `.pipeline/`:

| Stage | Agent | Reads | Writes |
|-------|-------|-------|--------|
| 0 | (you)          | —                   | `.pipeline/00-brief.md` (the objective + constraints) |
| 1 | research       | `00`                | `.pipeline/01-research.md` |
| 2 | user-stories   | `00`, `01`          | `.pipeline/02-user-stories.md` |
| 2.5 | knowledge    | `00`, `01`, `02`    | `.pipeline/025-knowledge.md` + code + PR |
| 3 | backend        | `01`, `02`, `025`   | `.pipeline/03-backend.md` + code + PR |
| 4 | frontend       | `01`, `02`, `03`    | `.pipeline/04-frontend.md` + code + PR |
| 5 | test           | all above           | `.pipeline/05-test-report.md` |
| 5.5 | eval         | all above           | `.pipeline/055-eval.md` |
| loop | (owning agent) | `05`, `055` + fresh verification | `.pipeline/06-round-N.md` |

Stages are strictly sequential: a stage may only start once the previous stage's
`.pipeline/*` artifact is committed and its PR reviewed. If a task has no backend,
no frontend, or no knowledge-base component, that stage's agent notes "nothing to
do" and hands off.

Stages 5 and 5.5 answer different questions and neither substitutes for the other:
**test** verifies the code works; **eval** verifies the system's *answers* are
correct, correctly cited, and correctly refused. A round is not done until both
pass.

## Stage 0 — the brief (you provide this)

Before Stage 1, write `.pipeline/00-brief.md` with: the objective, in/out-of-scope
boundaries, hard constraints, and the **acceptance criteria that define "done"**
(what must be true and how it will be verified). Everything downstream is measured
against this file. If you'd rather state the objective conversationally at kickoff,
the research agent will capture it into `00-brief.md` first.

## Rules for every agent

- Work on a branch named `stage/<name>` (e.g. `stage/backend`). Never commit to the default branch directly.
- **Read the prior `.pipeline/*` artifacts first.** They are the source of truth — do not re-derive from scratch or contradict them silently.
- **Do not guess.** If a decision is genuinely ambiguous, record it as an `OPEN QUESTION` in your artifact with a proposed default, and proceed with the default.
- Never commit secrets, `.env`, API keys, or tokens.
- Match the existing codebase's conventions, style, and libraries — don't introduce new dependencies or patterns without justifying it in your artifact.
- Keep commits small and focused; write clear messages.
- Prefer extending working code over rewriting it. Preserve existing behavior unless the brief says to change it.
- Before handing off: run the repo's existing lint, test, and build commands and report their status in your artifact.

## Domain rules — this project

Ductective is an AI diagnostic assistant for HVAC technicians. Two rules bind
every agent, at every stage:

- **Cite every claim.** Any diagnostic statement traces to a specific source
  document and page in the knowledge base. An uncited claim is a defect, and a
  citation that does not support the claim attached to it is a worse one.
- **Advise-only, with hard refusals.** The system advises; it never instructs a
  technician through gas/combustion work, live electrical work, or refrigerant
  handling. It points to standard safety procedure instead. No stage may weaken
  this to make a story pass.

Brand assets and design tokens that ship in the repo are the source of truth for
anything visual — do not infer a parallel style.

## "Done" exit criteria (when the loop stops)

The loop stops when every acceptance criterion in `.pipeline/00-brief.md` passes,
the full test/build suite is green, the eval scores meet the bar the brief sets
with zero safety-guardrail leaks, and there are no open Critical/High issues.
Anything lower-priority still open goes to `.pipeline/backlog.md`, not blocking.
