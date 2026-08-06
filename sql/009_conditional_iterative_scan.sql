-- 009_conditional_iterative_scan.sql — relax ordering ONLY under a filter.
--
-- Run in the Supabase SQL Editor. Guarded; re-runnable. Supersedes sql/008.
--
-- sql/008 fixed the filtered-retrieval misses (R05: single-document filter → 0
-- rows) but applied relaxed_order to EVERY call, and the unfiltered smoke set
-- moved 11/14 → 10/14: R02's top-1 reordered out of the expected set. Measured,
-- not tolerated — relaxed ordering is a recall fix for selective filters, and
-- unfiltered queries never needed it.
--
-- This version sets relaxed_order only when filter_document_ids is present, so
-- unfiltered calls are byte-for-byte the pre-008 plan and filtered calls keep
-- the iterative-scan recall. Same no-superuser mechanism as 008.

set search_path = public, extensions;

-- ===========================================================================
-- match_chunks
-- ===========================================================================
drop function if exists public.match_chunks(vector, integer, boolean, text[]);
create function public.match_chunks(
  query_embedding     vector(1024),
  match_count         integer default 8,
  scope_only          boolean default true,
  filter_document_ids text[]  default null
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
language plpgsql
as $$
begin
  -- Only under a filter: relaxed_order buys recall when a selective WHERE can
  -- exhaust the index's candidate batch, and costs a little ordering fidelity —
  -- the unfiltered path keeps strict ordering (R02 regressed when it didn't).
  if filter_document_ids is not null and cardinality(filter_document_ids) > 0 then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  end if;

  return query
  select c.id, c.document_id, c.source_document, c.page_number, c.text,
         c.manufacturer, c.doc_type, c.model_coverage, c.license_status, c.in_phase1_scope,
         (1 - (c.embedding <=> query_embedding))::real
  from public.chunks c
  where c.embedding is not null
    and (not scope_only or c.in_phase1_scope)
    and (filter_document_ids is null
         or cardinality(filter_document_ids) = 0
         or c.document_id = any(filter_document_ids))
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ===========================================================================
-- match_chunks_hybrid
-- ===========================================================================
drop function if exists public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer, text[]);
create function public.match_chunks_hybrid(
  query_embedding     vector(1024),
  query_text          text,
  match_count         integer default 8,
  scope_only          boolean default true,
  candidates          integer default 50,
  rrf_k               integer default 60,
  filter_document_ids text[]  default null
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
language plpgsql
as $$
begin
  if filter_document_ids is not null and cardinality(filter_document_ids) > 0 then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  end if;

  return query
  with q as (
    select public.to_or_tsquery(query_text) as tsq
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from public.chunks c
    where c.embedding is not null
      and (not scope_only or c.in_phase1_scope)
      and (filter_document_ids is null
           or cardinality(filter_document_ids) = 0
           or c.document_id = any(filter_document_ids))
    order by c.embedding <=> query_embedding
    limit candidates
  ),
  lex as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.tsv, (select tsq from q)) desc, c.id) as rank
    from public.chunks c
    where (not scope_only or c.in_phase1_scope)
      and (filter_document_ids is null
           or cardinality(filter_document_ids) = 0
           or c.document_id = any(filter_document_ids))
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
end;
$$;

grant execute on function public.match_chunks(vector, integer, boolean, text[])
  to anon, authenticated, service_role;
grant execute on function public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer, text[])
  to anon, authenticated, service_role;
