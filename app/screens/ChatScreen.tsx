import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, type, space, radius, MIN_TOUCH, touchSlop } from '../theme/tokens';
import { ScalePressable, fireHaptic } from '../components/Tactile';
import { ConversationSkeleton } from '../components/Skeleton';
import { useLayout } from '../theme/layout';
import { Message as MessageView } from '../components/Message';
import { ErrorState, OfflineNotice, SessionHeader } from '../components/Chrome';
import { CitationSheet, SourcePanel } from '../components/Citation';
import { looksOffline } from '../lib/net';
import { STARTERS } from '../lib/mockDiagnostics';
import { answerExisting, askQuestion, createSession, loadMessages } from '../lib/store';
import { DiagnoseError } from '../lib/diagnose';
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
  carriedQuestion,
  onCarriedConsumed,
}: {
  sessionId: string | null;
  onSession: (id: string) => void;
  onCapture: (mode: 'camera' | 'manual') => void;
  equipment?: string | null;
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
  const scroller = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);
  const { canShowSourceBeside } = useLayout();

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    setLoading(true);
    loadMessages(sessionId)
      .then((m) => { setMessages(m); setOffline(false); })
      .catch((e) => { setError(e); setOffline(looksOffline(e)); })
      .finally(() => setLoading(false));
  }, [sessionId]);

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
      let sid = sessionId;
      if (!sid) {
        const created = await createSession(body, equipment);
        sid = created.id;
        onSession(sid);
      }
      // Two steps, not one: the question is persisted and shown before the answer
      // is attempted, so a failure leaves a visible turn with a retry beside it
      // rather than a saved-but-invisible question. Retrying then regenerates only
      // the reply — asking again as a whole would persist a duplicate question.
      const seq = messages.length;
      const user = await askQuestion(sid, seq, body);
      setMessages((prev) => [...prev, user]);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

      const reply = await answerExisting(sid, seq + 1, body, equipment, documentIds, controller.signal);
      if (reply.kind === 'refusal') void fireHaptic('warning');
      setMessages((prev) => [...prev, reply]);
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

  /** Regenerate the missing reply for an already-saved question. */
  async function answerUnanswered() {
    if (!sessionId || !unanswered || busy) return;
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
        <EmptyAsk onPick={(sug) => send(sug)} onIdentify={onCapture} equipment={equipment} />
      ) : (
        messages.map((m) => (
          <MessageView
            key={m.id}
            kind={m.kind}
            body={m.body}
            citations={m.citations}
            onCitationPress={setCitation}
          />
        ))
      )}

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

      <View style={s.composer}>
        <ScalePressable
          onPress={() => onCapture('camera')}
          haptic="tap"
          style={({ pressed }) => [s.capture, pressed && s.capturePressed]}
          accessibilityRole="button"
          accessibilityLabel="Photograph the nameplate"
          accessibilityHint="Identifies the unit from its data plate"
        >
          <Ionicons name="camera-outline" size={22} color={color.accent} />
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
 * First run, mockup s1.
 *
 * Coverage is stated before a tech can hit the edge of it — E3.6's honesty at the
 * boundary, moved forward into the empty state so it costs nobody a wasted query.
 */
function EmptyAsk({
  onPick,
  onIdentify,
  equipment,
}: {
  onPick: (s: string) => void;
  onIdentify: (mode: 'camera' | 'manual') => void;
  equipment?: string | null;
  /** A question typed at the unit gate, resumed once a unit exists (U1). */
  carriedQuestion?: string | null;
  onCarriedConsumed?: () => void;
}) {
  return (
    <View style={s.empty}>
      <View>
        <Text style={s.emptyTitle}>What's the unit doing?</Text>
        <Text style={s.emptyBody}>
          Describe the symptom in your own words, or shoot the data plate.
        </Text>
      </View>

      <View style={s.coverage}>
        <Text style={s.coverageLabel}>COVERED RIGHT NOW</Text>
        <Text style={s.coverageBody}>
          Trane Precedent and Carrier 48/50 packaged rooftops. Anything else, I'll say
          so instead of guessing.
        </Text>
        {equipment ? (
          <View style={s.doors}>
            <View style={s.unitChosen}>
              <Text style={s.unitChosenLabel}>THIS JOB IS ABOUT</Text>
              <Text style={s.unitChosenText}>{equipment}</Text>
            </View>
            <ScalePressable
              onPress={() => onIdentify('manual')}
              style={({ pressed }) => [s.door, pressed && s.doorPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Change the unit, currently ${equipment}`}
            >
              <Ionicons name="swap-horizontal-outline" size={20} color={color.accent} />
              <Text style={s.doorText}>Different unit</Text>
            </ScalePressable>
          </View>
        ) : (
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

        <Text style={s.orAsk}>Or just describe what it's doing:</Text>

        <View style={s.starters}>
          {STARTERS.map((sug) => (
            <ScalePressable
              key={sug}
              onPress={() => onPick(sug)}
              haptic="tap"
              style={({ pressed }) => [s.starter, pressed && s.starterPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use example: ${sug}`}
            >
              <Text style={s.starterText}>{sug}</Text>
            </ScalePressable>
          ))}
        </View>
      </View>
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

  coverage: {
    gap: space.md,
    padding: space.lg,
    borderRadius: space.xl,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  coverageLabel: { ...type.overline, color: color.accent },
  coverageBody: { ...type.body, color: color.textPrimary },

  doors: { gap: space.sm },
  unitChosen: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  unitChosenLabel: { ...type.overline, color: color.accent },
  unitChosenText: { ...type.heading, color: color.textPrimary },

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
