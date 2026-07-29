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
| H1 | Supabase account + project, pgvector enabled | Any storage or retrieval | ⬜ Not done |
| H2 | Anthropic API key | Claude round trip, diagnostic core | ⬜ Not done |
| H3 | Voyage API key | Embedding the corpus | ⬜ Not done |
| H4 | Supabase CLI installed | Migrations, deploying Edge Functions | ⬜ Not done |
| H5 | Deno CLI installed | Running Edge Functions locally | ⬜ Not done |
| H6 | Docker Desktop installed | `supabase start` (local stack) | ⬜ Not done |
| H7 | Physical iOS or Android device + Expo Go | Acceptance criteria 2 and 3 | ⬜ Not done |
| H8 | Re-download `RT-SVX096C-EN_02282025.pdf` and `04-3817.pdf` | Corpus completeness | ⬜ Not done |

Update the status column as you go. An agent that needs a blocked item must stop
and say so rather than working around it.

## How to clear each one

**H1 — Supabase.** Create a free project at supabase.com. Note the project URL,
the `anon` key, and the `service_role` key. Enable pgvector by running
`create extension if not exists vector;` in the SQL editor — or let the first
migration do it. Free tier is sufficient for the whole prototype.

**H2 — Anthropic.** Get a key at console.anthropic.com. Set a **spend limit** on
the account before you use it; the plan budgets $50–150/mo and an unbounded key
plus a loop is how that becomes $800.

**H3 — Voyage.** Get a key at voyageai.com. Embedding the whole corpus should land
under $20 — if a run projects materially above that, stop and re-check the
chunking rather than paying it.

**H4–H6 — tooling.**

```bash
npm install -g supabase && supabase --version
```

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
supabase --version && deno --version && docker info
```

If any of the three fails, Run A will get as far as writing ingestion code and
then stop — which is precisely the v1 failure. Better to know now.

## What can proceed while these are blocked

Not everything waits. With zero accounts and zero tooling, these still work:

- Repo scaffolding, `.gitignore`, workspace config
- Expo app scaffold (`npx create-expo-app`) — runs offline
- The ingestion script's **parse and chunk** stages, which need no API key at all.
  Parsing 25 PDFs and measuring extraction quality per document is genuinely the
  largest single chunk of Run A, and it is fully unblocked.
- The eval scenario set — writing the top-15 RTU faults from
  `Ductective-Plan-v3.md` §3 into a scored file needs nothing but domain thought.
- Recruiting a commercial RTU tech (plan §7 item 1), which is the longest pole
  in the whole project and depends on none of this.

So the right move while blocked is: scaffold, parse, chunk, measure, and recruit.
Embedding, storage, retrieval, and the round trip wait for H1–H3.
