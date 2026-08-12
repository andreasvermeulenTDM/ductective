/**
 * App.tsx — shell for the Ductective design prototype.
 *
 * Navigation is deliberately a state switch, not a router. Two tabs and an overlay
 * don't need expo-router, and Run C should pick real navigation against its own
 * brief rather than inheriting a decision made in a mockup.
 *
 * Fonts load via `useFonts` rather than the expo-font config plugin. Per the
 * SDK 57 docs the plugin is the more efficient native path, but it requires
 * `expo prebuild`; runtime loading keeps this running in Expo Go and on web,
 * which is what a design prototype needs. Run C should switch to the plugin.
 *
 * Structure follows the Run C mockup: nameplate capture is the composer's action
 * rather than a tab, because the plan treats a data plate as how you *start* a
 * question, not a place you go.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';

import { color, space, MIN_TOUCH } from './theme/tokens';
import { useLayout, SESSION_LIST_WIDTH } from './theme/layout';
import { PrototypeBanner, TabBar, NavRail, type Tab } from './components/Chrome';
import { ScalePressable } from './components/Tactile';
import { ChatScreen } from './screens/ChatScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { CaptureScreen } from './screens/CaptureScreen';
import { UnitGate } from './screens/UnitGate';
import { SignInScreen } from './screens/SignInScreen';
import { AccountScreen } from './screens/AccountScreen';
import { startAuth } from './lib/auth';
import { INITIAL_AUTH_STATE, isDetermining, nextAuthState } from './lib/authState';
import {
  INITIAL_GUEST_NOTICE,
  canDismiss,
  dismiss,
  reset as resetGuestNotice,
  sawTurn,
  setSignedIn as setNoticeSignedIn,
  type TurnKind,
} from './lib/guestNotice';

/**
 * Required once, at module scope, by `expo-auth-session`: it closes the browser
 * window the OAuth round trip opened. A no-op on native, which is where this run
 * actually runs — the redirect is `ductective://auth-callback`, a native scheme —
 * but the repo also builds for web (`npm run app`) and leaving it out is the
 * documented way to get a popup that never closes.
 */
WebBrowser.maybeCompleteAuthSession();

/**
 * The shipped lockup, not a redrawn mark.
 *
 * `brand/README.txt` picks the file by size: the no-tagline horizontal lockup is
 * specified under ~160px wide, which is where a mobile header sits. Copied into
 * assets/ because Metro's project root is app/; `brand/` stays the source of truth
 * and this is a build-time copy of it.
 */
const LOCKUP = require('./assets/lockup-horizontal-notag-dark.png');
const LOCKUP_WIDTH = 140;
const LOCKUP_ASPECT = 1884 / 416;

