# Setup blockers — the human-only critical path

**Read this before starting any pipeline run.** Nothing in this file can be done by
an agent. Every item needs a human with a browser, a credit card, or an installer.

This file exists because it is exactly where the previous attempt
(`andreasvermeulenTDM/ductective-v1`) stalled. Its status board recorded the
outcome plainly:

> Three platform states, zero executions. Compiling is not running.

v1 wrote a full backend across two platform pivots without ever running it,
because the accounts and tooling underneath it were never set up. The code
typechecked and shipped nothing. **The lesson is sequencing: set these up first,
verify each one with the check command, and only then let the pipeline build on
top of them.**

## Status

| # | Blocker | Needed for | Status |
|---|---|---|---|
| H1 | Supabase account + project, pgvector enabled | Any storage or retrieval | ✅ **Verified 29 Jul 2026** |
| H2 | **Google AI Studio key** | Model round trip, diagnostic core | ✅ **Verified 4 Aug 2026** |
| H3 | Voyage API key | Embedding the corpus | ✅ **Verified 3 Aug 2026** |
| H4 | Supabase CLI available | Migrations, deploying Edge Functions | ✅ **Resolved via `npx`** |
| H5 | Deno CLI installed | Running Edge Functions locally | ⏸️ **Deferred by decision** |
| H6 | Docker Desktop installed | `supabase start` (local stack) | ⏸️ **Deferred by decision** |
| H7 | Physical iOS or Android device + Expo Go | Acceptance criteria 2 and 3 | ⬜ Not done |
| H8 | Re-download `RT-SVX096C-EN_02282025.pdf` and `04-3817.pdf` | Corpus completeness | ⬜ Not done |

Update the status column as you go. An agent that needs a blocked item must stop
and say so rather than working around it.

### H1 — evidence, not assertion

`npm run verify` ([scripts/verify-connection.mjs](scripts/verify-connection.mjs))
exits 0 against the live project:

| Check | Result |
|---|---|
| Postgres | 17.6 |
| pgvector | 0.8.2 installed |
| Public schema | 0 base tables — Stage 2.5 starts clean |
| `service_role` → `ductective_health()` | 200 |
| `anon` → `ductective_health()` | 401, `42501 permission denied` |

That last row is the privilege split brief criterion 3 depends on, demonstrated
rather than assumed. Re-run `npm run verify` any time; if it fails, the rail is
down and no ingestion result should be trusted.

### What "stubbed" means for H2 and H3

[lib/clients.mjs](lib/clients.mjs) ships stubs behind the interface the real
Anthropic and Voyage clients will implement, so Stage 3 replaces two function
bodies rather than rewiring callers. The stubs **fail closed**: an empty key
throws, and fabricated data requires `ALLOW_STUBS=true`, which prints a warning
banner per stub and registers it in `usedMocks()`.

**Stages 5 and 5.5 must assert `usedMocks()` is empty.** A scored run that
silently graded canned text is the failure mode the eval charter exists to catch.

One consequence to hold onto: stub embeddings are deterministic — so idempotency
tests are real — but carry no semantics. **Brief criterion 7, the 12-query
retrieval smoke set, cannot pass on stub vectors** and must not be marked green
until H3 is cleared.

## How to clear each one

**H1 — Supabase. ✅ Done.** Project is live on the free tier. Keys are in `.env`
(gitignored); the template is `.env.example`. pgvector and the health probe were
installed by running [sql/001_bootstrap.sql](sql/001_bootstrap.sql) in the SQL
Editor. Two things to remember:

- The **project URL is an origin** — no `/rest/v1` path. `supabase-js` appends it,
  and a path here double-prefixes every request into a 404.
- **Free-tier projects pause after 7 days of inactivity.** At under 10h/week this
  will happen. It's one click to restore, but the first time it looks like an
  outage.

**H2 — Google AI Studio.** Get a key at aistudio.google.com and set it as
`GEMINI_API_KEY` in `.env`. Answer generation moved to Gemini Flash on 4 Aug 2026
(owner decision, cost-driven). Voyage keeps embeddings; Supabase is unchanged.

**⚠ A control regressed here, and it is not a like-for-like swap.** This entry
used to require an Anthropic spend limit, because *"an unbounded key plus a loop is
how that becomes $800."* **Google has no equivalent hard stop.** Cloud Billing
budgets send an *alert*; they do not cut anything off. The nearest real control is
a per-key API quota cap.

So, before running anything in a loop against this key:

- Set a **per-key quota cap**, or write down that you accepted the risk without one.
  Do not tick this off by "setting a budget" — a budget here is a notification.
- If you plan around the **free tier**, verify its RPM/RPD limits survive a
  30-scenario eval run first. If they don't, re-derive the cost case against paid
  pricing before relying on it.

On tier ordering, the risk runs opposite to intuition: the free tier is *safest
now* — your own queries, no customers, throwaway data — and *riskiest later*, when
traffic is real technician queries plus verbatim OEM content at volume, under terms
permitting product-improvement use and human review. **Free now, paid at Phase 2**
is the lower-risk ordering. Check the current Gemini API Additional Terms before
committing either way.

**H3 — Voyage. ✅ Done.** Key is in `.env`. `npm run verify` embeds live and
reports the model, dimensions, and tokens billed.

**Model: `voyage-4-large`, and the choice is a budget decision as much as a quality
one.** Verified live — voyage-3-large/3.5/3.5-lite and voyage-4/4-lite/4-large all
return **1024 dimensions**, so `EMBED_DIM` holds across any of them. But the
voyage-3 family carries **no free tokens** ($0.18/1M for 3-large) while the
voyage-4 family includes **200M free**. The whole corpus embeds inside that
allowance, so the newer and better model is also the free one.

