# Retrieval architecture — decisions (v2, Gemini)

*Dated 4 August 2026. Supersedes `docs/retrieval-architecture.md`, which is kept
unmodified as the record — the same discipline as `docs/plan-v2-superseded.md`.*

**What changed:** answer generation moved from the Claude API to Gemini Flash
(`00-brief.md` Amendment 1, owner cost decision). **Nothing about retrieval
changed.** Parsing, chunking, embedding, storage, and ranking are untouched, and
the predecessor's §1, §3.1, §3.2, §3.4, §3.5, §5 and §6 stand verbatim. Read them
there; they are not restated here.

This successor exists for one reason: **§3.3 no longer holds, and what replaces it
is materially worse.** That is worth a document rather than a diff.

---

## 1. What was traded away

The predecessor's §3.3 was correct, and it is still correct about Anthropic. It is
preserved as the record, and this section does not argue with it.

Anthropic's `search_result` content blocks returned structured
`search_result_location` citations carrying `source`, `title`, and **`cited_text`**
— the verbatim supporting span — and `cited_text` **counted toward neither input
nor output tokens**. Four pieces of machinery fell out of that for free:

| Machinery | With `search_result` | On Gemini |
|---|---|---|
| Chunk-ID injection into the prompt | not needed | **must build** |
| Citation prompt scaffolding | not needed | **must build** |
| Citation parser | not needed | **must build** |
| Citation validator | not needed | **must build** |
| Verbatim supporting span (`cited_text`) | free, untokenised | **must extract, and pay for** |

The v1 repo built all four. They were deleted as unnecessary. They now come back.

**This is the cost of the decision, not an argument against it.** The owner chose
it with the trade understood. It is written down so that nobody later reads the
citation plumbing as incidental complexity and "simplifies" it away.

### The consequence nobody will expect

**Gemini's grounding feature does not solve this.** Every reader will assume it
does. It grounds on **Google Search**, not on a private pgvector corpus. There is
no supported path to point it at our chunks, and a grounded answer citing a web
page is a *worse* outcome than an uncited one — `CLAUDE.md` requires every claim to
trace to a specific source document and page in **our** knowledge base.

### A reopened gap

§3.3 closed the gap recorded at `app/components/Citation.tsx` — the UI wants to
show the retrieved passage, and the persisted citation carries only `claim`.
`cited_text` was that passage, for free. **That gap is now open again.** Either the
adapter extracts a verbatim span and stores it, or the UI keeps showing document
and page alone. Decide it in M12, with numbers, not by default.

---

## 2. The stack

Only the Generate row changes.

| Layer | Decision | POC | Long-term |
|---|---|---|---|
| Parse | pdfplumber (MIT), per-page text, both page numbers | ✅ | ✅ |
| Chunk | Per-page, structure-aware; **we** own the page map | ✅ | ✅ |
| Embed | `voyage-context-4`, `output_dimension: 1024` | ✅ | ✅ |
| Store | Supabase pgvector, HNSW `vector_cosine_ops` | ✅ | ✅ |
| Lexical | `tsvector` generated column + `pg_trgm` on model numbers | schema only | wired |
| Retrieve | vector top-k → measure → add RRF + rerank if it misses | ✅ | + `rerank-2.5` |
| **Generate** | **Gemini Flash, structured JSON citations, hand-built validator** | **⬜ M11** | + tool-call loop |
| Diagrams | text-only, gap logged per document | ✅ | + `voyage-multimodal-3.5` |

**Embeddings stay on Voyage.** The model sees chunk *text* only; vectors never
leave Postgres. Retrieval is unaffected by the provider change, which is why
S8–S18 and A1–A4 are not blocked by any of this.

---

## 3. Cost model, re-derived

Vendor pages checked 3 Aug 2026; Gemini lines to be confirmed against current
pricing when the key lands (M3).

| Line | Cost | Note |
|---|---|---|
| Parsing | **$0** | pdfplumber; 24/25 docs have text layers |
| Embedding, full corpus | **$0** | Voyage 200M free tier ≈ 139 re-ingests |
| Reranking | **$0** | `rerank-2.5-lite`, 200M free ≈ 10k queries |
| Supabase | $0–25/mo | Free tier pauses after 1 week idle |
| Per answer (8 chunks, Gemini Flash) | **materially below the predecessor's ~$0.04** | the driver for the switch; hold the number open until M12 measures it |
| 30-scenario eval run | re-derive at M12 | predecessor: ~$1.10; Run B gate is $25 |

The predecessor's *"Sonnet 5 rises ~50% on 1 Sep 2026"* line is **deleted** — no
longer a factor.

Brief criterion 8 (full re-ingest under $20) still passes with orders of magnitude
to spare, and is now **entirely a Voyage question** — a full re-ingest costs
nothing on the model side because embedding never touches it.

**Two cost caveats the predecessor did not have to carry:**

- **No hard spend stop.** Anthropic had an account spend limit; Google's Cloud
  Billing budgets *alert only*. `SETUP-BLOCKERS.md` H2 carries this.
- **The rebuilt citation plumbing costs tokens.** `cited_text` was free; a verbatim
  span extracted through a structured-output schema is paid input and output. The
  per-answer figure must be measured after M11, not assumed from list price.

---

## 4. Verification status

| Claim | Status |
|---|---|
| pgvector indexes `vector` to 2,000 dims, `halfvec` to 4,000 | ✅ pgvector README, 3 Aug 2026 |
| Live instance supports this | ✅ `npm run verify` — Postgres 17.6, pgvector 0.8.2 |
| Voyage embeddings live at 1024 dims | ✅ `npm run verify` — `voyage-4-large`, 1024/1024, H3 cleared |
| Voyage free tier 200M tokens | ✅ docs.voyageai.com/docs/pricing |
| Corpus page counts | ✅ spot-checked two documents, exact |
| Corpus character totals | ⚠️ ±2% — delimiter counting method |
| Stack matches the amended brief | ✅ `00-brief.md` Amendment 1, 4 Aug 2026 |
| Empirical HNSW build on `vector(1024)` vs `halfvec(2048)` | ⬜ **not run** — a live-DB write. Do before any full embed run. |
| **Gemini citation accuracy vs `search_result`** | ⬜ **not measured — this is M12, the gate** |
| **Structured JSON + streaming compose** | ⬜ **not proven.** A partially-streamed JSON object is not an answer, and `tests/suites/human-only.mjs` forbids "a half-rendered answer presented as complete". OPEN QUESTION for Run C. |
| **Safety-filter block rate on HVAC vocabulary** | ⬜ **not measured.** Gas, ignition, high voltage and pressurised vessels are exactly what trips a generic filter. `00-brief-run-b.md` makes a provider block an error, never a refusal. |

The last four are why **M12 is a gate and not a story**. Do not build past it.
