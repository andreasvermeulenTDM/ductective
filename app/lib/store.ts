/**
 * store.ts — all Supabase reads and writes for the prototype.
 *
 * Kept in one file so the seam is obvious: the diagnostic *content* is mock, but
 * every function here talks to real Postgres. When Run B lands, mockReply() is
 * swapped for the real core and nothing in this file changes.
 */

import { supabase, isConfigured, type Citation, type Message, type Session } from './supabase';
import { mockReply } from './mockDiagnostics';

export class NotConfiguredError extends Error {}

function db() {
  if (!isConfigured || !supabase) throw new NotConfiguredError('Supabase not configured');
  return supabase;
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await db()
    .from('sessions')
    .select('id, title, equipment, created_at, updated_at')
    .is('user_id', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
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
    .select('id, session_id, kind, body, seq, citations(id, source_document, page, claim, ordinal)')
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
 * The reply comes from mockDiagnostics — canned text with unverified citations.
 * Replacing this one call with the Run B core is the whole of the swap.
 */
export async function submitSymptom(
  sessionId: string,
  nextSeq: number,
  input: string
): Promise<{ user: Message; reply: Message }> {
  const user = await appendMessage(sessionId, nextSeq, 'user', input);

  const mock = mockReply(input);
  const reply = await appendMessage(
    sessionId,
    nextSeq + 1,
    mock.kind,
    mock.body,
    mock.citations.map((c, i) => ({ ...c, ordinal: i + 1 }))
  );

  return { user, reply };
}
