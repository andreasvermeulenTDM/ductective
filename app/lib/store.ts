/**
 * store.ts — all session/message/citation access, for both routes.
 *
 * Kept in one file so the seam is obvious. There are now **two** implementations
 * behind the same exported names:
 *
 *   persisted — a signed-in technician. Real rows in Postgres, isolated to them
 *               by row-level security (sql/011), not by the filters below.
 *   guest     — nobody signed in. Real, live, cited answers (§1j) and **not one
 *               row written, ever** (OQ-A4).
 *
 * `ChatScreen` and `HistoryScreen` call the same six functions either way. That
 * is the point of the split: six call sites across two screens depend on the
 * current shape, and making them each learn about auth state would put the
 * "nothing is saved" decision in three places instead of one.
 *
 * ---------------------------------------------------------------------------
 * Two things that changed at the RLS cutover, and why
 * ---------------------------------------------------------------------------
 *  * `listSessions` no longer filters `.is('user_id', null)`. After sql/011 that
 *    filter returns zero rows for every signed-in user. It was **deleted, not
 *    adapted** — the brief is explicit that E9 replaces the prototype predicate
 *    rather than bolting something beside it.
 *  * `createSession` still inserts with no `user_id`, and that is deliberate.
 *    sql/011 sets `default auth.uid()` on the column, so the **database** stamps
 *    ownership and `with check (user_id = auth.uid())` makes forging one
 *    impossible. Ownership stopped depending on the client remembering to send
 *    it, which is what hard constraint 3 actually asks for.
 *
 * Nothing in this file enforces isolation. Every read below is permitted or
 * refused by policy. If a filter here were the only thing keeping one technician
 * out of another's jobs, that would be a defect even on the days it worked.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Citation, Message, Session } from './supabase';
// The explicit `.ts` extension is what lets `node --test` load this module at all
// (Node's ESM resolver does not guess extensions), which is what makes ST-A06
// AC 1 executable rather than a claim. Metro resolves the literal path first, so
// the device build is unaffected, and `module: preserve` in the Expo tsconfig
// base permits it.
import { mockReply } from './mockDiagnostics.ts';

export class NotConfiguredError extends Error {}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

type Client = SupabaseClient;

let persisting = false;
let clientOverride: Client | null = null;

/**
 * Tell the store who is signed in. Called by the app shell from
 * `onAuthStateChange` (see `app/lib/auth.ts`), and by nothing else.
 *
 * Defaults to **guest**, so the failure mode of forgetting to call it is "nothing
 * was saved" rather than "someone else's rows were written". Of the two ways to
 * be wrong, that is the recoverable one.
 *
 * The shell must not call the store at all while auth state is `determining`
 * (ST-A02 AC 7) — that is what `isDetermining()` in `authState.ts` is for.
 */
export function setStoreAuth(signedIn: boolean): void {
  persisting = signedIn;
}

export const isPersistingStore = (): boolean => persisting;

/**
 * Test hook for ST-A06 AC 1: inject a spy client and assert `from()` is never
 * invoked on the guest route. Exported rather than reached for through module
 * internals so the assertion the story asks for is possible without a mocking
 * framework — this repo has none and is not adding one.
 */
export function __setClientForTests(client: Client | null): void {
  clientOverride = client;
}

/**
 * The Supabase client, loaded **only when a write or read actually needs it**.
 *
 * The dynamic import is not a style choice. `supabase.ts` constructs the client
 * with an AsyncStorage adapter and `diagnose.ts` imports `react-native`, so a
 * static import of either would make this module unloadable outside a React
 * Native runtime — and then ST-A06 AC 1, "a guest issues zero calls to the
 * Supabase client", could only ever be asserted by reading the source instead of
 * by running it.
 *
 * The stronger property this buys: on the guest route the client is never even
 * *constructed*. Not "constructed and unused" — absent.
 */
async function db(): Promise<Client> {
  if (clientOverride) return clientOverride;
  const { supabase, isConfigured } = await import('./supabase');
  if (!isConfigured || !supabase) throw new NotConfiguredError('Supabase not configured');
  return supabase as Client;
}

const SESSION_COLUMNS = 'id, title, equipment, company_id, created_at, updated_at';

// ---------------------------------------------------------------------------
// The guest route — in memory, and only in memory
// ---------------------------------------------------------------------------

/**
 * The whole guest transcript. Cleared on sign-out (ST-A06 AC 10), and lost when
 * the process dies — which is the accepted downside the owner chose knowingly and
 * which the app is required to disclose *before* the first answer, not after.
 */
const guestSessions = new Map<string, Session>();
const guestMessages = new Map<string, Message[]>();
let guestSeq = 0;

/**
 * Synthetic ids so `ChatScreen`'s existing `ownSession` guard and `unanswered`
 * retry path keep working unchanged. The `guest-` prefix is not decoration: it
 * makes an id that leaked into a database call obvious in a stack trace instead
 * of looking like a uuid that merely does not exist.
 */
