-- 005_provenance_columns.sql — align chunk provenance with the documented contract.
--
-- Run in the Supabase SQL Editor. Safe to re-run (every statement is guarded).
--
-- Two things, one real and one naming:
--
-- 1. REAL: `source_document` — the human-readable label — was not on the chunk.
--    025-knowledge.md claims a citation renders from the chunk alone with no
--    join to fail; that was true for manufacturer/doc_type/coverage/license and
--    FALSE for the document name itself, which lived behind the join in
--    match_chunks. This adds it, backfilled and NOT NULL, and makes the claim
--    true rather than editing the claim.
--
-- 2. NAMING: `page` → `page_number`, `coverage` → `model_coverage`. The story
--    map's contract (docs/phase1-story-map.md: "page_number NOT NULL") predates
--    the schema, and Stage 5 coded to it; sql/003 deviated silently, which
--    CLAUDE.md forbids. The schema moves, not the check.
--
-- The OUT column names of match_chunks / match_chunks_hybrid are UNCHANGED —
-- consumers (diagnose.mjs, smoke.mjs) are untouched by this migration.

set search_path = public, extensions;

-- Renames, guarded for re-runnability.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='chunks' and column_name='page') then
    alter table public.chunks rename column page to page_number;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='chunks' and column_name='coverage') then
    alter table public.chunks rename column coverage to model_coverage;
  end if;
end $$;

-- The real addition: the citable name, denormalised onto the chunk.
alter table public.chunks add column if not exists source_document text;

update public.chunks c
set source_document = d.label
from public.documents d
where d.id = c.document_id and c.source_document is null;

alter table public.chunks alter column source_document set not null;

-- Recreate both retrieval functions against the renamed columns. OUT names stay
-- exactly as they were; only internals change. source_document now comes off the
-- chunk itself — the join to documents is gone from the read path entirely.
drop function if exists public.match_chunks(vector, integer, boolean);
create function public.match_chunks(
  query_embedding vector(1024),
  match_count     integer default 8,
  scope_only      boolean default true
)
returns table (
  chunk_id         uuid,
  out_document_id  text,
  out_document     text,
  out_page         integer,
  out_text         text,
  out_manufacturer text,
  out_doc_type     text,
  out_coverage     text,
  out_license      text,
  out_in_scope     boolean,
  out_similarity   real
)
language sql stable
as $$
  select c.id, c.document_id, c.source_document, c.page_number, c.text,
         c.manufacturer, c.doc_type, c.model_coverage, c.license_status, c.in_scope,
         (1 - (c.embedding <=> query_embedding))::real
  from public.chunks c
  where c.embedding is not null
    and (not scope_only or c.in_scope)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

drop function if exists public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer);
create function public.match_chunks_hybrid(
  query_embedding  vector(1024),
  query_text       text,
  match_count      integer default 8,
  scope_only       boolean default true,
  candidates       integer default 50,
  rrf_k            integer default 60
)
returns table (
  chunk_id         uuid,
  out_document_id  text,
  out_document     text,
  out_page         integer,
  out_text         text,
  out_manufacturer text,
  out_doc_type     text,
  out_coverage     text,
  out_license      text,
  out_in_scope     boolean,
  out_similarity   real
)
language sql stable
as $$
  with q as (
    select public.to_or_tsquery(query_text) as tsq
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from public.chunks c
    where c.embedding is not null and (not scope_only or c.in_scope)
    order by c.embedding <=> query_embedding
    limit candidates
  ),
  lex as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.tsv, (select tsq from q)) desc, c.id) as rank
    from public.chunks c
    where (not scope_only or c.in_scope)
      and (select tsq from q) is not null
      and c.tsv @@ (select tsq from q)
    order by ts_rank_cd(c.tsv, (select tsq from q)) desc, c.id
    limit candidates
  ),
  fused as (
    select coalesce(v.id, l.id) as id,
           coalesce(1.0 / (rrf_k + v.rank), 0) + coalesce(1.0 / (rrf_k + l.rank), 0) as score
    from vec v full outer join lex l on l.id = v.id
  )
  select c.id, c.document_id, c.source_document, c.page_number, c.text,
         c.manufacturer, c.doc_type, c.model_coverage, c.license_status, c.in_scope,
         f.score::real
  from fused f
  join public.chunks c on c.id = f.id
  order by f.score desc, c.document_id, c.page_number
  limit match_count;
$$;

grant execute on function public.match_chunks(vector, integer, boolean)
  to anon, authenticated, service_role;
grant execute on function public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer)
  to anon, authenticated, service_role;
