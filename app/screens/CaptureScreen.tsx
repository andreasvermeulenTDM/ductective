import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';

/**
 * Nameplate capture — design only.
 *
 * No camera is wired up. E6.3's real version sends the image to Run B's vision
 * endpoint, which does not exist yet, so simulating the capture is the honest
 * option: it shows the layout, the confirmation step, and the correction path
 * without pretending a model read anything.
 *
 * The design point worth keeping is the correction path. E6.3 requires that
 * *every* identification be correctable in ≤ 2 taps — including the ones that were
 * right — because a tech who can't override a wrong read gets sent down the wrong
 * unit's diagnostics.
 */
export function CaptureScreen() {
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
      <View style={s.center}>
        <Text style={s.label}>IDENTIFIED — SIMULATED</Text>
        <Text style={s.model}>Trane Precedent</Text>
        <Text style={s.modelSub}>YSC072E3RLA00000</Text>

        <View style={s.actions}>
          <Pressable
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
            accessibilityLabel="Wrong unit, enter the model manually"
          >
            <Text style={s.secondaryText}>Wrong — enter it myself</Text>
          </Pressable>
        </View>

        <Text style={s.warn}>
          Prototype: nothing was photographed and no model read this. Fixed text.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.center}>
      <View style={s.frame}>
        <Text style={s.frameHint}>Nameplate goes here</Text>
      </View>
      <Text style={s.title}>Shoot the nameplate</Text>
      <Text style={s.hint}>
        Get the model and serial block in frame. Faded labels are fine — you can
        correct anything I misread.
      </Text>

      <View style={s.actions}>
        <Pressable
          onPress={() => { setState('reading'); setTimeout(() => setState('read'), 1200); }}
          style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Simulate taking a photo"
        >
          <Text style={s.primaryText}>Simulate capture</Text>
        </Pressable>
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

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  frame: {
    height: 180,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  frameHint: { ...type.caption, color: color.textSecondary },
  title: { ...type.title, color: color.textPrimary },
  hint: { ...type.body, color: color.textSecondary },

  label: { ...type.caption, color: color.accent, letterSpacing: 1 },
  model: { ...type.display, color: color.textPrimary },
  modelSub: { ...type.body, color: color.textSecondary },

  actions: { gap: space.sm, marginTop: space.lg },
  primary: {
    minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: color.accent,
  },
  primaryPressed: { backgroundColor: color.interactive },
  primaryText: { ...type.bodyStrong, color: color.textOnAccent },
  secondary: {
    minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong,
  },
  secondaryPressed: { backgroundColor: color.surface },
  secondaryText: { ...type.bodyStrong, color: color.textPrimary },

  warn: { ...type.caption, color: color.refusal, marginTop: space.lg, textAlign: 'center' },
});
