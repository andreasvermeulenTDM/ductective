/**
 * Tactile.tsx — press physics and haptics, in one place.
 *
 * Frontend-polish P1: every Pressable in the app swapped background color on
 * press and nothing moved. On a phone held one-handed in gloves, a small scale
 * transform is the difference between "did that register?" and certainty —
 * visual state changes hide under a gloved thumb; motion at the edges doesn't.
 *
 * Plain RN Animated, native driver, no dependency. Spring on release (a press
 * should feel like it has weight), timing on press-in (contact must be
 * instant). Scale 0.97: perceptible without being cartoonish.
 *
 * `haptic` fires expo-haptics on press for the moments that matter. Sparingly,
 * by design — a tool that buzzes constantly trains the hand to ignore it. The
 * convention: 'tap' for ordinary actions, 'shutter' for the camera, and
 * success/warning notifications are fired by the OWNING screen on arrival
 * events (identified, refusal), not by buttons.
 */

import { useRef } from 'react';
import { Animated, Pressable, type PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticKind = 'tap' | 'shutter' | null;

export async function fireHaptic(kind: 'success' | 'warning' | 'tap' | 'shutter') {
  try {
    if (kind === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warning') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'shutter') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Haptics are garnish: web and simulators have none, and a failed buzz
    // must never surface anywhere near the interaction it decorated.
  }
}

export function ScalePressable({
  children,
  style,
  haptic = null,
  onPress,
  scaleTo = 0.97,
  ...rest
}: PressableProps & {
  haptic?: HapticKind;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      {...rest}
      onPress={(e) => {
        if (haptic) void fireHaptic(haptic);
        onPress?.(e);
      }}
      onPressIn={(e) => {
        Animated.timing(scale, { toValue: scaleTo, duration: 60, useNativeDriver: true }).start();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, stiffness: 300, damping: 20, useNativeDriver: true }).start();
        rest.onPressOut?.(e);
      }}
      style={style}
    >
      {(state) => (
        <Animated.View style={{ transform: [{ scale }] }}>
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}
