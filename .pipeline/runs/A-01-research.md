# 01 — Research · Run A: rails + knowledge base

Stage 1 artifact for `.pipeline/00-brief.md` (Run A, P1.1 + P1.2).
Branch `stage/research`, cut from `main` at `c748af0`. Written 4 Aug 2026.

## Read this first — the pipeline ran out of order

Stage 2 shipped `.pipeline/02-user-stories.md` **before** this document existed, and
says so in its own header (`02-user-stories.md:9-18`, `OPEN QUESTION 0`). Stages 2.5,
3, 4 and 5 have all partly run against it. This artifact therefore does two jobs:

1. The standard Stage 1 job — §§1–6 below.
2. **§7 Reconciliation** — a per-story audit of where the code contradicts
   `02-user-stories.md`. It does **not** rewrite the stories; Stage 2 reconciles.

`.claude/agents/knowledge.md:37` instructs Stage 2.5 to take "the model and vector
store named in the research artifact" from this file. Both are named in §3.3, which
closes the dependency `docs/retrieval-architecture.md:244-248` flagged as open.

**The single most important finding is `RECON-S10` in §7: `1.pdf` is not the
Mitsubishi handbook.** Acting on story S10 as written would produce a guaranteed
mis-citation — the exact defect `CLAUDE.md` exists to prevent. Read that before
starting Stage 2.5.

---

## 0. Verified state, measured this session

Everything in this table was executed, not read off another document.

| Claim | Verdict | Evidence |
|---|---|---|
| Repo at `70d719c` on `main` | ❌ **Stale.** `main` is at **`c748af0`**, 4 commits ahead | `git log main` |
| S1/S2 unmerged on `stage/backend` | ❌ **Stale.** `7cf467d` merged into `main` mid-session | `git merge-base --is-ancestor 7cf467d main` → yes |
| No lint/test/build command | ❌ **Stale.** All three exist on `main` and exit 0 | §5.1 |
| `app/lib/*.test.mts` | ❌ **Stale.** Renamed to `.test.mjs` in `c748af0` | `ls app/lib` |
| H1 Supabase live, pgvector 0.8.2 | ✅ Confirmed | `SETUP-BLOCKERS.md:34-49`, `npm run verify` |
| H3 Voyage cleared, `voyage-4-large`, `EMBED_DIM` 1024 | ✅ Confirmed | `lib/clients.mjs:76,83` |
| `ANTHROPIC_API_KEY` present but empty | ✅ Confirmed | `.env` — 0-length value |
| `lib/clients.mjs:172` throws `TODO(Stage 3)` | ❌ **False.** It throws at **`:175`** | §2.3 |
| No `ingest/` directory | ✅ Confirmed | `ls` |
| 27 manifest rows, 25 PDFs | ✅ Confirmed | §3.1 |
| The two gaps are Trane `RT-SVX096C` + EPA `04-3817` | ❌ **False.** Three rows are unresolved and EPA is *not* one of them | §3.2 |

**Concurrency warning.** `main` advanced twice while this ran (`e94fda3`, `c748af0`).
Another agent is committing to `main` directly, against `CLAUDE.md:43`. Any stage
starting now should `git log main` before trusting a SHA in any artifact, this one
included.

---

## 1. Stack & architecture

### 1.1 Languages, runtimes, versions

| Layer | Technology | Version | Pinned where |
|---|---|---|---|
| Root tooling | Node.js ESM (`.mjs`) | **v24.14.0** local; `>=22` required | `package.json:8` |
| Package manager | npm | 11.9.0 | lockfile v3 |
| App | Expo / React Native | **SDK 54**, RN 0.81.5, React 19.1.0 | `app/package.json:9-13` |
| Language (app) | TypeScript | `~5.9.2` (root and app pinned together) | `package.json`, `app/package.json` |
| Lint | ESLint flat config | 10.8.0 + `typescript-eslint` 8.66 | `eslint.config.mjs` |
| Test | `node:test` | built-in, native type stripping | `package.json` `"test": "node --test"` |
| DB | Supabase Postgres | **17.6**, pgvector **0.8.2** | verified live |
| Embeddings | Voyage `voyage-4-large` | 1024 dims | `lib/clients.mjs:76,83` |
| Reasoning | Anthropic Claude | **not wired** | `lib/clients.mjs:170` |
| Supabase CLI | `npx supabase@latest` | 2.111.0 | not installed globally, by decision (H4) |

Expo SDK 54 is a **deliberate downgrade** (`411d4bc`, `4352399`) pinned to the test
iPhone's Expo Go version. Do not bump it to chase a newer library.

### 1.2 Module boundaries

There is no framework here. It is a two-workspace repo with a hand-rolled seam:

```
/                      root workspace — Node ESM, server-side and tooling
├─ lib/clients.mjs     THE SEAM. Supabase + Voyage + Anthropic, real vs stub
├─ lib/secrets.mjs     one definition of "what a secret looks like"
├─ scripts/*.mjs       operator commands (verify-*, sync-app-env)
├─ sql/00N_*.sql       migrations, applied BY HAND in the Supabase SQL Editor
├─ tests/              Stage 5 acceptance harness (NOT the unit suite)
├─ data/manifest.csv   the tracked corpus artifact
└─ app/                second workspace — Expo, its own package.json + lockfile
   ├─ theme/tokens.ts  the durable piece; brand tokens
   ├─ lib/             store, supabase client, citations, answerFormat, net
   └─ screens/         Chat / History / Capture — design prototype, mock answers
```

Two rules hold this together and both are load-bearing:

- **`lib/clients.mjs` is the only place that decides real-vs-stub.** Its header
  (`lib/clients.mjs:1-10`) states the intent: Stage 3 replaces two function bodies,
  it does not rewire callers.
- **`app/` never imports from `lib/`.** The app talks to Supabase with the anon key
  (`app/lib/supabase.ts`) and to nothing else. This is what makes brief AC 3's
  "no API key in the client" structurally true rather than a promise.

### 1.3 How it runs

- **Tooling:** `node --env-file=.env scripts/<x>.mjs`. `.env` is loaded by Node's
  own flag, not `dotenv` — zero dependencies.
- **App:** `npm run app` → `sync-env` (generates gitignored `app/.env` from root
  `.env`, filtering to `EXPO_PUBLIC_*`) → `expo start --web`. On device: `npx expo
  start` and scan with Expo Go.
- **Migrations:** pasted into the Supabase SQL Editor by hand. There is no
  `supabase/` project directory and no `supabase link`. This is a real gap — see
  §5.4 and `OPEN QUESTION 4`.
- **Serverless:** nothing deployed. No `supabase/functions/` exists.

---

## 2. Relevant surface area

### 2.1 What Run A actually touches

| Area | Path | State | Owner |
|---|---|---|---|
| Ingestion pipeline | `ingest/` | **does not exist** | Knowledge (2.5) |
| Chunks schema | `sql/003_*.sql` | **does not exist** | Knowledge designs, Backend applies |
| Retrieval + smoke set | — | **does not exist** | Knowledge |
| Claude client | `lib/clients.mjs:170-189` | stub, fails closed | Backend (S4) |
| Edge Function | `supabase/functions/` | **does not exist** | Backend (S4) |
| Hello-world screen | `app/` | prototype exists, mock answers | Frontend (S7) |
| Scenario set | `tests/fixtures/top-15-faults.json` | **exists** — see §7 S20 | Eval |
| Toolchain | `package.json`, `eslint.config.mjs` | ✅ **done** | Backend (S1, S2) |

