# 025 — Knowledge · Run A (P1.2)

Stage 2.5 artifact. Branch `stage/knowledge`, merged to `main` incrementally as
work verified rather than in one drop; this file is the write-up the stage's
charter requires, produced after the measurements it reports.

Everything below is measured against the live Supabase instance and tracked
fixtures, not estimated. Where a number came from a single run, the run is named.

---

## 1. Corpus reconciliation (brief criterion 6)

`node ingest/reconcile.mjs` — join on **SourceURL basename**, never filename.

| | |
|---|---|
| Files on disk | 25 |
| Manifest rows | 25 |
| Rows matched | **25** |
| Orphan rows (row, no file) | **0** |
| Unattributed files (file, no row) | **0** |

The brief said 27 rows with 2 missing files, and Stage 1 found a third dead URL
(A3). The manifest has since been reconciled to the 25 files actually on disk:
the two never-downloaded rows (Trane `RT-SVX096C-EN` Foundation IOM, EPA
`04-3817.pdf` FR rule) and the dead-URL row were dropped rather than re-downloaded
— recorded in `00-brief.md` Amendment 2. **Trane Foundation is therefore absent
from the KB**, and the smoke set deliberately carries no Foundation query.

Identity corrections applied at reconciliation, not by renaming files:

- `1.pdf` **is the US EPA Section 608 rule** (A1) — not the Mitsubishi handbook
  the brief claimed. Confirmed independently twice: zero `/Font` objects (Stage 1)
  and 0/43 pages of extractable text (parser).
- `OM1164-4.pdf`, `OM1355.pdf` matched by FileName-stem fallback — their
  SourceURLs end in numeric ids, not filenames.

Document identity (S10) is `doc_` + sha256(SourceURL)₁₆. Renaming a file on disk
changes no chunk's citation.

## 2. Parse quality per document (S11), and the defect that mattered (D1)

Parser: pdfplumber, per-page, column-aware — `ingest/parse.py`, `PARSER_VERSION=2`.

Corpus totals: **2,223 pages · 1,914 usable · 432 two-column · 0 errors**.
Full parallel parse ≈ 11 min (6 workers); cached thereafter and version-keyed.

Per document (usable/total, two-column pages, mean alpha ratio, scope):

```
 157/160   4 2-col  α=0.47  in   PKGP-PRC013AA-EN catalog        (caveat: tables)
  65/68   41 2-col  α=0.72  in   RT-SVX23R-EN Precedent IOM
  79/82   46 2-col  α=0.71  in   RT-SVX21AD-EN Rooftop IOM
  86/92   36 2-col  α=0.64  in   RT-SVX34W-EN Rooftop IOM
  56/60   25 2-col  α=0.71  in   RT-SVX46G-EN eFlex IOM
 152/164  61 2-col  α=0.65  in   RT-SVX072E-EN IntelliPak/Symbio IOM
  37/64   36 2-col  α=0.67  in   TEMP-SVX001A-EN chiller IOM
  44/48   35 2-col  α=0.72  in   PKGP-SVX010A-EN heat-pump IOM
  43/48    8 2-col  α=0.67  in   RT-SVX056D-GB Airfinity IOM
  80/88   33 2-col  α=0.72  in   48-50LC service
 116/140  20 2-col  α=0.56  in   48-50K product data
 171/188  23 2-col  α=0.54  in   48-50PGPM service               (caveat: tables)
 107/120  20 2-col  α=0.45  in   48-50A product data             (caveat: tables)
  56/64    4 2-col  α=0.57  in   48HJ install/service
  39/52    0 2-col  α=0.73  in   50HC install
  72/84    5 2-col  α=0.61  in   50E install/service
  98/144   6 2-col  α=0.44  in   48-50FE product data            (caveat: tables)
  99/144  20 2-col  α=0.42  in   48-50FC product data            (caveat: tables)
  14/20    4 2-col  α=0.64  out  OM1164-4 Rebel operations
  16/20    5 2-col  α=0.51  out  OM1355 air handling             (caveat: tables)
   2/2     0 2-col  α=0.44  in   Honeywell R-454B PT chart       (tabular by design)
   2/2     0 2-col  α=0.35  in   Hudson R-454B PT chart          (tabular by design)
   2/2     0 2-col  α=0.23  in   Goodman/Daikin A2L PT chart     (tabular by design)
   0/43    0 2-col  α=0.00  out  EPA-Section608 FR rule          (EXCLUDED)
 321/324   0 2-col  α=0.79  out  EPA refrigerant mgmt 2015
```

