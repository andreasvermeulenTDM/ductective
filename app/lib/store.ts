/**
 * store.ts — all Supabase reads and writes for the prototype.
 *
 * Kept in one file so the seam is obvious: the diagnostic *content* is mock, but
 * every function here talks to real Postgres. When Run B lands, mockReply() is
 * swapped for the real core and nothing in this file changes.
 */

import { supabase, isConfigured, type Citation, type Message, type Session } from './supabase';
import { mockReply } from './mockDiagnostics';
import { isLive, requestDiagnosis } from './diagnose';

export class NotConfiguredError extends Error {}

function db() {
  if (!isConfigured || !supabase) throw new NotConfiguredError('Supabase not configured');
  return supabase;
}

const SESSION_COLUMNS = 'id, title, equipment, created_at, updated_at';

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
 */
export async function listSessions(): Promise<Session[]> {
  const enriched = await db()
    .from('sessions')
    .select(`${SESSION_COLUMNS}, messages(kind, citations(id))`)
    .is('user_id', null)
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

  const { data, error } = await db()
    .from('sessions')
    .select(SESSION_COLUMNS)
    .is('user_id', null)
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
 * The prototype RLS policy is `for all`, so DELETE is already permitted for the
 * anon role on `user_id is null` rows — no migration needed for this.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await db().from('sessions').delete().eq('id', sessionId);
  if (error) throw new Error(error.message);
}

export async function createSession(title: string, equipment?: string | null): Promise<Session> {
  const { data, error } = await db()
    .from('sessions')
    .insert({ title: title.slice(0, 80), equipment: equipment ?? null })
    .select('id, title, equipment, created_at, updated_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  const { data, error } = await db()
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

async function appendMessage(
  sessionId: string,
  seq: number,
  kind: Message['kind'],
  body: string,
  citations: Omit<Citation, 'id'>[] = []
): Promise<Message> {
  const { data: msg, error } = await db()
    .from('messages')
    .insert({ session_id: sessionId, kind, body, seq })
    .select('id, session_id, kind, body, seq')
    .single();
  if (error) throw new Error(error.message);

  if (citations.length) {
    const { error: cErr } = await db()
      .from('citations')
      .insert(citations.map((c) => ({ ...c, message_id: msg.id })));
    // A stored answer whose citations failed to store would render as an uncited
    // claim, which E6.4 forbids. Surface it rather than showing a degraded answer.
    if (cErr) throw new Error(`Answer saved but citations failed: ${cErr.message}`);
  }

  await db().from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);

  return { ...msg, citations: citations.map((c, i) => ({ ...c, id: `pending-${i}` })) };
}

/**
 * Submit a symptom and persist both turns.
 *
 * The reply comes from the Run B core when `EXPO_PUBLIC_DIAGNOSE_URL` is set, and
 * from mockDiagnostics when it is not — so a checkout with no backend running
 * still renders. That was the swap this file was written to accept, and nothing
 * else in it changed.
 *
 * The fallback is deliberately *not* silent-on-error: if a live core is configured
 * and fails, the error propagates to the caller's error state. Quietly serving a
 * canned answer in place of a failed real one would mean a technician reading
 * unverified text believing it came from the manual — the worst outcome available
 * here, and worse than an honest error card.
 */
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

async function generateReply(
  input: string,
  equipment?: string | null,
  documentIds?: string[] | null,
  cancel?: AbortSignal,
  photos?: string[] | null
) {
  if (isLive) return requestDiagnosis(input, equipment, cancel, documentIds, photos);
  const mock = mockReply(input);
  return { ...mock, citations: mock.citations.map((c, i) => ({ ...c, ordinal: i + 1 })) };
}