export default function App() {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const [tab, setTab] = useState<Tab>('chat');
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** null = not identifying a unit. Otherwise which front door is open (U2). */
  const [capture, setCapture] = useState<null | 'camera' | 'manual'>(null);
  /** The unit the next session is about, from the capture flow. */
  const [equipment, setEquipment] = useState<string | null>(null);
  /**
   * The confirmed unit's retrieval scope (`unit.documentIds` from
   * `/identify-unit`), so a camera-identified unit's diagnosis is grounded in
   * that unit's manuals only. Null when the unit was typed (no verdict) or the
   * session was reopened — the sessions table has no column for it, a filed
   * Run C gap, not silently persisted here.
   */
  const [documentIds, setDocumentIds] = useState<string[] | null>(null);
  /**
   * The confirmed unit's coverage verdict — whether we hold documentation for it,
   * and what those manuals cover. Drives the coverage line and the unit-aware
   * suggestions. Null when unknown (a reopened session, or a lookup that failed),
   * which renders as "not checked" rather than as either answer.
   */
  const [coverage, setCoverage] = useState<{ status: string | null; docs: string[] } | null>(null);
  /** A question typed at the gate, waiting for a unit to be grounded against. */
  const [carried, setCarried] = useState<string | null>(null);
  const { isTablet } = useLayout();

  /**
   * Auth — three states, and the third one is why this is a reducer.
   *
   * `nextAuthState` is Stage 3's pure transition (`lib/authState.ts`) and it has
   * exactly the shape a reducer wants, so the shell holds no auth logic of its
   * own. There is one state machine in this app and this is not a second one.
   *
   * `determining` renders as a loading state below, never as guest. A shell that
   * collapses the two shows "nothing is being saved" to a signed-in technician
   * for 200ms at every cold start — the app lying about the one thing OQ-A4
   * requires it to be honest about (ST-A02 AC 7).
   */
  const [auth, dispatch] = useReducer(nextAuthState, INITIAL_AUTH_STATE);

  /**
   * ST-F02 — the guest disclosure's dismissal, owned here and nowhere else.
   *
   * The shell holds it because **both** surfaces show the notice and they must
   * share one counter: U7 lets `UnitGate` answer with a refusal before a unit
   * exists, and a refusal is an answer. If each screen kept its own state, a
   * technician who cleared the notice at the gate would meet it again on the
   * composer, and the gate's refusal would not earn anything.
   *
   * The rule about *when* it may be cleared lives in `lib/guestNotice.ts` and is
   * unit-tested there. Nothing in this file decides it; `dismiss()` is a no-op
   * before an answer has landed, so even a wrongly-wired call site cannot make the
   * disclosure skippable.
   */
  const [guestNotice, setGuestNotice] = useState(INITIAL_GUEST_NOTICE);
  const noteAnswer = (kind: TurnKind) => setGuestNotice((s) => sawTurn(s, kind));

  useEffect(() => {
    // `startAuth` returns its unsubscribe, so returning it here *is* the cleanup
    // (ST-A02 AC 6). A leaked onAuthStateChange listener across sign-out/sign-in
    // is how stale-user bugs get in.
    return startAuth({
      onResolved: (user) => dispatch({ type: 'resolved', user }),
      onSignedIn: (user) => dispatch({ type: 'signed-in', user }),
      onSignedOut: () => dispatch({ type: 'signed-out' }),
    });
  }, []);

  /**
   * A different person is now holding this phone.
   *
   * Only fires when a *known* user is replaced (sign-out, or a switch to another
   * account) — never on the guest→signed-in transition, which OQ-A4 sub-decision
   * 2 requires to keep the transcript on screen. `store.ts` clears its own guest
   * memory on sign-out; this clears the screen state that points at it, so one
   * technician's job is not left open for the next.
   */
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (auth.phase === 'determining') return;
    const previous = lastUser.current;
    lastUser.current = auth.userId;
    // ST-F02 AC 6. A change of user means a different person is now holding this
    // phone and they have seen nothing, so the answer counter and the dismissal
    // both go back to zero — otherwise the next technician gets a screen that
    // never told them nothing is being saved. The auth flag is re-applied either
    // way, so a signed-in technician can never be holding a dismissal
    // (ST-F01 AC 3).
    const handedOver = previous !== null && previous !== auth.userId;
    if (handedOver) goHome();
    setGuestNotice((s) =>
      setNoticeSignedIn(handedOver ? resetGuestNotice() : s, auth.phase === 'signed-in')
    );
    // `goHome` only calls setState functions, which React guarantees are stable,
    // so it is deliberately not a dependency: adding it would re-run this on
    // every render and clear the screen under the technician.
  }, [auth.phase, auth.userId]);

  /** Reopening a job restores its unit; U1 forbids re-asking for one it already has. */
  function openSession(id: string, unit: string | null) {
    setSessionId(id);
    setEquipment(unit);
    setDocumentIds(null); // scope isn't persisted on the session row
    setCoverage(null);    // nor is the verdict — unknown, not "uncovered"
    setTab('chat');
  }

  /**
   * Back to a clean slate — the logo's job.
   *
   * Everything a session carries is cleared together. Clearing the unit but keeping
   * the session id (or vice versa) produces a half-state where the composer is open
   * against a job it no longer knows the unit for.
   */
  function goHome() {
    setSessionId(null);
    setEquipment(null);
    setDocumentIds(null);
    setCoverage(null);
    setCarried(null);
    setCapture(null);
    setTab('chat');
  }

  const signedIn = auth.phase === 'signed-in';
  /** Every "sign in" affordance in the app lands on the same tab. One route. */
  const goSignIn = () => setTab('account');

  const chat = (
    <ChatScreen
      sessionId={sessionId}
      onSession={setSessionId}
      onCapture={(mode) => setCapture(mode)}
      equipment={equipment}
      documentIds={documentIds}
      coverage={coverage}
      carriedQuestion={carried}
      onCarriedConsumed={() => setCarried(null)}
      signedIn={signedIn}
      onSignIn={goSignIn}
      justSignedIn={auth.justSignedIn}
      onBoundaryDrawn={() => dispatch({ type: 'boundary-acknowledged' })}
      noticeDismissed={guestNotice.dismissed}
      // Absent, not disabled, until an answer has been delivered. The predicate
      // is the single rule; this screen does not get to have an opinion.
      onDismissNotice={canDismiss(guestNotice) ? () => setGuestNotice(dismiss) : undefined}
      onAnswerDelivered={noteAnswer}
    />
  );

  /**
   * The reinstated third tab, and it has content in **both** states — which is
   * what keeps it from being the empty dead end `Chrome.tsx` dropped it for.
   * A guest gets the sign-in screen; a signed-in technician gets their profile,
   * their companies and account deletion.
   */
  const account = signedIn ? (
    <AccountScreen userId={auth.userId!} email={auth.email} />
  ) : (
    <SignInScreen onContinueAsGuest={() => setTab('chat')} />
  );

  const history = <HistoryScreen onOpen={openSession} signedIn={signedIn} onSignIn={goSignIn} />;

  /**
   * U1 — a cold start with no unit lands on unit selection, not chat.
   * A session opened from history already carries its unit, so it skips the gate.
   */
  const gate = (
    <UnitGate
      onIdentify={(mode) => setCapture(mode)}
      onCarryOver={setCarried}
      signedIn={signedIn}
      onSignIn={goSignIn}
      // U7 lets this screen answer — with a refusal — before a unit exists, so
      // the guest disclosure belongs here too (ST-A06 AC 6), and the refusal it
      // returns counts as an answer for the dismissal rule (ST-F02 AC 5).
      noticeDismissed={guestNotice.dismissed}
      onDismissNotice={canDismiss(guestNotice) ? () => setGuestNotice(dismiss) : undefined}
      onAnswerDelivered={noteAnswer}
    />
  );

  const body = capture ? (
    <CaptureScreen
      initialMode={capture}
      onDone={(unit) => {
        // The confirmed unit labels the next session, which is what makes a
        // history row identifiable by the job rather than by its first sentence.
        // Its documentIds (the coverage verdict's, verbatim) scope every
        // diagnosis in the session to that unit's manuals.
        if (unit) {
          setEquipment(unit.equipment);
          setDocumentIds(unit.documentIds);
          setCoverage({ status: unit.status ?? null, docs: unit.coverage ?? [] });
        }
        setCapture(null);
      }}
      onCancel={() => setCapture(null)}
    />
  ) : isTablet ? (
    // The account tab takes the full width — a profile form squeezed beside a
    // session list is the phone-stretched-to-width layout E6.9 forbids.
    tab === 'account' ? (
      account
    ) : (
      // Tablet: the session list keeps its width beside the answer rather than
      // being a screen you leave the conversation to reach (E6.9).
      <View style={s.split}>
        <View style={s.sessionList}>{history}</View>
        <View style={s.fill}>{equipment || sessionId ? chat : gate}</View>
      </View>
    )
  ) : tab === 'chat' ? (
    equipment || sessionId ? chat : gate
  ) : tab === 'account' ? (
    account
  ) : (
    history
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {/* Gate on fonts *and* on auth.
            Outfit is a brand requirement, and flashing a system font first is the
            parallel style CLAUDE.md warns against.
            `isDetermining` is the same idea applied to identity: until the stored
            session has been read off the device we know neither state, so we show
            neither. `isDetermining(auth)` rather than `auth.phase !== 'signed-in'`
            on purpose — the latter is the wrong check and is exactly the one that
            produces the guest flash (ST-A02 AC 7). Nothing below this gate calls
            the store, so no read happens against an auth state we do not have. */}
        {!fontsLoaded || isDetermining(auth) ? (
          <View style={s.boot}>
            <ActivityIndicator color={color.accent} />
          </View>
        ) : (
          <>
            <PrototypeBanner />

            <View style={s.shell}>
              {isTablet && !capture && (
                <NavRail
                  active={tab}
                  onChange={setTab}
                  onCapture={() => setCapture('camera')}
                />
              )}

              <View style={s.fill}>
                {!isTablet && (
                  <View style={s.header}>
                    {/* The lockup is the way home. A logo that does nothing is a
                        dead end on every screen it appears on, and this app has no
                        back affordance of its own. */}
                    <ScalePressable
                      onPress={goHome}
                      haptic="tap"
                      style={s.lockupTouch}
                      accessibilityRole="button"
                      accessibilityLabel="Ductective — start a new job"
                      accessibilityHint="Clears the current unit and question"
                    >
                      <Image
                        source={LOCKUP}
                        style={s.lockup}
                        resizeMode="contain"
                        accessibilityIgnoresInvertColors
                      />
                    </ScalePressable>
                  </View>
                )}
                {body}
              </View>
            </View>

            {!isTablet && !capture && (
              <TabBar
                active={tab}
                onChange={(t) => {
                  // Tapping Ask while already there starts a fresh job. Only
                  // History reopens an existing one — a tab tap shouldn't silently
                  // resurrect the last session.
                  if (t === 'chat' && tab === 'chat') { setSessionId(null); setEquipment(null); setDocumentIds(null); }
                  setTab(t);
                }}
              />
            )}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  fill: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1, flexDirection: 'row' },

  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  /** Real touch height around a short lockup — the image alone is ~31dp tall. */
  lockupTouch: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: MIN_TOUCH },
  lockup: { width: LOCKUP_WIDTH, height: LOCKUP_WIDTH / LOCKUP_ASPECT },

  split: { flex: 1, flexDirection: 'row' },
  sessionList: {
    width: SESSION_LIST_WIDTH,
    borderRightWidth: 1,
    borderRightColor: color.border,
  },
});