The weight of Run A is a directory that does not exist yet. Everything else is
verify-don't-redo.

### 2.2 The client seam, traced end to end

`lib/clients.mjs` is 189 lines and is the file every downstream stage depends on.

```
STUBS_ALLOWED  :15   process.env.ALLOW_STUBS === 'true'
used / announced :16-17  module-scope Sets
announce()     :19-28  warns once per stub, records in `used`
usedMocks()    :31-33  ← Stages 5 and 5.5 assert this is empty
supabaseAdmin():49-55  service_role. Real. Never import from app/
EMBED_MODEL    :76     'voyage-4-large' (VOYAGE_MODEL overrides)
EMBED_DIM      :83     1024
MAX_BATCH      :86     128 — Voyage's per-request input cap
embedTokensUsed():90-92 tokens billed this process
embed()        :102-160 REAL. Batches, sorts by returned index, width-checks
complete()     :170-189 STUB. Anthropic.
```

Three properties of `embed()` are worth not breaking:

- **`inputType` is asymmetric** (`:96-99`). Ingestion must pass `'document'`, the
  smoke set `'query'`. Mismatching costs recall silently.
- **Results are re-sorted by `d.index`** (`:145`) rather than trusting response
  order. Correct — Voyage does not guarantee it.
- **A wrong-width vector throws** (`:147-152`) instead of storing. Correct: a
  mis-width vector is silent index corruption.

### 2.3 The `complete()` control flow — the brief's description is wrong

`02-user-stories.md:25`, `.pipeline/03-backend.md:223`, and this Stage's own kickoff
note all state that `lib/clients.mjs:172` throws `TODO(Stage 3)`. **It does not.**

```js
170  export async function complete({ messages }) {
171    if (process.env.ANTHROPIC_API_KEY) {
172      throw new Error('TODO(Stage 3): ... key is set but unused.');
173    }
174    if (!STUBS_ALLOWED) {
175      throw new Error('ANTHROPIC_API_KEY is empty. Set it, or pass ALLOW_STUBS=true ...');
```

`ANTHROPIC_API_KEY` is the **empty string**, which is falsy, so line 171 is never
taken. Executed this session:

```
$ node --env-file=.env -e "... complete({messages:[...]}) ..."
typeof ANTHROPIC_API_KEY: ""
THREW: ANTHROPIC_API_KEY is empty. Set it, or pass ALLOW_STUBS=true to run against the stub.
usedMocks(): []

$ ALLOW_STUBS=true node --env-file=.env -e "..."
  ⚠  STUB ACTIVE: anthropic is returning fabricated data.
RESOLVED text: [STUB RESPONSE — not generated by Claude, contains no real d | stub: true
usedMocks(): [ 'anthropic' ]
```

**The fail-closed discipline is intact and behaves correctly.** The only defect is
the line-172 message, which will fire the moment H2 is cleared and will then say
"key is set but unused" — accurate at that instant, but it is the message a
developer sees at exactly the wrong moment. S4 replaces the body anyway.

### 2.4 The stub-discipline gap that matters for Stages 5 and 5.5

`tests/run-all.mjs:76-95` imports `usedMocks()` and FAILs the run if it is non-empty.
That is the right check, and it is wired. **But `used` is module-scope state in a
single Node process** (`lib/clients.mjs:16`). Stage 5 runs in its own process. An
ingest run that used stub embeddings three days ago leaves **no trace** that
`tests/run-all.mjs` can see — it will import a fresh module, get `[]`, and print
"no stub was activated during this run", which is true and irrelevant.

So today the integrity check proves only that *the test process* used no stub. It
cannot discharge "no scored run touched a stub" for ingestion or retrieval.

**Recommendation (Stage 2.5, blocking on S15/S17):** persist the provenance, don't
infer it. `embed()` already returns `{ model, stub }` (`:122`, `:159`). Store
`embedding_model` on every chunk row and record `stub_used` on an ingest-run row.
Then Stage 5 asserts against the database — `select count(*) from chunks where
embedding_model like 'stub%'` — which survives process boundaries and is the thing
the charter actually wants to know.

### 2.5 The app — verify, don't redo

`app/` is a working chat/history/capture prototype on **real** Supabase persistence
with **mock** answer content (`app/lib/mockDiagnostics.ts:1-15`, which labels itself
loudly). `.pipeline/04-frontend-design-pass.md` states it discharges no acceptance
criterion. Two things in it are durable and should be reused, not re-derived:

- **`app/theme/tokens.ts`** — brand tokens taken verbatim from `brand/README.txt`,
  plus `alertRedText` (`:44`), a lightened `#D1746D` derived because `#C0453C` fails
  4.5:1 as text on all three surfaces it lands on. That is a real accessibility fix
  with measurements recorded; do not revert it to the brand-board hex for text.
- **`app/lib/citations.ts`** — `resolve()` is the single definition of "a citation a
  technician could act on" (document present, page a positive integer). Run B's
  citation enforcement should import this rather than restate it.

---

## 3. Data & integrations

### 3.1 The corpus, measured

Full `pdftotext` pass over all 25 PDFs, no sampling, executed this session
(46.5 s wall, poppler 4.00):

| | Docs | Pages | Chars | ≈ Tokens | Low-text pages |
|---|---|---|---|---|---|
| Phase 1 answer scope | **20** | 1,752 | 4.66M | ~1.17M | 169 |
| Out of scope (chiller, Daikin, EPA ×2) | 5 | 471 | 0.78M | ~0.20M | 74 |
| **Total** | **25** | **2,223** | **5.44M** | **~1.36M** | 243 |

Doc and page counts match `docs/retrieval-architecture.md:18-22` exactly (20 of 21,
1,752 / 2,223) — independent confirmation. Char totals differ ~5% and low-text
counts differ materially (169 vs its 117), because "low-text" has no pinned
definition. Mine: **a page whose non-whitespace character count is < 100**.
Stage 2.5 must pin one definition in code and report against it; two numbers for
the same property is how a quality gate stops meaning anything.

**Cost consequence: embedding the full corpus is free.** ~1.36M tokens against
Voyage's 200M free-tier allowance. Brief AC 8's "<$20 full re-ingest" passes by
three orders of magnitude. Parse is $0 (poppler, local). **Cost is not a design
constraint in Run A** — build hours are.

### 3.2 The manifest join — three unresolved rows, not two

`data/manifest.csv`: 27 rows, 7 columns
(`Folder,FileName,Manufacturer,DocType,Model / Coverage,SourceURL,Legal Status`),
no quoted commas. `HVAC Data/_manifest.csv` is byte-identical — a duplicate.
`data/manifest.csv` is the tracked one and is authoritative.

Joining on `SourceURL` basename (URL-decoded), executed this session:

**Manifest rows with no matching file — three:**

