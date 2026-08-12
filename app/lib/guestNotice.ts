/**
 * guestNotice.ts — when the "nothing is being saved" disclosure may be cleared.
 *
 * ST-F01. The owner's report was blunt: *"The account message should be removable
 * with an X or acknowledgement from the user. It is never able to be removed
 * currently."* The complication is that ST-A06 AC 6 requires that disclosure to be
 * on screen **before the first answer**, and a dismiss control a technician can
 * tap on sight would quietly undo the decision the disclosure exists to make
 * honest — guest mode keeps nothing, and the app said so before it cost you
 * anything.
 *
 * **The rule: the dismiss control does not exist until the first answer of this
 * app run has been delivered.** Not disabled — absent. A greyed-out X invites a
 * tap and teaches that the notice is an obstacle. Once an answer has landed, the
 * technician has read it on the way past, and clearing it is a receipt rather
 * than a skip.
 *
 * Three consequences, each of which is a test below rather than a convention:
 *
 *  - **An answer is any assistant turn.** `answer`, `clarify`, `refusal`,
 *    `conversational`, and an `answer` carrying no documentation all count. A
 *    refusal is an answer — that is exactly why the unit gate carries the
 *    disclosure at all (stories §1a): U7 lets the gate refuse before any unit
 *    exists.
 *  - **One state, both surfaces.** `UnitGate` and `ChatScreen` share it via
 *    `App.tsx`, so an answer taken at the gate earns dismissal on the composer and
 *    vice versa. Per-screen state would let a technician clear it on one surface
 *    and be shown it again on the other, which reads as a bug and is one.
 *  - **It does not survive the app run.** There is no persistence in this module
 *    and there is deliberately no import that could add any (ST-F01 AC 7). The
 *    disclosure warns about a loss whose boundary *is* the app run — "close the app
 *    and it is gone" — so an acknowledgement that outlived it would be an
 *    acknowledgement of a different session's loss. Owner decision on OQ-F1,
 *    10 Aug 2026: until the app closes.
 *
 * Free of React Native imports so it runs directly under `node --test`, the same
 * rule `accountCopy.ts`, `authState.ts` and `citations.ts` already follow.
 */

/** Every kind the wire can deliver. `user` is the technician's own turn. */
export type TurnKind = 'user' | 'answer' | 'clarify' | 'refusal' | 'conversational';

export type GuestNoticeState = {
  /** A signed-in technician never sees the notice, so it has no state to reach. */
  signedIn: boolean;
  /** Assistant turns delivered in this app run, across every surface. */
  answersSeen: number;
  dismissed: boolean;
};

export const INITIAL_GUEST_NOTICE: GuestNoticeState = {
  signedIn: false,
  answersSeen: 0,
  dismissed: false,
};

/**
 * Does this turn count as an answer?
 *
 * Everything that is not the technician's own words does. Written as "not user"
 * rather than as a list of assistant kinds on purpose: a kind added later
 * (`conversational` was added by this very run) counts automatically, and the
 * failure mode of forgetting to add it here would be a disclosure that never
 * becomes dismissible — annoying — rather than one that becomes dismissible
 * before an answer, which is the failure that matters.
 */
export const isAnswer = (kind: TurnKind): boolean => kind !== 'user';

/**
 * ST-F01 AC 2, 3. The whole rule, in one place, so neither screen re-derives it.
 *
 * `answersSeen === 0` → false. A signed-in technician → false, because the notice
 * is not rendered for them at all and no dismissal state should be reachable from
 * there.
 */
export function canDismiss(state: GuestNoticeState): boolean {
  if (state.signedIn) return false;
  return state.answersSeen >= 1;
}

/**
 * There is deliberately no `shouldShow(state)` helper here.
 *
 * Both screens spell the render condition out as `!signedIn && !noticeDismissed`,
 * which is what `accountUi.test.mjs` reads statically to prove the disclosure is
 * gated on auth state and the shared flag and on *nothing else* — in particular
 * not on `messages.length`. A helper would hide that condition behind a call the
 * static check cannot see through, which is how the original ST-A06 AC 6
 * regression would get back in unnoticed. `canDismiss` is the rule that needs a
 * home; "is it on screen" is two booleans and belongs where a reader is looking.
 */

/** A turn arrived. User turns do not move the counter (ST-F01 AC 4). */
export function sawTurn(state: GuestNoticeState, kind: TurnKind): GuestNoticeState {
  if (!isAnswer(kind)) return state;
  return { ...state, answersSeen: state.answersSeen + 1 };
}

/**
 * ST-F01 AC 5 — the machine proof that the disclosure is not skippable.
 *
 * A no-op when `canDismiss` is false. The guarantee is structural: there is no
 * argument, ordering or caller mistake that sets `dismissed` before an answer has
 * been delivered, because the only function that can set it checks first.
 */
export function dismiss(state: GuestNoticeState): GuestNoticeState {
  if (!canDismiss(state)) return state;
  return { ...state, dismissed: true };
}

/**
 * A different person is now holding this phone — sign-out, or a switch of
 * account. They have seen nothing, so the counter and the dismissal both go back
 * to zero. Wired to the shell's existing `lastUser` effect.
 */
export function reset(): GuestNoticeState {
  return INITIAL_GUEST_NOTICE;
}

/** Auth state changed. Signing in never counts as having seen an answer. */
export function setSignedIn(state: GuestNoticeState, signedIn: boolean): GuestNoticeState {
  if (state.signedIn === signedIn) return state;
  return { ...state, signedIn };
}