Override with `VOYAGE_MODEL` to compare. **Re-embed everything when you switch** —
vectors from different models are not comparable, and a mixed index degrades
silently rather than erroring.

Two things the client enforces so they cannot go wrong quietly:

- **`input_type` is not cosmetic.** Voyage embeds asymmetrically. Corpus chunks go
  in as `document`, searches as `query`; mismatching them costs recall measurably.
  Ingestion must pass `document`, the retrieval smoke set `query`.
- **A returned vector of the wrong width throws.** Storing it would corrupt the
  index silently, which is worse than a failed ingest.

`embedTokensUsed()` accumulates tokens billed per process, so Stage 2.5 can report
real cost for brief criterion 8 rather than estimating it.

### H2 — evidence

`npm run verify` passes live on the `gemini` probe, not stubbed:

```
PASS  gemini (live) — gemini-3.6-flash, 2/17 tokens, finish=STOP
```

**Model is pinned to `gemini-3.6-flash`, deliberately not `gemini-flash-latest`.**
`-latest` is a moving alias, and Stage 5.5 compares each round against the previous
one — a model that changes underneath makes a regression indistinguishable from a
model swap, which is the one thing that reporting exists to catch. Override with
`GEMINI_MODEL`; re-baseline when you bump it.

**Listed is not callable.** Three findings from probing this account:

| Model | Result |
|---|---|
| `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest` | ✅ callable |
| `gemini-2.5-flash` | ❌ `NOT_FOUND` — "no longer available to new users", **despite appearing in the model list** |
| `gemini-2.0-flash` | ❌ `RESOURCE_EXHAUSTED` |

Do not use the model list as a capability check.

**Safety-filter probe.** Gas/combustion, live electrical, and refrigerant prompts
all returned `promptBlock=none`. The filter did not fire on HVAC vocabulary. That
is four prompts, not a measurement — M12 owns the real block rate — but the risk
looks smaller than the Run B constraint assumed. The constraint stays: a provider
block is an error, never a refusal, and the failure is silent.

**Your key format is `AQ.`, not `AIza`.** The scanner's original Google rule would
not have caught this project's own live key. Both patterns are now in
`lib/secrets.mjs`; verified the live key's shape is matched.

**H4 — Supabase CLI. ✅ Resolved without installing anything.**

```bash
npx supabase@latest --version
```

Do **not** use `npm install -g supabase` — the package blocks global installation
and the command fails. (This file previously recommended it; it was wrong.) When
Run A creates the app's `package.json`, pin the CLI there as a dev dependency so
the version is reproducible.

**H5 and H6 — Deno and Docker Desktop. ⏸️ Deferred, deliberately.**

Both exist only to run the Supabase stack and Edge Functions *locally*. Migrations
apply through the SQL Editor and functions deploy straight to the hosted project,
which is all Run A's round trip needs. Docker is a 2 GB+ install with a WSL2
dependency that buys this run nothing.

Install them when you want to iterate on Edge Functions offline, or when a
migration gets complex enough that you want to test it against a throwaway local
database first. Neither blocks Run A.

```bash
irm https://deno.land/install.ps1 | iex
```

Docker Desktop installs from docker.com/products/docker-desktop. It must be
*running*, not merely installed, before `supabase start` will work.

**H7 — device.** Install Expo Go from the App Store or Play Store. Phone and
laptop must be on the same network. Acceptance criteria 2 and 3 in
`.pipeline/00-brief.md` can only be confirmed by you holding the phone — no agent
can claim them.

**H8 — corpus gaps.** `data/manifest.csv` has 27 rows; `HVAC Data/` has 25 PDFs.
Missing: Trane `RT-SVX096C-EN_02282025.pdf` (Foundation rooftop IOM) and EPA
`04-3817.pdf` (2004 Section 608 rule). Both source URLs are in the manifest.
Either re-download them or delete the two rows — but decide, and record the
decision, so the knowledge agent doesn't rediscover the gap every run.

## Verify before you start Run A

```bash
npm run verify
```

Exit 0 means the Supabase rail is live end to end — env vars present, client
constructs, pgvector installed, and the anon key correctly refused. Exit 1 prints
the failing check and its remedy. Run it before any stage that touches storage; a
green ingestion run against a down rail is worse than no run at all.

If any of H1–H3 is unmet, Run A gets as far as writing ingestion code and then
stops — which is precisely the v1 failure. Better to know now than at the
embedding step.

## What can proceed with H2 and H3 still open

Most of Run A. With Supabase live and the two API keys stubbed, these are fully
unblocked:

- Expo app scaffold (`npx create-expo-app`) — runs offline
- The KB schema and migrations — pgvector is installed and the schema is empty
- The ingestion pipeline's **parse, chunk, tag, and store** stages. Parsing 25
  PDFs and measuring extraction quality per document is the largest single piece
  of Run A, and none of it needs an API key.
- **Idempotency** — re-ingest replacing rather than duplicating (criterion 5) is
  provable on stub vectors, because they're deterministic.
- The eval scenario set — writing the top-15 RTU faults from
  `Ductective-Plan-v3.md` §3 into a scored file needs nothing but domain thought.
- Recruiting a commercial RTU tech (plan §7 item 1), the longest pole in the
  project, which depends on none of this.

**What genuinely waits for H2/H3:**

- Real embeddings, and therefore **criterion 7** (the 12-query retrieval smoke
  set). Stub vectors are semantically empty; a score against them is noise.
- The Claude round trip, and therefore **criteria 2 and 3** — which also need H7.
- Real re-ingest **cost and runtime** figures (criterion 8).
