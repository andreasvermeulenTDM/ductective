/**
 * Citation.tsx — the chip, and the source view it opens.
 *
 * E6.4 makes this the most important control in the app: it is how a technician
 * verifies a claim before acting on it. Two things follow from that.
 *
 * 1. The chip is small by design — it sits inline with prose and must not break
 *    the rhythm of a sentence — but its *touch target* is 48dp via `touchSlop`.
 *    E6.7's floor is measured on the target, not the ink.
 * 2. Opening a source never costs you the answer. On a phone it is a sheet over
 *    the conversation; on a tablet it opens beside the claim (E6.9). Either way
 *    the answer stays on screen behind or next to it.
 */

import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { color, type, space, radius, MIN_TOUCH, touchSlop } from '../theme/tokens';
import type { Citation } from '../lib/supabase';

/** Rendered chip height. Kept in one place so the slop math can't drift from it. */
const CHIP_HEIGHT = 26;

/** `RT-SVX23R-EN — Precedent Rooftop IOM` → `RT-SVX23R-EN`, so the chip fits inline. */
export function shortDoc(name: string) {
  return name.split('—')[0].trim();
}

export function CitationChip({
  citation,
  onPress,
}: {
  citation: Citation;
  onPress: (c: Citation) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(citation)}
      hitSlop={touchSlop(CHIP_HEIGHT, 96)}
      style={s.chipTouch}
      accessibilityRole="button"
      accessibilityLabel={`Source: ${shortDoc(citation.source_document)}, page ${citation.page}`}
      accessibilityHint="Opens the cited passage without leaving the answer"
    >
      {({ pressed }) => (
        <View style={[s.chip, pressed && s.chipPressed]}>
          <Text style={s.chipText} numberOfLines={1}>
            {shortDoc(citation.source_document)} · p.{citation.page}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The source itself.
 *
 * The mockup shows the retrieved passage quoted here, which is the right design —
 * a page number a tech has to go find is weaker verification than the sentence
 * itself. The prototype has no passage text to show: the persisted citation
 * carries `claim` (what the citation is attached to) but not the retrieved span,
 * and the corpus is gitignored and not on the device. Both gaps are recorded as
 * CONTRACT MISMATCH in `.pipeline/04-frontend-design-pass.md` rather than papered
 * over with placeholder prose.
 */
function SourceBody({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <>
      <View style={s.sourceHead}>
        <View style={s.sourceIcon}>
          <Text style={s.sourceIconGlyph}>§</Text>
        </View>
        <View style={s.sourceHeadText}>
          <Text style={s.sourceDoc}>{citation.source_document}</Text>
          <Text style={s.sourcePage}>Page {citation.page} · freely published OEM</Text>
        </View>
      </View>

      {citation.claim ? (
        <View style={s.passage}>
          <Text style={s.passageLabel}>WHAT THIS IS ATTACHED TO</Text>
          <Text style={s.passageText}>{citation.claim}</Text>
        </View>
      ) : null}

      <View style={s.unavailable}>
        <Text style={s.unavailableText}>
          The page itself isn't on the device — the corpus isn't bundled with the
          app. Open {shortDoc(citation.source_document)} at page {citation.page} to
          verify.
        </Text>
      </View>

      <Text style={s.protoWarn}>
        Prototype — this citation has not been checked against the document.
      </Text>

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [s.closeButton, pressed && s.closeButtonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Close the source and go back to the answer"
      >
        <Text style={s.closeText}>Back to the answer</Text>
      </Pressable>
    </>
  );
}

/** Phone: a sheet over the conversation, dismissible by tapping away or back. */
export function CitationSheet({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={!!citation}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close source">
        {/* A View, not a Pressable. This only has to swallow taps so they don't
            reach the backdrop and close the sheet — making it a control gives
            screen readers a phantom unlabelled button that does nothing (E6.7). */}
        <View style={s.sheet} onStartShouldSetResponder={() => true}>
          <View style={s.grabber} />
          <ScrollView>{citation && <SourceBody citation={citation} onClose={onClose} />}</ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

/** Tablet: the source opens beside the claim rather than over it (E6.9). */
export function SourcePanel({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  return (
    <View style={s.panel}>
      {citation ? (
        <ScrollView>
          <SourceBody citation={citation} onClose={onClose} />
        </ScrollView>
      ) : (
        <View style={s.panelEmpty}>
          <Text style={s.panelEmptyText}>
            Tap any citation and the page it came from opens here, beside the claim.
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  /**
   * The 48dp target is real layout, not `hitSlop`.
   *
   * hitSlop is the tidier expression of the idea, but react-native-web does not
   * implement it, so on web the target would silently stay 26dp — and E6.7 would
   * be "met" only on the platforms nobody audits it on. The Pressable owns the
   * height; the pill inside keeps the mockup's size. hitSlop is left on as well,
   * so native gets the same floor even where padding is clipped.
   */
  chipTouch: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  chip: {
    height: CHIP_HEIGHT,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  chipPressed: { backgroundColor: color.surfaceRaised, borderColor: color.accent },
  chipText: { ...type.chip, color: color.accent },

  backdrop: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: space.xl,
    borderTopRightRadius: space.xl,
    borderTopWidth: 1,
    borderColor: color.border,
    padding: space.xl,
    maxHeight: '80%',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.borderStrong,
    alignSelf: 'center',
    marginBottom: space.lg,
  },

  panel: {
    width: 312,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
  },
  panelEmpty: { flex: 1, justifyContent: 'center' },
  panelEmptyText: { ...type.caption, color: color.textSecondary, textAlign: 'center' },

  sourceHead: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  sourceIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: color.accentSurface,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceIconGlyph: { ...type.heading, color: color.accent },
  sourceHeadText: { flex: 1, gap: 2 },
  sourceDoc: { ...type.heading, color: color.textPrimary },
  sourcePage: { ...type.caption, color: color.textSecondary },

  passage: {
    backgroundColor: color.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    gap: space.sm,
    marginBottom: space.md,
  },
  passageLabel: { ...type.overline, color: color.textSecondary },
  passageText: { ...type.body, color: color.textPrimary },

  unavailable: { marginBottom: space.md },
  unavailableText: { ...type.caption, color: color.textSecondary },

  protoWarn: { ...type.caption, color: color.refusalText, marginBottom: space.lg },

  closeButton: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  closeButtonPressed: { backgroundColor: color.pressed },
  closeText: { ...type.bodyStrong, color: color.textOnInteractive },
});
