/**
 * supabase.ts — the app's only Supabase client.
 *
 * Anon key only. It ships in the bundle and that is by design: it is RLS-gated.
 * The service_role key must never appear in this directory — scripts/sync-app-env.mjs
 * withholds it from app/.env so it cannot arrive here by accident.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False when env is missing — screens degrade to a readable error, never a blank. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null;

export const CONFIG_HINT =
  'Supabase env is missing. Run `npm run sync-env` at the repo root, then restart Expo.';

// --- row shapes, mirroring sql/002_prototype_sessions.sql --------------------

export type MessageKind = 'user' | 'answer' | 'clarify' | 'refusal';

export type Citation = {
  id: string;
  source_document: string;
  page: number;
  claim: string | null;
  ordinal: number;
};

export type Message = {
  id: string;
  session_id: string;
  kind: MessageKind;
  body: string;
  seq: number;
  citations?: Citation[];
};

export type Session = {
  id: string;
  title: string;
  equipment: string | null;
  created_at: string;
  updated_at: string;

  /**
   * Derived in `listSessions`, not stored. Absent when the enriched read falls
   * back — history renders without the badges rather than guessing at zero.
   */
  citationCount?: number;
  refused?: boolean;
};