Two parser defects were found by measurement and fixed, both worth remembering:

1. **Gutter detection scanned the page box, not the text extent** — it found the
   right margin and reported a 68-page IOM as 4 two-column pages; corrected: 41.
   Every missed page would have been spliced by the code written to prevent
   splicing.
2. **D1 (`.pipeline/D1-parse-word-boundaries.md`): absolute 3pt x_tolerance fused
   words** ("Condensercoildirtyorrestricted"). Only 25% of chunks containing
   "trane" carried it as a delimited word. Alpha ratio scored fused text *better*,
   so S11's metric pointed the wrong way — a dedicated `glued_ratio` metric now
   fails the disposition above 0.5%, and the parse cache is version-keyed so a
   parser fix can never be invisible to a warm cache.

## 3. Dispositions (S13)

Every document carries its disposition in the `documents` table.

- **ingest: 18** (includes the 3 PT charts — tabular by design, exempt from the
  alpha caveat: a lookup table is not low-quality prose, it is the right answer
  to a saturation question)
- **ingest-with-caveat: 6** — mixed prose/dimensional tables (α < 0.55); expect
  weak prose retrieval on table-heavy pages
- **excluded: 1** — EPA Section 608 FR rule, image-only, 0/43 usable pages,
  out of Phase 1 scope regardless

## 4. Chunking and tagging (S12, S14)

Per-page chunking, ourselves — never provider auto-chunking, which destroys the
page map (`docs/retrieval-architecture.md` §3.2). Within a page: paragraph
boundaries first, then lines; target 1,600 chars (≈400 tokens), max 2,400, min
120 with trailing-scrap folding. `content_hash = sha256(document_id·page·text)`.

Every chunk carries denormalised provenance — `source_document` (the label,
added by sql/005 after Stage 5 caught it living behind a join),
**`page_number` (NOT NULL)**, manufacturer, doc type, `model_coverage`,
`license_status`, `in_scope`, `embedding_model` — because a citation rendered from the chunk alone cannot be
broken by a failed join (brief criterion 4).

Scope (S14) derives from the manifest, never from filenames:
`manufacturer ∈ {Trane, Carrier} ∨ docType = 'PT Chart'`, minus
`OUT_OF_SCOPE_EQUIPMENT` (chillers — brief line 64 orders them out; its own
"18 rooftop docs" count was a miscount that included one) → **20 in-scope
documents** (17 rooftop + 3 PT charts).

Scope is provenance outside the content hash, so ingest re-syncs it (and the
sibling denormalised columns) onto existing chunks whenever the stored flag
disagrees — a scope-rule change must not require a re-embed to take effect.

**Live counts: 3,787 chunks · 3,328 in-scope · 24 documents · all vectors
`voyage-4-large`** (persisted per chunk — A4: `usedMocks()` is per-process and
cannot prove a past run was stub-free; the column can, from a cold start).

## 5. The retrieval contract (S17) — what Stage 3 builds against

Embedding: `voyage-4-large`, 1024 dims, `input_type: 'document'` at ingest,
`'query'` at search — the asymmetry is functional, not cosmetic.

**Query interface.** `public.match_chunks(query_embedding vector(1024),
match_count int, scope_only bool)`. The **top-k default is 8** (`match_count`);
callers may lower it, and nothing above 8 has been measured.

**Returned chunk shape.** OUT columns are `out_*`-prefixed (Postgres RETURNS
TABLE name-collision constraint); `ingest/smoke.mjs` shows the canonical mapping
back to `{chunk_id, document_id, document, page, text, manufacturer, doc_type,
coverage, license_status, in_scope, similarity}`. As of sql/005 every field a
citation needs — including `source_document`, the human-readable label — lives
on the chunk row itself; the read path has no join to fail.

