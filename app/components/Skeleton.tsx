/**
 * Skeleton.tsx — loading that reads as progress, not stall.
 *
 * Frontend-polish P2: History and chat-load used a centered ActivityIndicator,
 * which tells the user only "something is happening somewhere". Skeleton blocks
 * matching the real row layout tell them what is coming and where — the screen
 * assembles instead of appearing.
 *
 * One shared opacity pulse (Animated.loop, native driver) drives every block on
 * screen so the whole skeleton breathes together rather than shimmering out of
 * phase. Deliberately no gradient shimmer: this app's motion budget is spent
 * only where the product earns it, and a loading state earns a pulse at most.
 */

import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type DimensionValue } from 'react-native';
import { color, radius, space } from '../theme/tokens';

function usePulse() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonBlock({
  width,
  height = 14,
  round = radius.sm,
  pulse,
}: {
  width: DimensionValue;
  height?: number;
  round?: number;
  pulse: Animated.Value;
}) {
  return (
    <Animated.View
      style={{ width, height, borderRadius: round, backgroundColor: color.surfaceRaised, opacity: pulse }}
    />
  );
}

/** History while loading: rows shaped like the real ones. */
export function HistorySkeleton({ rows = 4 }: { rows?: number }) {
  const pulse = usePulse();
  return (
    <View style={s.list} accessibilityLabel="Loading past jobs" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.row}>
          <SkeletonBlock width={i % 2 ? '52%' : '68%'} height={16} pulse={pulse} />
          <View style={s.meta}>
            <SkeletonBlock width={86} height={20} round={radius.sm} pulse={pulse} />
            <SkeletonBlock width={48} height={12} pulse={pulse} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** A conversation while loading: one question bubble, one answer column. */
export function ConversationSkeleton() {
  const pulse = usePulse();
  return (
    <View style={s.convo} accessibilityLabel="Loading this job" accessibilityRole="progressbar">
      <View style={s.userLine}>
        <SkeletonBlock width="62%" height={40} round={radius.lg} pulse={pulse} />
      </View>
      <SkeletonBlock width="90%" height={14} pulse={pulse} />
      <SkeletonBlock width="84%" height={14} pulse={pulse} />
      <SkeletonBlock width="88%" height={14} pulse={pulse} />
      <View style={s.chipRow}>
        <SkeletonBlock width={120} height={30} round={radius.md} pulse={pulse} />
        <SkeletonBlock width={120} height={30} round={radius.md} pulse={pulse} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm },
  row: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    marginBottom: space.sm,
  },
  meta: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  convo: { padding: space.lg, gap: space.md },
  userLine: { alignItems: 'flex-end', marginBottom: space.md },
  chipRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