| Basename | Row | In Phase 1 scope? |
|---|---|---|
| `RT-SVX096C-EN_02282025.pdf` | Trane Foundation Rooftop IOM + diagnostics | **YES** |
| `1929` | Mitsubishi City Multi service handbook | no |
| `04-3817.pdf` | EPA Section 608 rule (2004) | no |

**Files on disk with no matching row — one:** `1.pdf`.

Two structural problems the brief does not mention:

- **Row 22's `SourceURL` basename is `1929`** — no extension, an ID path segment
  (`.../pdf/download_full/1929`). A basename join cannot ever match it. It needs an
  explicit special case, not a smarter regex.
- The `FileName` column is an *intended rename*, never applied. Joining on it
  resolves **0** files. `tests/suites/e1-ingestion.mjs:56-66` already proves this
  both ways, which is the right shape for the check.

### 3.3 `1.pdf` is the EPA rule, not the Mitsubishi handbook — proven

The brief (`00-brief.md:54`), the plan (`Ductective-Plan-v3.md:57`), and story S10
all assert `1.pdf` is the Mitsubishi City Multi handbook and must be renamed to
match. **This is false**, and `docs/retrieval-architecture.md:226-230` already
called it. Four independent lines of evidence, all measured this session:

| Evidence | Value |
|---|---|
| `/Title` (UTF-16BE) | `04-3817.pdf` |
| `/Producer` | `Microsoft: Print To PDF` |
| `/Font` objects | **0** — no text layer at all, 0 chars extracted |
| `/MediaBox` | `612 x 792` (US Letter — not a Japanese OEM handbook) |
| Page count | **43** |
| Real `04-3817.pdf`, downloaded from govinfo this session | **43 pages**, opens `Federal Register / Vol. 69, No. 49 / Friday, March 12, 2004` |
| `/CreationDate` | `D:20260727121258` — mtime 12:12, two minutes after `2015-26946.pdf` (the *other* EPA row) at 12:10 |

The page count matching exactly at 43, plus the `/Title`, is conclusive. `1.pdf` is
a rasterised print-to-PDF of the EPA Section 608 rule. **The Mitsubishi handbook was
never downloaded.**

### 3.4 Source URL liveness, probed this session

| URL | Result |
|---|---|
| Trane `RT-SVX096C-EN_02282025.pdf` | **HTTP 404** — dead. Not re-downloadable from the manifest URL. |
| EPA `04-3817.pdf` (govinfo) | **HTTP 200**, 469 KB, text-native. Downloaded and verified. |
| Mitsubishi `.../download_full/1929` | **HTTP 200**, serves `PUHY-P200-250YREM-A_Service_Manual_(MEE03K220).pdf` via `Content-Disposition` |

This resolves `OPEN QUESTION 2` on evidence rather than by policy:

- **EPA:** re-download the real one (free, 5 seconds, text-native) and **delete
  `1.pdf`**. Do not OCR a 43-page raster when the text original is one `curl` away.
  This also removes the corpus's only zero-text-layer document.
- **Mitsubishi:** downloadable, but the served document is one specific PUHY service
  manual, not the general handbook the row describes. Out of Phase 1 scope. *Default:
  drop the row* and record it, rather than ingesting a document whose manifest
  metadata does not describe it — a wrong `Model / Coverage` tag is a mis-citation
  waiting for Phase 2.
- **Trane `RT-SVX096C`:** dead URL, and it is **in Phase 1 scope**. See `RECON-S9`.

### 3.5 Parse quality — the real risk is columns, not OCR

Per-document extraction, all 25 documents:

| Document | Pages | Chars/page | Low-text | Scope |
|---|---|---|---|---|
| `1.pdf` (EPA raster) | 43 | **0** | **100%** | out |
| `TEMP-SVX001A` (chiller) | 64 | 1,441 | 42% | out |
| `48-50FE-20-30-01PD` | 144 | 2,469 | 31% | **in** |
| `48-50FC-20-30-01PD` | 144 | 2,434 | 30% | **in** |
| `50HC-7-12-07SI` | 52 | 2,439 | 21% | **in** |
| `48-50K-01APD` | 140 | 2,791 | 16% | **in** |
| `RT-SVX23R` (Precedent IOM) | 68 | 3,034 | **0%** | **in** |
| `RT-SVX21AD` | 82 | 3,254 | 1% | **in** |
| `RT-SVX072E` | 164 | 2,228 | 1% | **in** |
| `RT-SVX46G` (Precedent eFlex) | 60 | 2,771 | 3% | **in** |
| all 3 PT charts | 2 each | 969–2,860 | 0% | **in** |

**The headline: apart from `1.pdf`, every document has a healthy text layer, and
`1.pdf` is being replaced by its text-native original (§3.4). There is nothing left
in the corpus to OCR.** The scan-heavy failure the brief and plan budgeted for does
not exist.

The "low-text" pages in the Carrier books are **not** extraction failures. Sampled
directly:

```
[page 18] 'Base unit dimensions\n18\n\n48FC**20 Base Unit Dimensions'
[page 19] 'Base unit dimensions (cont)\n19\n\n48FC**20 BASE Base Unit Dimensions (cont)'
```

Pages 18–50 of `48-50FC` are a contiguous run of **dimensional drawings**. The
header and caption extract fine; the content is vector artwork with no retrievable
prose. OCR would not help — there is no raster to OCR. This is a **coverage gap**
(diagram-dependent questions cannot be answered from text), not a parse defect, and
conflating the two will send Stage 2.5 chasing an OCR problem it does not have.

**The actual parse risk is two-column layout.** Comparing modes on `RT-SVX23R` p.22:

- default: reading-order, but drops content on mixed drawing/text pages
- `-layout`: preserves geometry but **merges the two text columns onto one physical
  line** — `"Your personal safety and the proper operation of this machine
  personnel. Improperly installed and grounded field"` is two unrelated sentences
  spliced. Embedding that produces confident nonsense.
- `-raw`: content-stream order, unpredictable

Trane and Carrier IOMs are two-column throughout. **A column-aware extractor is
required**, not a `pdftotext` flag. `docs/retrieval-architecture.md:54` already
picks **pdfplumber**, which exposes word bounding boxes and can be split on the
column gutter. That is the right call and this measurement supports it. Stage 2.5
must spot-check a two-column body page for splice artefacts before embedding
anything — it is invisible in a chunk count and fatal to retrieval.

### 3.6 Tooling actually present on this machine

| Tool | State | Consequence |
|---|---|---|
| `pdftotext` (poppler 4.00) | ✅ on PATH | measurement + a cross-check on pdfplumber |
| Python 3.11.9 | ✅ | pdfplumber installs cleanly |
| pdfplumber / PyMuPDF / pypdf | ❌ none installed | `pip install pdfplumber` needed |
| `tesseract` | ❌ | **irrelevant** — nothing to OCR (§3.5) |
| `pdfinfo`, `pdftoppm`, `pdffonts` | ❌ | partial poppler install; don't depend on them |
| Deno (H5) | ❌ deferred | §5.4 |
| Docker (H6) | ❌ deferred | §5.4 — **does not block deploy** |
| `npx supabase@latest` | ✅ 2.111.0 | H4 resolved |

