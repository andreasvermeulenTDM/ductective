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
| H2 | Anthropic API key | Claude round trip, diagnostic core | ⬜ Not done — **stubbed** |
| H3 | Voyage API key | Embedding the corpus | ⬜ Not done — **stubbed** |
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

**H2 — Anthropic.** Get a key at console.anthropic.com. Set a **spend limit** on
the account before you use it; the plan budgets $50–150/mo and an unbounded key
plus a loop is how that becomes $800.

**H3 — Voyage.** Get a key at voyageai.com. Embedding the whole corpus should land
under $20 — if a run projects materially above that, stop and re-check the
chunking rather than paying it.

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
