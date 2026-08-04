/**
 * Chrome.tsx — shared shell pieces: the prototype banner, state views, navigation.
 *
 * Two departures from the mockup, both recorded in
 * `.pipeline/04-frontend-design-pass.md`:
 *
 *  - The mockup's third tab (Settings) is omitted. No Epic 6 story defines it and
 *    it has no content; an empty tab is the dead end E6.6 forbids. Two tabs, with
 *    the camera as the composer's action, is the mockup's actual structural idea.
 *  - The header's LTE pill is not drawn. Reporting "LTE" without a network API is
 *    a decorative lie, and no netinfo dependency is justified for a design pass.
 *    `ConnectionChip` renders only once a request has actually failed on the
 *    network — the half of the state that matters on a roof (E6.6).
 */

import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { RAIL_WIDTH } from '../theme/layout';

/**
 * Persistent, non-dismissible. While mockDiagnostics is the answer source, a user
 * must never be able to forget it — including future-you, six weeks from now,
 * demoing this to a technician.
 */
export function PrototypeBanner() {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>
        DESIGN PROTOTYPE · answers are canned, citations unverified
      </Text>
    </View>
  );
}

/** The unit and symptom this session is about, per mockup s4–s6. */
export function SessionHeader({
  title,
  equipment,
  offline,
}: {
  title: string;
  equipment?: string | null;
  offline?: boolean;
}) {
  return (
    <View style={s.sessionHeader}>
      <View style={s.sessionHeaderText}>
        <Text style={s.sessionUnit} numberOfLines={1}>
          {equipment ?? 'Unit not identified'}
        </Text>
        <Text style={s.sessionSymptom} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {offline && <ConnectionChip />}
    </View>
  );
}

/** Only ever rendered offline — see the note at the top of this file. */
export function ConnectionChip() {
  return (
    <View style={s.offlineChip} accessibilityRole="text" accessibilityLabel="No signal">
      <View style={s.offlineDot} />
      <Text style={s.offlineChipText}>NO SIGNAL</Text>
    </View>
  );
}

/** Offline banner, mockup s9. Says what survives and what happens next. */
export function OfflineNotice() {
  return (
    <View style={s.offlineNotice}>
      <Text style={s.offlineNoticeText}>
        <Text style={s.offlineNoticeStrong}>You're offline. </Text>
        Everything already answered stays here. Ask again when you have signal.
      </Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={color.accent} />
      <Text style={s.centerText}>{label}</Text>
    </View>
  );
}

/**
 * A transport failure — deliberately unlike a refusal.
 *
 * Steel surface, one red glyph, and an action. A refusal is red all over and has
 * no action. E5.2 requires the two to be tellable apart at a glance, and this is
 * the other half of that pair.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <View style={s.center}>
      <View style={s.errorCard}>
        <View style={s.errorHead}>
          <Text style={s.errorGlyph}>!</Text>
          <Text style={s.errorTitle}>{title}</Text>
        </View>
        <Text style={s.centerText}>{detail}</Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.centerText}>{detail}</Text>
    </View>
  );
}

/**
 * Full-screen offline state, for camera and history — E6.6.
 *
 * Distinct from `ErrorState` on purpose. "You're offline" and "something broke"
 * send a technician to two different places, and on a roof the first is the
 * common case. It carries a retry because signal comes back.
 */