### 3.7 Existing schema and contracts

`sql/001_bootstrap.sql` — pgvector in `extensions`, plus `public.ductective_health()`,
`security definer` with a pinned `search_path`, `revoke`d from `anon` and granted
only to `service_role` (`:32-33`). That revoke is what makes brief AC 3's privilege
split demonstrable rather than asserted.

`sql/002_prototype_sessions.sql` — `sessions` / `messages` / `citations` for the
prototype. Two contracts Run B and C inherit:

- `messages.kind check (kind in ('user','answer','clarify','refusal'))` (`:39`) —
  the refusal state is in the database, so the advise-only rule is enforceable at
  the storage layer, not only in prompt text.
- `citations` (`:57-66`) — `source_document text not null`, `page integer not null
  check (page > 0)`, `claim text`. Separate rows, not a JSON blob, specifically so
  Stage 5.5 can check a source against the claim attached to it.

RLS is on but **prototype-grade** (`:72-80`): `anon` may touch any row where the
owning session has `user_id is null`, and the anon key ships in the bundle. The file
says so plainly. Not Run A's problem; do not put real user data there.

**Open contract, unowned** (`docs/retrieval-architecture.md:250-252`): carrying
Claude's `cited_text` needs `snippet` (and probably `chunk_id`) on `citations`.
Neither Stage 2.5 nor Stage 3 has claimed it. See `OPEN QUESTION 5`.

### 3.8 The schema the chunks table must satisfy

From brief AC 4 plus what this research adds:

| Column | Type | Constraint | Source |
|---|---|---|---|
| `source_document` | text/FK | **NOT NULL** | AC 4, S6 |
| `page_number` | integer | **NOT NULL**, `> 0` | AC 4, S6, `app/lib/citations.ts` |
| `manufacturer` | text | from manifest row | AC 4 |
| `model_coverage` | text | from manifest row | AC 4 |
| `doc_type` | text | from manifest row | AC 4 |
| `license_status` | text | manifest `Legal Status` | AC 4 |
| `in_phase1_scope` | boolean | filterable | S14 |
| `embedding` | `vector(1024)` | matches `EMBED_DIM` | `lib/clients.mjs:83` |
| `embedding_model` | text | **new — §2.4** | closes the cross-process stub hole |
| `text` | text | | S12 |
| `document_id` | stable ID | **not the filename** | S10 |

Plus, per `docs/retrieval-architecture.md:144-146`, add the `tsvector` generated
column and `pg_trgm` index **in the first migration** even though retrieval ships
vector-only. They cost nothing at write time and are painful to retrofit — and
HVAC queries are dense with exact-match tokens (`RT-SVX23R`, `48-50LC`, terminal
letters `R`/`W`/`Y`/`G`/`C`) that embeddings handle badly.

**Named for `.claude/agents/knowledge.md:37`:**
**Embedding model — `voyage-4-large`, 1024 dimensions, via `embed()` at
`lib/clients.mjs:102`. Vector store — Supabase Postgres 17.6 + pgvector 0.8.2,
HNSW with `vector_cosine_ops`.**

> Note: `docs/retrieval-architecture.md:56,67` names `voyage-context-4` instead,
> for its native contextual embedding. That conflicts with the code
> (`lib/clients.mjs:76`) and with `SETUP-BLOCKERS.md:87`. See `OPEN QUESTION 1`.

---

## 4. Conventions

These are strong and consistent. Match them; do not import a new house style.

**Comments carry the reasoning, not the mechanics.** Every non-obvious decision in
this repo is written down at the point of the decision, usually with the failure
mode it prevents (`lib/clients.mjs:61-75`, `sql/002:32-35`, `app/theme/tokens.ts:34-46`).
This is the single most distinctive convention in the codebase. A change that lands
without its "why" will look wrong here.

**Naming.** `lower_snake_case` in SQL; `camelCase` in JS/TS; `PascalCase` components;
`kebab-case.mjs` for scripts, `camelCase.ts` for app modules; `NNN_snake_case.sql`
for migrations; `SCREAMING_SNAKE` env vars, with `EXPO_PUBLIC_` meaning "will be
inlined into the shipped bundle" and being a **security boundary**, not a prefix.

**Errors fail closed and say what to do.** `require_()` (`lib/clients.mjs:35-39`)
names the variable and the remedy. `embed()` surfaces the provider's own message
(`:139-140`) because "embedding failed" would send Stage 2.5 hunting. Nothing
degrades silently.

**Verification is separated from testing, deliberately.**

| Layer | Command | Files |
|---|---|---|
| Unit | `npm test` (`node --test`) | `lib/*.test.mjs`, `app/lib/*.test.mjs` |
| Acceptance | `npm run verify:stage5` | `tests/suites/e*.mjs` |
| Operator probes | `npm run verify*` | `scripts/verify-*.mjs` |

The acceptance harness has a four-verdict model — `PASS` / `FAIL` / `BLOCKED` /
`HUMAN-ONLY` (`tests/run-all.mjs:180-186`) — and **"a criterion that was not
mechanically executed is never reported as PASS."** `BLOCKED` ≠ `FAIL`: a missing
credential is not a defect. It also tracks regressions against `tests/last-run.json`
(`:107-122`). Any new check must return one of these four verdicts with evidence
(`command`, `exitCode`, `output`).

**No dependencies without a written defence.** The repo has exactly one runtime
dependency (`@supabase/supabase-js`) and five dev dependencies, all lint/type
tooling, each justified in `.pipeline/03-backend.md:42-59`. `pdfplumber` will be the
first Python dependency and needs the same treatment.

**Styling.** `app/theme/tokens.ts` is the only source of colour/type/spacing. Screens
use semantic roles (`color.background`) not `palette` directly. "No hardcoded hex
anywhere else in the app — that rule is greppable and it is meant to be grepped"
(`tokens.ts:5-6`).

**State.** No state library. `useState` in `App.tsx`, a hand-rolled `app/lib/store.ts`,
navigation is a state switch not a router — explicitly so Run C picks real navigation
against its own brief (`App.tsx:3-6`).

---

## 5. Build / test / deploy

### 5.1 The gates, run on `stage/research` (from `main` @ `c748af0`)

| Command | Implementation | Result |
|---|---|---|
| `npm run lint` | `eslint .` | **exit 0 — 0 errors, 0 warnings** |
| `npm run build` | `npm --prefix app run typecheck` → `tsc --noEmit` | **exit 0 — 0 type errors** |
| `npm test` | `node --test` | **exit 0 — 28 pass, 0 fail, ~205 ms** |

**Brief AC 9 is met and S1 is done.** The kickoff premise that no lint/test/build
command exists is stale by two commits.

**Baseline correction for AC 9's "no new warnings".** `.pipeline/03-backend.md:63-67`
records "19 pass" (now 28) and implies a zero-warning baseline. `npm test` in fact
emits **2 runtime warnings**, not recorded anywhere:

```
(node:26196) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of .../app/lib/answerFormat.ts
    is not specified and it doesn't parse as CommonJS. ... Reparsing as ES module
(node:20896) [MODULE_TYPELESS_PACKAGE_JSON] Warning: ... app/lib/citations.ts ...
```