**Result ordering.** Rows come back ranked by cosine similarity, descending —
`similarity = 1 − (embedding <=> query)`, best first. Ties are not specified and
must not be relied on.

**Scope filtering.** `scope_only = true` (the default) restricts to
`in_scope = true` — the 21 Phase 1 documents. Out-of-scope chunks exist in the
table by design (the brief's precision-measurement requirement) and are only
reachable by passing `scope_only = false` explicitly.

**Citation rendering.** A citation renders from one returned row:
`source_document` + `page`, with `text` as the passage shown on tap-through.

`match_chunks_hybrid` (sql/004, RRF over vector + tsvector) exists as an opt-in
(`RETRIEVAL_MODE=hybrid`) and **measured worse — do not enable it**: 8/14 vs
vector's 10/14. First loss was the fused-token corpus; the second is the OR-
semantics tsquery flooding on common terms. If revisited, scope the lexical arm
(manufacturer filter or pg_trgm on model numbers) rather than re-weighting RRF.

## 6. Retrieval smoke set (brief criterion 7) — MET

Fixture `tests/fixtures/retrieval-smoke-set.json` (14 queries, schema per
`tests/fixtures/SCHEMAS.md`); results `tests/fixtures/retrieval-smoke-results.json`,
re-judged independently by Stage 5 from raw returned hits.

**Production default (vector-only), v2 corpus: 10/14 correct document, page
correct on all 10 — meets the ≥10-of-12 bar.**

The four misses (R01 rank-6, R04 rank-2, R05 rank-3, R11 rank-2) are
cross-manufacturer confusions where the right document sits lower in the top-8;
none is a coverage gap. They are the natural targets if the bar ever rises.

## 7. Cost and runtime (brief criteria 5, 8)

| Operation | Wall clock | Tokens | Cost |
|---|---|---|---|
| Full ingest (cold, paid-tier limits) | **91.9 s** | 1,674,677 | $0.30 list / **$0 billed** (200M free) |
| Re-ingest, nothing changed (**criterion 5**) | **3.6 s** | **0** | $0 — `0 inserted / 3,787 unchanged / 0 deleted` |
| Full parse (cold cache) | ≈ 11 min | — | $0 (pdfplumber) |

Idempotency is by content hash: unchanged chunks are neither re-embedded nor
re-billed; a changed parser re-embeds only what changed. A hard spend stop
(`VOYAGE_MAX_TOKENS`, default 5M ≈ 3× corpus) aborts rather than bills — checked
per batch, because a cap you discover having exceeded is a report.

Free-tier note: without a payment method Voyage allows 3 RPM / 10K TPM (a full
ingest ≈ hours); with one on file, the run above. Either way $0 within allowance.

## 8. Lint / build / test status

- `npm test` — **65 pass / 0 fail** (secrets scanner, citations, answer format,
  diagnose core)
- `app` TypeScript — `tsc --noEmit` clean
- Stage 5 harness — **33 PASS · 0 FAIL** · 17 BLOCKED (14 of them on this
  artifact's absence) · 11 HUMAN-ONLY
- No lint runner is configured at the repo root beyond these; no new warnings
  introduced (baseline: none)

## OPEN QUESTIONs, with the defaults taken

1. **Wiring-diagram pages (≈309 low-text pages) carry no retrievable content.**
   Default: accepted for Phase 1, logged per document; `voyage-multimodal-3.5`
   is the §5 trigger if a smoke query ever needs a diagram.
2. **Chunk size (1,600 chars).** Default kept; the smoke set passed on it. Any
   change must be justified against the smoke set (brief's own rule) and forces
   a full re-embed — the version-keyed cache and content hashes make that safe.
3. **The four smoke misses are cross-manufacturer rank misses, not coverage
   gaps.** Default: ship vector-only; revisit only if Run B's citation-validity
   sampling (≥30 claims, ≥90%) surfaces retrieval as the limiting factor.
