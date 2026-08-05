# Ductective — Resolved Plan (v3)

*Prepared for Andreas · 28 July 2026 · Supersedes `hvac-ai-app-plan-v2-resolved_1.md`*

v3 changes exactly three things from v2. Everything else in v2 stands.

| # | v2 said | v3 says | Why |
|---|---|---|---|
| 1 | Working name **"Superheat"** | **Ductective** — final | Brand board, logo pack, and palette already exist and are built on it. Decision was made outside the plan; the plan hadn't caught up. |
| 2 | Narrow start = **residential** gas furnaces + split systems | Narrow start = **light-commercial packaged rooftop units (RTUs)** | The assembled corpus is 100% commercial. 17 of 25 PDFs are Trane Precedent/Foundation/IntelliPak and Carrier 48/50 rooftops — a dominant slice of the US light-commercial install base. A residential start would need 30+ new docs across 5 OEMs before ingestion could begin. Commercial techs also carry company tool budgets, which makes $29–39/mo an easier sell. |
| 3 | 5-stage agent pipeline | **7 stages** — adds `knowledge` (2.5) and `eval` (5.5) | Nothing in the 5-stage pipeline owned the knowledge base, and nothing evaluated whether an answer was *correct* — which v2 itself names as the #1 risk. |

Unchanged from v2: Expo + React Native, Supabase + pgvector, ~~Claude API (reasoning + vision)~~ **Gemini Flash — amended 4 Aug 2026, see §8**, Voyage embeddings, $29/mo individual · $39/seat · $199/shop, 7-day trial, RevenueCat + Stripe, ~$1k budget, <10h/week, self-testable prototype as the Phase 1 exit.

---

## 1. Brand — locked

Treat these as source of truth over anything inferred. Assets live in `brand/` — `svg/` vector masters, `png/` raster exports, `favicon/` (16–512px), `brand-board.html`, and `README.txt`, which is the authoritative spec. Token names below are the pack's own; use them verbatim in code.

| Token | Value | Use |
|---|---|---|
| `Ink` | `#0C1826` | Background (dark-first) |
| `Steel900` | `#16283D` | Surface |
| `DuctBlue` | `#1354BE` | Pressed / emphasis |
| `SignalBlue` | `#2F93F2` | Interactive / links |
| `CyanRead` | `#5CD0F5` | Accent, active state, brand mark |
| `Steel400` | `#7D93AB` | Secondary text |
| `Steel200` | `#C6D3E0` | Text on dark |
| `Mist` | `#EFF4F9` | Light surfaces |
| Alert red | `#C0453C` | Errors, safety refusals (from the brand board) |

**Typeface: Outfit** (SIL Open Font License). The wordmark ships converted to outlines, so no font install is needed for the logo itself — but the app UI needs Outfit loaded. Primary mark is the "Duct D": the letter D extruded into a duct, in perspective.

Lockup selection is specified in `brand/README.txt` — `lockup-horizontal-notag-*` under ~160px wide, `lockup-stacked-*` for square/narrow, `lockup-horizontal-mono` for one-colour. Follow it rather than picking by eye.

Design bias: dark-first, high contrast, large touch targets — this is read on a rooftop in sunlight with gloves on.

---

## 2. Corpus — what you actually have

25 PDFs, ~215 MB, all freely-published OEM or US public domain. `HVAC Data/_manifest.csv` carries manufacturer, doc type, coverage, source URL, and legal status per file.

| Group | Docs | Coverage |
|---|---|---|
| Trane rooftop / applied | 9 | Precedent, Precedent eFlex, Precedent heat pump 12.5–25T, IntelliPak 1 (Symbio 800), Airfinity, air-cooled chiller 25–120T, packaged rooftop catalog |
| Carrier packaged rooftop | 9 | 48/50 LC (4–6T), K, PG (3–14T)/PM (16–28T), A WeatherMaker, HJ, HC (7–12T), E, FC & FE (20–30T) |
| Daikin Applied | 2 | Rebel applied rooftop (MicroTech), applied air handling |
| Mitsubishi | 1 | City Multi VRF service handbook + error codes |
| Refrigerant PT charts | 3 | R-454B ×2, R-22/R-410A/R-32/R-454B |
| EPA | 1 | Section 608 refrigerant management update (2015) |

**Known data defects — fix before ingestion:**

