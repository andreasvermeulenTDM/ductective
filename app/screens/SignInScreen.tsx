/**
 * SignInScreen.tsx — ST-A04, plus ST-A06's "Continue without an account".
 *
 * ---------------------------------------------------------------------------
 * The pairing rule is enforced by construction, not by care
 * ---------------------------------------------------------------------------
 * The provider buttons are rendered by mapping `SIGN_IN_PROVIDERS` from
 * `lib/auth.ts` — `['apple', 'google']`, ordered, Apple first. There is no
 * hand-kept list here to fall out of step with it.
 *
 * That matters more than it looks. Offering Google without offering Sign in with
 * Apple is an App Store guideline 4.8 rejection (brief hard constraint 4), and
 * the failure mode is somebody descoping Apple to unblock a wave and nobody
 * noticing until App Review. Rendering from the constant makes "ship Google
 * alone" require deleting Apple from a shared module that a test asserts against,
 * rather than deleting a line from a screen.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes here are not failures, and none of them renders as one
 * ---------------------------------------------------------------------------
 *  - **Cancelled.** The technician dismissed the provider sheet. Nothing is
 *    rendered at all — `isSilentOutcome` short-circuits before any state is set.
 *    An app that says "sign-in failed" to someone who chose not to sign in is
 *    arguing with them.
 *  - **`address-in-use`.** Measured behaviour (§1.2): GoTrue answers a duplicate
 *    sign-up with a successful-looking response and no session. Treating that as
 *    success would congratulate a technician on an account that does not exist,
 *    and their real history would appear to have vanished. It is a *routing*
 *    signal — it flips this screen to sign-in mode with the address kept — and it
 *    renders in the notice tone, not the error tone.
 *  - **`provider_disabled`.** Apple and Google are not enabled on the project yet
 *    (ST-A20, Human-owned, external lead time). That is a build that is not
 *    finished, not a technician who did something wrong, and the copy says so
 *    while pointing at the two paths that do work today.
 *
 * **Nothing on this screen is logged.** No `console` call exists in this file,
 * which is ST-A04 AC 9 held structurally rather than by remembering.
 */

import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Button, Field } from '../components/Form';
import { InlineNotice } from '../components/Chrome';
import { ScalePressable } from '../components/Tactile';
import { SIGN_IN_PROVIDERS, signInWithEmail, signInWithProvider, signUpWithEmail, type OAuthProvider } from '../lib/auth';
import { AccountFailure } from '../lib/accounts';
import { copyForError, isSilentOutcome, type AccountCopy } from '../lib/accountCopy';
import { GUEST_DISCLOSURE } from '../lib/accountCopy';
import { isConfigured, CONFIG_HINT } from '../lib/supabase';

/** Apple first, and the label is Apple's required wording. */
const PROVIDER_UI: Record<OAuthProvider, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  apple: { label: 'Continue with Apple', icon: 'logo-apple' },
  google: { label: 'Continue with Google', icon: 'logo-google' },
};

type Mode = 'sign-in' | 'sign-up';

