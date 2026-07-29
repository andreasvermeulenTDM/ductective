# Ductective

AI diagnostic assistant for HVAC technicians. Describe a symptom or photograph a
nameplate; get correct, cited, step-by-step guidance from OEM service literature.

Phase 1 targets **light-commercial packaged rooftop units** — Trane Precedent and
Carrier 48/50 — the equipment the knowledge base actually covers.

> **Status: pre-scaffold.** No application code exists yet. This repo currently
> holds the plan, the agent pipeline, the brand system, and the corpus manifest.
> See [SETUP-BLOCKERS.md](SETUP-BLOCKERS.md) before starting work.

## Start here

| Document | What it is |
|---|---|
| [Ductective-Plan-v3.md](Ductective-Plan-v3.md) | **Plan of record.** Scope, brand, corpus, phases, budget, sequencing. |
| [SETUP-BLOCKERS.md](SETUP-BLOCKERS.md) | The human-only critical path. Eight items, none doable by an agent. Read before any pipeline run. |
| [CLAUDE.md](CLAUDE.md) | Pipeline conventions and the two domain rules that bind every stage. |
| [.pipeline/00-brief.md](.pipeline/00-brief.md) | Brief for **Run A** (rails + knowledge base) — the active run. |
| [.pipeline/00-brief-run-b.md](.pipeline/00-brief-run-b.md) | **Run B** (diagnostic core). Where the two rules below become code. |
| [.pipeline/00-brief-run-c.md](.pipeline/00-brief-run-c.md) | **Run C** (chat + camera UI). Produces the Phase 1 exit artifact. |

## Stack

Expo + React Native (iOS · Android · tablet, one codebase) · Supabase
(Postgres + pgvector) · Claude API for reasoning and nameplate vision · Voyage
for embeddings. Decided and locked — see the plan before proposing changes.

## The two rules

Every agent and every stage is bound by these. They are in
[CLAUDE.md](CLAUDE.md) and they are not negotiable to make a story pass.

1. **Cite every claim.** Any diagnostic statement traces to a specific source
   document and page. An uncited claim is a defect; a citation that does not
   support the claim attached to it is a worse one.
2. **Advise-only, with hard refusals.** The system advises. It never instructs a
   technician through gas/combustion work, live electrical work, or refrigerant
   handling — it points to standard safety procedure instead.

## Layout

```
.claude/agents/     7 pipeline agents
.pipeline/          stage artifacts
brand/              svg · png · favicon · brand-board.html · README.txt (authoritative)
data/manifest.csv   corpus manifest — 27 rows, source URLs, license status
docs/               superseded plans, kept for history
HVAC Data/          source PDFs, gitignored (209 MB, 25 files)
```

`app/` and `ingest/` are created by P1.0/P1.1 and don't exist yet.

## The pipeline

Seven stages, strictly sequential, handing off through committed `.pipeline/`
artifacts: research → user-stories → **knowledge** → backend → frontend → test →
**eval**. Stages 5 and 5.5 answer different questions — `test` verifies the code
works, `eval` verifies the answers are right, correctly cited, and correctly
refused. A round isn't done until both pass.

Phase 1 runs the pipeline three times: **Run A** rails + knowledge base, **Run B**
diagnostic core, **Run C** chat + camera UI. Each has its own brief; at kickoff the
incoming brief moves to `.pipeline/00-brief.md` and the outgoing one is archived to
`.pipeline/runs/`.

Recruiting a technician to validate accuracy runs in parallel and is human-owned —
it's the longest pole in the project, depends on nothing else, and its verdict
**overrides** eval's score. If the tech disagrees with an answer eval marked
correct, the tech is right and the scenario set is wrong.

## Corpus

25 PDFs, ~209 MB, all freely-published OEM or US public domain — 18 Trane and
Carrier rooftop documents, 3 refrigerant PT charts, plus Daikin, Mitsubishi VRF,
a chiller IOM, and EPA Section 608. Per-file provenance and license status are in
`data/manifest.csv`.

Two manifest rows have no file on disk, and on-disk filenames are source names
rather than the manifest's `FileName` column — **join on `SourceURL` basename**.
Both issues are documented in the plan and the Run A brief.

## History

The previous attempt lives at `andreasvermeulenTDM/ductective-v1` (private). It
reached a written-but-never-executed backend across two platform pivots before
stalling on the setup blockers above. It's kept for reference; this repo does not
build on its code.
