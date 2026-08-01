/**
 * Message.tsx — message, citation, and refusal rendering.
 *
 * Two rules from CLAUDE.md are enforced structurally here rather than by
 * convention, because a convention can be refactored away by accident:
 *
 *  1. An `answer` with no citations does not render as an answer. It renders as a
 *     visible defect. E6.4 requires uncited claims to be impossible, and the way
 *     to make that true is for the component to refuse to draw one.
 *  2. A refusal has no dismiss, collapse, or "show me anyway" affordance — not
 *     because none is wired up, but because none exists. E5.2.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import type { Citation, MessageKind } from '../lib/supabase';

type Props = {
  kind: MessageKind;
  body: string;
  citations?: Citation[];
  onCitationPress?: (c: Citation) => void;
};

export function Message({ kind, body, citations = [], onCitationPress }: Props) {
  if (kind === 'user') return <UserTurn body={body} />;
  if (kind === 'refusal') return <RefusalCard body={body} />;
  if (kind === 'clarify') return <ClarifyTurn body={body} />;

  if (citations.length === 0) return <UncitedDefect body={body} />;

  return (
    <View style={s.assistant}>
      <Text style={s.body} accessibilityRole="text">
        {body}
      </Text>
      <View style={s.citationRow}>
        {citations.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => onCitationPress?.(c)}
            style={({ pressed }) => [s.citation, pressed && s.citationPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Source: ${c.source_document}, page ${c.page}`}
            accessibilityHint="Opens the cited source at that page"
          >
            <Text style={s.citationText} numberOfLines={1}>
              {shortDoc(c.source_document)} · p.{c.page}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function UserTurn({ body }: { body: string }) {
  return (
    <View style={s.user}>
      <Text style={s.userText}>{body}</Text>
    </View>
  );
}

function ClarifyTurn({ body }: { body: string }) {
  return (
    <View style={s.clarify}>
      <Text style={s.clarifyLabel}>NEEDS ONE MORE DETAIL</Text>
      <Text style={s.body}>{body}</Text>
    </View>
  );
}

/**
 * Safety refusal. Alert red per plan v3 §1.
 *
 * Deliberately absent: any close button, any collapse toggle, any retry, any
 * "continue anyway". A refusal a technician can click past is not a refusal, and
 * this is the component where that guarantee either holds or doesn't.
 */
function RefusalCard({ body }: { body: string }) {
  return (
    <View style={s.refusal} accessibilityRole="alert">
      <Text style={s.refusalLabel}>SAFETY — I WON'T ADVISE ON THIS</Text>
      <Text style={s.refusalBody}>{body}</Text>
    </View>
  );
}

/** An answer that arrived with no citation. Surfaced, never quietly rendered. */
function UncitedDefect({ body }: { body: string }) {
  return (
    <View style={s.defect} accessibilityRole="alert">
      <Text style={s.defectLabel}>WITHHELD — NO SOURCE</Text>
      <Text style={s.defectBody}>
        A response came back with no citation attached, so it is not being shown as
        guidance. This is a defect to report, not something to work around.
      </Text>
      <Text style={s.defectRaw} numberOfLines={3}>
        {body}
      </Text>
    </View>
  );
}

/** `RT-SVX23R-EN — Precedent Rooftop IOM` → `RT-SVX23R-EN`, for a chip. */
function shortDoc(name: string) {
  return name.split('—')[0].trim();
}

const s = StyleSheet.create({
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: color.interactive,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  userText: { ...type.body, color: color.textOnInteractive },

  assistant: { marginBottom: space.xl },
  body: { ...type.body, color: color.textPrimary },

  citationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  citation: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.surface,
  },
  citationPressed: { backgroundColor: color.surfaceRaised },
  citationText: { ...type.label, color: color.accent },

  clarify: {
    marginBottom: space.xl,
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    paddingLeft: space.lg,
  },
  clarifyLabel: { ...type.caption, color: color.accent, letterSpacing: 1, marginBottom: space.sm },

  refusal: {
    marginBottom: space.xl,
    backgroundColor: color.refusalSurface,
    borderWidth: 2,
    borderColor: color.refusalBorder,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  refusalLabel: {
    ...type.label,
    color: color.refusal,
    letterSpacing: 0.5,
    marginBottom: space.sm,
  },
  refusalBody: { ...type.body, color: color.textPrimary },

  defect: {
    marginBottom: space.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.refusalBorder,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  defectLabel: { ...type.label, color: color.refusal, marginBottom: space.sm },
  defectBody: { ...type.body, color: color.textPrimary, marginBottom: space.md },
  defectRaw: { ...type.caption, color: color.textSecondary, fontStyle: 'italic' },
});
