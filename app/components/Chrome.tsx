/**
 * Chrome.tsx — shared shell pieces: the prototype banner, state views, tab bar.
 */

import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';

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

export function Loading({ label }: { label: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={color.accent} />
      <Text style={s.centerText}>{label}</Text>
    </View>
  );
}

/** Every error state names a next action. No dead ends — E6.6. */
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
      <Text style={s.errorTitle}>{title}</Text>
      <Text style={s.centerText}>{detail}</Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          accessibilityRole="button"
        >
          <Text style={s.buttonText}>Try again</Text>
        </Pressable>
      )}
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

export type Tab = 'chat' | 'history' | 'capture';

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'chat', label: 'Diagnose' },
    { id: 'capture', label: 'Nameplate' },
    { id: 'history', label: 'History' },
  ];

  return (
    <View style={s.tabBar}>
      {tabs.map((t) => {
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
            <View style={[s.tabRule, on && s.tabRuleOn]} />
            <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  centerText: { ...type.body, color: color.textSecondary, textAlign: 'center' },
  errorTitle: { ...type.heading, color: color.refusal, textAlign: 'center' },
  emptyTitle: { ...type.title, color: color.textPrimary, textAlign: 'center' },

  button: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    backgroundColor: color.interactive,
    marginTop: space.sm,
  },
  buttonPressed: { backgroundColor: color.pressed },
  buttonText: { ...type.bodyStrong, color: color.textOnInteractive },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  tab: { flex: 1, minHeight: MIN_TOUCH + 8, alignItems: 'center', justifyContent: 'center' },
  tabPressed: { backgroundColor: color.surfaceRaised },
  tabRule: { height: 2, width: 28, backgroundColor: 'transparent', marginBottom: space.sm },
  tabRuleOn: { backgroundColor: color.accent },
  tabText: { ...type.label, color: color.textSecondary },
  tabTextOn: { color: color.accent },
});
