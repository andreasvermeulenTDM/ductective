/**
 * authState.ts — the three states the app may be in, and nothing else.
 *
 * ST-A02 AC 7. There are **three** auth states, not two, and the third one is the
 * whole reason this file exists:
 *
 *   determining — a stored session is being read off the device. We do not know
 *                 yet. Render neither of the other two.
 *   guest       — nobody is signed in. Real answers, nothing saved (OQ-A4).
 *   signed-in   — a user, with history.
 *
 * A shell that renders `guest` while the stored session is still loading shows
 * "nothing is saved while you are signed out" to a signed-in technician, for
 * 200ms, at **every cold start**. That is the app telling a lie about the one
 * thing OQ-A4 requires it to be honest about. Collapsing `determining` into
 * `guest` is the natural shortcut and it is the specific bug this state machine
 * exists to make impossible.
 *
 * Deliberately free of imports so it can be unit-tested directly under
 * `node --test` (Node strips the types on import). It holds no client, does no
 * I/O, and knows nothing about Supabase.
 */

export type AuthPhase = 'determining' | 'guest' | 'signed-in';

export type AuthState = {
  phase: AuthPhase;
  userId: string | null;
  email: string | null;
  /**
   * True for exactly one transition: guest → signed-in while a conversation is
   * on screen. OQ-A4 sub-decision 2 says the visible transcript is **retained**
   * and **not** back-filled, and that the boundary is marked (*saved from here*).
   * The store needs to know a boundary happened; the screen needs to draw it.
   */
  justSignedIn: boolean;
};

export const INITIAL_AUTH_STATE: AuthState = {
  phase: 'determining',
  userId: null,
  email: null,
  justSignedIn: false,
};

export type AuthEvent =
  /** The stored-session read finished. `user` is null when there was none. */
  | { type: 'resolved'; user: { id: string; email?: string | null } | null }
  /** onAuthStateChange delivered a session. */
  | { type: 'signed-in'; user: { id: string; email?: string | null } }
  | { type: 'signed-out' }
  /** The shell has drawn the boundary marker; stop reporting it. */
  | { type: 'boundary-acknowledged' };

/**
 * Pure transition. The only way to leave `determining` is `resolved`, so a
 * spurious `signed-out` during startup cannot flash the guest state.
 */
export function nextAuthState(prev: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case 'resolved':
      return event.user
        ? { phase: 'signed-in', userId: event.user.id, email: event.user.email ?? null, justSignedIn: false }
        : { phase: 'guest', userId: null, email: null, justSignedIn: false };

    case 'signed-in':
      // Same user again (a token refresh) is not a sign-in and must not re-mark
      // the transcript — a refresh happens roughly hourly and would otherwise
      // scatter "saved from here" markers through a long job.
      if (prev.phase === 'signed-in' && prev.userId === event.user.id) {
        return { ...prev, email: event.user.email ?? prev.email };
      }
      return {
        phase: 'signed-in',
        userId: event.user.id,
        email: event.user.email ?? null,
        // Only a guest→signed-in transition marks a boundary. Arriving here from
        // `determining` is a cold start, where there is no transcript to split.
        justSignedIn: prev.phase === 'guest',
      };

    case 'signed-out':
      if (prev.phase === 'determining') return prev;
      return { phase: 'guest', userId: null, email: null, justSignedIn: false };

    case 'boundary-acknowledged':
      return prev.justSignedIn ? { ...prev, justSignedIn: false } : prev;

    default:
      return prev;
  }
}

/** True when the store should persist. The single decision point for the seam. */
export const isPersisting = (s: AuthState): boolean => s.phase === 'signed-in';

/**
 * True when the shell should render a loading state rather than either mode.
 * Exported so a screen cannot get the check subtly wrong (`!== 'signed-in'`
 * would be the wrong check, and is the one that produces the flash).
 */
export const isDetermining = (s: AuthState): boolean => s.phase === 'determining';
