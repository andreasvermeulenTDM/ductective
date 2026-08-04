import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { OfflineState, PermissionDenied } from '../components/Chrome';

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
 * unit's diagnostics. Manual entry is reachable from every state here, so a denied
 * permission, a dead network, and an unreadable plate all end somewhere useful.
 *
 * Departure from the mockup: the confirmation shows "High confidence" without the
 * numeric 0.94. A raw model score is an internal that a tech can't calibrate
 * against, and it invites trusting a decimal over a nameplate they can read.
 */
type CaptureState =
  | 'idle'      // empty  — viewfinder, nothing captured
  | 'reading'   // loading
  | 'read'      // success
  | 'failed'    // error  — the plate came back unreadable
  | 'denied'    // error  — camera permission refused
  | 'offline'   // offline — no signal to reach the vision endpoint
  | 'manual';   // the escape hatch every failure routes to

export function CaptureScreen({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<CaptureState>('idle');
  const [model, setModel] = useState('');

  if (state === 'reading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={color.accent} />
        <Text style={s.hint}>Reading the nameplate…</Text>
      </View>
    );
  }

  if (state === 'denied') {
    return (
      <PermissionDenied
        onManualEntry={() => setState('manual')}
        onOpenSettings={() => setState('idle')}
      />
    );
  }

  if (state === 'offline') {
    return (
      <OfflineState
        title="No signal to read the plate"
        detail="Identifying a unit from a photo needs a connection. You can type the model instead and carry on — that works offline."
        onRetry={() => setState('idle')}
        action={{ label: 'Type the model instead', onPress: () => setState('manual') }}
      />
    );
  }

  if (state === 'failed') {
    return (
      <View style={s.center}>
        <View style={s.errorCard}>
          <View style={s.errorHead}>
            <Text style={s.errorGlyph}>!</Text>
            <Text style={s.errorTitle}>Couldn't read that plate</Text>
          </View>
          <Text style={s.errorBody}>
            The model line didn't come through clearly enough to be sure, and a
            guess here sends you down the wrong unit's diagnostics.
          </Text>
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Retake the photo"
          >
            <Text style={s.primaryText}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={() => setState('manual')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Type the model instead"
          >
            <Text style={s.secondaryText}>Type the model instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === 'manual') {
    return (
      <ScrollView style={s.fill} contentContainerStyle={s.confirm}>
        <Text style={s.overline}>TYPE THE MODEL</Text>
        <Text style={s.hint}>
          Off the data plate — manufacturer and model number. Partial is fine, I'll
          tell you if it isn't something I cover.
        </Text>

        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="e.g. Trane YSC072E3 or Carrier 50HC"
          placeholderTextColor={color.textSecondary}
          style={s.input}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Unit model number"
        />

        <View style={s.actions}>
          <Pressable
            onPress={onDone}
            disabled={!model.trim()}
            style={({ pressed }) => [
              s.primary,
              pressed && s.primaryPressed,
              !model.trim() && s.primaryDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Use this model and continue"
            accessibilityState={{ disabled: !model.trim() }}
          >
            <Text style={s.primaryText}>Use this unit</Text>
          </Pressable>
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Go back to the camera"
          >
            <Text style={s.secondaryText}>Use the camera instead</Text>
          </Pressable>
        </View>

        {/* The typed model reaches the chat screen but not the session row:
            `equipment` is set when a session is created, and there is no update
            path in the store. Recorded as a CONTRACT MISMATCH against Stage 3. */}
        <Text style={s.warn}>
          Prototype: the model you type isn't attached to the session yet.
        </Text>
      </ScrollView>
    );
  }

  if (state === 'read') {
    return (
      <ScrollView style={s.fill} contentContainerStyle={s.confirm}>
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
            onPress={() => setState('manual')}
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
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.sunken} contentContainerStyle={s.viewfinder}>
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
          onPress={() => setState('manual')}
          style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Enter the model number manually instead"
        >
          <Text style={s.secondaryText}>Type the model instead</Text>
        </Pressable>
      </View>

      <StateSimulator onPick={setState} />
    </ScrollView>
  );
}

/**
 * Reaches the failure states that no real camera can produce here.
 *
 * E6.6 requires each state to be *reachable* and screenshotted. Without a camera
 * or a vision endpoint, denied / unreadable / offline are otherwise unreachable,
 * and a state nobody can open is a state nobody has checked.
 *
 * `__DEV__` is false in any production build, so this cannot ship. It goes away
 * on its own once the real camera lands and these states arise for real.
 */
function StateSimulator({ onPick }: { onPick: (s: CaptureState) => void }) {
  if (!__DEV__) return null;

  const states: { id: CaptureState; label: string }[] = [
    { id: 'failed', label: 'unreadable' },
    { id: 'denied', label: 'denied' },
    { id: 'offline', label: 'offline' },
  ];

  return (
    <View style={s.simulator}>
      <Text style={s.simulatorLabel}>DEV — REACH A FAILURE STATE</Text>
      <View style={s.simulatorRow}>
        {states.map((x) => (
          <Pressable
            key={x.id}
            onPress={() => onPick(x.id)}
            style={({ pressed }) => [s.simulatorButton, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Simulate the ${x.label} state`}
          >
            <Text style={s.simulatorButtonText}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const CORNER = 42;

const s = StyleSheet.create({
  fill: { flex: 1 },
  sunken: { flex: 1, backgroundColor: color.backgroundSunken },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.md },

  /**
   * These are `contentContainerStyle` on a ScrollView, not a View.
   *
   * The confirmation renders 713dp of content, which fits a 812dp phone and is
   * silently cut off on a 667dp one — the warning line just wasn't there. Without
   * a scroll container the overflow is unreachable rather than merely below the
   * fold. `flexGrow` keeps the vertical centring when content is short.
   *
   * This is also what E6.7's 200% font-size requirement needs: at that scale
   * every one of these screens overflows on every device.
   */
  viewfinder: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
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

  confirm: { flexGrow: 1, padding: space.lg, paddingBottom: space.xxl, gap: space.md },
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

  input: {
    minHeight: MIN_TOUCH + 8,
    ...type.body,
    color: color.textPrimary,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.lg,
  },

  errorCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  errorHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  errorGlyph: { ...type.title, color: color.refusalText },
  errorTitle: { ...type.heading, color: color.textPrimary, flex: 1 },
  errorBody: { ...type.body, color: color.textSecondary },

  actions: { gap: space.sm, marginTop: space.lg },
  primary: {
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  primaryPressed: { backgroundColor: color.pressed },
  primaryDisabled: { backgroundColor: color.border },
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

  simulator: { marginTop: space.xl, gap: space.sm },
  simulatorLabel: { ...type.overline, color: color.textSecondary, textAlign: 'center' },
  simulatorRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  simulatorButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  simulatorButtonText: { ...type.chip, color: color.textSecondary },

  warn: { ...type.caption, color: color.refusalText, textAlign: 'center', marginTop: space.md },
});
