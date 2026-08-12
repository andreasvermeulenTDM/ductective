/**
 * UnitGate.tsx — the first screen. U1, U7, U8.
 *
 * The app establishes which unit the technician is standing in front of before it
 * takes a question. Not for usability — it costs a tap on a quick question, and
 * Amendment 1 records that cost — but because an answer citing the wrong unit's
 * manual is a mis-citation, which `CLAUDE.md` calls worse than an uncited claim.
 * The gate makes that failure unreachable rather than unlikely.
 *
 * U7's carve-out is the subtle part. Safety refusals must stay reachable with or
 * without a unit: a refusal needs no equipment context to be correct, and gating
 * one behind unit selection would be a guardrail regression. So this screen takes
 * free text — and renders the reply *only* if it is a refusal. Anything else is
 * discarded and the technician is asked for the unit, with their words kept.
 */

import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { ScalePressable } from '../components/Tactile';
import { GuestNotice } from '../components/Chrome';
import { Message as MessageView } from '../components/Message';
import { looksOffline } from '../lib/net';
import { refusalCheck, DiagnoseError, isLive, type DiagnoseReply } from '../lib/diagnose';

type Props = {
  /** Opens the capture flow at one of its two front doors (U2). */
  onIdentify: (mode: 'camera' | 'manual') => void;
  /** Carries text typed at the gate into the session once a unit exists. */
  onCarryOver: (text: string) => void;
  /**
   * ST-A06 AC 6. This screen answers too — U7's carve-out returns a **refusal**
   * before any unit exists, and a refusal is an answer. So "the app says so
   * before the first answer" binds here as well as on the chat composer, or a
   * guest whose very first question is a hazard gets a reply having never been
   * told the conversation is not being kept.
   */
  signedIn?: boolean;
  onSignIn?: () => void;
  /**
   * ST-F02. The dismissal state lives in `App.tsx` and is shared with
   * `ChatScreen`, so an answer taken here earns dismissal on the composer and
   * vice versa. This screen holds no state of its own for it and must not: two
   * copies of the rule is how one surface starts disagreeing with the other.
   */
  noticeDismissed?: boolean;
  /** Absent until an answer has been delivered — then the control appears. */
  onDismissNotice?: () => void;
  /** A refusal here is an answer (U7), and it is what earns the dismissal. */
  onAnswerDelivered?: (kind: 'refusal') => void;
};