export function OfflineState({
  title,
  detail,
  onRetry,
  action,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.center}>
      <View style={s.offlineCard}>
        <View style={s.errorHead}>
          <Text style={s.offlineGlyph}>⚠</Text>
          <Text style={s.errorTitle}>{title}</Text>
        </View>
        <Text style={s.centerText}>{detail}</Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
        )}
        {action && (
          <Pressable
            onPress={action.onPress}
            style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text style={s.secondaryButtonText}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * Camera permission denied — E6.3 and E6.6.
 *
 * The story's requirement is that a denied permission "routes to manual model
 * entry rather than a dead end", so the escape is the primary action here, not a
 * footnote under an apology. Opening Settings is offered second: a tech standing
 * on a roof wants to get on with the job, not fix an OS setting.
 */
export function PermissionDenied({
  onManualEntry,
  onOpenSettings,
}: {
  onManualEntry: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <View style={s.center}>
      <View style={s.errorCard}>
        <View style={s.errorHead}>
          <Text style={s.errorGlyph}>⃠</Text>
          <Text style={s.errorTitle}>No camera access</Text>
        </View>
        <Text style={s.centerText}>
          Ductective can't open the camera, so it can't read a data plate. You can
          still tell me the model and carry on.
        </Text>
        <Pressable
          onPress={onManualEntry}
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Type the model instead"
        >
          <Text style={s.buttonText}>Type the model instead</Text>
        </Pressable>
        {onOpenSettings && (
          <Pressable
            onPress={onOpenSettings}
            style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open system settings to grant camera access"
          >
            <Text style={s.secondaryButtonText}>Grant access in Settings</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export type Tab = 'chat' | 'history';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'chat', label: 'Ask', glyph: '◈' },
  { id: 'history', label: 'History', glyph: '↻' },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={s.tabBar}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={({ pressed }) => [s.tab, pressed && s.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Text style={[s.tabGlyph, on && s.tabOn]}>{t.glyph}</Text>
            <Text style={[s.tabText, on && s.tabOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tablet navigation: a side rail, so the session list keeps the width (E6.9). */
export function NavRail({
  active,
  onChange,
  onCapture,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  onCapture: () => void;
}) {
  return (
    <View style={s.rail}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={({ pressed }) => [s.railItem, on && s.railItemOn, pressed && s.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Text style={[s.tabGlyph, on && s.tabOn]}>{t.glyph}</Text>
            <Text style={[s.tabText, on && s.tabOn]}>{t.label}</Text>
          </Pressable>
        );
      })}

      <Pressable
        onPress={onCapture}
        style={({ pressed }) => [s.railCapture, pressed && s.buttonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Photograph the nameplate"
      >
        <Text style={s.railCaptureGlyph}>◉</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    backgroundColor: color.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: color.accent,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  bannerText: { ...type.caption, color: color.accent, textAlign: 'center', letterSpacing: 0.4 },

  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  sessionHeaderText: { flex: 1, minWidth: 0 },
  sessionUnit: { ...type.bodyStrong, color: color.textPrimary },
  sessionSymptom: { ...type.caption, color: color.textSecondary },

  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  offlineDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: color.statusOffline },
  offlineChipText: { ...type.chip, color: color.statusOffline },

  offlineNotice: {
    margin: space.lg,
    marginBottom: 0,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  offlineNoticeText: { ...type.caption, color: color.textPrimary },
  offlineNoticeStrong: { fontFamily: type.bodyStrong.fontFamily },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  centerText: { ...type.body, color: color.textSecondary, textAlign: 'center' },
  emptyTitle: { ...type.title, color: color.textPrimary, textAlign: 'center' },

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

  offlineCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.surface,
  },
  offlineGlyph: { ...type.title, color: color.refusalText },

  secondaryButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  secondaryButtonText: { ...type.bodyStrong, color: color.textPrimary },

  button: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  buttonPressed: { backgroundColor: color.pressed },
  buttonText: { ...type.bodyStrong, color: color.textOnInteractive },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  tabPressed: { backgroundColor: color.surfaceRaised },
  tabGlyph: { ...type.heading, color: color.textSecondary },
  tabText: { ...type.chip, color: color.textSecondary },
  tabOn: { color: color.accent },

  rail: {
    width: RAIL_WIDTH,
    backgroundColor: color.backgroundRail,
    borderRightWidth: 1,
    borderRightColor: color.border,
    paddingVertical: space.xl,
    gap: space.lg,
    alignItems: 'center',
  },
  railItem: {
    width: '100%',
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  railItemOn: {
    backgroundColor: color.accentSurface,
    borderRightWidth: 2,
    borderRightColor: color.accent,
  },
  railCapture: {
    marginTop: 'auto',
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.interactiveFill,
  },
  railCaptureGlyph: { ...type.title, color: color.textOnInteractive },
});
