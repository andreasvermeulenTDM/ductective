-- 004_hybrid_retrieval.sql — S17. Reciprocal Rank Fusion over vector + lexical.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS
--
-- docs/retrieval-architecture.md §3.4 predicted this failure in advance: "HVAC
-- queries are dense with exact-match tokens that embeddings handle badly... a
-- technician typing '58MVC E4' needs lexical matching, and pure vector search will
-- cheerfully return the semantically-similar wrong manual."
--
-- The smoke set then produced exactly that. For "Trane Precedent rooftop unit
-- tripping on high head pressure", all five top hits were CARRIER manuals, with
-- similarities from 0.583 to 0.550 — a 0.03 spread across the top five, which is
-- noise rather than ranking. The right Trane content exists in the corpus; vector
-- search simply could not tell the manufacturers apart, because "high head
-- pressure on a rooftop unit" means the same thing in both manufacturers' prose.
--
-- §3.4's instruction was to build the lexical columns immediately and wire them
-- only once the smoke set showed they were needed. It has. `tsv` and the pg_trgm
-- index have been populated since 003; this only adds the ranking.
--
-- Vector-only `match_chunks` is deliberately left in place, so the two can be
-- measured against each other rather than the change being assumed to help.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- OR-semantics tsquery
-- ---------------------------------------------------------------------------
-- `plainto_tsquery` ANDs every lexeme, so a nine-word technician sentence matches
-- almost nothing — near-zero recall, and the fusion would degrade to vector-only
-- while looking like it was working. ORing the terms lets ts_rank_cd do the real
-- work: a chunk matching both "trane" and "precedent" outranks one matching
-- neither, which is precisely the signal the embedding was missing.
create or replace function public.to_or_tsquery(q text)
returns tsquery
language sql immutable
as $$
  select case
    when btrim(coalesce(q, '')) = '' then null::tsquery
    else nullif(replace(plainto_tsquery('english'::regconfig, q)::text, ' & ', ' | '), '')::tsquery
  end;
$$;

-- ---------------------------------------------------------------------------
-- Hybrid retrieval
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks_hybrid(
  query_embedding  vector(1024),
  query_text       text,
  match_count      integer default 8,
  scope_only       boolean default true,
  -- Candidates per arm before fusion. Deeper than match_count on purpose: a
  -- result ranked 30th by vector and 2nd lexically is exactly what fusion is for,
  -- and it cannot rescue what neither arm retrieved.
  candidates       integer default 50,
  -- Standard RRF damping. Large enough that no single arm's top hit dominates,
  -- small enough that rank still matters.
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
    where c.embedding is not null
      and (not scope_only or c.in_scope)
    order by c.embedding <=> query_embedding
    limit candidates
  ),
  lex as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.tsv, (select tsq from q)) desc, c.id
           ) as rank
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
    from vec v
    full outer join lex l on l.id = v.id
  )
  select c.id, c.document_id, d.label, c.page, c.text,
         c.manufacturer, c.doc_type, c.coverage, c.license_status, c.in_scope,
         f.score::real
  from fused f
  join public.chunks c    on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.document_id, c.page
  limit match_count;
$$;

grant execute on function public.to_or_tsquery(text) to anon, authenticated, service_role;
grant execute on function public.match_chunks_hybrid(vector, text, integer, boolean, integer, integer)
  to anon, authenticated, service_role;
