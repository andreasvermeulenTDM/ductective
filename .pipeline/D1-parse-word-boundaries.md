# D1 — Word boundaries lost at extraction

**Severity:** Critical · **Owner:** Knowledge (Stage 2.5) · **Found by:** Backend (Stage 3), 5 Aug 2026
**Status:** parser fixed on `stage/backend-diagnose`; **corpus not yet re-ingested**
**Affects:** S11 (parse quality), S12 (chunking), S17 (retrieval contract), and every
citation quality criterion downstream

Filed under the Run B brief's instruction that a retrieval defect must be routed to
Knowledge rather than compensated for in the prompt — "a retrieval defect papered
over in the prompt is the most expensive kind of shortcut here, because it looks
like it worked."

## Symptom

Chunk text in the live corpus has whole clauses fused into single tokens:

```
"Condensercoildirtyorrestricted. Cleancoilorremoverestriction. ExcessiveCondenserPressures."
"Leakingvalvesincompressor. Replacecompressor. Airinsystem."
```

It reads as a cosmetic parse curiosity. It is a retrieval failure.

## Why it matters more than it looks

`to_tsvector` never emits `condenser`, `dirty`, or `restriction` for that page, so
the lexical index cannot see the page's own subject matter. Measured across all
3,685 live chunks:

| Token | Chunks carrying it as a **delimited word** |
|---|---|
| `pressure` | 66% |
| `condenser` | 49% |
| `trane` | **25%** |
| `precedent` | **20%** |

The damage falls hardest on the manufacturer and model tokens — precisely the terms
that distinguish one manual from another, and precisely what `sql/004`'s hybrid
retrieval depends on.

**This is why applying `sql/004` made retrieval worse.** Measured the day it was
applied:

| *"Trane Precedent rooftop unit tripping on high head pressure"* | Trane docs in top 5 |
|---|---|
| Vector-only `match_chunks` | 2 (both real Precedent IOMs) |
| Hybrid RRF `match_chunks_hybrid` | 1 |

The lexical arm's top 8 for that query contained **zero occurrences of "trane",
"precedent", or "pressure"** and was dominated by product-data catalogues. RRF's
design is sound and its diagnosis was right; it was fusing a working vector arm
with an arm that had been starved of its vocabulary. Backend has defaulted
retrieval to vector-only (`RETRIEVAL_MODE=hybrid` opts in) until this is fixed.

It degrades the vector arm too, though less visibly: the embedding of
`condensercoildirtyorrestricted` is not the embedding of its words.

## Root cause

`ingest/parse.py` called `page.extract_words()` with pdfplumber's default
`x_tolerance` — an absolute **3 points**. Several documents in this corpus set
inter-word spacing by glyph positioning rather than emitting a space character, at
gaps below 3pt. pdfplumber therefore treated the whole run as one word.

It is per-document, which is why it went unnoticed: `RT-SVX46G-EN` p.9 extracts
cleanly while `48-50LC-4-6-C01T` p.33 does not.

## Why S11's quality measurement missed it

This is the part worth carrying forward. S11 measured char count, alpha ratio,
two-column detection, and error pages. **Fused text scores *better* on alpha ratio
than correct text**, because removing spaces raises the proportion of alphabetic
characters. The one metric that could have caught it pointed the wrong way, and
every other signal was blind to it.

A document can pass every quality gate and still be unusable for retrieval.

## Fix applied

`ingest/parse.py`:

- `x_tolerance_ratio=0.15` — scales the tolerance with font size rather than fixing
  it in points, which is what makes a single setting correct across a 6pt table and
  a 14pt heading.
- New `glued_tokens` per page and `glued_ratio` per document: alphabetic runs over
  18 characters. The longest ordinary word in this corpus's prose is
  "troubleshooting" at 15.
- `PARSER_VERSION = 2`, emitted in the output.

`ingest/parse.mjs`:

- Cache invalidates on `parser_version`. It was keyed on filename alone, so this fix
  would have been invisible to anyone with a warm cache — a fix that appears to do
  nothing is worse than the bug.
- New disposition: `glued_ratio > 0.005` returns `ingest-with-caveat` naming D1.
  Checked **before** the tabular-by-design exemption, since fused text is a parser
  failure whatever the document type.

### Verification

Chosen by measurement, not by taste. Across the corpus, `x_tolerance_ratio=0.15`
produces **identical** output on documents that were already clean, and repairs the
affected ones:

| Document | Tokens (before → after) | Fused tokens (before → after) |
|---|---|---|
| `2015-26946` (clean) | 313 → 313 | 0 → 0 |
| `50HC-7-12-07SI` (clean) | 566 → 566 | 0 → 0 |
| `48-50LC-4-6-C01T` | 187 → **1059** | 24 → **0** |
| `48HJ-32SI` | 260 → **495** | 10 → **0** |
| `50E-C2SI` | 47 → **80** | 1 → **0** |

Canary word counts (`condenser`, `pressure`, `compressor`, `refrigerant`,
`temperature`, `precedent`) are unchanged in every case — the tighter tolerance is
not fragmenting real words.

Full re-parse of `48-50LC-4-6-C01T`: 88 pages, `glued_ratio` **0.0000**, page 33 now
reads `"Cooling Troubleshooting / Use the Scrolling Marquee display or a CCN device
to view the..."`.

## What Knowledge still needs to do

The parser is fixed; **the corpus is not**. The live database still holds the chunks
produced by parser v1.

1. **Re-ingest.** `npm run ingest`. Content hashes change for the affected
   documents, so those chunks are re-embedded and the stale ones deleted; unchanged
   documents are not re-embedded and not paid for again.
2. **Re-run the smoke set** (`npm run ingest:smoke`) and record the before/after in
   `025-knowledge.md`. The 10-of-12 bar in brief AC 7 was measured against the
   broken corpus and is not a valid baseline.
3. **Re-evaluate hybrid.** With word boundaries restored, `sql/004` should be
   measured again on both modes. If it wins, Backend flips the default back — the
   decision belongs to the measurement, which is what `sql/004`'s own comment asks
   for in keeping `match_chunks` in place.
4. **Check the scope tagging while you are there.** Separately observed:
   `TEMP-SVX001A-EN_AirCooled-Chiller-25-120ton-IOM` returns with `in_scope = true`,
   and `00-brief.md` says chillers are ingested but tagged out of Phase 1 answer
   scope.

## Boundary note

`ingest/` is Stage 2.5's code and `.claude/agents/backend.md` forbids Backend
editing it. This fix was made at the owner's explicit direction after the defect
report was requested, and is declared here rather than merged quietly. Knowledge
should review it as its own — particularly the choice of `0.15`, which is a
judgement about this corpus, not a universal constant.
