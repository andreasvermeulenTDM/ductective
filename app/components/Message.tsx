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
import { parseReference, type ParsedReference } from '../lib/referenceFormat';
import type { AnswerShape, Citation, MessageKind } from '../lib/supabase';

type Props = {
  kind: MessageKind;
  body: string;
  citations?: Citation[];
  /**
   * ST-R06 / OQ-R2 — `meta.shape` off the wire, riding on `kind: 'answer'`.
   *
   * Transient by design: it is not a column, so a session reopened from history
   * renders a reference answer as a plain cited answer. That cost is recorded in
   * OQ-R2 and accepted — the alternative is a `messages.kind` migration, and
   * `sql/015` is still unapplied, so a new kind would fail the insert for every
   * signed-in technician.
   */
  shape?: AnswerShape;
  onCitationPress?: (c: Citation) => void;
};

export function Message({ kind, body, citations = [], shape, onCitationPress }: Props) {
  if (kind === 'user') return <UserTurn body={body} />;
  if (kind === 'refusal') return <RefusalCard body={body} />;
  if (kind === 'clarify') return <ClarifyTurn body={body} />;
  // ST-F07. This branch has to sit *above* the empty-citations check below, and
  // the ordering is the whole point: `conversational` is the one assistant kind
  // that is correctly citation-free (03-backend-fixes.md §2.1), and every other
  // kind that arrives with no citation must keep falling through to
  // `UncitedDefect`. Move this line down and a conversational reply renders as a
  // defect; move the check below it up and an uncited answer renders as prose.
  if (kind === 'conversational') return <ConversationalTurn body={body} />;

  if (citations.length === 0) return <UncitedDefect body={body} />;

  // E6.4, the strict reading: an answer whose every citation is broken is an
  // uncited claim. Well-formed prose does not make it citeable, and rendering it
  // as guidance because *something* was attached is exactly the failure the
  // no-uncited-claims rule exists to stop.
  const { usable, broken } = partition(citations);
  if (usable.length === 0) return <UncitedDefect body={body} allBroken={broken} />;

  // ST-R06 AC 4. This check sits **below** both citation nets on purpose, and
  // the ordering is the whole guarantee: `meta.shape` rides on `kind: 'answer'`,
  // so a reference answer that arrived with no usable citation has already been
  // caught above and rendered as the defect it is. Hoisting the shape check over
  // either net would give the model a kind that renders without a source, which
  // is precisely the hole `02-user-stories-fixes.md` §2.2 closed for `conversational`.
  if (shape === 'reference') {
    const reference = parseReference(body);
    // `items: []` means the body is not unambiguously data — see
    // `referenceFormat.ts`. It falls through to the ordinary answer turn rather
    // than rendering an empty spec sheet.
    if (reference.items.length > 0) {
      return (
        <ReferenceAnswer
          reference={reference}
          citations={usable}
          broken={broken}
          onCitationPress={onCitationPress}
        />
      );
    }
  }

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

/**
 * A reference answer — published data with its pages (ST-R06 / ST-R05).
 *
 * The user story is the design brief: *"a table of values with pages, not a
 * numbered list headed CHECK IN THIS ORDER — because these are not steps and
 * reading them as steps is how someone does them in order."* So this turn is
 * deliberately **not**:
 *
 *  - an **answer**: no `CHECK IN THIS ORDER`, no step numbers, no numbered
 *    anything. There is no ordinal in this component at all, which is what makes
 *    "not a checklist" structural rather than stylistic.
 *  - a **conversational turn**: it makes claims, so it carries chips, and it is
 *    a card rather than bare prose.
 *  - a **refusal**: nothing here uses a `color.refusal*` role, including the
 *    hazard-adjacent note. See below — that one matters.
 *
 * **Each row is stacked, not columned.** ST-R06 AC 7 asks that a clearance stay
 * readable at 200% font scale without the value wrapping away from its label; a
 * two-column row is exactly where that breaks, and a spec like "Service
 * clearance, condenser coil side" is long before any scaling. Label above,
 * value below, both full width: nothing to wrap away from.
 *
 * ---------------------------------------------------------------------------
 * Pairing a citation to a row, and refusing to guess
 * ---------------------------------------------------------------------------
 *
 * ST-R05 AC 4 builds citations from the surviving spec items through the same
 * mapping steps use, so item *i* and citation *i* correspond — a reference item
 * carries exactly one `source`. That gives this shape the positional anchor
 * `AnswerTurn` has never had, and per-row chips are the point: a spec sheet
 * whose numbers share one undifferentiated chip row does not tell a technician
 * which page a given value came from.
 *
 * But it is only true while the counts agree. If they do not — a dropped item,
 * a contract drift, anything — the chips fall back to a single row beneath the
 * values. **A citation attached to the wrong claim is worse than an uncited
 * one** (CLAUDE.md), so the mismatch case declines to pair rather than pairing
 * approximately.
 *
 * ---------------------------------------------------------------------------
 * The hazard-adjacent note is a pointer, not a withholding
 * ---------------------------------------------------------------------------
 *
 * ST-R05 AC 6 appends one **server constant** when a surviving spec touches the
 * hazard vocabulary — a lug torque is still a lug torque. ST-R06 AC 5 requires
 * it to be visibly distinct from the values and **not** styled as a refusal, and
 * the reason is precise: a technician who reads it as a refusal will assume the
 * values above were withheld, when they were given. So it is a steel footnote in
 * secondary text with an information glyph — the same language `adviseOnly`
 * already uses — and no red, no alert role, and no border weight of the refusal
 * card anywhere near it.
 */
function ReferenceAnswer({
  reference,
  citations,
  broken,
  onCitationPress,
}: {
  reference: ParsedReference;
  citations: Citation[];
  broken: { citation: Citation; reason: string }[];
  onCitationPress?: (c: Citation) => void;
}) {
  const { lead, items, note } = reference;
  // See the note above: pair only when the correspondence is exact.
  const perRow = citations.length === items.length && broken.length === 0;

  return (
    <View style={s.assistant}>
      {lead ? <Text style={s.body}>{lead}</Text> : null}

      <View style={s.reference}>
        <Text style={s.referenceOverline}>FROM THE MANUAL</Text>
        {items.map((item, i) => (
          <View key={`${item.spec}-${i}`} style={s.referenceRow}>
            <Text style={s.referenceSpec}>{item.spec}</Text>
            <Text style={s.referenceValue}>{item.value}</Text>
            {item.condition ? (
              <Text style={s.referenceCondition}>{item.condition}</Text>
            ) : null}
            {perRow && (
              <View style={s.referenceSource}>
                <CitationChip
                  citation={citations[i]}
                  onPress={(x) => onCitationPress?.(x)}
                />
              </View>
            )}
          </View>
        ))}
      </View>

      {/* The fallback path, and the broken ones. Broken chips sit alongside the
          good ones rather than being dropped, exactly as in `AnswerTurn`:
          discarding them would make the sheet look better sourced than it is. */}
      {(!perRow || broken.length > 0) && (
        <View style={s.citationRow}>
          {!perRow && citations.map((c) => (
            <CitationChip key={c.id} citation={c} onPress={(x) => onCitationPress?.(x)} />
          ))}
          {broken.map(({ citation, reason }) => (
            <UnresolvedCitationChip
              key={citation.id}
              citation={citation}
              reason={reason}
              onPress={(x) => onCitationPress?.(x)}
            />
          ))}
        </View>
      )}

      {note ? (
        <View style={s.referenceNote}>
          <Ionicons name="information-circle-outline" size={16} color={color.textSecondary} />
          <Text style={s.referenceNoteText}>{note}</Text>
        </View>
      ) : null}

      <View style={s.adviseOnly}>
        <Text style={s.adviseOnlyText}>
          Advice only. These are the manual's published values — verify them against
          the pages above before you act.
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
 * A conversational turn — "that worked", "thanks", "morning" (ST-F07 / F2).
 *
 * The lightest thing this component draws, on purpose. It is deliberately *not*:
 *
 *  - an **answer**: no `CHECK IN THIS ORDER` overline, no numbered steps, no
 *    citation chip row, no advise-only footer, and no empty-citation affordance.
 *    Those exist to carry and qualify a diagnostic claim; this reply makes none,
 *    so drawing any of them would dress a pleasantry as guidance.
 *  - a **refusal**: no `color.refusal*` anything and no alert role. Red in this
 *    app means stop, and reserving it is what keeps it loud when it is used.
 *  - a **clarification**: no cyan ring or wash. `ClarifyTurn` is ringed because a
 *    question waiting on the technician needs to be found again after scrolling;
 *    nothing here is owed an answer.
 *
 * What is left is a muted label and the server's own sentence. The label is the
 * one thing added rather than removed, and it earns its place: without it, the
 * only signal that this turn carries no claim is the *absence* of citations, and
 * an absence is not something a technician reads at arm's length on a roof.
 *
 * The body is a server-side constant (`lib/conversation.mjs`) — no model text
 * reaches this component — so there is no prose here to parse or structure.
 */
function ConversationalTurn({ body }: { body: string }) {
  return (
    <View style={s.conversational}>
      <Text style={s.conversationalLabel}>NOT A DIAGNOSIS</Text>
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

  /* ST-R06 — the reference sheet.

     No fill and no card: the rows are separated by hairlines instead, which is
     what makes it read as a table of data rather than as another message
     bubble. `stepNumber`'s accent pill is deliberately absent — there is no
     ordinal in this turn at all — and so is any `color.refusal*` role. */
  reference: { gap: space.md },
  referenceOverline: { ...type.overline, color: color.textSecondary },
  referenceRow: {
    gap: space.xs,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  /* Label above value, both full width — see the 200%-font-scale note on the
     component. The label is the quieter of the two: a technician on a roof is
     scanning for the number. */
  referenceSpec: { ...type.caption, color: color.textSecondary },
  referenceValue: { ...type.bodyStrong, color: color.textPrimary },
  referenceCondition: { ...type.caption, color: color.textSecondary },
  referenceSource: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },

  /* The hazard-adjacent pointer (ST-R05 AC 6 / ST-R06 AC 5). Steel and quiet,
     never red: read as a refusal it would imply the values above were withheld,
     and they were not. Same visual family as `adviseOnly` and `reading`. */
  referenceNote: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  referenceNoteText: { ...type.caption, color: color.textSecondary, flex: 1 },

  adviseOnly: {
    flexDirection: 'row',
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  adviseOnlyText: { ...type.caption, color: color.textSecondary, flex: 1 },

  /* No border, no fill, no card: the least chrome of any assistant turn, for the
     turn that carries the least. Both roles are already measured on
     `background` in tests/lib/contrastMatrix.mjs. */
  conversational: { marginBottom: space.xl, gap: space.sm },
  conversationalLabel: { ...type.overline, color: color.textSecondary },

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
