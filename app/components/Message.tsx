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
 *
 * Visual language follows the Run C mockup (`Mockups/…/Ductective Mobile.dc.html`),
 * with two deliberate departures, both recorded in
 * `.pipeline/04-frontend-design-pass.md`:
 *
 *  - Refusal *text* uses `color.refusalText`, not `color.refusal`. The mockup's
 *    #C0453C label measures 3.23:1 on its own card, under E6.7's 4.5:1 floor.
 *  - The mockup's quick-answer options (s4) and safe-alternative rows (s8) are not
 *    rendered. The persisted message contract has no field to carry them, and
 *    inventing options that vanish when a session is reopened from history is
 *    worse than not drawing them. Filed as CONTRACT MISMATCH against Stage 3.
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, type, space, radius } from '../theme/tokens';
import { CitationChip, UnresolvedCitationChip } from './Citation';
import { partition } from '../lib/citations';
import { parseAnswer } from '../lib/answerFormat';
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

  // E6.4, the strict reading: an answer whose every citation is broken is an
  // uncited claim. Well-formed prose does not make it citeable, and rendering it
  // as guidance because *something* was attached is exactly the failure the
  // no-uncited-claims rule exists to stop.
  const { usable, broken } = partition(citations);
  if (usable.length === 0) return <UncitedDefect body={body} allBroken={broken} />;

  return (
    <AnswerTurn
      body={body}
      citations={usable}
      broken={broken}
      onCitationPress={onCitationPress}
    />
  );
}

/* -------------------------------------------------------------------------- */

function UserTurn({ body }: { body: string }) {
  return (
    <View style={s.user}>
      <Text style={s.userText}>{body}</Text>
    </View>
  );
}

/**
 * A diagnostic answer: lead, ordered checks, and the reading to take.
 *
 * The structure is *parsed out of prose* — `parseAnswer` finds "1. ", "2. " lines
 * in the body. That is a prototype accommodation, not a design: the mockup's
 * numbered checks and per-step citations imply Run B emits a structured answer
 * (lead / steps / reading / citation anchored per claim). Until it does, chips
 * render in a row under the answer rather than inline after the claim they
 * support, because the contract carries no positional anchor to place them by.
 */
/** Split a step's text at its "Reading:" marker so the tail can render muted. */
function splitReading(rest: string): { text: string; muted: boolean }[] {
  const i = rest.search(/\bReading:/);
  if (i < 0) return [{ text: rest, muted: false }];
  return [
    { text: rest.slice(0, i), muted: false },
    { text: rest.slice(i), muted: true },
  ];
}