export function UnitGate({
  onIdentify,
  onCarryOver,
  signedIn,
  onSignIn,
  noticeDismissed,
  onDismissNotice,
  onAnswerDelivered,
}: Props) {
  const [question, setQuestion] = useState('');
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<DiagnoseReply | null>(null);
  const [needsUnit, setNeedsUnit] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function ask() {
    const text = question.trim();
    if (!text || checking) return;
    setChecking(true);
    setError(null);
    setRefusal(null);
    setNeedsUnit(false);
    try {
      // Live only. With no core configured there is nothing to classify against,
      // and a locally-invented hazard list would be a second, diverging guardrail.
      const hit = isLive ? await refusalCheck(text) : null;
      if (hit) {
        setRefusal(hit);
        // A refusal is an answer. This is the whole reason the disclosure is on
        // this screen at all, so it is also what earns the right to clear it.
        onAnswerDelivered?.('refusal');
      } else {
        setNeedsUnit(true);
        onCarryOver(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View>
          <Text style={s.title}>Which unit are you at?</Text>
          {/* ST-F19 — one clause shorter, and the clause that went was the one
              restating the ordering the screen already demonstrates. The citation
              promise is the half that matters and it is untouched: it is the
              reason the gate exists at all (U1). */}
          <Text style={s.sub}>
            Everything I say is cited to that unit's manuals, so I need the machine
            first.
          </Text>
        </View>

        {/* Before the doors, because it is true before anything else on this
            screen is: whatever happens next is not being kept. */}
        {!signedIn && !noticeDismissed && (
          <GuestNotice onSignIn={() => onSignIn?.()} onDismiss={onDismissNotice} />
        )}

        {/*
          Co-equal front doors — U1 and U2. Neither is the fallback, and **both
          stay**: ST-F19 AC 4 forbids removing the only route to a capability, and
          manual entry is the only one that works with no signal and no camera
          permission.

          ST-F19 — what changed is that they are now two rows of one card rather
          than two separate cards. The owner's complaint about this screen was that
          it is over-complicated, and the measurable form of that is competing
          blocks: this takes the gate from four to three before the technician has
          done anything, with no route lost.

          The hints went into the labels. "Fastest when the plate is readable" was
          advice about a choice the order of the rows already makes; "works
          offline" is the one fact that changes which door a technician on a roof
          with no signal picks, so it stayed. The camera-denied case is not lost —
          `PermissionDenied` routes straight here and says so at the moment it is
          true, which is better than a line read before it happens.

          `ScalePressable`, not `Pressable`: the press is felt as scale and haptic
          rather than drawn as a fill, which is what keeps each row from being a
          block of its own. The same pattern the urgent toggle below and the lockup
          in `App.tsx` already use.
        */}
        <View style={s.doorCard}>
          <ScalePressable
            onPress={() => onIdentify('camera')}
            haptic="tap"
            style={s.doorRow}
            accessibilityRole="button"
            accessibilityLabel="Photograph the data plate"
          >
            <Ionicons name="camera-outline" size={20} color={color.accent} />
            <Text style={s.doorText}>Shoot the data plate</Text>
          </ScalePressable>

          <ScalePressable
            onPress={() => onIdentify('manual')}
            haptic="tap"
            style={s.doorRow}
            accessibilityRole="button"
            accessibilityLabel="Type the unit in"
          >
            <Ionicons name="keypad-outline" size={20} color={color.accent} />
            <Text style={s.doorText}>Type the unit in — works offline</Text>
          </ScalePressable>
        </View>

        {/*
          U7 — a refusal must be reachable before a unit exists.

          Collapsed behind a disclosure. It is a genuine safety escape and it stays,
          but as a permanently-open panel it competed with the two front doors for
          attention on the screen a technician sees most, and it is the rarer path by
          a wide margin. Closed it is one quiet line; open it is exactly what it was.
        */}
        <View style={s.safety}>
          <ScalePressable
            onPress={() => setUrgentOpen((v) => !v)}
            hitSlop={8}
            style={s.urgentToggle}
            accessibilityRole="button"
            accessibilityLabel="Ask something before choosing a unit"
            accessibilityState={{ expanded: urgentOpen }}
          >
            <Ionicons
              name={urgentOpen ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={color.textSecondary}
            />
            <Text style={s.urgentToggleText}>Something urgent, before I pick a unit</Text>
          </ScalePressable>

          {urgentOpen && (
            <>
              <Text style={s.safetyHint}>
                I'll tell you straight away if it's work I won't advise on. For
                anything else I'll need the unit first.
              </Text>

              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="What's happening?"
                placeholderTextColor={color.textSecondary}
                style={s.input}
                multiline
                accessibilityLabel="Ask before choosing a unit"
              />

              <Pressable
                onPress={ask}
                disabled={!question.trim() || checking}
                style={({ pressed }) => [
                  s.askButton,
                  pressed && s.askPressed,
                  (!question.trim() || checking) && s.askDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Check this before choosing a unit"
                accessibilityState={{ disabled: !question.trim() || checking }}
              >
                <Text style={s.askText}>{checking ? 'Checking…' : 'Ask'}</Text>
              </Pressable>
            </>
          )}
        </View>

        {refusal && (
          <MessageView kind="refusal" body={refusal.body} citations={[]} />
        )}

        {needsUnit && (
          <View style={s.needsUnit} accessibilityRole="alert">
            <Text style={s.needsUnitTitle}>I need the unit for that one</Text>
            <Text style={s.needsUnitBody}>
              It isn't something I refuse — it's something I can only answer against a
              specific machine's manuals. Pick the unit above and I'll pick your
              question back up.
            </Text>
          </View>
        )}

        {error && (
          <View style={s.errorCard}>
            <Text style={s.errorTitle}>Couldn't check that</Text>
            <Text style={s.errorBody}>
              {error instanceof DiagnoseError ? error.userMessage : error.message}
            </Text>
            <Text style={s.errorHint}>
              {looksOffline(error)
                ? 'You can still type the unit in — that works offline.'
                : 'Your question is still here. Try again, or pick the unit and ask there.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: space.xxl, gap: space.xl, flexGrow: 1 },

  title: { ...type.display, color: color.textPrimary },
  sub: { ...type.body, color: color.textSecondary, marginTop: space.sm },

  /* One card, two routes. ST-F19: fewer competing blocks, both doors intact. */
  doorCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  doorRow: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  doorText: { ...type.bodyStrong, color: color.textPrimary, flex: 1 },

  safety: { gap: space.sm },
  urgentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
  },
  urgentToggleText: { ...type.caption, color: color.textSecondary },
  safetyHint: { ...type.caption, color: color.textSecondary },
  input: {
    minHeight: MIN_TOUCH,
    maxHeight: 120,
    ...type.body,
    color: color.textPrimary,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  askButton: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  askPressed: { backgroundColor: color.surface },
  askDisabled: { opacity: 0.5 },
  askText: { ...type.bodyStrong, color: color.textPrimary },

  needsUnit: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  needsUnitTitle: { ...type.heading, color: color.textPrimary },
  needsUnitBody: { ...type.body, color: color.textPrimary },

  errorCard: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  errorTitle: { ...type.heading, color: color.textPrimary },
  errorBody: { ...type.caption, color: color.refusalText },
  errorHint: { ...type.caption, color: color.textSecondary },
});