One per `.ts` module imported by a test, because `app/package.json` has no
`"type": "module"`. Harmless, but it is the baseline every later stage compares
against, so **the true baseline is lint 0 / build 0 / test 2 runtime warnings.**
Adding `"type": "module"` to `app/package.json` would clear both — worth checking
against Metro before doing it, which is why this is a note and not a recommendation.

**Dead config:** `eslint.config.mjs:85` scopes an override to `app/**/*.test.mts`.
`c748af0` renamed those to `.mjs`, so the block now matches nothing. The files are
still linted via the `**/*.mjs` block at `:39`, so behaviour is correct — but `:55`
(`app/**/*.{ts,tsx,mts}`) also no longer covers them, meaning **app tests are linted
with Node globals and no TypeScript rules.** Correct outcome, stale expression.

### 5.2 Stage 5 acceptance suite

`npm run verify:stage5` → last recorded run: **26 PASS · 3 FAIL · 21 BLOCKED · 11
HUMAN-ONLY**. The three FAILs:

| Check | Note |
|---|---|
| `E0.2` no API key in any tracked file | "2 tracked file(s) contain a key-shaped string" |
| `E1.1` corpus matches the brief's stated facts | "1 manifest row(s) fail to resolve that the brief does not name: **1929**" |
| `E7.1` scenario set exists | routes to Eval / S20 |

`E1.1` is the harness independently detecting §3.2. The check is right; the constant
it compares against is wrong — `tests/suites/e1-ingestion.mjs:17` hardcodes
`KNOWN_GAPS = ['RT-SVX096C-EN_02282025.pdf', '04-3817.pdf']`, and `04-3817.pdf` is
not a gap (it is on disk as `1.pdf`) while `1929` is. That constant must be corrected
in the same change that resolves the manifest, or the fix will look like a
regression.

### 5.3 CI

**There is none.** No `.github/workflows/`. Every gate is run by hand or by an agent.
Given <10 h/week this is defensible, but it means "the suite is green" is only ever
true of whoever last ran it — which is exactly how `main` drifted twice during this
session. See `OPEN QUESTION 3`.

### 5.4 Deploy — H5/H6 deferral costs less than feared

`SETUP-BLOCKERS.md:120-129` defers Deno and Docker. **Assessed directly:**

```
$ npx supabase@latest functions deploy --help
  --use-api    Bundle functions server-side without using Docker.
```

**Docker (H6) does not block deploying an Edge Function.** `supabase functions
deploy --use-api` bundles server-side. The deferral is correct and costs Run A
nothing on the deploy path. Docker should stay deferred — it is a 2 GB install with
a WSL2 dependency buying nothing here.

**Deno (H5) costs local iteration only.** Without it there is no `supabase functions
serve`, so every S4 change is a deploy-and-test round trip against the hosted
project, with logs from the dashboard rather than a terminal. For one function that
proxies one API call that is tolerable. If S4 takes more than two or three
iterations, install Deno — it is a ~30 MB one-liner
(`irm https://deno.land/install.ps1 | iex`), not the 2 GB Docker commitment, and the
two blockers should not be treated as a pair.

**The real, unflagged cost is a language boundary.** Edge Functions run **Deno/TypeScript**
under `supabase/functions/<name>/index.ts`. `lib/clients.mjs` is Node ESM importing
`node:crypto` and `@supabase/supabase-js`. Deno supports `node:` and `npm:`
specifiers so sharing is *possible*, but nothing in the repo does it today and there
is no `supabase/` directory, no `config.toml`, and no `supabase link`. **S4's first
task is project scaffolding, not writing the Claude call.** Budget for that, and
decide deliberately whether `complete()` is shared with the function or duplicated
inside it — see `OPEN QUESTION 4`.

### 5.5 Migrations

Applied **by hand** in the Supabase SQL Editor (`sql/001_bootstrap.sql:1`). No
migration runner, no `supabase db push`, no applied-state tracking. S6's "re-runnable
from clean" is currently a property of the SQL text (`create ... if not exists`),
not of a tool. Acceptable for Run A; it means "the migration is applied" is a human
claim Stage 5 must list as `HUMAN-ONLY` unless it verifies by querying
`information_schema` — which it can, and should.

---

## 6. Recommended approach

### 6.1 Strategy

**Do the corpus truth-fixing first, as its own small change, before any ingestion
code is written.** Concretely, in order:

1. **Resolve the corpus (S8/S9/S10).** Download the real `04-3817.pdf` from govinfo
   (verified 200); delete `1.pdf`; drop the Mitsubishi row with its reason; drop the
   Trane `RT-SVX096C` row with its reason (URL is 404) and record the scope cost;
   fix `tests/suites/e1-ingestion.mjs:17`. This is under an hour, it removes the
   corpus's only zero-text document, and it makes `E1.1` green. Every later
   measurement is untrustworthy until it is done.
2. **Build `ingest/` as discrete, resumable stages** — `reconcile → parse → chunk →
   tag → embed → store` — each writing its output to disk under `ingest/` (gitignored
   for content, tracked for reports). Parse is 47 s for the whole corpus, so a
   full re-run is cheap; the reason to stage it is that parse quality and chunk
   boundaries need inspecting between steps, not that it is slow.
3. **Chunk per page, structure-aware, and own the page map.** Do not use Voyage
   auto-chunking — it destroys page attribution
   (`docs/retrieval-architecture.md:87-101`), and `page_number NOT NULL` exists
   precisely so an unciteable chunk is rejected at write time.
4. **Extract with pdfplumber, column-aware, and spot-check for splices** before
   embedding anything (§3.5).
5. **Store `embedding_model` per chunk** so the no-stub guarantee survives the
   process boundary (§2.4).
6. **Ship retrieval vector-only**, with the `tsvector`/`pg_trgm` columns present but
   unwired, and let the 12-query smoke set decide whether hybrid earns its place.
7. **Backend S4 in parallel**, the moment H2 clears. It shares no files with
   Knowledge.

### 6.2 Justification

The corpus is small (25 documents, 2,223 pages, ~1.36M tokens) and embedding it is
free inside Voyage's allowance, so the usual RAG cost/quality trade-off is absent —
the binding constraint is the solo builder's hours and the project's stated #1 risk,
answer accuracy. That argues for spending effort on **provenance integrity and
measurement** rather than on retrieval sophistication: own the page map, make an
unciteable chunk impossible at the database level, measure parse quality with a
pinned definition, and let the smoke set decide every remaining question. Fixing the
corpus first is not tidiness — this research found that the one document the brief
names as needing renaming is a *different document entirely*, and that error would
have propagated into every chunk, every citation, and every smoke-set verdict
downstream, where it would look like a retrieval bug rather than a data bug.

### 6.3 Alternatives rejected

