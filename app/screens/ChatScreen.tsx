import { Fragment, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { launchImageLibraryAsync, launchCameraAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { resizeTarget, base64Bytes, MAX_UPLOAD_BYTES, MAX_PHOTOS_PER_TURN } from '../lib/identify';
import { color, type, space, radius, MIN_TOUCH, touchSlop } from '../theme/tokens';
import { ScalePressable, fireHaptic } from '../components/Tactile';
import { ConversationSkeleton } from '../components/Skeleton';
import { useLayout } from '../theme/layout';
import { Message as MessageView } from '../components/Message';
import { ErrorState, GuestNotice, OfflineNotice, SavedFromHere, SessionHeader } from '../components/Chrome';
import { CitationSheet, SourcePanel } from '../components/Citation';
import { looksOffline } from '../lib/net';
import {
  coverageStatement,
  NOTHING_TO_SUGGEST_INVITATION,
  type DocumentSuggestion,
} from '../lib/starters';
import { answerExisting, askQuestion, createSession, loadMessages } from '../lib/store';
import { DiagnoseError, requestUnitSuggestions } from '../lib/diagnose';
import { isConfigured, CONFIG_HINT, type Citation, type Message } from '../lib/supabase';

/**
 * The send button sits inside the input pill, so it can't be 48dp of ink without
 * making the composer tower. It gets there via `touchSlop` instead — E6.7's floor
 * is on the target, not the pixels.
 */
const SEND_SIZE = 40;


/**
 * What to show a technician when a request fails.
 *
 * `DiagnoseError` carries the provider's raw text for logs; `userMessage` is the
 * part meant for a person. Anything else falls back to its own message, which for
 * Supabase and network errors is already short and readable.
 */
function friendlyError(e: Error): string {
  if (e instanceof DiagnoseError) return e.userMessage;
  return e.message;
}

export function ChatScreen({
  sessionId,
  onSession,
  onCapture,
  equipment,
  documentIds,
  coverage,
  carriedQuestion,
  onCarriedConsumed,
  signedIn,
  onSignIn,
  justSignedIn,
  onBoundaryDrawn,
  noticeDismissed,
  onDismissNotice,
  onAnswerDelivered,
}: {
  sessionId: string | null;
  onSession: (id: string) => void;
  onCapture: (mode: 'camera' | 'manual') => void;
  equipment?: string | null;
  /** Persisting or not. Drives the disclosure only — the store owns the decision. */
  signedIn?: boolean;
  onSignIn?: () => void;
  /**
   * True for exactly one transition, guest → signed-in, from the shell's auth
   * state machine. OQ-A4 sub-decision 2: keep the transcript, back-fill nothing,
   * and mark the split.
   */
  justSignedIn?: boolean;
  onBoundaryDrawn?: () => void;
  /**
   * ST-F02 — the guest disclosure's dismissal, owned by `App.tsx` and shared
   * with `UnitGate`. This screen holds no `useState` for it, deliberately: the
   * gate can answer too (U7's refusal), and one counter across both surfaces is
   * what makes "an answer earns the dismissal" mean the same thing on each.
   */
  noticeDismissed?: boolean;
  /** Absent until an answer has been delivered — see `lib/guestNotice.ts`. */
  onDismissNotice?: () => void;
  /** Every assistant turn this screen renders, reported once, as it lands. */
  onAnswerDelivered?: (kind: Message['kind']) => void;
  /** The unit's coverage verdict, for the "do we have this unit" line. */
  coverage?: { status: string | null; docs: string[] } | null;
  /**
   * The confirmed unit's retrieval scope, from the capture flow's coverage
   * verdict. Null for manually-typed units and reopened sessions (the row
   * doesn't persist it) — the server then gates on `equipment` alone.
   */
  documentIds?: string[] | null;
  /** A question typed at the unit gate, resumed once a unit exists (U1). */
  carriedQuestion?: string | null;
  onCarriedConsumed?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [offline, setOffline] = useState(false);
  const [citation, setCitation] = useState<Citation | null>(null);
  /**
   * ST-17 — a photo of the part, attached to the next question.
   *
   * Held beside the composer rather than sent on capture, so the technician can say
   * what they are showing me. A photo with no words is a guessing game; the pairing
   * is the point.
   */
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);
  const { canShowSourceBeside } = useLayout();

  /**
   * Sessions this screen created itself, which must never be re-fetched.
   *
   * The device test showed a tapped suggestion appearing twice. The cause is a race,
   * not a double tap: sending the first message creates a session and calls
   * `onSession(id)`, which changes the `sessionId` prop, which fires the load effect
   * below — so the optimistic turn already in state and the same row read back from
   * Postgres both render. Marking a locally-created id here makes the effect skip a
   * session whose messages we are already holding.
   */
  const ownSession = useRef<string | null>(null);

  /**
   * Where the *saved from here* rule is drawn — an index into `messages`, or null
   * when no boundary happened in this conversation (ST-A06 AC 9).
   */
  const [boundaryAt, setBoundaryAt] = useState<number | null>(null);

  /**
   * True when `sessionId` still points at the in-memory guest session the
   * technician was using before they signed in.
   *
   * That id is not a database row and never will be: OQ-A4 rules out
   * back-filling. So the next question must start a **real** session rather than
   * writing into a uuid that does not exist. Detaching is how "the next question
   * creates a real persisted session containing only from that point"
   * (ST-A06 AC 8) is true without the visible transcript being destroyed.
   */
  const detached = useRef(false);

  /**
   * How many visible turns belong to the *previous* (unsaved) transcript.
   *
   * `seq` is per-session and the persisted path relies on `unique (session_id,
   * seq)`. After a boundary the visible list is longer than the new session, so
   * seq counts from here rather than from the top of the screen. Zero in every
   * ordinary conversation, which is why nothing else changed.
   */
  const seqBase = useRef(0);

  function resetTranscriptMarkers() {
    setBoundaryAt(null);
    detached.current = false;
    seqBase.current = 0;
  }

  useEffect(() => {
    if (!sessionId) { setMessages([]); resetTranscriptMarkers(); return; }
    if (ownSession.current === sessionId) return; // ours; state is already correct
    resetTranscriptMarkers();
    setLoading(true);
    loadMessages(sessionId)
      .then((m) => { setMessages(m); setOffline(false); })
      .catch((e) => { setError(e); setOffline(looksOffline(e)); })
      .finally(() => setLoading(false));
  }, [sessionId]);

  /**
   * Signed in mid-conversation.
   *
   * Three things happen and no fourth: the split is marked, the guest session is
   * detached so nothing writes into it, and the shell is told the marker is drawn
   * so a later token refresh does not re-mark. Clearing the screen was considered
   * and rejected upstream as punitive — destroying visible work to reward making
   * an account teaches the wrong lesson. Back-filling was rejected as the exact
   * migration the owner ruled out.
   */
  const boundaryDrawn = useRef(false);
  useEffect(() => {
    if (!justSignedIn) { boundaryDrawn.current = false; return; }
    // `onBoundaryDrawn` is a fresh closure every render, so this effect re-runs
    // freely. The ref is what makes the work happen exactly once per transition.
    if (boundaryDrawn.current) return;
    boundaryDrawn.current = true;
    if (messages.length > 0) setBoundaryAt(messages.length);
    seqBase.current = messages.length;
    if (sessionId) detached.current = true;
    onBoundaryDrawn?.();
  }, [justSignedIn, sessionId, messages.length, onBoundaryDrawn]);

  useEffect(() => {
    if (!carriedQuestion) return;
    setInput(carriedQuestion);
    onCarriedConsumed?.();
  }, [carriedQuestion, onCarriedConsumed]);

  /** A visible clock while waiting. Ten silent seconds reads as a hang. */
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  /**
   * A question that was saved but never answered — the tail of a failed request.
   * Without this, reopening that session showed the technician their own words and
   * an empty screen, which reads as lost work rather than a retryable failure.
   */
  const unanswered =
    messages.length > 0 && messages[messages.length - 1].kind === 'user'
      ? messages[messages.length - 1]
      : null;

  function cancel() {
    abort.current?.abort();
  }

  /**
   * Synchronous re-entry guard. `busy` is state, and state is async: the device
   * test produced a double submission because onSubmitEditing and the send
   * button's onPress both fired in the same tick, and both read `busy === false`
   * before the first setBusy(true) ever rendered. A ref flips synchronously, so
   * the second caller sees it.
   */
  const sending = useRef(false);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setInput('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      // A detached id belongs to the pre-sign-in guest transcript and is not a
      // row. Treating it as absent is what makes the next question start a real
      // session while the turns above it stay on screen, unsaved (ST-A06 AC 8).
      let sid = detached.current ? null : sessionId;
      if (!sid) {
        const created = await createSession(body, equipment);
        sid = created.id;
        detached.current = false;
        // Claim it before publishing the id, so the load effect that the prop
        // change triggers sees the mark and leaves our optimistic turns alone.
        ownSession.current = sid;
        onSession(sid);
      }
      // Two steps, not one: the question is persisted and shown before the answer
      // is attempted, so a failure leaves a visible turn with a retry beside it
      // rather than a saved-but-invisible question. Retrying then regenerates only
      // the reply — asking again as a whole would persist a duplicate question.
      const seq = messages.length - seqBase.current;
      const user = await askQuestion(sid, seq, body);
      setMessages((prev) => [...prev, user]);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

      const attached = photos;
      setPhotos([]); // consumed by this turn, whatever the outcome
      const reply = await answerExisting(
        sid, seq + 1, body, equipment, documentIds, controller.signal, attached.map((p) => p.base64)
      );
      if (reply.kind === 'refusal') void fireHaptic('warning');
      setMessages((prev) => [...prev, reply]);
      // ST-F02 AC 5 — every assistant kind counts, including a refusal and the
      // conversational reply. Reported here rather than derived from
      // `messages.length`, which would count the technician's own turns too.
      onAnswerDelivered?.(reply.kind);
      setOffline(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // A cancel is the technician's own decision, not a failure to report.
      if (err.name !== 'DiagnoseCancelled') {
        setError(err);
        setOffline(looksOffline(err));
      }
    } finally {
      abort.current = null;
      sending.current = false;
      setBusy(false);
    }
  }

  /**
   * Resize and encode one picked asset, using the same path the nameplate flow
   * uses (`ImageManipulator.manipulate` — SDK 54's current API, not the deprecated
   * `manipulateAsync`). Shipping a 4 MB capture over rooftop LTE that the server
   * downscales anyway is a latency bug the technician pays for twice.
   */
  async function encodeAsset(uri: string, width: number, height: number) {
    const target = resizeTarget(width, height);
    let context = ImageManipulator.manipulate(uri);
    if (target.resize) context = context.resize({ width: target.width });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    if (!saved.base64) throw new Error("Couldn't encode that photo.");
    if (base64Bytes(saved.base64) > MAX_UPLOAD_BYTES) {
      throw new Error('That photo is too large to send even after resizing.');
    }
    return { uri: saved.uri, base64: saved.base64 };
  }

  /**
   * Attach photos of what the technician is looking at (ST-17).
   *
   * Both doors: the library (the owner's word was "upload", and a tech has usually
   * already shot the panel before they think to ask) and the camera for something
   * in front of them right now. Multi-select on the library path, because a fault is
   * often two pictures — the board's code and the component it points at — and
   * making that two round trips loses the pairing that makes them useful.
   */
  async function attachPhotos(source: 'library' | 'camera') {
    if (attaching || busy) return;
    const room = MAX_PHOTOS_PER_TURN - photos.length;
    if (room <= 0) {
      setError(new Error(`That's the limit of ${MAX_PHOTOS_PER_TURN} photos for one question.`));
      return;
    }
    setAttaching(true);
    try {
      const picked =
        source === 'camera'
          ? await (async () => {
              const perm = await requestCameraPermissionsAsync();
              if (!perm.granted) throw new Error('Camera access is off for Ductective. Turn it on in Settings.');
              return launchCameraAsync({ quality: 1, exif: false });
            })()
          : await launchImageLibraryAsync({
              mediaTypes: 'images',
              quality: 1,
              allowsMultipleSelection: true,
              selectionLimit: room,
            });

      if (picked.canceled || !picked.assets?.length) return;

      const encoded: { uri: string; base64: string }[] = [];
      for (const a of picked.assets.slice(0, room)) {
        encoded.push(await encodeAsset(a.uri, a.width ?? 0, a.height ?? 0));
      }
      void fireHaptic(source === 'camera' ? 'shutter' : 'tap');
      setPhotos((prev) => [...prev, ...encoded].slice(0, MAX_PHOTOS_PER_TURN));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setAttaching(false);
    }
  }

  /** Which door — asked only when both are available. */
  function choosePhotoSource() {
    if (attaching || busy) return;
    Alert.alert('Add a photo', 'Show me what you are looking at.', [
      { text: 'Choose from library', onPress: () => attachPhotos('library') },
      { text: 'Take a photo', onPress: () => attachPhotos('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /** Regenerate the missing reply for an already-saved question. */
  async function answerUnanswered() {
    if (!sessionId || !unanswered || busy) return;
    /**
     * The unanswered turn is on the guest side of a boundary, so there is no row
     * to attach a reply to and never will be. Re-asking is the honest repair: it
     * starts the real session the sign-in earned and puts both the question and
     * its answer in it. Regenerating in place would write an answer with no
     * question above it.
     */
    if (detached.current) { void send(unanswered.body); return; }
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const reply = await answerExisting(
        sessionId, unanswered.seq + 1, unanswered.body, equipment, documentIds, controller.signal
      );
      if (reply.kind === 'refusal') void fireHaptic('warning');
      setMessages((prev) => [...prev, reply]);
      onAnswerDelivered?.(reply.kind);
      setOffline(false);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name !== 'DiagnoseCancelled') {
        setError(err);
        setOffline(looksOffline(err));
      }
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return <ErrorState title="Not connected" detail={CONFIG_HINT} />;
  }

  const conversation = (
    <ScrollView ref={scroller} style={s.fill} contentContainerStyle={s.scroll}>
      {messages.length === 0 ? (
        // ST-R16 AC 7 — `documentIds` is the same scope the composer sends with,
        // passed down so the lookup and the answer are grounded in one array. A
        // tapped chip goes through `send`, which reads `documentIds` from this
        // screen: the scope is never re-derived from the suggestion.
        <EmptyAsk
          onPick={(sug) => send(sug)}
          onIdentify={onCapture}
          equipment={equipment}
          documentIds={documentIds}
          coverage={coverage}
        />
      ) : (
        messages.map((m, i) => (
          <Fragment key={m.id}>
            {/* The rule is drawn between turns, so it reads as a point in time
                rather than as a label on a message. */}
            {boundaryAt === i && <SavedFromHere />}
            {/* ST-R06: `shape` is passed through, never derived. The screen has
                no opinion about what a reference answer is, and `undefined` on a
                turn reopened from history is the documented OQ-R2 cost — not a
                case to reconstruct here. */}
            <MessageView
              kind={m.kind}
              body={m.body}
              citations={m.citations}
              shape={m.shape}
              onCitationPress={setCitation}
            />
          </Fragment>
        ))
      )}

      {/* Signed in with the transcript already complete: the boundary sits at the
          end, and nothing below it is saved yet either — the next question is
          what starts the real session. */}
      {boundaryAt !== null && boundaryAt === messages.length && <SavedFromHere />}

      {busy && (
        <View style={s.working}>
          <Text style={s.thinking}>
            {/* Stage labels follow the real pipeline (retrieval completes ~1s in
                per meta.latency; generation is the rest). Client-paced for now —
                Run C's streaming transport replaces this with real events. */}
            {elapsed < 2
              ? `Searching ${equipment ? `the ${equipment} manuals` : 'the knowledge base'}…`
              : elapsed < 5
                ? 'Reading the sections that match…'
                : `Writing the steps… · ${elapsed}s`}
          </Text>
          {elapsed >= 5 && (
            <>
              <Text style={s.workingHint}>
                Reading the manuals takes a moment. It's still going.
              </Text>
              <Pressable
                onPress={cancel}
                style={({ pressed }) => [s.secondaryAction, pressed && s.secondaryPressed]}
                accessibilityRole="button"
                accessibilityLabel="Stop waiting for this answer"
              >
                <Text style={s.secondaryActionText}>Stop</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* A saved question with no answer beside it. Offered as a retry rather than
          left as a blank screen the technician has to interpret. */}
      {!busy && unanswered && !error && (
        <View style={s.inlineError}>
          <Text style={s.inlineErrorText}>This one never got answered</Text>
          <Text style={s.inlineErrorHint}>
            The request failed before a reply came back. Your question is saved — ask
            it again and nothing is lost.
          </Text>
          <Pressable
            onPress={answerUnanswered}
            style={({ pressed }) => [s.retry, pressed && s.retryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Answer this question now"
          >
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {error && !offline && (
        <View style={s.inlineError}>
          <Text style={s.inlineErrorText}>The answer didn't come back</Text>
          {/* The provider's own words are 600 characters of JSON naming the vendor
              and linking to a billing console. Unactionable on a roof, and on a
              safety tool it reads as broken rather than busy. */}
          <Text style={s.inlineErrorDetail}>{friendlyError(error)}</Text>
          <Text style={s.inlineErrorHint}>
            Nothing partial has been kept — a half answer isn't worth acting on. Your
            question is still in the box.
          </Text>
          <Pressable
            onPress={() => (unanswered ? answerUnanswered() : send(input))}
            disabled={!unanswered && !input.trim()}
            style={({ pressed }) => [
              s.retry,
              pressed && s.retryPressed,
              !unanswered && !input.trim() && s.retryDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Try the question again"
          >
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {offline && <OfflineNotice />}

      {(equipment || messages.length > 0) && (
        <SessionHeader
          title={messages[0]?.body ?? 'No question yet'}
          equipment={equipment}
          offline={offline}
        />
      )}

      {loading ? (
        <ConversationSkeleton />
      ) : canShowSourceBeside ? (
        <View style={s.split}>
          <View style={s.fill}>{conversation}</View>
          <SourcePanel citation={citation} onClose={() => setCitation(null)} />
        </View>
      ) : (
        conversation
      )}

      {/*
        ST-A06 AC 6 — **before the first answer, not after.**

        It sits above the composer rather than inside the empty state because an
        empty state is gone the moment the first question is sent, and this has to
        still be true on the tenth. It is rendered for a guest in every state of
        this screen — no question yet, mid-conversation, after an error — so there
        is no path to an answer that does not pass it first.

        Above the unit gate notice deliberately: what you are about to lose
        outranks which unit you are asking about.

        ST-F02 adds one term and only one: `!noticeDismissed`, the shared flag
        from the shell. It is deliberately **not** gated on `messages.length` —
        that was the original ST-A06 AC 6 failure, and it would make the
        disclosure vanish on the first question rather than after the technician
        has read it and cleared it themselves.
      */}
      {!signedIn && !noticeDismissed && (
        <View style={s.guestWrap}>
          <GuestNotice onSignIn={() => onSignIn?.()} onDismiss={onDismissNotice} />
        </View>
      )}

      {!equipment && (
        <View style={s.gateNotice}>
          <Text style={s.gateNoticeText}>
            Pick the unit before asking — every answer is cited to that machine's
            manuals, so I can't ground one without it.
          </Text>
          <Pressable
            onPress={() => onCapture('manual')}
            style={({ pressed }) => [s.gateAction, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Choose the unit"
          >
            <Text style={s.secondaryActionText}>Choose the unit</Text>
          </Pressable>
        </View>
      )}

      {/* An attached photo, shown before it is sent — a picture the technician
          cannot see attached is one they cannot tell is the wrong picture. */}
      {photos.length > 0 && (
        <View style={s.attachment}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbRow}>
            {photos.map((p, i) => (
              <View key={p.uri} style={s.thumbWrap}>
                <Image source={{ uri: p.uri }} style={s.thumb} accessibilityIgnoresInvertColors />
                <ScalePressable
                  onPress={() => setPhotos((prev) => prev.filter((x) => x.uri !== p.uri))}
                  hitSlop={10}
                  scaleTo={0.85}
                  style={s.removeThumb}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                >
                  <Ionicons name="close" size={14} color={color.textOnInteractive} />
                </ScalePressable>
              </View>
            ))}
          </ScrollView>
          <Text style={s.attachmentText}>
            {photos.length === 1 ? '1 photo attached' : `${photos.length} photos attached`} — say what
            I'm looking at and I'll work it into the diagnosis.
          </Text>
        </View>
      )}

      <View style={s.composer}>
        <ScalePressable
          onPress={equipment ? choosePhotoSource : () => onCapture('camera')}
          haptic="tap"
          disabled={attaching || busy}
          style={({ pressed }) => [s.capture, pressed && s.capturePressed, (attaching || busy) && s.sendDisabled]}
          accessibilityRole="button"
          // The same button does the job the technician actually needs at each
          // point: identify the unit when there isn't one, photograph the part
          // once there is. Before this it re-ran nameplate capture mid-diagnosis,
          // which is never what someone pointing at a scorched contactor wants.
          accessibilityLabel={equipment ? 'Add photos' : 'Photograph the nameplate'}
          accessibilityHint={
            equipment
              ? 'Attach photos from your library or camera to your next question'
              : 'Identifies the unit from its data plate'
          }
        >
          <Ionicons name={equipment ? 'images-outline' : 'camera-outline'} size={22} color={color.accent} />
        </ScalePressable>

        <View style={s.inputWrap}>
          <TextInput
            value={input}
            onChangeText={setInput}
            editable={Boolean(equipment)}
            placeholder={equipment ? 'Describe the symptom…' : 'Pick the unit first'}
            placeholderTextColor={color.textSecondary}
            style={s.input}
            multiline
            accessibilityLabel="Symptom description"
            returnKeyType="send"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => send(input)}
          />
          <ScalePressable
            onPress={() => send(input)}
            disabled={!input.trim() || busy || !equipment}
            hitSlop={touchSlop(SEND_SIZE)}
            scaleTo={0.9}
            style={s.sendTouch}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !input.trim() || busy || !equipment }}
          >
            {({ pressed }) => (
              <View
                style={[
                  s.send,
                  pressed && s.sendPressed,
                  (!input.trim() || busy || !equipment) && s.sendDisabled,
                ]}
              >
                <Ionicons name="arrow-up" size={22} color={color.textOnAccent} />
              </View>
            )}
          </ScalePressable>
        </View>
      </View>

      {/* Phone: source opens over the answer. Tablet uses SourcePanel instead. */}
      {!canShowSourceBeside && (
        <CitationSheet citation={citation} onClose={() => setCitation(null)} />
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * First run.
 *
 * The old version led with a "COVERED RIGHT NOW" panel listing two manufacturers.
 * It was removed for two reasons: it went stale the moment the corpus opened past
 * Trane and Carrier, and the general question ("what does this app cover?") is the
 * wrong one to answer here — by this point a unit is selected, so the *specific*
 * question ("do you have THIS unit?") is both answerable and the one that matters.
 * `CoverageLine` answers that instead, from the unit's own verdict.
 *
 * ---------------------------------------------------------------------------
 * ST-R16 — the chips come from the manuals now, or they do not come at all
 * ---------------------------------------------------------------------------
 *
 * They used to come from `startersFor` — four hardcoded strings per equipment
 * class. On the Bosch unit that started this round, four taps produced four
 * no-documentation replies, because that corpus is installation literature and
 * the taxonomy only knew how to offer diagnosis. `starters.ts` records the
 * deletion; this is the render side of it.
 *
 * **Three states, and the third is designed rather than left over:**
 *
 *  - *looking* — the chip area draws **nothing**. Not a skeleton, not a
 *    placeholder (AC 4). A chip that appears a beat late is better than a shape
 *    that promises one and then does not deliver it, and on this screen the
 *    promise is the whole problem being fixed.
 *  - *suggestions* — up to four chips, each the server's own `text`, sent with
 *    this session's `documentIds` verbatim. Nothing here composes a question.
 *  - *nothing to suggest* — no chips and **no "Common on this unit" heading**,
 *    because an empty heading is worse than an absent one. In their place, the
 *    statement of what this unit's documents actually are, composed from the
 *    verdict's own columns, and the invitation to ask anyway.
 *
 * A failed lookup is the third state too, not an error card (AC 5) — the
 * precedent `requestResolveUnit` and `requestSuggestUnits` already set. There is
 * nothing a technician on a roof can do about it, and the screen is still fully
 * usable: the composer, both front doors and the change-unit control depend on
 * none of this (AC 3).
 */
function EmptyAsk({
  onPick,
  onIdentify,
  equipment,
  documentIds,
  coverage,
}: {
  onPick: (s: string) => void;
  onIdentify: (mode: 'camera' | 'manual') => void;
  equipment?: string | null;
  /** This session's retrieval scope, passed to the lookup and to nothing else. */
  documentIds?: string[] | null;
  coverage?: { status: string | null; docs: string[]; types?: string[] } | null;
}) {
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>([]);
  /** True until the first lookup for this scope has settled, either way. */
  const [looking, setLooking] = useState(true);

  /**
   * Ask the corpus what it can answer about this unit.
   *
   * Keyed on the scope itself rather than on the equipment label, because the
   * scope is what the suggestions are mined from — two labels for the same
   * documents must not produce two lookups, and one label whose scope changed
   * must produce a new one. `join` is the cheapest stable key for that and the
   * order is the server's, so it is stable across renders.
   *
   * `requestUnitSuggestions` never throws and never rejects, so there is no
   * catch here to write: every failure it has resolves to `[]`, which is the
   * third state.
   */
  const scopeKey = (documentIds ?? []).join(',');
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLooking(true);
    setSuggestions([]);
    void requestUnitSuggestions(documentIds, controller.signal).then((rows) => {
      if (!live) return;
      setSuggestions(rows);
      setLooking(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
    // `scopeKey` and not `documentIds`: the array is a fresh identity on every
    // render of the shell, so depending on it would re-ask on every keystroke in
    // the composer. The string is the same scope, flattened, and the only other
    // value read inside is `documentIds` itself.
  }, [scopeKey]);

  /**
   * The documents we hold, for the statement that replaces the chips.
   *
   * `coverage.docs.length` and not `documentIds.length`, deliberately: it is the
   * same number `CoverageLine` renders one line above, and a card that states
   * two different counts about one unit is worse than one that states a slightly
   * coarser one. `coverageStatement` returns `''` at zero, so a unit we hold
   * nothing for gets `CoverageLine`'s existing sentence and no second one.
   */
  const statement = coverageStatement(coverage?.docs.length ?? 0, coverage?.types ?? []);
  const nothingToSuggest = !looking && suggestions.length === 0;

  return (
    <View style={s.empty}>
      <View>
        <Text style={s.emptyTitle}>What's the unit doing?</Text>
        <Text style={s.emptyBody}>
          Describe the symptom in your own words — I'll cite every step to this
          unit's manuals.
        </Text>
      </View>

      {equipment && (
        <View style={s.unitCard}>
          <View style={s.unitCardHead}>
            <View style={s.unitCardText}>
              <Text style={s.unitChosenLabel}>THIS JOB</Text>
              <Text style={s.unitChosenText}>{equipment}</Text>
            </View>
            <ScalePressable
              onPress={() => onIdentify('manual')}
              hitSlop={8}
              style={({ pressed }) => [s.changeUnit, pressed && s.doorPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Change the unit, currently ${equipment}`}
            >
              <Ionicons name="swap-horizontal-outline" size={18} color={color.accent} />
              <Text style={s.changeUnitText}>Change</Text>
            </ScalePressable>
          </View>
          <CoverageLine coverage={coverage} />
          {/* ST-R16 AC 2 — the designed empty state. It sits inside the unit
              card because it is a statement about *this unit*, and putting it
              where the chips would have been would read as an apology for them.
              Rendered only when there is something to state: at zero documents
              `coverageStatement` returns '' and CoverageLine above has already
              said so. */}
          {nothingToSuggest && statement !== '' && (
            <View style={s.holdings}>
              <Text style={s.holdingsText}>{statement}</Text>
              <Text style={s.holdingsInvitation}>{NOTHING_TO_SUGGEST_INVITATION}</Text>
            </View>
          )}
        </View>
      )}

      {!equipment && (
        <View style={s.doors}>
          <ScalePressable
            onPress={() => onIdentify('camera')}
            style={({ pressed }) => [s.door, pressed && s.doorPressed]}
            accessibilityRole="button"
            accessibilityLabel="Photograph the data plate to identify the unit"
          >
            <Ionicons name="camera-outline" size={20} color={color.accent} />
            <Text style={s.doorText}>Shoot the data plate</Text>
          </ScalePressable>
          <ScalePressable
            onPress={() => onIdentify('manual')}
            style={({ pressed }) => [s.door, pressed && s.doorPressed]}
            accessibilityRole="button"
            accessibilityLabel="Type the unit in instead of photographing it"
          >
            <Ionicons name="keypad-outline" size={20} color={color.accent} />
            <Text style={s.doorText}>Type the unit in</Text>
          </ScalePressable>
        </View>
      )}

      {/* No chips and no heading while the lookup is in flight, and none at all
          when it came back empty — AC 2 and AC 4. The heading lives inside this
          guard rather than above it precisely so it cannot outlive the list it
          introduces. */}
      {suggestions.length > 0 && (
        <View style={s.starters}>
          <Text style={s.orAsk}>Common on this unit</Text>
          {suggestions.map((sug) => (
            <ScalePressable
              key={`${sug.documentId}:${sug.page}:${sug.text}`}
              onPress={() => onPick(sug.text)}
              haptic="tap"
              style={({ pressed }) => [s.starter, pressed && s.starterPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Ask about: ${sug.text}`}
            >
              {/* The server's own text, rendered whole. Nothing is composed,
                  trimmed or re-worded here: a suggestion is a coverage claim,
                  and the only body that proved this one is answerable is the
                  one that mined and validated it (ST-R16 AC 6). */}
              <Text style={s.starterText}>{sug.text}</Text>
            </ScalePressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Whether we hold documentation for *this* unit — said before the first question.
 *
 * The technician asked for this directly ("should show if unit is located / we have
 * data"), and it is U4's promise made visible: the verdict already exists at unit
 * selection, it was simply never rendered. Three states, and the third is the one
 * worth keeping honest — an unchecked unit must not read as a covered one.
 */
function CoverageLine({ coverage }: { coverage?: { status: string | null; docs: string[] } | null }) {
  if (!coverage?.status) {
    return (
      <View style={s.coverageRow}>
        <Ionicons name="help-circle-outline" size={16} color={color.textSecondary} />
        <Text style={s.coverageUnknown}>Coverage not checked for this one</Text>
      </View>
    );
  }
  if (coverage.status === 'covered') {
    const n = coverage.docs.length;
    return (
      <View style={s.coverageRow}>
        <Ionicons name="checkmark-circle" size={16} color={color.accent} />
        <Text style={s.coverageYes}>
          {n === 1 ? '1 manual for this unit' : `${n} manuals for this unit`}
        </Text>
      </View>
    );
  }
  return (
    <View style={s.coverageRow}>
      <Ionicons name="alert-circle-outline" size={16} color={color.refusalText} />
      <Text style={s.coverageNo}>
        No documentation for this unit — I'll say so rather than guess
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  split: { flex: 1, flexDirection: 'row', gap: space.xl, padding: space.lg },
  scroll: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },

  empty: { flex: 1, justifyContent: 'flex-end', gap: space.xl },
  emptyTitle: { ...type.display, color: color.textPrimary },
  emptyBody: { ...type.body, color: color.textSecondary, marginTop: space.sm },

  doors: { gap: space.sm },

  unitCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  unitCardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  unitCardText: { flex: 1, gap: space.xs },
  unitChosenLabel: { ...type.overline, color: color.accent },
  unitChosenText: { ...type.heading, color: color.textPrimary },
  changeUnit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  changeUnitText: { ...type.chip, color: color.textPrimary },

  /* ST-R16 — what we hold, when there is nothing pre-canned to offer.
     No fill and no border of its own: it belongs to the unit card it sits in,
     and giving it a card would make "we have nothing for you" the loudest thing
     on the screen. A hairline separates it from the verdict line above. */
  holdings: {
    gap: space.xs,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.accentBorder,
  },
  holdingsText: { ...type.caption, color: color.textPrimary },
  holdingsInvitation: { ...type.caption, color: color.textSecondary },

  coverageRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  coverageYes: { ...type.caption, color: color.accent, flex: 1 },
  coverageNo: { ...type.caption, color: color.refusalText, flex: 1 },
  coverageUnknown: { ...type.caption, color: color.textSecondary, flex: 1 },

  door: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  doorPressed: { backgroundColor: color.surfaceRaised },
  doorGlyph: { ...type.heading, color: color.accent },
  doorText: { ...type.bodyStrong, color: color.textPrimary },
  orAsk: { ...type.caption, color: color.textSecondary },

  starters: { gap: space.sm },
  starter: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  starterPressed: { backgroundColor: color.surfaceRaised },
  starterText: { ...type.bodyStrong, color: color.textPrimary },

  working: { gap: space.sm, alignItems: 'flex-start' },
  thinking: { ...type.caption, color: color.accent },
  workingHint: { ...type.caption, color: color.textSecondary },
  secondaryAction: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  secondaryPressed: { backgroundColor: color.surface },
  secondaryActionText: { ...type.bodyStrong, color: color.textPrimary },

  retry: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
    marginTop: space.sm,
  },
  retryPressed: { backgroundColor: color.pressed },
  retryDisabled: { backgroundColor: color.border },
  retryText: { ...type.bodyStrong, color: color.textOnInteractive },


  inlineError: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  inlineErrorText: { ...type.heading, color: color.textPrimary },
  inlineErrorDetail: { ...type.caption, color: color.refusalText },
  inlineErrorHint: { ...type.caption, color: color.textSecondary },

  /** The disclosure sits outside the padded scroll, so it carries its own inset. */
  guestWrap: { marginHorizontal: space.lg, marginBottom: space.sm },

  gateNotice: {
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  gateNoticeText: { ...type.caption, color: color.textPrimary },
  gateAction: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },

  attachment: {
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  thumbRow: { gap: space.sm, paddingRight: space.sm },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: color.surfaceRaised },
  removeThumb: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.interactiveFill,
  },
  attachmentText: { ...type.caption, color: color.textPrimary },

  composer: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    alignItems: 'flex-end',
  },
  capture: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.interactiveFill,
  },
  capturePressed: { backgroundColor: color.pressed },
  captureGlyph: { ...type.title, color: color.textOnInteractive },

  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    minHeight: 56,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    borderRadius: space.xl,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    ...type.body,
    color: color.textPrimary,
    paddingVertical: space.sm,
  },
  /** Real 48dp target around a 40dp circle — see the note in Citation.tsx. */
  sendTouch: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.interactiveFill,
  },
  sendPressed: { backgroundColor: color.pressed },
  sendDisabled: { backgroundColor: color.border },
  sendGlyph: { ...type.bodyStrong, color: color.textOnInteractive },
});