1. **Two manifest rows have no file.** Trane `RT-SVX096C-EN_02282025.pdf` (Foundation rooftop IOM) and EPA `04-3817.pdf` (the 2004 Section 608 rule). 27 rows, 25 files. Re-download or drop the rows.
2. **Filenames on disk ≠ `FileName` column.** Files kept their source names (`1.pdf`, `48-50LC-4-6-C01T.pdf`); the manifest column holds *intended* renames. Join on `SourceURL` basename, not filename. ~~`1.pdf` is the Mitsubishi City Multi handbook~~ — **corrected 4 Aug 2026: `1.pdf` is the EPA Section 608 rule (`04-3817.pdf`).** Renaming it to the Mitsubishi handbook would have been the mis-citation this note was warning about. See A1 in `.pipeline/02-user-stories.md`.
3. **Mixed text-native and scanned pages.** Several 20 MB+ files are image-heavy. Parse quality will vary; budget for an OCR fallback path and measure extraction quality per document rather than assuming it worked.

**Scope for the prototype KB:** the 18 Trane + Carrier rooftop docs, plus all 3 PT charts. Daikin/Mitsubishi/chiller/EPA get ingested but tagged out of the Phase 1 answer scope — they're for Phase 2 widening, and including them early dilutes retrieval precision on the equipment you're actually testing.

---

## 3. Revised Phase 1

Goal unchanged in spirit, narrowed in equipment: **you can open Ductective, describe a symptom or photograph a rooftop unit's nameplate, and get correct, cited, step-by-step diagnostic guidance** for common light-commercial RTU faults on Trane Precedent and Carrier 48/50 units.

| Step | Work | Done when |
|---|---|---|
| **P1.0** | Repo + git init, scaffold Expo app, promote the agent pipeline to the repo root (see §5) | `git log` has a first commit; pipeline agents can run |
| **P1.1** | Rails: Supabase project w/ pgvector, model + Voyage keys, hello-world round trip | You can chat with the model from the app on your phone |
| **P1.2** | KB ingestion: normalize → parse → chunk → tag (brand/model/doc-type/`license_status`/page) → embed → store | A retrieval query returns the right manual sections with page-accurate sources |
| **P1.3** | Diagnostic core: symptom (+ nameplate photo → model via vision) → retrieve → clarify if needed → ranked steps **with citations** and readings to take | It correctly walks your top ~15 RTU faults |
| **P1.4** | Chat + camera screen: text input, nameplate capture, streaming response with tappable citations, history | Full loop works on phone and tablet |
| **P1.5** | Accuracy validation with a real commercial tech (**parallel, starts now**) | A tech says "yeah, that's what I'd actually do" on most test cases |

**Guardrails, non-negotiable in P1.3:** advise-only; cite every claim; hard refusal on gas/combustion, live electrical, and refrigerant handling procedures — it points to standard safety procedure rather than guessing. Refusals render in alert red.

**Top-15 fault list** (the eval set — write this before P1.3, not after): no cooling / compressor won't start, low suction pressure, high head pressure, economizer not modulating, supply fan won't start, dirty/frozen evaporator coil, condenser fan failure, low airflow / high static, thermostat–unit communication fault, control-board diagnostic LED codes, gas heat won't ignite (advise-only), rollout/limit switch trip (advise-only), short-cycling, refrigerant charge verification via PT chart + superheat/subcool, and unit-specific error codes off the Trane/Carrier boards.

**Phase 1 exit:** a working, self-testable Ductective build on iOS + Android + tablet giving correct, cited RTU guidance, scored by the eval agent and validated by an actual commercial tech.

Phases 2–4 (private beta, individual monetization, company plans) are unchanged from v2 §4 and stay deferred.

---

## 4. Timeline & budget

Timeline is roughly **8–10 weekends**, same as v2 — the RTU pivot doesn't shorten it much, because the time sink is accuracy and ingestion quality, not doc gathering. It does remove the 2–3 weekends of residential doc sourcing v2 implicitly assumed, which buys you slack for the OCR problem in §2.

Budget is unchanged and comfortably within $1k: model API spend is essentially the whole of it — and the 4 Aug 2026 move to Gemini Flash (§8) was taken to reduce exactly this line. Two additions worth noting — embedding ~215 MB of PDFs is still under $20 on Voyage, and prompt-caching the retrieved context matters more with dense IOM text than v2 assumed.

---

## 5. Repo structure (proposed)

`Ductective 2.0` is not currently a git repo, and the pipeline's Stage 3/4 agents use git worktrees and open PRs — they will fail on their first git call. Proposed layout, promoting the pipeline to the root:

