-- 002_prototype_sessions.sql — run once, in the Supabase SQL Editor.
--
-- Session/message/citation persistence for the design prototype. This is real
-- storage: the prototype's diagnostic *content* is mock, but everything it writes
-- and reads back is genuinely in Postgres.
--
-- Scope note: this is E6.5 (session history) landing early, ahead of the pipeline,
-- because it needs no API key. It does NOT touch the knowledge base — chunks,
-- embeddings, and provenance are Stage 2.5's under brief criterion 4.

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),

  -- Nullable now, on purpose. Phase 1 is single-user, but the story map calls
  -- this out as cheap-now / expensive-later: adding it here costs nothing, and
  -- adding it after real beta data exists is a migration. E9 makes it NOT NULL
  -- and hangs per-user isolation off it.
  user_id     uuid,

  title       text        not null,
  equipment   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- `kind` is the rendering contract, not decoration. E6.4 requires an uncited
-- diagnostic claim to be unrenderable, and E5.2 requires a refusal to be visually
-- unmistakable and non-dismissible — the UI switches on this column, so the
-- database is what makes those guarantees possible.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions(id) on delete cascade,
  kind        text        not null check (kind in ('user', 'answer', 'clarify', 'refusal')),
  body        text        not null,
  seq         integer     not null,
  created_at  timestamptz not null default now(),
  unique (session_id, seq)
);

create index if not exists messages_session_seq_idx
  on public.messages (session_id, seq);

-- ---------------------------------------------------------------------------
-- citations
-- ---------------------------------------------------------------------------
-- Separate rows, not a JSON blob on the message. A citation must resolve to a
-- specific document AND page (CLAUDE.md's cite-every-claim rule), and `claim`
-- records which statement it supports — so Stage 5.5 can check that the source
-- actually says what the answer attached to it, which is the defect the eval
-- charter calls the most dangerous in the system.
create table if not exists public.citations (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid        not null references public.messages(id) on delete cascade,
  source_document  text        not null,
  page             integer     not null check (page > 0),
  claim            text,
  ordinal          integer     not null,
  created_at       timestamptz not null default now(),
  unique (message_id, ordinal)
);

create index if not exists citations_message_idx
  on public.citations (message_id);

-- ---------------------------------------------------------------------------
-- Row-level security — PROTOTYPE GRADE. Read this before shipping anything.
-- ---------------------------------------------------------------------------
-- RLS is on, and anon may only touch rows where the owning session has
-- user_id IS NULL — i.e. unclaimed prototype rows. That is deliberately not the
-- same thing as security: anyone holding the anon key can read and write these
-- rows, and the anon key ships in the app bundle.
--
-- It is structured this way so E9 replaces the predicate rather than retrofitting
-- RLS onto tables that never had it. Do not put real user data here first.
alter table public.sessions  enable row level security;
alter table public.messages  enable row level security;
alter table public.citations enable row level security;

drop policy if exists prototype_sessions_anon on public.sessions;
create policy prototype_sessions_anon on public.sessions
  for all to anon, authenticated
  using (user_id is null) with check (user_id is null);

drop policy if exists prototype_messages_anon on public.messages;
create policy prototype_messages_anon on public.messages
  for all to anon, authenticated
  using (exists (select 1 from public.sessions s
                  where s.id = messages.session_id and s.user_id is null))
  with check (exists (select 1 from public.sessions s
                  where s.id = messages.session_id and s.user_id is null));

drop policy if exists prototype_citations_anon on public.citations;
create policy prototype_citations_anon on public.citations
  for all to anon, authenticated
  using (exists (select 1 from public.messages m join public.sessions s on s.id = m.session_id
                  where m.id = citations.message_id and s.user_id is null))
  with check (exists (select 1 from public.messages m join public.sessions s on s.id = m.session_id
                  where m.id = citations.message_id and s.user_id is null));
