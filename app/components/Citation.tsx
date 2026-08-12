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

import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from './Tactile';
import { color, type, space, radius, MIN_TOUCH, touchSlop } from '../theme/tokens';
import { resolve, PAGE_TEXT_COPY } from '../lib/citations';
import { fetchPageText, withPageAnchor, type PageText } from '../lib/pageText';
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
    <ScalePressable
      onPress={() => onPress(citation)}
      hitSlop={touchSlop(CHIP_HEIGHT, 96)}
      haptic="tap"
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
    </ScalePressable>
  );
}

/**
 * A citation that does not resolve — E6.4.
 *
 * Drawn as a defect rather than a citation: alert red, an explicit "unresolved"
 * word, and no attempt to render whatever partial document name or page number
 * came through. The failure mode this exists to prevent is a chip reading
 * `p.0` or ` · p.undefined` that still looks authoritative enough to act on.
 *
 * It stays tappable on purpose. A tech who sees it needs to know *why* it broke
 * and that the claim above it is not backed — silently disabling the control
 * would leave them guessing.
 */
export function UnresolvedCitationChip({
  citation,
  reason,
  onPress,
}: {
  citation: Citation;
  reason: string;
  onPress: (c: Citation) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(citation)}
      hitSlop={touchSlop(CHIP_HEIGHT, 96)}
      style={s.chipTouch}
      accessibilityRole="button"
      accessibilityLabel={`Unresolved source. ${reason}`}
      accessibilityHint="Explains why this citation could not be resolved"
    >
      {({ pressed }) => (
        <View style={[s.chipBroken, pressed && s.chipBrokenPressed]}>
          <Text style={s.chipBrokenText} numberOfLines={1}>
            ! source unresolved
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The source itself.
 *
 * The mockup shows the retrieved passage quoted here, and as of M9 it exists:
 * `snippet` is the retrieved chunk's text, persisted with the citation, so the
 * passage renders with no PDF on the device. (The CONTRACT MISMATCH this comment
 * used to record is resolved — the passage was the gap.) Rows persisted before
 * sql/006 have no snippet; they say so instead of pretending.
 *
 * `verified` renders as provenance: 'exact' means the passage IS the source text
 * (it came from the database, not the model). 'fuzzy' — reserved for a future
 * model-copied-span design — must look visibly different, per M10.
 */
function SourceBody({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const resolution = resolve(citation);

  // E6.4: an unresolved citation explains itself and stops. It does not fall
  // through to the normal layout, which would print a half-empty document name
  // and a nonexistent page as though they were a real reference.
  if (!resolution.resolvable) {
    return (
      <>
        <View style={s.sourceHead}>
          <View style={s.sourceIconBroken}>
            <Text style={s.sourceIconBrokenGlyph}>!</Text>
          </View>
          <View style={s.sourceHeadText}>
            <Text style={s.sourceDoc}>Source unresolved</Text>
            <Text style={s.sourcePage}>{resolution.reason}</Text>
          </View>
        </View>

        <View style={s.brokenNotice}>
          <Text style={s.brokenNoticeText}>
            The claim this was attached to is not backed by a source you can check.
            Treat it as unverified and report it — this is a defect, not something
            to work around.
          </Text>
        </View>

        <Pressable
          onPress={onClose}
          style={({ pressed }) => [s.closeButton, pressed && s.closeButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Close and go back to the answer"
        >
          <Text style={s.closeText}>Back to the answer</Text>
        </Pressable>
      </>
    );
  }

  return (
    <>
      <View style={s.sourceHead}>
        <View style={s.sourceIcon}>
          <Ionicons name="document-text-outline" size={20} color={color.accent} />
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

      {citation.snippet ? (
        <View style={s.passage}>
          <Text style={s.passageLabel}>
            {citation.verified === 'fuzzy' ? 'FROM THE PAGE · CLOSEST MATCH' : 'FROM THE PAGE'}
          </Text>
          <ScrollView style={s.snippetScroll} nestedScrollEnabled>
            <Text style={s.snippetText}>{citation.snippet}</Text>
          </ScrollView>
          <Text style={s.snippetProvenance}>
            {citation.verified === 'fuzzy'
              ? 'Approximate match to the source page — verify the wording on the page itself.'
              : `Verbatim from ${shortDoc(citation.source_document)} p.${citation.page}, as stored in the knowledge base.`}
          </Text>
        </View>
      ) : (
        <View style={s.unavailable}>
          <Text style={s.unavailableText}>
            This citation was saved before passages were stored. Open{' '}
            {shortDoc(citation.source_document)} at page {citation.page} to verify.
          </Text>
        </View>
      )}

      <WholePage citation={citation} />

      <Text style={s.protoWarn}>
        The passage is verbatim from the manual; whether it supports the claim
        attached to it has not been scored yet — that is Run B's eval.
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

/**
 * ST-F14 / F4 — the whole page the passage came from.
 *
 * The owner asked to "see a preview of the manual page". This is Route B from
 * `.pipeline/02-user-stories-fixes.md` §2.3, chosen by the owner over page
 * rasters: the page's **extracted text**, with the cited block marked where it
 * sits on the page, plus a link to the manufacturer's own PDF where one exists.
 * `lib/pageText.ts` carries the pricing of the route not taken.
 *
 * Three rules this component holds:
 *
 *  1. **The snippet is not demoted.** `FROM THE PAGE` stays exactly where it was,
 *     above this, because it is the passage the claim actually rests on. This sits
 *     below it, collapsed, so the sheet still opens on the evidence rather than on
 *     a wall of page text.
 *  2. **The honesty line is not collapsible and comes first.** It renders above
 *     the text, every time the page is open — the shape ST-A18 AC 3 established
 *     for the company privacy notice. Extracted text is not a photograph of the
 *     page and a technician hunting a wiring diagram has to be told that.
 *  3. **A failure is a sentence, never an error card.** `fetchPageText` resolves
 *     `null` for every failure there is, and there is nothing here a technician on
 *     a roof can act on, so the fallback is one plain line. No retry, no red, no
 *     empty expansion.
 */
function WholePage({ citation }: { citation: Citation }) {
  const [page, setPage] = useState<PageText | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(
    citation.chunk_id ? 'loading' : 'unavailable'
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Pre-sql/006 citations carry no chunk_id and there is nothing to fetch, so
    // the control is never offered for one. `fetchPageText` returns null rather
    // than throwing, so there is no catch here and no error state to render.
    if (!citation.chunk_id) return;
    let live = true;
    setState('loading');
    setOpen(false);
    fetchPageText(citation).then((result) => {
      if (!live) return;
      setPage(result);
      setState(result ? 'ready' : 'unavailable');
    });
    return () => {
      live = false;
    };
  }, [citation]);

  // Nothing to say, and nothing the technician could do about it: a citation
  // saved before passages were stored already explains itself above.
  if (state === 'unavailable' && !citation.chunk_id) return null;

  if (state === 'loading') {
    return <Text style={s.pageStatus}>{PAGE_TEXT_COPY.loading}</Text>;
  }

  if (state === 'unavailable' || !page) {
    return <Text style={s.pageStatus}>{PAGE_TEXT_COPY.unavailable}</Text>;
  }

  return (
    <View style={s.pageWrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [s.pageToggle, pressed && s.pageTogglePressed]}
        accessibilityRole="button"
        accessibilityLabel={open ? PAGE_TEXT_COPY.collapse : PAGE_TEXT_COPY.expand}
        accessibilityState={{ expanded: open }}
      >
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={color.accent}
        />
        <Text style={s.pageToggleText}>
          {open ? PAGE_TEXT_COPY.collapse : PAGE_TEXT_COPY.expand}
        </Text>
      </Pressable>

      {open && (
        <>
          <Text style={s.pageHonesty}>{PAGE_TEXT_COPY.honesty}</Text>

          {/* maxHeight, matching `snippetScroll`: a twelve-block page must not
              push "Back to the answer" off a 667dp screen. */}
          <ScrollView style={s.pageScroll} nestedScrollEnabled>
            {page.blocks.map((block) => (
              <View
                key={block.chunkId}
                style={[s.pageBlock, block.cited && s.pageBlockCited]}
                accessibilityRole="text"
                accessibilityLabel={
                  block.cited ? `${PAGE_TEXT_COPY.cited}. ${block.text}` : block.text
                }
              >
                {block.cited && <Text style={s.pageCitedLabel}>{PAGE_TEXT_COPY.cited}</Text>}
                <Text style={s.pageBlockText}>{block.text}</Text>
              </View>
            ))}
          </ScrollView>

          {page.sourceUrl && (
            <View style={s.pageLinkWrap}>
              <Pressable
                onPress={() => void Linking.openURL(withPageAnchor(page.sourceUrl!, page.page))}
                style={({ pressed }) => [s.pageLink, pressed && s.pageTogglePressed]}
                accessibilityRole="link"
                accessibilityLabel={PAGE_TEXT_COPY.link}
                accessibilityHint={PAGE_TEXT_COPY.linkNote}
              >
                <Ionicons name="open-outline" size={16} color={color.accent} />
                <Text style={s.pageLinkText}>{PAGE_TEXT_COPY.link}</Text>
              </Pressable>
              <Text style={s.pageLinkNote}>{PAGE_TEXT_COPY.linkNote}</Text>
            </View>
          )}
        </>
      )}
    </View>
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
  // maxWidth so a long document name ellipses inside the row rather than running
  // off the screen edge — reachable past 200%, where a chip can exceed the column.
  chipTouch: { minHeight: MIN_TOUCH, justifyContent: 'center', maxWidth: '100%' },
  chip: {
    // minHeight, not height. A React Native View is overflow:hidden, so a fixed
    // height clips its own label the moment the OS font scale goes up — at 200%
    // this pill was 24dp around 32dp of text, on the app's most-tapped control.
    // E6.7 requires text to survive 200% without clipping.
    minHeight: CHIP_HEIGHT,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  chipPressed: { backgroundColor: color.surfaceRaised, borderColor: color.accent },
  chipText: { ...type.chip, color: color.accent },

  chipBroken: {
    minHeight: CHIP_HEIGHT,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  chipBrokenPressed: { borderColor: color.refusal },
  chipBrokenText: { ...type.chip, color: color.refusalText },

  sourceIconBroken: {
    minWidth: 42,
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: color.refusalSurface,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceIconBrokenGlyph: { ...type.heading, color: color.refusalText },
  brokenNotice: {
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
    marginBottom: space.lg,
  },
  brokenNoticeText: { ...type.body, color: color.textPrimary },

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
    minWidth: 42,
    minHeight: 42,
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
  snippetScroll: { maxHeight: 260 },
  snippetText: { ...type.body, color: color.textPrimary },
  snippetProvenance: { ...type.caption, color: color.textSecondary, marginTop: space.sm },
  passageText: { ...type.body, color: color.textPrimary },

  unavailable: { marginBottom: space.md },
  unavailableText: { ...type.caption, color: color.textSecondary },

  /* ST-F14 — the whole page, below the snippet and collapsed by default. */
  pageWrap: { marginBottom: space.md, gap: space.sm },
  pageStatus: { ...type.caption, color: color.textSecondary, marginBottom: space.md },
  pageToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  pageTogglePressed: { backgroundColor: color.surfaceRaised },
  pageToggleText: { ...type.label, color: color.accent },
  pageHonesty: { ...type.caption, color: color.textSecondary },
  pageScroll: {
    maxHeight: 260,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.background,
  },
  pageBlock: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  /* The cited block, marked where it sits on the page — the whole gain of this
     route over the snippet alone. Existing tokens only; E6.8 forbids new hex. */
  pageBlockCited: {
    backgroundColor: color.accentSurface,
    borderLeftWidth: 3,
    borderLeftColor: color.accentBorder,
  },
  pageCitedLabel: { ...type.overline, color: color.accent },
  pageBlockText: { ...type.body, color: color.textPrimary },
  pageLinkWrap: { gap: space.xs },
  pageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  pageLinkText: { ...type.label, color: color.accent },
  pageLinkNote: { ...type.caption, color: color.textSecondary },

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
