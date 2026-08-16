-- 018_document_suggestions.sql — ST-R15 (N4, "suggestions must come from the
-- manuals, and be askable"). Run in the Supabase SQL Editor. Guarded; re-runnable.
--
-- ---------------------------------------------------------------------------
-- What this table is for
-- ---------------------------------------------------------------------------
-- `app/lib/starters.ts` returned four hardcoded strings per equipment class,
-- with a comment claiming "Always four, always answerable". The second half was
-- asserted and never measured. On a Bosch IDS the taxonomy offered generic
-- heat-pump faults while that corpus is mostly installation manuals, so all four
-- taps returned no-documentation — the four dead turns of the 16 Aug 2026
-- session.
--
-- A row in this table is a question that has been **proved answerable**: mined
-- from a chunk in that document, phrased by a fixed server-side template, passed
-- through `classifyHazard`, then embedded and run back through the *same*
-- `match_chunks` retrieval that will serve it — and kept only if the chunk it was
-- mined from came back at rank 1. `similarity` and `retrieval_rank` are that
-- measurement, stored, so "always answerable" is a number rather than a comment.
--
-- ---------------------------------------------------------------------------
-- Why a table and not a committed JSON artifact (OQ-R6)
-- ---------------------------------------------------------------------------
-- A generated file in the repo would be reviewable in a diff, which is a genuine
-- advantage, and it was rejected for two reasons. Do not "simplify" it back.
--
--  1. **It is a committed list of things the corpus contains** — which is the
--     precise shape of the defect being fixed. It would be correct the day it
--     was generated and quietly wrong the day a document was ingested, retired
--     or re-scoped.
--  2. **It cannot inherit `documents.in_scope`.** A table joins: retiring a
--     duplicate (ST-R13) or taking a document out of Phase 1 scope removes its
--     suggestions with no second action and no chance of forgetting one. A file
--     would keep offering questions about a manual retrieval no longer reads.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
-- One new table, one index, one policy, one grant. Nothing existing is read,
-- written, altered or dropped. `documents`, `chunks`, `messages` and `sessions`
-- are untouched. Rolling back is `drop table public.document_suggestions`.
--
-- Until this is applied, `/unit-suggestions` returns `{"suggestions": []}` and
-- the app renders its empty state — never an error, and never the old taxonomy.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
-- `document_id` cascades: a deleted document must not leave questions behind
-- that promise coverage nothing can answer.
--
-- `chunk_id` is a plain uuid with **no** foreign key, matching `citations`
-- (sql/006:21) and for the same reason: the chunk a suggestion was mined from
-- can be re-chunked by an ordinary ingest run, and a hard reference would make a
-- re-ingest fail rather than a suggestion go stale. `suggestions:build` is
-- idempotent and re-points it.
create table if not exists public.document_suggestions (
  id              uuid        primary key default gen_random_uuid(),
  document_id     text        not null references public.documents(id) on delete cascade,
  chunk_id        uuid,
  page_number     integer     not null,

  -- The rendered question, server-composed from a fixed template. The app
  -- renders this string verbatim and never composes one of its own.
  text            text        not null,
  -- The mined heading or code the template was wrapped around.
  topic           text        not null,
  category        text        not null
                  check (category in ('fault', 'reference', 'sequence', 'commissioning')),

  -- The validation measurement, kept so the claim is inspectable rather than
  -- trusted: what similarity the question retrieved its own chunk at, and at
  -- what rank. Only rank 1 is ever stored; the column exists so a later change
  -- of policy is visible in the data rather than only in a script.
  similarity      real        not null,
  retrieval_rank  integer     not null default 1,

  validated_at    timestamptz not null default now(),

  -- One row per question per document. The build upserts on this, which is what
  -- makes a re-run leave `validated_at` alone for an unchanged suggestion.
  unique (document_id, text)
);

create index if not exists document_suggestions_document_idx
  on public.document_suggestions (document_id);

-- ---------------------------------------------------------------------------
-- RLS — the same posture sql/003 gives `chunks`
-- ---------------------------------------------------------------------------
-- Readable by anon and authenticated: these are questions about published
-- manufacturer documentation, and the app must be able to show them before a
-- technician signs in. **Writes are service-role only** — the build script runs
-- server-side, and an anon key that could write here could put an arbitrary
-- string in front of a technician as a one-tap suggestion.
alter table public.document_suggestions enable row level security;

drop policy if exists document_suggestions_read on public.document_suggestions;
create policy document_suggestions_read on public.document_suggestions
  for select to anon, authenticated using (true);

grant select on public.document_suggestions to anon, authenticated;
grant select, insert, update, delete on public.document_suggestions to service_role;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- select count(*) from public.document_suggestions;
--   Expect: 0 immediately after applying, then a real number after
--           `npm run suggestions:build`.
--
-- select category, count(*) from public.document_suggestions group by 1 order by 2 desc;
--   Expect: a mix across fault / reference / sequence / commissioning.
