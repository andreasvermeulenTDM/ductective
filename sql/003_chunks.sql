-- 003_chunks.sql — the knowledge base. S12 (schema) + S6 (applied) + S10 + A4.
--
-- Run once, in the Supabase SQL Editor.
--
-- Brief criterion 4: a chunks table with pgvector carrying, per chunk, the source
-- document, page number, manufacturer, model/coverage, doc type and
-- `license_status`. Every one of those is NOT NULL below, because a chunk that
-- cannot name its provenance cannot be cited, and `CLAUDE.md` makes an uncited
-- claim a defect.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- documents — S10, stable identity
-- ---------------------------------------------------------------------------
-- `id` is derived from the SourceURL, never from the filename. Files in this
-- corpus are stored under source names that lie about their contents (`1.pdf` is
-- the EPA Section 608 rule), and the manifest's FileName column holds renames
-- that were never applied. Keying on either means a rename silently re-points
-- every citation. S10's DoD: renaming a file on disk changes no chunk's citation.
create table if not exists public.documents (
  id              text        primary key,
  label           text        not null,
  file_name       text        not null,
  manufacturer    text        not null,
  doc_type        text        not null,
  coverage        text        not null default '',
  source_url      text        not null,
  license_status  text        not null,

  -- Phase 1 answer scope. Out-of-scope documents are ingested and tagged, per the
  -- brief, so retrieval precision is measured against the equipment under test
  -- rather than flattered by a corpus that excludes the distractors.
  in_scope        boolean     not null default false,

  page_count      integer     not null default 0,
  usable_pages    integer     not null default 0,
  two_column_pages integer    not null default 0,
  mean_alpha_ratio real       not null default 0,

  -- S13: every document carries the disposition it was ingested under.
  disposition     text        not null check (disposition in ('ingest', 'ingest-with-caveat', 'excluded')),
  disposition_reason text     not null default '',

  ingested_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chunks
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id            uuid        primary key default gen_random_uuid(),
  document_id   text        not null references public.documents(id) on delete cascade,

  -- The citable unit. NOT NULL is the whole point: brief criterion 4 and
  -- retrieval-architecture §3.2 both turn on a chunk being able to name its page,
  -- and a page-less chunk must be rejected at write time rather than tolerated.
  page          integer     not null check (page > 0),
  chunk_index   integer     not null,

  text          text        not null check (length(btrim(text)) > 0),

  -- Denormalised provenance. Deliberate: a citation is rendered from the chunk
  -- alone, and a join that can fail is a citation that can fail.
  manufacturer  text        not null,
  doc_type      text        not null,
  coverage      text        not null default '',
  license_status text       not null,
  in_scope      boolean     not null default false,

  embedding     extensions.vector(1024),

  -- A4: usedMocks() is per-process state and Stage 5 runs in a different process
  -- than ingestion, so it can never prove a past run was stub-free. The model that
  -- produced each vector is persisted here instead, making it provable from the
  -- database on a cold start.
  embedding_model text      not null default 'none',

  -- S16: idempotency. Re-ingesting a document replaces its chunks rather than
  -- duplicating them, and an unchanged chunk keeps its embedding rather than
  -- being paid for twice.
  content_hash  text        not null,

  -- §3.4: build the lexical columns now, wire retrieval to them later. They cost
  -- nothing at write time and are painful to retrofit.
  tsv           tsvector    generated always as (to_tsvector('english', text)) stored,

  created_at    timestamptz not null default now(),
  unique (document_id, page, chunk_index)
);

create index if not exists chunks_document_idx on public.chunks (document_id);
create index if not exists chunks_scope_idx    on public.chunks (in_scope);
create index if not exists chunks_hash_idx     on public.chunks (content_hash);
create index if not exists chunks_tsv_idx      on public.chunks using gin (tsv);
create index if not exists chunks_trgm_idx     on public.chunks using gin (text extensions.gin_trgm_ops);

-- HNSW over cosine. voyage-4-large returns 1024 dims, which is inside pgvector's
-- 2,000-dim ceiling for `vector` — see retrieval-architecture §3.1.
create index if not exists chunks_embedding_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Retrieval — the contract Stage 3 builds against (S17)
-- ---------------------------------------------------------------------------
-- Returns everything a citation needs and nothing that needs a second query.
create or replace function public.match_chunks(
  query_embedding extensions.vector(1024),
  match_count     integer default 8,
  scope_only      boolean default true
)
returns table (
  chunk_id      uuid,
  document_id   text,
  document      text,
  page          integer,
  text          text,
  manufacturer  text,
  doc_type      text,
  coverage      text,
  license_status text,
  in_scope      boolean,
  similarity    real
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select c.id, c.document_id, d.label, c.page, c.text,
         c.manufacturer, c.doc_type, c.coverage, c.license_status, c.in_scope,
         (1 - (c.embedding <=> query_embedding))::real as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and (not scope_only or c.in_scope)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- RLS — same prototype posture as 002, and the same warning
-- ---------------------------------------------------------------------------
-- The knowledge base is freely-published OEM literature, so read-for-anon is not
-- a data-exposure problem. Writes are service-role only: ingestion runs
-- server-side, and an anon key that can write chunks can poison every citation
-- in the system.
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to anon, authenticated using (true);

drop policy if exists chunks_read on public.chunks;
create policy chunks_read on public.chunks for select to anon, authenticated using (true);

revoke execute on function public.match_chunks(extensions.vector, integer, boolean) from public;
grant execute on function public.match_chunks(extensions.vector, integer, boolean) to anon, authenticated, service_role;
