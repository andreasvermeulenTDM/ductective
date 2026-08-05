-- 003_chunks.sql — the knowledge base. S12 (schema) + S6 (applied) + S10 + A4.
--
-- Run in the Supabase SQL Editor. Safe to re-run: every statement is guarded.
--
-- Brief criterion 4: a chunks table with pgvector carrying, per chunk, the source
-- document, page number, manufacturer, model/coverage, doc type and
-- `license_status`. Every one is NOT NULL below, because a chunk that cannot name
-- its provenance cannot be cited, and `CLAUDE.md` makes an uncited claim a defect.
--
-- If this fails, run the blocks one at a time — they are separated below and each
-- is independently re-runnable, so a failure names its own statement instead of
-- rolling back the lot.

-- ===========================================================================
-- BLOCK 1 — extensions and search path
-- ===========================================================================
-- `search_path` rather than schema-qualifying every type reference. An earlier
-- version wrote `extensions.vector(1024)` and `extensions.vector_cosine_ops`
-- throughout, which only works if pgvector actually landed in `extensions` — on a
-- project where it sits in `public`, every one of those references fails. Setting
-- the path resolves the type wherever it lives.
set search_path = public, extensions;

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ===========================================================================
-- BLOCK 2 — documents (S10, stable identity)
-- ===========================================================================
-- `id` is derived from the SourceURL, never from the filename. Files in this
-- corpus are stored under source names that lie about their contents (`1.pdf` is
-- the EPA Section 608 rule), and the manifest's FileName column holds renames
-- that were never applied. Keying on either means a rename silently re-points
-- every citation. S10's DoD: renaming a file on disk changes no chunk's citation.
create table if not exists public.documents (
  id               text        primary key,
  label            text        not null,
  file_name        text        not null,
  manufacturer     text        not null,
  doc_type         text        not null,
  coverage         text        not null default '',
  source_url       text        not null,
  license_status   text        not null,

  -- Phase 1 answer scope. Out-of-scope documents are ingested and tagged, per the
  -- brief, so retrieval precision is measured against the equipment under test
  -- rather than flattered by a corpus with the distractors removed.
  in_scope         boolean     not null default false,

  page_count       integer     not null default 0,
  usable_pages     integer     not null default 0,
  two_column_pages integer     not null default 0,
  mean_alpha_ratio real        not null default 0,

  -- S13: every document carries the disposition it was ingested under.
  disposition        text      not null default 'ingest'
                     check (disposition in ('ingest', 'ingest-with-caveat', 'excluded')),
  disposition_reason text      not null default '',

  ingested_at      timestamptz not null default now()
);

-- ===========================================================================
-- BLOCK 3 — chunks, and its indexes
-- ===========================================================================
create table if not exists public.chunks (
  id             uuid        primary key default gen_random_uuid(),
  document_id    text        not null references public.documents(id) on delete cascade,

  -- The citable unit. NOT NULL is the whole point: a page-less chunk must be
  -- rejected at write time rather than tolerated, per brief criterion 4.
  page           integer     not null check (page > 0),
  chunk_index    integer     not null,

  text           text        not null check (length(btrim(text)) > 0),

  -- Denormalised provenance, deliberately: a citation is rendered from the chunk
  -- alone, and a join that can fail is a citation that can fail.
  manufacturer   text        not null,
  doc_type       text        not null,
  coverage       text        not null default '',
  license_status text        not null,
  in_scope       boolean     not null default false,

  embedding      vector(1024),

  -- A4: usedMocks() is per-process state and Stage 5 runs in a different process
  -- than ingestion, so it can never prove a past run was stub-free. The model that
  -- produced each vector is persisted here instead, provable on a cold start.
  embedding_model text      not null default 'none',

  -- S16: idempotency. Re-ingesting replaces a document's chunks rather than
  -- duplicating them, and an unchanged chunk keeps its embedding.
  content_hash   text        not null,

  -- §3.4: build the lexical columns now, wire retrieval to them later. They cost
  -- nothing at write time and are painful to retrofit.
  --
  -- `'english'::regconfig` is not decoration. A generated column requires an
  -- IMMUTABLE expression, and an unqualified `to_tsvector('english', text)` can
  -- bind to the single-argument STABLE overload, which Postgres rejects with
  -- "generation expression is not immutable". The cast pins the two-argument form.
  tsv            tsvector    generated always as (to_tsvector('english'::regconfig, text)) stored,

  created_at     timestamptz not null default now(),
  unique (document_id, page, chunk_index)
);

create index if not exists chunks_document_idx on public.chunks (document_id);
create index if not exists chunks_scope_idx    on public.chunks (in_scope);
create index if not exists chunks_hash_idx     on public.chunks (content_hash);
create index if not exists chunks_tsv_idx      on public.chunks using gin (tsv);
create index if not exists chunks_trgm_idx     on public.chunks using gin (text gin_trgm_ops);

-- HNSW over cosine. voyage-4-large returns 1024 dims, inside pgvector's 2,000-dim
-- ceiling for `vector` — see docs/retrieval-architecture.md §3.1.
create index if not exists chunks_embedding_idx
  on public.chunks using hnsw (embedding vector_cosine_ops);

-- ===========================================================================
-- BLOCK 4 — the retrieval contract (S17) and RLS
-- ===========================================================================
-- Returns everything a citation needs and nothing that needs a second query.
create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_count     integer default 8,
  scope_only      boolean default true
)
-- Column names are prefixed rather than matching the table's exactly. A RETURNS
-- TABLE entry named `text` collides with the type name of the entries after it,
-- and one named `page` or `document_id` shadows the column it selects from — the
-- kind of failure that reports a parse error a dozen lines from its cause.
returns table (
  chunk_id        uuid,
  out_document_id text,
  out_document    text,
  out_page        integer,
  out_text        text,
  out_manufacturer text,
  out_doc_type    text,
  out_coverage    text,
  out_license     text,
  out_in_scope    boolean,
  out_similarity  real
)
language sql stable
as $$
  select c.id, c.document_id, d.label, c.page, c.text,
         c.manufacturer, c.doc_type, c.coverage, c.license_status, c.in_scope,
         (1 - (c.embedding <=> query_embedding))::real
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and (not scope_only or c.in_scope)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- The knowledge base is freely-published OEM literature, so read-for-anon is not
-- a data-exposure problem. Writes stay service-role only: ingestion runs
-- server-side, and an anon key that can write chunks can poison every citation in
-- the system.
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to anon, authenticated using (true);

drop policy if exists chunks_read on public.chunks;
create policy chunks_read on public.chunks for select to anon, authenticated using (true);

grant execute on function public.match_chunks(vector, integer, boolean)
  to anon, authenticated, service_role;