export function SignInScreen({ onContinueAsGuest }: { onContinueAsGuest: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'email' | OAuthProvider>(null);
  const [notice, setNotice] = useState<AccountCopy | null>(null);

  /**
   * One place every failure lands, so no call site can invent its own handling.
   * A cancelled OAuth sheet leaves the screen exactly as it was.
   */
  function report(e: unknown) {
    const code = e instanceof AccountFailure ? e.code : 'unknown';
    if (isSilentOutcome(code)) return;
    setNotice(copyForError(code));
  }

  async function submitEmail() {
    if (busy) return;
    const address = email.trim();
    if (!address || !password) {
      setNotice(copyForError(address ? 'weak_password' : 'invalid_email'));
      return;
    }
    setBusy('email');
    setNotice(null);
    try {
      if (mode === 'sign-up') {
        const outcome = await signUpWithEmail(address, password);
        if (outcome.status === 'address-in-use') {
          // OQ-A9. Route, don't apologise: keep the address, drop the password,
          // and put them on the path that actually reaches their history.
          setMode('sign-in');
          setPassword('');
          setNotice(copyForError('email_taken'));
          return;
        }
        if (outcome.status === 'confirmation-required') {
          setNotice(copyForError('email_not_confirmed'));
          return;
        }
      } else {
        await signInWithEmail(address, password);
      }
      // On success the shell's `onAuthStateChange` subscription moves the app on.
      // This screen does not navigate; there is one place auth state is decided.
      setPassword('');
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  }

  async function submitProvider(provider: OAuthProvider) {
    if (busy) return;
    setBusy(provider);
    setNotice(null);
    try {
      const outcome = await signInWithProvider(provider);
      if (outcome.status === 'cancelled') return; // not an error, not a message
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Text style={s.title}>
            {mode === 'sign-in' ? 'Sign in' : 'Create an account'}
          </Text>
          <Text style={s.lede}>
            An account is what keeps your jobs. Every answer and every citation is
            the same without one.
          </Text>
        </View>

        {/*
          No Supabase env: signing in cannot work, and saying so beats letting
          every button fail with "that didn't reach the server". The rest of the
          screen stays live on purpose — "Continue without an account" needs no
          backend at all (§1j), so an unconfigured build is still a usable one.
          Same posture and the same hint the other screens already use.
        */}
        {!isConfigured && (
          <InlineNotice tone="notice" title="Not connected to an account server" detail={CONFIG_HINT} />
        )}

        {notice && (
          <InlineNotice tone={notice.tone} title={notice.title} detail={notice.detail} />
        )}

        {/* Apple first, always — SIGN_IN_PROVIDERS is ordered and this maps it. */}
        <View style={s.providers}>
          {SIGN_IN_PROVIDERS.map((p) => (
            <Button
              key={p}
              label={PROVIDER_UI[p].label}
              icon={PROVIDER_UI[p].icon}
              variant="secondary"
              busy={busy === p}
              disabled={!isConfigured || (Boolean(busy) && busy !== p)}
              onPress={() => submitProvider(p)}
              hint="Opens the provider's sign-in page"
            />
          ))}
        </View>

        <View style={s.dividerRow}>
          <View style={s.divider} />
          <Text style={s.dividerText}>or use an email</Text>
          <View style={s.divider} />
        </View>

        <View style={s.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@shop.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            inputMode="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'sign-up' ? 'At least six characters' : 'Your password'}
            hint={mode === 'sign-up' ? 'At least six characters.' : undefined}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={submitEmail}
          />
          <Button
            label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
            onPress={submitEmail}
            busy={busy === 'email'}
            disabled={!isConfigured || (Boolean(busy) && busy !== 'email')}
          />
          <ScalePressable
            onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setNotice(null); }}
            style={s.switchMode}
            accessibilityRole="button"
            accessibilityLabel={
              mode === 'sign-in'
                ? 'Create an account with an email and password instead'
                : 'Sign in to an account you already have instead'
            }
          >
            <Text style={s.switchModeText}>
              {mode === 'sign-in' ? "I don't have an account yet" : 'I already have an account'}
            </Text>
          </ScalePressable>
        </View>

        {/*
          ST-A06's fourth action, and it is a first-class one rather than a
          footnote. A technician standing on a roof with a dead unit should not
          have to make an account before the app will answer a question, and the
          copy under it is the same disclosure they will keep seeing above the
          composer — stated here so the choice is informed at the moment it is
          made, not explained afterwards.
        */}
        <View style={s.guestBlock}>
          <Button
            label="Continue without an account"
            variant="secondary"
            onPress={onContinueAsGuest}
            hint="Ask questions now. Nothing will be saved."
          />
          <Text style={s.guestBlockText}>{GUEST_DISCLOSURE.body}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  head: { gap: space.sm },
  title: { ...type.display, color: color.textPrimary },
  lede: { ...type.body, color: color.textSecondary },

  providers: { gap: space.sm },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  divider: { flex: 1, height: 1, backgroundColor: color.border },
  dividerText: { ...type.caption, color: color.textSecondary },

  form: { gap: space.md },
  switchMode: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchModeText: { ...type.bodyStrong, color: color.accent },

  guestBlock: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  guestBlockText: { ...type.caption, color: color.textPrimary },
});
