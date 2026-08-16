/**
 * supabase.ts — the app's only Supabase client.
 *
 * Anon key only. It ships in the bundle and that is by design: it is RLS-gated.
 * The service_role key must never appear in this directory — scripts/sync-app-env.mjs
 * withholds it from app/.env so it cannot arrive here by accident.
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False when env is missing — screens degrade to a readable error, never a blank. */
export const isConfigured = Boolean(url && anonKey);

/**
 * Session persistence — ST-A02.
 *
 * React Native has no `localStorage`, so `persistSession: true` on its own is
 * inert: supabase-js needs an explicit `storage` adapter on native or it silently
 * keeps the session in memory and the technician is signed out every cold start.
 *
 * **The dependency, justified** (`CLAUDE.md` requires new ones to be):
 * `@react-native-async-storage/async-storage`, installed with `npx expo install`
 * so the version is SDK-54-correct. It is the adapter Supabase's own Expo
 * guidance uses, and it works on the web target this repo also builds — which
 * matters, because `npm run app` is `expo start --web` and a native-only adapter
 * would break it.
 *
 * `expo-secure-store` was considered and not chosen. It encrypts at rest, which
 * is better, but it has a ~2048-byte per-item limit that a Supabase session can
 * exceed — producing a failure that appears for some users and not others, which
 * is the worst kind. **The trade-off recorded rather than hidden: the session
 * token is stored unencrypted on the device.** A chunked SecureStore adapter is
 * filed in `.pipeline/backlog.md`.
 *
 * `detectSessionInUrl: false` because there is no URL to detect on native. The
 * OAuth return is handled explicitly by `app/lib/auth.ts`, which reads the tokens
 * out of the callback and calls `setSession` — one code path for every platform
 * beats two that diverge.
 */
export const supabase = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export const CONFIG_HINT =
  'Supabase env is missing. Run `npm run sync-env` at the repo root, then restart Expo.';

// --- row shapes, mirroring sql/002_prototype_sessions.sql --------------------

/**
 * The rendering contract, mirroring `messages.kind`'s CHECK constraint.
 *
 * `conversational` (F2/ST-F06) is a server-authored reply to small talk. It
 * carries **no diagnostic claim**, so it carries no citation and is legitimately
 * exempt from the cite-every-claim rule — the body is a constant in
 * `lib/conversation.mjs`, never model-authored, which is what makes that
 * exemption safe rather than a hole. Requires sql/015 on the instance, or a
 * signed-in user's insert is refused.
 */
export type MessageKind = 'user' | 'answer' | 'clarify' | 'refusal' | 'conversational';

/**
 * ST-R05 / ST-R06 — how an `answer` should be *drawn*, not what it is.
 *
 * A reference answer is an answer: cited, validated, and degradable to
 * no-documentation exactly like any other. OQ-R2 records the decision not to
 * give it its own `kind` on the wire, for two reasons that both still hold —
 * `Message.tsx`'s uncited-defect net must stay in front of it, which reusing
 * `answer` guarantees by construction; and a new kind needs a `messages.kind`
 * CHECK migration, while `sql/015` is still unapplied, so it would fail the
 * insert for every signed-in technician.
 *
 * **Deliberately not a column.** It rides on the reply and is dropped on
 * persistence, so reopening a session redraws a reference answer as a plain
 * cited answer. That is the accepted cost in OQ-R2 and it is one screen, not a
 * lost citation.
 */
export type AnswerShape = 'reference';

export type Citation = {
  id: string;
  source_document: string;
  page: number;
  claim: string | null;
  ordinal: number;
  /** M9 — the supporting passage, from the retrieved chunk (never the model).
      Absent on rows persisted before sql/006; the sheet says so rather than
      pretending. */
  snippet?: string | null;
  chunk_id?: string | null;
  /** 'exact' = the snippet IS the source text. 'fuzzy' is reserved for a future
      model-copied-span design and must render visibly differently. */
  verified?: 'exact' | 'fuzzy' | null;
};

export type Message = {
  id: string;
  session_id: string;
  kind: MessageKind;
  body: string;
  seq: number;
  citations?: Citation[];
  /**
   * ST-R06 — rendering shape for this turn, when the server sent one.
   *
   * Never read from the database and never written to it: `appendMessage`'s
   * insert names its columns explicitly, so this cannot reach a row by accident.
   * Absent on every persisted turn, which is why `Message.tsx` treats absence as
   * "draw the ordinary answer" rather than as an error. See `AnswerShape`.
   */
  shape?: AnswerShape;
};

export type Session = {
  id: string;
  title: string;
  equipment: string | null;
  created_at: string;
  updated_at: string;

  /**
   * ST-A07 / OQ-A2 — which company the technician was working under when this
   * session was created. A historical stamp, set by a database trigger and read
   * by **no policy anywhere**. It grants nothing: a company cannot see a
   * technician's sessions (OQ-A1), and this column does not change that.
   *
   * Present on rows created after sql/012; null for a solo technician.
   */
  company_id?: string | null;

  /**
   * Derived in `listSessions`, not stored. Absent when the enriched read falls
   * back — history renders without the badges rather than guessing at zero.
   */
  citationCount?: number;
  refused?: boolean;
};

// --- identity row shapes, mirroring sql/010, sql/012 and sql/013 -------------
//
// These are the contract Stage 4 builds against. The error contract that goes
// with them is in `.pipeline/03-backend-accounts.md` and in `AccountError` below.

export type TradeRole = string | null;

/** sql/010_profiles.sql. One row per auth user, created by a trigger. */
export type Profile = {
  id: string;
  display_name: string | null;
  trade_role: TradeRole;
  /** Which company stamps new sessions. Null is the normal case (brief AC 5). */
  active_company_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyRole = 'owner' | 'member';

/** sql/012_companies.sql. Readable only by members of that company. */
export type Company = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Membership = {
  id: string;
  company_id: string;
  user_id: string;
  role: CompanyRole;
  created_at: string;
};

/**
 * `public.company_roster` — the view that decides, in one place, exactly what a
 * company may see about a person (OQ-A1). Name, trade role, company role, join
 * date. Nothing about their sessions, questions, answers or citations exists on
 * it, and no policy anywhere would permit reading those if it did.
 */
export type RosterEntry = {
  /**
   * The membership row's own key. Added when CM-3 was fixed in `sql/012` — the
   * owner actions (`setMemberRole`, `removeMembership`) are keyed by it, and the
   * roster is the only screen that lists the people they act on.
   */
  membership_id: string;
  company_id: string;
  user_id: string;
  role: CompanyRole;
  joined_at: string;
  display_name: string | null;
  trade_role: TradeRole;
};

/** sql/013_join_codes.sql. Selectable only by an owner of the owning company. */
export type JoinCode = {
  id: string;
  code: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at?: string | null;
};
