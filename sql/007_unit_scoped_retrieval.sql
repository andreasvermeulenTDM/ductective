-- 007_unit_scoped_retrieval.sql — R1 / ST-03. One optional document filter on
-- both match functions, so retrieval for an identified unit never surfaces
-- another manufacturer's manual.
--
-- Run in the Supabase SQL Editor. Safe to re-run: functions are dropped by
-- explicit signature before recreation, and grants are re-issued.
--
-- WHY THIS EXISTS (.pipeline/R1-unit-scoped-retrieval.md)
--
-- U5's acceptance is that no answer in a session cites a document outside its
-- unit's coverage. Backend cannot deliver that client-side: filtering after the
-- fact happens after `limit match_count`, so a Trane-scoped session whose top 8
-- are all Carrier documents gets zero results, not the best Trane ones. The
-- measured live failure: the Trane Precedent query returns an answer whose 3 of
-- 4 citations are Carrier manuals, every one resolving to a real page — no
-- citation check catches it. The filter has to sit inside the query, before the
-- limit. That is the whole change.
--
-- SEMANTICS
--
--   filter_document_ids text[] default null
--
-- * Document ids are TEXT (`doc_<sha16>`, sql/003 — derived from SourceURL),
--   NOT uuid. The array type matches `chunks.document_id`.
-- * `null` — and, per ST-03's acceptance, an EMPTY array — mean "no filter":
--   every existing caller (smoke set, Stage 5, the current diagnose path) is
--   unaffected. Callers must never pass `[]` to mean "this unit has no
--   documents"; that case is Backend's to catch before the RPC (ST-04's
--   fail-closed rule), because here it would silently mean unscoped.
-- * Non-empty — chunks are restricted to those documents, COMPOSED with
--   scope_only (AND, not replacing it): unit scope and Phase-1 scope are
--   different filters and stay separable (R1 §"Not requested, deliberately").
-- * The filter is applied in `match_chunks`'s WHERE clause and in BOTH the
--   `vec` and `lex` arms of `match_chunks_hybrid` — filtering one arm would
--   let the other reintroduce the contamination through the fusion.
--
-- CONVENTIONS THIS FILE IS WRITTEN AGAINST (research risk 5 — live names, not
-- sql/003's): chunks.page_number, chunks.model_coverage, chunks.in_phase1_scope,
-- chunks.source_document (all renamed/added by sql/005 + sql/006). The OUT
-- column names stay exactly as shipped (`out_*`-prefixed) so no consumer moves.
--
-- THE PGRST203 GOTCHA: `create or replace` with a new defaulted parameter
-- leaves the old signature behind as a separate overload, and PostgREST then
-- refuses to choose ("Could not choose the best candidate function"). So the
-- prior signatures are dropped explicitly first, and the new ones too, for
-- re-runnability.

set search_path = public, extensions;

-- ===========================================================================
-- BLOCK 1 — match_chunks (vector-only, the production default)
-- ===========================================================================
drop function if exists public.match_chunks(vector, integer, boolean);
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
language sql stable
as $$
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
$$;

-- ===========================================================================
-- BLOCK 2 — match_chunks_hybrid (opt-in RRF; filter in BOTH arms)
-- ===========================================================================
drop function if exists public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer);
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
language sql stable
as $$
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
$$;

-- ===========================================================================
-- BLOCK 3 — grants (re-issued: a dropped function's grants die with it)
-- ===========================================================================
grant execute on function public.match_chunks(vector, integer, boolean, text[])
  to anon, authenticated, service_role;
grant execute on function public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer, text[])
  to anon, authenticated, service_role;