function AnswerTurn({
  body,
  citations,
  broken,
  onCitationPress,
}: {
  body: string;
  citations: Citation[];
  broken: { citation: Citation; reason: string }[];
  onCitationPress?: (c: Citation) => void;
}) {
  const { lead, steps, reading } = parseAnswer(body);

  return (
    <View style={s.assistant}>
      {lead ? <Text style={s.body}>{lead}</Text> : null}

      {steps.length > 0 && (
        <>
          <Text style={s.overline}>CHECK IN THIS ORDER</Text>
          <View style={s.steps}>
            {steps.map((step, i) => (
              <View key={i} style={s.step}>
                <View style={s.stepNumber}>
                  <Text style={s.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={s.stepBody}>
                  {step.headline ? <Text style={s.stepHeadline}>{step.headline} </Text> : null}
                  {/* P3: the tech scans for ACTIONS; the reading is the follow-up.
                      De-emphasising it gives the verbs visual priority without
                      losing the measurement. */}
                  {splitReading(step.rest).map((part, j) =>
                    part.muted ? (
                      <Text key={j} style={s.stepReading}>{part.text}</Text>
                    ) : (
                      <Text key={j}>{part.text}</Text>
                    )
                  )}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {reading ? (
        <View style={s.reading}>
          <Ionicons name="speedometer-outline" size={16} color={color.textSecondary} />
          <Text style={s.readingText}>{reading}</Text>
        </View>
      ) : null}

      <View style={s.citationRow}>
        {citations.map((c) => (
          <CitationChip key={c.id} citation={c} onPress={(x) => onCitationPress?.(x)} />
        ))}
        {/* Broken ones sit alongside the good ones rather than being dropped.
            Quietly discarding them would make an answer look better sourced than
            it is — the opposite of what E6.4 is protecting. */}
        {broken.map(({ citation, reason }) => (
          <UnresolvedCitationChip
            key={citation.id}
            citation={citation}
            reason={reason}
            onPress={(x) => onCitationPress?.(x)}
          />
        ))}
      </View>

      <View style={s.adviseOnly}>
        <Text style={s.adviseOnlyText}>
          Advice only. Verify against the pages above before you act, and follow your
          own procedure for anything on the refrigerant side.
        </Text>
      </View>
    </View>
  );
}

/** Cyan-ringed and labelled, so a question can never be mistaken for an answer. */
function ClarifyTurn({ body }: { body: string }) {
  return (
    <View style={s.clarify}>
      <Text style={s.clarifyLabel}>ONE THING FIRST</Text>
      <Text style={s.body}>{body}</Text>
    </View>
  );
}

/**
 * Safety refusal. Alert red per plan v3 §1, ring and fill per mockup s8.
 *
 * Deliberately absent: any close button, any collapse toggle, any retry, any
 * "continue anyway". A refusal a technician can click past is not a refusal, and
 * this is the component where that guarantee either holds or doesn't.
 *
 * It is also deliberately unlike a transport error (see `ErrorState`), which is a
 * steel card with one red glyph and a Try again. At arm's length in sunlight the
 * difference has to be obvious: red all over and no action means stop.
 */
function RefusalCard({ body }: { body: string }) {
  return (
    <View style={s.refusal} accessibilityRole="alert">
      <Text style={s.refusalLabel}>I WON'T GUIDE THIS</Text>
      <Text style={s.refusalBody}>{body}</Text>
    </View>
  );
}

/** An answer that arrived with no usable citation. Surfaced, never quietly rendered. */
function UncitedDefect({
  body,
  allBroken,
}: {
  body: string;
  allBroken?: { citation: Citation; reason: string }[];
}) {
  const brokenCount = allBroken?.length ?? 0;
  return (
    <View style={s.defect} accessibilityRole="alert">
      <Text style={s.defectLabel}>WITHHELD — NO SOURCE</Text>
      <Text style={s.defectBody}>
        {brokenCount > 0
          ? `A response came back with ${brokenCount} citation${brokenCount > 1 ? 's' : ''}, none of which resolve to a document and page you could check. It is not being shown as guidance. This is a defect to report, not something to work around.`
          : 'A response came back with no citation attached, so it is not being shown as guidance. This is a defect to report, not something to work around.'}
      </Text>
      {allBroken?.map(({ citation, reason }) => (
        <Text key={citation.id} style={s.defectReason}>
          · {reason}
        </Text>
      ))}
      <Text style={s.defectRaw} numberOfLines={3}>
        {body}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const s = StyleSheet.create({
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: color.pressed,
    borderRadius: space.xl,
    borderBottomRightRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  userText: { ...type.body, color: color.textOnInteractive },

  assistant: { marginBottom: space.xl, gap: space.md },
  body: { ...type.body, color: color.textPrimary },

  overline: { ...type.overline, color: color.textSecondary },
  steps: { gap: space.lg },
  step: { flexDirection: 'row', gap: space.md },
  stepNumber: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: color.accentSurface,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumberText: { ...type.chip, color: color.accent },
  stepBody: { ...type.body, color: color.textPrimary, flex: 1 },
  stepHeadline: { fontFamily: type.bodyStrong.fontFamily, color: color.textPrimary },
  stepReading: { color: color.textSecondary },

  reading: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  readingGlyph: { ...type.body, color: color.textSecondary },
  readingText: { ...type.caption, color: color.textSecondary, flex: 1 },

  citationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  adviseOnly: {
    flexDirection: 'row',
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  adviseOnlyText: { ...type.caption, color: color.textSecondary, flex: 1 },

  clarify: {
    marginBottom: space.xl,
    gap: space.md,
    padding: space.lg,
    borderRadius: space.xl,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  clarifyLabel: { ...type.overline, color: color.accent },

  refusal: {
    marginBottom: space.xl,
    gap: space.md,
    backgroundColor: color.refusalSurface,
    borderWidth: 2,
    borderColor: color.refusal,
    borderRadius: space.xl,
    padding: space.lg,
  },
  refusalLabel: { ...type.overline, color: color.refusalText },
  refusalBody: { ...type.body, color: color.textPrimary },

  defect: {
    marginBottom: space.xl,
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.refusalBorder,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  defectLabel: { ...type.overline, color: color.refusalText },
  defectBody: { ...type.body, color: color.textPrimary },
  defectReason: { ...type.caption, color: color.refusalText },
  defectRaw: { ...type.caption, color: color.textSecondary, fontStyle: 'italic' },
});