const guestId = (kind: string) => `guest-${kind}-${Date.now().toString(36)}-${(guestSeq += 1).toString(36)}`;

/** ST-A06 AC 10 — signing out must not leave one person's text on screen. */
export function resetGuestState(): void {
  guestSessions.clear();
  guestMessages.clear();
}

/** Exposed for the shell's mid-conversation sign-up handling (OQ-A4 sub-decision 2). */
export const guestTranscriptLength = (): number =>
  [...guestMessages.values()].reduce((n, list) => n + list.length, 0);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Sessions for the history list.
 *
 * The mockup's history rows carry a citation count and a "refused" marker so a job
 * is identifiable by what happened in it rather than by its first sentence. Neither
 * is a column on `sessions`, so this embeds the message kinds and their citation
 * ids and derives both client-side.
 *
 * This is a read-shaping adapter at the data-access boundary, not a schema change —
 * nothing in `sql/` moves. If the embed fails for any reason (an older PostgREST,
 * a policy that blocks the nested read), it falls back to the plain select and the
 * list renders without the two badges rather than erroring out.
 *
 * **A guest gets an empty list, always.** Not their in-memory conversation: the
 * History tab's job for a guest is to explain that nothing is being saved and
 * offer a way forward (OQ-A4 sub-decision 1). Showing them a list that will be
 * gone when they close the app would be the opposite of that.
 */
export async function listSessions(): Promise<Session[]> {
  if (!persisting) return [];

  const enriched = await (await db())
    .from('sessions')
    .select(`${SESSION_COLUMNS}, messages(kind, citations(id))`)
    .order('updated_at', { ascending: false });

  if (!enriched.error) {
    type Row = Session & { messages?: { kind: string; citations?: { id: string }[] }[] };
    return (enriched.data ?? []).map((row: Row) => {
      const messages = row.messages ?? [];
      const { messages: _drop, ...session } = row;
      return {
        ...session,
        citationCount: messages.reduce((n, m) => n + (m.citations?.length ?? 0), 0),
        refused: messages.some((m) => m.kind === 'refusal'),
      };
    });
  }

  const { data, error } = await (await db())
    .from('sessions')
    .select(SESSION_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Delete a job and everything under it.
 *
 * One statement: `messages` and `citations` both declare `on delete cascade`
 * (sql/002), so the database removes the turns and their citations. Deleting them
 * from the client instead would leave orphans behind on any partial failure.
 *
 * Since sql/011 the owner-keyed policy is `for all`, so DELETE is permitted for
 * the `authenticated` role on rows where `user_id = auth.uid()` — and refused
 * everywhere else. Another technician's session id, passed here, affects zero
 * rows; it does not error, and it does not delete.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  if (!persisting) {
    guestSessions.delete(sessionId);
    guestMessages.delete(sessionId);
    return;
  }
  const { error } = await (await db()).from('sessions').delete().eq('id', sessionId);
  if (error) throw new Error(error.message);
}

export async function createSession(title: string, equipment?: string | null): Promise<Session> {
  if (!persisting) {
    const now = new Date().toISOString();
    const session: Session = {
      id: guestId('session'),
      title: title.slice(0, 80),
      equipment: equipment ?? null,
      company_id: null,
      created_at: now,
      updated_at: now,
    };
    guestSessions.set(session.id, session);
    guestMessages.set(session.id, []);
    return session;
  }

  // No `user_id` here on purpose — see the header. sql/011's `default auth.uid()`
  // stamps it, and sql/012's trigger stamps `company_id` from the creator's
  // active company. Neither is accepted from the client, because a claim the
  // client makes about ownership is not a fact.
  const { data, error } = await (await db())
    .from('sessions')
    .insert({ title: title.slice(0, 80), equipment: equipment ?? null })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  if (!persisting) return [...(guestMessages.get(sessionId) ?? [])];

  const { data, error } = await (await db())
    .from('messages')
    .select('id, session_id, kind, body, seq, citations(id, source_document, page, claim, ordinal, snippet, chunk_id, verified)')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });
  if (error) throw new Error(error.message);

  // Citations arrive unordered from the join; ordinal is the rendering order.
  return (data ?? []).map((m: Message) => ({
    ...m,
    citations: [...(m.citations ?? [])].sort((a, b) => a.ordinal - b.ordinal),
  }));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function appendMessage(
  sessionId: string,
  seq: number,
  kind: Message['kind'],
  body: string,
  citations: Omit<Citation, 'id'>[] = []
): Promise<Message> {
  if (!persisting) return appendGuestMessage(sessionId, seq, kind, body, citations);

  const { data: msg, error } = await (await db())
    .from('messages')
    .insert({ session_id: sessionId, kind, body, seq })
    .select('id, session_id, kind, body, seq')
    .single();
  if (error) throw new Error(error.message);

  if (citations.length) {
    const { error: cErr } = await (await db())
      .from('citations')
      .insert(citations.map((c) => ({ ...c, message_id: msg.id })));
    // A stored answer whose citations failed to store would render as an uncited
    // claim, which E6.4 forbids. Surface it rather than showing a degraded answer.
    if (cErr) throw new Error(`Answer saved but citations failed: ${cErr.message}`);
  }

  await (await db()).from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);

  return { ...msg, citations: citations.map((c, i) => ({ ...c, id: `pending-${i}` })) };
}

