import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';

/**
 * Nameplate capture — design only. Mockup s2 (viewfinder) and s3 (confirmation).
 *
 * No camera is wired up. E6.3's real version sends the image to Run B's vision
 * endpoint, which does not exist yet, so simulating the capture is the honest
 * option: it shows the layout, the confirmation step, and the correction path
 * without pretending a model read anything.
 *
 * The design point worth keeping is the correction path. E6.3 requires that
 * *every* identification be correctable in ≤ 2 taps — including the ones that were
 * right — because a tech who can't override a wrong read gets sent down the wrong
 * unit's diagnostics. "Type the model instead" is on the viewfinder too, so a
 * denied camera permission is never a dead end.
 *
 * Departure from the mockup: the confirmation shows "High confidence" without the
 * numeric 0.94. A raw model score is an internal that a tech can't calibrate
 * against, and it invites trusting a decimal over a nameplate they can read.
 */
export function CaptureScreen({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'reading' | 'read'>('idle');

  if (state === 'reading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={color.accent} />
        <Text style={s.hint}>Reading the nameplate…</Text>
      </View>
    );
  }

  if (state === 'read') {
    return (
      <View style={s.confirm}>
        <Text style={s.overline}>READ FROM THE PLATE</Text>

        <View style={s.card}>
          <Text style={s.maker}>Trane</Text>
          <Text style={s.model}>Precedent YSC072E3</Text>
          <View style={s.tags}>
            {['Packaged rooftop', '6 ton', 'R-410A'].map((t) => (
              <View key={t} style={s.tag}>
                <Text style={s.tagText}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={s.cardFoot}>
            <Text style={s.confidence}>High confidence</Text>
            <Text style={s.docCount}>3 documents</Text>
          </View>
        </View>

        <Text style={s.overline}>I'LL ANSWER FROM</Text>
        <View style={s.docList}>
          {[
            'RT-SVX23R-EN — Precedent Rooftop IOM',
            'RT-SVX21AD-EN — Precedent Economizer',
            'R-410A pressure-temperature chart',
          ].map((d) => (
            <Text key={d} style={s.doc} numberOfLines={1}>
              {d}
            </Text>
          ))}
        </View>

        <View style={s.actions}>
          <Pressable
            onPress={onDone}
            style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Confirm this unit and continue"
          >
            <Text style={s.primaryText}>That's the unit</Text>
          </Pressable>

          {/* One tap to reach correction, from either outcome. E6.3. */}
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Wrong unit, pick it myself"
          >
            <Text style={s.secondaryText}>Wrong unit, let me pick</Text>
          </Pressable>
        </View>

        <Text style={s.warn}>
          Prototype: nothing was photographed and no model read this. Fixed text.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.viewfinder}>
      <View style={s.frame}>
        <View style={[s.corner, s.cornerTL]} />
        <View style={[s.corner, s.cornerTR]} />
        <View style={[s.corner, s.cornerBL]} />
        <View style={[s.corner, s.cornerBR]} />
        <Text style={s.frameHint}>RTU DATA PLATE</Text>
      </View>

      <Text style={s.hint}>Fill the frame with the plate. Glare is fine, I'll ask if I can't read it.</Text>

      <View style={s.actions}>
        <Pressable
          onPress={() => { setState('reading'); setTimeout(() => setState('read'), 1200); }}
          style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Simulate taking a photo of the nameplate"
        >
          <Text style={s.primaryText}>Simulate capture</Text>
        </Pressable>

        {/* Always present, so a denied camera permission is never a dead end. */}
        <Pressable
          style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Enter the model number manually instead"
        >
          <Text style={s.secondaryText}>Type the model instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const CORNER = 42;

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.md },
  viewfinder: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
    backgroundColor: color.backgroundSunken,
  },

  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: color.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.sm },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.sm },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.sm },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.sm },
  frameHint: { ...type.overline, color: color.textSecondary },

  hint: { ...type.body, color: color.textPrimary, textAlign: 'center' },

  confirm: { flex: 1, padding: space.lg, gap: space.md },
  overline: { ...type.overline, color: color.textSecondary },

  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: space.xl,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  maker: { ...type.label, color: color.textSecondary },
  model: { ...type.display, color: color.textPrimary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  tagText: { ...type.chip, color: color.textPrimary },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  confidence: { ...type.label, color: color.accent, flex: 1 },
  docCount: { ...type.label, color: color.textSecondary },

  docList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  doc: {
    ...type.label,
    color: color.textPrimary,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },

  actions: { gap: space.sm, marginTop: space.lg },
  primary: {
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  primaryPressed: { backgroundColor: color.pressed },
  primaryText: { ...type.bodyStrong, color: color.textOnInteractive },
  secondary: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  secondaryPressed: { backgroundColor: color.surface },
  secondaryText: { ...type.bodyStrong, color: color.textPrimary },

  warn: { ...type.caption, color: color.refusalText, textAlign: 'center', marginTop: space.md },
});