| Rejected | Why |
|---|---|
| **OCR pipeline / Tesseract install** | Nothing left to OCR once `04-3817.pdf` is re-downloaded. The brief and plan both budget for a scan problem the measurement shows does not exist. |
| **`pdftotext` as the production extractor** | Available and fast, but `-layout` splices two-column IOM text into confident nonsense (§3.5) and no flag fixes it. Fine as a cross-check, not as the parser. |
| **Voyage auto-chunking** | Destroys the page map; fails silently after a full ingest. |
| **Hybrid retrieval / reranking now** | Premature. Add the columns, wire on measured evidence from the smoke set. |
| **Long-context "load the whole manual"** | Worth building as a *control* (`retrieval-architecture.md:157-176`), not as the answer path — "which manual" classification is the hard part, and picking wrong yields a confident answer with correct-looking citations to the wrong equipment. |
| **A migration runner / `supabase db push`** | Real improvement, but it needs `supabase link` and pulls H5/H6 back in. Not Run A's fight. |
| **Deferring the corpus fix until ingestion works** | The failure mode that motivated this whole document. |

---

## 7. Reconciliation against `02-user-stories.md`

Per-story audit. **Stage 2 owns the rewrite; this section only reports.**
Severity: 🔴 wrong and will cause a defect · 🟠 stale · 🟡 imprecise · ✅ holds.

### Header and current-state table (`02-user-stories.md:20-34`)

🟠 **`main` is at `c748af0`, not `4505c06`** (`:11`). Four merges have landed since:
S1 (`6d0db1c`), S2 (`7cf467d`), a 200% font-scale fix (`e94fda3`), and a
`.mts`→`.mjs` test rename (`c748af0`).

🔴 **`:25` — "`lib/clients.mjs:172` throws `TODO(Stage 3)`" is false.** The empty key
is falsy; it throws at `:175` with the correct fail-closed message. Verified by
execution (§2.3). H2 is still genuinely open — only the mechanism is misdescribed.

🟠 **`:28` — "H8 corpus gaps. 27 manifest rows, 25 PDFs" understates it.** Three rows
are unresolved, one file is unattributed, and the identity of `1.pdf` is wrong (§3.2–3.3).

---

