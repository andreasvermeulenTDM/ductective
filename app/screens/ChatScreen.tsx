import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Message as MessageView } from '../components/Message';
import { Loading, ErrorState } from '../components/Chrome';
import { STARTERS } from '../lib/mockDiagnostics';
import { createSession, loadMessages, submitSymptom } from '../lib/store';
import { isConfigured, CONFIG_HINT, type Citation, type Message } from '../lib/supabase';

export function ChatScreen({ sessionId, onSession }: { sessionId: string | null; onSession: (id: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    setLoading(true);
    loadMessages(sessionId)
      .then(setMessages)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    try {
      let sid = sessionId;
      if (!sid) {
        const created = await createSession(text);
        sid = created.id;
        onSession(sid);
      }
      const { user, reply } = await submitSymptom(sid, messages.length, text);
      setMessages((prev) => [...prev, user, reply]);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInput(text); // never silently eat what they typed
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return <ErrorState title="Not connected" detail={CONFIG_HINT} />;
  }

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {loading ? (
        <Loading label="Loading this job…" />
      ) : (
        <ScrollView ref={scroller} style={s.fill} contentContainerStyle={s.scroll}>
          {messages.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>What's the unit doing?</Text>
              <Text style={s.emptyBody}>
                Describe the symptom in your own words, or shoot the nameplate first
                so I know what I'm looking at.
              </Text>
              <View style={s.starters}>
                {STARTERS.map((sug) => (
                  <Pressable
                    key={sug}
                    onPress={() => setInput(sug)}
                    style={({ pressed }) => [s.starter, pressed && s.starterPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Use example: ${sug}`}
                  >
                    <Text style={s.starterText}>{sug}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
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
          {error && (
            <View style={s.inlineError}>
              <Text style={s.inlineErrorText}>{error}</Text>
              <Text style={s.inlineErrorHint}>Your text is still in the box — try again.</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={s.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Describe the symptom…"
          placeholderTextColor={color.textSecondary}
          style={s.input}
          multiline
          accessibilityLabel="Symptom description"
          onSubmitEditing={send}
        />
        <Pressable
          onPress={send}
          disabled={!input.trim() || busy}
          style={({ pressed }) => [
            s.send,
            pressed && s.sendPressed,
            (!input.trim() || busy) && s.sendDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !input.trim() || busy }}
        >
          <Text style={s.sendText}>Ask</Text>
        </Pressable>
      </View>

      {/* Citation tap-through. Mock: names the document and page rather than
          opening the PDF — the corpus is gitignored and not on the device. */}
      <Modal visible={!!citation} transparent animationType="fade" onRequestClose={() => setCitation(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setCitation(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetLabel}>SOURCE</Text>
            <Text style={s.sheetDoc}>{citation?.source_document}</Text>
            <Text style={s.sheetPage}>Page {citation?.page}</Text>
            {citation?.claim && <Text style={s.sheetClaim}>Supports: {citation.claim}</Text>}
            <Text style={s.sheetWarn}>
              Prototype — this citation has not been checked against the document.
            </Text>
            <Pressable
              onPress={() => setCitation(null)}
              style={({ pressed }) => [s.sheetClose, pressed && s.sendPressed]}
              accessibilityRole="button"
            >
              <Text style={s.sendText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },

  empty: { flex: 1, justifyContent: 'center', gap: space.md },
  emptyTitle: { ...type.display, color: color.textPrimary },
  emptyBody: { ...type.body, color: color.textSecondary, marginBottom: space.md },
  starters: { gap: space.sm },
  starter: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  starterPressed: { backgroundColor: color.surfaceRaised },
  starterText: { ...type.body, color: color.textPrimary },

  thinking: { ...type.caption, color: color.accent },
  inlineError: {
    borderWidth: 1, borderColor: color.refusalBorder, borderRadius: radius.md,
    padding: space.md, gap: space.xs,
  },
  inlineErrorText: { ...type.label, color: color.refusal },
  inlineErrorHint: { ...type.caption, color: color.textSecondary },

  composer: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH,
    maxHeight: 120,
    ...type.body,
    color: color.textPrimary,
    backgroundColor: color.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  send: {
    minHeight: MIN_TOUCH,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent,
  },
  sendPressed: { backgroundColor: color.interactive },
  sendDisabled: { backgroundColor: color.border },
  sendText: { ...type.bodyStrong, color: color.textOnAccent },

  sheetBackdrop: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: color.accent,
    padding: space.xl,
    gap: space.sm,
  },
  sheetLabel: { ...type.caption, color: color.accent, letterSpacing: 1 },
  sheetDoc: { ...type.heading, color: color.textPrimary },
  sheetPage: { ...type.body, color: color.textSecondary },
  sheetClaim: { ...type.body, color: color.textPrimary, marginTop: space.sm },
  sheetWarn: { ...type.caption, color: color.refusal, marginTop: space.sm },
  sheetClose: {
    minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: color.accent, marginTop: space.md,
  },
});
