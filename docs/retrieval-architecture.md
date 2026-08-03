# Retrieval architecture — decisions

Status: **decision doc, not a pipeline artifact.** Written 3 Aug 2026. This sits
outside `.pipeline/` deliberately — it does not satisfy the Stage 2 gate and it
is not `01-research.md`. See [Open items](#open-items) for what that leaves
unresolved.

Scope: how a technician's question becomes a cited answer. Everything from a PDF
on disk to a `search_result` block in a Claude request.

---

## 1. The measured corpus

Every figure here was measured, not estimated — a full `pdftotext` pass over all
25 PDFs, no sampling. It matters because it changes the answer.

| | Docs | Pages | Chars | ≈ Tokens |
|---|---|---|---|---|
| Phase 1 answer scope (Trane + Carrier rooftop + PT charts) | 20 of 21 | 1,752 | 4.93M | ~1.23M |
| Out of scope (chiller, Daikin, EPA) | 5 | 471 | 0.80M | ~0.20M |
| **Corpus total** | **25** | **2,223** | **5.73M** | **~1.43M** |

Page counts are exact (spot-checked: `RT-SVX23R` = 68 pages, PT chart = 2).
Character totals carry roughly ±2% depending on how page delimiters are counted.
Token figures are chars÷4 and will run somewhat high in reality — model numbers
and table fragments tokenise badly.

**24 of 25 PDFs have a clean text layer.** The sole image-only file is `1.pdf`
(43 pages, zero `/Font` objects), and it is out of Phase 1 scope. There is
nothing in scope to OCR.

Roughly **117 in-scope pages yield under 100 characters** — wiring diagrams and
dimensional drawings. Two Carrier product-data books account for 78 of them (39
of 144 pages each). Text-only ingestion silently drops that content; see
[§5 Deferred](#5-deferred-with-triggers).

### Why this reframes the question

Voyage's free tier is 200M tokens. The entire corpus is 1.43M. Embedding it costs
**$0.17 at list price and $0 in practice**, and the free tier absorbs ~139 full
re-ingests. Reranking's free tier covers ~10,000 queries. There is no OCR bill.

So **cost does not separate a POC from the long-term build.** Build hours do, at
under 10 a week. What follows is one architecture, with later components deferred
on measured triggers rather than a throwaway that gets replaced.

---

## 2. The stack

| Layer | Decision | POC | Long-term |
|---|---|---|---|
| Parse | pdfplumber (MIT), per-page text, both page numbers | ✅ | ✅ |
| Chunk | Per-page, structure-aware; **we** own the page map | ✅ | ✅ |
| Embed | `voyage-context-4`, `output_dimension: 1024` | ✅ | ✅ |
| Store | Supabase pgvector, HNSW `vector_cosine_ops` | ✅ | ✅ |
| Lexical | `tsvector` generated column + `pg_trgm` on model numbers | schema only | wired |
| Retrieve | vector top-k → measure → add RRF + rerank if it misses | ✅ | + `rerank-2.5` |
| Generate | `search_result` content blocks, Sonnet 5 | ✅ | + tool-call loop |
| Diagrams | text-only, gap logged per document | ✅ | + `voyage-multimodal-3.5` |

---

## 3. The five decisions

### 3.1 `voyage-context-4` at 1024 dimensions — forced, not preferred

pgvector's README is explicit: HNSW and IVFFlat support **`vector` up to 2,000
dimensions**, `halfvec` up to 4,000, `bit` up to 64,000. voyage-context-4's
default output is **2048**, which will not build an HNSW index on a `vector`
column. Matryoshka truncation to 1024 costs little quality and is the path of
least resistance. (`halfvec(2048)` is the escape hatch — pgvector 0.8.2 is
installed on our instance, and halfvec landed in 0.7.0 — but take it only if
evals show 1024 is genuinely lossy.)

Consequence: **`EMBED_DIM = 1024` at `lib/clients.mjs:63` is correct.** No
re-embed is needed. Only its comment is wrong — it cites `voyage-3-large`, which
the Voyage 4 family superseded in January 2026.

This also settles a question nobody asked yet: **do not build Anthropic's
Contextual Retrieval pipeline.** That 2024 technique (LLM-generate a situating
blurb per chunk, then embed) is superseded — voyage-context-4 does contextual
embedding natively and beats the hand-rolled version by 6.76% on chunk-level
retrieval, with no augmentation pass, no added latency, and nothing to maintain.

### 3.2 Do NOT use Voyage auto-chunking

This is the easiest thing on this page to get wrong, and it fails in the worst
way — silently, after a full ingest.

voyage-context-4 will accept a whole document as one string and chunk it for you.
**That destroys the page mapping.** Our schema requires `page_number NOT NULL`
(`docs/phase1-story-map.md:133`, brief criterion 4) precisely so that a chunk
which cannot name its page is rejected at write time rather than tolerated. A
Voyage-chosen chunk boundary has no page to report.

Instead: **chunk per page ourselves, then submit the chunks as an array** to
voyage-context-4's contextualized-input mode. Each chunk is still embedded with
its surrounding document context — that is the whole point of the model — and we
keep an exact page map. We give up nothing.

### 3.3 `search_result` blocks replace all citation plumbing

Standard Messages API, no beta header, supported on every current model except
Haiku 3. Build the block as:

```json
{
  "type": "search_result",
  "source": "manual://RT-SVX23R-EN#p47",
  "title": "RT-SVX23R-EN — Precedent Rooftop IOM, p.47",
  "content": [{ "type": "text", "text": "<chunk text>" }],
  "citations": { "enabled": true }
}
```

Claude returns structured `search_result_location` citations carrying `source`,
`title`, and `cited_text` — the verbatim supporting span. **`cited_text` counts
toward neither input nor output tokens**, on the initial response or when passed
back in later turns.

Three things fall out of this:

- No chunk-ID injection, no prompt scaffolding, no regex citation parser, no
  validator. The v1 repo designed all four; none of them are needed now.
- It **fills the gap documented at `app/components/Citation.tsx:53-59`** — the UI
  wants to show the retrieved passage, and the persisted citation carries only
  `claim`. `cited_text` is that passage, for free.
- The identical block works whether pre-retrieved into a user message or returned
  from a tool call. **Agentic retrieval later is a flag, not a rewrite.**

Encode the page in `source` and citation granularity is solved by construction.

### 3.4 Build the lexical columns now, wire them later

HVAC queries are dense with exact-match tokens that embeddings handle badly:
`RT-SVX23R`, `48-50LC`, fault codes, terminal letters `R`/`W`/`Y`/`G`/`C`. A
technician typing "58MVC E4" needs lexical matching, and pure vector search will
cheerfully return the semantically-similar wrong manual.

So hybrid retrieval will probably be needed. But:

- **Add the `tsvector` generated column and `pg_trgm` index in the first
  migration.** They cost nothing at write time and are painful to retrofit.
- **Wire retrieval vector-only first**, and let the 12-query smoke set
  (brief criterion 7) decide whether RRF fusion and reranking earn their place.

That ordering matches the story map's own stance — chunk size is to be "justified
against the smoke set rather than us guessing here" (`docs/phase1-story-map.md:756`).
Same discipline, applied to retrieval.

Plain Postgres `tsvector` + Reciprocal Rank Fusion is enough. It is ~30 lines of
SQL and included in the Supabase bill. ParadeDB's true BM25 is better in the
abstract, but it means a second database to run, replicate and pay for — see §5.

### 3.5 Build the long-context control

Classify the equipment → load one whole manual → answer with native PDF
`page_location` citations. No vector store at all.

The in-scope average manual is ~61k tokens; the largest (`48-50PGPM`, 188 pages)
is ~165k. With a 1-hour cache write that is **~$0.37 per manual-hour, then
~$0.02 per query**. An evening's work.

It is not the recommended answer path — published evidence on exactly this
problem shape (Agri-Query, arXiv 2508.18093v2, 2026-03-06: a 165-page equipment
manual with needle-in-haystack and deliberately unanswerable questions) found
hybrid RAG beat long-context prompting even where the manual fit comfortably in
context, 88% accuracy. And "which manual" classification is itself the hard part:
pick wrong and you get a confident answer with correct-looking citations to the
wrong equipment — the exact failure `CLAUDE.md` exists to prevent.

Build it anyway, as a **control**. Run it against the same 12 queries. Otherwise
every later retrieval improvement is measured against nothing, and we will never
know whether the vector store is earning its keep.

---

## 4. Cost model

Verified against vendor pages on 3 Aug 2026.

| Line | Cost | Note |
|---|---|---|
| Parsing | **$0** | pdfplumber; 24/25 docs have text layers |
| Embedding, full corpus | **$0** | $0.17 list; 200M free tier ≈ 139 re-ingests |
| Reranking | **$0** | `rerank-2.5-lite` $0.02/MTok, 200M free ≈ 10k queries |
| Supabase | $0–25/mo | Free tier pauses after 1 week idle; Pro if demoing |
| Per answer (8 chunks, Sonnet 5) | ~$0.04 | ~8k in / ~800 out at Sept rates |
| 30-scenario eval run | ~$1.10 | Run B gate is $25 |

Brief criterion 8 (full re-ingest under $20) passes with three orders of
magnitude to spare. The binding budget line remains Claude API spend on
development and evals, exactly as `Ductective-Plan-v3.md:91` says.

**Sonnet 5 rises ~50% on 1 Sep 2026** ($2/$10 → $3/$15 per MTok). All figures
above use the September rate.

---

## 5. Deferred, with triggers

| Deferred | Trigger to revisit |
|---|---|
| `voyage-multimodal-3.5` page embeddings | Eval shows diagram-dependent questions failing. Free inside the 150B-pixel allowance; ~117 in-scope pages affected. |
| `rerank-2.5` (non-lite) | `rerank-2.5-lite` leaves a measured gap on the smoke set. |
| Agentic multi-call search tool | Single-shot retrieval can't serve multi-hop diagnosis (fault table → wiring diagram → sequence of operation). Flag flip, per §3.3. |
| OCR / re-download for scanned docs | EPA 608 comes into answer scope. Re-download `04-3817.pdf` from govinfo rather than OCR'ing a 245-DPI print-to-PDF. |
| ParadeDB / `pg_search` | Past ~10M vectors. At ~3,000 chunks we are three orders of magnitude below it. Realistically never. |

---

## 6. Corpus-specific risks

**Near-duplicate Carrier books are the most likely way criterion 7 fails.**
`48-50FC-20-30-01PD` and `48-50FE-20-30-01PD` are 144 pages each, 350,541 vs
355,555 characters — sibling product-data books for the same 20–30 ton platform.
Retrieval will return the right content from the wrong document, which scores as
a miss on "correct document" and, worse, produces a citation that looks valid.
Put a deliberate disambiguating query in the smoke set and treat sibling-manual
confusion as a named failure mode, not noise.

**Three corrections to `.pipeline/00-brief.md`:**

1. `1.pdf` is **not** the Mitsubishi City Multi handbook (brief line 51). Its
   PDF `/Title` is `04-3817.pdf`, its `/Producer` is `Microsoft: Print To PDF`,
   and its page geometry is US Letter. It is a rasterised copy of the **EPA
   Section 608 rule** — manifest row 26 — and it is the only file in the corpus
   with no text layer.
2. Manifest rows with no file on disk are **three**, not two: row 7
   (`RT-SVX096C-EN`), row 22 (Mitsubishi), row 26 (EPA `04-3817`). The Mitsubishi
   handbook was never saved to disk at all.
3. Row 22's `SourceURL` basename is **`1929`**, with no file extension — a
   basename join fails for it by construction. Special-case it.

**Brief criterion 9 is currently unmeetable.** Root `package.json` has `verify`,
`sync-env`, `app`, and `verify:sessions` — no lint, no build, no test script.

---

## 7. Open items

- **`.pipeline/01-research.md` still does not exist.** Both `knowledge.md:37` and
  `phase1-story-map.md:255` instruct Stage 2.5 to read the embedding model out of
  it. This document pins the model but **does not satisfy that dependency** —
  Stage 2.5 remains pointed at a missing file. Either Stage 1 runs properly, or
  `knowledge.md` is repointed here. Not decided.
- **The citation payload needs a schema change nobody owns.** Carrying
  `cited_text` means adding `snippet` (and probably `chunk_id`) to the `citations`
  table at `sql/002_prototype_sessions.sql:57-66`. Whether that belongs to Stage
  2.5 or Stage 3 is unassigned.

---

## Verification status

| Claim | Status |
|---|---|
| pgvector indexes `vector` to 2,000 dims, `halfvec` to 4,000 | ✅ pgvector README, 3 Aug 2026 |
| Live instance supports this | ✅ `npm run verify` — Postgres 17.6, pgvector 0.8.2 |
| voyage-context-4 $0.12/MTok, 200M free | ✅ docs.voyageai.com/docs/pricing, updated 2026-07-28 |
| `rerank-2.5-lite` $0.02/MTok, 200M free | ✅ same source |
| Corpus page counts | ✅ spot-checked two documents, exact |
| Corpus character totals | ⚠️ ±2% — delimiter counting method |
| Stack matches `Ductective-Plan-v3.md:13` and brief lines 34–36 | ✅ nothing here re-litigates the locked stack |
| Empirical HNSW build on `vector(1024)` vs `halfvec(2048)` | ⬜ **not run** — a live-DB write. Do this before any full embed run. |
