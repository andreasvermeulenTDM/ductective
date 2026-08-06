-- 006_citation_snippet.sql — M9 (persist the verified snippet) + the parked
-- in_phase1_scope rename. Run in the Supabase SQL Editor. Guarded; re-runnable.
--
-- M9: the supporting passage is stored on the citation, so tapping one shows the
-- text without the source PDF on the device. In the current core the snippet is
-- the retrieved chunk's text — it comes from the database, never from the model,
-- so its provenance is stronger than the migration stories assumed when they
-- planned for model-copied spans: `verified = 'exact'` because the text IS the
-- source, not a copy that survived comparison against it.
--
-- Also renames chunks.in_scope → in_phase1_scope, the vocabulary the story map
-- and Stage 5 checks use — the last of the naming drifts sql/003 introduced.
-- documents.in_scope keeps its name: no contract references it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- BLOCK 1 — citations gain the snippet (M9)
-- ---------------------------------------------------------------------------
alter table public.citations add column if not exists snippet  text;
alter table public.citations add column if not exists chunk_id uuid;

do $$
begin
  if not exists (select 1 from information_schema.constraint_column_usage
                 where table_schema='public' and constraint_name='citations_verified_check') then
    alter table public.citations add column if not exists verified text;
    alter table public.citations
      add constraint citations_verified_check
      check (verified is null or verified in ('exact', 'fuzzy'));
  end if;
end $$;

-- Nullable on purpose: rows persisted before this migration have no snippet, and
-- the UI treats their absence as "passage unavailable" rather than an error.

-- ---------------------------------------------------------------------------
-- BLOCK 2 — the scope rename, and the functions that read it
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='chunks' and column_name='in_scope') then
    alter table public.chunks rename column in_scope to in_phase1_scope;
  end if;
end $$;

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
         c.manufacturer, c.doc_type, c.model_coverage, c.license_status, c.in_phase1_scope,
         (1 - (c.embedding <=> query_embedding))::real
  from public.chunks c
  where c.embedding is not null
    and (not scope_only or c.in_phase1_scope)
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
    where c.embedding is not null and (not scope_only or c.in_phase1_scope)
    order by c.embedding <=> query_embedding
    limit candidates
  ),
  lex as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.tsv, (select tsq from q)) desc, c.id) as rank
    from public.chunks c
    where (not scope_only or c.in_phase1_scope)
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
         c.manufacturer, c.doc_type, c.model_coverage, c.license_status, c.in_phase1_scope,
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