/**
 * The same turn, in memory.
 *
 * Citation ids are synthesised exactly as the persisted path already does at the
 * `pending-${i}` line above, so the renderer sees a shape it has always seen. The
 * citation *content* — `source_document`, `page`, `claim`, `snippet` — is passed
 * through untouched, because `CLAUDE.md`'s cite-every-claim rule applies to a
 * guest exactly as it applies to anyone else. Nothing about being signed out
 * degrades an answer, a citation or a refusal; it degrades persistence and
 * nothing else.
 */
function appendGuestMessage(
  sessionId: string,
  seq: number,
  kind: Message['kind'],
  body: string,
  citations: Omit<Citation, 'id'>[] = []
): Message {
  const message: Message = {
    id: guestId('msg'),
    session_id: sessionId,
    kind,
    body,
    seq,
    citations: citations.map((c, i) => ({ ...c, id: `pending-${i}` })),
  };
  const list = guestMessages.get(sessionId) ?? [];
  // Replace rather than duplicate on a retry, matching the unique (session_id,
  // seq) constraint the persisted path relies on.
  const existing = list.findIndex((m) => m.seq === seq);
  if (existing >= 0) list.splice(existing, 1, message);
  else list.push(message);
  guestMessages.set(sessionId, list);

  const session = guestSessions.get(sessionId);
  if (session) guestSessions.set(sessionId, { ...session, updated_at: new Date().toISOString() });

  return message;
}

/**
 * Persist the technician's question, and nothing else.
 *
 * Separated from answering so a failed diagnosis cannot cost the question, and so
 * retrying cannot persist a second copy of it. The caller holds the returned turn
 * and asks for its answer separately.
 */
export function askQuestion(sessionId: string, seq: number, input: string): Promise<Message> {
  return appendMessage(sessionId, seq, 'user', input);
}

/**
 * Answer a question that is already saved but never got a reply.
 *
 * A failed diagnosis leaves the user's turn persisted and no answer beside it, so
 * reopening that session showed the technician their own words and nothing else —
 * indistinguishable from losing their work. This regenerates the missing reply
 * without appending a second copy of the question.
 *
 * On the guest route "already saved" means "already in state", and the retry
 * affordance still works — which matters more for a guest, not less, because the
 * reason it exists is flaky rooftop signal.
 */
export async function answerExisting(
  sessionId: string,
  replySeq: number,
  input: string,
  equipment?: string | null,
  /** Retrieval scope from the capture flow's verdict — see requestDiagnosis. */
  documentIds?: string[] | null,
  cancel?: AbortSignal,
  /** ST-17 — photos of the part, as observations. Never citable sources. */
  photos?: string[] | null
): Promise<Message> {
  const result = await generateReply(input, equipment, documentIds, cancel, photos);
  return appendMessage(sessionId, replySeq, result.kind, result.body, result.citations);
}

/**
 * The generation half, on its own.
 *
 * Split out and exported because `answerExisting` used to fuse generation with
 * persistence, and the guest route needs the first half without the second (§1i).
 * **No parameter here is derived from auth state, and none ever may be**: a
 * refusal is a refusal for a guest, a solo user, a member and an owner alike
 * (ST-A19 AC 4). The safety gate is server-side, deterministic and pre-model, and
 * nothing on this path can reach it.
 */
export async function generateReply(
  input: string,
  equipment?: string | null,
  documentIds?: string[] | null,
  cancel?: AbortSignal,
  photos?: string[] | null
) {
  // Dynamically imported for the same reason as the Supabase client above:
  // `diagnose.ts` imports `react-native` at its top, and a static import would
  // make this module unloadable under `node --test`. The env guard is a strict
  // pre-filter, not a second source of truth — `isLive` is derived from the same
  // variable and cannot be true while it is unset.
  if (process.env.EXPO_PUBLIC_DIAGNOSE_URL) {
    const { isLive, requestDiagnosis } = await import('./diagnose');
    if (isLive) return requestDiagnosis(input, equipment, cancel, documentIds, photos);
  }
  const mock = mockReply(input);
  return { ...mock, citations: mock.citations.map((c, i) => ({ ...c, ordinal: i + 1 })) };
}
