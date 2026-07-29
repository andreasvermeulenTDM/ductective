-- 001_bootstrap.sql — run once, in the Supabase SQL Editor.
--
-- Deliberately minimal. This does NOT create the knowledge-base schema: chunks,
-- provenance columns, and indexes belong to the Knowledge agent (Stage 2.5) and
-- are specified in .pipeline/00-brief.md criterion 4. This file only enables
-- pgvector and installs a health probe so connection state is verifiable from
-- code instead of by hand.

-- pgvector, in Supabase's conventional `extensions` schema.
create extension if not exists vector with schema extensions;

-- Health probe. Returns environment facts the verifier can assert against.
-- security definer so it can read pg_extension; search_path pinned to stop
-- search-path injection, which is the standard hazard with definer functions.
create or replace function public.ductective_health()
returns json
language sql
security definer
set search_path = public, extensions, pg_catalog
as $$
  select json_build_object(
    'postgres',      current_setting('server_version'),
    'pgvector',      (select extversion from pg_extension where extname = 'vector'),
    'public_tables', (select count(*) from information_schema.tables
                       where table_schema = 'public' and table_type = 'BASE TABLE'),
    'checked_at',    now()
  );
$$;

-- Service-role only. The probe reports server internals; the anon key ships in
-- the app bundle and must not be able to call it.
revoke execute on function public.ductective_health() from public, anon, authenticated;
grant execute on function public.ductective_health() to service_role;
