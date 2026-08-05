# M12 — the measurement gate ⛔

**A spike. Built to be discarded.** Nothing here is production code, and nothing
here should be promoted into `ingest/` or `lib/`. M6–M10 are calibrated *by* this
output; they do not import it.

```bash
node --env-file=.env spike/m12/run.mjs                      # Flash, all 15 faults
node --env-file=.env spike/m12/run.mjs --model gemini-3.1-pro-preview
node --env-file=.env spike/m12/run.mjs --faults 3 --delay 7000
```

Results land in `spike/m12/out/<model>.json`.

## What it measures, and why these four

Four numbers, taken **before** committing to the citation design, because finding
them in Run B's eval is expensive and finding them here is not.

| # | Number | Why it decides something |
|---|---|---|
| 1 | **Span-verification rate** | Anthropic's `search_result` returned `cited_text` for free. On Gemini the model must copy the supporting span itself. If it cannot do that character-exactly, the whole citation design changes. |
| 2 | **Chunk-id fabrication rate** | A cited id outside the per-request map is an invented source. Ids are `c1..c8` **per request**, never database ids, so a fabrication is detectable without a lookup and cannot be recited from training data. |
| 3 | **Provider block rate** | `00-brief-run-b.md`: a provider block is an error, never a refusal. If Google's filter fires on legitimate rooftop diagnostics, that is a business decision, not an engineering one. |
| 4 | **Real token counts** | The per-answer cost drove the whole migration. Each fault is run **twice** — once with `quoted_span` in the schema, once without — so the output cost of carrying spans is isolated rather than estimated. |

## Two deviations from M12 as written

**Chunks come from `pdftotext`, not from pgvector.** There is no `chunks` table —
Stage 2.5 has not run. All four numbers measure what the model does with *real
manual text*; none depends on where that text was stored on the way in. Using
synthetic text would have been unsound, because dense IOM prose — tables, model
numbers, fragmentary lines — is exactly what makes character-exact copying hard.
It also keeps the gate off ingestion's critical path, which matters because M12
blocks M6–M10.

**Chunk selection is keyword overlap, not vector retrieval.** Deliberate. This
gate measures whether the model copies faithfully and stays inside its id map.
Retrieval quality is criterion 7 and belongs to Stage 2.5. Keeping them apart
means a poor retrieval result cannot be misread as a poor span-verification
result. Every fault gets a full 8 chunks even where overlap is weak — a short
context is an easier copying task and would flatter number 1.

## The free-tier daily cap, and why pacing does not help

Measured from the 429 detail on 4 Aug 2026:

```
GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20
```

**20 requests per day, per model.** Not per minute — so waiting does nothing, and
the paced run did worse than the unpaced one because it spent the remaining
allowance on retries. A full gate run is 15 faults x 2 schemas = 30 calls, which
cannot complete in a day as written.

`--no-baseline` drops it to 15 calls, inside the cap. The cost is number 4's span
*overhead*; in/out totals stay real. The cap is per **model**, so a Pro comparison
run has its own separate allowance.

The owner has said the free tier is theirs to manage and is not a concern — this
is recorded as an operating constraint on the harness, not as a finding about the
migration.

Pacing lives here, in the spike, not in the adapter. The adapter's bounded backoff
is correct for a transient 429 and useless against a daily quota. Production must
not paper over a quota ceiling with retries.

## Reading the stop conditions

Any one of them ends or redirects the migration:

1. **Span verification below ~95% → run the same set on Pro before redesigning.**
   Flash is a smaller model asked to copy text character-exactly across an
   8-chunk context, which is precisely where a smaller model drifts. If Pro
   clears the bar and Flash does not, that is a **model-tier decision, not an
   architecture failure** — and M12 names it the single most likely outcome of
   this whole migration.
2. **Any provider block at the loosest permitted safety settings** — structural
   problem with the domain.
3. **Per-answer cost materially above the ~$0.04 baseline** against the ~$25 eval
   cap — per `00-brief-run-b.md`, context construction gives way, not the budget.

A fault that errors is recorded separately from one that produced claims. An
error is a failure of the *run*, not a measurement, and must never be averaged
into a pass rate.

## UNMEASURED is a distinct outcome from pass or fail

The harness refuses to report a gate result from too little data: it needs **80%
of faults to produce results and >=20 claims**. Below that it prints `UNMEASURED`,
says the numbers are not the gate's output, and exits **2**.

This exists because the first two runs produced 78.6% (11/14) and 25.0% (1/4) span
verification. Both are quotable-looking percentages computed from almost nothing,
and either could have been written into the stage artifact as "the number". Exit
codes: `0` clean, `1` a stop condition fired, `2` not measurable.