Done — `Ductective 2.0` is now a git repo, pushed to **`andreasvermeulenTDM/ductective`** (private). The v1 repo was renamed to `ductective-v1` and is retained as reference; GitHub redirects its old URL.

```
Ductective 2.0/
├─ CLAUDE.md                    ← pipeline conventions + domain rules
├─ .claude/agents/              ← 7 agents
├─ .pipeline/00-brief.md        ← Run A brief
├─ brand/                       ← svg · png · favicon · brand-board.html · README.txt
├─ data/manifest.csv            ← tracked corpus manifest
├─ docs/plan-v2-superseded.md   ← v2, kept for history
├─ HVAC Data/                   ← source PDFs (gitignored — 209 MB)
├─ SETUP-BLOCKERS.md            ← the human-only critical path
└─ Ductective-Plan-v3.md        ← plan of record
```

`app/` and `ingest/` get created by P1.0/P1.1 — they don't exist yet.

`HVAC Data/` is gitignored; 209 MB of PDFs in git history is unrecoverable pain. `data/manifest.csv` is the tracked artifact — it points at source URLs, so the corpus is reproducible from a clean clone.

---

## 6. Pipeline sequencing

Three pipeline runs, each with its own `00-brief.md`, run start to finish before the next begins. P1.5 runs in parallel and is human-owned.

| Run | Covers | Stages that do real work |
|---|---|---|
| **A** | P1.1 rails + P1.2 knowledge base | research → stories → **knowledge** → backend (thin) → test. Frontend: "nothing to do." |
| **B** | P1.3 diagnostic core | research → stories → backend → test → **eval** (first scored run against the top-15) |
| **C** | P1.4 chat + camera UI | research → stories → backend (streaming/session) → frontend → test → **eval** (regression) |

All three briefs are written:

| Run | Brief | Eval's role |
|---|---|---|
| A | `.pipeline/00-brief.md` *(active)* | Nothing to score — stands up the scenario set |
| B | `.pipeline/00-brief-run-b.md` | **First scored run** — sets the baseline |
| C | `.pipeline/00-brief-run-c.md` | Regression, plus a UI-driven guardrail-leak probe |

Every agent reads `.pipeline/00-brief.md`, so at each kickoff the incoming run's
brief is moved to that path and the outgoing one archived to
`.pipeline/runs/<run>-00-brief.md`.

**Two collection tasks gate later runs and neither can be done by an agent — start
both now.** Ten real nameplate photos (Trane Precedent and Carrier 48/50, mixed
lighting and angles) gate Run B criterion 7 and Run C criterion 3. Recruiting a
commercial RTU tech gates P1.5, whose verdict overrides eval's score.

---

## 7. Do these three things next

1. **Start recruiting a commercial RTU tech today.** Unchanged from v2 §7 and still the long pole — but now target commercial service techs specifically (r/HVAC, HVAC-Talk commercial subforum, local mechanical contractors) rather than residential.
2. **Approve the repo restructure in §5**, then P1.0 runs.
3. **Kick off pipeline Run A.**

*Open decisions remaining: none blocking. The two manifest gaps in §2 are chores, not decisions.*

---

## 8. Amendment — answer generation moves to Gemini Flash

*4 August 2026. Owner decision, cost-driven. Recorded here as an amendment; the
rows above are struck rather than rewritten, so the plan stays an audit trail.*

**Changed:** answer generation, Claude API → **Gemini Flash** via Google AI Studio.
**Unchanged:** Voyage embeddings, Supabase + pgvector, and all of retrieval — the
model sees chunk *text* only, and vectors never leave Postgres.

It was cheap to do because it was done early: `complete()` was still a stub, there
was no Anthropic SDK in the repo, and the key had never been set. **No Anthropic
code existed to undo.**

Two things this costs, recorded so they are not rediscovered as surprises:

1. **Citation plumbing comes back.** Anthropic's `search_result` blocks returned
   structured citations with a free, untokenised `cited_text` span. Gemini has no
   equivalent, so chunk-ID injection, prompt scaffolding, a parser and a validator
   must be built — the four things `docs/retrieval-architecture.md` §3.3 deleted as
   unnecessary. **Gemini's grounding feature does not substitute: it grounds on
   Google Search, not on a private pgvector corpus.**
2. **The spend ceiling is softer.** Anthropic offered a hard account spend limit;
   Google's budgets alert but do not cut off. See `SETUP-BLOCKERS.md` H2.

Full analysis: `docs/retrieval-architecture-v2-gemini.md`. Migration stories:
Addendum B of `.pipeline/02-user-stories.md` (M1–M17).
