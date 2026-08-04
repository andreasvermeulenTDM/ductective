import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { color, type, space, radius, MIN_TOUCH, touchSlop } from '../theme/tokens';
import { useLayout } from '../theme/layout';
import { Message as MessageView } from '../components/Message';
import { Loading, ErrorState, OfflineNotice } from '../components/Chrome';
import { CitationSheet, SourcePanel } from '../components/Citation';
import { looksOffline } from '../lib/net';
import { STARTERS } from '../lib/mockDiagnostics';
import { createSession, loadMessages, submitSymptom } from '../lib/store';
import { isConfigured, CONFIG_HINT, type Citation, type Message } from '../lib/supabase';

/**
 * The send button sits inside the input pill, so it can't be 48dp of ink without
 * making the composer tower. It gets there via `touchSlop` instead — E6.7's floor
 * is on the target, not the pixels.
 */
const SEND_SIZE = 40;


export function ChatScreen({
  sessionId,
  onSession,
  onCapture,
}: {
  sessionId: string | null;
  onSession: (id: string) => void;
  onCapture: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [citation, setCitation] = useState<Citation | null>(null);
  const scroller = useRef<ScrollView>(null);
  const { canShowSourceBeside } = useLayout();

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    setLoading(true);
    loadMessages(sessionId)
      .then((m) => { setMessages(m); setOffline(false); })
      .catch((e) => { setError(e.message); setOffline(looksOffline(e)); })
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    try {
      let sid = sessionId;
      if (!sid) {
        const created = await createSession(body);
        sid = created.id;
        onSession(sid);
      }
      const { user, reply } = await submitSymptom(sid, messages.length, body);
      setMessages((prev) => [...prev, user, reply]);
      setOffline(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOffline(looksOffline(e));
      setInput(body); // never silently eat what they typed
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return <ErrorState title="Not connected" detail={CONFIG_HINT} />;
  }

  const conversation = (
    <ScrollView ref={scroller} style={s.fill} contentContainerStyle={s.scroll}>
      {messages.length === 0 ? (
        <EmptyAsk onPick={setInput} />
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

      {busy && <Text style={s.thinking}>Working through it…</Text>}

      {error && !offline && (
        <View style={s.inlineError}>
          <Text style={s.inlineErrorText}>The answer didn't come back</Text>
          <Text style={s.inlineErrorDetail}>{error}</Text>
          <Text style={s.inlineErrorHint}>
            Nothing partial has been kept — a half answer isn't worth acting on. Your
            question is still in the box.
          </Text>
        </View>
      )}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {offline && <OfflineNotice />}

      {loading ? (
        <Loading label="Loading this job…" />
      ) : canShowSourceBeside ? (
        <View style={s.split}>
          <View style={s.fill}>{conversation}</View>
          <SourcePanel citation={citation} onClose={() => setCitation(null)} />
        </View>
      ) : (
        conversation
      )}

      <View style={s.composer}>
        <Pressable
          onPress={onCapture}
          style={({ pressed }) => [s.capture, pressed && s.capturePressed]}
          accessibilityRole="button"
          accessibilityLabel="Photograph the nameplate"
          accessibilityHint="Identifies the unit from its data plate"
        >
          <Text style={s.captureGlyph}>◉</Text>
        </Pressable>

        <View style={s.inputWrap}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Describe the symptom…"
            placeholderTextColor={color.textSecondary}
            style={s.input}
            multiline
            accessibilityLabel="Symptom description"
            onSubmitEditing={() => send(input)}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={!input.trim() || busy}
            hitSlop={touchSlop(SEND_SIZE)}
            style={s.sendTouch}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !input.trim() || busy }}
          >
            {({ pressed }) => (
              <View
                style={[
                  s.send,
                  pressed && s.sendPressed,
                  (!input.trim() || busy) && s.sendDisabled,
                ]}
              >
                <Text style={s.sendGlyph}>↑</Text>
              </View>
            )}
          </Pressable>
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
function EmptyAsk({ onPick }: { onPick: (s: string) => void }) {
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
        <View style={s.starters}>
          {STARTERS.map((sug) => (
            <Pressable
              key={sug}
              onPress={() => onPick(sug)}
              style={({ pressed }) => [s.starter, pressed && s.starterPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use example: ${sug}`}
            >
              <Text style={s.starterText}>{sug}</Text>
            </Pressable>
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

  thinking: { ...type.caption, color: color.accent },

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