| Story | Verdict | Finding |
|---|---|---|
| **S1** — lint/build/test commands | 🟠 **DONE, not "startable"** | Landed in `6d0db1c`, merged to `main`. All three exit 0 (§5.1). Two corrections: the recorded baseline "19 pass" is now **28 pass**, and the test gate emits **2 `MODULE_TYPELESS_PACKAGE_JSON` runtime warnings** that no artifact records — so "no new warnings" currently has no correct number to compare against. Also `eslint.config.mjs:85` is dead config after `c748af0`. |
| **S2** — secrets out of repo/bundle | 🟠 **DONE, with a live FAIL** | Landed in `7cf467d`. But Stage 5 `E0.2` currently **FAILs**: "2 tracked file(s) contain a key-shaped string" (§5.2). Either a false positive in `lib/secrets.mjs` or a real finding; unresolved either way, and S2 is marked ✅ in `03-backend.md:221`. Its fourth criterion ("after S4 lands") remains correctly open. |
| **S3** — cost tracking | 🟡 **Premise weakened** | Correct as written, but §3.1 shows the whole corpus is **~1.36M tokens against a 200M free allowance — embedding is $0**. The <$20 criterion passes by three orders of magnitude. Cost tracking still matters for *Claude* spend in Runs B/C; as an ingestion gate it is near-vacuous. Priority Medium is, if anything, generous. |
| **S4** — serverless Claude proxy | 🟡 **Right story, one false AC + missing scaffolding** | The "note the current `TODO` message claims 'key is set but unused', which is **false today**" criterion (`:132`) is itself confused: the message is unreachable today (§2.3). Reword to "the empty-key path throws at `:175`; the `:172` branch becomes reachable only once H2 clears." **Missing entirely:** no `supabase/` directory, no `config.toml`, no `supabase link` — S4's first work is Edge Function scaffolding, and the Node↔Deno boundary for `lib/clients.mjs` is undecided (§5.4, `OQ4`). |
| **S5** — device round trip | ✅ Holds | Correctly split machine/human. Gated on S4 + H7. |
| **S6** — chunks migration applied | 🟡 **Verification method unstated** | Ownership split (Knowledge designs, Backend applies) is right. But migrations are applied **by hand in the SQL Editor** (§5.5) — there is no runner, so "committed under `sql/` and re-runnable from clean" is a property of the SQL text, not of a tool, and "is applied" is unverifiable without querying `information_schema`. Say which. |
| **S7** — Expo scaffold + hello-world | ✅ Holds | `npm run build` (typecheck) passes; Outfit loads via `useFonts` (`app/App.tsx:22-28`); tokens are centralised. Device load and tablet width correctly `(human)`. |
| **S8** — manifest reconciled by source URL | 🔴 **Third criterion is factually wrong** | `:206` — "27 rows, 25 PDFs, naming Trane `RT-SVX096C-EN_02282025.pdf` and EPA `04-3817.pdf` as the gaps." **`04-3817.pdf` is not a gap** — it is on disk as `1.pdf` (§3.3). The gaps are `RT-SVX096C-EN_02282025.pdf` and **`1929` (Mitsubishi)**, plus **one unattributed file, `1.pdf`**. Additionally `:204`'s basename join **cannot work for row 22** — the basename is `1929`, no extension, and it needs an explicit special case, not a join rule. `tests/suites/e1-ingestion.mjs:17` hardcodes the same wrong pair and is FAILing because of it. |
| **S9** — orphan rows resolved | 🔴 **`OQ2`'s stated rationale is false** | `:224` — "Neither document is in Phase 1 answer scope, so dropping costs nothing." **Trane `RT-SVX096C-EN` (Foundation rooftop IOM + diagnostics) IS in Phase 1 answer scope** — it is one of the 18 Trane+Carrier rooftop docs (verified: Trane 10 rows − chiller = 9, + Carrier 9 = 18). Dropping it reduces in-scope coverage to **17 rooftop docs + 3 PT charts = 20**. And "attempt one re-download" is already answered: **the URL is HTTP 404** (§3.4). Conversely, the *EPA* document — genuinely out of scope — **is** re-downloadable (HTTP 200, text-native) and doing so removes the corpus's only zero-text-layer file. The default has the two documents' dispositions essentially backwards. Mitigation: AC 7 targets "Trane Precedent and Carrier 48/50", and Precedent (`RT-SVX23R`) and Precedent eFlex (`RT-SVX46G`) are both on disk with 0% and 3% low-text — **AC 7 is not blocked by this gap.** |
| **S10** — stable document identity | 🔴 **Would produce a guaranteed mis-citation** | `:233` — "`1.pdf` resolves to the Mitsubishi City Multi handbook and is renamed." **It does not.** `1.pdf` is a rasterised print-to-PDF of the **EPA Section 608 rule (`04-3817`)**: `/Title` = `04-3817.pdf`, `/Producer` = `Microsoft: Print To PDF`, zero `/Font` objects, US Letter, and **43 pages exactly matching the 43-page original downloaded from govinfo** (§3.3). Executing this AC as written would attach Mitsubishi VRF metadata to EPA regulatory text — a citation that does not support the claim attached to it, which `CLAUDE.md:57-59` names as the worse of the two citation defects. **The Mitsubishi handbook was never downloaded at all.** `docs/retrieval-architecture.md:226-230` reported this on 3 Aug and the story was not updated. |
| **S11** — parse quality measured | 🟡 **Right story, wrong expected outcome** | The mechanism is correct and necessary. But `:245` — "identifies which 20 MB+ scan-heavy documents degraded" — presumes a scan problem that **does not exist**: 24 of 25 documents have clean text layers, and the 25th (`1.pdf`) is replaceable with a text-native original (§3.5). The 20 MB+ files are large because of **embedded drawings**, not scans; `48-50FC` averages 2,434 chars/page. Also `:242`'s "extraction-quality signal" needs a **pinned definition** — this session measured 169 low-text in-scope pages at a <100-non-whitespace-char threshold where `docs/retrieval-architecture.md:33` reports 117. Two numbers for one property makes the gate meaningless. **The unflagged risk S11 should be measuring is two-column splicing** (§3.5), which is invisible to any page-level character-count signal. |
| **S12** — chunking and schema design | ✅ **Holds, and is well-formed** | All five criteria stand. `EMBED_DIM` 1024 confirmed correct (`lib/clients.mjs:83`) — note `docs/retrieval-architecture.md:77` cites it as `:63`, which is wrong. Two additions recommended: `embedding_model` per chunk (§2.4) and the `tsvector`/`pg_trgm` columns in the first migration (§3.8). |
| **S13** — failed extractions dispositioned | 🟠 **`OQ4`'s trigger fires, but not for the reason given** | `OQ4` flips OCR to Critical "if the blocked set includes any of the 18 rooftop docs or 3 PT charts." Four in-scope Carrier books do exceed 15% low-text (`48-50FE` 31%, `48-50FC` 30%, `50HC` 21%, `48-50K` 16%) — so a naive threshold **fires the trigger**. But sampling shows those pages are **dimensional drawings**, not scan failures (§3.5): the caption extracts, the artwork has no text to extract, and there is no raster for OCR to work on. **OCR is the wrong remedy and would consume the run for nothing.** The genuine disposition is a *diagram coverage gap*, logged per document, with `voyage-multimodal-3.5` as the deferred remedy on an eval-driven trigger (`retrieval-architecture.md:206`). S13 must distinguish "extraction failed" from "there was no text here" or it will mis-dispatch. |
| **S14** — metadata tagging + scope | 🟡 **The "18" is ambiguous across documents** | `:290` says 18 Trane+Carrier rooftop docs. `Ductective-Plan-v3.md:47-48` tabulates Trane 9 + Carrier 9 = 18 but its Trane 9 **includes the air-cooled chiller and excludes the missing `RT-SVX096C`** — while the brief (`00-brief.md:59`) explicitly tags the chiller **out**. The two definitions coincide at 18 by accident and disagree on membership. Measured truth: **20 in-scope documents on disk** (8 Trane rooftop + 9 Carrier + 3 PT charts), 1,752 pages, matching `retrieval-architecture.md:20`. Pin the list by document ID in `025-knowledge.md`, not by count. |
| **S15** — embedding with real Voyage | ✅ **Holds** | `embed()` is real, batches at `MAX_BATCH` 128, reports tokens. One gap: `:303` — "a transient failure retries rather than aborting" — **is not implemented today.** `lib/clients.mjs:136-141` throws on any non-OK response with no retry or backoff. Stage 2.5 must add it; it is not already there. `:305`'s `usedMocks()` criterion is correct but **cannot be enforced across processes as written** (§2.4). |
| **S16** — idempotency | ✅ Holds | Correct, and correctly noted as provable on stub vectors since they are deterministic (`lib/clients.mjs:113-121`). |
| **S17** — retrieval contract + smoke set | ✅ **Holds; add one named failure mode** | Well-specified and rightly the most important section. Add explicitly: **near-duplicate sibling manuals**. `48-50FC-20-30-01PD` and `48-50FE-20-30-01PD` are both 144 pages, ~2,450 chars/page, sibling product-data books for the same 20–30 ton platform. Retrieval returning the right content from the wrong sibling scores as a miss **and** produces a citation that looks valid — `retrieval-architecture.md:216-222` calls it the most likely way AC 7 fails. Put a deliberate disambiguating query in the 12. |
| **S18** — one command, cost + runtime | ✅ **Holds, and will pass easily** | Measured inputs: parse is **46.5 s** for all 2,223 pages; embedding is **~1.36M tokens = $0** inside Voyage's 200M free tier. Expect a full re-ingest in single-digit minutes at $0. |
| **S19** — human-only steps enumerated | 🟠 **`SETUP-BLOCKERS.md` is stale on two rows** | `:362` requires the file stay current. **H4 is listed ✅ but H5/H6's "Deferred" note omits the finding that `supabase functions deploy --use-api` needs no Docker** (§5.4) — so the file overstates what deferral costs. **H8's description is wrong** in the same way S8/S9/S10 are: it names `04-3817.pdf` as missing when it is on disk as `1.pdf`, and omits Mitsubishi entirely (`SETUP-BLOCKERS.md:143-147`). |
| **S20** — scenario set from top-15 faults | 🔴 **Asserted "not started"; a file already exists** | `:383` — "It has not started." **`tests/fixtures/top-15-faults.json` exists on `main`** and `tests/suites/e7-e8-operability.mjs` already checks against it. Stage 5 `E7.1` still FAILs ("no scenario set"), so the fixture evidently does not satisfy the criterion — but the story's premise that nothing exists is wrong, and Eval must **reconcile with the existing fixture** rather than create a second, competing source of truth. |

### Coverage-map corrections (`02-user-stories.md:392-403`)

- **AC 9 → S1** is marked pending; it is **satisfied** (§5.1), modulo the warning
  baseline correction.
- **AC 6 → S8, S9, S10, S13** is the right mapping, but all four stories carry the
  `1.pdf` identity error, so AC 6 cannot be discharged until §3.3 is accepted.
- The reverse-coverage claim "every story serves a criterion except S3 and S19"
  still holds.

### The flagged risk (`02-user-stories.md:426-432`) — resolved

`02-user-stories.md` correctly flags that AC 7's 10-of-12 bar is not independent of
`OQ4`. **This research resolves it: AC 7 is not at risk from parse quality.** The
Trane Precedent IOM (`RT-SVX23R`, 68 pp, **0%** low-text, 3,034 chars/page) and
Precedent eFlex (`RT-SVX46G`, 3%) are the cleanest documents in the corpus, and the
Carrier 48/50 IOMs relevant to fault queries (`48HJ` 5%, `50E` 6%, `48-50LC` 7%,
`48-50PGPM` 7%) are all healthy. The low-text concentration is in Carrier *product
data* books, which are dimension/performance references, not fault-diagnosis
sources. **The live risk to AC 7 is sibling-manual confusion (S17), not extraction.**

---

