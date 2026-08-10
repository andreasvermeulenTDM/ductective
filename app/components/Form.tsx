/**
 * Form.tsx — labelled fields and buttons, for the identity screens.
 *
 * Everything before this run was a conversation: one composer, one send button,
 * and no forms at all. Accounts bring five screens' worth of typed input, and
 * three copies of the same `TextInput` with three slightly different focus
 * treatments is how a design system stops being one.
 *
 * No new dependency and no new visual language — every value comes from
 * `theme/tokens.ts` and the press physics come from `Tactile.tsx`, so these read
 * as the app rather than as a form library dropped into it.
 *
 * Three accessibility facts these encode once so no screen has to remember them:
 *
 *  - **Every control is labelled.** `Field` renders a visible `<Text>` label
 *    *and* passes `accessibilityLabel` to the input, because a placeholder
 *    disappears the moment you type into it and a screen reader should not have
 *    to guess from what is left.
 *  - **Focus is visible.** RN gives a `TextInput` no focus ring of its own, so
 *    the border goes cyan on focus. On a phone that matters less than on the web
 *    target this repo also builds, where the keyboard is how you move.
 *  - **48dp.** `MIN_TOUCH` on every button and every input, per E6.7.
 */

import { useState, type ReactNode } from 'react';
import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from './Tactile';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';

export function Field({
  label,
  hint,
  error,
  value,
  onChangeText,
  ...rest
}: TextInputProps & {
  label: string;
  /** Said before they type, not after they get it wrong. */
  hint?: string;
  error?: string | null;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        placeholderTextColor={color.textSecondary}
        style={[s.input, focused && s.inputFocused, Boolean(error) && s.inputError]}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  icon,
  hint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** In flight. Reads as "working", and blocks a second submission. */
  busy?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  hint?: string;
}) {
  const off = Boolean(disabled || busy);
  const glyph =
    variant === 'primary' ? color.textOnInteractive
    : variant === 'danger' ? color.refusalText
    : color.textPrimary;

  return (
    <ScalePressable
      onPress={onPress}
      disabled={off}
      haptic="tap"
      style={({ pressed }) => [
        s.button,
        variant === 'primary' && s.primary,
        variant === 'secondary' && s.secondary,
        variant === 'danger' && s.danger,
        pressed && (variant === 'primary' ? s.primaryPressed : s.secondaryPressed),
        off && s.buttonOff,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy: Boolean(busy) }}
    >
      <View style={s.buttonInner}>
        {icon ? <Ionicons name={icon} size={20} color={glyph} /> : null}
        <Text
          style={[
            s.buttonText,
            variant === 'primary' && s.primaryText,
            variant === 'danger' && s.dangerText,
          ]}
        >
          {busy ? 'Working…' : label}
        </Text>
      </View>
    </ScalePressable>
  );
}

/** A titled block, so the account screens have one sectioning rhythm. */
export function Section({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{title}</Text>
      {children}
      {footer}
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: space.xs },
  label: { ...type.label, color: color.textPrimary },
  hint: { ...type.caption, color: color.textSecondary },
  input: {
    minHeight: MIN_TOUCH,
    ...type.body,
    color: color.textPrimary,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  /** RN draws no focus ring of its own — this is the only one there is. */
  inputFocused: { borderColor: color.accent },
  inputError: { borderColor: color.refusalBorder },
  error: { ...type.caption, color: color.refusalText },

  button: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonOff: { opacity: 0.5 },
  buttonText: { ...type.bodyStrong, color: color.textPrimary },

  primary: { backgroundColor: color.interactiveFill },
  primaryPressed: { backgroundColor: color.pressed },
  primaryText: { color: color.textOnInteractive },

  secondary: { borderWidth: 1, borderColor: color.borderStrong },
  secondaryPressed: { backgroundColor: color.surfaceRaised },

  /** Destructive, but not the refusal card's language — see accountCopy.ts. */
  danger: { borderWidth: 1, borderColor: color.refusalBorder },
  dangerText: { color: color.refusalText },

  section: { gap: space.md },
  sectionLabel: { ...type.overline, color: color.textSecondary },
});