## 8. Risks & unknowns

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **`1.pdf` mis-identification propagates.** Four stories instruct Stage 2.5 to label EPA regulatory text as a Mitsubishi VRF handbook. | 🔴 Critical | Fix the corpus before writing ingestion code (§6.1 step 1). Already proven in §3.3. |
| R2 | **Two-column splicing.** Invisible in chunk counts, page counts, and character counts; produces fluent nonsense that embeds and retrieves confidently. | 🔴 Critical | Column-aware pdfplumber extraction + mandatory human spot-check of a two-column body page before embedding. |
| R3 | **Sibling-manual confusion** (`48-50FC` vs `48-50FE`). Right content, wrong document, valid-looking citation. | 🔴 Critical | Named failure mode in S17's smoke set with a deliberate disambiguating query. |
| R4 | **`usedMocks()` cannot prove a past run was stub-free** — it is per-process module state. | 🟠 High | Persist `embedding_model` per chunk and `stub_used` per ingest run; assert against the database (§2.4). |
| R5 | **`main` is being committed to directly**, twice during this session, against `CLAUDE.md:43`. Artifacts cite SHAs that go stale within hours. | 🟠 High | `git log main` at the start of every stage. Cite behaviour, not SHAs, where possible. |
| R6 | **No CI.** "The suite is green" is only true of whoever last ran it. | 🟠 High | `OQ3` — a single GitHub Actions workflow running the three gates. |
| R7 | **`E0.2` is FAILing** — 2 tracked files contain a key-shaped string — while S2 is marked done. | 🟠 High | Triage before Stage 5 signs off: false positive in `lib/secrets.mjs` or a real leak. |
| R8 | **Diagram coverage gap.** 169 in-scope pages carry no retrievable text. A wiring-diagram question will fail with no signal that content was missing. | 🟡 Medium | Log the gap per document; make the retrieval contract state how Run B reads an empty result set (already S17's last criterion). |
| R9 | **In-scope coverage drops to 17 rooftop docs** — `RT-SVX096C` URL is dead. | 🟡 Medium | Accept and record. AC 7 targets Precedent and 48/50, both fully present. |
| R10 | **Edge Function scaffolding is unbuilt and the Node↔Deno boundary is undecided.** S4 is larger than "implement `complete()`". | 🟡 Medium | `OQ4`. Scope S4 to include `supabase init` + `link`. |
| R11 | **Supabase free tier pauses after 7 days idle** at <10 h/week. Looks like an outage. | 🟡 Medium | Documented (`SETUP-BLOCKERS.md:76-78`). Run `npm run verify` first, every session. |
| R12 | **`embed()` has no retry**, contrary to S15's criterion. A single transient 429/5xx aborts a full ingest. | 🟡 Medium | Stage 2.5 adds bounded backoff. Stage-level resumability (§6.1 step 2) limits the blast radius. |
| R13 | **H2 blocks ACs 2, 3 and all of S4/S5.** A 5-minute human task. | 🟠 High | Unchanged. Set a spend limit at creation. |

---

## 9. Open questions

**`OPEN QUESTION 1` — `voyage-4-large` or `voyage-context-4`?**
`lib/clients.mjs:76` and `SETUP-BLOCKERS.md:87` say `voyage-4-large`.
`docs/retrieval-architecture.md:56,67` says `voyage-context-4` at
`output_dimension: 1024`, for native contextual embedding and to avoid hand-rolling
Anthropic's Contextual Retrieval. Both are 1024-capable, so `EMBED_DIM` is unaffected
either way, and `VOYAGE_MODEL` already overrides.
*Proposed default:* **`voyage-4-large`** — it is what the verified, working client
uses today (H3 was cleared against it), and `02-user-stories.md:302` names it in
S15's acceptance criterion. Stage 2.5 owns the final call
(`lib/clients.mjs:72`) and may switch on smoke-set evidence, **but must re-embed
everything if it does** — vectors from different models are not comparable and a
mixed index degrades silently.

**`OPEN QUESTION 2` — is the Trane air-cooled chiller in or out of Phase 1 scope?**
`00-brief.md:59` says out. `Ductective-Plan-v3.md:47` counts it inside the Trane 9
that makes up "the 18".
*Proposed default:* **out**, per the brief, which governs. Record the in-scope set as
an explicit list of 20 document IDs in `025-knowledge.md` so the count stops being
load-bearing.

**`OPEN QUESTION 3` — should Run A add CI?**
No workflow exists; `main` drifted twice this session.
*Proposed default:* **yes, minimally** — one GitHub Actions workflow running
`npm run lint && npm run build && npm test` on PR. No secrets needed (the unit suite
requires none, by design). ~20 lines. If rejected as scope creep, it goes to
`.pipeline/backlog.md` and the risk is accepted explicitly rather than by silence.

**`OPEN QUESTION 4` — how does the Edge Function reach `complete()`?**
Edge Functions are Deno/TypeScript; `lib/clients.mjs` is Node ESM. Deno supports
`node:`/`npm:` specifiers, so importing is possible but unproven here, and no
`supabase/` project exists yet.
*Proposed default:* **implement `complete()` inside the function** (`supabase/functions/
diagnose/index.ts`) using `fetch` against the Anthropic REST API, and keep
`lib/clients.mjs:complete()` as the Node-side seam for scripts and tests, sharing the
request/response *contract* (documented in `03-backend.md`) rather than the code. One
`fetch` call duplicated is cheaper than a cross-runtime import that fails at deploy
time. Revisit if a second function appears.

**`OPEN QUESTION 5` — who owns the `citations.snippet` schema change?**
Carrying Claude's `cited_text` needs `snippet` and probably `chunk_id` on
`sql/002_prototype_sessions.sql:57-66`. `docs/retrieval-architecture.md:250-252`
flags it as unassigned.
*Proposed default:* **out of scope for Run A.** No answer path exists, so nothing
produces a `cited_text` yet. Assign it to Run B's Stage 3 in `00-brief-run-b.md`.
Recorded here so the silence is not read as a decision.

**`OPEN QUESTION 6` — add `"type": "module"` to `app/package.json`?**
It would clear the 2 `MODULE_TYPELESS_PACKAGE_JSON` warnings that are the test gate's
real baseline (§5.1).
*Proposed default:* **no, not in Run A.** It changes how Metro resolves the app's own
modules and the payoff is two cosmetic warnings. Instead, **record the baseline as
"lint 0 / build 0 / test 2 runtime warnings"** in `03-backend.md` so AC 9's "no new
warnings" has a correct number.

---

## Appendix — commands run for this artifact

```bash
npm run lint                     # exit 0 — 0 errors, 0 warnings
npm run build                    # exit 0 — 0 type errors
npm test                         # exit 0 — 28 pass, 2 runtime warnings
node --env-file=.env -e '...complete()...'          # §2.3 fail-closed behaviour
pdftotext -q "HVAC Data/*.pdf"                      # §3.1 all 25 docs, 46.5s
pdftotext -layout / -raw  RT-SVX23R p.22            # §3.5 column comparison
curl -I <RT-SVX096C url>                            # 404
curl -I <04-3817 url>                               # 200, 469 kB
curl -I <mitsubishi /1929>                          # 200, PUHY service manual
curl -o epa.pdf <04-3817> && pdftotext epa.pdf      # 43 pages — matches 1.pdf
npx supabase@latest functions deploy --help         # --use-api, no Docker
```

`HVAC Data/` was read only. No application code was modified. The only file this
stage writes is `.pipeline/01-research.md`.
